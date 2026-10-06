// @vitest-environment node

import sqlite3InitModule, { type Database, type Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { harden } from "./harden.ts";
import { createMemoryPool } from "./memory-pool.ts";
import { PoolFiles } from "./pool-files.ts";

let sqlite3: Sqlite3Static;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

const flag = (db: Database, op: 1010 | 1017): number => {
  const out = sqlite3.wasm.alloc(4);
  try {
    expect(sqlite3.capi.sqlite3_db_config(db.pointer as number, op, -1, out)).toBe(0);
    return sqlite3.wasm.peek32(out);
  } finally {
    sqlite3.wasm.dealloc(out);
  }
};

const isHardened = (db: Database) => {
  const { capi } = sqlite3;
  expect(flag(db, capi.SQLITE_DBCONFIG_DEFENSIVE)).toBe(1);
  expect(flag(db, capi.SQLITE_DBCONFIG_TRUSTED_SCHEMA)).toBe(0);
  // What defensive mode is for: the schema table cannot be written.
  db.exec("PRAGMA writable_schema = ON");
  expect(() => db.exec("UPDATE sqlite_master SET sql = sql")).toThrow(/sqlite_master|readonly/i);
};

describe("harden (ADR-0030)", () => {
  it("sets the defensive flag on and trusted_schema off", () => {
    const db = new sqlite3.oo1.DB(":memory:");
    expect(harden(sqlite3, db)).toBe(true);
    isHardened(db);
    db.close();
  });

  it("is on for a connection from the pool, the registry's and a book's alike", () => {
    const files = new PoolFiles(createMemoryPool(sqlite3), sqlite3);
    for (const file of ["/registry.sqlite3", "/book.sqlite3"]) isHardened(files.conn(file));
    files.closeAll();
  });

  it("is on for the scratch database a write goes through", () => {
    const files = new PoolFiles(createMemoryPool(sqlite3), sqlite3);
    let seen = false;
    files.write("/new.sqlite3", (sql) => {
      sql.exec("CREATE TABLE t (x)");
      seen = true;
      expect(sql.all("PRAGMA trusted_schema")).toEqual([{ trusted_schema: 0 }]);
    });
    expect(seen).toBe(true);
  });
});
