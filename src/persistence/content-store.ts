import * as Comlink from "comlink";
import type { ContentStore } from "./content-store.worker.ts";

let store: ContentStore | undefined;

/** The one content-store instance for this tab. Owns a dedicated Worker — see SDD-0001 §10.1. */
export function getContentStore(): ContentStore {
  if (!store) {
    const worker = new Worker(new URL("./content-store.worker.ts", import.meta.url), {
      type: "module",
    });
    store = Comlink.wrap<ContentStore>(worker);
  }
  return store;
}

export type {
  ContentStatus,
  ContentStore,
  HymnSummary,
  SearchResult,
} from "./content-store.worker.ts";
