// @vitest-environment node

import { describe, expect, it } from "vitest";
import { findGutters, fontKey, linesFromRuns, type SourceRun } from "./source.ts";

/** A run at (x, y), 10pt, 5pt per character: widths are easy to reason about. */
function run(text: string, x: number, y: number, font = "Times-Roman"): SourceRun {
  return { text, x, y, width: text.length * 5, size: 10, font };
}

const texts = (runs: SourceRun[]) => linesFromRuns(runs).map((line) => line.text);

/** Two columns, left at 30 and right at 200, one line each per baseline. */
function twoColumns(lines: number): SourceRun[] {
  return Array.from({ length: lines }, (_, i) => [
    run(`left line ${i}`, 30, 100 + i * 15),
    run(`right ${i}`, 200, 100 + i * 15),
  ]).flat();
}

describe("fontKey", () => {
  it("strips a subset tag, and only that", () => {
    expect(fontKey("OYCPPR+TimesNewRomanPS-ItalicMT")).toBe("TimesNewRomanPS-ItalicMT");
    expect(fontKey("Times-Roman")).toBe("Times-Roman");
    expect(fontKey("ABC+Odd")).toBe("ABC+Odd");
  });
});

describe("linesFromRuns", () => {
  it("joins the runs of a line whatever order the document draws them in", () => {
    expect(texts([run("grace", 80, 100), run("Amazing", 30, 100.5)])).toEqual(["Amazing grace"]);
  });

  it("adds a space only where the gap is one", () => {
    // "Lord I come before y" + "our throne": split mid-word, no gap.
    expect(texts([run("before y", 30, 100), run("our throne", 70, 100)])).toEqual([
      "before your throne",
    ]);
    expect(texts([run("before ", 30, 100), run("your", 70, 100)])).toEqual(["before your"]);
  });

  it("orders lines top to bottom, then left to right", () => {
    expect(texts([run("second", 30, 120), run("first", 30, 100)])).toEqual(["first", "second"]);
  });

  it("keeps a justified line whole, however wide its spaces", () => {
    // 16pt gaps, 1.6 em: wider than some gutters, but on one line only.
    const justified = [run("Father", 30, 100), run("to", 76, 100), run("the", 102, 100)];
    expect(texts([...justified, run("next", 30, 115), run("line", 30, 130)])).toEqual([
      "Father to the",
      "next",
      "line",
    ]);
  });

  it("splits a baseline at a column gutter", () => {
    expect(texts(twoColumns(3)).slice(0, 2)).toEqual(["left line 0", "right 0"]);
    expect(linesFromRuns(twoColumns(3))).toHaveLength(6);
  });

  it("finds the gutter despite a folio drawn across it", () => {
    const runs = [...twoColumns(4), run("14", 180, 400)];
    expect(findGutters(runs)).toEqual([{ from: 85, to: 200 }]);
    expect(texts(runs)).toContain("right 3");
  });

  it("takes the gutter's edge from where the next column starts", () => {
    // A short run inside the band widens it leftwards; the split still holds.
    const runs = [...twoColumns(4), run("and", 175, 160), run("more", 200, 160)];
    expect(texts(runs).slice(-2)).toEqual(["and", "more"]);
  });

  it("finds no gutter in a single column, or beside fewer than three lines", () => {
    const column = [run("one line here", 30, 100), run("short", 30, 115), run("x", 30, 130)];
    expect(findGutters(column)).toEqual([]);
    expect(findGutters(twoColumns(2))).toEqual([]);
  });

  it("takes the font carrying the most characters, and its size", () => {
    const [line] = linesFromRuns([
      { ...run("Chorus:", 30, 100, "Times-Bold"), size: 11 },
      run(" What a faithful God", 65, 100, "Times-Italic"),
    ]);
    expect(line).toMatchObject({ font: "Times-Italic", size: 10, x: 30, width: 135 });
  });

  it("drops runs that are only whitespace", () => {
    expect(linesFromRuns([run("  ", 30, 100)])).toEqual([]);
  });
});
