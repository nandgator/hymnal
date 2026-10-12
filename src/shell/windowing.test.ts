import { afterEach, describe, expect, it, vi } from "vitest";
import { indexAt, layoutOf, revealOffset, windowed, windowOf } from "./windowing.ts";

/** 100 rows of 10px: row i spans [10i, 10i+10). */
const flat = layoutOf(100, () => 10);

describe("layoutOf", () => {
  it("sums heights into offsets, with the total at the end", () => {
    const layout = layoutOf(3, (i) => [10, 20, 30][i] ?? 0);
    expect(Array.from(layout.offsets)).toEqual([0, 10, 30, 60]);
    expect(layout.count).toBe(3);
    expect(layout.total).toBe(60);
  });

  it("is empty for no rows", () => {
    const layout = layoutOf(0, () => 10);
    expect(layout.total).toBe(0);
    expect(windowOf(layout, 0, 500, 100)).toEqual({ start: 0, end: 0 });
  });
});

describe("indexAt", () => {
  it("finds the row holding a position, clamped to the list", () => {
    expect(indexAt(flat, 0)).toBe(0);
    expect(indexAt(flat, 9.9)).toBe(0);
    expect(indexAt(flat, 10)).toBe(1);
    expect(indexAt(flat, 995)).toBe(99);
    expect(indexAt(flat, 5000)).toBe(99);
    expect(indexAt(flat, -40)).toBe(0);
  });

  it("follows rows of different heights", () => {
    const layout = layoutOf(3, (i) => [10, 20, 30][i] ?? 0);
    expect(indexAt(layout, 29)).toBe(1);
    expect(indexAt(layout, 30)).toBe(2);
  });
});

describe("windowOf", () => {
  it("is the rows in view plus the overscan either side", () => {
    // View 300..400 is rows 30..39; 25px of overscan adds 3 rows (partly) each way.
    expect(windowOf(flat, 300, 100, 25)).toEqual({ start: 27, end: 43 });
  });

  it("stops at the ends of the list", () => {
    expect(windowOf(flat, 0, 100, 50)).toEqual({ start: 0, end: 15 });
    expect(windowOf(flat, 900, 100, 50)).toEqual({ start: 85, end: 100 });
  });

  it("scrolled past the end still holds the last rows; before the start, the first", () => {
    expect(windowOf(flat, 5000, 100, 0).end).toBe(100);
    expect(windowOf(flat, -200, 100, 0).start).toBe(0);
  });

  it("is small however long the list is", () => {
    const long = layoutOf(100_000, () => 56);
    const range = windowOf(long, 2_800_000, 800, 448);
    expect(range.end - range.start).toBeLessThan(40);
  });
});

describe("revealOffset", () => {
  it("is undefined for a row already in view", () => {
    expect(revealOffset(flat, 35, 300, 100, { top: 0, bottom: 0 })).toBeUndefined();
  });

  it("scrolls the least that brings a row below the view into it", () => {
    // Row 50 spans 500..510; the view 300..400 moves to end at 510.
    expect(revealOffset(flat, 50, 300, 100, { top: 0, bottom: 0 })).toBe(410);
  });

  it("scrolls the least that brings a row above the view into it", () => {
    expect(revealOffset(flat, 20, 300, 100, { top: 0, bottom: 0 })).toBe(200);
  });

  it("keeps clear of what covers the view's edges (the sticky field)", () => {
    // 40px at the top is covered: row 30 at 300 is hidden, so the view moves up to 260.
    expect(revealOffset(flat, 30, 300, 100, { top: 40, bottom: 0 })).toBe(260);
    expect(revealOffset(flat, 39, 300, 100, { top: 0, bottom: 20 })).toBe(320);
  });

  it("never goes above the start", () => {
    expect(revealOffset(flat, 0, 5, 100, { top: 40, bottom: 0 })).toBe(0);
  });
});

describe("windowed (the controller)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  /** A list in a scrolling box whose height and scroll position the test sets. */
  function setup(height = 200) {
    const scroller = document.createElement("div");
    scroller.style.overflowY = "auto";
    const list = document.createElement("div");
    scroller.append(list);
    document.body.append(scroller);
    let top = 0;
    Object.defineProperty(scroller, "clientHeight", { value: height });
    Object.defineProperty(scroller, "scrollTop", {
      get: () => top,
      set: (value: number) => {
        top = value;
      },
    });
    const ranges: { start: number; end: number }[] = [];
    const control = windowed({
      list,
      layout: () => flat,
      overscan: 20,
      insets: () => ({ top: 0, bottom: 0 }),
      onRange: (range) => ranges.push(range),
    });
    return { scroller, ranges, control, scrollTo: (y: number) => (top = y) };
  }

  it("reports the first window at once, from the scroller's height", () => {
    const { ranges, control } = setup();
    control.update();
    // 200px view of 10px rows, 20px overscan below: rows 0..22.
    expect(ranges.at(-1)).toEqual({ start: 0, end: 22 });
    control.stop();
  });

  it("follows a scroll, once per frame, and says nothing when the window has not moved", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    const { scroller, ranges, control, scrollTo } = setup();
    control.update();
    const before = ranges.length;
    scrollTo(500);
    scroller.dispatchEvent(new Event("scroll"));
    scroller.dispatchEvent(new Event("scroll"));
    expect(frames).toHaveLength(1);
    frames[0]?.(0);
    expect(ranges.at(-1)).toEqual({ start: 48, end: 72 });
    expect(ranges).toHaveLength(before + 1);
    // The same position again: no new range.
    scroller.dispatchEvent(new Event("scroll"));
    frames[1]?.(0);
    expect(ranges).toHaveLength(before + 1);
    control.stop();
  });

  it("reveals a row by moving the scroll and the window together", () => {
    const { scroller, ranges, control } = setup();
    control.update();
    control.reveal(80);
    // Row 80 spans 800..810; the view ends there, so it starts at 610.
    expect(scroller.scrollTop).toBe(610);
    expect(ranges.at(-1)?.start).toBeLessThanOrEqual(80);
    expect(ranges.at(-1)?.end).toBeGreaterThan(80);
    control.stop();
  });

  it("takes no more events after stop", () => {
    const { scroller, ranges, control, scrollTo } = setup();
    control.update();
    control.stop();
    const before = ranges.length;
    scrollTo(500);
    scroller.dispatchEvent(new Event("scroll"));
    expect(ranges).toHaveLength(before);
  });
});
