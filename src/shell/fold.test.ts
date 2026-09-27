import { describe, expect, it } from "vitest";
import { type Piece, pairs } from "./fold.ts";

const piece = (key: string, left: number, main = false): Piece => ({
  key,
  rect: { left, top: 0, width: 10, height: 10 } as DOMRect,
  main,
});

const lefts = (list: [Piece, Piece][]) => list.map(([a, b]) => [a.rect.left, b.rect.left]);

describe("the fold's pairs (DESIGN.md § Motion)", () => {
  const wide = [piece("area", 0), piece("area", 100, true), piece("area", 200)];
  const phone = [piece("area", 0, true)];

  it("folds every panel into the phone's one group", () => {
    expect(lefts(pairs(wide, phone))).toEqual([
      [0, 0],
      [100, 0],
      [200, 0],
    ]);
  });

  it("unfolds the phone's group from where it was, into each panel", () => {
    expect(lefts(pairs(phone, wide))).toEqual([[0, 100]]);
    expect(lefts(pairs(wide, phone))).toHaveLength(3);
  });

  it("pairs by position when both sides have as many", () => {
    const a = [piece("chip-0", 0), piece("chip-1", 50)];
    const b = [piece("chip-0", 5), piece("chip-1", 55)];
    expect(lefts(pairs(a, b))).toEqual([
      [0, 5],
      [50, 55],
    ]);
  });

  it("leaves a piece with no counterpart to the crossfade", () => {
    expect(pairs([piece("live", 0)], [piece("area", 0)])).toEqual([]);
    expect(pairs([], [piece("live", 0)])).toEqual([]);
  });
});
