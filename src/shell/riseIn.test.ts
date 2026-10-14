import { afterEach, describe, expect, it, vi } from "vitest";
import { riseIn } from "./riseIn.ts";

afterEach(() => vi.unstubAllGlobals());

const fakeEl = () => {
  const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn() }));
  return { el: { animate } as unknown as HTMLElement, animate };
};

describe("riseIn", () => {
  it("glides up and fades in, on transform and opacity only", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { el, animate } = fakeEl();
    riseIn(el);
    const frames = (animate.mock.calls[0] as unknown as [Record<string, unknown>[]])[0];
    expect(frames).toHaveLength(2);
    for (const frame of frames) expect(Object.keys(frame).sort()).toEqual(["opacity", "transform"]);
    expect(frames[0]?.transform).toMatch(/translateY/);
  });

  it("only fades under reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { el, animate } = fakeEl();
    riseIn(el);
    const frames = (animate.mock.calls[0] as unknown as [Record<string, unknown>[]])[0];
    expect(frames[0]?.transform).toBe("none");
  });

  it("restarts a running one rather than stacking", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel }));
    const el = { animate } as unknown as HTMLElement;
    riseIn(el);
    riseIn(el);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does nothing without an element or Web Animations", () => {
    expect(() => riseIn(undefined)).not.toThrow();
    expect(() => riseIn({} as HTMLElement)).not.toThrow();
  });
});
