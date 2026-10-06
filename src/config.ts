import type { HymnbookId } from "./domain/types.ts";

/**
 * The books the app bundles: registered as `shipped` (SDD-0004 §6). Nothing
 * ships until a public-domain sample exists (ADR-0026), so this is empty and
 * every book is a loaded one.
 */
export const SHIPPED_BOOK_IDS: readonly HymnbookId[] = [];

/**
 * The public-domain sample (Board #43, ADR-0026): containers the deploy put
 * under `sample/`, offered in the Library and loaded like any file. Empty in a
 * build without them, and then nothing offers or claims a sample.
 */
export const SAMPLE_FILES: readonly string[] = __SAMPLE_FILES__;

/** Each sample song's rights record, beside the books (docs/sample/RIGHTS.md). */
export const SAMPLE_RIGHTS_URL =
  "https://github.com/nandgator/hymnal/blob/main/docs/sample/RIGHTS.md";

/** Where Report a Problem opens, in a new tab with nothing attached (SDD-0001 §16.10). */
export const REPORT_URL = "https://github.com/nandgator/hymnal/issues/new";
