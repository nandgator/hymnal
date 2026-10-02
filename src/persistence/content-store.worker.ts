import type { Database, OpfsSAHPoolDatabase, SAHPoolUtil, SqlValue } from "@sqlite.org/sqlite-wasm";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import * as Comlink from "comlink";
import { SCHEMA_VERSION } from "../../scripts/content-schema.ts";
import { SHIPPED_BOOK_IDS } from "../config.ts";
import { type ContainerRead, readContainer } from "../domain/container.ts";
import { uuidv7 } from "../domain/key.ts";
import type {
  Hymnbook,
  HymnbookId,
  HymnSource,
  Part,
  PartKind,
  SequenceEntry,
} from "../domain/types.ts";
import { download, type InstallProgress } from "./download.ts";
import type { Sql, Value } from "./package-io.ts";
import {
  addBook,
  type BookRow,
  indexPackage,
  listBooks,
  type PackageFiles,
  REGISTRY_FILE,
  type RegistryContext,
  reconcile,
  removeBook,
  startRegistry,
} from "./registry.ts";

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
export type { InstallProgress };

export interface ContentStore {
  /** Must succeed before any other method is called for this hymnbook.
   * `onProgress` hears the download, when there is one. */
  ensureInstalled(
    id: HymnbookId,
    onProgress?: (progress: InstallProgress) => void,
  ): Promise<ContentStatus>;
  getHymnbook(id: HymnbookId): Promise<Hymnbook>;
  listHymns(id: HymnbookId): Promise<HymnSummary[]>;
  getHymn(id: HymnbookId, number: number): Promise<HymnSource>;
  searchLyrics(id: HymnbookId, query: string): Promise<SearchResult[]>;
}

// opfs-sahpool requires absolute paths.
const filenameFor = (id: HymnbookId) => `/${id}.sqlite3`;

const SEARCH_LIMIT = 30;

// "SQLite format 3\0" — https://www.sqlite.org/fileformat2.html#the_database_header
const SQLITE_HEADER = [
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
];

/** Books and the registry, for the Library and the dev hook (SDD-0004 §10). */
export interface ContentAdmin {
  listBooks(): Promise<BookRow[]>;
  /** Part 3: reads a container and writes it as a new book. No verdict yet (part 4). */
  loadContainer(file: File): Promise<LoadResult>;
  /** A loaded book only; a shipped one is refused. */
  removeBook(key: string): Promise<boolean>;
  /** Development only (undefined in a production build): see {@link DevAdmin}. */
  dev?: DevAdmin;
}

/**
 * For setting up the cases only OPFS can show, through `window.hymnalDev`.
 * Built only under `import.meta.env.DEV`, so a production bundle has none of it.
 */
export interface DevAdmin {
  /** Reconcile again, as at start. */
  reconcile(): Promise<BookRow[]>;
  files(): Promise<string[]>;
  sql(file: string, sql: string, bind?: Value[]): Promise<Record<string, Value>[]>;
  put(file: string, bytes: Uint8Array): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  delete(file: string): Promise<void>;
}

export type LoadResult =
  | { ok: true; key: string; songs: number; sourceHash: string }
  | { ok: false; violations: Extract<ContainerRead, { ok: false }>["violations"] };

/** The pool has a fixed number of file slots (a package, the registry and any journal each take one). */
const START_SPARE_SLOTS = 8; // beyond the files present, at start
const ADD_BOOK_SPARE_SLOTS = 8; // beyond the files present, before writing a book
const INSTALL_SPARE_SLOTS = 2; // beyond the files present, before importing a package

class ContentStoreWorker implements ContentStore, ContentAdmin {
  #poolReady: Promise<SAHPoolUtil>;
  /** Open connections by file name; a file is opened once and shared. */
  #conns = new Map<string, OpfsSAHPoolDatabase>();
  /** The registry, or null if it could not be made: the books still open without it. */
  #ready: Promise<RegistryContext | null>;
  dev: DevAdmin | undefined = import.meta.env.DEV ? this.#makeDev() : undefined;

  constructor() {
    this.#poolReady = sqlite3InitModule().then((sqlite3) =>
      sqlite3.installOpfsSAHPoolVfs({ name: "hymnal" }),
    );
    // Never rejects: ensureInstalled does not depend on the registry's health.
    this.#ready = this.#start().catch((error) => {
      console.warn("registry unavailable:", error);
      return null;
    });
    // A pool that failed to start is reported by the calls that need it.
    this.#poolReady.catch(() => {});
  }

  /** Opens the registry and reconciles it with the pool (SDD-0004 §6). A corrupt
   * registry file is discarded and made again; a reconcile that fails leaves the
   * registry as far as it got. */
  async #start(): Promise<RegistryContext> {
    const pool = await this.#poolReady;
    await pool.reserveMinimumCapacity(pool.getFileCount() + START_SPARE_SLOTS);
    const registry = startRegistry(
      () => this.#sql(this.#conn(pool, REGISTRY_FILE)),
      () => {
        this.#close(REGISTRY_FILE);
        try {
          pool.unlink(REGISTRY_FILE);
        } catch {
          // already gone
        }
      },
    );
    const ctx: RegistryContext = {
      registry,
      files: this.#files(pool),
      shipped: SHIPPED_BOOK_IDS,
      now: Date.now,
    };
    try {
      await reconcile(ctx);
    } catch (error) {
      console.warn("reconcile failed:", error);
    }
    return ctx;
  }

  async #registry(): Promise<RegistryContext> {
    const ctx = await this.#ready;
    if (!ctx) throw new Error("the registry is unavailable");
    return ctx;
  }

  #conn(pool: SAHPoolUtil, file: string): OpfsSAHPoolDatabase {
    let db = this.#conns.get(file);
    if (!db) {
      db = new pool.OpfsSAHPoolDb(file);
      this.#conns.set(file, db);
    }
    return db;
  }

  #sql(db: Database): Sql {
    return {
      all: (sql, bind) => this.#rows(db, sql, bind) as Record<string, Value>[],
      run: (sql, bind) => {
        db.exec({ sql, bind });
      },
      exec: (sql) => {
        db.exec(sql);
      },
    };
  }

  #files(pool: SAHPoolUtil): PackageFiles {
    return {
      list: () => pool.getFileNames(),
      open: (file, fn) => {
        const wasOpen = this.#conns.has(file);
        const db = this.#conn(pool, file);
        try {
          return fn(this.#sql(db));
        } finally {
          if (!wasOpen) this.#close(file);
        }
      },
      remove: (file) => {
        if (file === REGISTRY_FILE) throw new Error("the registry is not removed as a package");
        this.#close(file);
        pool.unlink(file);
      },
      reserve: async () => {
        await pool.reserveMinimumCapacity(pool.getFileCount() + ADD_BOOK_SPARE_SLOTS);
      },
    };
  }

  #close(file: string) {
    this.#conns.get(file)?.close();
    this.#conns.delete(file);
  }

  async listBooks(): Promise<BookRow[]> {
    return listBooks(await this.#registry());
  }

  async loadContainer(file: File): Promise<LoadResult> {
    const ctx = await this.#registry();
    const read = await readContainer(new Uint8Array(await file.arrayBuffer()));
    if (!read.ok) return { ok: false, violations: read.violations };
    const row = await addBook(ctx, uuidv7(), read);
    return { ok: true, key: row.key, songs: row.songs, sourceHash: read.sourceHash };
  }

  async removeBook(key: string): Promise<boolean> {
    return removeBook(await this.#registry(), key);
  }

  #makeDev(): DevAdmin {
    const put = async (file: string, bytes: Uint8Array) => {
      const pool = await this.#poolReady;
      await pool.reserveMinimumCapacity(pool.getFileCount() + INSTALL_SPARE_SLOTS);
      this.#close(file);
      await pool.importDb(file, bytes);
    };
    return {
      reconcile: async () => {
        const ctx = await this.#registry();
        await reconcile(ctx);
        return listBooks(ctx);
      },
      files: async () => (await this.#poolReady).getFileNames(),
      sql: async (file, sql, bind) => {
        await this.#ready;
        return this.#files(await this.#poolReady).open(file, (s) => s.all(sql, bind));
      },
      put,
      copy: async (from, to) => {
        const pool = await this.#poolReady;
        this.#close(from);
        await put(to, await pool.exportFile(from));
      },
      delete: async (file) => this.#files(await this.#poolReady).remove(file),
    };
  }

  async ensureInstalled(
    id: HymnbookId,
    onProgress?: (progress: InstallProgress) => void,
    replacing = false,
  ): Promise<ContentStatus> {
    const pool = await this.#poolReady;
    const ctx = await this.#ready; // null if the registry is unavailable: the book opens regardless
    const filename = filenameFor(id);
    let fetched = false;

    // The dev server re-imports on every load, so a rebuilt package (or a
    // content-local/ test hymn) shows on reload; released builds install once.
    const installed = pool.getFileNames().includes(filename);
    if (replacing || !installed || (import.meta.env.DEV && !this.#conns.has(filename))) {
      // BASE_URL, not a root-absolute path — a GitHub Pages *project* page
      // serves from a subpath, not the domain root.
      const response = await fetch(`${import.meta.env.BASE_URL}content/${id}.sqlite`);
      if (!response.ok) return { state: "missing-asset" };
      const bytes = await download(response, onProgress);
      // A dev-server SPA fallback (or misconfigured host) can answer a
      // missing asset with a 200 of something else entirely — check the
      // actual SQLite file header rather than trusting response.ok alone.
      if (!SQLITE_HEADER.every((byte, i) => bytes[i] === byte)) {
        return { state: "missing-asset" };
      }
      try {
        this.#close(filename);
        await pool.reserveMinimumCapacity(pool.getFileCount() + INSTALL_SPARE_SLOTS);
        await pool.importDb(filename, bytes);
        fetched = true;
      } catch {
        return { state: "corrupt" };
      }
    }

    const db = this.#conn(pool, filename);

    let found: number | undefined;
    try {
      found = this.#one<number>(db, "SELECT schema_version FROM hymnbook");
    } catch {
      // fall through — undefined means corrupt, same as an empty result
    }
    if (found === undefined) return { state: "corrupt" };
    // A copy installed by an earlier app is replaced by the one this app
    // ships (ADR-0025), once: if the shipped one is old too, that's said.
    if (found < SCHEMA_VERSION && !replacing) {
      this.#close(filename);
      return this.ensureInstalled(id, onProgress, true);
    }
    if (found !== SCHEMA_VERSION)
      return { state: "schema-mismatch", found, expected: SCHEMA_VERSION };
    // The book is held: register it (SDD-0004 §13, part 3). A copy just
    // installed, or one with no row, is indexed from its file.
    // Registering is best effort: a registry fault never fails a book that opens.
    if (ctx) {
      try {
        const row = listBooks(ctx).find((book) => book.file === filename);
        if (fetched || !row || row.state !== "ok") {
          await indexPackage(ctx, filename, SHIPPED_BOOK_IDS.includes(id) ? "shipped" : "loaded");
        }
      } catch (error) {
        console.warn(`${id}: not registered:`, error);
      }
    }
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
   * Per-word prefix match, implicit AND (Board #8): each word becomes a
   * quoted, prefix-matched FTS5 term (`"word"*`), so a query matches lines
   * containing all the words regardless of order or completion. Quoting each
   * term (not just escaping it) keeps FTS5 query-syntax characters in free
   * text from breaking the query.
   *
   * hymn_fts is contentless (SDD-0001 §6, deliberately — no duplicated lyric
   * text), so it can MATCH but returns NULL for every selected column,
   * `snippet()` included. Title and snippet come from a join back to
   * `hymn`/`line` instead — the snippet is the first line containing any of
   * the query's words, since a multi-word query can match across lines.
   *
   * Capped at SEARCH_LIMIT: a common word (found by browser-testing this
   * against the real corpus) matches hundreds of hymns, and `rank` ordering
   * doesn't help a caller that renders every row.
   */
  async searchLyrics(id: HymnbookId, query: string): Promise<SearchResult[]> {
    const db = this.#open(id);
    const words = query.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];

    const quote = (word: string) => `"${word.replace(/"/g, '""')}"*`;
    const matchQuery = words.map(quote).join(" ");
    const likeClauses = words.map(() => "line.text LIKE '%' || ? || '%'").join(" OR ");

    return this.#rows(
      db,
      `SELECT hymn.number AS number, hymn.title AS title,
              (SELECT line.text FROM line
               WHERE line.hymn_number = hymn.number AND (${likeClauses})
               LIMIT 1) AS snippet
       FROM hymn_fts JOIN hymn ON hymn.number = hymn_fts.rowid
       WHERE hymn_fts MATCH ? ORDER BY rank LIMIT ${SEARCH_LIMIT}`,
      [...words, matchQuery],
    ).map((row) => ({
      number: row.number as number,
      title: row.title as string,
      snippet: (row.snippet as string | null) ?? "",
    }));
  }

  #open(id: HymnbookId): OpfsSAHPoolDatabase {
    const db = this.#conns.get(filenameFor(id));
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
