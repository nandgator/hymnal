import type { Database, Sqlite3Static, SqlValue } from "@sqlite.org/sqlite-wasm";
import type { Sql, Value } from "./package-io.ts";
import { type PackageFiles, REGISTRY_FILE } from "./registry.ts";

/**
 * What the store uses of a pool: the OPFS SAH pool's surface, which a pool in
 * memory offers as well (SDD-0004 §15). `exportFile` is synchronous in
 * sqlite-wasm though its typings say Promise.
 */
export interface PackagePool {
  getFileNames(): string[];
  getFileCount(): number;
  reserveMinimumCapacity(n: number): Promise<unknown>;
  importDb(file: string, bytes: Uint8Array): unknown;
  exportFile(file: string): Uint8Array | Promise<Uint8Array>;
  unlink(file: string): boolean;
  OpfsSAHPoolDb: new (file: string) => Database;
  pauseVfs(): unknown;
}

/** The pool has a fixed number of file slots (a package, the registry and any journal each take one). */
const ADD_BOOK_SPARE_SLOTS = 8; // beyond the files present, before writing a book

/** SQL over an sqlite-wasm connection. */
export function sqlOf(db: Database): Sql {
  return {
    all: (sql, bind) =>
      db.exec({
        sql,
        bind: bind as SqlValue[] | undefined,
        rowMode: "object",
        returnValue: "resultRows",
      }) as Record<string, Value>[],
    run: (sql, bind) => {
      db.exec({ sql, bind: bind as SqlValue[] | undefined });
    },
    exec: (sql) => {
      db.exec(sql);
    },
    prepare: (sql) => {
      const stmt = db.prepare(sql);
      return {
        run: (bind) => {
          stmt.bind(bind as SqlValue[]).stepReset();
        },
        finalize: () => {
          stmt.finalize();
        },
      };
    },
  };
}

/**
 * The registry's view of a pool's files (SDD-0004 §6), over OPFS or memory
 * alike. Owns the open connections: a file is opened once and shared.
 */
export class PoolFiles implements PackageFiles {
  #conns = new Map<string, Database>();

  readonly pool: PackagePool;
  readonly sqlite3: Sqlite3Static;

  constructor(pool: PackagePool, sqlite3: Sqlite3Static) {
    this.pool = pool;
    this.sqlite3 = sqlite3;
  }

  /** The shared connection to `file`, opened (and the file made, if missing) on first use. */
  conn(file: string): Database {
    let db = this.#conns.get(file);
    if (!db) {
      db = new this.pool.OpfsSAHPoolDb(file);
      this.#conns.set(file, db);
    }
    return db;
  }

  close(file: string): void {
    this.#conns.get(file)?.close();
    this.#conns.delete(file);
  }

  closeAll(): void {
    for (const file of [...this.#conns.keys()]) this.close(file);
  }

  list = () => this.pool.getFileNames();

  open<T>(file: string, fn: (sql: Sql) => T): T {
    const wasOpen = this.#conns.has(file);
    const db = this.conn(file);
    try {
      return fn(sqlOf(db));
    } finally {
      if (!wasOpen) this.close(file);
    }
  }

  write(file: string, fn: (sql: Sql) => void): void {
    const { pool, sqlite3 } = this;
    if (pool.getFileNames().includes(file)) throw new Error(`${file} already exists`);
    const scratch = new sqlite3.oo1.DB(":memory:");
    try {
      fn(sqlOf(scratch));
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
  }

  read(file: string): Uint8Array | null {
    try {
      // exportFile is synchronous (the typings say Promise); a journal is a few KB.
      return this.pool.getFileNames().includes(file)
        ? (this.pool.exportFile(file) as Uint8Array)
        : null;
    } catch {
      return null;
    }
  }

  remove(file: string): void {
    if (file === REGISTRY_FILE) throw new Error("the registry is not removed as a package");
    this.close(file);
    this.pool.unlink(file);
  }

  async reserve(): Promise<void> {
    await this.pool.reserveMinimumCapacity(this.pool.getFileCount() + ADD_BOOK_SPARE_SLOTS);
  }
}
