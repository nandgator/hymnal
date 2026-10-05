// @vitest-environment node

import { describe, expect, it } from "vitest";
import { axisAt, type Box, easingOf, glidePath } from "./glideGeometry.ts";

// A pad 300 wide: keys 52 wide, the chorus bar the full width.
const keyRight: Box = { x: 200, y: 0, w: 52, h: 40 };
const keyLeft: Box = { x: 0, y: 0, w: 52, h: 40 };
const keyBelow: Box = { x: 100, y: 48, w: 52, h: 40 };
const bar: Box = { x: 0, y: 96, w: 300, h: 40 };
const wrapped: Box = { x: 52, y: 144, w: 52, h: 40 };

const parse = (f: Keyframe): Box => {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(String(f.transform));
  return {
    x: Number(m?.[1]),
    y: Number(m?.[2]),
    w: Number.parseFloat(String(f.width)),
    h: Number.parseFloat(String(f.height)),
  };
};
const boxes = (from: Box, to: Box, blur = 0) => glidePath(from, to, blur).frames.map(parse);
const right = (b: Box) => b.x + b.w;

describe("easingOf", () => {
  it("reads a cubic-bezier from a token and is front-loaded for the emphasised one", () => {
    const ease = easingOf("cubic-bezier(0.2, 0, 0, 1)");
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.2)).toBeGreaterThan(0.45);
    expect(ease(0.5)).toBeGreaterThan(0.85);
  });

  it("is the identity for anything else", () => {
    expect(easingOf("ease")(0.3)).toBe(0.3);
  });
});

describe("axisAt", () => {
  it("moves the edges that go with the travel by `lead` and those that go against by `lag`", () => {
    // A key at 200..252 into a bar 0..300: the near edge goes left (with the
    // travel), the far edge goes right (against it).
    expect(axisAt(200, 252, 0, 300, 0.5, 0)).toEqual([100, 252]);
    expect(axisAt(200, 252, 0, 300, 1, 1)).toEqual([0, 300]);
  });

  it("moves both edges by `lead` when none goes against the travel", () => {
    expect(axisAt(0, 52, 100, 152, 0.5, 0)).toEqual([50, 102]);
    expect(axisAt(0, 100, 100, 150, 0.5, 0)).toEqual([50, 125]);
  });
});

describe("glidePath", () => {
  it("keeps the plain two-end glide, on the animation's easing, for a pure move", () => {
    const { frames, linear } = glidePath(keyLeft, { ...keyLeft, x: 100 }, 2);
    expect(linear).toBe(false);
    expect(frames).toHaveLength(3);
    expect(frames[1]).toEqual({ offset: 0.5, filter: "blur(2px)" });
  });

  it("goes without blur when there is none", () => {
    expect(glidePath(keyLeft, { ...keyLeft, y: 48 }).frames).toHaveLength(2);
  });

  it("keeps the plain glide for a key into the bar from its left end", () => {
    // Its near edge already sits on the bar's: nothing goes against the travel.
    const { frames, linear } = glidePath(keyLeft, bar);
    expect(linear).toBe(false);
    expect(frames).toHaveLength(2);
  });

  it("floats a key on the right to the left into the bar, and down", () => {
    const { frames, linear } = glidePath(keyRight, bar, 2);
    expect(linear).toBe(true);
    const path = frames.map(parse);
    expect(path[0]).toEqual(keyRight);
    expect(path[path.length - 1]).toEqual(bar);
    for (const [i, box] of path.entries()) {
      const last = path[i - 1];
      if (!last) continue;
      // The near edge never goes back right, the far edge never goes back
      // left, and it only ever goes down: one object, one direction.
      expect(box.x).toBeLessThanOrEqual(last.x);
      expect(right(box)).toBeGreaterThanOrEqual(right(last));
      expect(box.y).toBeGreaterThanOrEqual(last.y);
      expect(box.w).toBeGreaterThan(0);
    }
  });

  it("holds the far edge while a key on the right sets off left, then follows", () => {
    // With the emphasised curve, a quarter of the way in the near edge has
    // nearly arrived while the far edge has hardly left.
    const ease = easingOf("cubic-bezier(0.2, 0, 0, 1)");
    const { frames } = glidePath(keyRight, bar, 0, ease);
    const quarter = parse(frames.find((f) => f.offset === 0.24) as Keyframe);
    expect(quarter.x).toBeLessThan(100);
    expect(right(quarter)).toBe(252);
    const half = parse(frames.find((f) => f.offset === 0.52) as Keyframe);
    expect(right(half)).toBeGreaterThan(252);
    expect(right(half)).toBeLessThan(300);
  });

  it("floats from the bar to a key on the right: the near edge sweeps right", () => {
    const path = boxes(bar, keyRight, 2);
    expect(path[0]).toEqual(bar);
    expect(path[path.length - 1]).toEqual(keyRight);
    for (const [i, box] of path.entries()) {
      const last = path[i - 1];
      if (!last) continue;
      expect(box.x).toBeGreaterThanOrEqual(last.x);
      expect(right(box)).toBeLessThanOrEqual(right(last));
      expect(box.y).toBeLessThanOrEqual(last.y);
      expect(box.w).toBeGreaterThan(0);
    }
  });

  it("floats from the bar to a key on its left, from where the bar's far edge sits", () => {
    // Travel is left: the bar's near (left) edge is already at the key's, so
    // only the far edge moves, in with the travel. A plain glide.
    const { linear } = glidePath(bar, keyLeft, 2);
    expect(linear).toBe(false);
  });

  it("handles a row change between keys, up and left, as a plain glide", () => {
    const { frames, linear } = glidePath(keyBelow, keyLeft, 2);
    expect(linear).toBe(false);
    expect(parse(frames[2] as Keyframe)).toEqual(keyLeft);
  });

  it("handles a wrapped pad: a key on a row below to the bar above, up and left", () => {
    // The key sits right of the bar's near edge on a lower row: it floats up
    // and left, the far edge following to the right.
    const aboveBar: Box = { x: 0, y: 0, w: 300, h: 40 };
    const path = boxes(wrapped, aboveBar);
    for (const [i, box] of path.entries()) {
      const last = path[i - 1];
      if (!last) continue;
      expect(box.x).toBeLessThanOrEqual(last.x);
      expect(box.y).toBeLessThanOrEqual(last.y);
      expect(right(box)).toBeGreaterThanOrEqual(right(last));
    }
    expect(path[path.length - 1]).toEqual(aboveBar);
  });

  it("blurs most at the middle of the move and is crisp at both ends of a sampled path", () => {
    const ease = easingOf("cubic-bezier(0.2, 0, 0, 1)");
    const { frames } = glidePath(keyRight, bar, 2, ease);
    expect(frames[0]?.filter).toBe("blur(0px)");
    expect(frames[frames.length - 1]?.filter).toBe("blur(0px)");
    const blurs = frames.map((f) => Number.parseFloat(String(f.filter).slice(5)));
    expect(Math.max(...blurs)).toBeGreaterThan(1.8);
    expect(Math.max(...blurs)).toBeLessThanOrEqual(2);
  });
});
