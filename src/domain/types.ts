/**
 * Stable opaque slug, e.g. "mal-ymef-athmeeya-geethangal-16".
 * Never a display string.
 */
export type HymnbookId = string;

/** Hymn number as printed. Unique within a hymnbook, not globally. */
export type HymnNumber = number;

/** Unique within one hymn, e.g. "s1", "s2", "r". */
export type PartId = string;

export type PartKind = "stanza" | "refrain" | "bridge" | "tag";

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
  /** Display label, e.g. "1". Absent for refrains. */
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

/** A hymn as stored in content/: the directory supplies `hymnbookId`. */
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
  /** True when produced by live navigation rather than stored data. */
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
