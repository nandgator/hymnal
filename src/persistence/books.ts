import type { OnLoadProgress } from "../domain/progress.ts";
import type { Choice, CommitResult } from "./load.ts";
import type { UserState } from "./user-state.ts";

/** What `navigator.storage.persist()` answered, when it could be asked. */
export type PersistResult = "granted" | "refused" | "unsupported";

/**
 * Asks the browser to keep the app's storage (SDD-0004 §9): a loaded book has
 * no host to come back from. It has to be asked in a window, not in the
 * worker, which has no `persist()`.
 */
export async function askPersist(
  storage: Pick<StorageManager, "persist" | "persisted"> | undefined = typeof navigator ===
  "undefined"
    ? undefined
    : navigator.storage,
): Promise<PersistResult> {
  try {
    if (!storage?.persist) return "unsupported";
    if (await storage.persisted?.()) return "granted";
    return (await storage.persist()) ? "granted" : "refused";
  } catch {
    return "unsupported";
  }
}

export type CommittedBook = CommitResult & {
  /**
   * The browser's answer to the request made at a first load; absent when none was
   * made. It settles whenever the browser does (Firefox asks the user), never
   * rejects, and nothing about the book waits for it.
   */
  persisted?: Promise<PersistResult>;
};

/**
 * Commits a review and, if that was the first load, asks for persistent
 * storage once the book is written. The ask runs alongside: a refusal changes
 * nothing about the book, so the commit does not wait for an answer a prompt
 * may hold open. The one-time note that says to keep the file is the caller's,
 * when `persisted` settles.
 */
export async function commitAndPersist(
  admin: {
    commit(token: string, choice?: Choice, onProgress?: OnLoadProgress): Promise<CommitResult>;
  },
  token: string,
  choice?: Choice,
  persist: () => Promise<PersistResult> = askPersist,
  onProgress?: OnLoadProgress,
): Promise<CommittedBook> {
  const result = await admin.commit(token, choice, onProgress);
  if (result.ok && result.firstLoad) {
    return {
      ...result,
      persisted: Promise.resolve()
        .then(persist)
        .catch(() => "unsupported"),
    };
  }
  return result;
}

/**
 * Removes a loaded book and drops its recents (SDD-0004 §9). The book goes
 * first, the commit: a crash after it leaves recents that name a key no longer
 * held, which the app skips (§10). The recents are on this side of the worker,
 * in `idb`, so the worker alone cannot do both.
 */
export async function removeBookAndRecents(
  admin: { removeBook(key: string): Promise<boolean> },
  state: Pick<UserState, "dropRecents">,
  key: string,
): Promise<boolean> {
  const removed = await admin.removeBook(key);
  if (removed) await state.dropRecents(key);
  return removed;
}
