import type { HymnbookId } from "./domain/types.ts";

/**
 * The books the app bundles: registered as `shipped` (SDD-0004 §6). Nothing
 * ships until a public-domain sample exists (ADR-0026), so this is empty and
 * every book is a loaded one.
 */
export const SHIPPED_BOOK_IDS: readonly HymnbookId[] = [];
