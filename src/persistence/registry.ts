import { SCHEMA_VERSION } from "../../scripts/content-schema.ts";
import type { ContainerBook } from "../domain/container.ts";
import { songHash } from "../domain/hash.ts";
import { packageRows } from "../domain/package-rows.ts";
import {
  isUnreadableDatabase,
  migratePackage,
  type PackageState,
  type Probe,
  packageVersion,
  probePackage,
  readHead,
  readHymns,
  readTitle,
  type Sql,
  stateOfVersion,
  transaction,
  writePackage,
  writeSources,
} from "./package-io.ts";

/** The registry's file in the pool, beside the books (SDD-0004 §6). */
export const REGISTRY_FILE = "/registry.sqlite3";
export const REGISTRY_VERSION = 1;

/**
 * SDD-0004 §6, plus `state` (decided in part 3): a package kept but not
 * openable is a row with a state other than `ok`.
 */
export const REGISTRY_SQL = `
CREATE TABLE book (
  key       TEXT PRIMARY KEY,
  origin    TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('shipped','loaded')),
  file      TEXT NOT NULL,
  title     TEXT NOT NULL,
  language  TEXT NOT NULL,
  script    TEXT NOT NULL,
  songs     INTEGER NOT NULL,
  added_at  INTEGER NOT NULL,
  state     TEXT NOT NULL DEFAULT 'ok'
            CHECK (state IN ('ok','needs-reloading','needs-newer-app','unreadable'))
) STRICT;

CREATE TABLE source (
  hash      TEXT PRIMARY KEY,
  book_key  TEXT NOT NULL REFERENCES book(key) ON DELETE CASCADE,
  added_at  INTEGER NOT NULL
) STRICT;

CREATE TABLE song (
  book_key  TEXT NOT NULL REFERENCES book(key) ON DELETE CASCADE,
  number    INTEGER NOT NULL,
  hash      TEXT NOT NULL,
  PRIMARY KEY (book_key, number)
) STRICT;
CREATE INDEX song_hash ON song (hash);
`;

export type BookKind = "shipped" | "loaded";

export interface BookRow {
  key: string;
  origin: string;
  kind: BookKind;
  file: string;
  title: string;
  language: string;
  script: string;
  songs: number;
  addedAt: number;
  state: PackageState;
}

/** The pool's package files, as the registry sees them. */
export interface PackageFiles {
  list(): string[];
  /** Opens `file` (made if missing), runs `fn`, closes it unless it was already open. */
  open<T>(file: string, fn: (sql: Sql) => T): T;
  /** Closes and deletes `file`. */
  remove(file: string): void;
  /** Makes room for another package file (the pool's capacity is fixed). */
  reserve(): Promise<void>;
}

export interface RegistryContext {
  registry: Sql;
  files: PackageFiles;
  /** Ids the app bundles: such a book is `shipped` (SDD-0004 §6). */
  shipped: readonly string[];
  now: () => number;
}

/** Creates the registry, or rebuilds it when its version is not this app's:
 * it is an index of the books, and reconcile fills it again. */
export function openRegistry(sql: Sql): void {
  sql.exec("PRAGMA foreign_keys = ON");
  const [row] = sql.all("PRAGMA user_version");
  const version = row?.user_version;
  if (version === REGISTRY_VERSION) return;
  transaction(sql, () => {
    sql.exec("DROP TABLE IF EXISTS song");
    sql.exec("DROP TABLE IF EXISTS source");
    sql.exec("DROP TABLE IF EXISTS book");
    sql.exec(REGISTRY_SQL);
    sql.exec(`PRAGMA user_version = ${REGISTRY_VERSION}`);
  });
}

/**
 * Opens the registry. A file SQLite calls not a database or malformed is
 * discarded and made again: it is an index, and reconcile fills it from the
 * books. Any other error is rethrown, so the app runs without a registry this
 * session and tries again at the next start.
 */
export function startRegistry(open: () => Sql, discard: () => void): Sql {
  try {
    const sql = open();
    openRegistry(sql);
    return sql;
  } catch (error) {
    if (!isUnreadableDatabase(error)) throw error;
    discard();
    const sql = open();
    openRegistry(sql);
    return sql;
  }
}

const toBook = (r: Record<string, unknown>): BookRow => ({
  key: r.key as string,
  origin: r.origin as string,
  kind: r.kind as BookKind,
  file: r.file as string,
  title: r.title as string,
  language: r.language as string,
  script: r.script as string,
  songs: r.songs as number,
  addedAt: r.added_at as number,
  state: r.state as PackageState,
});

export function listBooks(ctx: RegistryContext): BookRow[] {
  return ctx.registry.all("SELECT * FROM book ORDER BY added_at, key").map(toBook);
}

const bookBy = (ctx: RegistryContext, column: "key" | "file", value: string) => {
  const [row] = ctx.registry.all(`SELECT * FROM book WHERE ${column} = ?`, [value]);
  return row ? toBook(row) : undefined;
};

const registrySources = (ctx: RegistryContext, key: string) =>
  ctx.registry
    .all("SELECT hash FROM source WHERE book_key = ? ORDER BY added_at, hash", [key])
    .map((r) => r.hash as string);

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];

/** `/<stem>.sqlite3` to its stem. */
const stemOfFile = (file: string) => file.replace(/^\//, "").replace(/\.sqlite3$/, "");

/** `<key>.<n>.sqlite3` or `<slug>.sqlite3` to the key: how an unreadable file is named. */
export const keyOfFile = (file: string) => stemOfFile(file).replace(/\.\d+$/, "");

const isPackageFile = (name: string) => name !== REGISTRY_FILE && !/-(journal|wal|shm)$/.test(name);

function insertBook(
  ctx: RegistryContext,
  row: BookRow,
  sources: readonly string[],
  hashes: ReadonlyMap<number, string>,
): void {
  const { registry } = ctx;
  transaction(registry, () => {
    // Replacing a row is for the same book's file; another file's row is never overwritten.
    const held = bookBy(ctx, "key", row.key);
    if (held && held.file !== row.file) {
      throw new Error(`${row.key} is held by ${held.file}; ${row.file} is not indexed over it`);
    }
    registry.run("DELETE FROM book WHERE key = ?", [row.key]);
    registry.run(
      "INSERT INTO book (key, origin, kind, file, title, language, script, songs, added_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        row.key,
        row.origin,
        row.kind,
        row.file,
        row.title,
        row.language,
        row.script,
        row.songs,
        row.addedAt,
        row.state,
      ],
    );
    for (const hash of sources) {
      registry.run("INSERT OR IGNORE INTO source (hash, book_key, added_at) VALUES (?, ?, ?)", [
        hash,
        row.key,
        row.addedAt,
      ]);
    }
    for (const [number, hash] of hashes) {
      registry.run("INSERT INTO song (book_key, number, hash) VALUES (?, ?, ?)", [
        row.key,
        number,
        hash,
      ]);
    }
  });
}

/**
 * Writes a loaded book: its package first, then the registry rows, whose
 * transaction is the commit (SDD-0004 §7). A failed package write is removed;
 * a crash between the two leaves a package that reconcile adopts.
 */
export async function addBook(
  ctx: RegistryContext,
  key: string,
  read: { sourceHash: string; book: ContainerBook; songHashes: ReadonlyMap<number, string> },
  n = 1,
): Promise<BookRow> {
  await ctx.files.reserve();
  const file = `/${key}.${n}.sqlite3`;
  const { hymnbook, hymns } = read.book;
  const rows = packageRows(hymnbook, hymns, {
    key,
    origin: hymnbook.id,
    sources: [read.sourceHash],
    contentHash: read.sourceHash,
    schemaVersion: SCHEMA_VERSION,
  });
  try {
    ctx.files.open(file, (sql) => writePackage(sql, rows));
  } catch (error) {
    try {
      ctx.files.remove(file);
    } catch {
      // nothing was committed to the registry; the leftover is not a package and is removed at start
    }
    throw error;
  }
  const row: BookRow = {
    key,
    origin: hymnbook.id,
    kind: "loaded",
    file,
    title: hymnbook.title,
    language: hymnbook.language,
    script: hymnbook.script,
    songs: hymns.length,
    addedAt: ctx.now(),
    state: "ok",
  };
  try {
    insertBook(ctx, row, [read.sourceHash], read.songHashes);
  } catch (error) {
    // Not committed: the book is not held, so its file must not linger to be adopted.
    try {
      ctx.files.remove(file);
    } catch {
      // reconcile adopts it at the next start if it is still there
    }
    throw error;
  }
  return row;
}

/**
 * Removes a loaded book: the file first (closing any open connection to it),
 * so a crash leaves a row reconcile drops, not a file it adopts. A shipped
 * book is refused (SDD-0004 §9); part 4 may revisit.
 */
export function removeBook(ctx: RegistryContext, key: string): boolean {
  const row = bookBy(ctx, "key", key);
  if (!row) return false;
  if (row.kind === "shipped") throw new Error(`${key} is a shipped book and is not removed`);
  if (row.file === REGISTRY_FILE) throw new Error("the registry is not a book");
  ctx.files.remove(row.file);
  ctx.registry.run("DELETE FROM book WHERE key = ?", [key]);
  return true;
}

/**
 * Indexes a readable package: its row, source rows and song hashes, from the
 * file alone. Keeps a held row's `added_at`, and merges the sources of the
 * package and the registry, writing the union to both (SDD-0004 §6).
 */
export async function indexPackage(
  ctx: RegistryContext,
  file: string,
  kind: BookKind,
): Promise<BookRow | null> {
  const read = ctx.files.open(file, (sql) => {
    const version = packageVersion(sql);
    if (version === null || stateOfVersion(version) !== "ok") return null;
    const head = readHead(sql, version);
    return head && { head, hymns: readHymns(sql, version) };
  });
  if (!read) return null;
  const { head, hymns } = read;
  const hashes = new Map(
    await Promise.all(hymns.map(async (h) => [h.number, await songHash(h)] as const)),
  );
  // The hashing above awaited: the file may have been removed meanwhile.
  if (!ctx.files.list().includes(file)) return null;
  const held = bookBy(ctx, "key", head.key);
  if (held && held.file !== file) return null; // another file's book: not indexed over it
  const sources = union(head.sources, held ? registrySources(ctx, head.key) : []);
  const row: BookRow = {
    key: head.key,
    origin: head.origin,
    kind,
    file,
    title: head.title,
    language: head.language,
    script: head.script,
    songs: head.songs,
    addedAt: held?.addedAt ?? ctx.now(),
    state: "ok",
  };
  insertBook(ctx, row, sources, hashes);
  if (sources.length > head.sources.length) mergeIntoPackage(ctx, file, sources);
  return row;
}

function mergeIntoPackage(ctx: RegistryContext, file: string, sources: readonly string[]) {
  const version = ctx.files.open(file, (sql) => packageVersion(sql));
  // An old shipped package is replaced, not written to; its sources are the registry's alone.
  if (version !== SCHEMA_VERSION) return;
  ctx.files.open(file, (sql) => writeSources(sql, sources));
}

function setState(ctx: RegistryContext, key: string, state: PackageState) {
  ctx.registry.run("UPDATE book SET state = ? WHERE key = ?", [state, key]);
}

/**
 * Lists a file that is kept but not opened as a row with a state, never
 * deleting it. Its key is the file's key, else its file stem if that is held.
 */
function insertUnreadable(ctx: RegistryContext, file: string, state: PackageState) {
  const candidates = [keyOfFile(file), stemOfFile(file), file];
  const key = candidates.find((c) => !bookBy(ctx, "key", c)) ?? file;
  let title: string | null = null;
  try {
    title = ctx.files.open(file, (sql) => readTitle(sql));
  } catch {
    // an unreadable file may not even open: its key stands in for a title
  }
  insertBook(
    ctx,
    {
      key,
      origin: key,
      kind: ctx.shipped.includes(key) ? "shipped" : "loaded",
      file,
      title: title ?? key,
      language: "",
      script: "",
      songs: 0,
      addedAt: ctx.now(),
      state,
    },
    [],
    new Map(),
  );
}

/** Migrates a loaded book's package in place if it is older; false if that failed. */
function bringCurrent(ctx: RegistryContext, file: string, version: number): boolean {
  if (version === SCHEMA_VERSION) return true;
  return ctx.files.open(file, (sql) => migratePackage(sql, version));
}

/** What the file is, asking SQLite. A file that will not open for a reason
 * other than "not a database" or "malformed" is an error: kept and skipped. */
function probeFile(ctx: RegistryContext, file: string): Probe {
  try {
    return ctx.files.open(file, (sql) => probePackage(sql));
  } catch (error) {
    return isUnreadableDatabase(error) ? { kind: "unreadable" } : { kind: "error", error };
  }
}

async function reconcileFile(ctx: RegistryContext, file: string): Promise<void> {
  const row = bookBy(ctx, "file", file);
  const probe = probeFile(ctx, file);

  if (probe.kind !== "package") {
    // A file that is or may be a book is never deleted: only a provably empty
    // leftover (no tables at all, no row) goes. A damaged one is listed.
    if (probe.kind === "empty" && !row) return ctx.files.remove(file);
    if (row) return setState(ctx, row.key, "unreadable");
    if (probe.kind === "unreadable") insertUnreadable(ctx, file, "unreadable");
    return; // a transient error: skipped, tried again at the next start
  }

  const { version } = probe;
  const state = stateOfVersion(version);
  if (row) {
    if (state !== "ok") return setState(ctx, row.key, state);
    if (row.kind === "loaded" && !bringCurrent(ctx, file, version)) {
      return setState(ctx, row.key, "unreadable");
    }
    const head = ctx.files.open(file, (sql) => readHead(sql, packageVersion(sql) ?? version));
    if (!head) return setState(ctx, row.key, "unreadable");
    if (row.state !== "ok") {
      // It could not be read before, and now it can: index it afresh, unless
      // it is listed under its file name because its key is another book's.
      if (head.key === row.key) await indexPackage(ctx, file, row.kind);
      return;
    }
    const regSources = registrySources(ctx, row.key);
    const merged = union(head.sources, regSources);
    for (const hash of merged) {
      ctx.registry.run("INSERT OR IGNORE INTO source (hash, book_key, added_at) VALUES (?, ?, ?)", [
        hash,
        row.key,
        ctx.now(),
      ]);
    }
    if (merged.length > head.sources.length) mergeIntoPackage(ctx, file, merged);
    return;
  }

  // A package with no row.
  if (state !== "ok") return insertUnreadable(ctx, file, state);
  const head = ctx.files.open(file, (sql) => readHead(sql, version));
  if (!head) return insertUnreadable(ctx, file, "unreadable");
  const kind: BookKind = ctx.shipped.includes(head.key) ? "shipped" : "loaded";
  // Its key is held by another file (a stale copy left by a crashed Replace,
  // say): kept and listed under its file name, never deleted. Files are taken
  // highest <n> first, so the newest is the one that holds the key.
  if (bookBy(ctx, "key", head.key)) return insertUnreadable(ctx, file, "unreadable");
  if (kind === "loaded" && !bringCurrent(ctx, file, version)) {
    return insertUnreadable(ctx, file, "unreadable");
  }
  await indexPackage(ctx, file, kind);
}

/** The `<n>` of `<key>.<n>.sqlite3`; 0 for a file without one. */
const generationOf = (file: string) => Number(/\.(\d+)\.sqlite3$/.exec(file)?.[1] ?? 0);

/**
 * Brings the registry and the pool into step at start (SDD-0004 §6): drops
 * rows whose file is gone, adopts packages with no row (highest `<n>` first,
 * so of two files with one key the newer is kept), keeps what cannot be read
 * as a listed row, merges sources, and turns a shipped book the app no longer
 * bundles into a loaded one. Each file is handled on its own: one that throws
 * is skipped, never stopping the rest.
 */
export async function reconcile(ctx: RegistryContext): Promise<void> {
  const names = ctx.files
    .list()
    .filter(isPackageFile)
    .sort((a, b) => generationOf(b) - generationOf(a) || (a < b ? -1 : 1));
  const present = new Set(names);
  for (const row of listBooks(ctx)) {
    try {
      if (!present.has(row.file)) ctx.registry.run("DELETE FROM book WHERE key = ?", [row.key]);
      else if (row.kind === "shipped" && !ctx.shipped.includes(row.key)) {
        ctx.registry.run("UPDATE book SET kind = 'loaded' WHERE key = ?", [row.key]);
      }
    } catch (error) {
      console.warn(`registry: ${row.key}:`, error);
    }
  }
  for (const file of names) {
    try {
      await reconcileFile(ctx, file);
    } catch (error) {
      console.warn(`registry: ${file} skipped:`, error);
    }
  }
}
