// @vitest-environment node

import sqlite3InitModule, { type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { createMemoryPool } from "./memory-pool.ts";
import { PoolFiles, sqlOf } from "./pool-files.ts";
import { listBooks, REGISTRY_FILE, startRegistry } from "./registry.ts";

// The loader and the registry run over this pool in scripts/load.test.ts; this is the pool's own surface.
let sqlite3: Sqlite3Static;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

const made = () => {
  const pool = createMemoryPool(sqlite3);
  return { pool, files: new PoolFiles(pool, sqlite3) };
};

describe("the memory pool (SDD-0004 §15)", () => {
  it("makes a file when it is opened, and keeps what was written across a close", () => {
    const { pool } = made();
    expect(pool.getFileNames()).toEqual([]);
    const db = new pool.OpfsSAHPoolDb("/a.sqlite3");
    expect(pool.getFileNames()).toEqual(["/a.sqlite3"]);
    expect(pool.getFileCount()).toBe(1);
    db.exec("CREATE TABLE t (x); INSERT INTO t VALUES (1), (2)");
    db.close();
    const again = new pool.OpfsSAHPoolDb("/a.sqlite3");
    expect(again.selectValues("SELECT x FROM t ORDER BY x")).toEqual([1, 2]);
    again.close();
  });

  it("exports a file as bytes, open or closed, and imports bytes as a file", async () => {
    const { pool } = made();
    const db = new pool.OpfsSAHPoolDb("/a.sqlite3");
    db.exec("CREATE TABLE t (x); INSERT INTO t VALUES (7)");
    const live = pool.exportFile("/a.sqlite3") as Uint8Array; // sync, as in sqlite-wasm
    expect(live.length).toBeGreaterThan(0);
    db.close();
    expect(await pool.exportFile("/a.sqlite3")).toEqual(live);

    await pool.importDb("/b.sqlite3", live);
    expect(pool.getFileNames().sort()).toEqual(["/a.sqlite3", "/b.sqlite3"]);
    const copy = new pool.OpfsSAHPoolDb("/b.sqlite3");
    expect(copy.selectValue("SELECT x FROM t")).toBe(7);
    copy.exec("INSERT INTO t VALUES (8)");
    copy.close();
    // The export was a copy: the first file is as it was.
    const first = new pool.OpfsSAHPoolDb("/a.sqlite3");
    expect(first.selectValues("SELECT x FROM t")).toEqual([7]);
    first.close();
  });

  it("unlinks a file, and says whether there was one", () => {
    const { pool } = made();
    new pool.OpfsSAHPoolDb("/a.sqlite3").close();
    expect(pool.unlink("/a.sqlite3")).toBe(true);
    expect(pool.unlink("/a.sqlite3")).toBe(false);
    expect(pool.getFileNames()).toEqual([]);
    expect(() => pool.exportFile("/a.sqlite3")).toThrow(/no such file/);
  });

  it("refuses a second connection to a file that is open, as OPFS does, and a file open cannot go", () => {
    const { pool } = made();
    const db = new pool.OpfsSAHPoolDb("/a.sqlite3");
    expect(() => new pool.OpfsSAHPoolDb("/a.sqlite3")).toThrow(/already open/);
    expect(() => pool.unlink("/a.sqlite3")).toThrow(/open/);
    db.close();
    expect(pool.unlink("/a.sqlite3")).toBe(true);
  });

  it("frees the file for a new connection even when serializing it throws", () => {
    const { pool } = made();
    const db = new pool.OpfsSAHPoolDb("/a.sqlite3");
    db.exec("CREATE TABLE t (x)");
    const original = sqlite3.capi.sqlite3_js_db_export;
    sqlite3.capi.sqlite3_js_db_export = () => {
      throw new Error("out of memory");
    };
    try {
      expect(() => db.close()).toThrow("out of memory");
    } finally {
      sqlite3.capi.sqlite3_js_db_export = original;
    }
    expect(db.pointer).toBeUndefined(); // closed
    new pool.OpfsSAHPoolDb("/a.sqlite3").close(); // not "already open"
  });

  it("has room for any number of files", async () => {
    const { pool } = made();
    await pool.reserveMinimumCapacity(1000);
    pool.pauseVfs();
    expect(pool.getFileCount()).toBe(0);
  });
});

describe("the store's files over the memory pool", () => {
  it("writes a package whole, opens it for reads, shares one connection, and removes it", () => {
    const { pool, files } = made();
    files.write("/book.sqlite3", (sql) => {
      sql.exec("CREATE TABLE hymn (number INTEGER, title TEXT)");
      sql.run("INSERT INTO hymn VALUES (?, ?)", [1, "Amazing Grace"]);
    });
    expect(files.list()).toEqual(["/book.sqlite3"]);
    expect(() => files.write("/book.sqlite3", () => {})).toThrow(/already exists/);
    expect(files.open("/book.sqlite3", (sql) => sql.all("SELECT title FROM hymn"))).toEqual([
      { title: "Amazing Grace" },
    ]);
    const shared = files.conn("/book.sqlite3");
    expect(files.conn("/book.sqlite3")).toBe(shared);
    files.close("/book.sqlite3");
    files.remove("/book.sqlite3");
    expect(files.list()).toEqual([]);
    expect(pool.getFileCount()).toBe(0);
  });

  it("leaves nothing under the name when a write fails", () => {
    const { files } = made();
    expect(() =>
      files.write("/book.sqlite3", (sql) => {
        sql.exec("CREATE TABLE t (x)");
        throw new Error("disk full");
      }),
    ).toThrow("disk full");
    expect(files.list()).toEqual([]);
  });

  it("reads a small file's bytes, and null where there is none", () => {
    const { pool, files } = made();
    expect(files.read("/nope")).toBeNull();
    pool.importDb("/j", new Uint8Array([1, 2, 3]));
    expect(files.read("/j")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("will not remove the registry as a package", () => {
    const { files } = made();
    expect(() => files.remove(REGISTRY_FILE)).toThrow(/registry/);
  });

  it("holds the registry as a file of the pool, as the worker does", () => {
    const { pool, files } = made();
    const registry = startRegistry(
      () => sqlOf(files.conn(REGISTRY_FILE)),
      () => {},
    );
    expect(pool.getFileNames()).toContain(REGISTRY_FILE);
    expect(listBooks({ registry, files, shipped: [], now: () => 1 })).toEqual([]);
  });
});
