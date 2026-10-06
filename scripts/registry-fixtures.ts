import { DatabaseSync } from "node:sqlite";
import sqlite3InitModule, { type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { songHash } from "../src/domain/hash.ts";
import { insertRows, packageRows } from "../src/domain/package-rows.ts";
import type { HymnbookSource, HymnSource } from "../src/domain/types.ts";
import { createMemoryPool } from "../src/persistence/memory-pool.ts";
import type { Sql } from "../src/persistence/package-io.ts";
import { PoolFiles, sqlOf as wasmSqlOf } from "../src/persistence/pool-files.ts";
import {
  openRegistry,
  type PackageFiles,
  type RegistryContext,
} from "../src/persistence/registry.ts";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./content-schema.ts";

/** Fixtures shared by the registry's and the loader's tests (SDD-0004 §12). */

export const sqlOf = (db: DatabaseSync): Sql => ({
  all: (sql, bind = []) => db.prepare(sql).all(...bind) as Record<string, never>[],
  run: (sql, bind = []) => {
    db.prepare(sql).run(...bind);
  },
  exec: (sql) => db.exec(sql),
  prepare: (sql) => {
    const statement = db.prepare(sql);
    return {
      run: (bind) => {
        statement.run(...bind);
      },
      // node:sqlite finalizes a statement when it is collected.
      finalize: () => {},
    };
  },
});

export const book = (id = "test-book", count = 2): HymnbookSource => ({
  format: 1,
  id,
  title: "A Book",
  language: "en",
  script: "Latn",
  hymnCount: count,
});

// File order (s1, c, s2) differs from first-appearance order (c, s1, s2).
export const hymn = (number: number): HymnSource => ({
  number,
  title: `Song ${number}`,
  parts: [
    { id: "s1", kind: "stanza", label: "1", lines: [`one ${number}`, "two"] },
    { id: "c", kind: "chorus", lines: [`chorus ${number}`] },
    { id: "s2", kind: "stanza", label: "2", lines: ["three"] },
  ],
  sequence: [{ partId: "c" }, { partId: "s1" }, { partId: "c" }, { partId: "s2" }],
  meta: { author: "A" },
});
export const hymns = [hymn(1), hymn(2)];

export async function container(id = "test-book", h = hymns, hash = "f".repeat(64)) {
  const hashes = await Promise.all(h.map(songHash));
  return {
    sourceHash: hash,
    book: { hymnbook: book(id, h.length), hymns: h },
    songHashes: new Map(h.map((x, i) => [x.number, hashes[i]] as const)),
  };
}

/** Pool stand-in: package files are in-memory databases by name. */
export class FakeFiles implements PackageFiles {
  dbs = new Map<string, DatabaseSync>();
  /** Small non-database files (journals) by name, with their bytes. */
  bytes = new Map<string, Uint8Array>();
  list = () => [...this.dbs.keys(), ...this.bytes.keys()];
  read(file: string) {
    return this.bytes.get(file) ?? null;
  }
  /** Files whose open throws, and files whose queries throw, with the error. */
  failOpen = new Map<string, Error>();
  failQuery = new Map<string, Error>();
  /** Files whose open throws from the second call on. */
  failAfterFirst = new Set<string>();
  #opens = new Map<string, number>();
  open<T>(file: string, fn: (sql: Sql) => T): T {
    const n = (this.#opens.get(file) ?? 0) + 1;
    this.#opens.set(file, n);
    const fail =
      this.failOpen.get(file) ??
      (n > 1 && this.failAfterFirst.has(file) ? new Error("boom") : undefined);
    if (fail) throw fail;
    const query = this.failQuery.get(file);
    if (query) {
      return fn({
        all: () => {
          throw query;
        },
        run: () => {
          throw query;
        },
        exec: () => {
          throw query;
        },
      });
    }
    let db = this.dbs.get(file);
    if (!db) {
      db = new DatabaseSync(":memory:");
      this.dbs.set(file, db);
    }
    return fn(sqlOf(db));
  }
  /** Builds the package in a scratch database and installs it whole, as the pool's importDb does. */
  write(file: string, fn: (sql: Sql) => void) {
    if (this.dbs.has(file)) throw new Error(`${file} already exists`);
    const fail = this.failOpen.get(file);
    if (fail) throw fail;
    const query = this.failQuery.get(file);
    const scratch = new DatabaseSync(":memory:");
    try {
      fn(
        query
          ? {
              all: () => {
                throw query;
              },
              run: () => {
                throw query;
              },
              exec: () => {
                throw query;
              },
            }
          : sqlOf(scratch),
      );
    } catch (error) {
      scratch.close();
      throw error;
    }
    this.dbs.set(file, scratch);
  }
  remove(file: string) {
    this.dbs.get(file)?.close();
    this.dbs.delete(file);
    this.bytes.delete(file);
  }
  async reserve() {}
  /** A v3 package of a book, as the worker would write it. */
  put(file: string, id: string, h = hymns, sources: string[] = []) {
    this.open(file, (sql) => fillPackage(sql, id, h, sources));
  }
}

function fillPackage(sql: Sql, id: string, h: HymnSource[], sources: string[]) {
  sql.exec(SCHEMA_SQL);
  insertRows(
    (s, b) => sql.run(s, b),
    packageRows(book(id, h.length), h, {
      key: id,
      origin: id,
      sources,
      contentHash: "c",
      schemaVersion: SCHEMA_VERSION,
    }),
  );
}

/** The worker's files over a pool in memory (SDD-0004 §15): SQLite in wasm, the same code as in the browser. */
export class MemoryFiles extends PoolFiles {
  /** The next import into the pool throws this, once: a full or failing store. */
  failImport?: Error;
  put(file: string, id: string, h = hymns, sources: string[] = []) {
    this.open(file, (sql) => fillPackage(sql, id, h, sources));
  }
}

let wasm: Sqlite3Static | undefined;
/** Loads SQLite in wasm, once; call before {@link setupOn} with the memory backend. */
export async function loadWasm(): Promise<Sqlite3Static> {
  wasm ??= await sqlite3InitModule();
  return wasm;
}

export type Backend = "fake" | "memory";
export const BACKENDS: readonly Backend[] = ["fake", "memory"];

/** {@link setup} on either backend: the fake's files, or the memory pool's (needs {@link loadWasm}). */
export function setupOn(backend: Backend, shipped: string[] = []) {
  if (backend === "fake") return setup(shipped);
  if (!wasm) throw new Error("loadWasm() first");
  const pool = createMemoryPool(wasm);
  const files = new MemoryFiles(pool, wasm);
  const importDb = pool.importDb;
  pool.importDb = (file, bytes) => {
    const fail = files.failImport;
    files.failImport = undefined;
    if (fail) throw fail;
    return importDb(file, bytes);
  };
  const sql = wasmSqlOf(new wasm.oo1.DB(":memory:"));
  openRegistry(sql);
  let t = 0;
  const ctx: RegistryContext = { registry: sql, files, shipped, now: () => ++t };
  return { files, ctx, sql };
}

export function setup(shipped: string[] = []) {
  const files = new FakeFiles();
  const registry = new DatabaseSync(":memory:");
  const sql = sqlOf(registry);
  openRegistry(sql);
  let t = 0;
  const ctx: RegistryContext = { registry: sql, files, shipped, now: () => ++t };
  return { files, ctx, sql };
}

/** A rollback journal's header: the magic, nRec, the nonce, then the initial size in pages (SQLite file format §4). */
export function journalHeader(initialPages: number): Uint8Array {
  const bytes = new Uint8Array(512);
  bytes.set([0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, initialPages);
  view.setUint32(20, 512);
  view.setUint32(24, 4096);
  return bytes;
}
