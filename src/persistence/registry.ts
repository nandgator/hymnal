import { SCHEMA_VERSION } from "../../scripts/content-schema.ts";
import type { ContainerBook } from "../domain/container.ts";
import type { HeldBook } from "../domain/duplicates.ts";
import { songHash } from "../domain/hash.ts";
import {
  ASSORTED_ORIGIN,
  ASSORTED_TITLE,
  addSongs,
  asContainerShape,
  isLanguageTag,
  isOwnOrigin,
  isScriptCode,
  mergeSongs,
  OWN_ORIGIN,
  type OwnStatus,
  type OwnTarget,
  ownBook,
  ownStatus,
} from "../domain/own.ts";
import { packageRows } from "../domain/package-rows.ts";
import type { OnLoadProgress } from "../domain/progress.ts";
import type { HymnSource } from "../domain/types.ts";
import { hymnFileName, validateCorpus } from "../domain/validate.ts";
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
/**
 * 3: kind `own` and `next_number` (ADR-0033, SDD-0004 §17). A registry of
 * another version is rebuilt, and reconcile adopts the packages again.
 */
export const REGISTRY_VERSION = 3;

/**
 * SDD-0004 §6, plus `state` (decided in part 3): a package kept but not
 * openable is a row with a state other than `ok`.
 */
export const REGISTRY_SQL = `
CREATE TABLE book (
  key       TEXT PRIMARY KEY,
  origin    TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('shipped','loaded','own')),
  file      TEXT NOT NULL,
  title     TEXT NOT NULL,
  language  TEXT NOT NULL,
  script    TEXT NOT NULL,
  songs     INTEGER NOT NULL,
  next_number INTEGER,
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

/** `own` is a book of yours (ADR-0033): it grows, and the other two are received and fixed. */
export type BookKind = "shipped" | "loaded" | "own";

export interface BookRow {
  key: string;
  origin: string;
  kind: BookKind;
  file: string;
  title: string;
  language: string;
  script: string;
  songs: number;
  /** A book of yours only: the number a song with none takes (at least one past its highest). Null or absent otherwise. */
  nextNumber?: number | null;
  addedAt: number;
  state: PackageState;
}

/** The pool's package files, as the registry sees them. */
export interface PackageFiles {
  list(): string[];
  /** Opens `file` (made if missing), runs `fn`, closes it unless it was already open. */
  open<T>(file: string, fn: (sql: Sql) => T): T;
  /**
   * Makes a new package: `fn` fills a scratch database, and the finished file
   * is installed under `file` in one step, the name taken last. A write that
   * is killed halfway (the page reloads) leaves nothing under `file`, never a
   * torn package (SDD-0004 §6). Throws if `file` exists.
   */
  write(file: string, fn: (sql: Sql) => void): void;
  /** The bytes of a small file (a journal), or null if it is not there or cannot be read. */
  read(file: string): Uint8Array | null;
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
  nextNumber: typeof r.next_number === "number" ? r.next_number : null,
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

/** The `<n>` of `<key>.<n>.sqlite3`; 0 for a file without one. */
const generationOf = (file: string) => Number(/\.(\d+)\.sqlite3$/.exec(file)?.[1] ?? 0);

const isPackageFile = (name: string) => name !== REGISTRY_FILE && !/-(journal|wal|shm)$/.test(name);

function insertBook(
  ctx: RegistryContext,
  row: BookRow,
  sources: readonly string[],
  hashes: ReadonlyMap<number, string>,
  over?: string,
): void {
  const { registry } = ctx;
  transaction(registry, () => {
    // Replacing a row is for the same book's file, or the one a Replace
    // supersedes (`over`); another file's row is never overwritten.
    const held = bookBy(ctx, "key", row.key);
    if (held && held.file !== row.file && held.file !== over) {
      throw new Error(`${row.key} is held by ${held.file}; ${row.file} is not indexed over it`);
    }
    registry.run("DELETE FROM book WHERE key = ?", [row.key]);
    registry.run(
      "INSERT INTO book (key, origin, kind, file, title, language, script, songs, next_number, added_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        row.key,
        row.origin,
        row.kind,
        row.file,
        row.title,
        row.language,
        row.script,
        row.songs,
        row.nextNumber ?? null,
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
    // One parsed statement for every song: a book of thousands is one transaction, one parse.
    const sql = "INSERT INTO song (book_key, number, hash) VALUES (?, ?, ?)";
    const insert = registry.prepare?.(sql);
    try {
      for (const [number, hash] of hashes) {
        if (insert) insert.run([row.key, number, hash]);
        else registry.run(sql, [row.key, number, hash]);
      }
    } finally {
      insert?.finalize();
    }
  });
}

interface ContainerRead {
  sourceHash: string;
  /** A restored book keeps what it had: the container hashes it matched, and its content hash. */
  sources?: readonly string[];
  contentHash?: string;
  book: ContainerBook;
  songHashes: ReadonlyMap<number, string>;
}

/** Writes a container's package to a new file, whole or not at all. */
async function writeNewPackage(
  ctx: RegistryContext,
  file: string,
  key: string,
  read: ContainerRead,
  onProgress?: OnLoadProgress,
): Promise<void> {
  await ctx.files.reserve();
  // Never open over a file that is there: it is another write's, or a kept leftover,
  // and a failed write below removes only the file this call made.
  if (ctx.files.list().includes(file)) throw new Error(`${file} already exists`);
  const { hymnbook, hymns } = read.book;
  const rows = packageRows(hymnbook, hymns, {
    key,
    origin: hymnbook.id,
    sources: read.sources ?? [read.sourceHash],
    contentHash: read.contentHash ?? read.sourceHash,
    schemaVersion: SCHEMA_VERSION,
  });
  // Atomic: a failure, or a kill, leaves nothing under `file`, so there is nothing to remove.
  const total = hymns.length;
  ctx.files.write(file, (sql) =>
    writePackage(
      sql,
      rows,
      onProgress && {
        onSong: (done) => onProgress({ phase: "saving", done, total }),
        onIndex: () => onProgress({ phase: "indexing", done: 0, total: 0 }),
      },
    ),
  );
}

function rowOf(
  ctx: RegistryContext,
  key: string,
  file: string,
  read: ContainerRead,
  addedAt = ctx.now(),
  kind: BookKind = "loaded",
): BookRow {
  const { hymnbook, hymns } = read.book;
  return {
    key,
    origin: hymnbook.id,
    kind,
    file,
    title: hymnbook.title,
    language: hymnbook.language,
    script: hymnbook.script,
    songs: hymns.length,
    nextNumber: kind === "own" ? counter(hymnbook.nextNumber, hymns) : null,
    addedAt,
    state: "ok",
  };
}

/** A book of yours' counter: the larger of its `next_number` and one past its highest song. */
const counter = (next: number | null | undefined, songs: readonly { number: number }[]): number =>
  Math.max(next ?? 1, songs.reduce((max, h) => Math.max(max, h.number), 0) + 1);

/** Registers a written package; if that fails the file goes too, since nothing holds it. */
function commitRow(ctx: RegistryContext, row: BookRow, read: ContainerRead, over?: string) {
  try {
    insertBook(ctx, row, read.sources ?? [read.sourceHash], read.songHashes, over);
  } catch (error) {
    // Not committed: the book is not held, so its file must not linger to be adopted.
    try {
      ctx.files.remove(row.file);
    } catch {
      // reconcile adopts it at the next start if it is still there
    }
    throw error;
  }
}

/** The `<n>` for a package of `key` that no file in the pool has: past every generation of it. */
export function freeGeneration(ctx: RegistryContext, key: string): number {
  return (
    Math.max(
      0,
      ...ctx.files
        .list()
        .filter((f) => isPackageFile(f) && keyOfFile(f) === key)
        .map(generationOf),
    ) + 1
  );
}

/**
 * Writes a loaded book: its package first, then the registry rows, whose
 * transaction is the commit (SDD-0004 §7). A failed package write is removed;
 * a crash between the two leaves a package that reconcile adopts.
 */
export async function addBook(
  ctx: RegistryContext,
  key: string,
  read: ContainerRead,
  n = 1,
  onProgress?: OnLoadProgress,
  /** Restoring a book of yours writes kind `own` (SDD-0004 §17). */
  kind: BookKind = "loaded",
): Promise<BookRow> {
  const file = `/${key}.${n}.sqlite3`;
  await writeNewPackage(ctx, file, key, read, onProgress);
  const row = rowOf(ctx, key, file, read, ctx.now(), kind);
  commitRow(ctx, row, read);
  return row;
}

/**
 * Replace (SDD-0004 §8): the new package is written under the same key as
 * `<key>.<n+1>`, past every generation of that key in the pool; then one
 * registry transaction swaps the row, song rows and source rows, and that is
 * the commit; then the old file goes. A crash before the commit leaves a
 * higher-`<n>` copy that reconcile prefers (§8, decided in part 4); one after
 * it leaves a lower, superseded copy that reconcile lists. The key, and so the
 * recents and positions that name it, never change, nor does `added_at`.
 */
export async function replaceBook(
  ctx: RegistryContext,
  key: string,
  read: ContainerRead,
  /** Restoring a book that cannot be opened (SDD-0004 §9): the user picked its file again. */
  options: { restore?: boolean; onProgress?: OnLoadProgress } = {},
): Promise<BookRow> {
  const old = bookBy(ctx, "key", key);
  if (!old) throw new Error(`${key} is not held`);
  if (old.kind === "shipped") throw new Error(`${key} is a shipped book and is not replaced`);
  if (old.state !== "ok" && !options.restore) {
    throw new Error(`${key} cannot be opened and is not replaced`);
  }
  const n =
    Math.max(
      generationOf(old.file),
      ...ctx.files
        .list()
        .filter((f) => isPackageFile(f) && keyOfFile(f) === key)
        .map(generationOf),
    ) + 1;
  const file = `/${key}.${n}.sqlite3`;
  await writeNewPackage(ctx, file, key, read, options.onProgress);
  const row = rowOf(ctx, key, file, read, old.addedAt, old.kind);
  commitRow(ctx, row, read, old.file);
  try {
    ctx.files.remove(old.file);
  } catch {
    // the row no longer names it; reconcile keeps and lists it
  }
  return row;
}

/**
 * Row 2 of §8: records a container's hash in a book it matched. Two writes in
 * this order: the package's `sources`, then the registry's `source` row; a
 * crash between leaves the package ahead and reconcile copies the hash over.
 */
export function recordSource(ctx: RegistryContext, key: string, hash: string): void {
  const row = bookBy(ctx, "key", key);
  if (row?.state !== "ok") throw new Error(`${key} is not a book that is held and readable`);
  const head = ctx.files.open(row.file, (sql) => {
    const version = packageVersion(sql);
    return version === null ? null : readHead(sql, version);
  });
  mergeIntoPackage(ctx, row.file, union(head?.sources ?? [], [hash]));
  ctx.registry.run("INSERT OR IGNORE INTO source (hash, book_key, added_at) VALUES (?, ?, ?)", [
    hash,
    key,
    ctx.now(),
  ]);
}

// ---- Your books (ADR-0033, SDD-0004 §17) ----

async function hashesOf(hymns: readonly HymnSource[]): Promise<Map<number, string>> {
  return new Map(await Promise.all(hymns.map(async (h) => [h.number, await songHash(h)] as const)));
}

/** The first number each hash is held under. */
function heldBy(hashes: ReadonlyMap<number, string>): Map<string, number> {
  const held = new Map<string, number>();
  for (const [number, hash] of [...hashes].sort((a, b) => a[0] - b[0])) {
    if (!held.has(hash)) held.set(hash, number);
  }
  return held;
}

/** The books of yours this device holds, readable or not. */
export const ownRows = (ctx: RegistryContext): BookRow[] =>
  listBooks(ctx).filter((b) => b.kind === "own");

/** The default book, the one a song goes to when none is chosen: origin `assorted`. */
export const defaultOwnRow = (ctx: RegistryContext): BookRow | undefined =>
  ownRows(ctx).find((b) => b.origin === ASSORTED_ORIGIN);

/** What a book of yours holds now, read from its package. */
interface OwnNow {
  row: BookRow;
  hymns: HymnSource[];
  nextNumber: number | null;
  contentHash: string;
}

/** The book as it is now: null if the device has no such book of yours, "unreadable" if it cannot be written to. */
function readOwn(ctx: RegistryContext, key: string): OwnNow | null | "unreadable" {
  const row = ownRows(ctx).find((b) => b.key === key);
  if (!row) return null;
  if (row.state !== "ok") return "unreadable";
  const read = ctx.files.open(row.file, (sql) => {
    const version = packageVersion(sql);
    if (version !== SCHEMA_VERSION) return null;
    const head = readHead(sql, version);
    return head && { head, hymns: readHymns(sql, version) };
  });
  if (!read) return "unreadable";
  return {
    row,
    // Through JSON, as a container's songs come: a field a package lacks is absent, not undefined.
    hymns: JSON.parse(JSON.stringify(read.hymns)) as HymnSource[],
    nextNumber: read.head.nextNumber,
    contentHash: read.head.contentHash,
  };
}

/** The counter of a book as it is now: the package's, lifted past its highest song and the index's. */
const counterOf = (now: OwnNow): number =>
  Math.max(
    now.nextNumber ?? 1,
    now.row.nextNumber ?? 1,
    now.hymns.reduce((max, h) => Math.max(max, h.number), 0) + 1,
  );

/**
 * What adding a file's songs to each book of yours would do (ADR-0033 §5), for
 * the review: every book of yours, then the default one if the device has none
 * and a new one, neither made yet. `next` is null for a book that cannot be
 * opened. Read from the registry, which is the index of the packages.
 */
export function ownStatuses(
  ctx: RegistryContext,
  hymns: readonly { number: number; title: string }[],
  hashes: ReadonlyMap<number, string>,
): OwnStatus[] {
  const songs = new Map<string, Map<string, number>>();
  for (const r of ctx.registry.all(
    "SELECT book_key, number, hash FROM song WHERE book_key IN (SELECT key FROM book WHERE kind = 'own') ORDER BY number",
  )) {
    const map = songs.get(r.book_key as string) ?? new Map<string, number>();
    if (!map.has(r.hash as string)) map.set(r.hash as string, r.number as number);
    songs.set(r.book_key as string, map);
  }
  const rows = ownRows(ctx);
  const none = new Map<string, number>();
  const list = rows.map((row) =>
    ownStatus(
      row,
      row.state === "ok" ? (row.nextNumber ?? 1) : null,
      songs.get(row.key) ?? none,
      hymns,
      hashes,
    ),
  );
  if (!rows.some((row) => row.origin === ASSORTED_ORIGIN)) {
    const book = { key: null, origin: ASSORTED_ORIGIN, title: ASSORTED_TITLE };
    list.push(ownStatus(book, 1, none, hymns, hashes));
  }
  list.push(ownStatus({ key: null, origin: OWN_ORIGIN, title: "" }, 1, none, hymns, hashes));
  return list;
}

export type AddedToOwn =
  | {
      ok: true;
      key: string;
      /** The numbers the added songs took, in the order given. */
      numbers: number[];
      /** Songs of the file the book held already, which were not added again. */
      already: number;
      created: boolean;
    }
  /** Every song is in the book already; `number` is the first one's there. */
  | { ok: false; reason: "already-here"; key: string; number: number }
  | { ok: false; reason: "invalid"; message: string }
  /** The book cannot be opened: it is not written to. */
  | { ok: false; reason: "unreadable"; key: string };

const firstViolations = (violations: { where: string; message: string }[]) =>
  violations
    .slice(0, 3)
    .map((v) => `${v.where}: ${v.message}`)
    .join("; ");

/**
 * Adds songs (a reviewed file's) to a book of yours, or to a new one
 * (ADR-0033 §4, §5, SDD-0004 §17). A new book, or the default one when the
 * device has none, is written with the songs under their numbers and the
 * counter past the highest. The whole is validated as a load's is, then
 * written as Replace writes (`<key>.<n+1>.sqlite3`, then the registry
 * transaction, the commit). A song whose hash is in the book already is
 * reported, not added again.
 */
export async function addOwnSongs(
  ctx: RegistryContext,
  newKey: () => string,
  target: OwnTarget,
  songs: readonly { hymn: HymnSource; hash: string }[],
  language: string,
  script: string,
  onProgress?: OnLoadProgress,
): Promise<AddedToOwn> {
  const invalid = (message: string): AddedToOwn => ({ ok: false, reason: "invalid", message });
  if (!isLanguageTag(language)) return invalid(`${language} is not a language tag`);
  if (!isScriptCode(script)) return invalid(`${script} is not a script code`);
  if (songs.length === 0) return invalid("there are no songs to add");
  let row: BookRow | undefined;
  let made = { origin: OWN_ORIGIN, title: "" };
  if (target.kind === "new") {
    made.title = target.title.trim();
    if (!made.title) return invalid("Give the book a title.");
  } else if (target.kind === "default") {
    row = defaultOwnRow(ctx);
    made = { origin: ASSORTED_ORIGIN, title: ASSORTED_TITLE };
  } else {
    row = ownRows(ctx).find((b) => b.key === target.key);
    if (!row) return invalid("that is not a book of yours on this device");
  }
  const now = row ? readOwn(ctx, row.key) : null;
  if (now === "unreadable") return { ok: false, reason: "unreadable", key: row?.key ?? "" };
  const title = now?.row.title ?? made.title;
  const origin = now?.row.origin ?? made.origin;
  // Hashed from the package itself, not the registry's copy, which is only an index.
  const songHashes = await hashesOf(now?.hymns ?? []);
  const plan = addSongs(now, heldBy(songHashes), { origin, title }, songs, language, script);
  if (!plan.ok) return invalid(plan.message);
  if (plan.added.length === 0) {
    const [first] = plan.already.values();
    return now && first !== undefined
      ? { ok: false, reason: "already-here", key: now.row.key, number: first }
      : invalid("there are no songs to add");
  }
  const shaped = asContainerShape(plan.book, plan.hymns);
  const violations = validateCorpus(
    shaped.book,
    shaped.hymns.map((hymn) => ({ file: hymnFileName(hymn.number), hymn })),
  );
  if (violations.length > 0) return invalid(firstViolations(violations));
  for (const { number, hash } of plan.added) songHashes.set(number, hash);
  const sourceHash = now?.contentHash ?? plan.added[0]?.hash ?? "";
  const read: ContainerRead = {
    sourceHash,
    sources: [],
    contentHash: sourceHash,
    book: { hymnbook: plan.book, hymns: plan.hymns },
    songHashes,
  };
  const result = { numbers: plan.added.map((a) => a.number), already: plan.already.size };
  if (now) {
    await replaceBook(ctx, now.row.key, read, { onProgress });
    return { ok: true, key: now.row.key, created: false, ...result };
  }
  const key = newKey();
  await writeNewPackage(ctx, `/${key}.1.sqlite3`, key, read, onProgress);
  commitRow(ctx, rowOf(ctx, key, `/${key}.1.sqlite3`, read, ctx.now(), "own"), read);
  return { ok: true, key, created: true, ...result };
}

export type RenamedOwn =
  | { ok: true; key: string; title: string }
  | { ok: false; reason: "invalid" | "unreadable" | "unknown"; message: string };

/**
 * Renames a book of yours (ADR-0033 §1): the package is written afresh under
 * the new title, as a Replace writes it, and the registry row follows in the
 * same commit. The key, the songs and their numbers do not change.
 */
export async function renameOwn(
  ctx: RegistryContext,
  key: string,
  title: string,
  onProgress?: OnLoadProgress,
): Promise<RenamedOwn> {
  const named = title.trim();
  if (!named) return { ok: false, reason: "invalid", message: "Give the book a title." };
  const now = readOwn(ctx, key);
  if (now === null) {
    return { ok: false, reason: "unknown", message: "that is not a book of yours on this device" };
  }
  if (now === "unreadable") {
    const message = "the book cannot be opened, so it is not renamed";
    return { ok: false, reason: "unreadable", message };
  }
  if (now.row.title === named) return { ok: true, key, title: named };
  const book = ownBook(now.row.origin, named, now.hymns.length, counterOf(now));
  const shaped = asContainerShape(book, now.hymns);
  const violations = validateCorpus(
    shaped.book,
    shaped.hymns.map((hymn) => ({ file: hymnFileName(hymn.number), hymn })),
  );
  if (violations.length > 0) {
    return { ok: false, reason: "invalid", message: firstViolations(violations) };
  }
  await replaceBook(
    ctx,
    key,
    {
      sourceHash: now.contentHash,
      sources: [],
      contentHash: now.contentHash,
      book: { hymnbook: book, hymns: now.hymns },
      songHashes: await hashesOf(now.hymns),
    },
    { onProgress },
  );
  return { ok: true, key, title: named };
}

export interface MergedIntoOwn {
  /** The device's book, which keeps its key. */
  key: string;
  /** Backup number to the number the device holds that song under (SDD-0004 §17). */
  numbers: Map<number, number>;
  added: number;
}

/**
 * Merges a backup's book of yours into the device's book `key` (ADR-0033 §6,
 * SDD-0004 §17): each song not there by hash is added, per `mergeSongs`.
 * Written as an add is: the package afresh as `<key>.<n+1>`, then the registry
 * transaction, the commit, so a crash leaves either the old book or the merged
 * one. Nothing is written when every song is there already. Throws if the book
 * cannot be opened or the whole would not validate.
 */
export async function mergeIntoOwn(
  ctx: RegistryContext,
  key: string,
  incoming: { hymns: readonly HymnSource[]; songHashes: ReadonlyMap<number, string> },
  onProgress?: OnLoadProgress,
  /** Only works out the numbers (and how many would be added): nothing is written. */
  dryRun = false,
): Promise<MergedIntoOwn> {
  const now = readOwn(ctx, key);
  if (now === null || now === "unreadable") {
    throw new Error("the device has no book of that key that can be opened to merge into");
  }
  // Hashed from the package itself, not the registry's copy, which is only an index.
  const deviceHashes = await hashesOf(now.hymns);
  const plan = mergeSongs(now, deviceHashes, incoming.hymns, incoming.songHashes);
  if (plan.added === 0 || dryRun) return { key, numbers: plan.numbers, added: plan.added };
  const book = ownBook(now.row.origin, now.row.title, plan.hymns.length, plan.nextNumber);
  const shaped = asContainerShape(book, plan.hymns);
  const violations = validateCorpus(
    shaped.book,
    shaped.hymns.map((hymn) => ({ file: hymnFileName(hymn.number), hymn })),
  );
  if (violations.length > 0) {
    throw new Error(`the merged book would not be valid: ${firstViolations(violations)}`);
  }
  const songHashes = new Map(deviceHashes);
  for (const [backupNumber, number] of plan.numbers) {
    const hash = incoming.songHashes.get(backupNumber);
    if (hash !== undefined && !songHashes.has(number)) songHashes.set(number, hash);
  }
  await replaceBook(
    ctx,
    key,
    {
      sourceHash: now.contentHash,
      sources: [],
      contentHash: now.contentHash,
      book: { hymnbook: book, hymns: plan.hymns },
      songHashes,
    },
    { onProgress },
  );
  return { key, numbers: plan.numbers, added: plan.added };
}

export type RemovedFromOwn =
  | { removed: false }
  | { removed: true; key: string; bookRemoved: boolean };

/**
 * Removes one song from a book of yours by number: the package is written
 * afresh without it and `next_number` stays, so the number is retired. The
 * last song takes the book with it, as removing a book does (SDD-0004 §17).
 */
export async function removeOwnSong(
  ctx: RegistryContext,
  key: string,
  number: number,
  onProgress?: OnLoadProgress,
): Promise<RemovedFromOwn> {
  const now = readOwn(ctx, key);
  if (now === "unreadable") {
    throw new Error("the book cannot be opened, so no song is removed from it");
  }
  if (!now?.hymns.some((h) => h.number === number)) return { removed: false };
  const left = now.hymns.filter((h) => h.number !== number);
  if (left.length === 0) {
    removeBook(ctx, key);
    return { removed: true, key, bookRemoved: true };
  }
  const book = ownBook(now.row.origin, now.row.title, left.length, counterOf(now));
  await replaceBook(
    ctx,
    key,
    {
      sourceHash: now.contentHash,
      sources: [],
      contentHash: now.contentHash,
      book: { hymnbook: book, hymns: left },
      songHashes: await hashesOf(left),
    },
    { onProgress },
  );
  return { removed: true, key, bookRemoved: false };
}

/** Every readable book with its sources and song hashes, for the verdict (§8). */
export function heldBooks(ctx: RegistryContext): HeldBook[] {
  const sources = new Map<string, string[]>();
  for (const r of ctx.registry.all("SELECT book_key, hash FROM source ORDER BY added_at, hash")) {
    const list = sources.get(r.book_key as string) ?? [];
    list.push(r.hash as string);
    sources.set(r.book_key as string, list);
  }
  const songs = new Map<string, Map<number, string>>();
  for (const r of ctx.registry.all("SELECT book_key, number, hash FROM song")) {
    const map = songs.get(r.book_key as string) ?? new Map<number, string>();
    map.set(r.number as number, r.hash as string);
    songs.set(r.book_key as string, map);
  }
  return listBooks(ctx).map((b) => ({
    key: b.key,
    title: b.title,
    origin: b.origin,
    kind: b.kind,
    state: b.state,
    sources: sources.get(b.key) ?? [],
    songs: songs.get(b.key) ?? new Map(),
  }));
}

/**
 * Removes a loaded book: the file first (closing any open connection to it),
 * so a crash leaves a row reconcile drops, not a file it adopts. A shipped
 * book is refused (SDD-0004 §9).
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
  over?: string,
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
  if (held && held.file !== file && held.file !== over) return null; // another file's book: not indexed over it
  // A Replace's sources are the new file's alone; the superseded book's go with its rows.
  const sources = union(head.sources, held && !over ? registrySources(ctx, head.key) : []);
  const row: BookRow = {
    key: head.key,
    origin: head.origin,
    kind,
    file,
    title: head.title,
    language: head.language,
    script: head.script,
    songs: head.songs,
    nextNumber:
      kind === "own"
        ? counter(
            head.nextNumber,
            [...hashes.keys()].map((number) => ({ number })),
          )
        : null,
    addedAt: held?.addedAt ?? ctx.now(),
    state: "ok",
  };
  insertBook(ctx, row, sources, hashes, over);
  if (sources.length > head.sources.length) mergeIntoPackage(ctx, file, sources);
  return row;
}

/**
 * A book that opens is registered if its row is missing or not `ok`
 * (SDD-0004 §13, part 3).
 */
export async function registerHeld(ctx: RegistryContext, file: string): Promise<void> {
  const row = listBooks(ctx).find((book) => book.file === file);
  if (row?.state !== "ok") await indexPackage(ctx, file, row?.kind ?? "loaded");
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
      nextNumber: null,
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

/**
 * True when `file` (a readable package with no row, its key held) is a Replace
 * that finished writing but was never committed: the book is loaded and
 * readable, its file is a lower <n> that still exists, and both read as the
 * same origin.
 */
async function finishedReplace(
  ctx: RegistryContext,
  file: string,
  version: number,
  head: { origin: string },
  held: BookRow,
): Promise<boolean> {
  if (held.kind === "shipped" || held.state !== "ok") return false;
  if (generationOf(file) <= generationOf(held.file)) return false;
  if (!ctx.files.list().includes(held.file)) return false;
  if (stateOfVersion(version) !== "ok") return false;
  const current = ctx.files.open(held.file, (sql) => {
    const v = packageVersion(sql);
    return v === null ? null : readHead(sql, v);
  });
  return current !== null && current.origin === head.origin;
}

/**
 * True when `file`, a readable package with no row, is provably a superseded
 * copy of the book the row holds: the row's file is a higher <n>, still there,
 * a readable package of the same key and origin. Only then is it deleted
 * (SDD-0004 §6, decided in part 4).
 */
function isSuperseded(
  ctx: RegistryContext,
  file: string,
  version: number,
  head: { key: string; origin: string },
  held: BookRow,
): boolean {
  if (held.state !== "ok" || held.key !== head.key) return false;
  if (generationOf(held.file) <= generationOf(file)) return false;
  if (stateOfVersion(version) !== "ok" || !ctx.files.list().includes(held.file)) return false;
  const current = ctx.files.open(held.file, (sql) => {
    const v = packageVersion(sql);
    return v === null ? null : readHead(sql, v);
  });
  return (
    current !== null &&
    current.key === head.key &&
    current.origin === head.origin &&
    current.songs > 0 &&
    current.songs === held.songs
  );
}

async function reconcileFile(ctx: RegistryContext, file: string): Promise<void> {
  const row = bookBy(ctx, "file", file);
  const probe = probeFile(ctx, file);

  if (probe.kind !== "package") {
    // A file that is or may be a book is never deleted: only a provably empty
    // leftover (no tables at all, no row) goes. A damaged one is listed.
    if (probe.kind === "empty" && !row) return removeLeftover(ctx, file);
    if (row) return setState(ctx, row.key, "unreadable");
    // A write killed halfway leaves a torn file and its hot journal, which no
    // reader can roll back (SQLite spills pages of a new file past the journal).
    // The pair is provably an aborted first write, never a book: removed.
    if (probe.kind === "unreadable" && isAbortedFirstWrite(ctx, file)) {
      return removeLeftover(ctx, file);
    }
    if (probe.kind === "unreadable") insertUnreadable(ctx, file, "unreadable");
    return; // a transient error: skipped, tried again at the next start
  }

  const { version } = probe;
  const state = stateOfVersion(version);
  if (row) {
    if (state !== "ok") return setState(ctx, row.key, state);
    if (row.kind !== "shipped" && !bringCurrent(ctx, file, version)) {
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
  const kind: BookKind = ctx.shipped.includes(head.key)
    ? "shipped"
    : isOwnOrigin(head.origin)
      ? "own"
      : "loaded";
  // Its key is held by another file. A Replace that crashed between writing
  // `<key>.<n+1>` and the row's commit left this copy: if the row's file is a
  // lower <n> and both read as the same origin, this one is the finished
  // Replace and takes the row (SDD-0004 §8, decided in part 4); the old file
  // is then a stale copy. Any other copy is kept and listed under its file
  // name, never deleted. Files are taken highest <n> first.
  const held = bookBy(ctx, "key", head.key);
  if (held) {
    if (await finishedReplace(ctx, file, version, head, held)) {
      const oldFile = held.file;
      if (!(await indexPackage(ctx, file, held.kind, oldFile))) {
        return insertUnreadable(ctx, file, "unreadable");
      }
      // The old file was read as the same book and origin: provably superseded.
      try {
        ctx.files.remove(oldFile);
      } catch {
        // kept; it is listed at the next start
      }
      return;
    }
    if (isSuperseded(ctx, file, version, head, held)) return ctx.files.remove(file);
    return insertUnreadable(ctx, file, "unreadable");
  }
  if (kind !== "shipped" && !bringCurrent(ctx, file, version)) {
    return insertUnreadable(ctx, file, "unreadable");
  }
  await indexPackage(ctx, file, kind);
}

const JOURNAL_MAGIC = [0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7];

/**
 * True when `journal` is a rollback journal whose header says the database
 * had no pages when the transaction began (SQLite file format §4: the 8-byte
 * magic, then at offset 16 the initial size in pages, big-endian). Only the
 * first write of a file starts there; a crashed UPDATE or migration of a book
 * that exists has a size above zero, and a short or foreign journal proves
 * nothing.
 */
export function journalProvesFirstWrite(bytes: Uint8Array | null): boolean {
  if (!bytes || bytes.length < 20) return false;
  if (!JOURNAL_MAGIC.every((b, i) => bytes[i] === b)) return false;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16) === 0;
}

function isAbortedFirstWrite(ctx: RegistryContext, file: string): boolean {
  const journal = `${file}-journal`;
  return ctx.files.list().includes(journal) && journalProvesFirstWrite(ctx.files.read(journal));
}

/** Removes a package file and the journal beside it, if any. */
function removeLeftover(ctx: RegistryContext, file: string): void {
  const journal = `${file}-journal`;
  ctx.files.remove(file);
  try {
    if (ctx.files.list().includes(journal)) ctx.files.remove(journal);
  } catch (error) {
    console.warn(`registry: ${journal}:`, error);
  }
}

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
  // A journal with no file beside it is what an aborted write left: nothing to roll back.
  for (const name of ctx.files.list()) {
    if (!name.endsWith("-journal") || name === `${REGISTRY_FILE}-journal`) continue;
    if (present.has(name.slice(0, -"-journal".length))) continue;
    try {
      ctx.files.remove(name);
    } catch (error) {
      console.warn(`registry: ${name}:`, error);
    }
  }
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
    // A file can go while others are handled, and opening it would make it again.
    if (!ctx.files.list().includes(file)) continue;
    try {
      await reconcileFile(ctx, file);
    } catch (error) {
      console.warn(`registry: ${file} skipped:`, error);
    }
  }
}
