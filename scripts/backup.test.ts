// @vitest-environment node

import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { strToU8, unzipSync, Zip, ZipDeflate, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BACKUP_FORMAT,
  type BackupBookFacts,
  backupVerdict,
  checkManifest,
  hasZipMagic,
  isBackup,
  listEntries,
  openBackup,
  readEntry,
  sameBackupVerdict,
} from "../src/domain/backup.ts";
import type { HeldBook } from "../src/domain/duplicates.ts";
import { sha256Hex, songHash } from "../src/domain/hash.ts";
import { insertRows, packageRows } from "../src/domain/package-rows.ts";
import type { HymnSource } from "../src/domain/types.ts";
import {
  BackupSession,
  backupFilename,
  rebuildPackage,
  writeBackup,
} from "../src/persistence/backup.ts";
import {
  addBook,
  heldBooks,
  listBooks,
  type RegistryContext,
  removeBook,
} from "../src/persistence/registry.ts";
import {
  cleanUserDoc,
  mergeRestoredDoc,
  type UserStateDoc,
} from "../src/persistence/user-state.ts";
import { SCHEMA_SQL, SCHEMA_V2_SQL, SCHEMA_VERSION } from "./content-schema.ts";
import {
  book,
  container,
  hymn,
  hymns,
  loadWasm,
  type MemoryFiles,
  setupOn,
} from "./registry-fixtures.ts";

let wasm: Sqlite3Static;
beforeAll(async () => {
  wasm = await loadWasm();
});

const json = (value: unknown) => strToU8(JSON.stringify(value));
const hex = (n: number) => n.toString(16).padStart(64, "0");

const manifestOf = (books: { key: string; sha256?: string }[] = []) => ({
  format: BACKUP_FORMAT,
  version: 1,
  created: "2026-10-06T09:00:00.000Z",
  build: "test",
  books: books.map((b, i) => ({
    key: b.key,
    title: `Book ${b.key}`,
    songs: 2,
    file: `books/${b.key}.sqlite3`,
    sha256: b.sha256 ?? hex(i + 1),
  })),
});

describe("the manifest (SDD-0006 §3.2)", () => {
  it("accepts a well-formed one", () => {
    const manifest = manifestOf([{ key: "abc-123" }, { key: "K_2" }]);
    expect(checkManifest(manifest)).toEqual({ ok: true, manifest });
  });

  it("calls another format, or no object, not a backup", () => {
    for (const raw of [null, [], "x", {}, { ...manifestOf(), format: "hymnal-book" }]) {
      expect(checkManifest(raw)).toMatchObject({ ok: false, refusal: { reason: "not-a-backup" } });
    }
  });

  it("names both versions when a backup needs a newer app, before judging anything else", () => {
    const check = checkManifest({ format: BACKUP_FORMAT, version: 2, books: "from the future" });
    expect(check).toMatchObject({
      ok: false,
      refusal: { reason: "needs-newer-app", found: 2, expected: 1 },
    });
    expect(!check.ok && check.refusal.message).toMatch(/version 2.*version 1/);
  });

  it.each([
    ["no version", { ...manifestOf(), version: undefined }],
    ["a version of 0", { ...manifestOf(), version: 0 }],
    ["a fractional version", { ...manifestOf(), version: 1.5 }],
    ["no date", { ...manifestOf(), created: "yesterday" }],
    ["no build", { ...manifestOf(), build: 7 }],
    ["no books array", { ...manifestOf(), books: {} }],
    ["a book that is not an object", { ...manifestOf(), books: [1] }],
    ["a key with a slash", manifestOf([{ key: "../x" }])],
    ["a key with a dot", manifestOf([{ key: "a.1" }])],
    ["an empty key", manifestOf([{ key: "" }])],
    ["a long key", manifestOf([{ key: "a".repeat(65) }])],
    ["a key twice", manifestOf([{ key: "a" }, { key: "a" }])],
    [
      "a negative song count",
      {
        ...manifestOf([{ key: "a" }]),
        books: [{ ...manifestOf([{ key: "a" }]).books[0], songs: -1 }],
      },
    ],
    [
      "a file that is not the key's",
      {
        ...manifestOf([{ key: "a" }]),
        books: [{ ...manifestOf([{ key: "a" }]).books[0], file: "books/b.sqlite3" }],
      },
    ],
    ["a short checksum", manifestOf([{ key: "a", sha256: "abc" }])],
    ["an upper case checksum", manifestOf([{ key: "a", sha256: "A".repeat(64) }])],
  ])("calls %s damaged", (_name, raw) => {
    expect(checkManifest(raw)).toMatchObject({ ok: false, refusal: { reason: "damaged" } });
  });
});

describe("the entry rules and the ceilings (§3.1, §3.3)", () => {
  const zip = (entries: Record<string, Uint8Array>) => zipSync(entries);
  const good = () =>
    zip({
      "manifest.json": json(manifestOf([{ key: "a" }])),
      "user-state.json": json({ version: 1, recents: [] }),
      "books/a.sqlite3": new Uint8Array([1, 2, 3]),
    });

  it("opens a backup whose entries are the manifest's", async () => {
    const opened = await openBackup(good());
    expect(opened.ok && [...opened.entries.keys()].sort()).toEqual([
      "books/a.sqlite3",
      "manifest.json",
      "user-state.json",
    ]);
  });

  it("does not need a user-state entry", async () => {
    const opened = await openBackup(zip({ "manifest.json": json(manifestOf()) }));
    expect(opened.ok).toBe(true);
  });

  it("refuses what is not a zip, or has no manifest, as not a backup", async () => {
    for (const bytes of [strToU8("hello"), new Uint8Array(0), zip({ "x.txt": strToU8("x") })]) {
      expect(await openBackup(bytes)).toMatchObject({
        ok: false,
        refusal: { reason: "not-a-backup" },
      });
    }
    expect(await openBackup(zip({ "manifest.json": strToU8("{not json") }))).toMatchObject({
      ok: false,
      refusal: { reason: "not-a-backup" },
    });
    expect(
      await openBackup(zip({ "manifest.json": json({ format: "other", version: 1 }) })),
    ).toMatchObject({ ok: false, refusal: { reason: "not-a-backup" } });
  });

  it("refuses an entry the manifest does not name, or a name it does not own", async () => {
    for (const extra of ["notes.txt", "books/b.sqlite3", "../books/a.sqlite3", "books/"]) {
      const bytes = zip({
        "manifest.json": json(manifestOf([{ key: "a" }])),
        "books/a.sqlite3": new Uint8Array([1]),
        [extra]: new Uint8Array([2]),
      });
      expect(await openBackup(bytes)).toMatchObject({ ok: false, refusal: { reason: "damaged" } });
    }
  });

  it("refuses a manifest that names a book the file lacks", async () => {
    const bytes = zip({ "manifest.json": json(manifestOf([{ key: "a" }])) });
    expect(await openBackup(bytes)).toMatchObject({ ok: false, refusal: { reason: "damaged" } });
  });

  it("refuses a newer backup naming both versions", async () => {
    const bytes = zip({ "manifest.json": json({ ...manifestOf(), version: 9 }) });
    expect(await openBackup(bytes)).toMatchObject({
      ok: false,
      refusal: { reason: "needs-newer-app", found: 9, expected: 1 },
    });
  });

  it("refuses a manifest past its own ceiling without inflating it", async () => {
    const big = zip({ "manifest.json": strToU8(`${" ".repeat(2 * 1024 * 1024)}{}`) });
    expect(await openBackup(big)).toMatchObject({ ok: false, refusal: { reason: "damaged" } });
  });

  /** Rewrites an entry's declared inflated size in the central directory. */
  const declare = (bytes: Uint8Array, size: number, name?: string): Uint8Array => {
    const copy = bytes.slice();
    const view = new DataView(copy.buffer);
    for (let at = 0; at < copy.length - 4; at++) {
      if (view.getUint32(at, true) !== 0x02014b50) continue;
      const named = new TextDecoder().decode(
        copy.subarray(at + 46, at + 46 + view.getUint16(at + 28, true)),
      );
      if (name === undefined || named === name) view.setUint32(at + 24, size, true);
    }
    return copy;
  };

  it("reads an entry within its ceiling and checks its checksum", async () => {
    const data = new Uint8Array(1000).map((_, i) => i % 7);
    const bytes = zip({ "books/a.sqlite3": data });
    const [entry] = listEntries(bytes) ?? [];
    expect(entry).toMatchObject({ name: "books/a.sqlite3", size: 1000, method: 8 });
    const ok = await readEntry(bytes, entry as never, 1000, await sha256Hex(data));
    expect(ok).toEqual({ ok: true, data });
    expect(await readEntry(bytes, entry as never, 1000, hex(1))).toMatchObject({
      ok: false,
      message: expect.stringMatching(/checksum/),
    });
  });

  it("refuses an entry that declares more than the cap, without inflating", async () => {
    const bytes = zip({ "books/a.sqlite3": new Uint8Array(1000) });
    const lying = declare(bytes, 600 * 1024 * 1024);
    const [entry] = listEntries(lying) ?? [];
    expect(entry?.size).toBe(600 * 1024 * 1024);
    expect(await readEntry(lying, entry as never, 512 * 1024 * 1024)).toMatchObject({ ok: false });
  });

  it("calls an entry that holds more than it declares, or less, damaged", async () => {
    const data = new Uint8Array(5000).map((_, i) => (i * 31) % 251);
    const bytes = zip({ "books/a.sqlite3": data });
    for (const size of [10, 4999, 5001, 9000]) {
      const lying = declare(bytes, size);
      const [entry] = listEntries(lying) ?? [];
      const read = await readEntry(lying, entry as never, 1 << 20, await sha256Hex(data));
      expect(read.ok, `declared ${size}`).toBe(false);
    }
  });

  it("calls a stored entry that declares more or less than it holds damaged too", async () => {
    const data = new Uint8Array(300).map((_, i) => i % 5);
    const bytes = zipSync({ "books/a.sqlite3": [data, { level: 0 }] });
    const [honest] = listEntries(bytes) ?? [];
    expect(honest).toMatchObject({ method: 0, size: 300 });
    expect(await readEntry(bytes, honest as never, 1 << 20)).toEqual({ ok: true, data });
    for (const size of [10, 299, 301]) {
      const lying = declare(bytes, size);
      const [entry] = listEntries(lying) ?? [];
      expect((await readEntry(lying, entry as never, 1 << 20)).ok, `declared ${size}`).toBe(false);
    }
  });

  it("refuses declared sizes that together pass 2 GB, though each is under the cap", async () => {
    const names = ["a", "b", "c", "d", "e"];
    let bytes: Uint8Array = zip({
      "manifest.json": json(manifestOf(names.map((key) => ({ key })))),
      ...Object.fromEntries(names.map((k) => [`books/${k}.sqlite3`, new Uint8Array([1])])),
    });
    for (const k of names) bytes = declare(bytes, 500 * 1024 * 1024, `books/${k}.sqlite3`);
    expect(await openBackup(bytes)).toMatchObject({ ok: false, refusal: { reason: "damaged" } });
  });

  it("rules a gzip book out from its first four bytes", () => {
    expect(hasZipMagic(good().subarray(0, 4))).toBe(true);
    expect(hasZipMagic(new Uint8Array([0x1f, 0x8b, 8, 0]))).toBe(false);
    expect(hasZipMagic(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });

  it("recognises a backup by its manifest, not its name", async () => {
    expect(await isBackup(good())).toBe(true);
    expect(await isBackup(zip({ "manifest.json": json({ ...manifestOf(), version: 9 }) }))).toBe(
      true,
    );
    expect(await isBackup(zip({ "manifest.json": json({ format: "other" }) }))).toBe(false);
    expect(await isBackup(zip({ "hymnbook.json": json({}) }))).toBe(false);
    expect(await isBackup(strToU8("not a zip"))).toBe(false);
    expect(await isBackup(new Uint8Array(0))).toBe(false);
  });
});

describe("malformed zips are refused cleanly (§3.1, §3.3)", () => {
  const good = () =>
    zipSync({
      "manifest.json": json(manifestOf([{ key: "a" }])),
      "books/a.sqlite3": new Uint8Array(2000).map((_, i) => (i * 31) % 251),
    });
  const stored = () =>
    zipSync({
      "manifest.json": json(manifestOf([{ key: "a" }])),
      "books/a.sqlite3": [new Uint8Array(300).map((_, i) => i % 5), { level: 0 }],
    });

  const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset);
  const find = (bytes: Uint8Array, signature: number, from = 0) => {
    const view = viewOf(bytes);
    for (let at = from; at <= bytes.length - 4; at++) {
      if (view.getUint32(at, true) === signature) return at;
    }
    throw new Error("signature not found");
  };
  const eocd = (bytes: Uint8Array) => {
    let at = -1;
    for (let i = 0; i <= bytes.length - 4; i++) {
      if (viewOf(bytes).getUint32(i, true) === 0x06054b50) at = i;
    }
    return at;
  };
  /** The central header of the named entry. */
  const central = (bytes: Uint8Array, name: string) => {
    for (let at = find(bytes, 0x02014b50); ; at = find(bytes, 0x02014b50, at + 4)) {
      const view = viewOf(bytes);
      const found = new TextDecoder().decode(
        bytes.subarray(at + 46, at + 46 + view.getUint16(at + 28, true)),
      );
      if (found === name) return at;
    }
  };
  /** A copy with `edit` applied to its view. */
  const patched = (bytes: Uint8Array, edit: (view: DataView, bytes: Uint8Array) => void) => {
    const copy = bytes.slice();
    edit(viewOf(copy), copy);
    return copy;
  };
  const withComment = (bytes: Uint8Array, comment: Uint8Array) => {
    const out = new Uint8Array(bytes.length + comment.length);
    out.set(bytes);
    out.set(comment, bytes.length);
    viewOf(out).setUint16(eocd(bytes) + 20, comment.length, true);
    return out;
  };

  /** Resolves to the opened result, so a throw fails the test; the file must be refused. */
  const refused = async (bytes: Uint8Array) => {
    const opened = await openBackup(bytes);
    expect(opened.ok).toBe(false);
    return opened;
  };

  it("refuses a central directory that starts past the end of the file", async () => {
    const bytes = patched(good(), (v, b) => v.setUint32(eocd(b) + 16, b.length + 100, true));
    expect(listEntries(bytes)).toBeNull();
    await refused(bytes);
  });

  it("refuses an entry whose local header is past the end of the file", async () => {
    const bytes = patched(good(), (v, b) =>
      v.setUint32(central(b, "books/a.sqlite3") + 42, b.length + 10, true),
    );
    const [, entry] = listEntries(bytes) ?? [];
    expect(entry?.offset).toBeGreaterThan(bytes.length);
    expect(await readEntry(bytes, entry as never, 1 << 20)).toMatchObject({ ok: false });
    expect(await refused(bytes)).toMatchObject({ refusal: { reason: "damaged" } });
  });

  it("refuses an encrypted entry", async () => {
    const bytes = patched(good(), (v, b) => {
      const at = central(b, "books/a.sqlite3");
      v.setUint16(at + 8, v.getUint16(at + 8, true) | 1, true);
    });
    const entry = listEntries(bytes)?.find((e) => e.name === "books/a.sqlite3");
    expect(entry?.encrypted).toBe(true);
    expect(await readEntry(bytes, entry as never, 1 << 20)).toMatchObject({ ok: false });
  });

  it("refuses a method that is neither stored nor deflated", async () => {
    const bytes = patched(good(), (v, b) =>
      v.setUint16(central(b, "books/a.sqlite3") + 10, 12, true),
    );
    const entry = listEntries(bytes)?.find((e) => e.name === "books/a.sqlite3");
    expect(entry?.method).toBe(12);
    expect(await readEntry(bytes, entry as never, 1 << 20)).toMatchObject({ ok: false });
  });

  it.each([
    ["the entry count", 10, 0xffff, 2],
    ["the directory size", 12, 0xffffffff, 4],
    ["the directory offset", 16, 0xffffffff, 4],
  ])("refuses zip64 sentinels in %s", async (_name, field, value, width) => {
    const bytes = patched(good(), (v, b) =>
      width === 2
        ? v.setUint16(eocd(b) + field, value, true)
        : v.setUint32(eocd(b) + field, value, true),
    );
    expect(listEntries(bytes)).toBeNull();
    await refused(bytes);
  });

  it.each([
    ["size", 24],
    ["packed size", 20],
    ["local header offset", 42],
  ])("refuses a zip64 sentinel in an entry's %s", async (_name, field) => {
    const bytes = patched(good(), (v, b) =>
      v.setUint32(central(b, "books/a.sqlite3") + field, 0xffffffff, true),
    );
    const entry = listEntries(bytes)?.find((e) => e.name === "books/a.sqlite3");
    expect(entry && (await readEntry(bytes, entry, 512 * 1024 * 1024))).toMatchObject({
      ok: false,
    });
    await refused(bytes);
  });

  it("reads a zip whose end record carries a comment", async () => {
    const bytes = withComment(good(), strToU8("made by a test, with a comment"));
    expect(listEntries(bytes)?.map((e) => e.name)).toEqual(["manifest.json", "books/a.sqlite3"]);
    expect((await openBackup(bytes)).ok).toBe(true);
    expect(await isBackup(bytes)).toBe(true);
  });

  it("refuses a fake end record inside the comment, without throwing", async () => {
    const fake = new Uint8Array(22);
    viewOf(fake).setUint32(0, 0x06054b50, true);
    viewOf(fake).setUint16(10, 3, true);
    viewOf(fake).setUint32(12, 100, true);
    viewOf(fake).setUint32(16, 50, true);
    const bytes = withComment(good(), fake);
    await refused(bytes);
    expect(await isBackup(bytes)).toBe(false);
  });

  it("refuses a deflated entry whose packed size is far above its size", async () => {
    const bytes = patched(good(), (v, b) => {
      const at = central(b, "books/a.sqlite3");
      v.setUint32(at + 20, 100 * 1024 * 1024, true);
    });
    const entry = listEntries(bytes)?.find((e) => e.name === "books/a.sqlite3");
    expect(await readEntry(bytes, entry as never, 1 << 20)).toMatchObject({
      ok: false,
      message: expect.stringMatching(/length/),
    });
    await refused(bytes);
  });

  it("refuses a stored entry whose packed size is not its size, before any copy", async () => {
    for (const packed of [10, 299, 301, 0x7fffffff]) {
      const bytes = patched(stored(), (v, b) =>
        v.setUint32(central(b, "books/a.sqlite3") + 20, packed, true),
      );
      const entry = listEntries(bytes)?.find((e) => e.name === "books/a.sqlite3");
      expect(entry).toMatchObject({ method: 0, size: 300, packed });
      expect(await readEntry(bytes, entry as never, 1 << 20), `packed ${packed}`).toMatchObject({
        ok: false,
        message: expect.stringMatching(/length/),
      });
    }
  });

  it("refuses entries whose stored ranges overlap", async () => {
    const bytes = patched(good(), (v, b) => {
      // The book now starts where the manifest does.
      v.setUint32(central(b, "books/a.sqlite3") + 42, 0, true);
    });
    expect(await refused(bytes)).toMatchObject({ refusal: { reason: "damaged" } });
  });

  it("refuses an entry whose bytes reach into the central directory", async () => {
    const bytes = patched(good(), (v, b) => {
      const at = central(b, "books/a.sqlite3");
      v.setUint32(at + 20, v.getUint32(at + 20, true) + 5, true);
    });
    expect(await refused(bytes)).toMatchObject({ refusal: { reason: "damaged" } });
  });

  it("lists an entry written by a streaming zip, whose sizes follow its data", async () => {
    const data = new Uint8Array(5000).map((_, i) => (i * 7) % 253);
    const chunks: Uint8Array[] = [];
    const zip = new Zip((err, chunk) => {
      if (err) throw err;
      chunks.push(chunk);
    });
    const file = new ZipDeflate("books/a.sqlite3");
    zip.add(file);
    file.push(data, true);
    zip.end();
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    // Bit 3: the local header's sizes are zero, the descriptor after the data has them.
    expect(viewOf(bytes).getUint16(6, true) & 8).toBe(8);
    const entries = listEntries(bytes);
    expect(entries).toHaveLength(1);
    expect(entries?.[0]).toMatchObject({
      name: "books/a.sqlite3",
      size: data.length,
      method: 8,
      encrypted: false,
    });
    expect(await readEntry(bytes, entries?.[0] as never, 1 << 20, await sha256Hex(data))).toEqual({
      ok: true,
      data,
    });
  });
});

describe("the verdict (§4)", () => {
  const held = (over: Partial<HeldBook> & { key: string }): HeldBook => ({
    title: `Held ${over.key}`,
    origin: "o",
    kind: "loaded",
    state: "ok",
    sources: [],
    songs: new Map([[1, "h1"]]),
    ...over,
  });
  const facts = (over: Partial<BackupBookFacts> = {}): BackupBookFacts => ({
    key: "k",
    origin: "o",
    sources: ["s1"],
    songs: new Map([[1, "h1"]]),
    ...over,
  });

  it("is already here for the same key and the same songs", () => {
    expect(backupVerdict(facts(), [held({ key: "k" })])).toEqual({ kind: "already-here" });
  });

  it("is a conflict for the same key and different songs, replaceable when loaded", () => {
    const other = new Map([[1, "h2"]]);
    expect(backupVerdict(facts(), [held({ key: "k", songs: other })])).toEqual({
      kind: "conflict",
      replaceable: true,
    });
    expect(backupVerdict(facts(), [held({ key: "k", songs: other, kind: "shipped" })])).toEqual({
      kind: "conflict",
      replaceable: false,
    });
  });

  it("is already here as another book with the same songs", () => {
    expect(backupVerdict(facts(), [held({ key: "other" })])).toEqual({
      kind: "already-here-as",
      book: { key: "other", title: "Held other" },
    });
  });

  it("is already here as another book that has one of its sources", () => {
    const verdict = backupVerdict(facts({ sources: ["x", "s1"] }), [
      held({ key: "other", sources: ["s1"], songs: new Map([[9, "z"]]) }),
    ]);
    expect(verdict).toEqual({
      kind: "already-here-as",
      book: { key: "other", title: "Held other" },
    });
  });

  it("restores when nothing matches, and another edition of the origin is no match", () => {
    expect(backupVerdict(facts(), [])).toEqual({ kind: "restore" });
    expect(backupVerdict(facts(), [held({ key: "other", songs: new Map([[1, "h2"]]) })])).toEqual({
      kind: "restore",
    });
  });

  it("restores over a held book of that key that cannot be opened, but not one that needs a newer app", () => {
    for (const state of ["needs-reloading", "unreadable"]) {
      expect(backupVerdict(facts(), [held({ key: "k", state })])).toEqual({
        kind: "restore",
        over: true,
      });
    }
    expect(backupVerdict(facts(), [held({ key: "k", state: "needs-newer-app" })])).toEqual({
      kind: "conflict",
      replaceable: false,
    });
  });

  it("ignores another book that cannot be opened", () => {
    expect(backupVerdict(facts(), [held({ key: "other", state: "unreadable" })])).toEqual({
      kind: "restore",
    });
  });

  it("compares verdicts", () => {
    expect(sameBackupVerdict({ kind: "restore" }, { kind: "restore" })).toBe(true);
    expect(sameBackupVerdict({ kind: "restore" }, { kind: "restore", over: true })).toBe(false);
    expect(sameBackupVerdict({ kind: "restore" }, { kind: "already-here" })).toBe(false);
    expect(
      sameBackupVerdict(
        { kind: "conflict", replaceable: true },
        { kind: "conflict", replaceable: false },
      ),
    ).toBe(false);
  });
});

describe("the user-state merge (§4)", () => {
  const pos = (hymnbookId: string, hymnNumber = 1) => ({
    hymnbookId,
    hymnNumber,
    occurrenceIndex: 0,
    lineIndex: null,
  });
  const recent = (hymnbookId: string, hymnNumber: number, viewedAt: number) => ({
    hymnbookId,
    hymnNumber,
    viewedAt,
  });
  const doc = (over: Partial<UserStateDoc>): UserStateDoc => ({ version: 1, recents: [], ...over });
  const held = new Set(["a", "b"]);

  it("takes the settings from the backup, and keeps what a newer app stored on the device", () => {
    const merged = mergeRestoredDoc(
      doc({ preferences: { theme: "dark", fontScale: 2, future: 1 } as never }),
      doc({ preferences: { theme: "light", fontScale: 1.5 } }),
      held,
    );
    expect(merged.preferences).toEqual({ theme: "light", fontScale: 1.5, future: 1 });
  });

  it("keeps the device's settings when the backup has none", () => {
    const device = doc({ preferences: { theme: "dark", fontScale: 2 } });
    expect(mergeRestoredDoc(device, doc({}), held).preferences).toEqual(device.preferences);
  });

  it("merges recents: one entry per song, newest first, only held books", () => {
    const merged = mergeRestoredDoc(
      doc({ recents: [recent("a", 1, 50), recent("a", 2, 10), recent("gone", 1, 99)] }),
      doc({ recents: [recent("a", 1, 70), recent("b", 3, 60), recent("gone", 2, 98)] }),
      held,
    );
    expect(merged.recents).toEqual([recent("a", 1, 70), recent("b", 3, 60), recent("a", 2, 10)]);
  });

  it("caps recents at 20", () => {
    const many = (book: string, from: number) =>
      Array.from({ length: 15 }, (_, i) => recent(book, i + 1, from + i));
    const merged = mergeRestoredDoc(
      doc({ recents: many("a", 100) }),
      doc({ recents: many("b", 200) }),
      held,
    );
    expect(merged.recents).toHaveLength(20);
    expect(merged.recents[0]).toEqual(recent("b", 15, 214));
  });

  it("takes the position from the backup when its book is held, else keeps the device's", () => {
    expect(
      mergeRestoredDoc(doc({ lastPosition: pos("a", 3) }), doc({ lastPosition: pos("b", 4) }), held)
        .lastPosition,
    ).toEqual(pos("b", 4));
    expect(
      mergeRestoredDoc(doc({ lastPosition: pos("a", 3) }), doc({ lastPosition: pos("gone") }), held)
        .lastPosition,
    ).toEqual(pos("a", 3));
    expect(mergeRestoredDoc(doc({}), doc({ lastPosition: pos("gone") }), held)).not.toHaveProperty(
      "lastPosition",
    );
  });

  it("runs on a cleaned document and never lowers the version", () => {
    const merged = mergeRestoredDoc(
      doc({ version: 3 }),
      cleanUserDoc({ version: 2, recents: "x" }),
      held,
    );
    expect(merged).toEqual({ version: 3, recents: [] });
  });

  it("never raises the version to a backup's", () => {
    expect(mergeRestoredDoc(doc({ version: 1 }), doc({ version: 99 }), held).version).toBe(1);
  });
});

// ---- the rebuild (§3.4) ----

/** A current package, as the worker would write it, as bytes. */
function packageBytes(
  fill: (db: InstanceType<Sqlite3Static["oo1"]["DB"]>) => void = () => {},
  h: HymnSource[] = hymns,
  sources: string[] = ["a".repeat(64)],
  ddl: string = SCHEMA_SQL,
): Uint8Array {
  const db = new wasm.oo1.DB(":memory:");
  try {
    db.exec(ddl);
    insertRows(
      (sql, bind) => db.exec({ sql, bind: bind as never }),
      packageRows(book("origin-1", h.length), h, {
        key: "key-1",
        origin: "origin-1",
        sources,
        contentHash: "c".repeat(64),
        schemaVersion: SCHEMA_VERSION,
      }),
    );
    fill(db);
    return wasm.capi.sqlite3_js_db_export(db.pointer as number);
  } finally {
    db.close();
  }
}

/** A version 2 package: no origin, no sources, no part position (SDD-0004 §7). */
function packageV2(): Uint8Array {
  const db = new wasm.oo1.DB(":memory:");
  try {
    db.exec(SCHEMA_V2_SQL);
    db.exec(
      "INSERT INTO hymnbook (id, title, language, script, schema_version, content_hash) VALUES ('origin-1', 'A Book', 'en', 'Latn', 2, '" +
        "c".repeat(64) +
        "')",
    );
    for (const h of hymns) {
      db.exec({
        sql: "INSERT INTO hymn (number, title, author) VALUES (?, ?, ?)",
        bind: [h.number, h.title, "A"],
      });
      for (const p of h.parts) {
        db.exec({
          sql: "INSERT INTO part (hymn_number, id, kind, label) VALUES (?, ?, ?, ?)",
          bind: [h.number, p.id, p.kind, p.label ?? null],
        });
        for (const [idx, text] of p.lines.entries()) {
          db.exec({
            sql: "INSERT INTO line (hymn_number, part_id, idx, text) VALUES (?, ?, ?, ?)",
            bind: [h.number, p.id, idx, text],
          });
        }
      }
      for (const [idx, e] of h.sequence.entries()) {
        db.exec({
          sql: "INSERT INTO sequence_entry (hymn_number, idx, part_id) VALUES (?, ?, ?)",
          bind: [h.number, idx, e.partId],
        });
      }
    }
    return wasm.capi.sqlite3_js_db_export(db.pointer as number);
  } finally {
    db.close();
  }
}

const rebuilt = (bytes: Uint8Array) => rebuildPackage(wasm, bytes);

describe("the schema is pinned", () => {
  it("keeps SCHEMA_SQL and SCHEMA_V2_SQL byte for byte", async () => {
    const pins = {
      SCHEMA_SQL: "d4014c7ff6c520bb2b976301c0a35682b49df71eb385034dd4412f1021562668",
      SCHEMA_V2_SQL: "6ce9e75062cb904ae124e8cbc781561f030e2ce6af6da0afc0198c6265dc8da2",
    };
    const found = {
      SCHEMA_SQL: await sha256Hex(strToU8(SCHEMA_SQL)),
      SCHEMA_V2_SQL: await sha256Hex(strToU8(SCHEMA_V2_SQL)),
    };
    // A backup's book is matched against this text exactly, so an edit, even to
    // a comment, makes every older backup "unsafe".
    expect(
      found,
      "The package schema changed. Freeze the current DDL as a SCHEMA_V<n>_SQL constant, add it as an accepted family in the backup schema match (and its migrated form), then update the pin.",
    ).toEqual(pins);
  });
});

describe("rebuilding a package (§3.4)", () => {
  it("reads a good package back whole, with its sources and content hash kept", async () => {
    const result = await rebuilt(packageBytes());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.read.sources).toEqual(["a".repeat(64)]);
    expect(result.read.contentHash).toBe("c".repeat(64));
    expect(result.read.book.hymns).toEqual(hymns.map((h) => JSON.parse(JSON.stringify(h))));
    expect(result.read.book.hymnbook).toMatchObject({
      id: "origin-1",
      title: "A Book",
      hymnCount: 2,
    });
    expect(result.read.songHashes.get(1)).toBe(await songHash(hymn(1)));
  });

  it.each([
    ["a trigger", "CREATE TRIGGER t AFTER INSERT ON hymn BEGIN SELECT 1; END"],
    ["a view", "CREATE VIEW v AS SELECT number FROM hymn"],
    ["an extra table", "CREATE TABLE extra (x)"],
    ["an extra index", "CREATE INDEX hymn_title ON hymn (title)"],
    ["a shadow-named extra", "CREATE TABLE hymn_fts_extra (x)"],
    ["a temp-looking virtual table", "CREATE VIRTUAL TABLE v USING fts5(x)"],
  ])("refuses %s", async (_name, sql) => {
    const result = await rebuilt(packageBytes((db) => db.exec(sql)));
    expect(result).toMatchObject({ ok: false, reason: "unsafe" });
  });

  const ddl = (edit: (ddl: string) => string) => () =>
    packageBytes(() => {}, hymns, ["a".repeat(64)], edit(SCHEMA_SQL));
  /** A package whose `sqlite_master` row for `line` says something else than its type. */
  const lying = (text: string) => () =>
    packageBytes((db) => {
      db.exec("PRAGMA writable_schema = ON");
      db.exec({ sql: "UPDATE sqlite_master SET sql = ? WHERE name = 'line'", bind: [text] });
    });

  it.each([
    [
      "a table row whose sql is a trigger",
      lying("CREATE TRIGGER t AFTER INSERT ON hymn BEGIN SELECT 1; END"),
    ],
    [
      "a table row whose sql is a comment-obfuscated virtual table",
      lying("CREATE/**/VIRTUAL/**/TABLE line USING dbstat"),
    ],
    [
      "a generated column",
      ddl((d) => d.replace("meter   TEXT", "meter   TEXT,\n  g TEXT AS (lower(title))")),
    ],
    [
      "a CHECK that calls a function",
      ddl((d) =>
        d.replace(
          "title   TEXT NOT NULL,\n  author",
          "title   TEXT NOT NULL CHECK (length(title) > 0),\n  author",
        ),
      ),
    ],
    [
      "a DEFAULT expression",
      ddl((d) => d.replace("author  TEXT,", "author  TEXT DEFAULT (zeroblob(1000000000)),")),
    ],
    ["a different fts5 tokenizer", ddl((d) => d.replace("unicode61", "ascii"))],
    ["a different fts5 content option", ddl((d) => d.replace("content = ''", "content = 'line'"))],
    [
      "a column the app does not write",
      ddl((d) => d.replace("meter   TEXT", "meter   TEXT,\n  extra TEXT")),
    ],
  ])("refuses %s, whatever its type says", async (_name, bytes) => {
    expect(await rebuilt(bytes())).toMatchObject({ ok: false });
  });

  it("keeps only real hashes as sources, at most 64, and refuses a content hash that is not one", async () => {
    const many = Array.from({ length: 70 }, (_, i) => hex(i + 1));
    const result = await rebuilt(
      packageBytes(() => {}, hymns, ["not a hash", ...many, many[0] as string]),
    );
    expect(result.ok && result.read.sources).toEqual(many.slice(0, 64));
    expect(
      await rebuilt(packageBytes((db) => db.exec("UPDATE hymnbook SET content_hash = 'nope'"))),
    ).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("refuses a file that is not a database, or is empty", async () => {
    expect(
      await rebuilt(strToU8("not a database, only text, long enough to look like one".repeat(5))),
    ).toMatchObject({
      ok: false,
      reason: "damaged",
    });
    expect(await rebuilt(new Uint8Array(0))).toMatchObject({ ok: false, reason: "damaged" });
  });

  it("refuses a damaged page", async () => {
    const h = Array.from({ length: 60 }, (_, i) => hymn(i + 1));
    const bytes = packageBytes(() => {}, h).slice();
    const pageSize = new DataView(bytes.buffer).getUint16(16);
    expect(bytes.length / pageSize).toBeGreaterThan(4);
    // Scribble over a whole page after the schema's.
    bytes.fill(0xa7, pageSize * 3, pageSize * 4);
    expect(await rebuilt(bytes)).toMatchObject({ ok: false, reason: "damaged" });
  });

  it("refuses a book whose songs a load would reject", async () => {
    const bytes = packageBytes((db) => db.exec("UPDATE part SET kind = 'stanza' WHERE id = 'c'"));
    // A chorus recast as a stanza is valid; an empty sequence is not.
    expect((await rebuilt(bytes)).ok).toBe(true);
    const bad = packageBytes((db) => db.exec("DELETE FROM sequence_entry WHERE hymn_number = 2"));
    expect(await rebuilt(bad)).toMatchObject({ ok: false, reason: "invalid" });
    const noTitle = packageBytes((db) => db.exec("UPDATE hymn SET title = '  ' WHERE number = 1"));
    expect(await rebuilt(noTitle)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("migrates an older version in the scratch database", async () => {
    const result = await rebuilt(packageV2());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.read.book.hymnbook.id).toBe("origin-1");
    expect(result.read.sources).toEqual([]);
    expect(result.read.contentHash).toBe("c".repeat(64));
    expect(result.read.book.hymns.map((h) => h.parts.map((p) => p.id))).toEqual([
      ["s1", "c", "s2"],
      ["s1", "c", "s2"],
    ]);
  });

  it("names both versions for a newer package, and calls one too old too old", async () => {
    const newer = await rebuilt(
      packageBytes((db) => db.exec(`UPDATE hymnbook SET schema_version = ${SCHEMA_VERSION + 1}`)),
    );
    expect(newer).toMatchObject({ ok: false, reason: "needs-newer-app" });
    expect(!newer.ok && newer.message).toContain(`version ${SCHEMA_VERSION + 1}`);
    expect(!newer.ok && newer.message).toContain(`version ${SCHEMA_VERSION}`);
    expect(
      await rebuilt(packageBytes((db) => db.exec("UPDATE hymnbook SET schema_version = 1"))),
    ).toMatchObject({ ok: false, reason: "too-old" });
  });

  it("refuses a package with two books or none", async () => {
    expect(await rebuilt(packageBytes((db) => db.exec("DELETE FROM hymnbook")))).toMatchObject({
      ok: false,
    });
  });
});

// ---- a round trip ----

type Store = ReturnType<typeof setupOn> & { files: MemoryFiles };
const store = (): Store => setupOn("memory") as Store;

function session(ctx: RegistryContext) {
  let t = 0;
  return new BackupSession(
    async () => ctx,
    async () => wasm,
    () => `token-${++t}`,
  );
}

const edition1 = [hymn(1), hymn(2)];
const edition2 = [hymn(1), { ...hymn(2), title: "Song 2, as sung now" }];

/** Two books held, as a load makes them, and some user state. */
async function populated() {
  const s = store();
  await addBook(s.ctx, "key-one", await container("origin-a", edition1, "1".repeat(64)));
  await addBook(s.ctx, "key-two", await container("origin-b", [hymn(5), hymn(6)], "2".repeat(64)));
  return s;
}

const userDoc: UserStateDoc = {
  version: 1,
  lastPosition: { hymnbookId: "key-two", hymnNumber: 5, occurrenceIndex: 0, lineIndex: null },
  recents: [
    { hymnbookId: "key-one", hymnNumber: 2, viewedAt: 20 },
    { hymnbookId: "key-two", hymnNumber: 5, viewedAt: 10 },
  ],
  preferences: { theme: "dark", fontScale: 1.25 },
};

const songsOf = (ctx: RegistryContext) =>
  Object.fromEntries(
    heldBooks(ctx).map((b) => [
      b.key,
      { origin: b.origin, sources: b.sources, songs: [...b.songs] },
    ]),
  );

/** A backup that was made: the writer's refusal fails the test. */
async function backedUp(...args: Parameters<typeof writeBackup>) {
  const result = await writeBackup(...args);
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe("a backup, written and restored", () => {
  it("names the file for the local date", () => {
    expect(backupFilename(new Date(2026, 9, 6, 23, 59))).toBe("Hymnal backup 2026-10-06.hymnal");
  });

  it("writes the manifest, the user state and each book as the pool holds it", async () => {
    const { ctx, files } = await populated();
    const phases: unknown[] = [];
    const backup = await backedUp(ctx, files, userDoc, {
      build: "b-1",
      now: () => new Date(Date.UTC(2026, 9, 6, 12)),
      onProgress: (p) => phases.push(p),
    });
    expect(backup.skipped).toEqual([]);
    expect(await isBackup(backup.bytes)).toBe(true);
    const entries = unzipSync(backup.bytes);
    expect(Object.keys(entries).sort()).toEqual([
      "books/key-one.sqlite3",
      "books/key-two.sqlite3",
      "manifest.json",
      "user-state.json",
    ]);
    const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
    expect(manifest).toMatchObject({
      format: "hymnal-backup",
      version: 1,
      created: "2026-10-06T12:00:00.000Z",
      build: "b-1",
    });
    expect(manifest.books.map((b: { key: string; songs: number }) => [b.key, b.songs])).toEqual([
      ["key-one", 2],
      ["key-two", 2],
    ]);
    const first = entries["books/key-one.sqlite3"] as Uint8Array;
    expect(manifest.books[0].sha256).toBe(await sha256Hex(first));
    expect(first).toEqual(await files.pool.exportFile(ctx.files.list()[0] as string));
    expect(JSON.parse(new TextDecoder().decode(entries["user-state.json"]))).toEqual(userDoc);
    expect(phases.at(-1)).toEqual({ phase: "packing", done: 2, total: 2 });
  });

  it("leaves out shipped books and books that cannot be opened, and names them", async () => {
    const { ctx, files } = setupOn("memory", ["shipped-book"]) as Store;
    files.put("/shipped-book.1.sqlite3", "shipped-book");
    await addBook(ctx, "key-one", await container("origin-a", edition1));
    await addBook(ctx, "key-two", await container("origin-b", [hymn(5), hymn(6)]));
    ctx.registry.run("UPDATE book SET state = 'needs-newer-app' WHERE key = 'key-two'");
    ctx.registry.run(
      "INSERT INTO book (key, origin, kind, file, title, language, script, songs, added_at, state) VALUES ('shipped-book', 'shipped-book', 'shipped', '/shipped-book.1.sqlite3', 'Shipped', 'en', 'Latn', 2, 1, 'ok')",
    );
    // A third whose file has gone.
    await addBook(ctx, "key-gone", await container("origin-c", [hymn(8), hymn(9)]));
    files.remove(listBooks(ctx).find((b) => b.key === "key-gone")?.file as string);
    const backup = await backedUp(ctx, files, null, { build: "b" });
    expect(backup.skipped).toEqual([
      { key: "shipped-book", title: "Shipped", reason: "shipped" },
      { key: "key-two", title: "A Book", reason: "needs-newer-app" },
      { key: "key-gone", title: "A Book", reason: "unreadable" },
    ]);
    expect(Object.keys(unzipSync(backup.bytes)).sort()).toEqual([
      "books/key-one.sqlite3",
      "manifest.json",
      "user-state.json",
    ]);
  });

  it("leaves out a book at the reader's book ceiling, and stops at its total", async () => {
    const { ctx, files } = await populated();
    const size = ctx.files.list()[0]
      ? (await files.pool.exportFile(ctx.files.list()[0] as string)).length
      : 0;
    const tooBig = await writeBackup(ctx, files, null, { build: "b", limits: { book: size } });
    expect(tooBig).toMatchObject({ ok: true });
    expect(tooBig.ok && tooBig.skipped.map((b) => [b.key, b.reason])).toEqual([
      ["key-one", "too-large"],
      ["key-two", "too-large"],
    ]);
    const over = await writeBackup(ctx, files, null, {
      build: "b",
      limits: { total: 5 * 1024 * 1024 + size },
    });
    expect(over).toMatchObject({ ok: false, reason: "too-large" });
    expect(over.ok).toBe(false);
  });

  it("is silent about a book removed while the backup is being made", async () => {
    const { ctx, files } = await populated();
    const exportFile = files.pool.exportFile;
    files.pool.exportFile = (file) => {
      // The second book goes while the first is being read.
      removeBook(ctx, "key-two");
      return exportFile(file);
    };
    const backup = await backedUp(ctx, files, null, { build: "b" });
    expect(backup.skipped).toEqual([]);
    expect(Object.keys(unzipSync(backup.bytes)).sort()).toEqual([
      "books/key-one.sqlite3",
      "manifest.json",
      "user-state.json",
    ]);
  });

  it("restores into an empty store the books as they were, under their keys", async () => {
    const from = await populated();
    const backup = await backedUp(from.ctx, from.files, userDoc, { build: "b" });
    const into = store();
    const s = session(into.ctx);
    const review = await s.review(backup.bytes);
    expect(review).toMatchObject({
      ok: true,
      created: expect.any(String),
      build: "b",
      problems: [],
      hasUserState: true,
    });
    if (!review.ok) return;
    expect(review.books.map((b) => [b.key, b.verdict.kind])).toEqual([
      ["key-one", "restore"],
      ["key-two", "restore"],
    ]);
    // Nothing is written by the review.
    expect(listBooks(into.ctx)).toEqual([]);
    const done = await s.commit(review.token);
    expect(done).toMatchObject({
      ok: true,
      held: ["key-one", "key-two"],
      userState: userDoc,
      firstLoad: true,
    });
    expect(done.ok && done.books.map((b) => b.outcome)).toEqual(["restored", "restored"]);
    expect(songsOf(into.ctx)).toEqual(songsOf(from.ctx));
    expect(listBooks(into.ctx).map((b) => [b.key, b.kind, b.state, b.songs, b.title])).toEqual([
      ["key-one", "loaded", "ok", 2, "A Book"],
      ["key-two", "loaded", "ok", 2, "A Book"],
    ]);
    // The package itself was written fresh, with the backup's content hash.
    const head = into.files.open(listBooks(into.ctx)[0]?.file as string, (sql) =>
      sql.all("SELECT id, origin, content_hash, sources FROM hymnbook"),
    );
    expect(head).toEqual([
      {
        id: "key-one",
        origin: "origin-a",
        content_hash: "1".repeat(64),
        sources: JSON.stringify(["1".repeat(64)]),
      },
    ]);
    // A second commit of the token finds nothing.
    expect(await s.commit(review.token)).toMatchObject({ ok: false, reason: "no-review" });
  });

  it("restoring twice is already here", async () => {
    const from = await populated();
    const backup = await backedUp(from.ctx, from.files, userDoc, { build: "b" });
    const s = session(from.ctx);
    const review = await s.review(backup.bytes);
    expect(review.ok && review.books.map((b) => b.verdict.kind)).toEqual([
      "already-here",
      "already-here",
    ]);
    const done = await s.commit(review.ok ? review.token : "");
    expect(done.ok && done.books.map((b) => b.outcome)).toEqual(["already-here", "already-here"]);
    expect(done.ok && "firstLoad" in done).toBe(false);
  });

  it("keeps the device's copy of a different edition by default, or replaces it from the backup", async () => {
    const from = await populated();
    const backup = await backedUp(from.ctx, from.files, userDoc, { build: "b" });
    for (const choice of ["keep", "replace", undefined] as const) {
      const into = store();
      await addBook(into.ctx, "key-one", await container("origin-a", edition2, "9".repeat(64)));
      const before = songsOf(into.ctx);
      const s = session(into.ctx);
      const review = await s.review(backup.bytes);
      expect(review.ok && review.books.map((b) => [b.key, b.verdict])).toEqual([
        ["key-one", { kind: "conflict", replaceable: true }],
        ["key-two", { kind: "restore" }],
      ]);
      const done = await s.commit(review.ok ? review.token : "", choice && { "key-one": choice });
      expect(done.ok && done.books.map((b) => b.outcome)).toEqual([
        choice === "replace" ? "replaced" : "kept",
        "restored",
      ]);
      const after = songsOf(into.ctx);
      expect(after["key-two"]).toEqual(songsOf(from.ctx)["key-two"]);
      expect(after["key-one"]).toEqual(
        choice === "replace" ? songsOf(from.ctx)["key-one"] : before["key-one"],
      );
      if (choice === "replace") {
        // The key and its place in the list do not change.
        expect(listBooks(into.ctx).map((b) => b.key)).toEqual(["key-one", "key-two"]);
      }
      expect(done.ok && done.held).toEqual(["key-one", "key-two"]);
    }
  });

  it("is already here as a book of the same songs under another key, and writes nothing for it", async () => {
    const from = await populated();
    const backup = await backedUp(from.ctx, from.files, userDoc, { build: "b" });
    const into = store();
    await addBook(into.ctx, "other-key", await container("origin-a", edition1, "5".repeat(64)));
    const s = session(into.ctx);
    const review = await s.review(backup.bytes);
    expect(review.ok && review.books.map((b) => b.verdict)).toEqual([
      { kind: "already-here-as", book: { key: "other-key", title: "A Book" } },
      { kind: "restore" },
    ]);
    const done = await s.commit(review.ok ? review.token : "");
    expect(done.ok && done.books.map((b) => b.outcome)).toEqual(["already-here-as", "restored"]);
    expect(listBooks(into.ctx).map((b) => b.key)).toEqual(["other-key", "key-two"]);
  });

  it("restores over a held book of the key that cannot be opened", async () => {
    const from = await populated();
    const backup = await backedUp(from.ctx, from.files, userDoc, { build: "b" });
    const into = store();
    await addBook(into.ctx, "key-one", await container("origin-a", edition2));
    into.ctx.registry.run("UPDATE book SET state = 'unreadable' WHERE key = 'key-one'");
    const s = session(into.ctx);
    const review = await s.review(backup.bytes);
    expect(review.ok && review.books[0]?.verdict).toEqual({ kind: "restore", over: true });
    const done = await s.commit(review.ok ? review.token : "");
    expect(done.ok && done.books[0]?.outcome).toBe("restored");
    expect(listBooks(into.ctx).find((b) => b.key === "key-one")?.state).toBe("ok");
    expect(songsOf(into.ctx)["key-one"]).toEqual(songsOf(from.ctx)["key-one"]);
  });

  it("restores the rest when one book is damaged, and names it", async () => {
    const from = await populated();
    const backup = await backedUp(from.ctx, from.files, userDoc, { build: "b" });
    // key-one's bytes are replaced by others and the manifest's checksum no longer matches.
    const entries = unzipSync(backup.bytes);
    const damaged = (entries["books/key-one.sqlite3"] as Uint8Array).slice();
    damaged[damaged.length - 1] ^= 0xff;
    const tampered = zipSync({ ...entries, "books/key-one.sqlite3": damaged });
    const into = store();
    const s = session(into.ctx);
    const review = await s.review(tampered);
    expect(review.ok && review.books.map((b) => b.key)).toEqual(["key-two"]);
    expect(review.ok && review.problems).toEqual([
      {
        name: "key-one",
        title: "A Book",
        reason: "damaged",
        message: expect.stringMatching(/checksum/),
      },
    ]);
    await s.commit(review.ok ? review.token : "");
    expect(listBooks(into.ctx).map((b) => b.key)).toEqual(["key-two"]);
  });

  it("refuses a book that is unsafe even when its checksum is right", async () => {
    const from = await populated();
    const backup = await backedUp(from.ctx, from.files, userDoc, { build: "b" });
    const entries = unzipSync(backup.bytes);
    const evil = packageBytes((db) =>
      db.exec("CREATE TRIGGER t AFTER INSERT ON hymn BEGIN SELECT 1; END"),
    );
    const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"]));
    manifest.books[0].sha256 = await sha256Hex(evil);
    const tampered = zipSync({
      ...entries,
      "manifest.json": json(manifest),
      "books/key-one.sqlite3": evil,
    });
    const into = store();
    const review = await session(into.ctx).review(tampered);
    expect(review.ok && review.problems).toEqual([
      expect.objectContaining({ name: "key-one", reason: "unsafe" }),
    ]);
    expect(review.ok && review.books.map((b) => b.key)).toEqual(["key-two"]);
  });

  it("reports a book that fails to write and goes on with the rest", async () => {
    const from = await populated();
    const backup = await backedUp(from.ctx, from.files, userDoc, { build: "b" });
    const into = store();
    const s = session(into.ctx);
    const review = await s.review(backup.bytes);
    into.files.failImport = new Error("the disk is full");
    const done = await s.commit(review.ok ? review.token : "");
    expect(done.ok && done.books.map((b) => [b.key, b.outcome])).toEqual([
      ["key-one", "failed"],
      ["key-two", "restored"],
    ]);
    expect(done.ok && done.books[0]?.message).toMatch(/disk is full/);
    expect(listBooks(into.ctx).map((b) => b.key)).toEqual(["key-two"]);
  });

  it("refuses a book changed by another tab between the review and the commit", async () => {
    const from = await populated();
    const backup = await backedUp(from.ctx, from.files, userDoc, { build: "b" });
    const into = store();
    const s = session(into.ctx);
    const review = await s.review(backup.bytes);
    await addBook(into.ctx, "key-one", await container("origin-a", edition2, "8".repeat(64)));
    const done = await s.commit(review.ok ? review.token : "");
    expect(done.ok && done.books.map((b) => b.outcome)).toEqual(["failed", "restored"]);
    expect(songsOf(into.ctx)["key-one"]?.songs).toEqual([
      ...(await container("origin-a", edition2, "8".repeat(64))).songHashes,
    ]);
  });

  it("holds one review at a time, and cancel throws it away", async () => {
    const from = await populated();
    const backup = await backedUp(from.ctx, from.files, userDoc, { build: "b" });
    const into = store();
    const s = session(into.ctx);
    const first = await s.review(backup.bytes);
    const second = await s.review(backup.bytes);
    expect(await s.commit(first.ok ? first.token : "")).toMatchObject({ ok: false });
    expect(s.cancel(second.ok ? second.token : "")).toBe(true);
    expect(await s.commit(second.ok ? second.token : "")).toMatchObject({ ok: false });
    expect(listBooks(into.ctx)).toEqual([]);
  });

  it("refuses what is not a backup, and a newer one, with a typed reason", async () => {
    const into = store();
    const s = session(into.ctx);
    expect(await s.review(strToU8("hello"))).toMatchObject({
      ok: false,
      refusal: { reason: "not-a-backup" },
    });
    expect(
      await s.review(zipSync({ "manifest.json": json({ ...manifestOf(), version: 3 }) })),
    ).toMatchObject({ ok: false, refusal: { reason: "needs-newer-app", found: 3, expected: 1 } });
  });

  it("backs up an empty store, and restores a backup with no books", async () => {
    const empty = store();
    const backup = await backedUp(empty.ctx, empty.files, userDoc, { build: "b" });
    const review = await session(empty.ctx).review(backup.bytes);
    expect(review).toMatchObject({ ok: true, books: [], problems: [], hasUserState: true });
  });
});
