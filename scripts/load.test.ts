// @vitest-environment node

import { DatabaseSync } from "node:sqlite";
import { type GzipOptions, gzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { songHash } from "../src/domain/hash.ts";
import { insertRows, packageRows } from "../src/domain/package-rows.ts";
import type { HymnSource } from "../src/domain/types.ts";
import { removeBookAndRecents } from "../src/persistence/books.ts";
import { LoadSession } from "../src/persistence/load.ts";
import { writePackage } from "../src/persistence/package-io.ts";
import {
  addBook,
  heldBooks,
  listBooks,
  type RegistryContext,
  reconcile,
  recordSource,
  removeBook,
  replaceBook,
} from "../src/persistence/registry.ts";
import { SCHEMA_VERSION } from "./content-schema.ts";
import { book, container, hymn, hymns, setup, sqlOf } from "./registry-fixtures.ts";

const bytesOf = (id: string, h: HymnSource[] = hymns, level: GzipOptions["level"] = 9) =>
  gzipSync(new TextEncoder().encode(JSON.stringify({ hymnbook: book(id, h.length), hymns: h })), {
    level,
  });

const changed = (n: number): HymnSource => ({ ...hymn(n), title: `Song ${n}, as sung now` });
const v2 = [hymn(1), changed(2)];
const v3 = [changed(1), changed(2)];
const other = [hymn(7), hymn(8)];

function session(ctx: RegistryContext) {
  let k = 0;
  let t = 0;
  return new LoadSession(
    async () => ctx,
    () => `key-${++k}`,
    () => `token-${++t}`,
  );
}

const sources = (ctx: RegistryContext, key: string) =>
  ctx.registry.all("SELECT hash FROM source WHERE book_key = ?", [key]).map((r) => r.hash);

/** Loads a file by the default choice and returns what commit said. */
async function load(
  s: LoadSession,
  bytes: Uint8Array,
  choice?: Parameters<LoadSession["commit"]>[1],
) {
  const review = await s.review(bytes);
  return s.commit(review.token, choice);
}

describe("review", () => {
  it("shows the summary and the verdict and writes nothing", async () => {
    const { ctx, files } = setup();
    const review = await session(ctx).review(bytesOf("b"));
    expect(review).toMatchObject({
      title: "A Book",
      language: "en",
      script: "Latn",
      origin: "b",
      songCount: 2,
      violations: [],
      verdict: { kind: "new" },
      held: { count: 0, books: [] },
    });
    expect(review.token).not.toBe("");
    expect(files.list()).toEqual([]);
    expect(listBooks(ctx)).toEqual([]);
  });

  it("rejects a file with a violation whole, with no token and no verdict, and writes nothing", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    const bad = bytesOf("b", [hymn(1), { ...hymn(2), parts: [] }]);
    const review = await s.review(bad);
    expect(review.violations.length).toBeGreaterThan(0);
    expect(review.verdict).toBeUndefined();
    expect(review.token).toBe("");
    expect(await s.commit("", "keep-both")).toMatchObject({ ok: false, reason: "no-review" });
    const notGzip = await s.review(new TextEncoder().encode("hello"));
    expect(notGzip.violations).toHaveLength(1);
    expect(files.list()).toEqual([]);
    expect(listBooks(ctx)).toEqual([]);
  });

  it("counts songs held in other books, by book, without changing the verdict", async () => {
    const { ctx } = setup();
    const s = session(ctx);
    await load(s, bytesOf("a", hymns));
    const review = await s.review(bytesOf("b", [hymn(1), hymn(5)]));
    expect(review.verdict).toEqual({ kind: "new" });
    expect(review.held).toEqual({ count: 1, books: [{ key: "key-1", title: "A Book", count: 1 }] });
  });

  it("holds one review at a time: a second pick replaces the first", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    const first = await s.review(bytesOf("a"));
    const second = await s.review(bytesOf("b"));
    expect(await s.commit(first.token)).toMatchObject({ ok: false, reason: "no-review" });
    expect(await s.commit(second.token)).toMatchObject({ ok: true, action: "loaded" });
    expect(listBooks(ctx).map((b) => b.origin)).toEqual(["b"]);
    expect(files.list()).toHaveLength(1);
  });

  it("is thrown away by cancel, and nothing is written", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    const review = await s.review(bytesOf("a"));
    expect(s.cancel("not-it")).toBe(false);
    expect(s.cancel(review.token)).toBe(true);
    expect(await s.commit(review.token)).toMatchObject({ ok: false, reason: "no-review" });
    expect(files.list()).toEqual([]);
    expect(listBooks(ctx)).toEqual([]);
  });
});

describe("commit, by the verdict", () => {
  it("row 4: a new book, a package and its rows", async () => {
    const { ctx, files } = setup();
    const result = await load(session(ctx), bytesOf("a"));
    expect(result).toMatchObject({ ok: true, action: "loaded", key: "key-1" });
    expect(files.list()).toEqual(["/key-1.1.sqlite3"]);
    expect(listBooks(ctx)).toMatchObject([{ key: "key-1", origin: "a", kind: "loaded", songs: 2 }]);
    expect(sources(ctx, "key-1")).toHaveLength(1);
  });

  it("row 1: the same file twice writes nothing the second time", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    const file = bytesOf("a");
    await load(s, file);
    const before = JSON.stringify([listBooks(ctx), ctx.registry.all("SELECT * FROM source")]);
    const review = await s.review(file);
    expect(review.verdict).toEqual({ kind: "same-file", book: { key: "key-1", title: "A Book" } });
    expect(await s.commit(review.token)).toEqual({ ok: true, action: "opened", key: "key-1" });
    expect(files.list()).toEqual(["/key-1.1.sqlite3"]);
    expect(JSON.stringify([listBooks(ctx), ctx.registry.all("SELECT * FROM source")])).toBe(before);
  });

  it("row 2: the same songs repacked records the hash in the package and the registry", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    await load(s, bytesOf("a", hymns, 9));
    const repacked = bytesOf("a", hymns, 1);
    const review = await s.review(repacked);
    expect(review.verdict).toMatchObject({ kind: "same-songs", book: { key: "key-1" } });
    expect(await s.commit(review.token)).toEqual({ ok: true, action: "recorded", key: "key-1" });
    expect(files.list()).toEqual(["/key-1.1.sqlite3"]);
    const inRegistry = sources(ctx, "key-1");
    expect(inRegistry).toHaveLength(2);
    const inPackage = files.open("/key-1.1.sqlite3", (sql) =>
      JSON.parse(sql.all("SELECT sources FROM hymnbook")[0].sources as string),
    );
    expect([...inPackage].sort()).toEqual([...inRegistry].sort());
    expect(inRegistry).toContain(review.sourceHash);
    // Loaded again, it is now the same file.
    expect((await s.review(repacked)).verdict).toMatchObject({ kind: "same-file" });
  });

  it("row 3: Keep both (the default) loads a second book of the same origin", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    await load(s, bytesOf("a", hymns));
    const review = await s.review(bytesOf("a", v2));
    expect(review.verdict).toEqual({
      kind: "same-origin",
      books: [{ key: "key-1", title: "A Book", replaceable: true }],
    });
    expect(await s.commit(review.token)).toMatchObject({
      ok: true,
      action: "kept-both",
      key: "key-2",
    });
    expect(listBooks(ctx).map((b) => [b.key, b.origin])).toEqual([
      ["key-1", "a"],
      ["key-2", "a"],
    ]);
    expect(files.list().sort()).toEqual(["/key-1.1.sqlite3", "/key-2.1.sqlite3"]);
    // The next load of that origin finds two books, Replace offered for each.
    const next = await s.review(bytesOf("a", v3));
    expect(next.verdict).toMatchObject({
      kind: "same-origin",
      books: [
        { key: "key-1", replaceable: true },
        { key: "key-2", replaceable: true },
      ],
    });
  });

  it("row 3: Replace keeps the key and the added time, swaps the rows, and removes the old file", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    await load(s, bytesOf("a", hymns));
    const before = listBooks(ctx)[0];
    const old = bytesOf("a", hymns);
    const review = await s.review(bytesOf("a", v3));
    expect(await s.commit(review.token, { replace: "key-1" })).toEqual({
      ok: true,
      action: "replaced",
      key: "key-1",
    });
    expect(files.list()).toEqual(["/key-1.2.sqlite3"]);
    const [after] = listBooks(ctx);
    expect(after).toMatchObject({
      key: "key-1",
      file: "/key-1.2.sqlite3",
      addedAt: before.addedAt,
    });
    expect(sources(ctx, "key-1")).toEqual([review.sourceHash]);
    const held = heldBooks(ctx)[0];
    expect(held.songs.size).toBe(2);
    expect(held.songs.get(1)).toBe(await songHash(changed(1)));
    // The old file, loaded again, is a row-3 case, not row 1.
    expect((await s.review(old)).verdict).toMatchObject({ kind: "same-origin" });
    // The package says what the registry says.
    const head = files.open(
      "/key-1.2.sqlite3",
      (sql) => sql.all("SELECT id, sources FROM hymnbook")[0],
    );
    expect(head).toEqual({ id: "key-1", sources: JSON.stringify([review.sourceHash]) });
  });

  it("row 3: Replace is refused for a shipped book and for a key the verdict does not name", async () => {
    const { ctx, files } = setup(["a"]);
    files.put("/a.sqlite3", "a", hymns);
    await reconcile(ctx);
    const s = session(ctx);
    const review = await s.review(bytesOf("a", v2));
    expect(review.verdict).toMatchObject({
      kind: "same-origin",
      books: [{ key: "a", replaceable: false }],
    });
    expect(await s.commit(review.token, { replace: "a" })).toMatchObject({
      ok: false,
      reason: "not-offered",
    });
    expect(await s.commit(review.token, { replace: "nobody" })).toMatchObject({
      reason: "not-offered",
    });
    expect(files.list()).toEqual(["/a.sqlite3"]);
    // Keep both is offered, and the review is still pending.
    expect(await s.commit(review.token)).toMatchObject({ ok: true, action: "kept-both" });
  });

  it("is refused as stale when the books held changed since the review", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    const review = await s.review(bytesOf("a"));
    await addBook(ctx, "other", await container("a"));
    expect(await s.commit(review.token)).toMatchObject({ ok: false, reason: "stale" });
    expect(files.list()).toEqual(["/other.1.sqlite3"]);
  });

  it("writes nothing when the package write fails, and keeps the review", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    const review = await s.review(bytesOf("a"));
    files.failQuery.set("/key-1.1.sqlite3", new Error("disk full"));
    expect(await s.commit(review.token)).toMatchObject({
      ok: false,
      reason: "failed",
      message: "disk full",
    });
    files.failQuery.clear();
    expect(files.list()).toEqual([]);
    expect(listBooks(ctx)).toEqual([]);
    expect(await s.commit(review.token)).toMatchObject({ ok: true, action: "loaded" });
  });
});

describe("the first load", () => {
  it("is flagged once, so the caller asks for persistent storage", async () => {
    const { ctx } = setup();
    const s = session(ctx);
    expect(await load(s, bytesOf("a"))).toMatchObject({
      ok: true,
      action: "loaded",
      firstLoad: true,
    });
    expect(await load(s, bytesOf("b", other))).not.toHaveProperty("firstLoad");
  });

  it("is not flagged when nothing is written, or when the book was already there", async () => {
    const { ctx } = setup();
    const s = session(ctx);
    const file = bytesOf("a");
    await load(s, file);
    expect(await load(s, file)).not.toHaveProperty("firstLoad");
    expect(await load(s, bytesOf("a", hymns, 1))).not.toHaveProperty("firstLoad");
    expect(await load(s, bytesOf("a", v2))).not.toHaveProperty("firstLoad"); // Keep both
  });

  it("is flagged again at the first load after every loaded book was removed", async () => {
    const { ctx } = setup();
    const s = session(ctx);
    await load(s, bytesOf("a"));
    removeBook(ctx, "key-1");
    expect(await load(s, bytesOf("b", other))).toMatchObject({ firstLoad: true });
  });

  it("is not flagged when only a shipped book is held and the first loaded book is the first", async () => {
    const { ctx, files } = setup(["s"]);
    files.put("/s.sqlite3", "s", [hymn(40)]);
    await reconcile(ctx);
    expect(await load(session(ctx), bytesOf("a"))).toMatchObject({ firstLoad: true });
  });
});

describe("remove", () => {
  it("leaves no file and no row, and drops the book's recents", async () => {
    const { ctx, files, sql } = setup();
    const s = session(ctx);
    await load(s, bytesOf("a"));
    await load(s, bytesOf("b", other));
    const dropped: string[] = [];
    const removed = await removeBookAndRecents(
      {
        removeBook: async (k) =>
          (await import("../src/persistence/registry.ts")).removeBook(ctx, k),
      },
      { dropRecents: async (k) => void dropped.push(k) },
      "key-1",
    );
    expect(removed).toBe(true);
    expect(dropped).toEqual(["key-1"]);
    expect(files.list()).toEqual(["/key-2.1.sqlite3"]);
    expect(listBooks(ctx).map((b) => b.key)).toEqual(["key-2"]);
    expect(sql.all("SELECT * FROM source WHERE book_key = 'key-1'")).toEqual([]);
    expect(sql.all("SELECT * FROM song WHERE book_key = 'key-1'")).toEqual([]);
  });

  it("drops no recents for a key that is not held", async () => {
    const dropped: string[] = [];
    expect(
      await removeBookAndRecents(
        { removeBook: async () => false },
        { dropRecents: async (k) => void dropped.push(k) },
        "nobody",
      ),
    ).toBe(false);
    expect(dropped).toEqual([]);
  });
});

/**
 * A kill is a write that stops where it is: later steps, and the cleanup of a
 * failed write, never run. Patches the context's registry and files for the
 * duration of `fn`, then puts them back (the next start).
 */
async function killed<T>(
  ctx: RegistryContext,
  point: "before-commit" | "after-commit" | "row-2",
  fn: () => Promise<T> | T,
): Promise<{ error?: unknown; value?: T }> {
  const registry = ctx.registry;
  const files = ctx.files;
  const realRun = registry.run;
  const realRemove = files.remove;
  let dead = false;
  registry.run = (sql, bind) => {
    const stops =
      (point === "before-commit" && sql.startsWith("INSERT INTO book")) ||
      (point === "row-2" && sql.startsWith("INSERT OR IGNORE INTO source"));
    if (stops) {
      dead = true;
      throw new Error("killed");
    }
    return realRun(sql, bind);
  };
  files.remove = (file) => {
    if (dead || point === "after-commit") {
      dead = true;
      throw new Error("killed");
    }
    return realRemove.call(files, file);
  };
  try {
    return { value: await fn() };
  } catch (error) {
    return { error };
  } finally {
    registry.run = realRun;
    files.remove = realRemove;
  }
}

describe("a killed Replace heals at the next start (SDD-0004 §8)", () => {
  async function setupReplace() {
    const s = setup();
    await addBook(s.ctx, "k", await container("o", hymns, "1".repeat(64)));
    return s;
  }

  it("killed before the row's commit: the finished copy takes the row, the old file goes", async () => {
    const { ctx, files } = await setupReplace();
    const before = listBooks(ctx)[0];
    const next = await container("o", v2, "2".repeat(64));
    const { error } = await killed(ctx, "before-commit", () => replaceBook(ctx, "k", next));
    expect(error).toBeInstanceOf(Error);
    // The row still names the old file; the new copy is there, unrecorded.
    expect(files.list().sort()).toEqual(["/k.1.sqlite3", "/k.2.sqlite3"]);
    expect(listBooks(ctx)[0].file).toBe("/k.1.sqlite3");

    await reconcile(ctx); // the next start
    const rows = listBooks(ctx);
    expect(rows[0]).toMatchObject({
      key: "k",
      file: "/k.2.sqlite3",
      state: "ok",
      addedAt: before.addedAt,
    });
    expect(sources(ctx, "k")).toEqual(["2".repeat(64)]);
    expect(
      heldBooks(ctx)
        .find((b) => b.key === "k")
        ?.songs.get(2),
    ).not.toBe(
      heldBooks(ctx)
        .find((b) => b.key === "k")
        ?.songs.get(1),
    );
    // The old file, provably superseded (same key and origin, readable), is deleted.
    expect(rows.map((r) => [r.key, r.state])).toEqual([["k", "ok"]]);
    expect(files.list()).toEqual(["/k.2.sqlite3"]);
    const again = JSON.stringify(listBooks(ctx));
    await reconcile(ctx);
    expect(JSON.stringify(listBooks(ctx))).toBe(again);
  });

  it("killed after the commit, before the old file goes: the new row stands, the old goes at start", async () => {
    const { ctx, files } = await setupReplace();
    // The remove fails after the commit; replaceBook treats that as a leftover.
    const next = await container("o", v2, "2".repeat(64));
    await killed(ctx, "after-commit", () => replaceBook(ctx, "k", next));
    expect(listBooks(ctx)[0]).toMatchObject({ key: "k", file: "/k.2.sqlite3" });
    expect(files.list().sort()).toEqual(["/k.1.sqlite3", "/k.2.sqlite3"]);
    await reconcile(ctx);
    expect(listBooks(ctx).map((r) => [r.key, r.file, r.state])).toEqual([
      ["k", "/k.2.sqlite3", "ok"],
    ]);
    expect(files.list()).toEqual(["/k.2.sqlite3"]);
  });

  it("a higher copy of another origin is a stray, not a Replace", async () => {
    const { ctx, files } = await setupReplace();
    files.put("/k.2.sqlite3", "k", v2); // its origin is "k", the row's is "o"
    await reconcile(ctx);
    expect(listBooks(ctx).map((r) => [r.key, r.file, r.state])).toEqual([
      ["k", "/k.1.sqlite3", "ok"],
      ["k.2", "/k.2.sqlite3", "unreadable"],
    ]);
  });

  it("a lower copy is never preferred over the row's file", async () => {
    const { ctx, files } = setup();
    await addBook(ctx, "k", await container("o"), 2);
    files.put("/k.1.sqlite3", "o", v2);
    files.open("/k.1.sqlite3", (sql) => sql.run("UPDATE hymnbook SET id = 'k'"));
    await reconcile(ctx);
    expect(listBooks(ctx).find((r) => r.key === "k")?.file).toBe("/k.2.sqlite3");
  });

  it("a Replace after a leftover picks a generation past every file of the key", async () => {
    const { ctx, files } = await setupReplace();
    files.put("/k.2.sqlite3", "stray"); // a kept leftover that is not this book's
    await replaceBook(ctx, "k", await container("o", v2, "2".repeat(64)));
    expect(listBooks(ctx).find((r) => r.key === "k")?.file).toBe("/k.3.sqlite3");
    expect(files.list().sort()).toEqual(["/k.2.sqlite3", "/k.3.sqlite3"]);
  });
});

describe("a killed row-2 write heals at the next start", () => {
  it("the package is ahead of the registry, and reconcile copies the hash over", async () => {
    const { ctx } = setup();
    await addBook(ctx, "k", await container("o", hymns, "1".repeat(64)));
    const { error } = await killed(ctx, "row-2", () => recordSource(ctx, "k", "r".repeat(64)));
    expect(error).toBeInstanceOf(Error);
    expect(sources(ctx, "k")).toEqual(["1".repeat(64)]);
    await reconcile(ctx);
    expect([...(sources(ctx, "k") as string[])].sort()).toEqual(["1".repeat(64), "r".repeat(64)]);
  });
});

describe("privacy (SDD-0004 §11)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("makes no request through a read, a review and every commit", async () => {
    const calls: string[] = [];
    const spy = (name: string) =>
      vi.fn(() => {
        calls.push(name);
        throw new Error(`${name} was called`);
      });
    vi.stubGlobal("fetch", spy("fetch"));
    vi.stubGlobal("XMLHttpRequest", spy("XMLHttpRequest"));
    vi.stubGlobal("WebSocket", spy("WebSocket"));
    vi.stubGlobal("navigator", { sendBeacon: spy("sendBeacon") });

    const { ctx } = setup();
    const s = session(ctx);
    const a = bytesOf("a");
    expect(await load(s, a)).toMatchObject({ ok: true, action: "loaded" });
    expect(await load(s, a)).toMatchObject({ ok: true, action: "opened" });
    expect(await load(s, bytesOf("a", hymns, 1))).toMatchObject({ action: "recorded" });
    expect(await load(s, bytesOf("a", v2))).toMatchObject({ action: "kept-both" });
    expect(await load(s, bytesOf("a", v3), { replace: "key-1" })).toMatchObject({
      action: "replaced",
    });
    const bad = await s.review(bytesOf("a", [{ ...hymn(1), parts: [] }]));
    expect(bad.violations.length).toBeGreaterThan(0);
    const cancelled = await s.review(bytesOf("z"));
    s.cancel(cancelled.token);
    expect(calls).toEqual([]);
  });
});

describe("overlapping calls", () => {
  it("two commits of one token write once, and a Replace loses no file", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    await load(s, bytesOf("a", hymns));
    const review = await s.review(bytesOf("a", v3));
    const [one, two] = await Promise.all([
      s.commit(review.token, { replace: "key-1" }),
      s.commit(review.token, { replace: "key-1" }),
    ]);
    expect([one.ok, two.ok].sort()).toEqual([false, true]);
    expect([one, two].find((r) => !r.ok)).toMatchObject({ reason: "no-review" });
    expect(files.list()).toEqual(["/key-1.2.sqlite3"]);
    expect(listBooks(ctx)).toMatchObject([{ key: "key-1", file: "/key-1.2.sqlite3", state: "ok" }]);
    expect(
      files.open("/key-1.2.sqlite3", (sql) => sql.all("SELECT COUNT(*) AS n FROM hymn")[0].n),
    ).toBe(2);
  });

  it("two commits of one Keep both or new review write one book", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    const review = await s.review(bytesOf("a"));
    const both = await Promise.all([s.commit(review.token), s.commit(review.token)]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(files.list()).toHaveLength(1);
    expect(listBooks(ctx)).toHaveLength(1);
  });

  it("a file that is already there is never opened over or removed by a failed write", async () => {
    const { ctx, files } = setup();
    await addBook(ctx, "k", await container("o"));
    await expect(addBook(ctx, "k", await container("o"))).rejects.toThrow("already exists");
    expect(files.list()).toEqual(["/k.1.sqlite3"]);
    expect(listBooks(ctx)).toHaveLength(1);
  });

  it("only the latest review becomes pending, whatever order they finish in", async () => {
    const { ctx } = setup();
    const s = session(ctx);
    const big = Array.from({ length: 300 }, (_, i) => hymn(i + 1));
    const first = s.review(bytesOf("a", big));
    const second = s.review(bytesOf("b", other));
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.token).toBe("");
    expect(r2.token).not.toBe("");
    expect(await s.commit(r2.token)).toMatchObject({ ok: true });
    expect(listBooks(ctx).map((b) => b.origin)).toEqual(["b"]);
  });

  it("a commit that finishes late does not wipe a review begun during its write", async () => {
    const { ctx } = setup();
    const s = session(ctx);
    const a = await s.review(bytesOf("a"));
    const committing = s.commit(a.token);
    const b = await s.review(bytesOf("b", other));
    await committing;
    expect(await s.commit(b.token)).toMatchObject({ ok: true, action: "loaded" });
    expect(
      listBooks(ctx)
        .map((x) => x.origin)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  describe("a queue looked at out of order (SDD-0004 §9)", () => {
    it("a book looked at again takes a fresh review, and only the last review's token commits", async () => {
      const { ctx } = setup();
      const s = session(ctx);
      const a1 = await s.review(bytesOf("a"));
      const b = await s.review(bytesOf("b", other));
      const a2 = await s.review(bytesOf("a"));
      // Each review replaced the one before: only the one in view can be committed.
      expect(await s.commit(a1.token)).toMatchObject({ ok: false, reason: "no-review" });
      expect(await s.commit(b.token)).toMatchObject({ ok: false, reason: "no-review" });
      expect(await s.commit(a2.token)).toMatchObject({ ok: true, action: "loaded" });
      expect(listBooks(ctx).map((x) => x.origin)).toEqual(["a"]);
    });

    it("books decided in the reverse of their order each load once, whatever was looked at between", async () => {
      const { ctx, files } = setup();
      const s = session(ctx);
      const three = [bytesOf("a"), bytesOf("b", other), bytesOf("c", [hymn(20), hymn(21)])];
      // Look through all three, Next, Next, then decide from the last back to the first.
      for (const bytes of three) await s.review(bytes);
      for (const bytes of [...three].reverse()) {
        const review = await s.review(bytes);
        expect(await s.commit(review.token)).toMatchObject({ ok: true, action: "loaded" });
      }
      expect(
        listBooks(ctx)
          .map((x) => x.origin)
          .sort(),
      ).toEqual(["a", "b", "c"]);
      expect(files.list()).toHaveLength(3);
    });

    it("a verdict goes stale when an earlier decision changes the books, and the review read again is right", async () => {
      const { ctx } = setup();
      const s = session(ctx);
      // Two editions of one book, looked at before either is loaded: both read as new.
      const first = await s.review(bytesOf("a", v2));
      expect(first.verdict).toMatchObject({ kind: "new" });
      const second = await s.review(bytesOf("a", v3));
      expect(second.verdict).toMatchObject({ kind: "new" });
      expect(await s.commit(second.token)).toMatchObject({ ok: true, action: "loaded" });
      // Back to the first: read again, it is another edition of the book now held.
      const again = await s.review(bytesOf("a", v2));
      expect(again.verdict).toMatchObject({ kind: "same-origin" });
      expect(await s.commit(again.token, "keep-both")).toMatchObject({
        ok: true,
        action: "kept-both",
      });
      expect(listBooks(ctx)).toHaveLength(2);
    });

    it("commits run one at a time while the next book is already being reviewed, none touching another's file", async () => {
      const { ctx, files } = setup();
      const s = session(ctx);
      const a = await s.review(bytesOf("a"));
      // A is being written; B is read and decided, and C's review begins, before A is done.
      const writingA = s.commit(a.token);
      const b = await s.review(bytesOf("b", other));
      const writingB = s.commit(b.token);
      const c = await s.review(bytesOf("c", [hymn(20), hymn(21)]));
      const [doneA, doneB] = await Promise.all([writingA, writingB]);
      expect(doneA).toMatchObject({ ok: true, action: "loaded" });
      expect(doneB).toMatchObject({ ok: true, action: "loaded" });
      // C's review, begun during the writes, survives them.
      expect(await s.commit(c.token)).toMatchObject({ ok: true, action: "loaded" });
      const keys = listBooks(ctx).map((x) => x.key);
      expect(new Set(keys).size).toBe(3);
      expect(files.list().sort()).toEqual(keys.map((k) => `/${k}.1.sqlite3`).sort());
    });

    it("a failed write keeps its review only while no other has begun", async () => {
      const { ctx, files } = setup();
      const s = session(ctx);
      const a = await s.review(bytesOf("a"));
      files.failQuery.set("/key-1.1.sqlite3", new Error("disk full"));
      expect(await s.commit(a.token)).toMatchObject({ ok: false, reason: "failed" });
      files.failQuery.clear();
      // Nothing else began: the same review can be committed again.
      expect(await s.commit(a.token)).toMatchObject({ ok: true });
      // A review begun while a write fails is kept, not pushed out by the failed one coming back.
      const b = await s.review(bytesOf("b", other));
      files.failQuery.set("/key-3.1.sqlite3", new Error("disk full"));
      const failedB = s.commit(b.token);
      const c = await s.review(bytesOf("c", [hymn(20), hymn(21)]));
      expect(await failedB).toMatchObject({ ok: false, reason: "failed" });
      files.failQuery.clear();
      expect(await s.commit(b.token)).toMatchObject({ ok: false, reason: "no-review" });
      expect(await s.commit(c.token)).toMatchObject({ ok: true });
    });
  });

  it("refuses a Replace choice on a verdict that has no such key, and keeps the review", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    const review = await s.review(bytesOf("a"));
    expect(await s.commit(review.token, { replace: "nobody" })).toMatchObject({
      ok: false,
      reason: "not-offered",
    });
    expect(files.list()).toEqual([]);
    expect(await s.commit(review.token)).toMatchObject({ ok: true, action: "loaded" });
  });

  it("compares verdicts by content, not by the order of the rows", async () => {
    const { sameVerdict } = await import("../src/domain/duplicates.ts");
    const b = (key: string) => ({ key, title: "t", replaceable: true });
    expect(
      sameVerdict(
        { kind: "same-origin", books: [b("1"), b("2")] },
        { kind: "same-origin", books: [b("2"), b("1")] },
      ),
    ).toBe(true);
    expect(
      sameVerdict(
        { kind: "same-origin", books: [b("1")] },
        { kind: "same-origin", books: [b("2")] },
      ),
    ).toBe(false);
  });
});

describe("Load Again: a review aimed at a held book (SDD-0004 §9)", () => {
  /** A loaded book that cannot be opened: its package lost its hymnbook table. */
  async function damaged() {
    const { ctx, files } = setup();
    const s = session(ctx);
    await load(s, bytesOf("a", hymns));
    files.open("/key-1.1.sqlite3", (sql) => sql.exec("DROP TABLE hymnbook"));
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "key-1", state: "unreadable" }]);
    return { ctx, files, s };
  }

  it("restores the book under its key, whatever the file's origin, and says so", async () => {
    const { ctx, files, s } = await damaged();
    const before = listBooks(ctx)[0];
    const review = await s.review(bytesOf("another-origin", v2), "key-1");
    expect(review.verdict).toBeUndefined();
    expect(review.restore).toEqual({
      key: "key-1",
      title: "A Book",
      state: "unreadable",
      titleMatches: true,
    });
    expect(await s.commit(review.token)).toEqual({ ok: true, action: "restored", key: "key-1" });
    expect(files.list()).toEqual(["/key-1.2.sqlite3"]);
    expect(listBooks(ctx)).toMatchObject([
      { key: "key-1", origin: "another-origin", state: "ok", songs: 2, addedAt: before.addedAt },
    ]);
    expect(sources(ctx, "key-1")).toEqual([review.sourceHash]);
  });

  it("warns when the file's title is not the held book's, and not when it is, or when the book has none", async () => {
    const { ctx, s } = await damaged();
    ctx.registry.run("UPDATE book SET title = 'A Different Book' WHERE key = 'key-1'");
    expect((await s.review(bytesOf("a"), "key-1")).restore).toMatchObject({ titleMatches: false });
    ctx.registry.run("UPDATE book SET title = ' a book ' WHERE key = 'key-1'");
    expect((await s.review(bytesOf("a"), "key-1")).restore).toMatchObject({ titleMatches: true });
    ctx.registry.run("UPDATE book SET title = key WHERE key = 'key-1'");
    expect((await s.review(bytesOf("a"), "key-1")).restore).not.toHaveProperty("titleMatches");
  });

  it("does not ask the duplicate verdict, so a file held in another book can still restore", async () => {
    const { ctx, s } = await damaged();
    await load(s, bytesOf("b", other));
    const review = await s.review(bytesOf("b", other), "key-1");
    expect(review.verdict).toBeUndefined();
    expect(await s.commit(review.token)).toMatchObject({ ok: true, action: "restored" });
    expect(listBooks(ctx).map((b) => b.state)).toEqual(["ok", "ok"]);
  });

  it("refuses a target that is not held, or is shipped", async () => {
    const { ctx, files } = setup(["a"]);
    files.put("/a.sqlite3", "a", hymns);
    await reconcile(ctx);
    const s = session(ctx);
    await expect(s.review(bytesOf("a", v2), "a")).rejects.toThrow(/not a loaded book/);
    await expect(s.review(bytesOf("a", v2), "nobody")).rejects.toThrow(/not a loaded book/);
  });

  it("is refused as stale when the target is removed before the commit, and writes nothing", async () => {
    const { ctx, files, s } = await damaged();
    const review = await s.review(bytesOf("a", v2), "key-1");
    removeBook(ctx, "key-1");
    expect(await s.commit(review.token)).toMatchObject({ ok: false, reason: "stale" });
    expect(files.list()).toEqual([]);
  });

  it("refuses when the target became readable between the review and the commit, and writes nothing", async () => {
    const { ctx, files, s } = await damaged();
    const review = await s.review(bytesOf("a", v2), "key-1");
    files.open("/key-1.1.sqlite3", (sql) => sql.exec("CREATE TABLE hymnbook (id TEXT)"));
    ctx.registry.run("UPDATE book SET state = 'ok' WHERE key = 'key-1'");
    expect(await s.commit(review.token)).toMatchObject({ ok: false, reason: "stale" });
    expect(files.list()).toEqual(["/key-1.1.sqlite3"]);
  });

  it("refuses when the target's file changed between the review and the commit", async () => {
    const { ctx, files, s } = await damaged();
    const review = await s.review(bytesOf("a", v2), "key-1");
    ctx.registry.run("UPDATE book SET file = '/key-1.2.sqlite3' WHERE key = 'key-1'");
    expect(await s.commit(review.token)).toMatchObject({ ok: false, reason: "stale" });
    expect(files.list()).toEqual(["/key-1.1.sqlite3"]);
  });

  it("restores a book whose registry state is ok but whose file has gone", async () => {
    const { ctx, files } = setup();
    const s = session(ctx);
    await load(s, bytesOf("a", hymns));
    const review = await s.review(bytesOf("a", v3), "key-1");
    files.remove("/key-1.1.sqlite3");
    expect(await s.commit(review.token)).toMatchObject({ ok: true, action: "replaced" });
    expect(listBooks(ctx)[0].file).toBe("/key-1.2.sqlite3");
  });

  it("refuses a book that needs a newer app, at the review and at the commit", async () => {
    const { ctx, files, s } = await damaged();
    ctx.registry.run("UPDATE book SET state = 'needs-newer-app' WHERE key = 'key-1'");
    await expect(s.review(bytesOf("a", v2), "key-1")).rejects.toThrow(/needs a newer app/);
    ctx.registry.run("UPDATE book SET state = 'unreadable' WHERE key = 'key-1'");
    const review = await s.review(bytesOf("a", v2), "key-1");
    ctx.registry.run("UPDATE book SET state = 'needs-newer-app' WHERE key = 'key-1'");
    expect(await s.commit(review.token)).toMatchObject({ ok: false, reason: "stale" });
    expect(files.list()).toEqual(["/key-1.1.sqlite3"]);
  });
});

describe("progress (SDD-0004 §14)", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => hymn(i + 1));

  it("a review reports reading, then the songs checked, then the songs hashed", async () => {
    const { ctx } = setup();
    const heard: { phase: string; done: number; total: number }[] = [];
    await session(ctx).review(bytesOf("b", many(3)), undefined, (p) => heard.push(p));
    expect(heard[0]).toEqual({ phase: "reading", done: 0, total: 0 });
    expect(heard.at(-1)).toEqual({ phase: "hashing", done: 3, total: 3 });
    expect(heard.some((p) => p.phase === "checking" && p.done === 3 && p.total === 3)).toBe(true);
  });

  it("a commit reports each song written, then the indexing, and nothing after the book is held", async () => {
    const { ctx } = setup();
    const s = session(ctx);
    const review = await s.review(bytesOf("b", many(3)));
    const heard: string[] = [];
    const result = await s.commit(review.token, undefined, (p) =>
      heard.push(`${p.phase} ${p.done}/${p.total}`),
    );
    expect(result).toMatchObject({ ok: true, action: "loaded" });
    expect(heard).toEqual(["saving 1/3", "saving 3/3", "indexing 0/0"]);
    expect(listBooks(ctx)).toHaveLength(1);
  });

  it("a Replace reports its writing too", async () => {
    const { ctx } = setup();
    const s = session(ctx);
    await load(s, bytesOf("a", many(2)));
    const review = await s.review(bytesOf("a", many(3)));
    const heard: string[] = [];
    await s.commit(review.token, { replace: "key-1" }, (p) => heard.push(p.phase));
    expect(heard).toContain("saving");
    expect(heard.at(-1)).toBe("indexing");
  });

  it("a commit without a listener writes the same", async () => {
    const { ctx, files } = setup();
    expect(await load(session(ctx), bytesOf("b", many(3)))).toMatchObject({ ok: true });
    expect(files.list()).toEqual(["/key-1.1.sqlite3"]);
  });
});

describe("writing a package", () => {
  const forty = Array.from({ length: 40 }, (_, i) => hymn(i + 1));
  const rowsOf = (songs: HymnSource[]) =>
    packageRows(book("p", songs.length), songs, {
      key: "p",
      origin: "p",
      sources: ["s"],
      contentHash: "c",
      schemaVersion: SCHEMA_VERSION,
    });
  const dump = (sql: ReturnType<typeof sqlOf>) =>
    ["hymnbook", "hymn", "part", "line", "sequence_entry"].map((t) =>
      sql.all(`SELECT * FROM ${t} ORDER BY 1, 2, 3`),
    );

  it("prepared statements and one statement per row write the same package", () => {
    const rows = rowsOf(forty);
    const prepared = sqlOf(new DatabaseSync(":memory:"));
    const plain = { ...sqlOf(new DatabaseSync(":memory:")), prepare: undefined };
    writePackage(prepared, rows);
    writePackage(plain, rows);
    expect(dump(prepared)).toEqual(dump(plain));
    expect(prepared.all("SELECT COUNT(*) AS n FROM hymn_fts_docsize")).toEqual(
      plain.all("SELECT COUNT(*) AS n FROM hymn_fts_docsize"),
    );
    expect(prepared.all("SELECT COUNT(*) AS n FROM line")[0].n).toBe(40 * 4);
  });

  it("goes a song at a time, then the search index once", () => {
    const order: string[] = [];
    insertRows(
      (sql, bind) => order.push(`${sql.split(" ")[2]}:${bind[0]}`),
      rowsOf(forty.slice(0, 3)),
      {
        onSong: (done, total) => order.push(`song ${done}/${total}`),
        onIndex: () => order.push("index"),
      },
    );
    const at = (label: string) => order.indexOf(label);
    expect(at("song 1/3")).toBeLessThan(at("hymn:2"));
    expect(at("song 3/3")).toBeLessThan(at("index"));
    expect(order.slice(at("index") + 1).every((x) => x.startsWith("hymn_fts:"))).toBe(true);
  });

  it("rolls back whole if a row fails, leaving no tables in the scratch", () => {
    const rows = rowsOf(forty.slice(0, 2));
    // A second song numbered 1 breaks the primary key.
    rows.hymn.push([1, "again", null, null, null]);
    const db = new DatabaseSync(":memory:");
    expect(() => writePackage(sqlOf(db), rows)).toThrow();
    expect(() => db.prepare("SELECT 1 FROM hymn").all()).toThrow(/no such table/);
  });
});
