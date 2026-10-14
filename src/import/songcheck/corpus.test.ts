import { statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gaps, notSongs, songs } from "./corpus.ts";

const all = [...songs, ...notSongs];
const OPEN = /^(Public Domain|CC0-1\.0|CC BY(-SA)? [0-9.]+|Public domain work; .*|UDHR text: .*)$/;

describe("the labelled set (ADR-0034 §1)", () => {
  it("has unique ids, a label that matches its file, and text", () => {
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
    for (const s of songs) expect(s.label, s.id).toBe("song");
    for (const n of notSongs) {
      expect(n.label, n.id).toBe("not-song");
      expect(n.category, n.id).toBeDefined();
    }
    for (const i of all) expect(i.text.trim().length, i.id).toBeGreaterThan(5);
  });

  it("records a source and an open licence beside every item", () => {
    for (const i of all) {
      expect(i.source, i.id).toMatch(/^(https:\/\/|written for this test set)/);
      expect(i.licence, i.id).toMatch(OPEN);
      expect(i.language, i.id).toBeTruthy();
      expect(i.script, i.id).toMatch(/^[A-Z][a-z]{3}$/);
    }
  });

  it("covers Malayalam and English in songs, with emoji-decorated and refrain cases", () => {
    const ids = songs.map((s) => s.id);
    expect(songs.filter((s) => s.language === "ml").length).toBeGreaterThanOrEqual(8);
    expect(songs.filter((s) => s.language === "en").length).toBeGreaterThanOrEqual(8);
    expect(ids.some((id) => id.endsWith("-emoji"))).toBe(true);
    expect(songs.some((s) => s.traits.includes("short-refrain"))).toBe(true);
    expect(songs.some((s) => s.traits.includes("odd-punctuation"))).toBe(true);
  });

  it("covers the scripts it claims, and lists the ones it lacks", () => {
    const scripts = new Set(songs.map((s) => s.script));
    for (const s of ["Latn", "Cyrl", "Grek", "Arab", "Hebr", "Deva", "Beng", "Mlym", "Taml"]) {
      expect(scripts.has(s), s).toBe(true);
    }
    expect(gaps).toHaveProperty("songScriptsMissing");
  });

  it("holds every non-song category", () => {
    const cats = new Set(notSongs.map((n) => n.category));
    for (const c of ["code", "maths", "data", "urls", "chat", "email", "prose", "emoji"]) {
      expect(cats.has(c as never), c).toBe(true);
    }
  });

  it("stays lean (under about 320 KB)", () => {
    const bytes = ["songs.json", "not-songs.json", "gaps.json"]
      .map((f) => statSync(new URL(`./fixtures/${f}`, import.meta.url)).size)
      .reduce((a, b) => a + b, 0);
    expect(bytes).toBeLessThan(320_000);
  });
});
