/**
 * Starting the OPFS SAH pool without ever taking the books with it (SDD-0001
 * §10.2). sqlite-wasm's `installOpfsSAHPoolVfs` has a destructive failure
 * path: when it cannot take a handle on every file (the previous worker of the
 * tab is still dying, another tab holds them) it calls `removeVfs()`, which
 * runs `removeEntry(".opaque", { recursive: true })` and, if nothing holds a
 * handle by then, deletes every book. The guards, in order of strength:
 *
 * 1. {@link guardPoolDirectories}: removing the pool's directories is refused
 *    in this worker, whoever asks. Nothing legitimate removes a directory (the
 *    pool removes single files by their random names), so a failed install can
 *    never become a delete.
 * 2. {@link holdPoolLock}: one worker owns the pool, ordered by the Web Lock
 *    `hymnal-pool`, held for the worker's life, so a new worker waits for the
 *    old one. (`hymnal-store` is the tab's, held on the main thread.)
 * 3. {@link waitUntilHandlesFree}: the lock is released a moment before the
 *    old worker's file handles are, so take and drop a handle on every pool
 *    file until all can be taken. If they cannot within the cap,
 *    {@link startPool} does not install: the store is unavailable this
 *    session and the next start tries again.
 */

/** The pool's directories under the OPFS root (`"." + vfs name`, then `.opaque`). */
export const POOL_DIRECTORIES: readonly string[] = [".hymnal", ".opaque"];

/** The Web Lock the one worker that owns the pool holds for its life. The tab's own is `hymnal-store`. */
export const POOL_LOCK = "hymnal-pool";

/** The store cannot be started this session; the message says why. Retried at the next start. */
export class PoolUnavailableError extends Error {
  override name = "PoolUnavailableError";
}

/** The worker-only half of `FileSystemFileHandle`, which the DOM typings lack. */
interface SyncFileHandle extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<{ close(): void }>;
}

interface RemovesEntries {
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

/** Makes `removeEntry` refuse the pool's directories. Returns an undo, for tests. */
export function guardPoolDirectories(proto: RemovesEntries): () => void {
  const original = proto.removeEntry;
  proto.removeEntry = function (this: RemovesEntries, name, options) {
    if (POOL_DIRECTORIES.includes(name)) {
      return Promise.reject(new Error(`refusing to remove the pool directory ${name}`));
    }
    return original.call(this, name, options);
  };
  return () => {
    proto.removeEntry = original;
  };
}

type Locks = {
  request(
    name: string,
    options: { signal: AbortSignal },
    callback: () => Promise<never>,
  ): Promise<unknown>;
};

/**
 * Resolves once this worker holds the lock, which it keeps until the worker
 * ends. Rejects, never hangs: after `timeoutMs` (another worker still owns the
 * pool), or when the browser refuses the request.
 */
export function holdPoolLock(locks: Locks | undefined, timeoutMs = 20_000): Promise<void> {
  if (!locks) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      abort.abort();
      reject(new PoolUnavailableError("another tab or worker still holds the books"));
    }, timeoutMs);
    locks
      .request(POOL_LOCK, { signal: abort.signal }, () => {
        clearTimeout(timer);
        resolve();
        return new Promise<never>(() => {});
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(
          error instanceof PoolUnavailableError
            ? error
            : new PoolUnavailableError(
                `the store lock was refused: ${error instanceof Error ? error.message : String(error)}`,
              ),
        );
      });
  });
}

/**
 * Polls `free` until it says every pool file can be opened, backing off, for
 * up to `timeoutMs`. False at the deadline: the caller must not install.
 */
export async function waitUntilHandlesFree(
  free: () => Promise<boolean>,
  options: { timeoutMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<boolean> {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 20_000);
  let delay = 50;
  for (;;) {
    if (await free()) return true;
    if (now() >= deadline) return false;
    await sleep(delay);
    delay = Math.min(delay * 2, 500);
  }
}

/**
 * True when a sync access handle can be taken, and is dropped, on every file
 * of the pool. Any error, expected or not, reads as "not free yet": the
 * caller retries until its cap and never installs over a doubt. Worker only.
 */
export async function poolHandlesFree(root: FileSystemDirectoryHandle): Promise<boolean> {
  const taken: { close(): void }[] = [];
  try {
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await (await root.getDirectoryHandle(POOL_DIRECTORIES[0] ?? "")).getDirectoryHandle(
        POOL_DIRECTORIES[1] ?? "",
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") return true; // a first run
      return false;
    }
    for await (const handle of dir.values()) {
      if (handle.kind !== "file") continue;
      taken.push(await (handle as SyncFileHandle).createSyncAccessHandle());
    }
    return true;
  } catch {
    return false;
  } finally {
    for (const h of taken) h.close();
  }
}

export interface PoolStart<T> {
  locks: Locks | undefined;
  lockTimeoutMs?: number;
  /** True when every pool file's handle can be taken. */
  free: () => Promise<boolean>;
  freeTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** The sqlite-wasm install: only ever called with the lock held and every handle free. */
  install: () => Promise<T>;
}

/**
 * The guarded start: lock, then handles free, then install. Anything else
 * throws {@link PoolUnavailableError} without having touched the pool.
 */
export async function startPool<T>(start: PoolStart<T>): Promise<T> {
  await holdPoolLock(start.locks, start.lockTimeoutMs);
  const free = await waitUntilHandlesFree(start.free, {
    timeoutMs: start.freeTimeoutMs,
    sleep: start.sleep,
  });
  if (!free) {
    throw new PoolUnavailableError("the books are still in use by another tab or window");
  }
  return start.install();
}

/** What the window's OPFS turned out to be, before any pool is started (SDD-0004 §15). */
export type OpfsProbe =
  | { found: "usable" }
  /** `navigator.storage` or `getDirectory()` is not there. */
  | { found: "absent" }
  /** `getDirectory()` rejected; `name` is the error's. */
  | { found: "rejected"; name: string; message: string }
  /** The root opens, but a file handle has no `createSyncAccessHandle`. */
  | { found: "no-sync-handle" };

/** Where the books are held this session. */
export type StorageMode = "opfs" | "memory";

export type PoolChoice =
  | { mode: StorageMode; why?: string }
  /** The probe failed for a reason that is not a refusal: the store is unavailable, not in memory. */
  | { mode: "error"; message: string };

/**
 * The errors of `getDirectory()` that mean this window refuses OPFS (private
 * windows, blocked site data). WebKit says `UnknownError` in a private window:
 * its ephemeral session has no storage, while a persistent one opens.
 */
const REFUSALS: readonly string[] = ["SecurityError", "NotAllowedError", "UnknownError"];

/**
 * OPFS, memory or an error, from what was found (SDD-0004 §15). Only a
 * refusal falls back to memory; any other failure stays an error, as does a
 * pool held by another tab ({@link PoolUnavailableError}, which the probe
 * cannot see): the books are there, and a second copy in memory would split them.
 */
export function choosePool(probe: OpfsProbe): PoolChoice {
  switch (probe.found) {
    case "usable":
      return { mode: "opfs" };
    case "absent":
      return { mode: "memory", why: "this window has no origin storage" };
    case "no-sync-handle":
      return { mode: "memory", why: "this window cannot open files for sync access" };
    case "rejected":
      return REFUSALS.includes(probe.name)
        ? { mode: "memory", why: `this window refuses origin storage (${probe.name})` }
        : { mode: "error", message: `origin storage failed: ${probe.name}: ${probe.message}` };
  }
}

/** The parts of the worker's scope the probe looks at; overridable for tests. */
export interface OpfsScope {
  storage?: { getDirectory?: () => Promise<unknown> };
  hasSyncHandle: boolean;
}

/** Looks at this worker's OPFS: asks for the root, writes nothing. */
export async function probeOpfs(
  scope: OpfsScope = {
    storage: typeof navigator === "undefined" ? undefined : navigator.storage,
    hasSyncHandle:
      typeof FileSystemFileHandle !== "undefined" &&
      "createSyncAccessHandle" in FileSystemFileHandle.prototype,
  },
): Promise<OpfsProbe> {
  if (typeof scope.storage?.getDirectory !== "function") return { found: "absent" };
  try {
    // Called as a method of the manager: it throws on any other `this`.
    await scope.storage.getDirectory();
  } catch (error) {
    return {
      found: "rejected",
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return scope.hasSyncHandle ? { found: "usable" } : { found: "no-sync-handle" };
}
