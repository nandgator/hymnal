import type { Database, OpfsSAHPoolDatabase, SAHPoolUtil, SqlValue } from "@sqlite.org/sqlite-wasm";
import sqlite3InitModule, { type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import * as Comlink from "comlink";
import { SCHEMA_VERSION } from "../../scripts/content-schema.ts";
import { SHIPPED_BOOK_IDS } from "../config.ts";
import type {
  Hymnbook,
  HymnbookId,
  HymnSource,
  Part,
  PartKind,
  SequenceEntry,
} from "../domain/types.ts";
import type { InstallProgress } from "./download.ts";
import { type Choice, type CommitResult, type LoadReview, LoadSession } from "./load.ts";
import type { Sql, Value } from "./package-io.ts";
import { guardPoolDirectories, poolHandlesFree, startPool } from "./pool-init.ts";
import {
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
  | { state: "schema-mismatch"; found: number; expected: number }
  /** A held book that cannot be opened: the registry's state names why (SDD-0004 §6). */
  | { state: "unreadable"; reason: "needs-reloading" | "needs-newer-app" | "unreadable" };

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

/** Books and the registry, for the Library and the dev hook (SDD-0004 §10). */
export interface ContentAdmin {
  listBooks(): Promise<BookRow[]>;
  /** The book held under `key`, ready to read, or why it is not: a missing file (evicted) or
   * an unreadable package (SDD-0004 §10). Replaces `ensureInstalled` for every held book. */
  openBook(key: string): Promise<ContentStatus>;
  /** Reads a container and returns its summary and verdict; nothing is written (ADR-0027).
   * `target` aims it at a held book that could not be opened (Load Again, §9). */
  review(file: File, target?: string): Promise<LoadReview>;
  /** Writes what the verdict allows (SDD-0004 §8). */
  commit(token: string, choice?: Choice): Promise<CommitResult>;
  /** Throws the parsed book away. */
  cancel(token: string): Promise<boolean>;
  /** A loaded book only; a shipped one is refused. Its recents go with it: see `removeBookAndRecents`. */
  removeBook(key: string): Promise<boolean>;
  /** A write is under way (a commit, a removal, an install): the store is not let go. */
  busy(): Promise<boolean>;
  /** Closes every connection and lets the pool go, so another tab can take
   * the store (SDD-0001 §10.4). The worker is of no use after it. */
  close(): Promise<void>;
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

/** The pool has a fixed number of file slots (a package, the registry and any journal each take one). */
const START_SPARE_SLOTS = 8; // beyond the files present, at start
const ADD_BOOK_SPARE_SLOTS = 8; // beyond the files present, before writing a book
const INSTALL_SPARE_SLOTS = 2; // beyond the files present, before importing a package

class ContentStoreWorker implements ContentStore, ContentAdmin {
  #poolReady: Promise<SAHPoolUtil>;
  #sqlite3: Sqlite3Static | undefined;
  /** Why the store could not start this session, for the error callers see. */
  #unavailable: string | undefined;
  /** Open connections by file name; a file is opened once and shared. */
  #conns = new Map<string, OpfsSAHPoolDatabase>();
  /** The registry, or null if it could not be made: the books still open without it. */
  #ready: Promise<RegistryContext | null>;
  /** The registry and the pool once they are up, for the queries, which are not async. */
  #liveCtx: RegistryContext | null = null;
  #livePool: SAHPoolUtil | null = null;
  /** Writes in flight, so the store is not let go mid-write (SDD-0001 §10.4). */
  #writes = new Set<Promise<unknown>>();
  #session = new LoadSession(() => this.#registry());
  dev: DevAdmin | undefined = import.meta.env.DEV ? this.#makeDev() : undefined;

  constructor() {
    this.#poolReady = this.#initPool();
    // Never rejects: ensureInstalled does not depend on the registry's health.
    this.#ready = this.#start().then(
      (ctx) => {
        this.#liveCtx = ctx;
        return ctx;
      },
      (error) => {
        console.warn("registry unavailable:", error);
        this.#unavailable = error instanceof Error ? error.message : String(error);
        return null;
      },
    );
    this.#poolReady.then(
      (pool) => {
        this.#livePool = pool;
      },
      () => {},
    );
    // A pool that failed to start is reported by the calls that need it.
    this.#poolReady.catch(() => {});
  }

  /**
   * Starts the pool without risking the books (SDD-0001 §10.2): sqlite-wasm
   * deletes the whole pool directory when its init fails, so the directories
   * are made undeletable here, one worker at a time holds the store lock, and
   * the pool's handles must be free before the install is tried.
   */
  async #initPool(): Promise<SAHPoolUtil> {
    guardPoolDirectories(FileSystemDirectoryHandle.prototype);
    const loading = sqlite3InitModule();
    return startPool({
      locks: navigator.locks,
      free: async () => poolHandlesFree(await navigator.storage.getDirectory()),
      install: async () => {
        const sqlite3 = await loading;
        this.#sqlite3 = sqlite3;
        return sqlite3.installOpfsSAHPoolVfs({ name: "hymnal" });
      },
    });
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
    if (!ctx) {
      throw new Error(
        this.#unavailable
          ? `the books are unavailable this session: ${this.#unavailable}`
          : "the registry is unavailable",
      );
    }
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
      write: (file, fn) => {
        const sqlite3 = this.#sqlite3;
        if (!sqlite3) throw new Error("sqlite is not loaded");
        if (pool.getFileNames().includes(file)) throw new Error(`${file} already exists`);
        const scratch = new sqlite3.oo1.DB(":memory:");
        try {
          fn(this.#sql(scratch));
          const bytes = sqlite3.capi.sqlite3_js_db_export(scratch.pointer as number);
          // The pool writes the bytes into a spare slot and takes the name last.
          try {
            void pool.importDb(file, bytes);
          } catch (error) {
            console.warn(`${file}: not stored:`, error);
            throw new Error(
              `could not store the book (${error instanceof Error ? error.message : String(error)})`,
            );
          }
        } finally {
          scratch.close();
        }
      },
      read: (file) => {
        try {
          // exportFile is synchronous (the typings say Promise); a journal is a few KB.
          return pool.getFileNames().includes(file)
            ? (pool.exportFile(file) as unknown as Uint8Array)
            : null;
        } catch {
          return null;
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

  async review(file: File, target?: string): Promise<LoadReview> {
    return this.#session.review(new Uint8Array(await file.arrayBuffer()), target);
  }

  async openBook(key: string): Promise<ContentStatus> {
    const ctx = await this.#ready;
    // No registry this session: only the shipped path can open a book.
    if (!ctx) return this.ensureInstalled(key);
    const row = listBooks(ctx).find((book) => book.key === key);
    if (!row) return { state: "missing-asset" };
    if (row.state !== "ok") return { state: "unreadable", reason: row.state };
    const pool = await this.#poolReady;
    if (!pool.getFileNames().includes(row.file)) return { state: "missing-asset" };
    try {
      this.#conn(pool, row.file);
    } catch {
      return { state: "corrupt" };
    }
    return { state: "ready" };
  }

  #track<T>(write: Promise<T>): Promise<T> {
    this.#writes.add(write);
    const done = () => this.#writes.delete(write);
    write.then(done, done);
    return write;
  }

  async busy(): Promise<boolean> {
    return this.#writes.size > 0;
  }

  commit(token: string, choice?: Choice): Promise<CommitResult> {
    return this.#track(this.#session.commit(token, choice));
  }

  async cancel(token: string): Promise<boolean> {
    return this.#session.cancel(token);
  }

  async removeBook(key: string): Promise<boolean> {
    return this.#track((async () => removeBook(await this.#registry(), key))());
  }

  async close(): Promise<void> {
    // A review not yet committed is thrown away: nothing was written.
    this.#session.discard();
    await Promise.allSettled([...this.#writes]);
    await this.#ready;
    for (const file of [...this.#conns.keys()]) this.#close(file);
    this.#livePool = null;
    this.#liveCtx = null;
    try {
      await (await this.#poolReady).pauseVfs();
    } catch {
      // A pool that never started holds nothing.
    }
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

  ensureInstalled(
    id: HymnbookId,
    _onProgress?: (progress: InstallProgress) => void,
  ): Promise<ContentStatus> {
    return this.#track(this.#install(id));
  }

  async #install(id: HymnbookId): Promise<ContentStatus> {
    const pool = await this.#poolReady;
    const ctx = await this.#ready; // null if the registry is unavailable: the book opens regardless
    const filename = filenameFor(id);

    // Nothing ships (ADR-0026, SDD-0004 §13 part 6): a book is on the device
    // already, or it is not held. There is no bundle to fetch it from.
    if (!pool.getFileNames().includes(filename)) return { state: "missing-asset" };

    const db = this.#conn(pool, filename);

    let found: number | undefined;
    try {
      found = this.#one<number>(db, "SELECT schema_version FROM hymnbook");
    } catch {
      // fall through — undefined means corrupt, same as an empty result
    }
    if (found === undefined) return { state: "corrupt" };
    if (found !== SCHEMA_VERSION)
      return { state: "schema-mismatch", found, expected: SCHEMA_VERSION };
    // The book is held: register it if it has no row (SDD-0004 §13, part 3).
    // Registering is best effort: a registry fault never fails a book that opens.
    if (ctx) {
      try {
        const row = listBooks(ctx).find((book) => book.file === filename);
        if (!row || row.state !== "ok") await indexPackage(ctx, filename, "loaded");
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

  /** The book's file is the registry's current row for the key, so a Replace
   * (a new file under the same key) is followed with nothing to invalidate. */
  #open(id: HymnbookId): OpfsSAHPoolDatabase {
    const file = this.#liveCtx
      ? (listBooks(this.#liveCtx).find((book) => book.key === id)?.file ?? filenameFor(id))
      : filenameFor(id);
    const pool = this.#livePool;
    if (!pool?.getFileNames().includes(file)) {
      throw new Error(`${id}: the book is not held (openBook() says why)`);
    }
    return this.#conn(pool, file);
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
