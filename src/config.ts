import type { HymnbookId } from "./domain/types.ts";

/**
 * The books the app bundles: registered as `shipped`, replaced from the bundle
 * when the schema moves (SDD-0004 §6). Nothing assumes one book (§10); the
 * current book is chosen in the Library. Part 6 empties this list.
 */
export const SHIPPED_BOOK_IDS: readonly HymnbookId[] = ["mal-ymef-athmeeya-geethangal-16"];
