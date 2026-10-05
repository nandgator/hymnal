// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  guardPoolDirectories,
  holdPoolLock,
  POOL_LOCK,
  PoolUnavailableError,
  poolHandlesFree,
  startPool,
  waitUntilHandlesFree,
} from "./pool-init.ts";

describe("guardPoolDirectories", () => {
  it("refuses to remove the pool's directories, which is what sqlite-wasm's failed init does", async () => {
    const removed: string[] = [];
    const proto = {
      removeEntry: async (name: string, _options?: { recursive?: boolean }) => {
        removed.push(name);
      },
    };
    const undo = guardPoolDirectories(proto);
    await expect(proto.removeEntry(".opaque", { recursive: true })).rejects.toThrow(/refusing/);
    await expect(proto.removeEntry(".hymnal", { recursive: true })).rejects.toThrow(/refusing/);
    await proto.removeEntry("abc123");
    expect(removed).toEqual(["abc123"]);
    undo();
    await proto.removeEntry(".opaque");
    expect(removed).toEqual(["abc123", ".opaque"]);
  });
});

type LockRequest = (
  name: string,
  options: { signal: AbortSignal },
  callback: () => Promise<never>,
) => Promise<unknown>;

describe("holdPoolLock", () => {
  it("waits for the previous holder and then keeps the lock", async () => {
    const queue: (() => void)[] = [];
    const locks = {
      request: (async (name, _options, cb) => {
        expect(name).toBe(POOL_LOCK);
        await new Promise<void>((r) => queue.push(r));
        return cb();
      }) as LockRequest,
    };
    let got = false;
    void holdPoolLock(locks).then(() => {
      got = true;
    });
    await Promise.resolve();
    expect(got).toBe(false);
    queue[0]?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(got).toBe(true);
  });

  it("is not the tab's lock name", () => {
    expect(POOL_LOCK).not.toBe("hymnal-store");
  });

  it("is a no-op without Web Locks", async () => {
    await expect(holdPoolLock(undefined)).resolves.toBeUndefined();
  });

  it("rejects, not hangs, when the lock is not given in time", async () => {
    const locks = {
      request: ((_name, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("", "AbortError")),
          );
        })) as LockRequest,
    };
    await expect(holdPoolLock(locks, 10)).rejects.toThrow(/still holds the books/);
  });

  it("rejects with a clear message when the browser refuses the request", async () => {
    const locks = {
      request: (async () => {
        throw new DOMException("not allowed in this context", "SecurityError");
      }) as LockRequest,
    };
    await expect(holdPoolLock(locks, 1000)).rejects.toThrow(/lock was refused: .*not allowed/);
  });
});

describe("startPool", () => {
  const grant = {
    request: ((_n, _o, cb) => cb()) as LockRequest,
  };

  it("installs once, with the lock held and every handle free", async () => {
    const install = vi.fn(async () => "pool");
    await expect(startPool({ locks: grant, free: async () => true, install })).resolves.toBe(
      "pool",
    );
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("does not install when the handles are still not free at the cap", async () => {
    const install = vi.fn(async () => "pool");
    await expect(
      startPool({
        locks: grant,
        free: async () => false,
        freeTimeoutMs: 0,
        install,
      }),
    ).rejects.toBeInstanceOf(PoolUnavailableError);
    expect(install).not.toHaveBeenCalled();
  });

  it("does not install when the lock times out", async () => {
    const install = vi.fn(async () => "pool");
    const locks = {
      request: ((_n, options) =>
        new Promise((_r, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("", "AbortError")),
          );
        })) as LockRequest,
    };
    await expect(
      startPool({ locks, lockTimeoutMs: 5, free: async () => true, install }),
    ).rejects.toBeInstanceOf(PoolUnavailableError);
    expect(install).not.toHaveBeenCalled();
  });
});

describe("poolHandlesFree", () => {
  it("reads any error as not free", async () => {
    const root = {
      getDirectoryHandle: async () => {
        throw new Error("boom");
      },
    } as unknown as FileSystemDirectoryHandle;
    await expect(poolHandlesFree(root)).resolves.toBe(false);
  });
});

describe("waitUntilHandlesFree", () => {
  it("retries with backoff until the old worker lets go", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const ok = await waitUntilHandlesFree(async () => ++calls >= 4, {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(ok).toBe(true);
    expect(sleeps).toEqual([50, 100, 200]);
  });

  it("gives up at the deadline and says so", async () => {
    let t = 0;
    const ok = await waitUntilHandlesFree(async () => false, {
      timeoutMs: 1000,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    expect(ok).toBe(false);
  });
});
