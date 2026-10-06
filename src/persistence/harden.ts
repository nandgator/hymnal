import type { Database, Sqlite3Static } from "@sqlite.org/sqlite-wasm";

/**
 * The two flags every connection the worker opens carries (ADR-0030): SQLite's
 * defensive mode on (no writable schema, no writes to shadow tables) and
 * `trusted_schema` off (a schema's functions, triggers and views do not run
 * with the app's privileges). Returns false if SQLite would not take either.
 */
export function harden(sqlite3: Sqlite3Static, db: Database): boolean {
  const { capi } = sqlite3;
  const pointer = db.pointer as number;
  return (
    capi.sqlite3_db_config(pointer, capi.SQLITE_DBCONFIG_DEFENSIVE, 1, 0) === 0 &&
    capi.sqlite3_db_config(pointer, capi.SQLITE_DBCONFIG_TRUSTED_SCHEMA, 0, 0) === 0
  );
}

/** `harden`, or an error: for a connection the app cannot use unhardened. */
export function hardened<T extends Database>(sqlite3: Sqlite3Static, db: T): T {
  if (!harden(sqlite3, db)) {
    db.close();
    throw new Error("SQLite would not be set to run safely");
  }
  return db;
}
