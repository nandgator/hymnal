// @vitest-environment node

import { describe, expect, it } from "vitest";
import { packageRows } from "./package-rows.ts";
import type { HymnbookSource, HymnSource } from "./types.ts";

const identity = {
  key: "k",
  origin: "o",
  sources: ["s"],
  contentHash: "c",
  schemaVersion: 4,
};
const book: HymnbookSource = {
  format: 1,
  id: "o",
  title: "T",
  language: "en",
  script: "Latn",
  hymnCount: 1,
};
const song: HymnSource = {
  number: 1,
  title: "Song",
  parts: [{ id: "s1", kind: "stanza", label: "1", lines: ["a"] }],
  sequence: [{ partId: "s1" }],
  meta: { author: "A" },
};

describe("packageRows: Assorted Hymns' columns (SDD-0004 §17)", () => {
  it("leaves next_number, language and script null for a book from a container", () => {
    const rows = packageRows(book, [song], identity);
    expect(rows.hymnbook.at(-1)).toBeNull();
    expect(rows.hymn).toEqual([[1, "Song", "A", null, null, null, null]]);
  });

  it("fills them from the optional fields on the book and its songs", () => {
    const rows = packageRows(
      { ...book, nextNumber: 5 },
      [{ ...song, language: "ml", script: "Mlym" }],
      identity,
    );
    expect(rows.hymnbook.at(-1)).toBe(5);
    expect(rows.hymn).toEqual([[1, "Song", "A", null, null, "ml", "Mlym"]]);
  });

  it("fills them per song: one with a language, one without", () => {
    const rows = packageRows(
      book,
      [
        { ...song, language: "ml", script: "Mlym" },
        { ...song, number: 2 },
      ],
      identity,
    );
    expect(rows.hymn.map((r) => r.slice(5))).toEqual([
      ["ml", "Mlym"],
      [null, null],
    ]);
  });
});
