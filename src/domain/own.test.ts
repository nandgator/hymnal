// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  ASSORTED_ORIGIN,
  ASSORTED_TITLE,
  addSongs,
  asContainerShape,
  isLanguageTag,
  isOwnOrigin,
  isScriptCode,
  libraryOrder,
  OWN_LANGUAGE,
  OWN_ORIGIN,
  OWN_SCRIPT,
  ownOrder,
  ownStatus,
  statusFor,
} from "./own.ts";
import type { HymnSource } from "./types.ts";
import { hymnFileName, validateCorpus } from "./validate.ts";

const song = (number: number, title = `Song ${number}`): HymnSource => ({
  number,
  title,
  parts: [{ id: "s1", kind: "stanza", label: "1", lines: [`line ${number}`] }],
  sequence: [{ partId: "s1" }],
  meta: {},
});
const s = (number: number, title: string, language?: string) => ({ number, title, language });

describe("ownOrder", () => {
  it("orders by language tag in code point order, then title, then number", () => {
    const list = [
      s(1, "Beta", "ml"),
      s(2, "Alpha", "ml"),
      s(3, "Zeta", "en"),
      s(4, "Alpha", "ml"),
      s(5, "Omega", "en-GB"),
      s(6, "Mid", "EN"),
    ];
    // "EN" < "en" < "en-GB" < "ml" by code point. The two Alphas tie on title: the number decides.
    expect(ownOrder(list).map((x) => x.number)).toEqual([6, 3, 5, 2, 4, 1]);
  });

  it("collates titles in the song's own language", () => {
    const titles = ["Zebra", "Ärlig", "Aal"];
    const order = (language: string) =>
      ownOrder(titles.map((t, i) => s(i + 1, t, language))).map((x) => x.title);
    // Swedish puts "ä" after "z"; German sorts it with "a".
    expect(order("sv")).toEqual(["Aal", "Zebra", "Ärlig"]);
    expect(order("de")).toEqual(["Aal", "Ärlig", "Zebra"]);
  });

  it("falls back to the default collator for a tag the runtime rejects", () => {
    const bad = "x-bogus-tag-that-is-far-too-long-for-a-subtag";
    expect(ownOrder([s(2, "b", bad), s(1, "a", bad)]).map((x) => x.number)).toEqual([1, 2]);
  });

  it("sorts a song with no language first, and does not change its input", () => {
    const list = [s(1, "A", "en"), s(2, "B")];
    expect(ownOrder(list).map((x) => x.number)).toEqual([2, 1]);
    expect(list.map((x) => x.number)).toEqual([1, 2]);
  });
});

describe("tags", () => {
  it("knows a language tag and a script code by shape", () => {
    expect(["en", "ml", "mul", "en-GB", "zh-Hant-TW"].every(isLanguageTag)).toBe(true);
    expect(["", "e", "en_GB", "english-", " en", "123"].some(isLanguageTag)).toBe(false);
    expect(["Latn", "Mlym", "Zyyy"].every(isScriptCode)).toBe(true);
    expect(["latn", "LATN", "Lat", "Latnn", ""].some(isScriptCode)).toBe(false);
  });
});

const hashed = (n: number, title?: string) => ({ hymn: song(n, title), hash: `h${n}` });
const NO_HASHES = new Map<string, number>();
const BOOK = { origin: ASSORTED_ORIGIN, title: ASSORTED_TITLE };

describe("addSongs", () => {
  it("makes the book with the song under its number and the counter one past it", () => {
    const plan = addSongs(null, NO_HASHES, BOOK, [hashed(1)], "en", "Latn");
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.added).toEqual([{ number: 1, hash: "h1" }]);
    expect(plan.hymns).toEqual([{ ...song(1), language: "en", script: "Latn" }]);
    expect(plan.book).toMatchObject({
      id: ASSORTED_ORIGIN,
      title: ASSORTED_TITLE,
      language: OWN_LANGUAGE,
      script: OWN_SCRIPT,
      hymnCount: 1,
      nextNumber: 2,
    });
  });

  it("keeps a number written in the text when it is at or above next_number", () => {
    const held = { hymns: [song(1), song(2)], nextNumber: 7 };
    const plan = addSongs(held, NO_HASHES, BOOK, [hashed(7), hashed(12)], "ml", "Mlym");
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.added.map((a) => a.number)).toEqual([7, 12]);
    // The counter moves past the highest given, not just the last.
    expect(plan.book.nextNumber).toBe(13);
    expect(plan.book.hymnCount).toBe(4);
  });

  it("refuses a number held or retired, naming the song", () => {
    const held = { hymns: [song(1), song(2)], nextNumber: 7 };
    for (const number of [1, 2, 3, 6]) {
      const plan = addSongs(held, NO_HASHES, BOOK, [hashed(number, "Blest Be")], "en", "Latn");
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.message).toContain(`Song ${number} “Blest Be”`);
    }
  });

  it("refuses a number used twice in the batch", () => {
    const plan = addSongs(
      null,
      NO_HASHES,
      BOOK,
      [hashed(4), hashed(5), { hymn: song(4, "Again"), hash: "hx" }],
      "en",
      "Latn",
    );
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.message).toContain("“Again”");
  });

  it("never reuses a held number, even if the counter lags", () => {
    const plan = addSongs(
      { hymns: [song(4)], nextNumber: 2 },
      NO_HASHES,
      BOOK,
      [hashed(4)],
      "en",
      "Latn",
    );
    expect(plan.ok).toBe(false);
    const ok = addSongs(
      { hymns: [song(4)], nextNumber: 2 },
      NO_HASHES,
      BOOK,
      [hashed(5)],
      "en",
      "Latn",
    );
    expect(ok.ok).toBe(true);
  });

  it("does not add a song twice: one the book holds by hash is reported, not checked for a number", () => {
    const held = new Map([["h1", 3]]);
    const plan = addSongs(
      { hymns: [song(3)], nextNumber: 4 },
      held,
      BOOK,
      [hashed(1), hashed(9)],
      "en",
      "Latn",
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.already).toEqual(new Map([[1, 3]]));
    expect(plan.added.map((a) => a.number)).toEqual([9]);
  });

  it("adds a song of the batch once when the batch repeats it", () => {
    const twin = { hymn: song(6), hash: "h5" };
    const plan = addSongs(null, NO_HASHES, BOOK, [hashed(5), twin], "en", "Latn");
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.added.map((a) => a.number)).toEqual([5]);
    expect(plan.already).toEqual(new Map([[6, 5]]));
  });

  it("gives a song its own language and script when it has them", () => {
    const own = { hymn: { ...song(2), language: "ml", script: "Mlym" }, hash: "h2" };
    const plan = addSongs(null, NO_HASHES, BOOK, [hashed(1), own], "en", "Latn");
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.hymns.map((h) => [h.language, h.script])).toEqual([
      ["en", "Latn"],
      ["ml", "Mlym"],
    ]);
  });

  it("makes a corpus format 1 accepts once the extra fields are set aside", () => {
    const plan = addSongs(
      { hymns: [song(1)], nextNumber: 3 },
      NO_HASHES,
      BOOK,
      [hashed(3)],
      "en",
      "Latn",
    );
    if (!plan.ok) throw new Error(plan.message);
    const shaped = asContainerShape(plan.book, plan.hymns);
    expect(shaped.book).not.toHaveProperty("nextNumber");
    expect(shaped.hymns.every((h) => !("language" in h) && !("script" in h))).toBe(true);
    const files = shaped.hymns.map((hymn) => ({ file: hymnFileName(hymn.number), hymn }));
    expect(validateCorpus(shaped.book, files)).toEqual([]);
  });
});

describe("ownStatus", () => {
  const hymns = [
    { number: 3, title: "A" },
    { number: 9, title: "B" },
  ];
  const hashes = new Map([
    [3, "ha"],
    [9, "hb"],
  ]);
  const book = { key: "k", origin: OWN_ORIGIN, title: "Mine" };

  it("lists the songs the book would add and the ones it holds", () => {
    const status = ownStatus(book, 5, new Map([["ha", 2]]), hymns, hashes);
    expect(status).toMatchObject({ next: 5, has: { 3: 2 }, adding: [9] });
    expect(status.problem).toBeUndefined();
  });

  it("says a number held or retired, but not for a song already there", () => {
    expect(ownStatus(book, 10, NO_HASHES, hymns, hashes).problem).toContain("Song 3 “A”");
    expect(ownStatus(book, 10, new Map([["ha", 2]]), hymns, hashes).problem).toContain("Song 9");
    expect(
      ownStatus(
        book,
        10,
        new Map([
          ["ha", 2],
          ["hb", 4],
        ]),
        hymns,
        hashes,
      ).problem,
    ).toBeUndefined();
  });

  it("has no problem to say for a book that cannot be opened", () => {
    expect(ownStatus(book, null, NO_HASHES, hymns, hashes)).toMatchObject({ next: null });
  });
});

describe("statusFor", () => {
  const list = [
    ownStatus(
      { key: "a", origin: ASSORTED_ORIGIN, title: "Assorted Hymns" },
      2,
      NO_HASHES,
      [],
      new Map(),
    ),
    ownStatus({ key: "b", origin: OWN_ORIGIN, title: "Camp" }, 4, NO_HASHES, [], new Map()),
    ownStatus({ key: null, origin: OWN_ORIGIN, title: "" }, 1, NO_HASHES, [], new Map()),
  ];

  it("finds a book by key, the default one by origin, and a new one with its title", () => {
    expect(statusFor(list, { kind: "book", key: "b" })?.title).toBe("Camp");
    expect(statusFor(list, { kind: "default" })?.key).toBe("a");
    expect(statusFor(list, { kind: "new", title: "Retreat" })).toMatchObject({
      key: null,
      title: "Retreat",
    });
    expect(statusFor(list, { kind: "book", key: "zz" })).toBeUndefined();
  });
});

describe("origins and order", () => {
  it("takes the default origin and the own origin for books of yours", () => {
    expect(isOwnOrigin("assorted")).toBe(true);
    expect(isOwnOrigin("own")).toBe(true);
    expect(isOwnOrigin("hof")).toBe(false);
  });

  it("lists your books first and keeps the rest in order", () => {
    const books = [
      { kind: "shipped", n: 1 },
      { kind: "own", n: 2 },
      { kind: "loaded", n: 3 },
      { kind: "own", n: 4 },
    ];
    expect(libraryOrder(books).map((b) => b.n)).toEqual([2, 4, 1, 3]);
  });
});
