import * as Comlink from "comlink";
import type { HymnbookId } from "../domain/types.ts";
import type { ContentAdmin, ContentStore, HymnSummary } from "./content-store.worker.ts";

// A book's list of songs is read once, not on every screen that names a
// song: it only changes when the book is installed or replaced, which drop
// it. A failed read isn't kept. Memory only, this tab only.
const lists = new Map<HymnbookId, Promise<HymnSummary[]>>();

/** A book was replaced, restored or removed: its list of songs is read again. */
export function forgetBook(key: HymnbookId): void {
  lists.delete(key);
}

let store: ContentStore | undefined;
let admin: ContentAdmin | undefined;

/** The one content-store instance for this tab. Owns a dedicated Worker — see SDD-0001 §10.1. */
export function getContentStore(): ContentStore {
  if (!store) {
    const remote = connect();
    const listHymns = (id: HymnbookId) => {
      let list = lists.get(id);
      if (!list) {
        list = remote.listHymns(id);
        list.catch(() => lists.delete(id));
        lists.set(id, list);
      }
      return list;
    };
    // A callback can't be copied to the worker; Comlink proxies it. Done
    // here, so callers pass a plain function.
    store = {
      ensureInstalled: (id, onProgress) => {
        lists.delete(id);
        return remote.ensureInstalled(id, onProgress && Comlink.proxy(onProgress));
      },
      getHymnbook: (id) => remote.getHymnbook(id),
      listHymns,
      getHymn: (id, number) => remote.getHymn(id, number),
      searchLyrics: (id, query) => remote.searchLyrics(id, query),
    } satisfies ContentStore;
  }
  return store;
}

/**
 * The books held and the registry: the same worker as the store's (SDD-0004
 * §10). As with the store, a progress callback is proxied here, so callers
 * pass a plain function.
 */
export function getContentAdmin(): ContentAdmin {
  if (!admin) {
    const remote = connect();
    admin = {
      listBooks: () => remote.listBooks(),
      openBook: (key) => remote.openBook(key),
      review: (file, target, onProgress) =>
        remote.review(file, target, onProgress && Comlink.proxy(onProgress)),
      commit: (token, choice, onProgress) =>
        remote.commit(token, choice, onProgress && Comlink.proxy(onProgress)),
      cancel: (token) => remote.cancel(token),
      removeBook: (key) => remote.removeBook(key),
      busy: () => remote.busy(),
      close: () => remote.close(),
      // Comlink proxies a nested object's methods; the typings do not know.
      get dev() {
        return remote.dev as unknown as ContentAdmin["dev"];
      },
    } satisfies ContentAdmin;
  }
  return admin;
}

let remote: Comlink.Remote<ContentStore & ContentAdmin> | undefined;
let worker: Worker | undefined;
function connect() {
  if (!remote) {
    worker = new Worker(new URL("./content-store.worker.ts", import.meta.url), {
      type: "module",
    });
    remote = Comlink.wrap<ContentStore & ContentAdmin>(worker);
  }
  return remote;
}

/** A write is in flight in this tab's store (nothing started: none). */
export async function contentBusy(): Promise<boolean> {
  return remote ? remote.busy() : false;
}

/**
 * Lets the store go (SDD-0001 §10.4): the pool is paused so its file handles
 * are free, then the worker ends. The next getContentStore() or
 * getContentAdmin() starts a new one. Nothing started: nothing to do.
 */
export async function releaseContent(): Promise<void> {
  const current = remote;
  const running = worker;
  remote = undefined;
  worker = undefined;
  store = undefined;
  admin = undefined;
  lists.clear();
  if (!current) return;
  try {
    await current.close();
  } finally {
    running?.terminate();
  }
}

export type {
  ContentAdmin,
  ContentStatus,
  ContentStore,
  HymnSummary,
  InstallProgress,
  OnLoadProgress,
  SearchResult,
} from "./content-store.worker.ts";
export type { Choice, CommitResult, LoadReview } from "./load.ts";
export type { BookRow } from "./registry.ts";
