import type { HymnbookId } from "./domain/types.ts";

/**
 * Phase 1 ships exactly one hymnbook, bundled at build time — no download
 * path yet (SDD-0001 §10.2). Becomes a real manifest once a second hymnbook
 * exists (Board #11).
 */
export const BUNDLED_HYMNBOOK_ID: HymnbookId = "mal-ymef-athmeeya-geethangal-16";
