// @vitest-environment node

import type { Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { followBook, mergeSongs } from "../src/domain/assorted.ts";
import { type BackupBookFacts, backupVerdict } from "../src/domain/backup.ts";
import type { HeldBook } from "../src/domain/duplicates.ts";
import { songHash } from "../src/domain/hash.ts";
import type { HymnSource } from "../src/domain/types.ts";
import { BackupSession, writeBackup } from "../src/persistence/backup.ts";
import { packageVersion, readHead, readHymns } from "../src/persistence/package-io.ts";
import {
  addAssortedSong,
  addBook,
  assortedStatus,
  listBooks,
  type RegistryContext,
  reconcile,
  removeAssortedSong,
} from "../src/persistence/registry.ts";
import { SCHEMA_VERSION } from "./content-schema.ts";
import {
  container,
  hymn,
  loadWasm,
  type MemoryFiles,
  setup,
  setupOn,
} from "./registry-fixtures.ts";

let wasm: Sqlite3Static;
beforeAll(async () => {
  wasm = await loadWasm();
});

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

/** Song `n`'s content, whatever number it is given: a hash does not include the number. */
const song = async (n: number) => ({ hymn: hymn(n), hash: await songHash(hymn(n)) });

/** Adds songs in order with `addAssortedSong`; the book is made by the first, under `key`. */
async function addAll(ctx: RegistryContext, key: string, songs: [number, string?, string?][]) {
  for (const [n, language = "en", script = "Latn"] of songs) {
    const added = await addAssortedSong(ctx, () => key, await song(n), language, script);
    if (!added.ok) throw new Error(JSON.stringify(added));
  }
}

/** The device's Assorted Hymns as the package holds it: number, title, language, script, and the counter. */
function packageOf(s: { ctx: RegistryContext }) {
  const row = listBooks(s.ctx).find((b) => b.kind === "assorted");
  if (!row) return null;
  return s.ctx.files.open(row.file, (sql) => {
    const version = packageVersion(sql);
    if (version !== SCHEMA_VERSION) throw new Error("not current");
    return {
      key: row.key,
      file: row.file,
      next: readHead(sql, version)?.nextNumber,
      songs: readHymns(sql, version).map((h) => [h.number, h.title, h.language, h.script]),
    };
  });
}

async function backupOf(from: Store, userState: unknown = null) {
  const made = await writeBackup(from.ctx, from.files, userState, { build: "b" });
  if (!made.ok) throw new Error(made.message);
  return made;
}

async function reviewOf(into: { ctx: RegistryContext }, bytes: Uint8Array) {
  const s = session(into.ctx);
  const review = await s.review(bytes);
  if (!review.ok) throw new Error(review.refusal.message);
  return { s, review };
}

describe("the restore table for Assorted Hymns (SDD-0004 §17)", () => {
  it("restores under the backup's key as kind assorted when the device has none", async () => {
    const from = store();
    await addAll(from.ctx, "assorted-a", [[1], [2, "ml", "Mlym"], [3]]);
    await removeAssortedSong(from.ctx, 3);
    const into = store();
    const { s, review } = await reviewOf(into, (await backupOf(from)).bytes);
    expect(review.books.map((b) => [b.key, b.verdict])).toEqual([
      ["assorted-a", { kind: "restore" }],
    ]);
    const done = await s.commit(review.token);
    expect(done).toMatchObject({ ok: true, held: ["assorted-a"], firstLoad: true });
    expect(done.ok && done.books.map((b) => b.outcome)).toEqual(["restored"]);
    expect(listBooks(into.ctx).map((b) => [b.key, b.kind, b.songs, b.title])).toEqual([
      ["assorted-a", "assorted", 2, "Assorted Hymns"],
    ]);
    // The counter and each song's own language and script came with it: number 3 stays retired.
    expect(packageOf(into)).toMatchObject({
      next: 4,
      songs: [
        [1, "Song 1", "en", "Latn"],
        [2, "Song 2", "ml", "Mlym"],
      ],
    });
    expect(assortedStatus(into.ctx)).toMatchObject({ key: "assorted-a", next: 4 });
  });

  it("does nothing when the device has the same songs, under whatever key", async () => {
    const from = store();
    await addAll(from.ctx, "assorted-a", [[1], [2]]);
    const into = store();
    await addAll(into.ctx, "assorted-b", [[2], [1]]);
    const before = into.ctx.files.list();
    const { s, review } = await reviewOf(into, (await backupOf(from)).bytes);
    expect(review.books[0]?.verdict).toEqual({ kind: "already-here" });
    const done = await s.commit(review.token);
    expect(done.ok && done.books.map((b) => b.outcome)).toEqual(["already-here"]);
    expect(into.ctx.files.list()).toEqual(before);
    expect(listBooks(into.ctx).map((b) => b.key)).toEqual(["assorted-b"]);
  });

  it("does nothing when the backup's songs are all on a device that has more", async () => {
    const from = store();
    await addAll(from.ctx, "assorted-a", [[1]]);
    const into = store();
    await addAll(into.ctx, "assorted-b", [[1], [2]]);
    const { review } = await reviewOf(into, (await backupOf(from)).bytes);
    expect(review.books[0]?.verdict).toEqual({ kind: "already-here" });
  });

  it("merges when the backup holds songs the device lacks, and keeps the device's key", async () => {
    const from = store();
    await addAll(from.ctx, "assorted-a", [[1], [2]]);
    const into = store();
    await addAll(into.ctx, "assorted-b", [[1], [3]]);
    const { s, review } = await reviewOf(into, (await backupOf(from)).bytes);
    expect(review.books[0]?.verdict).toEqual({ kind: "merge", adds: 1 });
    // The review writes nothing.
    expect(packageOf(into)?.songs).toHaveLength(2);
    const done = await s.commit(review.token);
    expect(done.ok && done.books.map((b) => [b.key, b.outcome])).toEqual([
      ["assorted-a", "merged"],
    ]);
    expect(done).toMatchObject({ held: ["assorted-b"] });
    expect(listBooks(into.ctx).map((b) => [b.key, b.kind, b.songs])).toEqual([
      ["assorted-b", "assorted", 3],
    ]);
    // Backup song 2 clashed with the device's 2 (Song 3): it takes the counter, 3.
    expect(packageOf(into)).toMatchObject({
      next: 4,
      songs: [
        [1, "Song 1", "en", "Latn"],
        [2, "Song 3", "en", "Latn"],
        [3, "Song 2", "en", "Latn"],
      ],
    });
  });

  it("is not blocked by another book holding the same songs, and is not a duplicate of it", async () => {
    const from = store();
    await addAll(from.ctx, "assorted-a", [[1]]);
    const into = store();
    await addBook(into.ctx, "loaded-1", await container("one", [{ ...hymn(1) }], "1".repeat(64)));
    const { review } = await reviewOf(into, (await backupOf(from)).bytes);
    expect(review.books[0]?.verdict).toEqual({ kind: "restore" });
  });

  it("does not merge into an Assorted Hymns that cannot be opened", () => {
    const held: HeldBook[] = [
      {
        key: "assorted-b",
        title: "Assorted Hymns",
        origin: "assorted",
        kind: "assorted",
        state: "unreadable",
        sources: [],
        songs: new Map(),
      },
    ];
    const facts: BackupBookFacts = {
      key: "assorted-a",
      origin: "assorted",
      sources: [],
      songs: new Map([[1, "h1"]]),
    };
    expect(backupVerdict(facts, held)).toEqual({ kind: "conflict", replaceable: false });
  });
});

describe("the number rule of a merge (SDD-0004 §17)", () => {
  const hymnsOf = (numbers: number[]): HymnSource[] =>
    numbers.map((n) => ({ ...hymn(n), number: n, language: "en", script: "Latn" }));
  const hashes = (pairs: [number, string][]) => new Map(pairs);

  it("keeps a number at or above the counter, else takes the counter, which then moves past it", () => {
    // Device: 1 and 2 held, 3 retired, so the counter is 4.
    const plan = mergeSongs(
      { hymns: hymnsOf([1, 2]), nextNumber: 4 },
      hashes([
        [1, "a"],
        [2, "b"],
      ]),
      hymnsOf([9, 2, 3, 4, 1]),
      hashes([
        [1, "a"], // there already: skipped, points at the device's 1
        [2, "c"], // a clash with the device's 2: takes 4
        [3, "d"], // the device's retired number: takes 5, never 3
        [4, "e"], // 4 is now below the counter 6: takes 6
        [9, "f"], // 9 is above the counter 7: keeps 9
      ]),
    );
    expect(Object.fromEntries(plan.numbers)).toEqual({ 1: 1, 2: 4, 3: 5, 4: 6, 9: 9 });
    expect(plan.hymns.map((h) => h.number)).toEqual([1, 2, 4, 5, 6, 9]);
    expect(plan.nextNumber).toBe(10);
    expect(plan.added).toBe(4);
  });

  it("keeps a backup number exactly at the counter", () => {
    const plan = mergeSongs(
      { hymns: hymnsOf([1]), nextNumber: 2 },
      hashes([[1, "a"]]),
      hymnsOf([2]),
      hashes([[2, "b"]]),
    );
    expect(plan.numbers.get(2)).toBe(2);
    expect(plan.nextNumber).toBe(3);
  });

  it("takes the larger of a counter that fell behind and one past the highest held number", () => {
    const plan = mergeSongs(
      { hymns: hymnsOf([5]), nextNumber: 2 },
      hashes([[5, "a"]]),
      hymnsOf([3]),
      hashes([[3, "b"]]),
    );
    expect(plan.numbers.get(3)).toBe(6);
  });

  it("adds a song once when the backup holds the same song twice", () => {
    const plan = mergeSongs(
      { hymns: [], nextNumber: null },
      hashes([]),
      hymnsOf([1, 2]),
      hashes([
        [1, "x"],
        [2, "x"],
      ]),
    );
    expect(plan.added).toBe(1);
    expect(Object.fromEntries(plan.numbers)).toEqual({ 1: 1, 2: 1 });
  });

  it("carries each song's own language and script", () => {
    const incoming: HymnSource[] = [{ ...hymn(1), language: "ml", script: "Mlym" }];
    const plan = mergeSongs(
      { hymns: [], nextNumber: null },
      hashes([]),
      incoming,
      hashes([[1, "a"]]),
    );
    expect(plan.hymns[0]).toMatchObject({ language: "ml", script: "Mlym" });
  });
});

describe("the backup's recents and position follow the merge (SDD-0004 §17)", () => {
  it("rewrites them to the device's key and numbers, dropping a number the map does not know", () => {
    const doc = {
      version: 1,
      lastPosition: { hymnbookId: "a", hymnNumber: 3, occurrenceIndex: 0, lineIndex: null },
      recents: [
        { hymnbookId: "a", hymnNumber: 2, viewedAt: 5 },
        { hymnbookId: "a", hymnNumber: 7, viewedAt: 4 },
        { hymnbookId: "other", hymnNumber: 2, viewedAt: 3 },
      ],
    };
    const moved = followBook(
      doc,
      "a",
      "b",
      new Map([
        [2, 4],
        [3, 5],
      ]),
    );
    expect(moved).toEqual({
      version: 1,
      lastPosition: { hymnbookId: "b", hymnNumber: 5, occurrenceIndex: 0, lineIndex: null },
      recents: [
        { hymnbookId: "b", hymnNumber: 4, viewedAt: 5 },
        { hymnbookId: "other", hymnNumber: 2, viewedAt: 3 },
      ],
    });
  });

  it("drops a position on a song the map does not know, and passes a stray document through", () => {
    const doc = {
      lastPosition: { hymnbookId: "a", hymnNumber: 9, occurrenceIndex: 0, lineIndex: null },
      recents: [],
    };
    expect(followBook(doc, "a", "b", new Map())).toEqual({ recents: [] });
    expect(followBook("text", "a", "b", new Map())).toBe("text");
  });

  it("is applied to the user state a merge commit hands the page", async () => {
    const from = store();
    await addAll(from.ctx, "assorted-a", [[1], [2], [3]]);
    const into = store();
    await addAll(into.ctx, "assorted-b", [[1], [4], [5]]);
    await removeAssortedSong(into.ctx, 3);
    const state = {
      version: 1,
      lastPosition: { hymnbookId: "assorted-a", hymnNumber: 3, occurrenceIndex: 1, lineIndex: 2 },
      recents: [
        // On a song skipped as already here (device number 1).
        { hymnbookId: "assorted-a", hymnNumber: 1, viewedAt: 30 },
        // On songs added under new numbers.
        { hymnbookId: "assorted-a", hymnNumber: 2, viewedAt: 20 },
        { hymnbookId: "assorted-a", hymnNumber: 3, viewedAt: 10 },
      ],
    };
    const { s, review } = await reviewOf(into, (await backupOf(from, state)).bytes);
    const done = await s.commit(review.token);
    // Device: 1 and 2 (Song 4) held, 3 (Song 5) retired, counter 4: Song 2 -> 4, Song 3 -> 5.
    expect(packageOf(into)?.songs.map((x) => [x[0], x[1]])).toEqual([
      [1, "Song 1"],
      [2, "Song 4"],
      [4, "Song 2"],
      [5, "Song 3"],
    ]);
    expect(done.ok && done.userState).toEqual({
      version: 1,
      lastPosition: { hymnbookId: "assorted-b", hymnNumber: 5, occurrenceIndex: 1, lineIndex: 2 },
      recents: [
        { hymnbookId: "assorted-b", hymnNumber: 1, viewedAt: 30 },
        { hymnbookId: "assorted-b", hymnNumber: 4, viewedAt: 20 },
        { hymnbookId: "assorted-b", hymnNumber: 5, viewedAt: 10 },
      ],
    });
  });

  it("also points a recent at the device's copy when the whole book is already here", async () => {
    const from = store();
    await addAll(from.ctx, "assorted-a", [[1], [2]]);
    const into = store();
    await addAll(into.ctx, "assorted-b", [[2], [1]]);
    const state = {
      version: 1,
      recents: [{ hymnbookId: "assorted-a", hymnNumber: 1, viewedAt: 5 }],
    };
    const { s, review } = await reviewOf(into, (await backupOf(from, state)).bytes);
    const done = await s.commit(review.token);
    // Backup's Song 1 is the device's number 2.
    expect(done.ok && done.userState).toEqual({
      version: 1,
      recents: [{ hymnbookId: "assorted-b", hymnNumber: 2, viewedAt: 5 }],
    });
  });

  it("leaves the user state alone when the book is restored under its own key", async () => {
    const from = store();
    await addAll(from.ctx, "assorted-a", [[1]]);
    const state = {
      version: 1,
      recents: [{ hymnbookId: "assorted-a", hymnNumber: 1, viewedAt: 5 }],
    };
    const into = store();
    const { s, review } = await reviewOf(into, (await backupOf(from, state)).bytes);
    const done = await s.commit(review.token);
    expect(done.ok && done.userState).toEqual(state);
  });
});

describe("a crash mid-merge", () => {
  it("leaves the device's Assorted Hymns as it was when the package cannot be written", async () => {
    const from = store();
    await addAll(from.ctx, "assorted-a", [[1], [2]]);
    const into = setup();
    await addAll(into.ctx, "assorted-b", [[3]]);
    const before = { files: into.ctx.files.list(), pkg: packageOf(into) };
    const state = {
      version: 1,
      recents: [{ hymnbookId: "assorted-a", hymnNumber: 1, viewedAt: 1 }],
    };
    const { s, review } = await reviewOf(into, (await backupOf(from, state)).bytes);
    into.files.write = () => {
      throw new Error("killed mid-write");
    };
    const done = await s.commit(review.token);
    expect(done.ok && done.books.map((b) => [b.outcome, b.message])).toEqual([
      ["failed", "killed mid-write"],
    ]);
    // Nothing of the merge is held, and the recent is not moved onto a song that is not there.
    expect(done.ok && done.userState).toEqual(state);
    expect({ files: into.ctx.files.list(), pkg: packageOf(into) }).toEqual(before);
  });

  it("finishes a merge that wrote its package and never committed it: reconcile adopts the merged copy", async () => {
    const from = store();
    await addAll(from.ctx, "assorted-a", [[1], [2]]);
    const backup = await backupOf(from);
    // Two devices alike: one completes the merge, the other is what a crash before the commit leaves.
    const ahead = setup();
    await addAll(ahead.ctx, "assorted-b", [[2], [3]]);
    const held = setup();
    await addAll(held.ctx, "assorted-b", [[2], [3]]);
    const { s, review } = await reviewOf(ahead, backup.bytes);
    await s.commit(review.token);
    const aheadFile = packageOf(ahead)?.file as string;
    expect(aheadFile).toBe("/assorted-b.3.sqlite3");
    const db = ahead.files.dbs.get(aheadFile);
    if (!db) throw new Error("no file ahead");
    held.files.dbs.set(aheadFile, db);
    // Before reconcile the registry still names the old, smaller package.
    expect(listBooks(held.ctx)[0]).toMatchObject({ file: "/assorted-b.2.sqlite3", songs: 2 });
    await reconcile(held.ctx);
    expect(listBooks(held.ctx)).toMatchObject([
      { key: "assorted-b", kind: "assorted", state: "ok", file: aheadFile, songs: 3 },
    ]);
    expect(held.ctx.files.list()).toEqual([aheadFile]);
    expect(packageOf(held)?.songs.map((x) => x[1])).toEqual(["Song 2", "Song 3", "Song 1"]);
  });
});
