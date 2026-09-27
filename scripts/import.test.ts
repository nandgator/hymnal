import { describe, expect, it } from "vitest";
import type { SourceLine, SourcePage } from "../src/import/source.ts";
import { fontSummary, parsePages } from "./import.ts";

describe("parsePages", () => {
  it("reads one page, a range, or a page to the end", () => {
    expect(parsePages("5")).toEqual({ from: 5, to: 5 });
    expect(parsePages("5-12")).toEqual({ from: 5, to: 12 });
    expect(parsePages("5-")).toEqual({ from: 5 });
  });

  it("refuses anything else, saying what it takes", () => {
    expect(() => parsePages("five")).toThrow('--pages takes 5, 5-12 or 5-, not "five".');
  });
});

describe("fontSummary", () => {
  const line = (text: string, font: string): SourceLine => ({
    text,
    x: 0,
    y: 0,
    width: 10,
    size: 10,
    font,
  });
  const page = (number: number, lines: SourceLine[]): SourcePage => ({
    number,
    width: 400,
    height: 600,
    lines,
  });

  it("counts lines per font, most used first, with where each first appears", () => {
    const pages = [
      page(1, [line("(1) TITLE", "Bold"), line("verse", "Roman")]),
      page(2, [line("refrain", "Italic"), line("more", "Roman")]),
    ];
    expect(fontSummary(pages)).toEqual([
      { font: "Roman", lines: 2, page: 1, sample: "verse" },
      { font: "Bold", lines: 1, page: 1, sample: "(1) TITLE" },
      { font: "Italic", lines: 1, page: 2, sample: "refrain" },
    ]);
  });
});
