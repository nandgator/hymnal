import type * as Comlink from "comlink";
import { getContentAdmin, getContentStore } from "../persistence/content-store.ts";
import type { DevAdmin } from "../persistence/content-store.worker.ts";
import { userState } from "../persistence/user-state.ts";

/**
 * Development only (`import.meta.env.DEV`, so a production build strips it):
 * `window.hymnalDev`, for setting up the cases only OPFS can show and looking
 * at what is stored. Loading, checking and removing a book are the Library's
 * (SDD-0004 §9), not this hook's; it is here to build a damaged package, an
 * orphan file or a recents entry to look at.
 */
export function installHymnalDev(): void {
  const admin = getContentAdmin();
  // Comlink proxies a nested object's methods: admin.dev.files() reaches the worker's dev.files().
  const worker = admin.dev as unknown as Comlink.Remote<DevAdmin>;
  const dev = {
    list: () => admin.listBooks(),
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
