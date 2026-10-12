import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backDuration,
  edgeBoxes,
  glideBack,
  glideLyrics,
  parseEase,
  planGlide,
  scrollIntoViewTop,
  scrollTargetTop,
  sweepDuration,
  watchTint,
} from "./lyricsGlide.ts";

const base = { still: false, reduced: false, tintTravel: 120, scrollTravel: 120, viewport: 600 };

describe("planGlide", () => {
  it("glides the card and the scroll together for every step, scrolling or not", () => {
    expect(planGlide(base)).toEqual({ tint: "glide", scroll: "glide" });
    expect(planGlide({ ...base, scrollTravel: 0 })).toEqual({ tint: "glide", scroll: "glide" });
    expect(planGlide({ ...base, scrollTravel: 7 })).toEqual({ tint: "glide", scroll: "glide" });
  });

  it("keeps a line step's tint where it is, with a gliding scroll", () => {
    expect(planGlide({ ...base, tintTravel: 0 })).toEqual({ tint: "glide", scroll: "glide" });
  });

  it("snaps a list shown anew, or the same step again", () => {
    expect(planGlide({ ...base, still: true })).toEqual({ tint: "snap", scroll: "snap" });
  });

  it("shows the end state under reduced motion", () => {
    expect(planGlide({ ...base, reduced: true })).toEqual({ tint: "snap", scroll: "snap" });
  });

  it("sweeps a far tint jump (a wrap): the card and the list glide", () => {
    expect(planGlide({ ...base, tintTravel: 2400 })).toEqual({ tint: "glide", scroll: "glide" });
  });

  it("lands a far scroll under a card that has not moved (nothing eases)", () => {
    expect(planGlide({ ...base, tintTravel: 0, scrollTravel: 3000 })).toEqual({
      tint: "glide",
      scroll: "snap",
    });
  });

  it("glides Back to Current from any distance, the tint left alone", () => {
    expect(planGlide({ ...base, tintTravel: 0, scrollTravel: 3000, back: true })).toEqual({
      tint: "glide",
      scroll: "glide",
    });
    // Reduced motion still lands at once.
    expect(
      planGlide({ ...base, tintTravel: 0, scrollTravel: 3000, back: true, reduced: true }),
    ).toEqual({ tint: "snap", scroll: "snap" });
  });

  it("takes longer to scroll back the further it is, to a limit", () => {
    const at = (travel: number) => backDuration(250, travel, 600);
    expect(at(100)).toBe(250);
    expect(at(1200)).toBeGreaterThan(250);
    expect(at(6000)).toBeGreaterThan(at(1200));
    expect(at(60000)).toBe(at(600000));
    expect(at(60000)).toBeLessThanOrEqual(700);
  });

  it("never snaps the scroll under a card that eases: a far scroll sweeps with it", () => {
    expect(planGlide({ ...base, tintTravel: 100, scrollTravel: 3000 })).toEqual({
      tint: "glide",
      scroll: "glide",
    });
    expect(planGlide({ ...base, tintTravel: 1200, scrollTravel: 3000 })).toEqual({
      tint: "glide",
      scroll: "glide",
    });
  });

  it("sweeps a little longer the further it goes, to a limit", () => {
    const at = (travel: number) => sweepDuration(250, travel, 600);
    expect(at(100)).toBe(250);
    expect(at(600)).toBe(250);
    expect(at(2400)).toBeGreaterThan(250);
    expect(at(6000)).toBeGreaterThan(at(2400));
    expect(at(60000)).toBe(at(600000));
    expect(at(60000)).toBe(400);
  });

  it("is still when both still and reduced", () => {
    expect(planGlide({ ...base, still: true, reduced: true })).toEqual({
      tint: "snap",
      scroll: "snap",
    });
  });

  it("sweeps a far tint that comes with no scroll to travel", () => {
    expect(planGlide({ ...base, tintTravel: 2400, scrollTravel: 0 })).toEqual({
      tint: "glide",
      scroll: "glide",
    });
  });

  it("with no viewport, a far scroll under a still card lands", () => {
    expect(planGlide({ ...base, viewport: 0, tintTravel: 0, scrollTravel: 5 })).toEqual({
      tint: "glide",
      scroll: "snap",
    });
    expect(planGlide({ ...base, viewport: 0, tintTravel: 0, scrollTravel: 0 })).toEqual({
      tint: "glide",
      scroll: "glide",
    });
  });

  it("snaps a tint that was never shown, gliding the scroll if it is near", () => {
    expect(planGlide({ ...base, tintTravel: null })).toEqual({ tint: "snap", scroll: "glide" });
    expect(planGlide({ ...base, tintTravel: null, scrollTravel: 5000 })).toEqual({
      tint: "snap",
      scroll: "snap",
    });
  });
});

describe("scrollTargetTop", () => {
  const list = { viewport: 400, scrollHeight: 2000 };

  it("centres an element", () => {
    expect(scrollTargetTop({ ...list, top: 800, height: 200, align: "center" })).toBe(700);
  });

  it("puts a tall block's top at the top", () => {
    expect(scrollTargetTop({ ...list, top: 800, height: 900, align: "start" })).toBe(800);
  });

  it("clamps content shorter than the viewport to 0", () => {
    expect(
      scrollTargetTop({
        top: 100,
        height: 100,
        viewport: 400,
        scrollHeight: 300,
        align: "center",
      }),
    ).toBe(0);
  });

  it("stays within the list's ends", () => {
    expect(scrollTargetTop({ ...list, top: 0, height: 100, align: "center" })).toBe(0);
    expect(scrollTargetTop({ ...list, top: 1900, height: 100, align: "center" })).toBe(1600);
  });
});

describe("scrollIntoViewTop", () => {
  const list = { viewport: 400, scrollHeight: 3000 };
  const at = (top: number, height: number, current: number, margin = 60) =>
    scrollIntoViewTop({ ...list, top, height, current, margin });

  it("does not scroll when the block is fully visible with the margin", () => {
    expect(at(1100, 100, 1000)).toBe(1000);
    expect(at(1060, 280, 1000)).toBe(1000); // the margin exactly, both sides
  });

  it("scrolls the least that gives the margin below a block under the fold", () => {
    expect(at(1300, 100, 1000)).toBe(1060); // bottom 1400 + 60 - 400
  });

  it("scrolls the least that gives the margin above a block over the top", () => {
    expect(at(900, 100, 1000)).toBe(840); // top 900 - 60
  });

  it("lessens the margin for a block that nearly fills the list", () => {
    expect(at(2000, 380, 0)).toBe(1990); // margin 10: bottom 2380 + 10 - 400
  });

  it("puts a block taller than the list at its top", () => {
    expect(at(2000, 900, 0)).toBe(2000);
    expect(at(2000, 900, 2300)).toBe(2000);
  });

  it("stays within the list's ends", () => {
    expect(at(20, 100, 500)).toBe(0);
    expect(at(2900, 100, 0)).toBe(2600);
  });
});

// DOM tests: a fake Element.animate whose progress the test controls.
interface FakeAnim {
  playState: string;
  progress: number | null;
  listeners: Record<string, () => void>;
  cancel: () => void;
  finish: () => void;
}

describe("parseEase", () => {
  it("reads a cubic-bezier, from 0 to 1 and rising", () => {
    const ease = parseEase("cubic-bezier(0.2, 0, 0, 1)");
    expect(ease?.(0)).toBe(0);
    expect(ease?.(1)).toBe(1);
    expect(ease?.(0.5)).toBeGreaterThan(0.8);
    expect(ease?.(0.25)).toBeLessThan(ease?.(0.5) ?? 0);
  });

  it("is null for anything else", () => {
    expect(parseEase("ease")).toBeNull();
    expect(parseEase("linear")).toBeNull();
    expect(parseEase("cubic-bezier(a, 0, 0, 1)")).toBeNull();
  });

  it("is null when an x is outside 0 to 1, as CSS rejects it", () => {
    expect(parseEase("cubic-bezier(1.5, 0, 0, 1)")).toBeNull();
    expect(parseEase("cubic-bezier(0.2, 0, -0.1, 1)")).toBeNull();
  });
});

describe("edgeBoxes", () => {
  const ease = parseEase("cubic-bezier(0.2, 0, 0, 1)") as (t: number) => number;
  const from = { x: 8, y: 0, w: 300, h: 240 };
  const to = { x: 8, y: 300, w: 300, h: 200 };

  it("starts at the old box and ends at the new one", () => {
    const boxes = edgeBoxes(from, to, ease);
    expect(boxes[0]).toEqual(from);
    expect(boxes.at(-1)).toEqual(to);
  });

  it("moving down, the bottom leads: it is never behind the top's own pace", () => {
    const boxes = edgeBoxes(from, to, ease);
    boxes.forEach((b, i) => {
      const p = i / (boxes.length - 1);
      const bottomOnPace = from.y + from.h + (to.y + to.h - from.y - from.h) * p;
      expect(b.y + b.h).toBeGreaterThanOrEqual(bottomOnPace - 1e-6);
      expect(b.y).toBeCloseTo(from.y + (to.y - from.y) * p, 6);
    });
  });

  it("moving up, the top leads", () => {
    const boxes = edgeBoxes(to, from, ease);
    boxes.forEach((b, i) => {
      const p = i / (boxes.length - 1);
      const topOnPace = to.y + (from.y - to.y) * p;
      expect(b.y).toBeLessThanOrEqual(topOnPace + 1e-6);
      expect(b.y + b.h).toBeCloseTo(to.y + to.h + (from.y + from.h - to.y - to.h) * p, 6);
    });
  });

  it("has the leading edge at its target well before the end", () => {
    const boxes = edgeBoxes(from, to, ease);
    const early = boxes[Math.floor(boxes.length * 0.9)];
    expect(Math.abs(early.y + early.h - (to.y + to.h))).toBeLessThan(2);
    expect(to.y - early.y).toBeGreaterThan(2);
  });

  it("never reverses on screen when the list scrolls under it", () => {
    // The list scrolls 300 as the card moves 300 (a centred step): the card's
    // edges, as the eye sees them, only ever move toward where they end, and
    // the leading edge does not lunge ahead of the scroll and fall back.
    for (const [a, b, s] of [
      [from, to, { from: 0, to: 300 }],
      [to, from, { from: 300, to: 0 }],
      [from, to, { from: 300, to: 0 }],
    ] as const) {
      const boxes = edgeBoxes(a, b, ease, 24, s);
      const seen = boxes.map((box, i) => {
        const at = s.from + (s.to - s.from) * (i / 24);
        return { top: box.y - at, bottom: box.y + box.h - at };
      });
      for (const edge of ["top", "bottom"] as const) {
        const deltas = seen.slice(1).map((v, i) => v[edge] - seen[i][edge]);
        const sign = Math.sign((seen.at(-1)?.[edge] ?? 0) - seen[0][edge]);
        for (const d of deltas) expect(d * sign).toBeGreaterThanOrEqual(-1e-6);
        if (sign === 0) for (const d of deltas) expect(Math.abs(d)).toBeLessThan(1e-6);
      }
    }
  });

  it("never has a negative height", () => {
    for (const b of edgeBoxes({ ...from, h: 20 }, { ...to, h: 500 }, ease)) {
      expect(b.h).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("glideLyrics", () => {
  let anims: FakeAnim[];
  let calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[];
  let frames: FrameRequestCallback[];
  let observed: (() => void) | null;
  let watching: Set<Element>;

  beforeEach(() => {
    anims = [];
    calls = [];
    frames = [];
    observed = null;
    watching = new Set();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {
      frames = [];
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          observed = cb;
        }
        observe(el: Element) {
          watching.add(el);
        }
        unobserve(el: Element) {
          watching.delete(el);
        }
        disconnect() {
          watching.clear();
        }
      },
    );
    vi.stubGlobal(
      "DOMMatrix",
      class {
        m41 = 0;
        m42 = 0;
        // The tint's translate, as the computed transform would give it.
        constructor(transform?: string) {
          const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(transform ?? "");
          if (m) {
            this.m41 = Number(m[1]);
            this.m42 = Number(m[2]);
          }
        }
      },
    );
    HTMLElement.prototype.animate = (keyframes, options) => {
      calls.push({
        keyframes: keyframes as Keyframe[],
        options: options as KeyframeAnimationOptions,
      });
      const anim: FakeAnim = {
        playState: "running",
        progress: 0,
        listeners: {},
        cancel() {
          this.playState = "idle";
        },
        finish() {
          this.playState = "finished";
          this.listeners.finish?.();
        },
      };
      Object.assign(anim, {
        effect: { getComputedTiming: () => ({ progress: anim.progress, localTime: 1 }) },
        addEventListener: (type: string, fn: () => void) => {
          anim.listeners[type] = fn;
        },
      });
      anims.push(anim);
      return anim as unknown as Animation;
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  const flush = () => {
    const run = frames;
    frames = [];
    for (const cb of run) cb(0);
  };

  const define = (el: HTMLElement, props: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(props)) {
      Object.defineProperty(el, key, { value, configurable: true, writable: true });
    }
  };

  // Blocks (200 tall) in a list 800 tall, 2000 of content, at the given
  // tops; block 0 current.
  function setup(clientHeight = 800, tops = [0, 800]) {
    const list = document.createElement("section");
    list.className = "sequence";
    const tint = document.createElement("div");
    tint.className = "seq-tint";
    const seq = document.createElement("ol");
    seq.className = "seq-list";
    const blocks = tops.map((top) => {
      const li = document.createElement("li");
      li.className = "seq-block";
      define(li, { offsetTop: top, offsetLeft: 8, offsetWidth: 300, offsetHeight: 200 });
      define(li, { offsetParent: list });
      seq.append(li);
      return li;
    });
    list.append(tint, seq);
    define(list, { clientHeight, scrollHeight: 2000 });
    document.body.append(list);
    const current = (n: number) => {
      blocks.forEach((b, i) => {
        if (i === n) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      });
    };
    current(0);
    return { list, tint, blocks, current };
  }

  it("rides the tint's progress to the least scroll that shows the new part", () => {
    const { list, current } = setup();
    glideLyrics(list, { still: true });
    current(1);
    glideLyrics(list, { still: false });
    // One animation: the card's glide is the clock, no second layer.
    expect(anims).toHaveLength(1);
    anims[0].progress = 0.5;
    flush();
    // The block's bottom (1000) plus a margin (15% of 800) at the list's foot.
    expect(list.scrollTop).toBe(160);
    anims[0].finish();
    flush();
    expect(list.scrollTop).toBe(320);
  });

  describe("a step glides the card and scrolls only if it must", () => {
    const place = (k: Keyframe) => {
      const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(String(k.transform));
      return { y: Number(m?.[2]), h: Number.parseFloat(String(k.height)) };
    };

    it("does not scroll when the next part is fully visible with a margin", () => {
      const { list, tint, current } = setup(800, [0, 300]);
      glideLyrics(list, { still: true });
      current(1);
      glideLyrics(list, { still: false });
      expect(calls).toHaveLength(1);
      expect(calls[0].keyframes).toHaveLength(25);
      expect(tint.style.transform).toBe("translate(8px, 300px)");
      anims[0].progress = 0.5;
      flush();
      expect(list.scrollTop).toBe(0);
      anims[0].finish();
      flush();
      expect(list.scrollTop).toBe(0);
    });

    it("scrolls the minimum when the next part would be under the fold", () => {
      // The part ends at 1000; the list shows 0 to 800; a 120 margin: 320.
      const { list, current } = setup();
      glideLyrics(list, { still: true });
      current(1);
      glideLyrics(list, { still: false });
      anims[0].finish();
      flush();
      expect(list.scrollTop).toBe(320);
    });

    it("scrolls the minimum up when the previous part is over the top", () => {
      const { list, current } = setup(800, [0, 200, 1000]);
      glideLyrics(list, { still: true });
      current(2);
      glideLyrics(list, { still: true });
      expect(list.scrollTop).toBe(700); // a part shown anew is centred
      current(1);
      glideLyrics(list, { still: false });
      anims[0].finish();
      flush();
      expect(list.scrollTop).toBe(80); // its top 200 less the margin
    });

    it("scrolls a part taller than the list to its top", () => {
      const { list, blocks, current } = setup(300);
      define(blocks[1], { offsetHeight: 500 });
      glideLyrics(list, { still: true });
      current(1);
      glideLyrics(list, { still: false });
      anims[0].finish();
      flush();
      expect(list.scrollTop).toBe(800);
    });

    it("moves the card as a glide of its box, never a cross-fade, with no ghost", () => {
      const { list, current } = setup();
      glideLyrics(list, { still: true });
      current(1);
      glideLyrics(list, { still: false });
      const { keyframes } = calls[0];
      expect(keyframes).toHaveLength(25);
      expect(keyframes.every((k) => "transform" in k && "height" in k)).toBe(true);
      expect(keyframes.some((k) => "opacity" in k)).toBe(false);
      expect(keyframes[0].transform).toBe("translate(8px, 0px)");
      expect(keyframes.at(-1)?.transform).toBe("translate(8px, 800px)");
      expect(list.querySelector(".seq-ghost")).toBeNull();
      expect(list.querySelectorAll(".seq-tint")).toHaveLength(1);
    });

    it("never creates a ghost, however the steps come", () => {
      const { list, current } = setup();
      const seen: number[] = [];
      glideLyrics(list, { still: true });
      for (const n of [1, 0, 1, 0]) {
        current(n);
        glideLyrics(list, { still: false });
        anims.at(-1)?.finish();
        seen.push(list.children.length);
      }
      expect(seen).toEqual([2, 2, 2, 2]);
      expect(calls.every((c) => !c.keyframes.some((k) => "opacity" in k))).toBe(true);
    });

    it("moves the card's edges on screen only toward where they end, a real distance", () => {
      const { list, current } = setup();
      glideLyrics(list, { still: true });
      current(1);
      glideLyrics(list, { still: false });
      const { keyframes } = calls[0];
      const n = keyframes.length - 1;
      const seen = keyframes.map((k, i) => {
        const { y, h } = place(k);
        const scroll = 320 * (i / n);
        return { top: y - scroll, bottom: y + h - scroll };
      });
      // From 0 to 480 on screen: the card travels, the text moving under it.
      expect(seen[0].top).toBe(0);
      expect(seen[n].top).toBeCloseTo(480, 6);
      expect(seen[n].bottom).toBeCloseTo(680, 6);
      for (const edge of ["top", "bottom"] as const) {
        const end = seen[n][edge];
        seen.slice(1).forEach((v, i) => {
          expect(v[edge] - seen[i][edge]).toBeGreaterThanOrEqual(-1e-6);
          expect(v[edge]).toBeLessThanOrEqual(end + 1e-6);
        });
      }
    });

    it("a step part-way to a scroll counts from where that scroll is going", () => {
      // 0 to 1 scrolls to 320; a second step to the block at 1000 scrolls on
      // from 320, not from the half-way 160.
      const { list, current } = setup(800, [0, 800, 1000]);
      glideLyrics(list, { still: true });
      current(1);
      glideLyrics(list, { still: false });
      anims[0].progress = 0.5;
      flush();
      current(2);
      glideLyrics(list, { still: false });
      anims.at(-1)?.finish();
      flush();
      expect(list.scrollTop).toBe(520); // bottom 1200 + 120 - 800
    });
  });

  describe("a list shown anew and Back to Current still centre", () => {
    it("centres a part shown anew, at once", () => {
      const { list, current } = setup();
      current(1);
      glideLyrics(list, { still: true });
      expect(list.scrollTop).toBe(500);
      expect(calls).toHaveLength(0);
    });

    it("glides Back to Current to the centre", () => {
      const { list, current } = setup();
      current(1);
      glideLyrics(list, { still: true });
      list.scrollTop = 0;
      glideBack(list);
      anims.at(-1)?.finish();
      flush();
      expect(list.scrollTop).toBe(500);
    });
  });

  it("animates the edges as keyframes on one animation, its easing the clock", () => {
    const { list, current } = setup();
    define(list, { scrollHeight: 801 });
    glideLyrics(list, { still: true });
    current(1);
    glideLyrics(list, { still: false });
    expect(anims).toHaveLength(1);
    const { keyframes, options } = calls[0];
    expect(keyframes).toHaveLength(25);
    expect(keyframes.map((k) => k.offset)).toEqual(Array.from({ length: 25 }, (_, i) => i / 24));
    expect(options.easing).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(options.duration).toBe(250);
    // The scroll (1px here) follows the clock.
    anims[0].progress = 0.5;
    flush();
    expect(list.scrollTop).toBe(0.5);
  });

  describe("a far step (a wrap, or a list scrolled far away) sweeps", () => {
    // A 300-tall list: the blocks are 800 apart, a far tint jump.
    it("glides the card and the list on one clock, a little longer", () => {
      const { list, current } = setup(300);
      glideLyrics(list, { still: true });
      current(1);
      glideLyrics(list, { still: false });
      expect(anims).toHaveLength(1);
      const { keyframes, options } = calls[0];
      expect(keyframes.every((k) => "transform" in k)).toBe(true);
      expect(options.duration).toBeGreaterThan(250);
      expect(options.duration).toBeLessThanOrEqual(400);
      // Scroll 0 to 745 (the part's foot, a margin of 45 above the list's)
      // rides the progress.
      expect(list.scrollTop).toBe(0);
      anims[0].progress = 0.5;
      flush();
      expect(list.scrollTop).toBe(372.5);
      anims[0].finish();
      flush();
      expect(list.scrollTop).toBe(745);
    });

    it("a card that was out of view sweeps in, the list gliding with it", () => {
      const { list, current } = setup();
      glideLyrics(list, { still: true });
      list.scrollTop = 1400; // browsed far away
      current(1);
      glideLyrics(list, { still: false });
      expect(list.scrollTop).toBe(1400);
      anims[0].progress = 0.5;
      flush();
      expect(list.scrollTop).toBe(1040);
      anims[0].finish();
      flush();
      expect(list.scrollTop).toBe(680); // its top 800 less the margin
    });
  });

  describe("the text's colour goes with the tint", () => {
    const watchTintMode = (list: HTMLElement) => {
      const seen: (string | undefined)[] = [];
      Object.defineProperty(list, "offsetHeight", {
        get: () => {
          seen.push(list.dataset.tint);
          return 0;
        },
        configurable: true,
      });
      return seen;
    };

    it("snaps with a tint that snaps (a step shown again), and lets go after", () => {
      const { list } = setup();
      glideLyrics(list, { still: true });
      const seen = watchTintMode(list);
      glideLyrics(list, { still: true });
      expect(seen).toEqual(["snap"]);
      expect(list.dataset.tint).toBeUndefined();
    });

    it("leaves a gliding tint's text to the stylesheet", () => {
      const { list, current } = setup();
      glideLyrics(list, { still: true });
      current(1);
      const seen = watchTintMode(list);
      glideLyrics(list, { still: false });
      expect(seen).toEqual([]);
    });
  });

  it("keeps gliding through Shift, Tab and Ctrl keys, but a wheel lets go", () => {
    const { list, current } = setup();
    glideLyrics(list, { still: true });
    current(1);
    glideLyrics(list, { still: false });
    anims[0].progress = 0.5;
    flush();
    for (const init of [{ key: "Shift" }, { key: "Tab" }, { key: "c", ctrlKey: true }]) {
      list.dispatchEvent(new KeyboardEvent("keydown", init));
    }
    anims[0].progress = 0.75;
    flush();
    expect(list.scrollTop).toBe(240);
    list.dispatchEvent(new Event("wheel"));
    anims[0].progress = 1;
    flush();
    expect(list.scrollTop).toBe(240);
  });

  it("lets go for a key the list would scroll with", () => {
    const { list, current } = setup();
    glideLyrics(list, { still: true });
    current(1);
    glideLyrics(list, { still: false });
    anims[0].progress = 0.5;
    flush();
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
    anims[0].progress = 1;
    flush();
    expect(list.scrollTop).toBe(160);
  });

  it("a new step mid-glide starts a fresh glide from where the scroll is", () => {
    const { list, current } = setup();
    glideLyrics(list, { still: true });
    current(1);
    glideLyrics(list, { still: false });
    anims[0].progress = 0.5;
    flush();
    current(0);
    glideLyrics(list, { still: false });
    // The old clock is let go; the new glide runs from the scroll as it is.
    expect(anims).toHaveLength(2);
    expect(anims[0].playState).toBe("idle");
    expect(list.scrollTop).toBe(160);
    anims[1].progress = 0.5;
    flush();
    expect(list.scrollTop).toBe(80);
    anims[1].finish();
    flush();
    expect(list.scrollTop).toBe(0);
  });

  it("a resize mid-glide lands the scroll on the new geometry's least scroll", () => {
    const { list, blocks, current } = setup();
    const stopWatching = watchTint(list);
    glideLyrics(list, { still: true });
    current(1);
    glideLyrics(list, { still: false });
    anims[0].progress = 0.5;
    flush();
    expect(list.scrollTop).toBe(160);
    // A larger type: the block moves down and grows.
    define(blocks[1], { offsetTop: 1000, offsetHeight: 300 });
    define(list, { scrollHeight: 2400 });
    observed?.();
    expect(list.scrollTop).toBe(620); // bottom 1300 + margin 120 - 800
    flush();
    anims[0].progress = 1;
    flush();
    expect(list.scrollTop).toBe(620);
    stopWatching();
  });

  it("a resize with no glide re-measures the tint and leaves the scroll", () => {
    const { list, tint, blocks } = setup();
    const stopWatching = watchTint(list);
    glideLyrics(list, { still: true });
    list.scrollTop = 40;
    define(blocks[0], { offsetHeight: 260 });
    observed?.();
    expect(tint.style.height).toBe("260px");
    expect(list.scrollTop).toBe(40);
    expect(anims).toHaveLength(0);
    stopWatching();
  });

  it("watches the current block, and moves the watch on each step", () => {
    const { list, blocks, current } = setup();
    const stopWatching = watchTint(list);
    expect(watching.has(blocks[0])).toBe(true);
    current(1);
    glideLyrics(list, { still: true });
    expect(watching.has(blocks[0])).toBe(false);
    expect(watching.has(blocks[1])).toBe(true);
    stopWatching();
  });

  it("re-measures when the current block alone changes size (a ×N chip), no step", () => {
    const { list, tint, blocks } = setup();
    const stopWatching = watchTint(list);
    glideLyrics(list, { still: true });
    expect(tint.style.height).toBe("200px");
    define(blocks[0], { offsetHeight: 204 }); // the list's own size is unchanged
    observed?.();
    expect(tint.style.height).toBe("204px");
    expect(anims).toHaveLength(0);
    stopWatching();
  });

  it("centres a list that was hidden at the step once it is shown, unanimated", () => {
    const { list, tint, current } = setup(0);
    const stopWatching = watchTint(list);
    current(1);
    glideLyrics(list, { still: false });
    expect(list.scrollTop).toBe(0);
    define(list, { clientHeight: 800 });
    observed?.();
    expect(list.scrollTop).toBe(500);
    expect(tint.style.transform).toBe("translate(8px, 800px)");
    expect(anims).toHaveLength(0);
    stopWatching();
  });
});
