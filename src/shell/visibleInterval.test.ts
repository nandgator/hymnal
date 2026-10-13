import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visibleInterval } from "./visibleInterval.ts";

describe("visibleInterval", () => {
  let state: DocumentVisibilityState;
  const setVisibility = (next: DocumentVisibilityState) => {
    state = next;
    document.dispatchEvent(new Event("visibilitychange"));
  };

  beforeEach(() => {
    state = "visible";
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => state);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ticks on its period while the page is visible", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1000);
    vi.advanceTimersByTime(3000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it("holds no timer while the page is hidden, and ticks once on coming back", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1000);
    setVisibility("hidden");
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(tick).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it("starts hidden without a timer and catches up when first shown", () => {
    state = "hidden";
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1000);
    expect(vi.getTimerCount()).toBe(0);
    setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });

  it("leaves no timer and no listener behind once stopped", () => {
    const tick = vi.fn();
    const stop = visibleInterval(tick, 1000);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    setVisibility("hidden");
    setVisibility("visible");
    expect(tick).not.toHaveBeenCalled();
  });
});
