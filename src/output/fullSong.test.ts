import { describe, expect, it } from "vitest";
import {
  balance,
  FULL_FIT_FLOOR,
  FULL_FIT_MAX,
  FULL_FIT_MIN,
  layoutSong,
  type Measure,
} from "./fullSong.ts";

const LINE = 81 * 1.35; // px of one line at fit 1, 1080p
const ROOM = 864;

/** A measure: a part of n lines is n lines tall, plus padding, and narrower
 * columns wrap more (each extra column makes a part `wrap` taller). */
function measureOf(
  lines: number[],
  opts: { wrap?: number; wide?: (columns: number) => boolean } = {},
) {
  const wrap = opts.wrap ?? 0;
  const calls: [number, number][] = [];
  const measure: Measure = (columns, fit) => {
    calls.push([columns, fit]);
    const unit = LINE * fit;
    return {
      heights: lines.map((n) => (n * unit + 0.6 * unit) * (1 + wrap * (columns - 1))),
      fits: lines.map(() => !opts.wide?.(columns)),
    };
  };
  return { measure, calls };
}

const flat = (columns: number[][]) => columns.flat();

describe("balance", () => {
  it("cuts into runs of whole items, in order, minimising the tallest", () => {
    const result = balance([4, 4, 4, 4, 4], 2);
    expect(result?.tallest).toBe(12);
    // A tie between [3|2] and [2|3]: the earlier column fills first.
    expect(result?.groups).toEqual([
      [0, 1, 2],
      [3, 4],
    ]);
  });

  it("among equal tallest takes the most even", () => {
    // Three runs: [4,1 | 1,4 | 1,1] and [4 | 1,1,4 | 1,1] ... both 6 tall or
    // less; the even one wins. Checked against brute force below as well.
    const result = balance([4, 1, 1, 4, 1, 1], 3);
    expect(result?.tallest).toBe(5);
    expect(result?.groups).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("never splits an item, even one taller than the rest together", () => {
    const result = balance([10, 1, 1], 2);
    expect(result?.groups).toEqual([[0], [1, 2]]);
    expect(result?.tallest).toBe(10);
  });

  it("is one run for one column and one item each for as many as items", () => {
    expect(balance([1, 2, 3], 1)?.groups).toEqual([[0, 1, 2]]);
    expect(balance([1, 2, 3], 3)?.groups).toEqual([[0], [1], [2]]);
  });

  it("refuses more runs than items, or none", () => {
    expect(balance([1, 2], 3)).toBeNull();
    expect(balance([1, 2], 0)).toBeNull();
    expect(balance([], 1)).toBeNull();
  });

  it("keeps every item exactly once, in order", () => {
    const heights = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
    for (let k = 1; k <= 6; k++) {
      const groups = balance(heights, k)?.groups ?? [];
      expect(groups).toHaveLength(k);
      expect(groups.every((g) => g.length > 0)).toBe(true);
      expect(groups.flat()).toEqual(heights.map((_, i) => i));
    }
  });

  it("matches brute force: the least tallest, then the least squares", () => {
    // A small deterministic generator, so a failure repeats.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const cuts = (n: number, k: number): number[][] => {
      if (k === 1) return [[n]];
      const out: number[][] = [];
      for (let first = 1; first <= n - (k - 1); first++)
        for (const rest of cuts(n - first, k - 1)) out.push([first, ...rest]);
      return out;
    };
    for (let round = 0; round < 60; round++) {
      const n = 2 + (next() % 7);
      const heights = Array.from({ length: n }, () => 1 + (next() % 9));
      const k = 1 + (next() % Math.min(4, n));
      let bestMax = Number.POSITIVE_INFINITY;
      let bestSquares = Number.POSITIVE_INFINITY;
      for (const sizes of cuts(n, k)) {
        let at = 0;
        const sums = sizes.map((size) => {
          const sum = heights.slice(at, at + size).reduce((a, b) => a + b, 0);
          at += size;
          return sum;
        });
        const max = Math.max(...sums);
        const squares = sums.reduce((a, b) => a + b * b, 0);
        if (max < bestMax || (max === bestMax && squares < bestSquares)) {
          bestMax = max;
          bestSquares = squares;
        }
      }
      const got = balance(heights, k);
      expect(got?.tallest).toBe(bestMax);
      const squares = (got?.groups ?? [])
        .map((g) => g.reduce((a, i) => a + heights[i], 0))
        .reduce((a, b) => a + b * b, 0);
      expect(squares).toBe(bestSquares);
    }
  });
});

describe("layoutSong", () => {
  it("has no pages for no parts", () => {
    const { measure } = measureOf([]);
    expect(layoutSong(0, measure, ROOM)).toEqual({
      fit: FULL_FIT_MAX,
      slots: [],
      pages: [],
      belowFloor: false,
    });
  });

  it("keeps a short song in one column at full size when it fits", () => {
    // 6 lines and two paddings: 7.2 line-units, in a room of 7.9.
    const { measure } = measureOf([3, 3]);
    const layout = layoutSong(2, measure, ROOM);
    expect(layout.pages).toEqual([{ columns: [[0, 1]] }]);
    expect(layout.fit).toBe(FULL_FIT_MAX);
    expect(layout.belowFloor).toBe(false);
  });

  it("stays in one column when a second buys under about 11% of type", () => {
    // One column: 8.2 units, fit 0.96. Two: 4.1 x 1.3 = 5.3 units, capped at 1.
    const { measure } = measureOf([3.5, 3.5], { wrap: 0.3 });
    const layout = layoutSong(2, measure, ROOM);
    expect(layout.pages[0].columns).toHaveLength(1);
    expect(layout.fit).toBeCloseTo(864 / (8.2 * LINE), 2);
  });

  it("adds columns while they buy enough type, the fewest within 10% of the best", () => {
    // Five parts of 4 lines, wrapping 30% per extra column: one column 0.34,
    // two 0.44, three 0.54, four 0.45. Three.
    const { measure } = measureOf([4, 4, 4, 4, 4], { wrap: 0.3 });
    const layout = layoutSong(5, measure, ROOM);
    expect(layout.pages[0].columns).toEqual([[0, 1], [2, 3], [4]]);
    expect(layout.fit).toBeCloseTo(864 / (9.2 * 1.6 * LINE), 2);
  });

  it("takes three columns over four when four is no larger", () => {
    // Six parts of 4: two 0.56, three 0.83, four 0.81.
    const { measure } = measureOf([4, 4, 4, 4, 4, 4], { wrap: 0.02 });
    const layout = layoutSong(6, measure, ROOM);
    expect(layout.pages[0].columns).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("puts every part in exactly one column of one page, in printed order", () => {
    const { measure } = measureOf(
      Array.from({ length: 11 }, (_, i) => 3 + (i % 3)),
      { wrap: 0.05 },
    );
    const layout = layoutSong(11, measure, ROOM);
    const all = layout.pages.flatMap((p) => flat(p.columns));
    expect(all).toEqual(Array.from({ length: 11 }, (_, i) => i));
    for (const page of layout.pages) expect(page.columns.length).toBeLessThanOrEqual(4);
  });

  it("reaches the floor on one page when four columns can", () => {
    // 20 parts of 2 lines: four columns of 5 parts, 13 x 1.3 units: 0.47.
    const { measure } = measureOf(Array(20).fill(2), { wrap: 0.1 });
    const layout = layoutSong(20, measure, ROOM);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].columns).toHaveLength(4);
    expect(layout.fit).toBeGreaterThanOrEqual(FULL_FIT_FLOOR);
    expect(layout.belowFloor).toBe(false);
  });

  it("splits into the fewest pages of whole parts when one page is under the floor", () => {
    // 30 parts of 5 lines, wrapping 10%: one page 0.14; two pages 0.27; three
    // pages of ten parts 0.36.
    const { measure } = measureOf(Array(30).fill(5), { wrap: 0.1 });
    const layout = layoutSong(30, measure, ROOM);
    expect(layout.pages).toHaveLength(3);
    expect(layout.fit).toBeGreaterThanOrEqual(FULL_FIT_FLOOR);
    expect(layout.belowFloor).toBe(false);
    expect(layout.pages.flatMap((p) => flat(p.columns))).toEqual(
      Array.from({ length: 30 }, (_, i) => i),
    );
    // Even pages: ten parts each.
    expect(layout.pages.map((p) => flat(p.columns).length)).toEqual([10, 10, 10]);
    // Fifteen parts: one page is under the floor, two pages reach it.
    const fifteen = measureOf(Array(15).fill(5), { wrap: 0.1 }).measure;
    expect(layoutSong(15, fifteen, ROOM).pages).toHaveLength(2);
  });

  it("balances the pages by height, not by count", () => {
    // Ten long parts then ten short ones: the cut falls so each page is as
    // tall as the other, the long parts on the first page alone.
    const lines = [...Array(10).fill(8), ...Array(10).fill(2)];
    const { measure } = measureOf(lines, { wrap: 0.15 });
    const layout = layoutSong(20, measure, ROOM);
    expect(layout.pages.length).toBeGreaterThan(1);
    const heights = layout.pages.map((p) =>
      flat(p.columns).reduce((a, i) => a + lines[i] + 0.6, 0),
    );
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(8.6);
  });

  it("one fit for the whole song: every page shows at the smallest page's", () => {
    const lines = [...Array(8).fill(9), ...Array(8).fill(1)];
    const { measure } = measureOf(lines, { wrap: 0.2 });
    const layout = layoutSong(16, measure, 400);
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const page of layout.pages) {
      const heights = measure(page.columns.length, layout.fit).heights;
      for (const column of page.columns) {
        const tall = column.reduce((a, i) => a + heights[i], 0);
        expect(tall).toBeLessThanOrEqual(401);
      }
    }
  });

  it("a single part taller than the room stays whole and goes below the floor", () => {
    // 40 lines in 7.9 line-units: fit 0.19.
    const { measure } = measureOf([40]);
    const layout = layoutSong(1, measure, ROOM);
    expect(layout.pages).toEqual([{ columns: [[0]] }]);
    expect(layout.fit).toBeLessThan(FULL_FIT_FLOOR);
    expect(layout.fit).toBeGreaterThanOrEqual(FULL_FIT_MIN);
    expect(layout.belowFloor).toBe(true);
  });

  it("a part taller than a column is shown whole, once, with the type down", () => {
    const { measure } = measureOf([2, 2, 60, 2, 2]);
    const layout = layoutSong(5, measure, ROOM);
    const all = layout.pages.flatMap((p) => flat(p.columns));
    expect(all.filter((i) => i === 2)).toHaveLength(1);
    expect([...all].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(layout.belowFloor).toBe(true);
  });

  it("never goes below the least, even when nothing fits", () => {
    const { measure } = measureOf([500]);
    const layout = layoutSong(1, measure, ROOM);
    expect(layout.fit).toBe(FULL_FIT_MIN);
    expect(layout.belowFloor).toBe(true);
    expect(layout.pages[0].columns).toEqual([[0]]);
  });

  it("a word too wide for a narrow column rules those counts out", () => {
    const { measure } = measureOf([4, 4, 4, 4, 4], {
      wide: (columns) => columns > 1,
    });
    const layout = layoutSong(5, measure, ROOM);
    expect(layout.pages[0].columns).toHaveLength(1);
    expect(layout.fit).toBeLessThan(0.4);
  });

  it("never uses more than four columns, and uses four when five would be better", () => {
    // 12 parts of 3 lines: four columns of 3 parts fit at 0.73; a fifth would
    // do better still, and is not allowed.
    const { measure } = measureOf(Array(12).fill(3));
    const layout = layoutSong(12, measure, ROOM);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].columns).toHaveLength(4);
    expect(layout.pages[0].columns.map((c) => c.length)).toEqual([3, 3, 3, 3]);
    expect(layout.fit).toBeCloseTo(864 / (3 * 3.6 * LINE), 2);
  });
});

describe("layoutSong with the chorus sung on every page", () => {
  // Printed: verse 0, chorus 1, verses 2..N. Sung: 0 C 2 C 3 C ...
  const song = (verses: number, verseLines = 5, chorusLines = 4) => {
    const lines = [verseLines, chorusLines, ...Array(verses - 1).fill(verseLines)];
    const count = lines.length;
    const verseIdx = Array.from({ length: count }, (_, i) => i).filter((i) => i !== 1);
    const order = verseIdx.flatMap((v) => [v, 1]);
    return { lines, count, sung: { chorus: 1, order } };
  };
  const partOf = (l: ReturnType<typeof layoutSong>) => l.pages.map((p) => flat(p.columns));

  it("leaves a song that fits one page as printed, the chorus once", () => {
    const { lines, count, sung } = song(3, 2, 2);
    const layout = layoutSong(count, measureOf(lines).measure, ROOM, sung);
    expect(layout.pages).toHaveLength(1);
    expect(layout.slots).toEqual([0, 1, 2, 3]);
  });

  it("prints the chorus once on each page, after the page's first verse", () => {
    const { lines, count, sung } = song(14);
    const { measure } = measureOf(lines, { wrap: 0.1 });
    const layout = layoutSong(count, measure, ROOM, sung);
    expect(layout.pages.length).toBeGreaterThan(1);
    expect(layout.belowFloor).toBe(false);
    for (const slots of partOf(layout)) {
      const parts = slots.map((s) => layout.slots[s]);
      expect(parts.filter((p) => p === 1)).toHaveLength(1);
      // Sung 0 C 2 C 3 C: the first sung chorus on a page follows its first verse.
      expect(parts.indexOf(1)).toBe(1);
    }
    // Every verse exactly once, in printed order.
    const verses = layout.slots.filter((p) => p !== 1);
    expect(verses).toEqual([0, ...Array.from({ length: 13 }, (_, i) => i + 2)]);
    expect(layout.slots.filter((p) => p === 1)).toHaveLength(layout.pages.length);
    // Slot ids are unique, and each page's slots are its own.
    expect(new Set(partOf(layout).flat()).size).toBe(layout.slots.length);
  });

  it("places the chorus at its first sung position on the page, not the last verse", () => {
    // Printed 0 C 2..14; sung 0 2 3 4 5 6 7 C 8 9 ... 14 C: the chorus first
    // follows verse 7, and last verse 14.
    const { lines, count } = song(14);
    const verses = [0, ...Array.from({ length: 13 }, (_, i) => i + 2)];
    const order = [...verses.slice(0, 7), 1, ...verses.slice(7), 1];
    const layout = layoutSong(count, measureOf(lines, { wrap: 0.1 }).measure, ROOM, {
      chorus: 1,
      order,
    });
    expect(layout.pages.length).toBeGreaterThan(1);
    for (const slots of partOf(layout)) {
      const parts = slots.map((s) => layout.slots[s]);
      const at = parts.indexOf(1);
      if (at < 0) continue;
      expect(parts.filter((p) => p === 1)).toHaveLength(1);
      // The verse before the copy is the first verse of the page that the
      // chorus follows in the sung order.
      const follows = parts[at - 1];
      expect([7, 14]).toContain(follows);
      if (parts.includes(7)) expect(follows).toBe(7);
    }
    // Every sung chorus has a copy on the page of the verse it follows.
    const pageOf = (verse: number) =>
      layout.pages.findIndex((p) => flat(p.columns).some((s) => layout.slots[s] === verse));
    for (const verse of [7, 14]) {
      const page = layout.pages[pageOf(verse)];
      expect(flat(page.columns).some((s) => layout.slots[s] === 1)).toBe(true);
    }
  });

  it("counts the repeated chorus in the fit: pages are smaller than the plain split's", () => {
    const { lines, count, sung } = song(14);
    const { measure } = measureOf(lines, { wrap: 0.1 });
    const plain = layoutSong(count, measure, ROOM);
    const repeating = layoutSong(count, measure, ROOM, sung);
    expect(repeating.pages.length).toBeGreaterThanOrEqual(plain.pages.length);
    for (const page of repeating.pages) {
      const heights = measure(page.columns.length, repeating.fit).heights;
      for (const column of page.columns) {
        const tall = column.reduce((a, s) => a + heights[repeating.slots[s]], 0);
        expect(tall).toBeLessThanOrEqual(ROOM + 1);
      }
    }
  });

  it("puts a chorus the song opens on before its first verse", () => {
    const { lines, count, sung } = song(14);
    const opening = { chorus: 1, order: [1, ...sung.order] };
    const layout = layoutSong(count, measureOf(lines, { wrap: 0.1 }).measure, ROOM, opening);
    const first = layout.pages[0].columns.flat().map((s) => layout.slots[s]);
    // Once on the page, before the verse the song opens on.
    expect(first.slice(0, 2)).toEqual([1, 0]);
    expect(first.filter((p) => p === 1)).toHaveLength(1);
  });

  it("falls back to the plain split when a page with its chorus cannot fit a verse", () => {
    // A chorus as tall as the room: no page holds a verse and a chorus at the
    // floor, where the plain split reaches it.
    const { lines, count, sung } = song(8, 5, 40);
    const { measure } = measureOf(lines, { wrap: 0.1 });
    const plain = layoutSong(count, measure, ROOM);
    const layout = layoutSong(count, measure, ROOM, sung);
    expect(layout).toEqual(plain);
    expect(layout.slots).toEqual(Array.from({ length: count }, (_, i) => i));
  });

  it("is the plain layout for a chorus sung once", () => {
    const { lines, count } = song(14);
    const { measure } = measureOf(lines, { wrap: 0.1 });
    const once = { chorus: 1, order: [0, 1, ...Array.from({ length: 12 }, (_, i) => i + 2)] };
    expect(layoutSong(count, measure, ROOM, once)).toEqual(layoutSong(count, measure, ROOM));
  });
});
