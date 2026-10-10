// @vitest-environment node

import { gzipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";
import { songHash } from "../src/domain/hash.ts";
import type { HymnSource } from "../src/domain/types.ts";
import { removeAssortedSongAndRecents } from "../src/persistence/books.ts";
import { LoadSession } from "../src/persistence/load.ts";
import {
  listSummaries,
  migratePackage,
  packageVersion,
  readHead,
  readHymns,
} from "../src/persistence/package-io.ts";
import {
  addAssortedSong,
  assortedStatus,
  listBooks,
  openRegistry,
  type RegistryContext,
  reconcile,
  registerHeld,
  removeAssortedSong,
  removeBook,
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

/** A one-song book as From Text makes it, as a container file. */
const oneSong = (n: number, title = `Song ${n}`): Uint8Array =>
  gzipSync(
    new TextEncoder().encode(
      JSON.stringify({ hymnbook: book("one", 1), hymns: [{ ...hymn(n), title }] }),
    ),
  );

const withHash = async (h: HymnSource) => ({ hymn: h, hash: await songHash(h) });

let keys = 0;
const newKey = () => `assorted-${++keys}`;

function loadSession(ctx: RegistryContext) {
  let k = 0;
  let t = 0;
  return new LoadSession(
    async () => ctx,
    () => `key-${++k}`,
    () => `token-${++t}`,
  );
}

describe.each(BACKENDS)("adding a song to Assorted Hymns (%s)", (backend) => {
  it("makes the book with the song as number 1 and next_number 2", async () => {
    const { ctx, files } = setupOn(backend);
    const result = await addAssortedSong(ctx, newKey, await withHash(hymn(5)), "en", "Latn");
    expect(result).toMatchObject({ ok: true, number: 1, created: true });
    if (!result.ok) return;
    const [row] = listBooks(ctx);
    expect(row).toMatchObject({
      key: result.key,
      origin: "assorted",
      kind: "assorted",
      title: "Assorted Hymns",
      language: "mul",
      script: "Zyyy",
      songs: 1,
      state: "ok",
      file: `/${result.key}.1.sqlite3`,
    });
    files.open(row?.file as string, (sql) => {
      expect(packageVersion(sql)).toBe(SCHEMA_VERSION);
      expect(readHead(sql, SCHEMA_VERSION)).toMatchObject({ origin: "assorted", nextNumber: 2 });
      const [only] = readHymns(sql, SCHEMA_VERSION);
      expect(only).toMatchObject({ number: 1, title: "Song 5", language: "en", script: "Latn" });
    });
    expect(ctx.registry.all("SELECT number FROM song")).toEqual([{ number: 1 }]);
  });

  it("appends under next_number, writes <key>.<n+1> and removes the old file", async () => {
    const { ctx, files } = setupOn(backend);
    const first = await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    const second = await addAssortedSong(ctx, newKey, await withHash(hymn(2)), "ml", "Mlym");
    if (!first.ok || !second.ok) throw new Error(`not added ${JSON.stringify([first, second])}`);
    expect(second).toMatchObject({ key: first.key, number: 2, created: false });
    expect(files.list()).toEqual([`/${first.key}.2.sqlite3`]);
    const [row] = listBooks(ctx);
    expect(row).toMatchObject({ songs: 2, kind: "assorted", file: `/${first.key}.2.sqlite3` });
    files.open(row?.file as string, (sql) => {
      expect(readHead(sql, SCHEMA_VERSION)?.nextNumber).toBe(3);
      expect(readHymns(sql, SCHEMA_VERSION).map((h) => [h.number, h.language, h.script])).toEqual([
        [1, "en", "Latn"],
        [2, "ml", "Mlym"],
      ]);
    });
    expect(ctx.registry.all("SELECT number FROM song ORDER BY number")).toEqual([
      { number: 1 },
      { number: 2 },
    ]);
  });

  it("reports a song whose hash is already there, and adds nothing", async () => {
    const { ctx, files } = setupOn(backend);
    const first = await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    await addAssortedSong(ctx, newKey, await withHash(hymn(2)), "en", "Latn");
    const again = await addAssortedSong(ctx, newKey, await withHash(hymn(2)), "ml", "Mlym");
    expect(again).toMatchObject({ ok: false, reason: "already-here", number: 2 });
    if (first.ok) expect(again).toMatchObject({ key: first.key });
    expect(listBooks(ctx)[0]?.songs).toBe(2);
    expect(files.list()).toHaveLength(1);
  });

  it("refuses a language or script that is not a tag, and writes nothing", async () => {
    const { ctx, files } = setupOn(backend);
    for (const [language, script] of [
      ["", "Latn"],
      ["en_GB", "Latn"],
      ["en", "latin"],
    ] as const) {
      expect(
        await addAssortedSong(ctx, newKey, await withHash(hymn(1)), language, script),
      ).toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(files.list()).toEqual([]);
    expect(listBooks(ctx)).toEqual([]);
  });

  it("validates the whole: a song a load would reject is refused", async () => {
    const { ctx, files } = setupOn(backend);
    const bad = { ...hymn(1), sequence: [] };
    const result = await addAssortedSong(ctx, newKey, await withHash(bad), "en", "Latn");
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(files.list()).toEqual([]);
  });

  it("never reuses a number: add, remove, add", async () => {
    const { ctx } = setupOn(backend);
    await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    await addAssortedSong(ctx, newKey, await withHash(hymn(2)), "en", "Latn");
    await removeAssortedSong(ctx, 2);
    const next = await addAssortedSong(ctx, newKey, await withHash(hymn(3)), "en", "Latn");
    expect(next).toMatchObject({ ok: true, number: 3 });
  });

  it("tells the status: the number the next song gets, and the one holding a hash", async () => {
    const { ctx } = setupOn(backend);
    expect(assortedStatus(ctx)).toEqual({ key: null, next: 1, has: null });
    const first = await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    const h = await songHash(hymn(1));
    expect(assortedStatus(ctx, h)).toEqual({
      key: first.ok ? first.key : "",
      next: 2,
      has: 1,
    });
    expect(assortedStatus(ctx, await songHash(hymn(9))).has).toBeNull();
  });
});

describe.each(BACKENDS)("removing a song from Assorted Hymns (%s)", (backend) => {
  it("writes the package without it; next_number is unchanged and the number is retired", async () => {
    const { ctx, files } = setupOn(backend);
    for (const n of [1, 2, 3]) {
      await addAssortedSong(ctx, newKey, await withHash(hymn(n)), "en", "Latn");
    }
    const result = await removeAssortedSong(ctx, 2);
    expect(result).toMatchObject({ removed: true, bookRemoved: false });
    const [row] = listBooks(ctx);
    expect(row?.songs).toBe(2);
    expect(files.list()).toEqual([row?.file]);
    files.open(row?.file as string, (sql) => {
      expect(readHymns(sql, SCHEMA_VERSION).map((h) => h.number)).toEqual([1, 3]);
      expect(readHead(sql, SCHEMA_VERSION)?.nextNumber).toBe(4);
    });
    expect(ctx.registry.all("SELECT number FROM song ORDER BY number")).toEqual([
      { number: 1 },
      { number: 3 },
    ]);
  });

  it("does nothing for a number it does not hold", async () => {
    const { ctx } = setupOn(backend);
    expect(await removeAssortedSong(ctx, 1)).toEqual({ removed: false });
    await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    expect(await removeAssortedSong(ctx, 7)).toEqual({ removed: false });
    expect(listBooks(ctx)[0]?.songs).toBe(1);
  });

  it("takes the book with the last song, as removing a book does", async () => {
    const { ctx, files, sql } = setupOn(backend);
    const added = await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    const result = await removeAssortedSong(ctx, 1);
    expect(result).toMatchObject({ removed: true, bookRemoved: true });
    if (added.ok) expect(result).toMatchObject({ key: added.key });
    expect(listBooks(ctx)).toEqual([]);
    expect(files.list()).toEqual([]);
    expect(sql.all("SELECT * FROM song")).toEqual([]);
  });

  it("makes a new book, numbered from 1, after the old one went", async () => {
    const { ctx } = setupOn(backend);
    await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    await removeAssortedSong(ctx, 1);
    const again = await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    expect(again).toMatchObject({ ok: true, number: 1, created: true });
  });

  it("drops the song's recents and position, and the whole book's when the last goes", async () => {
    const { ctx } = setupOn(backend);
    await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    await addAssortedSong(ctx, newKey, await withHash(hymn(2)), "en", "Latn");
    const calls: string[] = [];
    const state = {
      dropSong: async (k: string, n: number) => void calls.push(`song ${k} ${n}`),
      dropRecents: async (k: string) => void calls.push(`recents ${k}`),
    };
    const admin = { removeAssortedSong: async (n: number) => removeAssortedSong(ctx, n) };
    const key = listBooks(ctx)[0]?.key;
    await removeAssortedSongAndRecents(admin, state, 2);
    expect(calls).toEqual([`song ${key} 2`]);
    calls.length = 0;
    await removeAssortedSongAndRecents(admin, state, 1);
    expect(calls).toEqual([`song ${key} 1`, `recents ${key}`]);
    calls.length = 0;
    await removeAssortedSongAndRecents(admin, state, 1);
    expect(calls).toEqual([]);
  });
});

describe.each(BACKENDS)("the review and the add through a session (%s)", (backend) => {
  it("shows the number the song will get, and 'already here as n' once it is there", async () => {
    const { ctx } = setupOn(backend);
    const s = loadSession(ctx);
    const first = await s.review(oneSong(1));
    expect(first.assorted).toEqual({ key: null, next: 1, has: null });
    const added = await s.addToAssorted(first.token, "en", "Latn");
    expect(added).toMatchObject({ ok: true, number: 1, created: true, firstLoad: true });
    const second = await s.review(oneSong(2));
    expect(second.assorted).toMatchObject({ next: 2, has: null });
    const same = await s.review(oneSong(1));
    expect(same.assorted).toMatchObject({ next: 2, has: 1 });
    const refused = await s.addToAssorted(same.token, "en", "Latn");
    expect(refused).toMatchObject({ ok: false, reason: "already-here", number: 1 });
    expect(listBooks(ctx)).toHaveLength(1);
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
    const added = await s.addToAssorted(review.token, "en", "Latn");
    expect(added).toMatchObject({ ok: true, number: 1 });
    expect(listBooks(ctx).map((b) => b.kind)).toEqual(["loaded", "assorted"]);
  });

  it("offers nothing for a file of several songs", async () => {
    const { ctx, files } = setupOn(backend);
    const s = loadSession(ctx);
    const review = await s.review(
      gzipSync(new TextEncoder().encode(JSON.stringify({ hymnbook: book("b", 2), hymns }))),
    );
    expect(review.assorted).toBeUndefined();
    expect(await s.addToAssorted(review.token, "en", "Latn")).toMatchObject({
      ok: false,
      reason: "not-one-song",
    });
    expect(files.list()).toEqual([]);
    // The review is still pending: it can be loaded as a book.
    expect(await s.commit(review.token)).toMatchObject({ ok: true, action: "loaded" });
  });

  it("keeps the review when the language is wrong, so it can be corrected", async () => {
    const { ctx } = setupOn(backend);
    const s = loadSession(ctx);
    const review = await s.review(oneSong(1));
    expect(await s.addToAssorted(review.token, "not a tag", "Latn")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(await s.addToAssorted(review.token, "en", "Latn")).toMatchObject({ ok: true });
  });

  it("takes a token once, and refuses a stale one", async () => {
    const { ctx } = setupOn(backend);
    const s = loadSession(ctx);
    const review = await s.review(oneSong(1));
    const [a, b] = await Promise.all([
      s.addToAssorted(review.token, "en", "Latn"),
      s.addToAssorted(review.token, "en", "Latn"),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await s.addToAssorted("nope", "en", "Latn")).toMatchObject({
      ok: false,
      reason: "no-review",
    });
  });
});

describe("the registry's kind and its version", () => {
  it("accepts the kind assorted, and refuses another", () => {
    const { sql } = setup();
    sql.run("INSERT INTO book VALUES ('a','assorted','assorted','/a','t','mul','Zyyy',0,1,'ok')");
    expect(() =>
      sql.run("INSERT INTO book VALUES ('b','x','other','/b','t','l','s',0,1,'ok')"),
    ).toThrow();
  });

  it("rebuilds a registry of version 1, and reconcile fills it from the packages", async () => {
    const { ctx, files, sql } = setup();
    const added = await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    // The registry as the last app made it: version 1, a CHECK without assorted.
    sql.exec("DROP TABLE song; DROP TABLE source; DROP TABLE book");
    sql.exec(
      "CREATE TABLE book (key TEXT PRIMARY KEY, origin TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('shipped','loaded')), file TEXT NOT NULL, title TEXT NOT NULL, language TEXT NOT NULL, script TEXT NOT NULL, songs INTEGER NOT NULL, added_at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'ok') STRICT",
    );
    sql.exec("PRAGMA user_version = 1");
    openRegistry(sql);
    expect(listBooks(ctx)).toEqual([]);
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([
      { key: added.ok ? added.key : "", kind: "assorted", songs: 1, state: "ok" },
    ]);
    expect(files.list()).toHaveLength(1);
  });
});

describe("reconcile and Assorted Hymns", () => {
  /** A package of origin assorted in `files` with no registry row, as after a lost registry. */
  function strand(files: FakeFiles, key: string) {
    files.put(`/${key}.1.sqlite3`, key);
    files.open(`/${key}.1.sqlite3`, (sql) => sql.run("UPDATE hymnbook SET origin = 'assorted'"));
  }

  it("adopts a package of origin assorted as kind assorted", async () => {
    const { ctx, files } = setup();
    strand(files, "aaa");
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([
      { key: "aaa", origin: "assorted", kind: "assorted", state: "ok", songs: 2 },
    ]);
  });

  it("of two, the first added keeps the kind and the other is loaded", async () => {
    const { ctx, files } = setup();
    strand(files, "aaa");
    strand(files, "bbb");
    await reconcile(ctx);
    expect(
      listBooks(ctx)
        .map((b) => [b.key, b.kind])
        .sort(),
    ).toEqual([
      ["aaa", "assorted"],
      ["bbb", "loaded"],
    ]);
  });

  it("keeps the kind of a held row across a restart", async () => {
    const { ctx, files } = setup();
    await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    await reconcile(ctx);
    expect(listBooks(ctx).map((b) => b.kind)).toEqual(["assorted"]);
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
    const key = () => "crash-key";
    const ahead = setup();
    await prior(ahead.ctx);
    await latest(ahead.ctx);
    const aheadFile = listBooks(ahead.ctx)[0]?.file as string;
    const held = setup();
    await prior(held.ctx);
    const db = ahead.files.dbs.get(aheadFile);
    if (!db) throw new Error("no file ahead");
    held.files.dbs.set(aheadFile, db);
    return { ...held, aheadFile, key };
  }
  const add = (n: number) => async (ctx: RegistryContext) => {
    await addAssortedSong(ctx, () => "crash-key", await withHash(hymn(n)), "en", "Latn");
  };

  it("finishes a crashed add: the copy that holds the song takes the row and the song survives", async () => {
    const { ctx, files, aheadFile } = await crashed(add(1), add(2));
    expect(listBooks(ctx)[0]).toMatchObject({ file: "/crash-key.1.sqlite3", songs: 1 });
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([
      { key: "crash-key", kind: "assorted", state: "ok", file: aheadFile, songs: 2 },
    ]);
    expect(files.list()).toEqual([aheadFile]);
    expect(ctx.registry.all("SELECT number FROM song ORDER BY number")).toEqual([
      { number: 1 },
      { number: 2 },
    ]);
    files.open(aheadFile, (sql) => {
      expect(readHymns(sql, SCHEMA_VERSION).map((h) => h.title)).toEqual(["Song 1", "Song 2"]);
    });
  });

  it("finishes a crashed remove: the song stays removed and its number stays retired", async () => {
    const { ctx, files, aheadFile } = await crashed(
      async (c) => {
        for (const n of [1, 2, 3]) await add(n)(c);
      },
      async (c) => {
        await removeAssortedSong(c, 2);
      },
    );
    expect(listBooks(ctx)[0]?.songs).toBe(3);
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ kind: "assorted", file: aheadFile, songs: 2 }]);
    expect(files.list()).toEqual([aheadFile]);
    expect(ctx.registry.all("SELECT number FROM song ORDER BY number")).toEqual([
      { number: 1 },
      { number: 3 },
    ]);
    const next = await addAssortedSong(ctx, newKey, await withHash(hymn(4)), "en", "Latn");
    expect(next).toMatchObject({ ok: true, number: 4 });
  });
});

describe.each(BACKENDS)("listing Assorted Hymns' songs (%s)", (backend) => {
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
      await addAssortedSong(ctx, newKey, await withHash(song), language, "Latn");
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

describe.each(BACKENDS)("an Assorted Hymns that cannot be opened (%s)", (backend) => {
  async function broken() {
    const made = setupOn(backend);
    const added = await addAssortedSong(made.ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    if (!added.ok) throw new Error("not added");
    made.ctx.registry.run("UPDATE book SET state = 'unreadable' WHERE key = ?", [added.key]);
    return { ...made, key: added.key };
  }

  it("has no next number, so the review can say nothing is added", async () => {
    const { ctx, key } = await broken();
    expect(assortedStatus(ctx, await songHash(hymn(2)))).toEqual({ key, next: null, has: null });
    const review = await loadSession(ctx).review(oneSong(2));
    expect(review.assorted).toEqual({ key, next: null, has: null });
  });

  it("is not added to: a distinct reason, and nothing is written", async () => {
    const { ctx, files, key } = await broken();
    expect(await addAssortedSong(ctx, newKey, await withHash(hymn(2)), "en", "Latn")).toEqual({
      ok: false,
      reason: "unreadable",
      key,
    });
    const s = loadSession(ctx);
    const review = await s.review(oneSong(2));
    expect(await s.addToAssorted(review.token, "en", "Latn")).toMatchObject({
      ok: false,
      reason: "unreadable",
      key,
    });
    expect(files.list()).toEqual([`/${key}.1.sqlite3`]);
    await expect(removeAssortedSong(ctx, 1)).rejects.toThrow(/cannot be opened/);
  });
});

describe("registering a book that opens", () => {
  it("keeps the kind of an Assorted Hymns row that was listed unreadable", async () => {
    const { ctx } = setup();
    const added = await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    if (!added.ok) throw new Error("not added");
    const file = `/${added.key}.1.sqlite3`;
    ctx.registry.run("UPDATE book SET state = 'unreadable' WHERE key = ?", [added.key]);
    await registerHeld(ctx, file);
    expect(listBooks(ctx)).toMatchObject([{ key: added.key, kind: "assorted", state: "ok" }]);
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
  it("removes Assorted Hymns like any book", async () => {
    const { ctx, files } = setup();
    const added = await addAssortedSong(ctx, newKey, await withHash(hymn(1)), "en", "Latn");
    if (!added.ok) throw new Error("not added");
    expect(removeBook(ctx, added.key)).toBe(true);
    expect(files.list()).toEqual([]);
  });
});
