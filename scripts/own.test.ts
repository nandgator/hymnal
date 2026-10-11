// @vitest-environment node

import { gzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { songHash } from "../src/domain/hash.ts";
import type { OwnTarget } from "../src/domain/own.ts";
import type { HymnSource } from "../src/domain/types.ts";
import { removeOwnSongAndRecents } from "../src/persistence/books.ts";
import { LoadSession } from "../src/persistence/load.ts";
import {
  listSummaries,
  migratePackage,
  packageVersion,
  readHead,
  readHymns,
} from "../src/persistence/package-io.ts";
import {
  addOwnSongs,
  listBooks,
  openRegistry,
  ownStatuses,
  type RegistryContext,
  reconcile,
  registerHeld,
  removeBook,
  removeOwnSong,
  renameOwn,
} from "../src/persistence/registry.ts";
import { SCHEMA_V3_SQL, SCHEMA_VERSION } from "./content-schema.ts";
import {
  BACKENDS,
  book,
  type FakeFiles,
  hymn,
  hymns,
  loadWasm,
  setup,
  setupOn,
} from "./registry-fixtures.ts";

beforeAll(loadWasm);

/** A one-song file as From Text makes it, as a container. */
const oneSong = (n: number, title = `Song ${n}`): Uint8Array =>
  gzipSync(
    new TextEncoder().encode(
      JSON.stringify({ hymnbook: book("one", 1), hymns: [{ ...hymn(n), title }] }),
    ),
  );

const withHash = async (h: HymnSource) => ({ hymn: h, hash: await songHash(h) });

let keys = 0;
const newKey = () => `own-${++keys}`;

const DEFAULT: OwnTarget = { kind: "default" };

/** Adds song `n` (under number `n`) to a target; ok results carry the first number as `number`. */
async function addOne(
  ctx: RegistryContext,
  n: number,
  language = "en",
  script = "Latn",
  target: OwnTarget = DEFAULT,
) {
  const result = await addOwnSongs(
    ctx,
    newKey,
    target,
    [await withHash(hymn(n))],
    language,
    script,
  );
  return result.ok ? { ...result, number: result.numbers[0] } : result;
}

function loadSession(ctx: RegistryContext) {
  let k = 0;
  let t = 0;
  return new LoadSession(
    async () => ctx,
    () => `key-${++k}`,
    () => `token-${++t}`,
  );
}

describe.each(BACKENDS)("adding songs to your books (%s)", (backend) => {
  it("makes the default book with the song under its own number", async () => {
    const { ctx, files } = setupOn(backend);
    const result = await addOne(ctx, 5);
    expect(result).toMatchObject({ ok: true, number: 5, created: true });
    if (!result.ok) return;
    const [row] = listBooks(ctx);
    expect(row).toMatchObject({
      key: result.key,
      origin: "assorted",
      kind: "own",
      title: "Assorted Hymns",
      language: "mul",
      script: "Zyyy",
      songs: 1,
      nextNumber: 6,
      state: "ok",
      file: `/${result.key}.1.sqlite3`,
    });
    files.open(row?.file as string, (sql) => {
      expect(packageVersion(sql)).toBe(SCHEMA_VERSION);
      expect(readHead(sql, SCHEMA_VERSION)).toMatchObject({ origin: "assorted", nextNumber: 6 });
      const [only] = readHymns(sql, SCHEMA_VERSION);
      expect(only).toMatchObject({ number: 5, title: "Song 5", language: "en", script: "Latn" });
    });
    expect(ctx.registry.all("SELECT number FROM song")).toEqual([{ number: 5 }]);
  });

  it("appends, writes <key>.<n+1> and removes the old file", async () => {
    const { ctx, files } = setupOn(backend);
    const first = await addOne(ctx, 1);
    const second = await addOne(ctx, 2, "ml", "Mlym");
    if (!first.ok || !second.ok) throw new Error(`not added ${JSON.stringify([first, second])}`);
    expect(second).toMatchObject({ key: first.key, number: 2, created: false });
    expect(files.list()).toEqual([`/${first.key}.2.sqlite3`]);
    const [row] = listBooks(ctx);
    expect(row).toMatchObject({ songs: 2, kind: "own", nextNumber: 3 });
    files.open(row?.file as string, (sql) => {
      expect(readHead(sql, SCHEMA_VERSION)?.nextNumber).toBe(3);
      expect(readHymns(sql, SCHEMA_VERSION).map((h) => [h.number, h.language, h.script])).toEqual([
        [1, "en", "Latn"],
        [2, "ml", "Mlym"],
      ]);
    });
  });

  it("adds several songs at once, keeping their numbers and moving the counter past the highest", async () => {
    const { ctx } = setupOn(backend);
    await addOne(ctx, 1);
    const songs = [await withHash(hymn(4)), await withHash(hymn(9)), await withHash(hymn(6))];
    const result = await addOwnSongs(ctx, newKey, DEFAULT, songs, "en", "Latn");
    expect(result).toMatchObject({ ok: true, numbers: [4, 9, 6], already: 0, created: false });
    expect(listBooks(ctx)[0]).toMatchObject({ songs: 4, nextNumber: 10 });
  });

  it("refuses a number held or retired, naming the song, and writes nothing", async () => {
    const { ctx, files } = setupOn(backend);
    await addOne(ctx, 1);
    await addOne(ctx, 2);
    await removeOwnSong(ctx, listBooks(ctx)[0]?.key as string, 2);
    const before = files.list();
    // Song 2 was removed: its content may come back, but not under the retired number.
    expect(await addOne(ctx, 2)).toMatchObject({ ok: false, reason: "invalid" });
    // Song 1 is held, so it is not added twice.
    expect(await addOne(ctx, 1)).toMatchObject({ ok: false, reason: "already-here" });
    const other = await addOwnSongs(
      ctx,
      newKey,
      DEFAULT,
      [{ hymn: { ...hymn(2), title: "Other" }, hash: "x".repeat(64) }],
      "en",
      "Latn",
    );
    expect(other).toMatchObject({ ok: false, reason: "invalid" });
    if (!other.ok && other.reason === "invalid") expect(other.message).toContain("“Other”");
    expect(files.list()).toEqual(before);
  });

  it("refuses a number used twice in the batch", async () => {
    const { ctx, files } = setupOn(backend);
    const twice = [
      await withHash(hymn(3)),
      { hymn: { ...hymn(3), title: "Again" }, hash: "y".repeat(64) },
    ];
    expect(await addOwnSongs(ctx, newKey, DEFAULT, twice, "en", "Latn")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(files.list()).toEqual([]);
  });

  it("reports a song whose hash is already there, and adds nothing", async () => {
    const { ctx, files } = setupOn(backend);
    const first = await addOne(ctx, 1);
    await addOne(ctx, 2);
    const again = await addOwnSongs(
      ctx,
      newKey,
      DEFAULT,
      [{ hymn: { ...hymn(2), number: 7 }, hash: await songHash(hymn(2)) }],
      "ml",
      "Mlym",
    );
    expect(again).toMatchObject({ ok: false, reason: "already-here", number: 2 });
    if (first.ok) expect(again).toMatchObject({ key: first.key });
    expect(listBooks(ctx)[0]?.songs).toBe(2);
    expect(files.list()).toHaveLength(1);
  });

  it("adds the songs it lacks and counts the ones it held already", async () => {
    const { ctx } = setupOn(backend);
    await addOne(ctx, 1);
    const songs = [
      { hymn: { ...hymn(1), number: 8 }, hash: await songHash(hymn(1)) },
      await withHash(hymn(5)),
    ];
    expect(await addOwnSongs(ctx, newKey, DEFAULT, songs, "en", "Latn")).toMatchObject({
      ok: true,
      numbers: [5],
      already: 1,
    });
    expect(listBooks(ctx)[0]?.songs).toBe(2);
  });

  it("refuses a language or script that is not a tag, and writes nothing", async () => {
    const { ctx, files } = setupOn(backend);
    for (const [language, script] of [
      ["", "Latn"],
      ["en_GB", "Latn"],
      ["en", "latin"],
    ] as const) {
      expect(await addOne(ctx, 1, language, script)).toMatchObject({
        ok: false,
        reason: "invalid",
      });
    }
    expect(files.list()).toEqual([]);
    expect(listBooks(ctx)).toEqual([]);
  });

  it("validates the whole: a song a load would reject is refused", async () => {
    const { ctx, files } = setupOn(backend);
    const bad = { ...hymn(1), sequence: [] };
    const result = await addOwnSongs(ctx, newKey, DEFAULT, [await withHash(bad)], "en", "Latn");
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(files.list()).toEqual([]);
  });

  it("never reuses a number: add, remove, add", async () => {
    const { ctx } = setupOn(backend);
    await addOne(ctx, 1);
    await addOne(ctx, 2);
    await removeOwnSong(ctx, listBooks(ctx)[0]?.key as string, 2);
    expect(await addOne(ctx, 2)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await addOne(ctx, 3)).toMatchObject({ ok: true, number: 3 });
  });

  it("makes a new book of the given title, beside the default one", async () => {
    const { ctx } = setupOn(backend);
    const a = await addOne(ctx, 1);
    const b = await addOne(ctx, 1, "en", "Latn", { kind: "new", title: "  Camp Songs " });
    const c = await addOne(ctx, 1, "en", "Latn", { kind: "new", title: "Retreat" });
    if (!a.ok || !b.ok || !c.ok) throw new Error("not added");
    expect(new Set([a.key, b.key, c.key]).size).toBe(3);
    expect(listBooks(ctx).map((r) => [r.title, r.origin, r.kind, r.nextNumber])).toEqual([
      ["Assorted Hymns", "assorted", "own", 2],
      ["Camp Songs", "own", "own", 2],
      ["Retreat", "own", "own", 2],
    ]);
  });

  it("asks a new book for a title", async () => {
    const { ctx, files } = setupOn(backend);
    expect(await addOne(ctx, 1, "en", "Latn", { kind: "new", title: "  " })).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(files.list()).toEqual([]);
  });

  it("adds to the book chosen by key, and a default add goes to the assorted book only", async () => {
    const { ctx } = setupOn(backend);
    await addOne(ctx, 1);
    const camp = await addOne(ctx, 1, "en", "Latn", { kind: "new", title: "Camp" });
    if (!camp.ok) throw new Error("not added");
    expect(await addOne(ctx, 2, "en", "Latn", { kind: "book", key: camp.key })).toMatchObject({
      ok: true,
      key: camp.key,
      created: false,
    });
    await addOne(ctx, 3);
    expect(listBooks(ctx).map((r) => [r.title, r.songs])).toEqual([
      ["Assorted Hymns", 2],
      ["Camp", 2],
    ]);
    expect(await addOne(ctx, 2, "en", "Latn", { kind: "book", key: "nope" })).toMatchObject({
      ok: false,
      reason: "invalid",
    });
  });

  it("makes the default book again when the device has only others", async () => {
    const { ctx } = setupOn(backend);
    await addOne(ctx, 1, "en", "Latn", { kind: "new", title: "Camp" });
    expect(await addOne(ctx, 1)).toMatchObject({ ok: true, created: true });
    expect(listBooks(ctx).map((r) => r.origin)).toEqual(["own", "assorted"]);
  });

  it("tells each book's status for a file: next number, songs held, and a number taken", async () => {
    const { ctx } = setupOn(backend);
    const a = await addOne(ctx, 1);
    await addOne(ctx, 2);
    const camp = await addOne(ctx, 1, "en", "Latn", { kind: "new", title: "Camp" });
    if (!a.ok || !camp.ok) throw new Error("not added");
    const hash = await songHash(hymn(1));
    const list = ownStatuses(ctx, [{ number: 1, title: "Song 1" }], new Map([[1, hash]]));
    expect(list.map((s) => [s.key, s.title, s.next])).toEqual([
      [a.key, "Assorted Hymns", 3],
      [camp.key, "Camp", 2],
      [null, "", 1],
    ]);
    // The song is in both books by hash: held, so its number is not in question.
    expect(list[0]).toMatchObject({ has: { 1: 1 }, adding: [] });
    const fresh = ownStatuses(ctx, [{ number: 2, title: "Two" }], new Map([[2, "z".repeat(64)]]));
    expect(fresh[0]?.problem).toContain("Song 2 “Two”");
    expect(fresh[1]?.problem).toBeUndefined();
    expect(fresh[2]?.problem).toBeUndefined();
  });

  it("lists the default book, not yet made, so the review can say it will be", async () => {
    const { ctx } = setupOn(backend);
    expect(ownStatuses(ctx, [], new Map()).map((s) => [s.key, s.origin, s.title, s.next])).toEqual([
      [null, "assorted", "Assorted Hymns", 1],
      [null, "own", "", 1],
    ]);
  });
});

describe.each(BACKENDS)("renaming a book of yours (%s)", (backend) => {
  it("writes the package under the new title and the row follows; the key and songs stay", async () => {
    const { ctx, files } = setupOn(backend);
    const added = await addOne(ctx, 1, "en", "Latn", { kind: "new", title: "Camp" });
    await addOne(ctx, 2, "en", "Latn", { kind: "book", key: added.ok ? added.key : "" });
    if (!added.ok) throw new Error("not added");
    expect(await renameOwn(ctx, added.key, "  Camp Songs ")).toEqual({
      ok: true,
      key: added.key,
      title: "Camp Songs",
    });
    const [row] = listBooks(ctx);
    expect(row).toMatchObject({ key: added.key, title: "Camp Songs", songs: 2, nextNumber: 3 });
    expect(files.list()).toEqual([row?.file]);
    files.open(row?.file as string, (sql) => {
      expect(readHead(sql, SCHEMA_VERSION)).toMatchObject({ title: "Camp Songs", nextNumber: 3 });
      expect(readHymns(sql, SCHEMA_VERSION).map((h) => h.number)).toEqual([1, 2]);
    });
    expect(ctx.registry.all("SELECT number FROM song ORDER BY number")).toEqual([
      { number: 1 },
      { number: 2 },
    ]);
  });

  it("renames the default book too, and it stays the default", async () => {
    const { ctx } = setupOn(backend);
    await addOne(ctx, 1);
    const key = listBooks(ctx)[0]?.key as string;
    await renameOwn(ctx, key, "Sunday Songs");
    expect(listBooks(ctx)[0]).toMatchObject({ title: "Sunday Songs", origin: "assorted" });
    expect(await addOne(ctx, 2)).toMatchObject({ ok: true, key, created: false });
  });

  it("refuses an empty title, an unknown book and a received book", async () => {
    const { ctx, files } = setupOn(backend);
    await addOne(ctx, 1);
    const key = listBooks(ctx)[0]?.key as string;
    expect(await renameOwn(ctx, key, "  ")).toMatchObject({ ok: false, reason: "invalid" });
    expect(await renameOwn(ctx, "nope", "X")).toMatchObject({ ok: false, reason: "unknown" });
    files.put("/rec.1.sqlite3", "rec");
    await reconcile(ctx);
    expect(await renameOwn(ctx, "rec", "X")).toMatchObject({ ok: false, reason: "unknown" });
  });

  it("writes nothing when the title is the same", async () => {
    const { ctx, files } = setupOn(backend);
    await addOne(ctx, 1);
    const before = files.list();
    await renameOwn(ctx, listBooks(ctx)[0]?.key as string, "Assorted Hymns");
    expect(files.list()).toEqual(before);
  });
});

describe.each(BACKENDS)("removing a song from a book of yours (%s)", (backend) => {
  it("writes the package without it; next_number is unchanged and the number is retired", async () => {
    const { ctx, files } = setupOn(backend);
    for (const n of [1, 2, 3]) await addOne(ctx, n);
    const key = listBooks(ctx)[0]?.key as string;
    const result = await removeOwnSong(ctx, key, 2);
    expect(result).toMatchObject({ removed: true, bookRemoved: false });
    const [row] = listBooks(ctx);
    expect(row?.songs).toBe(2);
    expect(files.list()).toEqual([row?.file]);
    files.open(row?.file as string, (sql) => {
      expect(readHymns(sql, SCHEMA_VERSION).map((h) => h.number)).toEqual([1, 3]);
      expect(readHead(sql, SCHEMA_VERSION)?.nextNumber).toBe(4);
    });
  });

  it("does nothing for a number or a book it does not hold", async () => {
    const { ctx } = setupOn(backend);
    expect(await removeOwnSong(ctx, "nope", 1)).toEqual({ removed: false });
    await addOne(ctx, 1);
    const key = listBooks(ctx)[0]?.key as string;
    expect(await removeOwnSong(ctx, key, 7)).toEqual({ removed: false });
    expect(listBooks(ctx)[0]?.songs).toBe(1);
  });

  it("touches only the book it is asked about", async () => {
    const { ctx } = setupOn(backend);
    await addOne(ctx, 1);
    await addOne(ctx, 2);
    const camp = await addOne(ctx, 1, "en", "Latn", { kind: "new", title: "Camp" });
    if (!camp.ok) throw new Error("not added");
    await removeOwnSong(ctx, camp.key, 1);
    expect(listBooks(ctx).map((r) => [r.title, r.songs])).toEqual([["Assorted Hymns", 2]]);
  });

  it("takes the book with the last song, as removing a book does", async () => {
    const { ctx, files, sql } = setupOn(backend);
    const added = await addOne(ctx, 1);
    if (!added.ok) throw new Error("not added");
    const result = await removeOwnSong(ctx, added.key, 1);
    expect(result).toMatchObject({ removed: true, bookRemoved: true, key: added.key });
    expect(listBooks(ctx)).toEqual([]);
    expect(files.list()).toEqual([]);
    expect(sql.all("SELECT * FROM song")).toEqual([]);
  });

  it("makes a new default book, numbered afresh, after the old one went", async () => {
    const { ctx } = setupOn(backend);
    const added = await addOne(ctx, 1);
    if (!added.ok) throw new Error("not added");
    await removeOwnSong(ctx, added.key, 1);
    expect(await addOne(ctx, 1)).toMatchObject({ ok: true, number: 1, created: true });
  });

  it("drops the song's recents and position, and the whole book's when the last goes", async () => {
    const { ctx } = setupOn(backend);
    await addOne(ctx, 1);
    await addOne(ctx, 2);
    const calls: string[] = [];
    const state = {
      dropSong: async (k: string, n: number) => void calls.push(`song ${k} ${n}`),
      dropRecents: async (k: string) => void calls.push(`recents ${k}`),
    };
    const admin = {
      removeOwnSong: async (k: string, n: number) => removeOwnSong(ctx, k, n),
    };
    const key = listBooks(ctx)[0]?.key as string;
    await removeOwnSongAndRecents(admin, state, key, 2);
    expect(calls).toEqual([`song ${key} 2`]);
    calls.length = 0;
    await removeOwnSongAndRecents(admin, state, key, 1);
    expect(calls).toEqual([`song ${key} 1`, `recents ${key}`]);
    calls.length = 0;
    await removeOwnSongAndRecents(admin, state, key, 1);
    expect(calls).toEqual([]);
  });
});

describe.each(BACKENDS)("the review and the add through a session (%s)", (backend) => {
  it("lists each book's status, and 'already there' once the song is", async () => {
    const { ctx } = setupOn(backend);
    const s = loadSession(ctx);
    const first = await s.review(oneSong(1));
    expect(first.own?.map((o) => [o.key, o.next])).toEqual([
      [null, 1],
      [null, 1],
    ]);
    const added = await s.addToOwn(first.token, DEFAULT, "en", "Latn");
    expect(added).toMatchObject({ ok: true, numbers: [1], created: true, firstLoad: true });
    const second = await s.review(oneSong(2));
    expect(second.own?.[0]).toMatchObject({ next: 2, has: {}, adding: [2] });
    const same = await s.review(oneSong(1));
    expect(same.own?.[0]).toMatchObject({ next: 2, has: { 1: 1 }, adding: [] });
    const refused = await s.addToOwn(same.token, DEFAULT, "en", "Latn");
    expect(refused).toMatchObject({ ok: false, reason: "already-here", number: 1 });
    expect(listBooks(ctx)).toHaveLength(1);
  });

  it("adds a file of several songs to a chosen book, or to a new one", async () => {
    const { ctx } = setupOn(backend);
    const s = loadSession(ctx);
    const file = () =>
      gzipSync(new TextEncoder().encode(JSON.stringify({ hymnbook: book("b", 2), hymns })));
    const one = await s.review(file());
    expect(await s.addToOwn(one.token, { kind: "new", title: "Camp" }, "en", "Latn")).toMatchObject(
      { ok: true, numbers: [1, 2], created: true },
    );
    const key = listBooks(ctx)[0]?.key as string;
    const more = await s.review(
      gzipSync(
        new TextEncoder().encode(
          JSON.stringify({ hymnbook: book("b", 2), hymns: [hymn(3), hymn(4)] }),
        ),
      ),
    );
    expect(more.own?.[0]).toMatchObject({ key, next: 3, adding: [3, 4] });
    expect(await s.addToOwn(more.token, { kind: "book", key }, "en", "Latn")).toMatchObject({
      ok: true,
      numbers: [3, 4],
      created: false,
    });
    expect(listBooks(ctx)[0]?.songs).toBe(4);
  });

  it("says a number held in the review, and refuses it in the add with the review kept", async () => {
    const { ctx } = setupOn(backend);
    const s = loadSession(ctx);
    const a = await s.review(oneSong(1));
    await s.addToOwn(a.token, DEFAULT, "en", "Latn");
    const b = await s.review(oneSong(1, "A different song"));
    expect(b.own?.[0]?.problem).toContain("Song 1 “A different song”");
    expect(await s.addToOwn(b.token, DEFAULT, "en", "Latn")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    // The review is still pending: a new book takes the number 1.
    expect(await s.addToOwn(b.token, { kind: "new", title: "Other" }, "en", "Latn")).toMatchObject({
      ok: true,
    });
  });

  it("is flagged, not blocked, when the song is in another book", async () => {
    const { ctx } = setupOn(backend);
    const s = loadSession(ctx);
    const loaded = await s.review(
      gzipSync(new TextEncoder().encode(JSON.stringify({ hymnbook: book("b", 2), hymns }))),
    );
    await s.commit(loaded.token);
    const review = await s.review(oneSong(1, hymn(1).title));
    expect(review.held.count).toBe(1);
    const added = await s.addToOwn(review.token, DEFAULT, "en", "Latn");
    expect(added).toMatchObject({ ok: true, numbers: [1] });
    expect(listBooks(ctx).map((b) => b.kind)).toEqual(["loaded", "own"]);
  });

  it("keeps the review when the language is wrong, so it can be corrected", async () => {
    const { ctx } = setupOn(backend);
    const s = loadSession(ctx);
    const review = await s.review(oneSong(1));
    expect(await s.addToOwn(review.token, DEFAULT, "not a tag", "Latn")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(await s.addToOwn(review.token, DEFAULT, "en", "Latn")).toMatchObject({ ok: true });
  });

  it("takes a token once, and refuses a stale one", async () => {
    const { ctx } = setupOn(backend);
    const s = loadSession(ctx);
    const review = await s.review(oneSong(1));
    const [a, b] = await Promise.all([
      s.addToOwn(review.token, DEFAULT, "en", "Latn"),
      s.addToOwn(review.token, DEFAULT, "en", "Latn"),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await s.addToOwn("nope", DEFAULT, "en", "Latn")).toMatchObject({
      ok: false,
      reason: "no-review",
    });
  });
});

describe("the registry's kind and its version", () => {
  it("accepts the kind own, and refuses another, including the old assorted", () => {
    const { sql } = setup();
    sql.run("INSERT INTO book VALUES ('a','own','own','/a','t','mul','Zyyy',0,1,1,'ok')");
    for (const kind of ["other", "assorted"]) {
      expect(() =>
        sql.run(`INSERT INTO book VALUES ('b','x','${kind}','/b','t','l','s',0,NULL,1,'ok')`),
      ).toThrow();
    }
  });

  it("rebuilds a registry of version 2 (kind assorted), and reconcile adopts the package as own", async () => {
    const { ctx, files, sql } = setup();
    const added = await addOne(ctx, 1);
    sql.exec("DROP TABLE song; DROP TABLE source; DROP TABLE book");
    sql.exec(
      "CREATE TABLE book (key TEXT PRIMARY KEY, origin TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('shipped','loaded','assorted')), file TEXT NOT NULL, title TEXT NOT NULL, language TEXT NOT NULL, script TEXT NOT NULL, songs INTEGER NOT NULL, added_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'ok') STRICT",
    );
    sql.exec(
      "CREATE TABLE source (hash TEXT PRIMARY KEY, book_key TEXT NOT NULL, added_at INTEGER NOT NULL) STRICT",
    );
    sql.exec(
      "CREATE TABLE song (book_key TEXT NOT NULL, number INTEGER NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (book_key, number)) STRICT",
    );
    sql.exec("PRAGMA user_version = 2");
    openRegistry(sql);
    expect(listBooks(ctx)).toEqual([]);
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([
      { key: added.ok ? added.key : "", kind: "own", songs: 1, nextNumber: 2, state: "ok" },
    ]);
    expect(files.list()).toHaveLength(1);
  });
});

describe("reconcile and your books", () => {
  /** A package of `origin` in `files` with no registry row, as after a lost registry. */
  function strand(files: FakeFiles, key: string, origin: string) {
    files.put(`/${key}.1.sqlite3`, key);
    files.open(`/${key}.1.sqlite3`, (sql) => sql.run("UPDATE hymnbook SET origin = ?", [origin]));
  }

  it("adopts a package of origin assorted as kind own", async () => {
    const { ctx, files } = setup();
    strand(files, "aaa", "assorted");
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([
      { key: "aaa", origin: "assorted", kind: "own", state: "ok", songs: 2, nextNumber: 3 },
    ]);
  });

  it("adopts a package of origin own as kind own", async () => {
    const { ctx, files } = setup();
    strand(files, "aaa", "own");
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "aaa", origin: "own", kind: "own" }]);
  });

  it("adopts every such package as own, however many, and others as loaded", async () => {
    const { ctx, files } = setup();
    strand(files, "aaa", "assorted");
    strand(files, "bbb", "own");
    strand(files, "ccc", "own");
    files.put("/ddd.1.sqlite3", "ddd");
    await reconcile(ctx);
    expect(
      listBooks(ctx)
        .map((b) => [b.key, b.kind])
        .sort(),
    ).toEqual([
      ["aaa", "own"],
      ["bbb", "own"],
      ["ccc", "own"],
      ["ddd", "loaded"],
    ]);
  });

  it("keeps the kind of a held row across a restart", async () => {
    const { ctx, files } = setup();
    await addOne(ctx, 1);
    await reconcile(ctx);
    expect(listBooks(ctx).map((b) => b.kind)).toEqual(["own"]);
    expect(files.list()).toHaveLength(1);
  });

  /**
   * The state a crashed write leaves: `held` is the registry's row and its file; `ahead` is the
   * higher-generation file the write finished and never committed. Both are made by the real
   * operations, over one key, in two pools.
   */
  async function crashed(
    prior: (ctx: RegistryContext) => Promise<void>,
    latest: (ctx: RegistryContext) => Promise<void>,
  ) {
    const ahead = setup();
    await prior(ahead.ctx);
    await latest(ahead.ctx);
    const aheadFile = listBooks(ahead.ctx)[0]?.file as string;
    const held = setup();
    await prior(held.ctx);
    const db = ahead.files.dbs.get(aheadFile);
    if (!db) throw new Error("no file ahead");
    held.files.dbs.set(aheadFile, db);
    return { ...held, aheadFile };
  }
  const add = (n: number) => async (ctx: RegistryContext) => {
    await addOwnSongs(ctx, () => "crash-key", DEFAULT, [await withHash(hymn(n))], "en", "Latn");
  };

  it("finishes a crashed add: the copy that holds the song takes the row and the song survives", async () => {
    const { ctx, files, aheadFile } = await crashed(add(1), add(2));
    expect(listBooks(ctx)[0]).toMatchObject({ file: "/crash-key.1.sqlite3", songs: 1 });
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([
      { key: "crash-key", kind: "own", state: "ok", file: aheadFile, songs: 2 },
    ]);
    expect(files.list()).toEqual([aheadFile]);
    expect(ctx.registry.all("SELECT number FROM song ORDER BY number")).toEqual([
      { number: 1 },
      { number: 2 },
    ]);
  });

  it("finishes a crashed remove: the song stays removed and its number stays retired", async () => {
    const { ctx, files, aheadFile } = await crashed(
      async (c) => {
        for (const n of [1, 2, 3]) await add(n)(c);
      },
      async (c) => {
        await removeOwnSong(c, "crash-key", 2);
      },
    );
    expect(listBooks(ctx)[0]?.songs).toBe(3);
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ kind: "own", file: aheadFile, songs: 2 }]);
    expect(files.list()).toEqual([aheadFile]);
    expect(await addOne(ctx, 2)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await addOne(ctx, 4)).toMatchObject({ ok: true, number: 4 });
  });
});

describe.each(BACKENDS)("listing a book of yours' songs (%s)", (backend) => {
  it("lists by language, then title in that language, then number; other books by number", async () => {
    const { ctx, files } = setupOn(backend);
    const songs: [string, string][] = [
      ["ml", "b"],
      ["en", "Zed"],
      ["sv", "Ärlig"],
      ["sv", "Zebra"],
      ["en", "Alpha"],
    ];
    for (const [i, [language, title]] of songs.entries()) {
      const song = { ...hymn(i + 1), title };
      await addOwnSongs(ctx, newKey, DEFAULT, [await withHash(song)], language, "Latn");
    }
    const row = listBooks(ctx)[0];
    const listed = files.open(row?.file as string, (sql) => listSummaries(sql, true));
    expect(listed.map((x) => [x.language, x.title, x.number])).toEqual([
      ["en", "Alpha", 5],
      ["en", "Zed", 2],
      ["ml", "b", 1],
      ["sv", "Zebra", 4],
      ["sv", "Ärlig", 3],
    ]);
    files.put("/other.1.sqlite3", "other", [hymn(2), hymn(1)]);
    expect(files.open("/other.1.sqlite3", (sql) => listSummaries(sql, false))).toEqual([
      { number: 1, title: "Song 1" },
      { number: 2, title: "Song 2" },
    ]);
  });
});

describe.each(BACKENDS)("a book of yours that cannot be opened (%s)", (backend) => {
  async function broken() {
    const made = setupOn(backend);
    const added = await addOne(made.ctx, 1);
    if (!added.ok) throw new Error("not added");
    made.ctx.registry.run("UPDATE book SET state = 'unreadable' WHERE key = ?", [added.key]);
    return { ...made, key: added.key };
  }

  it("has no next number, so the review can say nothing is added", async () => {
    const { ctx, key } = await broken();
    const review = await loadSession(ctx).review(oneSong(2));
    expect(review.own?.find((o) => o.key === key)).toMatchObject({ next: null });
  });

  it("is not added to: a distinct reason, and nothing is written", async () => {
    const { ctx, files, key } = await broken();
    expect(await addOne(ctx, 2)).toEqual({ ok: false, reason: "unreadable", key });
    const s = loadSession(ctx);
    const review = await s.review(oneSong(2));
    expect(await s.addToOwn(review.token, DEFAULT, "en", "Latn")).toMatchObject({
      ok: false,
      reason: "unreadable",
      key,
    });
    expect(files.list()).toEqual([`/${key}.1.sqlite3`]);
    await expect(removeOwnSong(ctx, key, 1)).rejects.toThrow(/cannot be opened/);
    expect(await renameOwn(ctx, key, "X")).toMatchObject({ ok: false, reason: "unreadable" });
  });
});

describe("registering a book that opens", () => {
  it("keeps the kind of a book of yours that was listed unreadable", async () => {
    const { ctx } = setup();
    const added = await addOne(ctx, 1);
    if (!added.ok) throw new Error("not added");
    const file = `/${added.key}.1.sqlite3`;
    ctx.registry.run("UPDATE book SET state = 'unreadable' WHERE key = ?", [added.key]);
    await registerHeld(ctx, file);
    expect(listBooks(ctx)).toMatchObject([{ key: added.key, kind: "own", state: "ok" }]);
  });
});

describe("migration 3 to 4", () => {
  /** A version 3 package, as the last app wrote it. */
  function putV3(files: FakeFiles, file: string, id: string) {
    files.open(file, (sql) => {
      sql.exec(SCHEMA_V3_SQL);
      sql.run(
        "INSERT INTO hymnbook VALUES (?, ?, 'Old', 'en', 'Latn', NULL, NULL, NULL, 3, 'h', '[\"s1\"]')",
        [id, id],
      );
      for (const h of hymns) {
        sql.run("INSERT INTO hymn VALUES (?, ?, 'A', NULL, NULL)", [h.number, h.title]);
        h.parts.forEach((p, position) => {
          sql.run("INSERT INTO part VALUES (?, ?, ?, ?, ?)", [
            h.number,
            p.id,
            position,
            p.kind,
            p.label ?? null,
          ]);
          p.lines.forEach((text, i) => {
            sql.run("INSERT INTO line VALUES (?, ?, ?, ?)", [h.number, p.id, i, text]);
          });
        });
        h.sequence.forEach((e, i) => {
          sql.run("INSERT INTO sequence_entry VALUES (?, ?, ?)", [h.number, i, e.partId]);
        });
      }
    });
  }

  it("adds the three columns, null, and keeps every song and hash", async () => {
    const { files } = setup();
    putV3(files, "/old.sqlite3", "old");
    expect(files.open("/old.sqlite3", (sql) => packageVersion(sql))).toBe(3);
    const before = files.open("/old.sqlite3", (sql) => readHymns(sql, 3));
    expect(files.open("/old.sqlite3", (sql) => migratePackage(sql, 3))).toBe(true);
    files.open("/old.sqlite3", (sql) => {
      expect(packageVersion(sql)).toBe(4);
      expect(readHead(sql, 4)).toMatchObject({ origin: "old", sources: ["s1"], nextNumber: null });
      expect(readHymns(sql, 4)).toEqual(before);
      expect(sql.all("SELECT language, script FROM hymn")).toEqual([
        { language: null, script: null },
        { language: null, script: null },
      ]);
    });
  });

  it("is one transaction: a failing step leaves the file as it was", () => {
    const { files } = setup();
    putV3(files, "/old.sqlite3", "old");
    // The last column is already there, so the third ALTER fails after two succeeded.
    files.open("/old.sqlite3", (sql) => sql.exec("ALTER TABLE hymn ADD COLUMN script TEXT"));
    expect(files.open("/old.sqlite3", (sql) => migratePackage(sql, 3))).toBe(false);
    files.open("/old.sqlite3", (sql) => {
      expect(packageVersion(sql)).toBe(3);
      expect(() => sql.all("SELECT next_number FROM hymnbook")).toThrow();
      expect(() => sql.all("SELECT language FROM hymn")).toThrow();
    });
  });

  it("migrates a loaded v3 book when reconcile adopts it", async () => {
    const { ctx, files } = setup();
    putV3(files, "/old.1.sqlite3", "old");
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "old", kind: "loaded", state: "ok", songs: 2 }]);
    expect(files.open("/old.1.sqlite3", (sql) => packageVersion(sql))).toBe(4);
  });
});

describe("removing the whole book", () => {
  it("removes a book of yours like any book", async () => {
    const { ctx, files } = setup();
    const added = await addOne(ctx, 1);
    if (!added.ok) throw new Error("not added");
    expect(removeBook(ctx, added.key)).toBe(true);
    expect(files.list()).toEqual([]);
  });
});
