// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  choosePool,
  guardPoolDirectories,
  holdPoolLock,
  POOL_LOCK,
  PoolUnavailableError,
  poolHandlesFree,
  probeOpfs,
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

describe("choosePool (SDD-0004 §15)", () => {
  it("keeps OPFS where it is usable", () => {
    expect(choosePool({ found: "usable" })).toEqual({ mode: "opfs" });
  });

  it("falls back to memory when there is no origin storage, or no sync access handle", () => {
    expect(choosePool({ found: "absent" })).toMatchObject({ mode: "memory" });
    expect(choosePool({ found: "no-sync-handle" })).toMatchObject({ mode: "memory" });
  });

  it("falls back to memory when getDirectory() is refused", () => {
    // UnknownError: WebKit's answer in a private window (an ephemeral session).
    for (const name of ["SecurityError", "NotAllowedError", "UnknownError"]) {
      expect(choosePool({ found: "rejected", name, message: "denied" })).toMatchObject({
        mode: "memory",
      });
    }
  });

  it("is an error, not memory, when getDirectory() fails for any other reason", () => {
    expect(choosePool({ found: "rejected", name: "InvalidStateError", message: "boom" })).toEqual({
      mode: "error",
      message: "origin storage failed: InvalidStateError: boom",
    });
  });
});

describe("probeOpfs", () => {
  const fail = (name: string) => {
    const error = new Error("no");
    error.name = name;
    return vi.fn(async () => {
      throw error;
    });
  };

  it("finds OPFS usable when the root opens and file handles can be synchronous", async () => {
    const getDirectory = vi.fn(async () => ({}));
    expect(await probeOpfs({ storage: { getDirectory }, hasSyncHandle: true })).toEqual({
      found: "usable",
    });
    expect(getDirectory).toHaveBeenCalledTimes(1);
  });

  it("finds it absent without a storage manager or a getDirectory", async () => {
    expect(await probeOpfs({ storage: undefined, hasSyncHandle: true })).toEqual({
      found: "absent",
    });
    expect(await probeOpfs({ storage: {}, hasSyncHandle: true })).toEqual({ found: "absent" });
  });

  it("reports the error getDirectory() rejects with", async () => {
    expect(
      await probeOpfs({ storage: { getDirectory: fail("SecurityError") }, hasSyncHandle: true }),
    ).toEqual({ found: "rejected", name: "SecurityError", message: "no" });
  });

  it("finds a missing createSyncAccessHandle", async () => {
    expect(
      await probeOpfs({ storage: { getDirectory: async () => ({}) }, hasSyncHandle: false }),
    ).toEqual({ found: "no-sync-handle" });
  });

  it("decides memory for a private window and the error for a pool held elsewhere", async () => {
    const refused = await probeOpfs({
      storage: { getDirectory: fail("SecurityError") },
      hasSyncHandle: true,
    });
    expect(choosePool(refused).mode).toBe("memory");
    // A pool another tab holds is found by startPool, after the probe says OPFS is fine.
    expect(choosePool({ found: "usable" }).mode).toBe("opfs");
    await expect(
      startPool({
        locks: undefined,
        free: async () => false,
        freeTimeoutMs: 0,
        install: async () => "never",
      }),
    ).rejects.toBeInstanceOf(PoolUnavailableError);
  });
});
