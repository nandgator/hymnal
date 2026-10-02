import type { HymnbookId } from "./domain/types.ts";

/**
 * Phase 1 ships exactly one hymnbook, bundled at build time — no download
 * path yet (SDD-0001 §10.2). Becomes a real manifest once a second hymnbook
 * exists (Board #11).
 */
export const SHIPPED_BOOK_IDS: readonly HymnbookId[] = ["mal-ymef-athmeeya-geethangal-16"];

export const BUNDLED_HYMNBOOK_ID: HymnbookId = devBook() ?? SHIPPED_BOOK_IDS[0];

/** In dev only, `?book=<id>` opens another book built into public/content/,
 * such as an import's draft, to look at it before it's content. */
function devBook(): HymnbookId | undefined {
  if (!import.meta.env.DEV || typeof location === "undefined") return undefined;
  return new URLSearchParams(location.search).get("book") ?? undefined;
}
