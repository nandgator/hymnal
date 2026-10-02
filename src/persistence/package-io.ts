import { PACKAGE_MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from "../../scripts/content-schema.ts";
import { insertRows, type PackageRows } from "../domain/package-rows.ts";
import type { HymnSource, Part, PartKind } from "../domain/types.ts";

export type Value = string | number | null;

/**
 * The little of SQLite the package and registry code needs, so the same code
 * runs on the worker's OO1 database and on `node:sqlite` in a test (SDD-0004
 * §12). Synchronous, like both.
 */
export interface Sql {
  all(sql: string, bind?: Value[]): Record<string, Value>[];
  run(sql: string, bind?: Value[]): void;
  /** One or more statements, no binds. */
  exec(sql: string): void;
}

/** Runs `fn` in a transaction: committed if it returns, rolled back if it throws. */
export function transaction<T>(sql: Sql, fn: () => T): T {
  sql.exec("BEGIN");
  try {
    const result = fn();
    sql.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      sql.exec("ROLLBACK");
    } catch {
      // the transaction is already gone; the original error is the one to report
    }
    throw error;
  }
}

/** What a package's version means to this app (SDD-0004 §7). */
export type PackageState = "ok" | "needs-reloading" | "needs-newer-app" | "unreadable";

const OLDEST_MIGRATABLE = Math.min(...Object.keys(PACKAGE_MIGRATIONS).map(Number));

/** `ok` covers a version this app opens or can migrate (or replace, if shipped). */
export function stateOfVersion(version: number): PackageState {
  if (version > SCHEMA_VERSION) return "needs-newer-app";
  if (version < OLDEST_MIGRATABLE) return "needs-reloading";
  return "ok";
}

/**
 * What SQLite says a file is. Reconcile deletes only a provably empty
 * leftover (`empty`); everything else that is not a readable package is kept:
 * `unreadable` is a database that is damaged, not a database, or has no
 * `hymnbook` table but has others; `error` is anything transient (busy, I/O)
 * and is skipped (SDD-0004 §6).
 */
export type Probe =
  | { kind: "package"; version: number }
  | { kind: "empty" }
  | { kind: "unreadable" }
  | { kind: "error"; error: unknown };

/** True when SQLite says the file is not a database or is malformed. */
export function isUnreadableDatabase(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /not a database|SQLITE_NOTADB|SQLITE_CORRUPT|malformed|result code (26|11)\b/i.test(text);
}

export function probePackage(sql: Sql): Probe {
  try {
    const [row] = sql.all("SELECT schema_version FROM hymnbook");
    return typeof row?.schema_version === "number"
      ? { kind: "package", version: row.schema_version }
      : { kind: "error", error: new Error("hymnbook has no schema_version") };
  } catch (error) {
    if (isUnreadableDatabase(error)) return { kind: "unreadable" };
    const text = error instanceof Error ? error.message : String(error);
    if (!/no such table: hymnbook/i.test(text)) return { kind: "error", error };
    try {
      const [count] = sql.all("SELECT COUNT(*) AS n FROM sqlite_master");
      // A zero-byte file, or a database with no tables at all: an aborted first write.
      return count?.n === 0 ? { kind: "empty" } : { kind: "unreadable" };
    } catch (inner) {
      return isUnreadableDatabase(inner) ? { kind: "unreadable" } : { kind: "error", error: inner };
    }
  }
}

/** The package's `schema_version`, or null when it cannot be read (see {@link probePackage}). */
export function packageVersion(sql: Sql): number | null {
  const probe = probePackage(sql);
  return probe.kind === "package" ? probe.version : null;
}

export interface PackageHead {
  key: string;
  origin: string;
  title: string;
  language: string;
  script: string;
  contentHash: string;
  sources: string[];
  songs: number;
}

/** What a package says about itself; a version 2 one has no origin or sources. */
export function readHead(sql: Sql, version: number): PackageHead | null {
  try {
    const [row] = sql.all(
      version >= 3
        ? "SELECT id, origin, title, language, script, content_hash, sources FROM hymnbook"
        : "SELECT id, id AS origin, title, language, script, content_hash, '[]' AS sources FROM hymnbook",
    );
    const [count] = sql.all("SELECT COUNT(*) AS n FROM hymn");
    if (!row) return null;
    let sources: unknown = [];
    try {
      sources = JSON.parse(row.sources as string);
    } catch {
      // unreadable sources read as none; the registry's copy merges back
    }
    return {
      key: row.id as string,
      origin: row.origin as string,
      title: row.title as string,
      language: row.language as string,
      script: row.script as string,
      contentHash: row.content_hash as string,
      sources: Array.isArray(sources) ? sources.filter((s) => typeof s === "string") : [],
      songs: (count?.n as number | undefined) ?? 0,
    };
  } catch {
    return null;
  }
}

/** A package's title alone, for a book that cannot otherwise be read. */
export function readTitle(sql: Sql): string | null {
  try {
    const [row] = sql.all("SELECT title FROM hymnbook");
    return typeof row?.title === "string" ? row.title : null;
  } catch {
    return null;
  }
}

/**
 * Every song of a package, parts in printed order (SDD-0004 §4), so a hash of
 * it equals the hash of the container's song. A version 2 package has no
 * position: its rowid order stands in for it.
 */
export function readHymns(sql: Sql, version: number): HymnSource[] {
  const order = version >= 3 ? "position" : "rowid";
  const parts = new Map<number, Part[]>();
  const lines = new Map<string, string[]>();
  const sequence = new Map<number, { partId: string }[]>();
  for (const r of sql.all(
    `SELECT hymn_number, part_id, text FROM line ORDER BY hymn_number, part_id, idx`,
  )) {
    const k = `${r.hymn_number}\0${r.part_id}`;
    const list = lines.get(k) ?? [];
    list.push(r.text as string);
    lines.set(k, list);
  }
  for (const r of sql.all(
    `SELECT hymn_number, id, kind, label FROM part ORDER BY hymn_number, ${order}`,
  )) {
    const list = parts.get(r.hymn_number as number) ?? [];
    list.push({
      id: r.id as string,
      kind: r.kind as PartKind,
      label: (r.label as string | null) ?? undefined,
      lines: lines.get(`${r.hymn_number}\0${r.id}`) ?? [],
    });
    parts.set(r.hymn_number as number, list);
  }
  for (const r of sql.all(
    "SELECT hymn_number, part_id FROM sequence_entry ORDER BY hymn_number, idx",
  )) {
    const list = sequence.get(r.hymn_number as number) ?? [];
    list.push({ partId: r.part_id as string });
    sequence.set(r.hymn_number as number, list);
  }
  return sql
    .all("SELECT number, title, author, tune, meter FROM hymn ORDER BY number")
    .map((r) => ({
      number: r.number as number,
      title: r.title as string,
      parts: parts.get(r.number as number) ?? [],
      sequence: sequence.get(r.number as number) ?? [],
      meta: {
        author: (r.author as string | null) ?? undefined,
        tune: (r.tune as string | null) ?? undefined,
        meter: (r.meter as string | null) ?? undefined,
      },
    }));
}

/**
 * Migrates a package in place, step by step, in one transaction. A failure
 * leaves the file as it was and returns false (SDD-0004 §7).
 */
export function migratePackage(sql: Sql, from: number): boolean {
  try {
    transaction(sql, () => {
      for (let v = from; v < SCHEMA_VERSION; v++) {
        const steps = PACKAGE_MIGRATIONS[v];
        if (!steps) throw new Error(`no migration from version ${v}`);
        for (const step of steps) sql.exec(step);
      }
    });
    return true;
  } catch {
    return false;
  }
}

/** Writes a whole package in one transaction: nothing of it is there unless all of it is. */
export function writePackage(sql: Sql, rows: PackageRows): void {
  transaction(sql, () => {
    sql.exec(SCHEMA_SQL);
    insertRows((statement, bind) => sql.run(statement, bind), rows);
  });
}

/** Records the container hashes a package has matched. */
export function writeSources(sql: Sql, sources: readonly string[]): void {
  transaction(sql, () => sql.run("UPDATE hymnbook SET sources = ?", [JSON.stringify(sources)]));
}
