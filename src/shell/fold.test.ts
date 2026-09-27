import { describe, expect, it } from "vitest";
import { type Piece, pairs } from "./fold.ts";

const piece = (key: string, left: number): Piece => ({
  key,
  rect: { left, top: 0, width: 10, height: 10 } as DOMRect,
  background: "rgb(0, 0, 0)",
  radius: "0px",
});

describe("the fold's pairs (DESIGN.md § Motion)", () => {
  it("folds several panels into one, and one back out into several", () => {
    const wide = [piece("area", 0), piece("area", 100), piece("area", 200)];
    const phone = [piece("area", 0)];
    expect(pairs(wide, phone).map(([from, to]) => [from.rect.left, to.rect.left])).toEqual([
      [0, 0],
      [100, 0],
      [200, 0],
    ]);
    expect(pairs(phone, wide).map(([from, to]) => [from.rect.left, to.rect.left])).toEqual([
      [0, 0],
      [0, 100],
      [0, 200],
    ]);
  });

  it("leaves a piece with no counterpart to the fades", () => {
    expect(pairs([piece("live", 0)], [piece("area", 0)])).toEqual([]);
    expect(pairs([], [piece("live", 0)])).toEqual([]);
  });
});
