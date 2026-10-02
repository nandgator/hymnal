import type * as Comlink from "comlink";
import { commitAndPersist, removeBookAndRecents } from "../persistence/books.ts";
import { getContentAdmin, getContentStore } from "../persistence/content-store.ts";
import type { DevAdmin } from "../persistence/content-store.worker.ts";
import type { Choice } from "../persistence/load.ts";
import { userState } from "../persistence/user-state.ts";

/**
 * The development harness for loading books, before the Library's screen
 * (SDD-0004 §12): `window.hymnalDev`, installed only under
 * `import.meta.env.DEV`. Part 5 replaces it with the screen and deletes it.
 */
async function asFile(source: File | string): Promise<File> {
  if (typeof source !== "string") return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`${source}: ${response.status}`);
  return new File([await response.blob()], source.split("/").pop() ?? "book.hymnbook.json.gz");
}

export function installHymnalDev(): void {
  const admin = getContentAdmin();
  // Comlink proxies a nested object's methods: admin.dev.files() reaches the worker's dev.files().
  const worker = admin.dev as unknown as Comlink.Remote<DevAdmin>;
  const dev = {
    /** Reads a container (a File, or a URL the dev server serves): summary and verdict, nothing written. */
    review: async (source: File | string) => admin.review(await asFile(source)),
    /** Writes what the verdict allows; `choice` is "keep-both" (default) or `{ replace: key }`. A first load asks for persistent storage. */
    commit: (token: string, choice?: Choice) => commitAndPersist(admin, token, choice),
    cancel: (token: string) => admin.cancel(token),
    /** Review, then commit with the default choice, when the file can be loaded. */
    load: async (source: File | string, choice?: Choice) => {
      const review = await admin.review(await asFile(source));
      if (review.violations.length > 0) return { ok: false as const, review };
      return { ...(await commitAndPersist(admin, review.token, choice)), review };
    },
    list: () => admin.listBooks(),
    /** Removes a loaded book and drops its recents. */
    remove: (key: string) => removeBookAndRecents(admin, userState, key),
    addRecent: (key: string, number: number) => userState.addRecent(key, number),
    recents: () => userState.getRecents(),
    reconcile: () => worker.reconcile(),
    files: () => worker.files(),
    sql: (file: string, sql: string, bind?: (string | number | null)[]) =>
      worker.sql(file, sql, bind),
    del: (file: string) => worker.delete(file),
    copy: (from: string, to: string) => worker.copy(from, to),
    /** Puts a file in the pool from a URL the dev server serves. */
    put: async (file: string, url: string) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      return worker.put(file, new Uint8Array(await response.arrayBuffer()));
    },
    /** Installs the bundled book, as the Library does. */
    install: (id: string) => getContentStore().ensureInstalled(id),
  };
  (window as unknown as { hymnalDev: typeof dev }).hymnalDev = dev;
}
