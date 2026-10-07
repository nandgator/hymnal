import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backDuration,
  edgeBoxes,
  glideLyrics,
  parseEase,
  planGlide,
  scrollTargetTop,
  watchTint,
} from "./lyricsGlide.ts";

const base = { still: false, reduced: false, tintTravel: 120, scrollTravel: 120, viewport: 600 };

describe("planGlide", () => {
  it("glides a step to a near part, tint and scroll together", () => {
    expect(planGlide(base)).toEqual({ tint: "glide", scroll: "glide" });
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

  it("fades a far tint jump (a wrap): the card leaves, the list lands, the card arrives", () => {
    expect(planGlide({ ...base, tintTravel: 2400 })).toEqual({ tint: "fade", scroll: "land" });
  });

  it("treats exactly a screen as near, more than a screen as far", () => {
    expect(planGlide({ ...base, tintTravel: 600 }).tint).toBe("glide");
    expect(planGlide({ ...base, tintTravel: 601 }).tint).toBe("fade");
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

  it("never snaps the scroll under a card that eases: a far scroll fades like a far tint", () => {
    expect(planGlide({ ...base, tintTravel: 100, scrollTravel: 3000 })).toEqual({
      tint: "fade",
      scroll: "land",
    });
  });

  it("is still when both still and reduced", () => {
    expect(planGlide({ ...base, still: true, reduced: true })).toEqual({
      tint: "snap",
      scroll: "snap",
    });
  });

  it("fades a far tint that comes with no scroll to travel", () => {
    expect(planGlide({ ...base, tintTravel: 2400, scrollTravel: 0 })).toEqual({
      tint: "fade",
      scroll: "land",
    });
  });

  it("treats a scroll of exactly a screen as near", () => {
    expect(planGlide({ ...base, scrollTravel: 600 }).scroll).toBe("glide");
    expect(planGlide({ ...base, scrollTravel: 601 }).tint).toBe("fade");
  });

  it("with no viewport, any travel is far", () => {
    expect(planGlide({ ...base, viewport: 0 })).toEqual({ tint: "fade", scroll: "land" });
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

  // Two blocks in a list 800 tall, 2000 of content; block 0 current.
  function setup(clientHeight = 800) {
    const list = document.createElement("section");
    list.className = "sequence";
    const tint = document.createElement("div");
    tint.className = "seq-tint";
    const seq = document.createElement("ol");
    seq.className = "seq-list";
    const blocks = [0, 800].map((top) => {
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

  it("rides the tint's progress to the new centre", () => {
    const { list, current } = setup();
    glideLyrics(list, { still: true });
    current(1);
    glideLyrics(list, { still: false });
    expect(anims).toHaveLength(1);
    anims[0].progress = 0.5;
    flush();
    expect(list.scrollTop).toBe(250);
    anims[0].finish();
    flush();
    expect(list.scrollTop).toBe(500);
  });

  it("animates the edges as keyframes on one animation, its easing the clock", () => {
    const { list, current } = setup();
    glideLyrics(list, { still: true });
    current(1);
    glideLyrics(list, { still: false });
    expect(anims).toHaveLength(1);
    const { keyframes, options } = calls[0];
    expect(keyframes).toHaveLength(25);
    expect(keyframes.map((k) => k.offset)).toEqual(Array.from({ length: 25 }, (_, i) => i / 24));
    expect(options.easing).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(options.duration).toBe(250);
    // The scroll follows the clock's progress, whatever the edges do.
    anims[0].progress = 0.25;
    flush();
    expect(list.scrollTop).toBe(125);
    anims[0].progress = 0.75;
    flush();
    expect(list.scrollTop).toBe(375);
  });

  describe("a far step (a wrap, or a list scrolled far away)", () => {
    // A 300-tall list: the blocks are 800 apart, a far tint jump.
    it("holds the list while the old card leaves, lands it unseen, then the card arrives", () => {
      const { list, current } = setup(300);
      glideLyrics(list, { still: true });
      current(1);
      glideLyrics(list, { still: false });
      expect(anims).toHaveLength(1);
      // Not snapped: the card is fading out where it was, the list under it.
      expect(list.scrollTop).toBe(0);
      const { keyframes } = calls[0];
      expect(keyframes[0]).toMatchObject({ opacity: 1, offset: 0 });
      expect(keyframes[1]).toMatchObject({ opacity: 0, offset: 0.4 });
      anims[0].progress = 0.3;
      flush();
      expect(list.scrollTop).toBe(0);
      // Between the card's exit and its entrance (offsets 0.4 to 0.6).
      anims[0].progress = 0.5;
      flush();
      expect(list.scrollTop).toBe(750);
      anims[0].finish();
      flush();
      expect(list.scrollTop).toBe(750);
    });

    it("a card that was out of view just fades in, the list landing at once", () => {
      const { list, current } = setup();
      glideLyrics(list, { still: true });
      list.scrollTop = 1400; // browsed far away
      current(1);
      glideLyrics(list, { still: false });
      expect(list.scrollTop).toBe(500);
      expect(calls[0].keyframes).toHaveLength(2);
      expect(calls[0].keyframes[0]).toMatchObject({ opacity: 0 });
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
    expect(list.scrollTop).toBe(375);
    list.dispatchEvent(new Event("wheel"));
    anims[0].progress = 1;
    flush();
    expect(list.scrollTop).toBe(375);
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
    expect(list.scrollTop).toBe(250);
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
    expect(anims).toHaveLength(2);
    expect(anims[0].playState).toBe("idle");
    anims[1].finish();
    flush();
    expect(list.scrollTop).toBe(0);
  });

  it("a resize mid-glide lands the scroll centred on the new geometry", () => {
    const { list, blocks, current } = setup();
    const stopWatching = watchTint(list);
    glideLyrics(list, { still: true });
    current(1);
    glideLyrics(list, { still: false });
    anims[0].progress = 0.5;
    flush();
    expect(list.scrollTop).toBe(250);
    // A larger type: the block moves down and grows.
    define(blocks[1], { offsetTop: 1000, offsetHeight: 300 });
    define(list, { scrollHeight: 2400 });
    observed?.();
    expect(list.scrollTop).toBe(750);
    flush();
    anims[0].progress = 1;
    flush();
    expect(list.scrollTop).toBe(750);
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
