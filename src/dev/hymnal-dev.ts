import type * as Comlink from "comlink";
import { getContentAdmin, getContentStore } from "../persistence/content-store.ts";
import type { DevAdmin } from "../persistence/content-store.worker.ts";

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
    /** Loads a container: a File, or a URL the dev server serves. */
    load: async (source: File | string) => admin.loadContainer(await asFile(source)),
    list: () => admin.listBooks(),
    remove: (key: string) => admin.removeBook(key),
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
