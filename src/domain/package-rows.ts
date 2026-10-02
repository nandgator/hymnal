import type { HymnbookSource, HymnSource } from "./types.ts";

/** What a package records about the book beyond its source (SDD-0004 §7). */
export interface PackageIdentity {
  /** The key: a slug (shipped) or a UUIDv7 (loaded). */
  key: string;
  /** The `id` the file declared; for a shipped book, the slug. */
  origin: string;
  /** Hashes of the container files the book has matched. */
  sources: readonly string[];
  /** A hash of the source files, or a loaded book's first container hash. */
  contentHash: string;
  schemaVersion: number;
}

type Value = string | number | null;

/** The rows of one package, by table, in column order of {@link INSERTS}. */
export interface PackageRows {
  hymnbook: Value[];
  hymn: Value[][];
  part: Value[][];
  line: Value[][];
  sequenceEntry: Value[][];
  fts: Value[][];
}

export const INSERTS = {
  hymnbook:
    "INSERT INTO hymnbook (id, origin, title, language, script, publisher, edition, isbn, schema_version, content_hash, sources) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  hymn: "INSERT INTO hymn (number, title, author, tune, meter) VALUES (?, ?, ?, ?, ?)",
  part: "INSERT INTO part (hymn_number, id, position, kind, label) VALUES (?, ?, ?, ?, ?)",
  line: "INSERT INTO line (hymn_number, part_id, idx, text) VALUES (?, ?, ?, ?)",
  sequenceEntry: "INSERT INTO sequence_entry (hymn_number, idx, part_id) VALUES (?, ?, ?)",
  fts: "INSERT INTO hymn_fts (rowid, title, body) VALUES (?, ?, ?)",
} as const;

/**
 * The rows a package holds (SDD-0004 §7), the one builder `build:content`
 * and the worker both insert, so the two cannot disagree. Input must already
 * be validated. Parts are numbered by position in the order the file has them.
 */
export function packageRows(
  book: HymnbookSource,
  hymns: readonly HymnSource[],
  identity: PackageIdentity,
): PackageRows {
  const rows: PackageRows = {
    hymnbook: [
      identity.key,
      identity.origin,
      book.title,
      book.language,
      book.script,
      book.publisher ?? null,
      book.edition ?? null,
      book.isbn ?? null,
      identity.schemaVersion,
      identity.contentHash,
      JSON.stringify(identity.sources),
    ],
    hymn: [],
    part: [],
    line: [],
    sequenceEntry: [],
    fts: [],
  };
  for (const hymn of hymns) {
    const { author, tune, meter } = hymn.meta ?? {};
    rows.hymn.push([hymn.number, hymn.title, author ?? null, tune ?? null, meter ?? null]);
    hymn.parts.forEach((part, position) => {
      rows.part.push([hymn.number, part.id, position, part.kind, part.label ?? null]);
      part.lines.forEach((text, idx) => {
        rows.line.push([hymn.number, part.id, idx, text]);
      });
    });
    hymn.sequence.forEach((entry, idx) => {
      rows.sequenceEntry.push([hymn.number, idx, entry.partId]);
    });
    rows.fts.push([hymn.number, hymn.title, hymn.parts.flatMap((p) => p.lines).join("\n")]);
  }
  return rows;
}

/** Inserts every row through `run`, in an order that satisfies the keys. */
export function insertRows(run: (sql: string, bind: Value[]) => void, rows: PackageRows): void {
  run(INSERTS.hymnbook, rows.hymnbook);
  for (const table of ["hymn", "part", "line", "sequenceEntry", "fts"] as const) {
    for (const row of rows[table]) run(INSERTS[table], row);
  }
}
