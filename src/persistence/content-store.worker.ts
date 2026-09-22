import type { Database, OpfsSAHPoolDatabase, SAHPoolUtil, SqlValue } from "@sqlite.org/sqlite-wasm";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import * as Comlink from "comlink";
import { SCHEMA_VERSION } from "../../scripts/content-schema.ts";
import type {
  Hymnbook,
  HymnbookId,
  HymnSource,
  Part,
  PartKind,
  SequenceEntry,
} from "../domain/types.ts";

export interface HymnSummary {
  number: number;
  title: string;
}

export interface SearchResult {
  number: number;
  title: string;
  snippet: string;
}

export type ContentStatus =
  | { state: "ready" }
  | { state: "missing-asset" }
  | { state: "corrupt" }
  | { state: "schema-mismatch"; found: number; expected: number };

/**
 * Runtime counterpart to scripts/build-content.ts — see SDD-0001 §10.
 * Read-only: content is immutable at runtime.
 */
export interface ContentStore {
  /** Must succeed before any other method is called for this hymnbook. */
  ensureInstalled(id: HymnbookId): Promise<ContentStatus>;
  getHymnbook(id: HymnbookId): Promise<Hymnbook>;
  listHymns(id: HymnbookId): Promise<HymnSummary[]>;
  getHymn(id: HymnbookId, number: number): Promise<HymnSource>;
  searchLyrics(id: HymnbookId, query: string): Promise<SearchResult[]>;
}

// opfs-sahpool requires absolute paths.
const filenameFor = (id: HymnbookId) => `/${id}.sqlite3`;

// "SQLite format 3\0" — https://www.sqlite.org/fileformat2.html#the_database_header
const SQLITE_HEADER = [
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
];

class ContentStoreWorker implements ContentStore {
  #poolReady: Promise<SAHPoolUtil>;
  #dbs = new Map<HymnbookId, OpfsSAHPoolDatabase>();

  constructor() {
    this.#poolReady = sqlite3InitModule().then((sqlite3) =>
      sqlite3.installOpfsSAHPoolVfs({ name: "hymnal" }),
    );
  }

  async ensureInstalled(id: HymnbookId): Promise<ContentStatus> {
    const pool = await this.#poolReady;
    const filename = filenameFor(id);

    if (!pool.getFileNames().includes(filename)) {
      // BASE_URL, not a root-absolute path — a GitHub Pages *project* page
      // serves from a subpath, not the domain root.
      const response = await fetch(`${import.meta.env.BASE_URL}content/${id}.sqlite`);
      if (!response.ok) return { state: "missing-asset" };
      const bytes = new Uint8Array(await response.arrayBuffer());
      // A dev-server SPA fallback (or misconfigured host) can answer a
      // missing asset with a 200 of something else entirely — check the
      // actual SQLite file header rather than trusting response.ok alone.
      if (!SQLITE_HEADER.every((byte, i) => bytes[i] === byte)) {
        return { state: "missing-asset" };
      }
      try {
        await pool.importDb(filename, bytes);
      } catch {
        return { state: "corrupt" };
      }
    }

    const db = this.#dbs.get(id) ?? new pool.OpfsSAHPoolDb(filename);
    this.#dbs.set(id, db);

    let found: number | undefined;
    try {
      found = this.#one<number>(db, "SELECT schema_version FROM hymnbook");
    } catch {
      // fall through — undefined means corrupt, same as an empty result
    }
    if (found === undefined) return { state: "corrupt" };
    if (found !== SCHEMA_VERSION)
      return { state: "schema-mismatch", found, expected: SCHEMA_VERSION };
    return { state: "ready" };
  }

  async getHymnbook(id: HymnbookId): Promise<Hymnbook> {
    const db = this.#open(id);
    const row = this.#row(
      db,
      "SELECT id, title, language, script, publisher, edition, isbn FROM hymnbook",
    );
    const hymnCount = this.#one<number>(db, "SELECT COUNT(*) FROM hymn") ?? 0;
    return {
      id: row.id as string,
      title: row.title as string,
      language: row.language as string,
      script: row.script as string,
      publisher: (row.publisher as string | null) ?? undefined,
      edition: (row.edition as string | null) ?? undefined,
      isbn: (row.isbn as string | null) ?? undefined,
      hymnCount,
    };
  }

  async listHymns(id: HymnbookId): Promise<HymnSummary[]> {
    const db = this.#open(id);
    return this.#rows(db, "SELECT number, title FROM hymn ORDER BY number").map((row) => ({
      number: row.number as number,
      title: row.title as string,
    }));
  }

  async getHymn(id: HymnbookId, number: number): Promise<HymnSource> {
    const db = this.#open(id);
    const hymnRow = this.#row(db, "SELECT title, author, tune, meter FROM hymn WHERE number = ?", [
      number,
    ]);

    const partRows = this.#rows(
      db,
      `SELECT part.id, part.kind, part.label
       FROM part
       WHERE part.hymn_number = ?
       ORDER BY (SELECT MIN(idx) FROM sequence_entry se WHERE se.hymn_number = part.hymn_number AND se.part_id = part.id)`,
      [number],
    );
    const lineRows = this.#rows(
      db,
      "SELECT part_id, idx, text FROM line WHERE hymn_number = ? ORDER BY part_id, idx",
      [number],
    );
    const sequenceRows = this.#rows(
      db,
      "SELECT part_id FROM sequence_entry WHERE hymn_number = ? ORDER BY idx",
      [number],
    );

    const parts: Part[] = partRows.map((part) => ({
      id: part.id as string,
      kind: part.kind as PartKind,
      label: (part.label as string | null) ?? undefined,
      lines: lineRows.filter((line) => line.part_id === part.id).map((line) => line.text as string),
    }));
    const sequence: SequenceEntry[] = sequenceRows.map((entry) => ({
      partId: entry.part_id as string,
    }));

    return {
      number,
      title: hymnRow.title as string,
      parts,
      sequence,
      meta: {
        author: (hymnRow.author as string | null) ?? undefined,
        tune: (hymnRow.tune as string | null) ?? undefined,
        meter: (hymnRow.meter as string | null) ?? undefined,
      },
    };
  }

  /**
   * Whole-input phrase match — safe against FTS5 query-syntax characters in
   * free text. Board #8 (Finder) owns real search UX (prefix, multi-term);
   * this is deliberately the simplest thing that can't throw on user input.
   *
   * hymn_fts is contentless (SDD-0001 §6, deliberately — no duplicated lyric
   * text), so it can MATCH but returns NULL for every selected column,
   * `snippet()` included. Title and snippet come from a join back to
   * `hymn`/`line` instead.
   */
  async searchLyrics(id: HymnbookId, query: string): Promise<SearchResult[]> {
    const db = this.#open(id);
    const phrase = `"${query.replace(/"/g, '""')}"`;
    return this.#rows(
      db,
      `SELECT hymn.number AS number, hymn.title AS title,
              (SELECT line.text FROM line
               WHERE line.hymn_number = hymn.number AND line.text LIKE '%' || ? || '%'
               LIMIT 1) AS snippet
       FROM hymn_fts JOIN hymn ON hymn.number = hymn_fts.rowid
       WHERE hymn_fts MATCH ? ORDER BY rank`,
      [query, phrase],
    ).map((row) => ({
      number: row.number as number,
      title: row.title as string,
      snippet: row.snippet as string,
    }));
  }

  #open(id: HymnbookId): OpfsSAHPoolDatabase {
    const db = this.#dbs.get(id);
    if (!db) throw new Error(`${id}: ensureInstalled() must succeed before querying`);
    return db;
  }

  #rows(db: Database, sql: string, bind?: SqlValue[]): Record<string, SqlValue>[] {
    return db.exec({ sql, bind, rowMode: "object", returnValue: "resultRows" });
  }

  #row(db: Database, sql: string, bind?: SqlValue[]): Record<string, SqlValue> {
    const [row] = this.#rows(db, sql, bind);
    if (!row) throw new Error(`query returned no row: ${sql}`);
    return row;
  }

  #one<T extends SqlValue>(db: Database, sql: string, bind?: SqlValue[]): T | undefined {
    const [row] = this.#rows(db, sql, bind);
    if (!row) return undefined;
    const [value] = Object.values(row);
    return value as T;
  }
}

Comlink.expose(new ContentStoreWorker());
