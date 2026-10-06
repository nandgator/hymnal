import { inflateSync } from "fflate";
import { type BookRef, type HeldBook, verdict as verdictOf } from "./duplicates.ts";
import { type SongHashes, sameSongs, sha256Hex } from "./hash.ts";

/**
 * The parts of reading a backup that need no database (SDD-0006 §3, steps 1 to
 * 3): the size cap, the entry rules, the manifest, the inflate ceilings and the
 * checksum. The file is untrusted, whoever made it, so nothing here trusts a
 * name, a size or a count it was told.
 */

export const BACKUP_FORMAT = "hymnal-backup";
export const BACKUP_VERSION = 1;

/** The file's own size, past which it is refused whole (§3.1). */
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;
/** A book's inflated size, past which it is refused (§3.3): a guard, not a limit on books. */
export const MAX_BOOK_BYTES = 512 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_USER_STATE_BYTES = 4 * 1024 * 1024;

export const MANIFEST_ENTRY = "manifest.json";
export const USER_STATE_ENTRY = "user-state.json";

export interface BackupBookEntry {
  key: string;
  title: string;
  songs: number;
  file: string;
  sha256: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** ISO 8601. */
  created: string;
  build: string;
  books: BackupBookEntry[];
}

/**
 * Why a backup is refused whole. A newer app's file names both versions, as a
 * book's format does (ADR-0019).
 */
export type BackupRefusal =
  | { reason: "not-a-backup"; message: string }
  | { reason: "needs-newer-app"; found: number; expected: number; message: string }
  | { reason: "damaged"; message: string }
  /** The file or the store could not be read this session: nothing is wrong with the backup. */
  | { reason: "unavailable"; message: string };

const refuse = (reason: "not-a-backup" | "damaged", message: string): BackupRefusal => ({
  reason,
  message,
});

/**
 * A key becomes a file name in the pool (`/<key>.<n>.sqlite3`) and a registry
 * key, and the manifest is untrusted: only what a UUID or a slug is made of,
 * and no dot, which would read as a generation (`keyOfFile`).
 */
export const BOOK_KEY = /^[A-Za-z0-9_-]{1,64}$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;

export const bookFileOf = (key: string) => `books/${key}.sqlite3`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isText = (v: unknown): v is string => typeof v === "string" && v !== "";

export type ManifestCheck =
  | { ok: true; manifest: BackupManifest }
  | { ok: false; refusal: BackupRefusal };

/**
 * Step 2, field by field. Another `format` is "not a backup"; a higher
 * `version` is "needs a newer app", whatever else it holds, since a newer
 * manifest's fields are not this app's to judge; any other fault is damage.
 */
export function checkManifest(raw: unknown): ManifestCheck {
  const no = (refusal: BackupRefusal): ManifestCheck => ({ ok: false, refusal });
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) {
    return no(refuse("not-a-backup", "this is not a Hymnal backup"));
  }
  const version = raw.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return no(refuse("damaged", "the backup's manifest has no version"));
  }
  if (version > BACKUP_VERSION) {
    return no({
      reason: "needs-newer-app",
      found: version,
      expected: BACKUP_VERSION,
      message: `this backup needs a newer app: it is version ${version}; this app reads version ${BACKUP_VERSION}`,
    });
  }
  const { created, build, books } = raw;
  if (!isText(created) || Number.isNaN(Date.parse(created))) {
    return no(refuse("damaged", "the backup's manifest has no date"));
  }
  if (typeof build !== "string") return no(refuse("damaged", "the backup's manifest has no build"));
  if (!Array.isArray(books)) return no(refuse("damaged", "the backup's manifest has no books"));
  const keys = new Set<string>();
  const entries: BackupBookEntry[] = [];
  for (const [i, book] of books.entries()) {
    const at = `book ${i + 1}`;
    if (!isRecord(book)) return no(refuse("damaged", `the manifest's ${at} is not an object`));
    const { key, title, songs, file, sha256 } = book;
    if (typeof key !== "string" || !BOOK_KEY.test(key)) {
      return no(refuse("damaged", `the manifest's ${at} has an unusable key`));
    }
    if (keys.has(key)) return no(refuse("damaged", `the manifest names ${key} twice`));
    keys.add(key);
    if (typeof title !== "string" || !isCount(songs)) {
      return no(refuse("damaged", `the manifest's ${at} has no title or song count`));
    }
    // The name is the key's, never taken from the file: no other path is read.
    if (file !== bookFileOf(key)) {
      return no(refuse("damaged", `the manifest's ${at} names ${String(file)}, not its own file`));
    }
    if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) {
      return no(refuse("damaged", `the manifest's ${at} has no checksum`));
    }
    entries.push({ key, title, songs, file, sha256 });
  }
  return { ok: true, manifest: { format: BACKUP_FORMAT, version, created, build, books: entries } };
}

/** One entry of the zip as its directory declares it; nothing is inflated to learn it. */
export interface ZipEntry {
  name: string;
  /** The inflated size the entry declares: untrusted, so it is a ceiling and not a promise. */
  size: number;
  /** Where the entry's local header is, how it is stored, and how long its stored bytes are. */
  offset: number;
  method: number;
  packed: number;
  encrypted: boolean;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** The central directory as the end record declares it, checked to lie before that record. */
function findDirectory(bytes: Uint8Array): { count: number; size: number; start: number } | null {
  if (bytes.length < 22) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (view.getUint32(at, true) === EOCD) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff || start + size > end) {
    return null;
  }
  return { count, size, start };
}

/**
 * The entries a zip declares, in one scan of its central directory, none
 * inflated; null when it is not a zip (or is zip64, which no backup needs:
 * nothing in one reaches 4 GB).
 */
export function listEntries(bytes: Uint8Array): ZipEntry[] | null {
  const dir = findDirectory(bytes);
  if (!dir) return null;
  const { count, size, start } = dir;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  let at = start;
  for (let i = 0; i < count; i++) {
    if (at + 46 > start + size || view.getUint32(at, true) !== CENTRAL) return null;
    const nameLength = view.getUint16(at + 28, true);
    const next =
      at + 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (next > start + size) return null;
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength)),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
      method: view.getUint16(at + 10, true),
      packed: view.getUint32(at + 20, true),
      encrypted: (view.getUint16(at + 8, true) & 1) !== 0,
    });
    at = next;
  }
  return entries;
}

/**
 * True when the entries' stored ranges, each from its local header to the end
 * of its bytes, run past the file, overlap one another or reach the central
 * directory. A zip that does is not one `zipSync` writes, and a size or an
 * offset in it cannot be trusted.
 */
export function entriesOverlap(bytes: Uint8Array, entries: readonly ZipEntry[]): boolean {
  const dir = findDirectory(bytes);
  if (!dir) return true;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ranges: [number, number][] = [];
  for (const entry of entries) {
    const at = entry.offset;
    if (at + 30 > dir.start || view.getUint32(at, true) !== LOCAL) return true;
    const to =
      at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true) + entry.packed;
    if (to > dir.start) return true;
    ranges.push([at, to]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.some(([, to], i) => i + 1 < ranges.length && to > (ranges[i + 1]?.[0] ?? Infinity));
}

/**
 * Deflate never grows its input by more than a few bytes in a block and a
 * handful in a stream; stored bytes are the data itself. Anything else is not
 * a size to act on.
 */
const packedFits = (entry: ZipEntry): boolean =>
  entry.method === 0
    ? entry.packed === entry.size
    : entry.packed <= entry.size + Math.ceil(entry.size / 1000) + 1024;

export type ReadEntry = { ok: true; data: Uint8Array } | { ok: false; message: string };

/**
 * Step 3, for one entry: inflated into a buffer of its declared size, itself
 * capped at `cap`, so nothing past the ceiling is ever allocated or written
 * (inflate truncates to the buffer). What guards the bytes themselves is the
 * checksum, for a book; for the manifest and the user state, that they parse
 * (and, the user state, go through `cleanUserDoc`). An entry that holds less
 * than it declares is damaged by the length check, which stored entries need
 * as much as deflated ones.
 */
export async function readEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  cap: number,
  sha256?: string,
): Promise<ReadEntry> {
  const no = (message: string): ReadEntry => ({ ok: false, message });
  if (entry.size > cap) return no(`${entry.name} is larger than ${cap} bytes inflated`);
  if (entry.encrypted || (entry.method !== 0 && entry.method !== 8)) {
    return no(`${entry.name} is stored in a way a backup is not`);
  }
  if (!packedFits(entry)) return no(`${entry.name} is not the length it declares`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.offset;
  if (header + 30 > bytes.length || view.getUint32(header, true) !== LOCAL) {
    return no(`${entry.name} has no local header`);
  }
  const from = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
  if (from + entry.packed > bytes.length) return no(`${entry.name} runs past the end of the file`);
  const packed = bytes.subarray(from, from + entry.packed);
  let data: Uint8Array;
  try {
    data =
      entry.method === 0
        ? packed.slice()
        : inflateSync(packed, { out: new Uint8Array(entry.size) });
  } catch {
    return no(`${entry.name} could not be inflated`);
  }
  if (data.length !== entry.size) return no(`${entry.name} is not the size it declares`);
  if (sha256 !== undefined && (await sha256Hex(data)) !== sha256) {
    return no(`${entry.name} does not match its checksum`);
  }
  return { ok: true, data };
}

export type OpenedBackup =
  | { ok: true; manifest: BackupManifest; entries: ReadonlyMap<string, ZipEntry> }
  | { ok: false; refusal: BackupRefusal };

/**
 * Steps 1 and 2 and the entry rules: the file's size, its entries, the
 * manifest. Only the manifest is inflated, within its own small ceiling; no
 * book is until the caller reads it. The entries must be `manifest.json`, an
 * optional `user-state.json` and the `books/` files the manifest names, each
 * once, and nothing else; a manifest naming a missing entry refuses the file.
 */
export async function openBackup(bytes: Uint8Array): Promise<OpenedBackup> {
  const no = (refusal: BackupRefusal): OpenedBackup => ({ ok: false, refusal });
  if (bytes.length > MAX_BACKUP_BYTES) {
    return no(refuse("not-a-backup", "this file is larger than a backup can be (2 GB)"));
  }
  const listed = listEntries(bytes);
  if (!listed) return no(refuse("not-a-backup", "this is not a Hymnal backup (not a zip file)"));
  const manifestEntry = listed.find((e) => e.name === MANIFEST_ENTRY);
  if (!manifestEntry) return no(refuse("not-a-backup", "this is not a Hymnal backup"));
  if (entriesOverlap(bytes, listed)) {
    return no(refuse("damaged", "the backup's entries overlap or run past the file"));
  }
  const read = await readEntry(bytes, manifestEntry, MAX_MANIFEST_BYTES);
  if (!read.ok) return no(refuse("damaged", read.message));
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.data));
  } catch {
    return no(refuse("not-a-backup", "this is not a Hymnal backup (the manifest is not JSON)"));
  }
  const checked = checkManifest(raw);
  if (!checked.ok) return no(checked.refusal);
  const { manifest } = checked;

  const allowed = new Set([
    MANIFEST_ENTRY,
    USER_STATE_ENTRY,
    ...manifest.books.map((book) => book.file),
  ]);
  const entries = new Map<string, ZipEntry>();
  let declared = 0;
  for (const entry of listed) {
    declared += entry.size;
    if (declared > MAX_BACKUP_BYTES) {
      return no(refuse("damaged", "the backup declares more than 2 GB inflated"));
    }
    if (!allowed.has(entry.name)) {
      return no(refuse("damaged", `the backup holds an entry the manifest does not name`));
    }
    if (entries.has(entry.name)) {
      return no(refuse("damaged", `the backup holds ${entry.name} twice`));
    }
    entries.set(entry.name, entry);
  }
  for (const book of manifest.books) {
    if (!entries.has(book.file)) {
      return no(refuse("damaged", `the manifest names ${book.file}, which the backup lacks`));
    }
  }
  return { ok: true, manifest, entries };
}

/**
 * True when the bytes are a backup, by the manifest and not by the name (§5):
 * a zip whose `manifest.json` says `format: "hymnal-backup"`. A backup of a
 * newer version is one too, so it is refused with that reason and not as a
 * book. Never throws.
 */
export async function isBackup(bytes: Uint8Array): Promise<boolean> {
  if (bytes.length > MAX_BACKUP_BYTES) return false;
  const manifest = listEntries(bytes)?.find((e) => e.name === MANIFEST_ENTRY);
  if (!manifest) return false;
  const read = await readEntry(bytes, manifest, MAX_MANIFEST_BYTES);
  if (!read.ok) return false;
  try {
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.data));
    return isRecord(raw) && raw.format === BACKUP_FORMAT;
  } catch {
    return false;
  }
}

/** A backup's book, rebuilt and checked: what the verdict needs of it (§4). */
export interface BackupBookFacts {
  key: string;
  origin: string;
  sources: readonly string[];
  songs: SongHashes;
}

/** What restoring a book does (§4), the rows of its table. */
export type BackupVerdict =
  /** The same key, the same songs: nothing. */
  | { kind: "already-here" }
  /**
   * The same key, different songs: keep this device's (the default) or
   * replace it from the backup. `replaceable` is false for a copy that needs a
   * newer app, which a file does not replace.
   */
  | { kind: "conflict"; replaceable: boolean }
  /** Another book has the same songs or a source of this one: nothing. */
  | { kind: "already-here-as"; book: BookRef }
  /**
   * Nothing held: restored under the backup's key. `over` is a held book of
   * that key that cannot be opened (SDD-0004 §9), which the backup restores.
   */
  | { kind: "restore"; over?: true };

/**
 * §4's table, fed SDD-0004 §8's verdict: the book's `sources` stand in for the
 * file hashes, so a backup of a book loaded from a file the device already
 * matched reads "already here as". Another book of the same origin is not a
 * duplicate here: it is another edition, and the backup's own key stands.
 */
export function backupVerdict(book: BackupBookFacts, held: readonly HeldBook[]): BackupVerdict {
  const same = held.find((b) => b.key === book.key);
  if (same) {
    if (same.state === "ok") {
      return sameSongs(book.songs, same.songs)
        ? { kind: "already-here" }
        : { kind: "conflict", replaceable: same.kind === "loaded" };
    }
    // A file does not restore a book that needs a newer app (SDD-0004 §9).
    if (same.state === "needs-newer-app") return { kind: "conflict", replaceable: false };
    return same.kind === "loaded"
      ? { kind: "restore", over: true }
      : { kind: "conflict", replaceable: false };
  }
  const others = held.filter((b) => b.key !== book.key);
  for (const sourceHash of book.sources.length > 0 ? book.sources : [""]) {
    const found = verdictOf({ sourceHash, origin: book.origin, songHashes: book.songs }, others);
    if (found.kind === "same-file" || found.kind === "same-songs") {
      return { kind: "already-here-as", book: found.book };
    }
  }
  return { kind: "restore" };
}

/** Two verdicts say the same thing, for the commit's second look at the registry. */
export function sameBackupVerdict(a: BackupVerdict, b: BackupVerdict): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "conflict" && b.kind === "conflict") return a.replaceable === b.replaceable;
  if (a.kind === "restore" && b.kind === "restore") return a.over === b.over;
  if (a.kind === "already-here-as" && b.kind === "already-here-as")
    return a.book.key === b.book.key;
  return true;
}
