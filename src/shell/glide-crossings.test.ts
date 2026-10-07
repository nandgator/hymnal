// @vitest-environment node

import { describe, expect, it } from "vitest";
import { GLIDE_MS, type GlideItem, planCrossings, timeAtProgress } from "./glide-crossings.ts";

const H = 40;
const STEP = 60;
/** Rows stacked from the top, each `STEP` apart; `order` lists the keys top
 * to bottom after the move, `was` the same before. */
function items(was: string[], order: string[], height = H): GlideItem[] {
  return order.map((key, i) => ({
    key,
    top: i * STEP,
    height,
    dy: was.indexOf(key) * STEP - i * STEP,
  }));
}

function inOrder(fade: { offset: number; opacity: number }[]) {
  for (const [i, { offset }] of fade.entries()) {
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(1);
    if (i > 0) expect(offset).toBeGreaterThanOrEqual(fade[i - 1]?.offset ?? 0);
  }
}

describe("timeAtProgress", () => {
  it("inverts the emphasised easing: front-loaded, and fixed at the ends", () => {
    expect(timeAtProgress(0)).toBe(0);
    expect(timeAtProgress(1)).toBe(1);
    expect(timeAtProgress(0.5)).toBeLessThan(0.2);
    expect(timeAtProgress(0.9)).toBeLessThan(timeAtProgress(0.99));
  });
});

describe("planCrossings", () => {
  it("a new song on top: the rows only slide, and it comes in once they have cleared", () => {
    const plans = planCrossings([
      { key: "new", top: 0, height: H, dy: 0, fresh: true },
      ...["a", "b", "c"].map((key, i) => ({ key, top: (i + 1) * STEP, height: H, dy: -STEP })),
    ]);
    for (const key of ["a", "b", "c"]) expect(plans.get(key)).toEqual({ lift: false });
    const fade = plans.get("new")?.fade ?? [];
    inOrder(fade);
    expect(fade[0]).toEqual({ offset: 0, opacity: 0 });
    expect(fade.at(-1)).toEqual({ offset: expect.any(Number), opacity: 1 });
    // Still out of sight while `a` leaves the spot, so after the start.
    const gone = fade.filter((point) => point.opacity === 0);
    expect(gone.at(-1)?.offset).toBeGreaterThan(0);
  });

  it("a new song with nothing sliding under it comes in at once", () => {
    const plans = planCrossings([{ key: "new", top: 0, height: H, dy: 0, fresh: true }]);
    const fade = plans.get("new")?.fade ?? [];
    inOrder(fade);
    expect(fade.at(-1)?.opacity).toBe(1);
  });

  it("a one-place rise: the riser is lifted, the row it passes fades out before it", () => {
    const plans = planCrossings(items(["a", "b"], ["b", "a"]));
    expect(plans.get("b")?.lift).toBe(true);
    expect(plans.get("a")?.lift).toBe(false);
    const fade = plans.get("a")?.fade ?? [];
    inOrder(fade);
    expect(fade[0]).toEqual({ offset: 0, opacity: 1 });
    expect(fade.some((point) => point.opacity === 0)).toBe(true);
    // Out of sight a whole fade before the glide ends, and back in by the end.
    expect(fade.at(-1)?.opacity).toBe(1);
    expect(plans.get("b")?.fade).toBeUndefined();
  });

  it("a riser with its own fill (the song that's up) passes over the rows: they stay in view", () => {
    // The tonal fill hides what is under it, so no glyph is half covered and
    // the rows need not vanish; they glide down in view, as they used to.
    const list = items(["a", "b", "c", "d"], ["d", "a", "b", "c"]);
    const plans = planCrossings(list.map((item) => ({ ...item, opaque: item.key === "d" })));
    expect(plans.get("d")?.lift).toBe(true);
    for (const key of ["a", "b", "c"]) expect(plans.get(key)?.fade).toBeUndefined();
  });

  it("a 20-row rise: every offset within [0, 1], in order, every row crossed", () => {
    const was = Array.from({ length: 20 }, (_, i) => `r${i}`);
    const order = [was[19] ?? "", ...was.slice(0, 19)];
    const plans = planCrossings(items(was, order));
    expect(plans.get("r19")?.lift).toBe(true);
    for (const key of was.slice(0, 19)) {
      const fade = plans.get(key)?.fade ?? [];
      expect(fade.length).toBeGreaterThan(0);
      inOrder(fade);
      expect(fade.at(-1)?.opacity).toBe(1);
    }
  });

  it("a fade lasts 60ms of wall time where there is room, early or late", () => {
    const was = Array.from({ length: 20 }, (_, i) => `r${i}`);
    const order = [was[19] ?? "", ...was.slice(0, 19)];
    const plans = planCrossings(items(was, order));
    // The row at the far end is crossed last.
    const fade = plans.get("r0")?.fade ?? [];
    const out = fade.findIndex((point) => point.opacity === 0);
    const fadeOutMs = ((fade[out]?.offset ?? 0) - (fade[out - 1]?.offset ?? 0)) * GLIDE_MS;
    expect(fadeOutMs).toBeGreaterThanOrEqual(40);
    expect(fadeOutMs).toBeLessThanOrEqual(80);
  });

  it("a regroup with several movers: each row a mover passes fades", () => {
    // d rises to the top, b rises one place over a, c stays: d crosses a, b
    // and c; b crosses a.
    const plans = planCrossings(items(["a", "b", "c", "d"], ["d", "b", "a", "c"]));
    expect(plans.get("d")?.lift).toBe(true);
    expect(plans.get("b")?.lift).toBe(true);
    expect(plans.get("a")?.fade).toBeDefined();
    expect(plans.get("b")?.fade).toBeDefined();
    expect(plans.get("c")?.fade).toBeDefined();
    for (const plan of plans.values()) inOrder(plan.fade ?? []);
  });

  it("a heading is covered as a row is", () => {
    // A row from below the heading lands above it.
    const plans = planCrossings([
      { key: "group-today", top: 100, height: 30, dy: -60 },
      { key: "hymn-1", top: 0, height: H, dy: 90 },
    ]);
    expect(plans.get("hymn-1")?.lift).toBe(true);
    expect(plans.get("group-today")?.fade?.some((point) => point.opacity === 0)).toBe(true);
  });
});
