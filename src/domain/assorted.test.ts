// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  ASSORTED_LANGUAGE,
  ASSORTED_ORIGIN,
  ASSORTED_SCRIPT,
  ASSORTED_TITLE,
  addSong,
  asContainerShape,
  assortedOrder,
  isLanguageTag,
  isScriptCode,
} from "./assorted.ts";
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

describe("assortedOrder", () => {
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
    expect(assortedOrder(list).map((x) => x.number)).toEqual([6, 3, 5, 2, 4, 1]);
  });

  it("collates titles in the song's own language", () => {
    const titles = ["Zebra", "Ärlig", "Aal"];
    const order = (language: string) =>
      assortedOrder(titles.map((t, i) => s(i + 1, t, language))).map((x) => x.title);
    // Swedish puts "ä" after "z"; German sorts it with "a".
    expect(order("sv")).toEqual(["Aal", "Zebra", "Ärlig"]);
    expect(order("de")).toEqual(["Aal", "Ärlig", "Zebra"]);
  });

  it("falls back to the default collator for a tag the runtime rejects", () => {
    const bad = "x-bogus-tag-that-is-far-too-long-for-a-subtag";
    expect(assortedOrder([s(2, "b", bad), s(1, "a", bad)]).map((x) => x.number)).toEqual([1, 2]);
  });

  it("sorts a song with no language first, and does not change its input", () => {
    const list = [s(1, "A", "en"), s(2, "B")];
    expect(assortedOrder(list).map((x) => x.number)).toEqual([2, 1]);
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

describe("addSong", () => {
  it("makes the book with the song as number 1 and next_number 2", () => {
    const plan = addSong(null, song(99), "en", "Latn");
    expect(plan.number).toBe(1);
    expect(plan.hymns).toEqual([{ ...song(99), number: 1, language: "en", script: "Latn" }]);
    expect(plan.book).toMatchObject({
      id: ASSORTED_ORIGIN,
      title: ASSORTED_TITLE,
      language: ASSORTED_LANGUAGE,
      script: ASSORTED_SCRIPT,
      hymnCount: 1,
      nextNumber: 2,
    });
  });

  it("takes next_number, never a retired number below it", () => {
    const plan = addSong({ hymns: [song(1), song(2)], nextNumber: 7 }, song(50), "ml", "Mlym");
    expect(plan.number).toBe(7);
    expect(plan.book.nextNumber).toBe(8);
    expect(plan.book.hymnCount).toBe(3);
  });

  it("never reuses a held number, even if the counter lags", () => {
    expect(addSong({ hymns: [song(4)], nextNumber: 2 }, song(1), "en", "Latn").number).toBe(5);
  });

  it("makes a corpus format 1 accepts once the extra fields are set aside", () => {
    const plan = addSong({ hymns: [song(1)], nextNumber: 3 }, song(1), "en", "Latn");
    const shaped = asContainerShape(plan.book, plan.hymns);
    expect(shaped.book).not.toHaveProperty("nextNumber");
    expect(shaped.hymns.every((h) => !("language" in h) && !("script" in h))).toBe(true);
    const files = shaped.hymns.map((hymn) => ({ file: hymnFileName(hymn.number), hymn }));
    expect(validateCorpus(shaped.book, files)).toEqual([]);
  });
});
