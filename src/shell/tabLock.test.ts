import { describe, expect, it } from "vitest";
import {
  createTabLock,
  type LockLike,
  type TabChannel,
  type TabMessage,
  type TabState,
} from "./tabLock.ts";

/** An exclusive lock with a queue, as navigator.locks has. */
function fakeLocks(): LockLike {
  let held = false;
  const queue: (() => void)[] = [];
  const grant = async (callback: (lock: unknown) => Promise<void>) => {
    held = true;
    try {
      await callback({});
    } finally {
      held = false;
      queue.shift()?.();
    }
  };
  return {
    request(_name, options, callback) {
      if (options.ifAvailable) {
        if (held) return callback(null);
        return grant(callback);
      }
      return new Promise((resolve, reject) => {
        const run = () => grant(callback).then(resolve, reject);
        if (options.signal?.aborted) return reject(new Error("aborted"));
        if (!held) return void run();
        const entry = () => run();
        queue.push(entry);
        options.signal?.addEventListener("abort", () => {
          const at = queue.indexOf(entry);
          if (at >= 0) queue.splice(at, 1);
          reject(new Error("aborted"));
        });
      });
    },
  };
}

/** A broadcast bus: a post reaches every other member, never the poster. */
function fakeBus() {
  const members: ((m: TabMessage) => void)[] = [];
  return (): TabChannel => {
    let mine: ((m: TabMessage) => void) | undefined;
    return {
      post: (message) => {
        for (const member of members) if (member !== mine) queueMicrotask(() => member(message));
      },
      listen: (handler) => {
        mine = handler;
        members.push(handler);
        return () => members.splice(members.indexOf(handler), 1);
      },
    };
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function tabs(options: { live?: () => boolean; release?: () => Promise<void> } = {}) {
  const locks = fakeLocks();
  const bus = fakeBus();
  const make = (id: string, live = false, release = async () => {}) =>
    createTabLock({
      locks,
      channel: bus(),
      isLive: options.live ?? (() => live),
      release: options.release ?? release,
      id,
    });
  return { make };
}

describe("tab lock", () => {
  it("the first tab owns the store, the second is told another tab has it", async () => {
    const { make } = tabs();
    const a = make("a");
    const b = make("b");
    a.start();
    await settle();
    b.start();
    await settle();
    expect(a.state()).toBe("owner");
    expect(b.state()).toBe("other");
  });

  it("Use Here releases the holder, which then shows the note itself", async () => {
    const calls: string[] = [];
    const { make } = tabs({
      release: async () => {
        calls.push("closed");
      },
    });
    const a = make("a");
    const b = make("b");
    a.start();
    await settle();
    b.start();
    await settle();
    b.useHere();
    expect(b.state()).toBe("asking");
    await settle();
    expect(calls).toEqual(["closed"]);
    expect(a.state()).toBe("other");
    expect(b.state()).toBe("owner");
    // And back again.
    a.useHere();
    await settle();
    expect(a.state()).toBe("owner");
    expect(b.state()).toBe("other");
  });

  it("the lock is not given up until the store is closed", async () => {
    let finish!: () => void;
    const { make } = tabs({ release: () => new Promise<void>((resolve) => (finish = resolve)) });
    const a = make("a");
    const b = make("b");
    a.start();
    await settle();
    b.start();
    await settle();
    b.useHere();
    await settle();
    expect(a.state()).toBe("owner");
    expect(b.state()).toBe("asking");
    finish();
    await settle();
    expect(b.state()).toBe("owner");
    expect(a.state()).toBe("other");
  });

  it("a live holder refuses, and keeps the store", async () => {
    const { make } = tabs({ live: () => true });
    const a = make("a");
    const b = make("b");
    a.start();
    await settle();
    b.start();
    await settle();
    b.useHere();
    await settle();
    expect(a.state()).toBe("owner");
    expect(b.state()).toBe("presenting");
  });

  it("after a refusal, Use Here can be tried again when the Output has closed", async () => {
    let live = true;
    const { make } = tabs({ live: () => live });
    const a = make("a");
    const b = make("b");
    a.start();
    await settle();
    b.start();
    await settle();
    b.useHere();
    await settle();
    expect(b.state()).toBe("presenting");
    live = false;
    b.useHere();
    await settle();
    expect(b.state()).toBe("owner");
    expect(a.state()).toBe("other");
  });

  it("reports each change of state", async () => {
    const { make } = tabs();
    const a = make("a");
    const seen: TabState[] = [];
    a.onChange((state) => seen.push(state));
    a.start();
    await settle();
    expect(seen).toEqual(["owner"]);
  });

  it("an ended tab frees the lock for the next", async () => {
    const { make } = tabs();
    const a = make("a");
    const b = make("b");
    a.start();
    await settle();
    a.dispose();
    await settle();
    b.start();
    await settle();
    expect(b.state()).toBe("owner");
  });
});

describe("tab lock: a busy or silent holder", () => {
  const setup = (holder: { busy?: () => boolean; silent?: boolean; timeoutMs?: number }) => {
    const locks = fakeLocks();
    const bus = fakeBus();
    const closed: string[] = [];
    const a = createTabLock({
      locks,
      channel: bus(),
      isLive: () => false,
      isBusy: holder.busy,
      release: async () => {
        closed.push("a");
      },
      id: "a",
    });
    const b = createTabLock({
      locks,
      channel: bus(),
      isLive: () => false,
      release: async () => {},
      id: "b",
      timeoutMs: holder.timeoutMs ?? 20,
    });
    return { a, b, closed };
  };

  it("refuses to release while a write is in flight, and says so", async () => {
    let writing = true;
    const { a, b, closed } = setup({ busy: () => writing });
    a.start();
    await settle();
    b.start();
    await settle();
    b.useHere();
    await settle();
    expect(b.state()).toBe("saving");
    expect(a.state()).toBe("owner");
    expect(closed).toEqual([]);
    writing = false;
    b.useHere();
    await settle();
    expect(b.state()).toBe("owner");
    expect(closed).toEqual(["a"]);
  });

  it("times out as silent when no holder answers, and the stale request cannot take the lock later", async () => {
    const locks = fakeLocks();
    const bus = fakeBus();
    // A holder that holds the lock but is deaf to the channel.
    const holder = createTabLock({
      locks,
      channel: { post() {}, listen: () => () => {} },
      isLive: () => false,
      release: async () => {},
      id: "frozen",
    });
    holder.start();
    await settle();
    const b = createTabLock({
      locks,
      channel: bus(),
      isLive: () => false,
      release: async () => {},
      id: "b",
      timeoutMs: 20,
    });
    b.start();
    await settle();
    b.useHere();
    expect(b.state()).toBe("asking");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(b.state()).toBe("silent");
    // The holder goes away: the withdrawn request must not be granted.
    holder.dispose();
    await settle();
    expect(b.state()).toBe("silent");
    // Another try works, now that the lock is free.
    b.useHere();
    await settle();
    expect(b.state()).toBe("owner");
  });

  it("closes its channel when it ends", () => {
    let closed = false;
    const lock = createTabLock({
      locks: fakeLocks(),
      channel: { post() {}, listen: () => () => {}, close: () => (closed = true) },
      isLive: () => false,
      release: async () => {},
    });
    lock.start();
    lock.dispose();
    expect(closed).toBe(true);
  });
});
