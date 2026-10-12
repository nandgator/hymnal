// @vitest-environment node

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SCHEMA_SQL, SCHEMA_VERSION } from "../../scripts/content-schema.ts";
import { book, sqlOf } from "../../scripts/registry-fixtures.ts";
import { libraryOrder } from "../domain/own.ts";
import { insertRows, packageRows } from "../domain/package-rows.ts";
import type { HymnSource } from "../domain/types.ts";
import type { BookRow } from "./registry.ts";
import { numberMatches, SEARCH_LIMIT, searchBook, searchBooks, searchOrder } from "./search.ts";

const song = (number: number, line: string): HymnSource => ({
  number,
  title: `Song ${number}`,
  parts: [{ id: "s1", kind: "stanza", label: "1", lines: [line] }],
  sequence: [{ partId: "s1" }],
  meta: {},
});

/** A package with one stanza per song, held by key. */
const held = new Map<string, DatabaseSync>();
function hold(key: string, songs: HymnSource[]) {
  const db = new DatabaseSync(":memory:");
  const sql = sqlOf(db);
  sql.exec(SCHEMA_SQL);
  insertRows(
    (s, b) => sql.run(s, b),
    packageRows(book(key, songs.length), songs, {
      key,
      origin: key,
      sources: [],
      contentHash: "c",
      schemaVersion: SCHEMA_VERSION,
    }),
  );
  held.set(key, db);
}

const row = (key: string, extra: Partial<BookRow> = {}): BookRow => ({
  key,
  origin: key,
  kind: "loaded",
  file: `/${key}.sqlite3`,
  title: `Title of ${key}`,
  language: "en",
  script: "Latn",
  songs: 1,
  addedAt: 0,
  state: "ok",
  ...extra,
});

const find = (query: string) => (b: BookRow) => {
  const db = held.get(b.key);
  if (!db) throw new Error("not held");
  return searchBook(sqlOf(db), query);
};

describe("searchBook", () => {
  it("matches every word as a prefix, in any order", () => {
    hold("a", [song(1, "Praise the Lord always"), song(2, "Lord of all")]);
    const db = sqlOf(held.get("a") as DatabaseSync);
    expect(searchBook(db, "lor pra").map((r) => r.number)).toEqual([1]);
    expect(searchBook(db, "lord")).toHaveLength(2);
    expect(searchBook(db, "   ")).toEqual([]);
  });

  it("stops at the cap", () => {
    hold(
      "big",
      Array.from({ length: SEARCH_LIMIT + 20 }, (_, i) => song(i + 1, "grace and peace")),
    );
    expect(searchBook(sqlOf(held.get("big") as DatabaseSync), "grace")).toHaveLength(SEARCH_LIMIT);
  });
});

describe("libraryOrder", () => {
  it("puts your books first and keeps the rest as listed", () => {
    const rows = [row("b"), row("c"), row("a", { kind: "own" })];
    expect(libraryOrder(rows).map((r) => r.key)).toEqual(["a", "b", "c"]);
  });

  it("puts every book of yours first, in the order listed", () => {
    const rows = [row("b"), row("o1", { kind: "own" }), row("c"), row("o2", { kind: "own" })];
    expect(libraryOrder(rows).map((r) => r.key)).toEqual(["o1", "o2", "b", "c"]);
  });
});

describe("searchOrder", () => {
  it("is the current book, then your books, then the rest in order", () => {
    const rows = [row("x"), row("y"), row("as", { kind: "own" }), row("z")];
    expect(searchOrder(rows, "y").map((r) => r.key)).toEqual(["y", "as", "x", "z"]);
  });

  it("is your book first when it is the current book", () => {
    const rows = [row("x"), row("as", { kind: "own" })];
    expect(searchOrder(rows, "as").map((r) => r.key)).toEqual(["as", "x"]);
  });

  it("leaves out a book that is not ok, even the current one", () => {
    const rows = [
      row("x", { state: "needs-reloading" }),
      row("y"),
      row("z", { state: "unreadable" }),
    ];
    expect(searchOrder(rows, "x").map((r) => r.key)).toEqual(["y"]);
  });
});

describe("searchBooks", () => {
  it("returns the groups in order, each with its book's title", () => {
    hold("cur", [song(1, "Lord of the harvest")]);
    hold("as", [song(1, "Lord I come")]);
    hold("old", [song(5, "The Lord is my light")]);
    const rows = [row("old"), row("cur"), row("as", { kind: "own", title: "Assorted Hymns" })];
    const hits = searchBooks(rows, "cur", find("lord"));
    expect(hits.map((h) => [h.key, h.title])).toEqual([
      ["cur", "Title of cur"],
      ["as", "Assorted Hymns"],
      ["old", "Title of old"],
    ]);
    expect(hits[2]?.results.map((r) => r.number)).toEqual([5]);
  });

  it("finds a song held in two books under each", () => {
    hold("one", [song(3, "Rock of ages")]);
    hold("two", [song(41, "Rock of ages")]);
    const hits = searchBooks([row("one"), row("two")], "one", find("rock"));
    expect(hits.map((h) => [h.key, h.results[0]?.number])).toEqual([
      ["one", 3],
      ["two", 41],
    ]);
  });

  it("leaves out a book with no match", () => {
    hold("m", [song(1, "Amazing grace")]);
    hold("n", [song(1, "Silent night")]);
    const hits = searchBooks([row("m"), row("n")], "m", find("grace"));
    expect(hits.map((h) => h.key)).toEqual(["m"]);
  });

  it("leaves out a book that cannot be read, and still returns the others", () => {
    hold("good", [song(1, "Holy holy holy")]);
    const rows = [row("gone"), row("good"), row("bad", { state: "unreadable" })];
    const hits = searchBooks(rows, "gone", find("holy"));
    expect(hits.map((h) => h.key)).toEqual(["good"]);
  });

  it("caps each book on its own", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => song(i + 1, "grace abounds"));
    hold("p", many(SEARCH_LIMIT + 5));
    hold("q", many(SEARCH_LIMIT + 9));
    const hits = searchBooks([row("p"), row("q")], "q", find("grace"));
    expect(hits.map((h) => [h.key, h.results.length])).toEqual([
      ["q", SEARCH_LIMIT],
      ["p", SEARCH_LIMIT],
    ]);
  });

  it("finds nothing in no books", () => {
    expect(searchBooks([], "x", find("lord"))).toEqual([]);
  });
});

describe("numberMatches", () => {
  const songs = [4, 42, 421, 5, 142].map((number) => ({ number, title: `Song ${number}` }));

  it("lists the exact number first, then the numbers it starts, never one it only appears in", () => {
    expect(numberMatches(songs, "42").map((r) => r.number)).toEqual([42, 421]);
    expect(numberMatches(songs, "4").map((r) => r.number)).toEqual([4, 42, 421]);
  });

  it("finds nothing for a number no song has or starts", () => {
    expect(numberMatches(songs, "9")).toEqual([]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ number: 100 + i, title: "x" }));
    expect(numberMatches(many, "1", 8)).toHaveLength(8);
  });
});
