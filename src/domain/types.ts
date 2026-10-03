/**
 * Stable opaque slug, e.g. "mal-ymef-athmeeya-geethangal-16".
 * Never a display string.
 */
export type HymnbookId = string;

/** Hymn number as printed. Unique within a hymnbook, not globally. */
export type HymnNumber = number;

/** Unique within one hymn, e.g. "s1", "s2", "c". */
export type PartId = string;

/**
 * A part's role in the song, in the usual order of one. A chorus is also
 * called a chorus. An instrumental solo, an ad lib or an elision has no
 * lyrics of its own, so none is a part.
 */
export type PartKind =
  | "intro"
  | "stanza"
  | "pre-chorus"
  | "chorus"
  | "post-chorus"
  | "bridge"
  | "outro"
  | "tag";

export interface Hymnbook {
  id: HymnbookId;
  title: string;
  language: string;
  script: string;
  publisher?: string;
  edition?: string;
  /** Natural id for a published edition. Absent for unpublished/community books. */
  isbn?: string;
  hymnCount: number;
}

export interface Part {
  id: PartId;
  kind: PartKind;
  lines: string[];
  /** Display label, e.g. "1". Absent for choruses. */
  label?: string;
}

export interface SequenceEntry {
  partId: PartId;
}

export interface HymnMeta {
  author?: string;
  tune?: string;
  meter?: string;
  topics?: string[];
  scripture?: string[];
  copyright?: string;
}

export interface Hymn {
  hymnbookId: HymnbookId;
  number: HymnNumber;
  title: string;
  parts: Part[];
  sequence: SequenceEntry[];
  meta: HymnMeta;
}

/** `hymnbook.json` as stored in a book directory: the book, plus its format (SDD-0002). */
export interface HymnbookSource extends Hymnbook {
  format: number;
}

/** A hymn as stored in a book directory: the directory supplies `hymnbookId`. */
export type HymnSource = Omit<Hymn, "hymnbookId">;

/** Derived from the sequence, never stored — see SDD-0001 §2.2. */
export interface Occurrence {
  /** Position in the effective sequence. */
  index: number;
  part: Part;
  /**
   * How many times in a row — including this one — the same part has shown
   * back-to-back. 1 means "not a repeat." Only an immediately adjacent
   * recurrence counts; verse → chorus → verse → chorus is the hymn's normal
   * printed form, not a repeat.
   */
  repeatOrdinal: number;
  /** True when inserted by an explicit live repeat rather than stored data. */
  isAdHoc: boolean;
}

/** One address space, used everywhere — see SDD-0001 §3. */
export interface Position {
  hymnbookId: HymnbookId;
  hymnNumber: HymnNumber;
  occurrenceIndex: number;
  /** null focuses the whole part rather than a single line. */
  lineIndex: number | null;
}
