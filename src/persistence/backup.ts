import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { Zip, ZipDeflate } from "fflate";
import { SCHEMA_SQL, SCHEMA_V2_SQL, SCHEMA_VERSION } from "../../scripts/content-schema.ts";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type BackupBookEntry,
  type BackupManifest,
  type BackupRefusal,
  type BackupVerdict,
  backupVerdict,
  bookFileOf,
  MANIFEST_ENTRY,
  MAX_BACKUP_BYTES,
  MAX_BOOK_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_USER_STATE_BYTES,
  openBackup,
  readEntry,
  SHA256_HEX,
  sameBackupVerdict,
  USER_STATE_ENTRY,
  type ZipEntry,
} from "../domain/backup.ts";
import { type ContainerBook, hashSongs } from "../domain/container.ts";
import { sha256Hex } from "../domain/hash.ts";
import { type OnLoadProgress, throttled } from "../domain/progress.ts";
import type { HymnbookSource, HymnSource } from "../domain/types.ts";
import { CONTENT_FORMAT, hymnFileName, validateCorpus } from "../domain/validate.ts";
import {
  isUnreadableDatabase,
  migratePackage,
  packageVersion,
  readHead,
  readHymns,
  type Sql,
  stateOfVersion,
} from "./package-io.ts";
import { type PoolFiles, sqlOf } from "./pool-files.ts";
import {
  addBook,
  freeGeneration,
  heldBooks,
  listBooks,
  type RegistryContext,
  replaceBook,
} from "./registry.ts";

/**
 * Backup and restore, the engine (SDD-0006): the file is written from the pool,
 * and read back only through a rebuild, so a restored book is exactly as safe
 * as a loaded one. No step makes a request (SDD-0004 §11).
 */

// ---- writing (§1, §2) ----

/** A book a backup leaves out, and why: a shipped book is put back by the app itself. */
export interface SkippedBook {
  key: string;
  title: string;
  reason: "shipped" | "needs-reloading" | "needs-newer-app" | "unreadable" | "too-large";
}

export interface BackupFile {
  ok: true;
  bytes: Uint8Array;
  /** `Hymnal backup 2026-10-06.hymnal`, the local date. */
  filename: string;
  skipped: SkippedBook[];
}

/** Held books that together pass what a restore will read (2 GB inflated): no file is made. */
export interface BackupTooLarge {
  ok: false;
  reason: "too-large";
  message: string;
}

const SQLITE_MAGIC = "SQLite format 3\0";
function startsWithMagic(bytes: Uint8Array): boolean {
  if (bytes.length < SQLITE_MAGIC.length) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const backupFilename = (date: Date) =>
  `Hymnal backup ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.hymnal`;

/**
 * Builds the backup of every held book that can be opened, with the user-state
 * document the page passes in (already cleaned: see `backupDoc`). A book's
 * bytes are its package exactly as the pool holds it, read one at a time and
 * added to the zip before the next, so the whole set is never in memory
 * uncompressed. Shipped books and books that cannot be opened are left out and
 * named in `skipped`.
 */
export async function writeBackup(
  ctx: RegistryContext,
  files: Pick<PoolFiles, "pool" | "close">,
  userState: unknown,
  options: {
    build: string;
    now?: () => Date;
    onProgress?: OnLoadProgress;
    /** The reader's ceilings, which a test lowers. */
    limits?: { book?: number; total?: number };
  } = { build: "" },
): Promise<BackupFile | BackupTooLarge> {
  const now = options.now?.() ?? new Date();
  const report = throttled(options.onProgress);
  const skipped: SkippedBook[] = [];
  const chunks: Uint8Array[] = [];
  let failure: Error | undefined;
  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else chunks.push(chunk);
  });
  const add = (name: string, data: Uint8Array) => {
    const entry = new ZipDeflate(name, { level: 6 });
    zip.add(entry);
    entry.push(data, true);
  };

  const manifestBooks: BackupBookEntry[] = [];
  const wanted = listBooks(ctx).filter((row) => {
    if (row.kind === "shipped" || ctx.shipped.includes(row.key)) {
      skipped.push({ key: row.key, title: row.title, reason: "shipped" });
      return false;
    }
    if (row.state !== "ok") {
      skipped.push({ key: row.key, title: row.title, reason: row.state });
      return false;
    }
    return true;
  });
  report?.({ phase: "packing", done: 0, total: wanted.length });
  // What a restore will read, declared sizes together: the manifest and the user state have a share.
  const bookLimit = options.limits?.book ?? MAX_BOOK_BYTES;
  const totalLimit = options.limits?.total ?? MAX_BACKUP_BYTES;
  let declared = MAX_MANIFEST_BYTES + MAX_USER_STATE_BYTES;
  for (const [i, listed] of wanted.entries()) {
    // The books are read one at a time and a book may be removed or replaced
    // meanwhile: the registry's row now is the one to read.
    const row = listBooks(ctx).find((b) => b.key === listed.key);
    if (!row) continue; // removed: it is not held, so it is not left out either
    let bytes: Uint8Array | undefined;
    try {
      if (row.state === "ok" && ctx.files.list().includes(row.file)) {
        // A connection open to the book is let go first: the export is of the file, whole.
        files.close(row.file);
        bytes = (await files.pool.exportFile(row.file)) as Uint8Array;
      }
    } catch {
      bytes = undefined;
    }
    if (!bytes || !startsWithMagic(bytes)) {
      if (listBooks(ctx).some((b) => b.key === row.key)) {
        skipped.push({ key: row.key, title: row.title, reason: "unreadable" });
      }
      continue;
    }
    // The reader's own rules: a book of 512 MB is refused there, so it is left out here.
    if (bytes.length >= bookLimit) {
      skipped.push({ key: row.key, title: row.title, reason: "too-large" });
      continue;
    }
    declared += bytes.length;
    if (declared > totalLimit) {
      return {
        ok: false,
        reason: "too-large",
        message: "the books held are more than a backup can carry (2 GB)",
      };
    }
    const file = bookFileOf(row.key);
    manifestBooks.push({
      key: row.key,
      title: row.title,
      songs: row.songs,
      file,
      sha256: await sha256Hex(bytes),
    });
    add(file, bytes);
    report?.({ phase: "packing", done: i + 1, total: wanted.length });
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created: now.toISOString(),
    build: options.build,
    books: manifestBooks,
  };
  const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));
  add(MANIFEST_ENTRY, text(manifest));
  add(USER_STATE_ENTRY, text(userState ?? null));
  zip.end();
  if (failure) throw failure;
  let size = 0;
  for (const chunk of chunks) size += chunk.length;
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  // The pieces are let go now: the file is the one copy that is left.
  chunks.length = 0;
  return { ok: true, bytes, filename: backupFilename(now), skipped };
}

// ---- rebuilding one book (§3.4) ----

/** A book matches few container files; a package that lists more is not believed past this. */
const MAX_SOURCES = 64;

/** One of the schemas the app has written: every `sqlite_master` row, as a string, sorted. */
interface Family {
  /** The `schema_version` a package of this schema holds. */
  version: number;
  rows: string[];
}

/** What `sqlite_master` holds, with whether each row has pages (a virtual table, a view, a trigger have none). */
const schemaRows = (sql: Sql): string[] =>
  sql
    .all("SELECT type, name, tbl_name, rootpage > 0 AS paged, sql FROM sqlite_master")
    .map((r) => JSON.stringify([r.type, r.name, r.tbl_name, r.paged, r.sql]))
    .sort();

const families = new WeakMap<Sqlite3Static, Family[]>();

/**
 * The schemas a package may have, made by running the app's own DDL (SQLite
 * writes the rows' text itself): the current one; version 2; and version 2 as
 * `PACKAGE_MIGRATIONS` leaves it, which is what a book migrated in place holds.
 */
function schemaFamilies(sqlite3: Sqlite3Static): Family[] {
  let made = families.get(sqlite3);
  if (!made) {
    const build = (ddl: string, migrate: boolean, version: number): Family => {
      const db = new sqlite3.oo1.DB(":memory:");
      try {
        db.exec(ddl);
        const sql = sqlOf(db);
        if (migrate && !migratePackage(sql, 2))
          throw new Error("the canonical schema did not migrate");
        return { version, rows: schemaRows(sql) };
      } finally {
        db.close();
      }
    };
    made = [
      build(SCHEMA_SQL, false, SCHEMA_VERSION),
      build(SCHEMA_V2_SQL, true, SCHEMA_VERSION),
      build(SCHEMA_V2_SQL, false, 2),
    ];
    families.set(sqlite3, made);
  }
  return made;
}

/**
 * The schema of an untrusted package, judged against the schemas the app
 * writes and by nothing it says about itself: SQLite parses a row's `sql`, not
 * its `type`, so every row must equal a canonical one in type, name, table,
 * paged-or-not and exact text, and there must be no more and no fewer. That
 * takes in every column, default, check, generated column and index, and
 * `hymn_fts`'s options; a trigger, a view, another table or a changed
 * definition is a difference. Returns the family it is, or null.
 */
export function matchSchema(sql: Sql, canon: readonly Family[]): Family | null {
  const rows = schemaRows(sql);
  return (
    canon.find(
      (family) => family.rows.length === rows.length && family.rows.every((r, i) => r === rows[i]),
    ) ?? null
  );
}

/** A book read back out of a package, as a load's read is, plus what the backup kept of it. */
export interface RestoredBook {
  sourceHash: string;
  /** The container hashes the book had matched, and its content hash, kept as they were. */
  sources: string[];
  contentHash: string;
  book: ContainerBook;
  songHashes: Map<number, string>;
}

export type RebuildResult =
  | { ok: true; read: RestoredBook }
  | {
      ok: false;
      /** `unsafe`: a schema or a page it must not have; `invalid`: songs a load would reject. */
      reason: "damaged" | "unsafe" | "invalid" | "needs-newer-app" | "too-old";
      message: string;
    };

const fail = (
  reason: Extract<RebuildResult, { ok: false }>["reason"],
  message: string,
): RebuildResult => ({ reason, message, ok: false });

/** Everything a package row may say that a rebuild does not take on trust. */
const optionalText = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * Step 4 of §3: a package is never copied into the pool. Its bytes are opened
 * in a scratch in-memory database that trusts nothing in the file (no
 * `trusted_schema`, no triggers or views, SQLite's defensive flag on); its
 * schema is checked, then `PRAGMA integrity_check`; an older version is
 * migrated in the scratch, as a load's path does; its rows are read back and
 * `validateCorpus` runs on them as for a load. The caller writes the book
 * fresh with `packageRows`, the one builder. Never throws.
 */
export async function rebuildPackage(
  sqlite3: Sqlite3Static,
  bytes: Uint8Array,
  onProgress?: OnLoadProgress,
): Promise<RebuildResult> {
  onProgress?.({ phase: "reading", done: 0, total: 0 });
  if (!startsWithMagic(bytes)) return fail("damaged", "it is not a SQLite database");
  const { capi, wasm, oo1 } = sqlite3;
  let db: InstanceType<typeof oo1.DB> | undefined;
  try {
    db = new oo1.DB(":memory:");
    const pointer = db.pointer as number;
    // Before the file is read: nothing in it is trusted to run, or to be written to.
    for (const op of [
      capi.SQLITE_DBCONFIG_DEFENSIVE,
      capi.SQLITE_DBCONFIG_TRUSTED_SCHEMA,
      capi.SQLITE_DBCONFIG_ENABLE_TRIGGER,
      capi.SQLITE_DBCONFIG_ENABLE_VIEW,
    ]) {
      const on = op === capi.SQLITE_DBCONFIG_DEFENSIVE ? 1 : 0;
      if (capi.sqlite3_db_config(pointer, op, on, 0) !== 0) {
        return fail("unsafe", "SQLite would not be set to read it safely");
      }
    }
    // The database takes the copy and frees it on close.
    const copy = wasm.allocFromTypedArray(bytes);
    const rc = capi.sqlite3_deserialize(
      pointer,
      "main",
      copy,
      bytes.length,
      bytes.length,
      capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE,
    );
    if (rc !== 0) return fail("damaged", `SQLite could not open it (code ${rc})`);
    const sql = sqlOf(db);
    sql.exec("PRAGMA trusted_schema = OFF");

    const family = matchSchema(sql, schemaFamilies(sqlite3));
    if (!family) {
      return fail("unsafe", "its schema is not one this app writes (or is a newer app's)");
    }
    const [check, ...more] = sql.all("PRAGMA integrity_check");
    if (more.length > 0 || check?.integrity_check !== "ok") {
      return fail("damaged", "SQLite's integrity check failed");
    }

    const version = packageVersion(sql);
    if (version === null) return fail("damaged", "it has no readable version");
    const state = stateOfVersion(version);
    if (state === "needs-newer-app") {
      return fail(
        "needs-newer-app",
        `it needs a newer app: it is version ${version}; this app reads version ${SCHEMA_VERSION}`,
      );
    }
    if (state === "needs-reloading") {
      return fail("too-old", `it is version ${version}, too old to bring up to date`);
    }
    if (version !== family.version) {
      return fail(
        "damaged",
        `it says version ${version} but has the schema of version ${family.version}`,
      );
    }
    if (version !== SCHEMA_VERSION && !migratePackage(sql, version)) {
      return fail("damaged", `it could not be brought up from version ${version}`);
    }
    return await readBack(sql, onProgress);
  } catch (error) {
    return fail(
      "damaged",
      isUnreadableDatabase(error) ? "it is damaged" : "it could not be read as a package",
    );
  } finally {
    try {
      db?.close();
    } catch {
      // nothing more is held
    }
  }
}

/** The rows of a current-version scratch database, validated, hashed and ready for `packageRows`. */
async function readBack(sql: Sql, onProgress?: OnLoadProgress): Promise<RebuildResult> {
  const [count] = sql.all("SELECT COUNT(*) AS n FROM hymnbook");
  if (count?.n !== 1) return fail("damaged", "it does not hold exactly one book");
  const head = readHead(sql, SCHEMA_VERSION);
  const [extra] = sql.all("SELECT publisher, edition, isbn FROM hymnbook");
  if (!head || !extra) return fail("damaged", "it has no readable book");
  // Both come from the file and go back into the registry: a hash, or nothing.
  if (!SHA256_HEX.test(head.contentHash)) return fail("invalid", "its content hash is not a hash");
  const sources = [...new Set(head.sources.filter((h) => SHA256_HEX.test(h)))].slice(
    0,
    MAX_SOURCES,
  );
  // Through JSON, as a container's songs come: a field a package lacks is absent, not undefined.
  const hymns = JSON.parse(JSON.stringify(readHymns(sql, SCHEMA_VERSION))) as HymnSource[];
  const hymnbook: HymnbookSource = {
    format: CONTENT_FORMAT,
    id: head.origin,
    title: head.title,
    language: head.language,
    script: head.script,
    ...(optionalText(extra.publisher) === undefined
      ? {}
      : { publisher: optionalText(extra.publisher) }),
    ...(optionalText(extra.edition) === undefined ? {} : { edition: optionalText(extra.edition) }),
    ...(optionalText(extra.isbn) === undefined ? {} : { isbn: optionalText(extra.isbn) }),
    hymnCount: hymns.length,
  };
  const violations = validateCorpus(
    hymnbook,
    hymns.map((hymn) => ({ file: hymnFileName(hymn.number), hymn })),
    onProgress && ((done, total) => onProgress({ phase: "checking", done, total })),
  );
  if (violations.length > 0) {
    const first = violations
      .slice(0, 3)
      .map((v) => `${v.where}: ${v.message}`)
      .join("; ");
    return fail("invalid", `${violations.length} things a load would reject: ${first}`);
  }
  const songHashes = await hashSongs(hymns, onProgress);
  return {
    ok: true,
    read: {
      sourceHash: sources[0] ?? head.contentHash,
      sources,
      contentHash: head.contentHash,
      book: { hymnbook, hymns },
      songHashes,
    },
  };
}

// ---- the review and the commit (§4) ----

export interface BackupReviewBook {
  key: string;
  title: string;
  songs: number;
  verdict: BackupVerdict;
}

/** An entry that will not be restored, and why: the rest of the backup is not held up by it. */
export interface BackupProblem {
  /** The book's key, or the entry's name when it is not a book. */
  name: string;
  title?: string;
  reason: "damaged" | "unsafe" | "invalid" | "needs-newer-app" | "too-old";
  message: string;
}

export type BackupReview =
  | { ok: false; refusal: BackupRefusal }
  | {
      ok: true;
      /** Names the pending review; empty when it was overtaken by a later one. */
      token: string;
      created: string;
      build: string;
      books: BackupReviewBook[];
      problems: BackupProblem[];
      /** The backup holds a user-state document that was read. */
      hasUserState: boolean;
    };

/** What the user chose for a conflict; a book not named keeps this device's. */
export type RestoreChoices = Readonly<Record<string, "keep" | "replace">>;

export interface BackupBookResult {
  key: string;
  title: string;
  outcome: "restored" | "replaced" | "kept" | "already-here" | "already-here-as" | "failed";
  /** Why, for a failure. */
  message?: string;
}

export type BackupCommit =
  | { ok: false; reason: "no-review" | "failed"; message: string }
  | {
      ok: true;
      books: BackupBookResult[];
      /** The keys of every book the device holds now, for the user-state merge. */
      held: string[];
      /** The backup's user-state document as read, not yet cleaned: see `UserStateHandle.restore`. */
      userState?: unknown;
      /** No loaded book was held before: the page asks for persistent storage (SDD-0004 §9). */
      firstLoad?: true;
    };

/** What the review keeps of a book: not its rows, which are rebuilt at the commit. */
interface PendingBook {
  entry: BackupBookEntry;
  title: string;
  verdict: BackupVerdict;
}

/** The zip is kept, with what the review decided; each book is read and rebuilt again at the commit. */
interface Pending {
  token: string;
  bytes: Uint8Array;
  entries: ReadonlyMap<string, ZipEntry>;
  books: PendingBook[];
  userState: unknown;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Review, commit and cancel, as a load's session does: one review is pending at
 * a time and a second replaces it; nothing is written until `commit`, which
 * judges every book again against the registry as it is then. The review holds
 * the file's bytes and the verdicts, not the books' rows: a book is rebuilt
 * when it is written, so a large backup is not held twice.
 */
export class BackupSession {
  #pending: Pending | undefined;
  #generation = 0;
  #tail: Promise<unknown> = Promise.resolve();
  readonly #registry: () => Promise<RegistryContext>;
  readonly #sqlite3: () => Promise<Sqlite3Static>;
  readonly #newToken: () => string;

  constructor(
    registry: () => Promise<RegistryContext>,
    sqlite3: () => Promise<Sqlite3Static>,
    newToken: () => string = () => crypto.randomUUID(),
  ) {
    this.#registry = registry;
    this.#sqlite3 = sqlite3;
    this.#newToken = newToken;
  }

  /**
   * Reads a backup (§3) and says what restoring each book would do (§4);
   * writes nothing. Never throws: a store that cannot be asked is a refusal.
   */
  async review(bytes: Uint8Array, onProgress?: OnLoadProgress): Promise<BackupReview> {
    const generation = ++this.#generation;
    this.#pending = undefined;
    try {
      return await this.#review(bytes, generation, throttled(onProgress));
    } catch (error) {
      return { ok: false, refusal: { reason: "unavailable", message: messageOf(error) } };
    }
  }

  /** One book of the zip, inflated and rebuilt (§3.3, §3.4); its bytes are let go on return. */
  async #rebuild(
    sqlite3: Sqlite3Static,
    bytes: Uint8Array,
    entries: ReadonlyMap<string, ZipEntry>,
    entry: BackupBookEntry,
    report?: OnLoadProgress,
  ): Promise<RebuildResult> {
    const zipEntry = entries.get(entry.file);
    if (!zipEntry) return { ok: false, reason: "damaged", message: `${entry.file} is missing` };
    const read = await readEntry(bytes, zipEntry, MAX_BOOK_BYTES, entry.sha256);
    if (!read.ok) return { ok: false, reason: "damaged", message: read.message };
    return rebuildPackage(sqlite3, read.data, report);
  }

  async #review(
    bytes: Uint8Array,
    generation: number,
    report?: OnLoadProgress,
  ): Promise<BackupReview> {
    report?.({ phase: "reading", done: 0, total: 0 });
    const ctx = await this.#registry();
    const sqlite3 = await this.#sqlite3();
    const opened = await openBackup(bytes);
    if (!opened.ok) return { ok: false, refusal: opened.refusal };
    const { manifest, entries } = opened;

    const problems: BackupProblem[] = [];
    let userState: unknown;
    let hasUserState = false;
    const stateEntry = entries.get(USER_STATE_ENTRY);
    if (stateEntry) {
      const read = await readEntry(bytes, stateEntry, MAX_USER_STATE_BYTES);
      try {
        if (!read.ok) throw new Error(read.message);
        userState = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.data));
        hasUserState = true;
      } catch (error) {
        // The settings are lost to this restore, the books are not.
        problems.push({
          name: USER_STATE_ENTRY,
          reason: "damaged",
          message: read.ok ? "it is not JSON" : messageOf(error),
        });
      }
    }

    const held = heldBooks(ctx);
    const books: PendingBook[] = [];
    const reviewed: BackupReviewBook[] = [];
    for (const entry of manifest.books) {
      const problem = (reason: BackupProblem["reason"], message: string) =>
        problems.push({ name: entry.key, title: entry.title, reason, message });
      if (ctx.shipped.includes(entry.key)) {
        problem("invalid", "a shipped book is put back by the app, not restored");
        continue;
      }
      // Only this book is inflated, and its rows are let go once the verdict is made.
      const rebuilt = await this.#rebuild(sqlite3, bytes, entries, entry, report);
      if (!rebuilt.ok) {
        problem(rebuilt.reason, rebuilt.message);
        continue;
      }
      const { read } = rebuilt;
      const verdict = backupVerdict(
        {
          key: entry.key,
          origin: read.book.hymnbook.id,
          sources: read.sources,
          songs: read.songHashes,
        },
        held,
      );
      const title = read.book.hymnbook.title;
      books.push({ entry, title, verdict });
      reviewed.push({ key: entry.key, title, songs: read.book.hymns.length, verdict });
    }

    // A review that was overtaken is shown but not kept: its token is empty.
    const token = generation === this.#generation ? this.#newToken() : "";
    if (token) {
      this.#pending = {
        token,
        bytes,
        entries,
        books,
        userState: hasUserState ? userState : undefined,
      };
    }
    return {
      ok: true,
      token,
      created: manifest.created,
      build: manifest.build,
      books: reviewed,
      problems,
      hasUserState,
    };
  }

  /** Throws away any pending review (the store is being let go). Nothing is written. */
  discard(): void {
    this.#generation++;
    this.#pending = undefined;
  }

  cancel(token: string): boolean {
    if (this.#pending?.token !== token) return false;
    this.#pending = undefined;
    return true;
  }

  /**
   * Writes the books (§4), one after another, through the load path's own
   * writers. One that fails is reported and the rest go on. The review is taken
   * before the first await, so a second commit of one token finds none.
   */
  commit(
    token: string,
    choices: RestoreChoices = {},
    onProgress?: OnLoadProgress,
  ): Promise<BackupCommit> {
    const pending = this.#pending;
    if (!pending || pending.token !== token) {
      return Promise.resolve({
        ok: false,
        reason: "no-review",
        message: "no review is pending under that token (or it is being committed)",
      });
    }
    this.#pending = undefined;
    const run = this.#tail
      .then(() => this.#commit(pending, choices, throttled(onProgress)))
      .catch((error): BackupCommit => ({ ok: false, reason: "failed", message: messageOf(error) }));
    this.#tail = run;
    return run;
  }

  async #commit(
    pending: Pending,
    choices: RestoreChoices,
    report?: OnLoadProgress,
  ): Promise<BackupCommit> {
    const ctx = await this.#registry();
    const sqlite3 = await this.#sqlite3();
    const firstLoad = !listBooks(ctx).some((b) => b.kind === "loaded");
    const results: BackupBookResult[] = [];
    for (const { entry, title, verdict } of pending.books) {
      const done = (outcome: BackupBookResult["outcome"], message?: string) =>
        results.push({ key: entry.key, title, outcome, ...(message ? { message } : {}) });
      try {
        // Rebuilt again, as at the review: the zip is checked each time it is read.
        const rebuilt = await this.#rebuild(sqlite3, pending.bytes, pending.entries, entry, report);
        if (!rebuilt.ok) {
          done("failed", rebuilt.message);
          continue;
        }
        const { read } = rebuilt;
        // The registry may have changed since the review (another tab, a removal).
        const now = backupVerdict(
          {
            key: entry.key,
            origin: read.book.hymnbook.id,
            sources: read.sources,
            songs: read.songHashes,
          },
          heldBooks(ctx),
        );
        if (now.kind === "already-here" || now.kind === "already-here-as") {
          done(now.kind);
          continue;
        }
        if (!sameBackupVerdict(now, verdict)) {
          done("failed", "the books held changed; read the backup again");
          continue;
        }
        if (now.kind === "conflict") {
          if (choices[entry.key] === "replace" && now.replaceable) {
            await replaceBook(ctx, entry.key, read, { onProgress: report });
            done("replaced");
          } else {
            done("kept");
          }
        } else if (now.over) {
          await replaceBook(ctx, entry.key, read, { restore: true, onProgress: report });
          done("restored");
        } else {
          await addBook(ctx, entry.key, read, freeGeneration(ctx, entry.key), report);
          done("restored");
        }
      } catch (error) {
        done("failed", messageOf(error));
      }
    }
    const held = listBooks(ctx).map((b) => b.key);
    const wrote = results.some((r) => r.outcome === "restored" || r.outcome === "replaced");
    return {
      ok: true,
      books: results,
      held,
      ...(pending.userState === undefined ? {} : { userState: pending.userState }),
      ...(firstLoad && wrote ? { firstLoad: true as const } : {}),
    };
  }
}
