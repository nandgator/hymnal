// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { songHash } from "../src/domain/hash.ts";
import {
  migratePackage,
  packageVersion,
  readHead,
  readHymns,
  type Sql,
} from "../src/persistence/package-io.ts";
import {
  addBook,
  indexPackage,
  listBooks,
  openRegistry,
  REGISTRY_FILE,
  reconcile,
  removeBook,
  startRegistry,
} from "../src/persistence/registry.ts";
import { SCHEMA_SQL } from "./content-schema.ts";
import { container, type FakeFiles, hymn, hymns, setup, sqlOf } from "./registry-fixtures.ts";

const V2_SQL = SCHEMA_SQL.replace(
  "  origin         TEXT NOT NULL,       -- the id the file declared\n",
  "",
)
  .replace(",\n  sources        TEXT NOT NULL        -- JSON array of container file hashes", "")
  .replace("  position    INTEGER NOT NULL,   -- printed order, as the file has the parts\n", "")
  .replace(",\n  UNIQUE (hymn_number, position)", "");

/** A version 2 package, as the last app built it; parts in file order by rowid. */
function putV2(files: FakeFiles, file: string, id: string) {
  files.open(file, (sql) => {
    sql.exec(V2_SQL);
    sql.run("INSERT INTO hymnbook VALUES (?, 'Old', 'en', 'Latn', NULL, NULL, NULL, 2, 'h')", [id]);
    for (const h of hymns) {
      sql.run("INSERT INTO hymn VALUES (?, ?, 'A', NULL, NULL)", [h.number, h.title]);
      for (const p of h.parts) {
        sql.run("INSERT INTO part VALUES (?, ?, ?, ?)", [h.number, p.id, p.kind, p.label ?? null]);
        p.lines.forEach((text, i) => {
          sql.run("INSERT INTO line VALUES (?, ?, ?, ?)", [h.number, p.id, i, text]);
        });
      }
      h.sequence.forEach((e, i) => {
        sql.run("INSERT INTO sequence_entry VALUES (?, ?, ?)", [h.number, i, e.partId]);
      });
    }
  });
}

describe("the fixture", () => {
  it("is a book whose file order differs from first appearance", () => {
    const first = [...new Set(hymn(1).sequence.map((e) => e.partId))];
    expect(first).not.toEqual(hymn(1).parts.map((p) => p.id));
    expect(V2_SQL).not.toContain("position");
    expect(V2_SQL).not.toContain("origin");
    expect(V2_SQL).not.toContain("sources");
  });
});

describe("package schema 3", () => {
  it("writes origin, sources and part positions", () => {
    const { files } = setup();
    files.put("/k.1.sqlite3", "k", hymns, ["s1"]);
    files.open("/k.1.sqlite3", (sql) => {
      expect(packageVersion(sql)).toBe(3);
      expect(readHead(sql, 3)).toMatchObject({ key: "k", origin: "k", sources: ["s1"], songs: 2 });
      expect(
        sql.all("SELECT id, position FROM part WHERE hymn_number = 1 ORDER BY position"),
      ).toEqual([
        { id: "s1", position: 0 },
        { id: "c", position: 1 },
        { id: "s2", position: 2 },
      ]);
    });
  });

  it("hashes the same from the package as from the container, parts out of first-appearance order", async () => {
    const { files } = setup();
    files.put("/k.1.sqlite3", "k");
    const fromPackage = files.open("/k.1.sqlite3", (sql) => readHymns(sql, 3));
    expect(await Promise.all(fromPackage.map(songHash))).toEqual(
      await Promise.all(hymns.map(songHash)),
    );
  });

  it("holds the same rows however it is inserted", async () => {
    const { files } = setup();
    files.put("/a.sqlite3", "k");
    const { ctx } = setup();
    await addBook(ctx, "k", await container("k"));
    const dump = (db: DatabaseSync) =>
      ["hymnbook", "hymn", "part", "line", "sequence_entry"].map((t) =>
        db.prepare(`SELECT * FROM ${t}`).all(),
      );
    const a = dump(files.dbs.get("/a.sqlite3") as DatabaseSync);
    const b = dump((ctx.files as FakeFiles).dbs.get("/k.1.sqlite3") as DatabaseSync);
    // Only the source differs: the loaded one records its container.
    expect(a.slice(1)).toEqual(b.slice(1));
  });
});

describe("migration 2 to 3", () => {
  it("keeps every song, in file order, and fills origin, sources and position", async () => {
    const { files } = setup();
    putV2(files, "/old.sqlite3", "old");
    const version = files.open("/old.sqlite3", (sql) => packageVersion(sql));
    expect(version).toBe(2);
    // Read at version 2: rowid order stands in for position.
    const before = files.open("/old.sqlite3", (sql) => readHymns(sql, 2));
    expect(files.open("/old.sqlite3", (sql) => migratePackage(sql, 2))).toBe(true);
    files.open("/old.sqlite3", (sql) => {
      expect(packageVersion(sql)).toBe(3);
      expect(readHead(sql, 3)).toMatchObject({ origin: "old", sources: [], songs: 2 });
      expect(readHymns(sql, 3)).toEqual(before);
    });
    expect(await Promise.all(before.map(songHash))).toEqual(await Promise.all(hymns.map(songHash)));
  });

  it("leaves the file as it was when a step fails", () => {
    const { files } = setup();
    putV2(files, "/old.sqlite3", "old");
    // Make the last steps fail: the index name is taken.
    files.open("/old.sqlite3", (sql) => sql.exec("CREATE TABLE part_position (x)"));
    expect(files.open("/old.sqlite3", (sql) => migratePackage(sql, 2))).toBe(false);
    files.open("/old.sqlite3", (sql) => {
      expect(packageVersion(sql)).toBe(2);
      expect(() => sql.all("SELECT origin FROM hymnbook")).toThrow();
    });
  });
});

describe("the registry", () => {
  it("creates its tables at user_version 1, and rebuilds when the version is another", () => {
    const { sql } = setup();
    expect(sql.all("PRAGMA user_version")).toEqual([{ user_version: 1 }]);
    sql.exec(
      "INSERT INTO book VALUES ('x','x','loaded','/x','t','l','s',0,1,'ok'); PRAGMA user_version = 9",
    );
    openRegistry(sql);
    expect(sql.all("SELECT * FROM book")).toEqual([]);
    expect(sql.all("PRAGMA user_version")).toEqual([{ user_version: 1 }]);
  });

  it("refuses a bad state", () => {
    const { sql } = setup();
    expect(() =>
      sql.exec("INSERT INTO book VALUES ('x','x','loaded','/x','t','l','s',0,1,'broken')"),
    ).toThrow();
  });

  it("writes a package, then its row, sources and song hashes", async () => {
    const { ctx, files, sql } = setup();
    const read = await container("origin-id");
    const row = await addBook(ctx, "key-1", read);
    expect(row).toMatchObject({
      key: "key-1",
      origin: "origin-id",
      kind: "loaded",
      file: "/key-1.1.sqlite3",
      songs: 2,
      state: "ok",
    });
    expect(listBooks(ctx)).toEqual([row]);
    expect(sql.all("SELECT hash, book_key FROM source")).toEqual([
      { hash: read.sourceHash, book_key: "key-1" },
    ]);
    expect(sql.all("SELECT number, hash FROM song ORDER BY number")).toEqual(
      [...read.songHashes].map(([number, hash]) => ({ number, hash })),
    );
    files.open("/key-1.1.sqlite3", (p) => {
      expect(readHead(p, 3)).toMatchObject({
        key: "key-1",
        origin: "origin-id",
        sources: [read.sourceHash],
        contentHash: read.sourceHash,
      });
    });
  });

  it("removes a package whose write failed and writes no row", async () => {
    const { ctx, files } = setup();
    const read = await container();
    const open = files.open.bind(files);
    files.open = ((file: string, fn: (s: Sql) => unknown) =>
      open(file, (sql) => {
        sql.exec("CREATE TABLE hymnbook (x)"); // the schema then clashes
        return fn(sql);
      })) as typeof files.open;
    await expect(addBook(ctx, "k", read)).rejects.toThrow();
    expect(files.list()).toEqual([]);
    expect(listBooks(ctx)).toEqual([]);
  });

  it("removes a book: file and rows", async () => {
    const { ctx, files, sql } = setup();
    await addBook(ctx, "k", await container());
    expect(removeBook(ctx, "k")).toBe(true);
    expect(files.list()).toEqual([]);
    expect(sql.all("SELECT * FROM source")).toEqual([]);
    expect(sql.all("SELECT * FROM song")).toEqual([]);
    expect(removeBook(ctx, "k")).toBe(false);
  });
});

describe("reconcile", () => {
  it("adopts a package with no row: shipped if bundled, rebuilt from the file", async () => {
    const { ctx, files, sql } = setup(["bundled"]);
    files.put("/bundled.sqlite3", "bundled");
    await reconcile(ctx);
    const [row] = listBooks(ctx);
    expect(row).toMatchObject({
      key: "bundled",
      origin: "bundled",
      kind: "shipped",
      file: "/bundled.sqlite3",
      songs: 2,
      title: "A Book",
      state: "ok",
    });
    expect(sql.all("SELECT COUNT(*) AS n FROM song")).toEqual([{ n: 2 }]);
  });

  it("adopts an unbundled package as loaded, slug as key", async () => {
    const { ctx, files } = setup();
    files.put("/mine.sqlite3", "mine");
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "mine", kind: "loaded" }]);
  });

  it("is a no-op the second time", async () => {
    const { ctx, files } = setup();
    files.put("/mine.sqlite3", "mine");
    await reconcile(ctx);
    const first = listBooks(ctx);
    await reconcile(ctx);
    expect(listBooks(ctx)).toEqual(first);
    expect(files.list()).toEqual(["/mine.sqlite3"]);
  });

  it("drops a row whose file is gone", async () => {
    const { ctx, files, sql } = setup();
    await addBook(ctx, "k", await container());
    files.remove("/k.1.sqlite3");
    await reconcile(ctx);
    expect(listBooks(ctx)).toEqual([]);
    expect(sql.all("SELECT * FROM source")).toEqual([]);
  });

  it("heals a crash between writing a package and registering it", async () => {
    const { ctx, files } = setup();
    await addBook(ctx, "k", await container("o"));
    ctx.registry.run("DELETE FROM book");
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "k", origin: "o", kind: "loaded", songs: 2 }]);
    expect(ctx.registry.all("SELECT hash FROM source")).toHaveLength(1);
    expect(files.list()).toEqual(["/k.1.sqlite3"]);
  });

  it("keeps a newer-version package as a listed row, never deletes it", async () => {
    const { ctx, files } = setup();
    files.put("/new.1.sqlite3", "new");
    files.open("/new.1.sqlite3", (sql) => sql.run("UPDATE hymnbook SET schema_version = 9"));
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([
      {
        key: "new",
        origin: "new",
        kind: "loaded",
        title: "A Book",
        language: "",
        script: "",
        songs: 0,
        state: "needs-newer-app",
      },
    ]);
    expect(ctx.registry.all("SELECT * FROM song")).toEqual([]);
    expect(files.list()).toEqual(["/new.1.sqlite3"]);
  });

  it("keeps a version 1 package as needs-reloading, titled by its key if it cannot say", async () => {
    const { ctx, files } = setup();
    files.open("/old.sqlite3", (sql) => {
      sql.exec("CREATE TABLE hymnbook (id TEXT, schema_version INTEGER)");
      sql.exec("INSERT INTO hymnbook VALUES ('old', 1)");
    });
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "old", title: "old", state: "needs-reloading" }]);
  });

  it("recomputes state each start: a newer package the app can now read is indexed", async () => {
    const { ctx, files } = setup();
    files.put("/new.1.sqlite3", "new");
    files.open("/new.1.sqlite3", (sql) => sql.run("UPDATE hymnbook SET schema_version = 9"));
    await reconcile(ctx);
    files.open("/new.1.sqlite3", (sql) => sql.run("UPDATE hymnbook SET schema_version = 3"));
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "new", songs: 2, language: "en", state: "ok" }]);
    expect(ctx.registry.all("SELECT * FROM song")).toHaveLength(2);
  });

  it("removes only a provably empty leftover, and ignores the registry and journals", async () => {
    const { ctx, files } = setup();
    files.open("/empty.sqlite3", () => {}); // no tables at all: an aborted first write
    files.open("/other.sqlite3", (sql) => sql.exec("CREATE TABLE t (x)")); // a database, not ours
    files.open(REGISTRY_FILE, (sql) => sql.exec("CREATE TABLE t (x)"));
    files.open("/k.1.sqlite3-journal", (sql) => sql.exec("CREATE TABLE t (x)"));
    await reconcile(ctx);
    expect(files.list().sort()).toEqual(["/k.1.sqlite3-journal", "/other.sqlite3", REGISTRY_FILE]);
    expect(listBooks(ctx)).toMatchObject([{ key: "other", state: "unreadable", kind: "loaded" }]);
  });

  it("keeps a damaged file that has a row, listed unreadable", async () => {
    const { ctx, files } = setup();
    await addBook(ctx, "k", await container());
    files.open("/k.1.sqlite3", (sql) => sql.exec("DROP TABLE hymnbook"));
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "k", state: "unreadable" }]);
    expect(files.list()).toEqual(["/k.1.sqlite3"]);
  });

  it("keeps a readable copy whose key another file holds, listed under its file name", async () => {
    const { ctx, files } = setup();
    await addBook(ctx, "k", await container());
    files.put("/k.2.sqlite3", "k");
    await reconcile(ctx);
    expect(files.list().sort()).toEqual(["/k.1.sqlite3", "/k.2.sqlite3"]);
    const rows = listBooks(ctx);
    expect(rows.map((b) => [b.key, b.file, b.state])).toEqual([
      ["k", "/k.1.sqlite3", "ok"],
      ["k.2", "/k.2.sqlite3", "unreadable"],
    ]);
    // Again: the held book's row and song rows are not overwritten by the copy.
    await reconcile(ctx);
    expect(listBooks(ctx)).toEqual(rows);
    expect(ctx.registry.all("SELECT COUNT(*) AS n FROM song WHERE book_key = 'k'")).toEqual([
      { n: 2 },
    ]);
  });

  it("turns a shipped book the app no longer bundles into a loaded one, key unchanged", async () => {
    const { ctx, files } = setup(["b"]);
    files.put("/b.sqlite3", "b");
    await reconcile(ctx);
    expect(listBooks(ctx)[0].kind).toBe("shipped");
    await reconcile({ ...ctx, shipped: [] });
    expect(listBooks(ctx)).toMatchObject([{ key: "b", kind: "loaded" }]);
  });

  it("merges sources both ways: the union is kept in the package and the registry", async () => {
    const { ctx, files, sql } = setup();
    const read = await container("o", hymns, "a".repeat(64));
    await addBook(ctx, "k", read);
    // The package got a hash the registry missed (a crash between the two writes) and the reverse.
    files.open("/k.1.sqlite3", (p) =>
      p.run("UPDATE hymnbook SET sources = ?", [JSON.stringify(["a".repeat(64), "b".repeat(64)])]),
    );
    sql.run("INSERT INTO source (hash, book_key, added_at) VALUES (?, 'k', 1)", ["c".repeat(64)]);
    await reconcile(ctx);
    const inRegistry = sql.all("SELECT hash FROM source ORDER BY hash").map((r) => r.hash);
    const inPackage = files.open("/k.1.sqlite3", (p) => readHead(p, 3)?.sources.sort());
    expect(inRegistry).toEqual(["a".repeat(64), "b".repeat(64), "c".repeat(64)]);
    expect(inPackage).toEqual(inRegistry);
  });

  it("adopts a version 2 loaded package, migrated, songs intact, hashes equal to its container's", async () => {
    const { ctx, files } = setup();
    putV2(files, "/old.sqlite3", "old");
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "old", kind: "loaded", songs: 2, state: "ok" }]);
    expect(files.open("/old.sqlite3", (sql) => packageVersion(sql))).toBe(3);
    const read = await container("old");
    expect(ctx.registry.all("SELECT number, hash FROM song ORDER BY number")).toEqual(
      [...read.songHashes].map(([number, hash]) => ({ number, hash })),
    );
  });

  it("leaves a version 2 shipped copy alone: the bundle replaces it", async () => {
    const { ctx, files } = setup(["old"]);
    putV2(files, "/old.sqlite3", "old");
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "old", kind: "shipped", state: "ok" }]);
    expect(files.open("/old.sqlite3", (sql) => packageVersion(sql))).toBe(2);
  });

  it("lists a version 2 package whose migration fails as unreadable, file untouched", async () => {
    const { ctx, files } = setup();
    putV2(files, "/old.sqlite3", "old");
    files.open("/old.sqlite3", (sql) => sql.exec("CREATE TABLE part_position (x)"));
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "old", state: "unreadable" }]);
    expect(files.open("/old.sqlite3", (sql) => packageVersion(sql))).toBe(2);
  });
});

describe("reconcile never deletes what may be a book", () => {
  it("keeps a no-row package when opening it fails for any reason but 'not a database'", async () => {
    const { ctx, files } = setup();
    files.put("/k.1.sqlite3", "k");
    files.failOpen.set("/k.1.sqlite3", new Error("SQLITE_BUSY: database is locked"));
    await reconcile(ctx);
    expect(files.list()).toEqual(["/k.1.sqlite3"]);
    expect(listBooks(ctx)).toEqual([]);
    // The error clears: the next start adopts it.
    files.failOpen.clear();
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "k", state: "ok" }]);
  });

  it("keeps a no-row package whose read fails with an I/O error", async () => {
    const { ctx, files } = setup();
    files.put("/k.1.sqlite3", "k");
    files.failQuery.set("/k.1.sqlite3", new Error("SQLITE_IOERR: disk I/O error"));
    await reconcile(ctx);
    expect(files.list()).toEqual(["/k.1.sqlite3"]);
  });

  it("lists a held book as unreadable on a transient error, file kept", async () => {
    const { ctx, files } = setup();
    await addBook(ctx, "k", await container());
    files.failQuery.set("/k.1.sqlite3", new Error("SQLITE_BUSY"));
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "k", state: "unreadable" }]);
    expect(files.list()).toEqual(["/k.1.sqlite3"]);
    files.failQuery.clear();
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "k", state: "ok" }]);
  });

  it("keeps and lists a no-row file SQLite calls not a database or malformed", async () => {
    const { ctx, files } = setup();
    files.dbs.set("/junk.sqlite3", new DatabaseSync(":memory:"));
    files.dbs.set("/bad.sqlite3", new DatabaseSync(":memory:"));
    files.failOpen.set("/junk.sqlite3", new Error("SQLITE_NOTADB: file is not a database"));
    files.failOpen.set(
      "/bad.sqlite3",
      new Error("SQLITE_CORRUPT: database disk image is malformed"),
    );
    await reconcile(ctx);
    expect(files.list().sort()).toEqual(["/bad.sqlite3", "/junk.sqlite3"]);
    expect(listBooks(ctx).map((b) => [b.key, b.title, b.state])).toEqual([
      ["bad", "bad", "unreadable"],
      ["junk", "junk", "unreadable"],
    ]);
  });

  it("lists an unreadable file as shipped when its key is a bundled id", async () => {
    const { ctx, files } = setup(["b"]);
    files.open("/b.sqlite3", (sql) => sql.exec("CREATE TABLE t (x)"));
    await reconcile(ctx);
    expect(listBooks(ctx)).toMatchObject([{ key: "b", kind: "shipped", state: "unreadable" }]);
  });

  it("refuses to index a package over a row held for another file", async () => {
    const { ctx, files } = setup();
    await addBook(ctx, "k", await container());
    files.put("/k.2.sqlite3", "k");
    expect(await indexPackage(ctx, "/k.2.sqlite3", "loaded")).toBeNull();
    expect(listBooks(ctx)).toMatchObject([{ key: "k", file: "/k.1.sqlite3" }]);
  });

  it("keeps a no-row file that has an empty hymnbook table", async () => {
    const { ctx, files } = setup();
    files.open("/odd.sqlite3", (sql) => sql.exec("CREATE TABLE hymnbook (schema_version INTEGER)"));
    await reconcile(ctx);
    expect(files.list()).toEqual(["/odd.sqlite3"]);
  });

  it("skips a file that throws and goes on with the rest", async () => {
    const { ctx, files } = setup();
    files.put("/a.sqlite3", "a");
    files.put("/b.sqlite3", "b");
    files.failAfterFirst.add("/a.sqlite3");
    await expect(reconcile(ctx)).resolves.toBeUndefined();
    expect(listBooks(ctx).map((b) => b.key)).toEqual(["b"]);
    expect(files.list().sort()).toEqual(["/a.sqlite3", "/b.sqlite3"]);
  });

  it("of two no-row files with one key and origin, keeps the higher <n> and deletes the superseded lower, whatever the order", async () => {
    const { ctx, files } = setup();
    files.put("/k.1.sqlite3", "k", [hymn(1)]);
    files.put("/k.2.sqlite3", "k", hymns);
    await reconcile(ctx);
    expect(files.list()).toEqual(["/k.2.sqlite3"]);
    expect(listBooks(ctx).map((b) => [b.key, b.file, b.songs, b.state])).toEqual([
      ["k", "/k.2.sqlite3", 2, "ok"],
    ]);
  });

  describe("a lower copy is deleted only when provably superseded", () => {
    const held = async () => {
      const s = setup();
      await addBook(s.ctx, "k", await container("o"), 2);
      return s;
    };
    const kept = (files: { list(): string[] }) => [...files.list()].sort();

    it("deletes it: the row's file is a higher <n>, readable, same key and origin", async () => {
      const { ctx, files } = await held();
      files.put("/k.1.sqlite3", "k");
      files.open("/k.1.sqlite3", (sql) => sql.run("UPDATE hymnbook SET origin = 'o'"));
      await reconcile(ctx);
      expect(files.list()).toEqual(["/k.2.sqlite3"]);
      expect(listBooks(ctx).map((b) => [b.key, b.file])).toEqual([["k", "/k.2.sqlite3"]]);
    });

    it("keeps it when its origin differs", async () => {
      const { ctx, files } = await held();
      files.put("/k.1.sqlite3", "k"); // origin "k", the row's is "o"
      await reconcile(ctx);
      expect(kept(files)).toEqual(["/k.1.sqlite3", "/k.2.sqlite3"]);
      expect(listBooks(ctx).map((b) => [b.key, b.state])).toEqual([
        ["k", "ok"],
        ["k.1", "unreadable"],
      ]);
    });

    it("keeps it when the row's file is unreadable", async () => {
      const { ctx, files } = await held();
      files.put("/k.1.sqlite3", "k");
      files.open("/k.1.sqlite3", (sql) => sql.run("UPDATE hymnbook SET origin = 'o'"));
      files.open("/k.2.sqlite3", (sql) => sql.exec("DROP TABLE hymnbook"));
      await reconcile(ctx);
      expect(kept(files)).toEqual(["/k.1.sqlite3", "/k.2.sqlite3"]);
    });

    it("keeps it when the row's file has a different song count than the row", async () => {
      const { ctx, files } = await held();
      files.put("/k.1.sqlite3", "k");
      files.open("/k.1.sqlite3", (sql) => sql.run("UPDATE hymnbook SET origin = 'o'"));
      ctx.registry.run("UPDATE book SET songs = 5 WHERE key = 'k'");
      await reconcile(ctx);
      expect([...files.list()].sort()).toEqual(["/k.1.sqlite3", "/k.2.sqlite3"]);
    });

    it("keeps it when the row's file holds no songs", async () => {
      const { ctx, files } = await held();
      files.put("/k.1.sqlite3", "k");
      files.open("/k.1.sqlite3", (sql) => sql.run("UPDATE hymnbook SET origin = 'o'"));
      files.open("/k.2.sqlite3", (sql) => {
        sql.exec("PRAGMA foreign_keys = OFF");
        for (const t of ["sequence_entry", "line", "part", "hymn"]) sql.exec(`DELETE FROM ${t}`);
      });
      ctx.registry.run("UPDATE book SET songs = 0 WHERE key = 'k'");
      await reconcile(ctx);
      expect([...files.list()].sort()).toEqual(["/k.1.sqlite3", "/k.2.sqlite3"]);
    });

    it("keeps it when the lower one holds the row (the higher is the stray)", async () => {
      const { ctx, files } = setup();
      await addBook(ctx, "k", await container("o"), 1);
      files.put("/k.2.sqlite3", "k"); // another origin: not a finished Replace
      await reconcile(ctx);
      expect(kept(files)).toEqual(["/k.1.sqlite3", "/k.2.sqlite3"]);
      expect(listBooks(ctx)[0].file).toBe("/k.1.sqlite3");
    });

    it("keeps it when the <n> is equal (no <n>: the same generation)", async () => {
      const { ctx, files } = setup(["k"]);
      files.put("/k.sqlite3", "k");
      await reconcile(ctx);
      files.put("/k.0.sqlite3", "k");
      await reconcile(ctx);
      expect(kept(files)).toEqual(["/k.0.sqlite3", "/k.sqlite3"]);
    });
  });

  it("lists, never deletes, a no-row newer-version file whose key is held", async () => {
    const { ctx, files } = setup();
    await addBook(ctx, "k", await container());
    files.put("/k.2.sqlite3", "k");
    files.open("/k.2.sqlite3", (sql) => sql.run("UPDATE hymnbook SET schema_version = 9"));
    await reconcile(ctx);
    expect(files.list().sort()).toEqual(["/k.1.sqlite3", "/k.2.sqlite3"]);
    expect(listBooks(ctx).map((b) => [b.key, b.state])).toEqual([
      ["k", "ok"],
      ["k.2", "needs-newer-app"],
    ]);
  });
});

describe("a failing registry", () => {
  it("is discarded and made again when the file is corrupt", () => {
    const dir = mkdtempSync(join(tmpdir(), "reg-"));
    const path = join(dir, "registry.sqlite3");
    writeFileSync(path, "this is not a database, not even close".repeat(200));
    let discarded = 0;
    const sql = startRegistry(
      () => sqlOf(new DatabaseSync(path)),
      () => {
        discarded++;
        rmSync(path);
      },
    );
    expect(discarded).toBe(1);
    expect(sql.all("PRAGMA user_version")).toEqual([{ user_version: 1 }]);
    rmSync(dir, { recursive: true });
  });

  it("keeps the registry file on a transient error: no registry this session", () => {
    let discarded = 0;
    expect(() =>
      startRegistry(
        () => {
          throw new Error("SQLITE_BUSY: database is locked");
        },
        () => {
          discarded++;
        },
      ),
    ).toThrow("SQLITE_BUSY");
    expect(discarded).toBe(0);
  });

  it("opens a healthy registry without discarding anything", () => {
    let discarded = 0;
    startRegistry(
      () => sqlOf(new DatabaseSync(":memory:")),
      () => {
        discarded++;
      },
    );
    expect(discarded).toBe(0);
  });

  it("rolls back a rebuild that fails part way", () => {
    const db = new DatabaseSync(":memory:");
    const real = sqlOf(db);
    const failing: Sql = {
      ...real,
      exec: (q) => {
        if (q.startsWith("PRAGMA user_version =")) throw new Error("boom");
        real.exec(q);
      },
    };
    expect(() => openRegistry(failing)).toThrow("boom");
    expect(real.all("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([]);
  });
});

describe("writes and removes", () => {
  it("removes the package it just wrote if the registry transaction fails", async () => {
    const { ctx, files } = setup();
    const real = ctx.registry;
    const failing: Sql = {
      ...real,
      run: (q, b) => {
        if (q.includes("INTO song")) throw new Error("registry full");
        real.run(q, b);
      },
    };
    await expect(addBook({ ...ctx, registry: failing }, "k", await container())).rejects.toThrow(
      "registry full",
    );
    expect(files.list()).toEqual([]);
    expect(listBooks(ctx)).toEqual([]);
  });

  it("indexes nothing if the file went while the hashes were computed", async () => {
    const { ctx, files } = setup();
    files.put("/k.sqlite3", "k");
    const indexing = indexPackage(ctx, "/k.sqlite3", "loaded");
    files.remove("/k.sqlite3");
    expect(await indexing).toBeNull();
    expect(listBooks(ctx)).toEqual([]);
  });

  it("refuses to remove a shipped book", async () => {
    const { ctx, files } = setup(["b"]);
    files.put("/b.sqlite3", "b");
    await reconcile(ctx);
    expect(() => removeBook(ctx, "b")).toThrow(/shipped/);
    expect(files.list()).toEqual(["/b.sqlite3"]);
    expect(listBooks(ctx)).toHaveLength(1);
  });
});
