// @vitest-environment node

import { describe, expect, it } from "vitest";
import { layoutSong } from "./fullSong.ts";
import {
  analyticMeasure,
  LINE_HEIGHT,
  MARKER_HEIGHT,
  measureSong,
  PART_PAD_Y,
  partAt,
  type Segment,
  signature,
  splitLine,
  widest,
  wrappedLines,
} from "./fullSongText.ts";

/** A line of words of the given widths (em), a space of 0.25 between. */
const line = (...widths: number[]): Segment[] =>
  widths.map((width, i) => ({ width, gap: i === 0 ? 0 : 0.25 }));

describe("splitLine", () => {
  it("breaks at spaces and drops the empty", () => {
    expect(splitLine("One  two three ")).toEqual([["One"], ["two"], ["three"]]);
    expect(splitLine("")).toEqual([]);
    expect(splitLine("   ")).toEqual([]);
  });

  it("breaks after a hyphen that joins letters, not one beside a space or digit", () => {
    expect(splitLine("well-known")).toEqual([["well-", "known"]]);
    expect(splitLine("a - b")).toEqual([["a"], ["-"], ["b"]]);
    expect(splitLine("page 2-3")).toEqual([["page"], ["2-3"]]);
  });
});

describe("wrappedLines", () => {
  it("fits what fits, and takes a new line for the word that does not", () => {
    // 1 + .25 + 1 = 2.25 fits in 2.5; a third word (1) needs 3.5.
    expect(wrappedLines(line(1, 1), 2.5)).toBe(1);
    expect(wrappedLines(line(1, 1, 1), 2.5)).toBe(2);
    expect(wrappedLines(line(1, 1, 1), 3.5)).toBe(1);
  });

  it("does not count a trailing space", () => {
    expect(wrappedLines(line(1, 1), 2.25)).toBe(1);
    expect(wrappedLines(line(1, 1), 2.24)).toBe(2);
  });

  it("never breaks a word: one too wide has a line to itself, overflowing", () => {
    expect(wrappedLines(line(1, 5, 1), 3)).toBe(3);
    expect(wrappedLines(line(5), 3)).toBe(1);
  });

  it("is zero for a blank line", () => {
    expect(wrappedLines([], 3)).toBe(0);
  });

  it("breaks after a hyphen with no space", () => {
    // "a-" and "b" are joined with no gap: 1 + 1 fits 2, a space would not.
    const joined: Segment[] = [
      { width: 1, gap: 0 },
      { width: 1, gap: 0 },
    ];
    expect(wrappedLines(joined, 2)).toBe(1);
    expect(wrappedLines(joined, 1.5)).toBe(2);
  });
});

describe("partAt", () => {
  const part = { lines: [line(1, 1, 1), line(2), []] };

  it("is the lines it wraps to, at 1.35em, and the padding", () => {
    // Width 3.5: the first line is one, the second one, the blank none.
    const wide = partAt(part, 3.5, 0);
    expect(wide.height).toBeCloseTo(2 * LINE_HEIGHT + 2 * PART_PAD_Y);
    // Width 2.5: the first wraps to two.
    expect(partAt(part, 2.5, 0).height).toBeCloseTo(3 * LINE_HEIGHT + 2 * PART_PAD_Y);
  });

  it("makes room for a part's marker above its lines, and for its width", () => {
    const marked = { lines: part.lines, marker: { width: 1.2 } };
    // The marker row is a fixed height, whatever the script of the lines.
    expect(partAt(marked, 3.5, 0).height).toBeCloseTo(partAt(part, 3.5, 0).height + MARKER_HEIGHT);
    // It is a word that never breaks: a column narrower than it does not fit.
    expect(partAt(marked, 3.5, 0).fits).toBe(true);
    expect(partAt({ lines: [line(0.5)], marker: { width: 1.2 } }, 1, 0).fits).toBe(false);
    expect(partAt({ lines: [line(0.5)], marker: { width: 1.2 } }, 1, 0.3).fits).toBe(true);
  });

  it("says whether every word fits, within a tolerance", () => {
    expect(partAt(part, 3, 0).fits).toBe(true);
    expect(partAt(part, 1.9, 0).fits).toBe(false);
    expect(partAt(part, 1.9, 0.1).fits).toBe(true);
  });

  it("widest piece is what must fit", () => {
    expect(widest(line(1, 3, 2))).toBe(3);
    expect(widest([])).toBe(0);
  });
});

describe("analyticMeasure", () => {
  // Every character half an em (the fallback without a canvas).
  const parts = [
    { lines: ["aaaa bbbb cccc", "dd"] },
    { lines: ["eeeeeeeeeeeeeeeeeeee"] }, // one word, 10em
  ];
  const song = measureSong(parts, "serif", "500");

  it("measures a part's lines in a column's width, in px", () => {
    // Sheet 1000px, type 100px at fit 1: one column is 10em, 8.8em inside the
    // padding. "aaaa bbbb cccc" is 2+.5+2+.5+2 = 7em: one line; dd one line.
    const measure = analyticMeasure(song, 100, 1000, 0);
    const one = measure(1, 1);
    expect(one.heights[0]).toBeCloseTo((2 * LINE_HEIGHT + 2 * PART_PAD_Y) * 100);
    // Two columns of 0, gap 0: 5em, 3.8em inside: the words are 2em, so
    // "aaaa bbbb" (4.5em) wraps: aaaa / bbbb / cccc is three lines.
    const two = measure(2, 1);
    expect(two.heights[0]).toBeCloseTo((4 * LINE_HEIGHT + 2 * PART_PAD_Y) * 100);
  });

  it("scales: half the type is twice the room in em", () => {
    const measure = analyticMeasure(song, 100, 1000, 0);
    const half = measure(2, 0.5); // 10em each, 8.8 inside: one line again
    expect(half.heights[0]).toBeCloseTo((2 * LINE_HEIGHT + 2 * PART_PAD_Y) * 50);
  });

  it("takes the gap between columns out of their width", () => {
    const measure = analyticMeasure(song, 100, 1000, 200);
    // Two columns: (1000 - 200) / 2 = 400px = 4em, 2.8em inside the padding:
    // a word (2em) fits, "aaaa bbbb" does not.
    expect(measure(2, 1).heights[0]).toBeCloseTo((4 * LINE_HEIGHT + 2 * PART_PAD_Y) * 100);
  });

  it("says when a word does not fit its column", () => {
    const measure = analyticMeasure(song, 100, 1000, 0);
    expect(measure(1, 1).fits).toEqual([true, false]); // 10em in 8.8em
    expect(measure(1, 0.5).fits).toEqual([true, true]); // 5em in 18.8em
  });

  it("gives the rule what it needs: a song laid out on it, whole parts, in order", () => {
    const text = Array.from({ length: 8 }, (_, i) => ({
      lines: Array.from({ length: 4 }, (_, k) => `Verse ${i} line ${k} of a hymn`),
    }));
    const metrics = measureSong(text, "serif", "500");
    const layout = layoutSong(8, analyticMeasure(metrics, 81, 1728, 51.84), 864);
    const placed = layout.pages.flatMap((p) => p.columns.flat());
    expect(placed).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(layout.fit).toBeGreaterThan(0.15);
    expect(layout.fit).toBeLessThanOrEqual(1);
  });

  it("never lets a column pass the room it was fitted to", () => {
    const text = Array.from({ length: 12 }, (_, i) => ({
      lines: Array.from({ length: 5 }, (_, k) => `Verse ${i} line ${k} of a longer hymn today`),
    }));
    const measure = analyticMeasure(measureSong(text, "serif", "500"), 81, 1728, 51.84);
    const layout = layoutSong(12, measure, 864);
    expect(layout.belowFloor).toBe(false);
    for (const page of layout.pages) {
      const k = page.columns.length;
      const heights = measure(k, layout.fit).heights;
      for (const column of page.columns) {
        const tall = column.reduce((sum, p) => sum + heights[p], 0);
        expect(tall).toBeLessThanOrEqual(864 + 0.5);
      }
    }
  });
});

describe("markers", () => {
  it("are measured with their part, in the parent's em, so the arithmetic counts them", () => {
    const parts = [
      { lines: ["one two"], marker: "1" },
      { lines: ["one two"], marker: undefined },
    ];
    const metrics = measureSong(parts, "serif", "500");
    expect(metrics.parts[0].marker?.width).toBeGreaterThan(0);
    expect(metrics.parts[1].marker).toBeUndefined();
    const measured = analyticMeasure(metrics, 100, 1000, 0)(1, 1);
    // Same lines, the marked one taller by the marker's row (at 100px).
    expect(measured.heights[0] - measured.heights[1]).toBeCloseTo(MARKER_HEIGHT * 100);
  });

  it("are part of a song's signature, so showing or hiding them lays it out again", () => {
    const plain = [{ id: "a", lines: ["x"] }];
    expect(signature([{ id: "a", lines: ["x"], marker: "1" }])).not.toBe(signature(plain));
    expect(signature([{ id: "a", lines: ["x"], marker: "1" }])).not.toBe(
      signature([{ id: "a", lines: ["x"], marker: "2" }]),
    );
    expect(signature([{ id: "a", lines: ["x"], marker: undefined }])).toBe(signature(plain));
  });
});
