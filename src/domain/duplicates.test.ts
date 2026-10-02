import { describe, expect, it } from "vitest";
import { type HeldBook, heldElsewhere, type Incoming, verdict } from "./duplicates.ts";

const songs = (...hashes: string[]) => new Map(hashes.map((h, i) => [i + 1, h] as const));

const held = (over: Partial<HeldBook> & { key: string }): HeldBook => ({
  title: `Title of ${over.key}`,
  origin: "o",
  kind: "loaded",
  state: "ok",
  sources: [],
  songs: songs("a", "b"),
  ...over,
});

const file = (over: Partial<Incoming> = {}): Incoming => ({
  sourceHash: "file",
  origin: "o",
  songHashes: songs("a", "b"),
  ...over,
});

const ref = (key: string) => ({ key, title: `Title of ${key}` });

/** SDD-0004 §8: one case per row of the table, and the order in which they hold. */
describe("the verdict", () => {
  const cases: [string, Incoming, HeldBook[], unknown][] = [
    [
      "row 1: the file's hash is in a book's sources",
      file(),
      [held({ key: "k", sources: ["file"] })],
      { kind: "same-file", book: ref("k") },
    ],
    [
      "row 1 holds over row 2 and 3: the same file, and the same songs and origin",
      file(),
      [held({ key: "x" }), held({ key: "k", sources: ["old", "file"] })],
      { kind: "same-file", book: ref("k") },
    ],
    [
      "row 1 holds for a shipped book",
      file(),
      [held({ key: "k", kind: "shipped", sources: ["file"] })],
      { kind: "same-file", book: ref("k") },
    ],
    [
      "row 2: another file, the same songs, the same origin",
      file({ sourceHash: "repacked" }),
      [held({ key: "k", sources: ["file"] })],
      { kind: "same-songs", book: ref("k") },
    ],
    [
      "row 2: the origin does not matter",
      file({ sourceHash: "repacked", origin: "another" }),
      [held({ key: "k" })],
      { kind: "same-songs", book: ref("k") },
    ],
    [
      "row 2 holds over row 3: the same songs in one book, the same origin in another",
      file({ sourceHash: "repacked" }),
      [
        held({ key: "same-origin", songs: songs("a", "z") }),
        held({ key: "same-songs", origin: "p" }),
      ],
      { kind: "same-songs", book: ref("same-songs") },
    ],
    [
      "row 2 for a shipped book",
      file({ sourceHash: "repacked" }),
      [held({ key: "k", kind: "shipped" })],
      { kind: "same-songs", book: ref("k") },
    ],
    [
      "row 3: the same origin, a song changed",
      file({ songHashes: songs("a", "changed") }),
      [held({ key: "k" })],
      { kind: "same-origin", books: [{ ...ref("k"), replaceable: true }] },
    ],
    [
      "row 3: a song more is not the same songs",
      file({ songHashes: songs("a", "b", "c") }),
      [held({ key: "k" })],
      { kind: "same-origin", books: [{ ...ref("k"), replaceable: true }] },
    ],
    [
      "row 3: a song less is not the same songs",
      file({ songHashes: songs("a") }),
      [held({ key: "k" })],
      { kind: "same-origin", books: [{ ...ref("k"), replaceable: true }] },
    ],
    [
      "row 3: the same hashes at other numbers are not the same songs",
      file({
        songHashes: new Map([
          [2, "a"],
          [1, "b"],
        ]),
      }),
      [held({ key: "k" })],
      { kind: "same-origin", books: [{ ...ref("k"), replaceable: true }] },
    ],
    [
      "row 3: Replace is not offered for a shipped book, Keep both is",
      file({ songHashes: songs("a", "changed") }),
      [held({ key: "k", kind: "shipped" })],
      { kind: "same-origin", books: [{ ...ref("k"), replaceable: false }] },
    ],
    [
      "row 3: two held books of one origin, Replace offered for each",
      file({ songHashes: songs("a", "changed") }),
      [held({ key: "k1" }), held({ key: "k2" }), held({ key: "other", origin: "p" })],
      {
        kind: "same-origin",
        books: [
          { ...ref("k1"), replaceable: true },
          { ...ref("k2"), replaceable: true },
        ],
      },
    ],
    [
      "row 4: a new origin, whatever songs are held",
      file({ origin: "new", songHashes: songs("a", "changed") }),
      [held({ key: "k" })],
      { kind: "new" },
    ],
    ["row 4: nothing held", file(), [], { kind: "new" }],
    [
      "a book that cannot be opened is not compared",
      file(),
      [held({ key: "k", state: "unreadable", sources: ["file"], songs: new Map() })],
      { kind: "new" },
    ],
    [
      "a book that cannot be opened does not take the same origin",
      file({ songHashes: songs("z") }),
      [held({ key: "k", state: "needs-newer-app" })],
      { kind: "new" },
    ],
  ];

  it.each(cases)("%s", (_name, incoming, books, expected) => {
    expect(verdict(incoming, books)).toEqual(expected);
  });
});

describe("songs already held", () => {
  it("counts the file's songs held in other books, by book, and never makes a verdict of it", () => {
    const books = [
      held({ key: "x", songs: songs("a", "q") }),
      held({ key: "y", songs: songs("a", "b", "r") }),
      held({ key: "z", songs: songs("n") }),
    ];
    const incoming = file({ origin: "new", songHashes: songs("a", "b", "c") });
    expect(heldElsewhere(incoming.songHashes, books)).toEqual({
      count: 2,
      books: [
        { key: "x", title: "Title of x", count: 1 },
        { key: "y", title: "Title of y", count: 2 },
      ],
    });
    expect(verdict(incoming, books)).toEqual({ kind: "new" });
  });

  it("is none when nothing matches or nothing is held", () => {
    expect(heldElsewhere(songs("a"), [])).toEqual({ count: 0, books: [] });
    expect(heldElsewhere(songs("a"), [held({ key: "x", songs: songs("b") })])).toEqual({
      count: 0,
      books: [],
    });
  });

  it("ignores a book that cannot be opened", () => {
    expect(
      heldElsewhere(songs("a"), [held({ key: "x", state: "unreadable", songs: songs("a") })]),
    ).toEqual({ count: 0, books: [] });
  });
});
