import { batch, createRoot, createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COUNTDOWN_MS,
  COUNTDOWN_STEPS,
  countdownPlan,
  createRepeatDisplay,
} from "./repeatCount.ts";

const total = (plan: { delay: number }[]) => plan.reduce((sum, step) => sum + step.delay, 0);

describe("countdownPlan", () => {
  it("shows every number from ×9 down to ×1, the first at once", () => {
    const plan = countdownPlan(9, 1);
    expect(plan.map((step) => step.value)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    expect(plan[0]?.delay).toBe(0);
  });

  it("accelerates: each pause is shorter than the one before", () => {
    const pauses = countdownPlan(9, 1)
      .slice(1)
      .map((step) => step.delay);
    for (const [i, pause] of pauses.entries())
      if (i > 0) expect(pause).toBeLessThan(pauses[i - 1] ?? 0);
  });

  it("takes the capped time however large the count was, skipping numbers", () => {
    for (const from of [4, 9, 10, 25, 100, 5000]) {
      const plan = countdownPlan(from, 1);
      expect(total(plan)).toBeLessThanOrEqual(COUNTDOWN_MS + 1e-6);
      expect(plan.length).toBeLessThanOrEqual(COUNTDOWN_STEPS);
      expect(plan.at(-1)?.value).toBe(1);
      const values = plan.map((step) => step.value);
      expect([...values].sort((a, b) => b - a)).toEqual(values);
      expect(new Set(values).size).toBe(values.length);
      expect(Math.max(...values)).toBeLessThan(from);
    }
    expect(total(countdownPlan(5000, 1))).toBeCloseTo(COUNTDOWN_MS);
    expect(countdownPlan(100, 1).length).toBe(COUNTDOWN_STEPS);
  });

  it("one step down is at once; no step for a count that does not fall", () => {
    expect(countdownPlan(2, 1)).toEqual([{ value: 1, delay: 0 }]);
    expect(countdownPlan(1, 1)).toEqual([]);
    expect(countdownPlan(1, 3)).toEqual([]);
  });
});

describe("createRepeatDisplay", () => {
  afterEach(() => {
    (Element.prototype as { animate?: unknown }).animate = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const animated = () => {
    Element.prototype.animate = () => undefined as unknown as Animation;
  };
  const make = (initial: number) => {
    const [count, setCount] = createSignal(initial);
    const [place, setPlace] = createSignal(0);
    const display = createRoot(() => createRepeatDisplay(count, place));
    return { display, setCount, setPlace };
  };

  it("changes at once where nothing can animate", () => {
    const { display, setCount } = make(5);
    setCount(1);
    expect(display.visible()).toBe(false);
  });

  it("a reset counts down through the numbers, then fades, while the count is already 1", () => {
    vi.useFakeTimers();
    animated();
    const { display, setCount } = make(9);
    setCount(1);
    // Only the display lags: the first step is at once.
    vi.advanceTimersByTime(0);
    expect(display.shown()).toBe(8);
    expect(display.rapid()).toBe(true);
    vi.advanceTimersByTime(COUNTDOWN_MS);
    expect(display.shown()).toBe(1);
    expect(display.visible()).toBe(true);
    expect(display.fading()).toBe(false);
    vi.advanceTimersByTime(250);
    expect(display.fading()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(display.visible()).toBe(false);
  });

  it("the last undo rolls to ×1 and fades; a plain undo just rolls", () => {
    vi.useFakeTimers();
    animated();
    const { display, setCount } = make(3);
    setCount(2);
    expect(display.shown()).toBe(2);
    expect(display.visible()).toBe(true);
    setCount(1);
    vi.advanceTimersByTime(0);
    expect(display.shown()).toBe(1);
    expect(display.rapid()).toBe(false);
    vi.advanceTimersByTime(300);
    expect(display.fading()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(display.visible()).toBe(false);
  });

  it("reduced motion: no countdown, the number as it was just fades", () => {
    vi.useFakeTimers();
    animated();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    const { display, setCount } = make(9);
    setCount(1);
    expect(display.shown()).toBe(9);
    expect(display.fading()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(display.visible()).toBe(false);
  });

  it("another repeat during the fade brings the count back", () => {
    vi.useFakeTimers();
    animated();
    const { display, setCount } = make(2);
    setCount(1);
    vi.advanceTimersByTime(300);
    expect(display.fading()).toBe(true);
    setCount(2);
    expect(display.fading()).toBe(false);
    expect(display.visible()).toBe(true);
    expect(display.shown()).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(display.visible()).toBe(true);
  });

  it("moving to another part follows at once, with no countdown", () => {
    vi.useFakeTimers();
    animated();
    const { display, setCount, setPlace } = make(9);
    batch(() => {
      setPlace(1);
      setCount(1);
    });
    expect(display.visible()).toBe(false);
  });
});
