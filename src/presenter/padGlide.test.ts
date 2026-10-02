import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placePad, planPad, watchPad } from "./padGlide.ts";

const box = { x: 0, y: 0, w: 52, h: 40 };

describe("planPad", () => {
  it("glides a step from a pill that is showing", () => {
    expect(planPad({ still: false, reduced: false, from: box })).toBe("glide");
  });

  it("lands a pad shown anew, with no pill to glide from", () => {
    expect(planPad({ still: false, reduced: false, from: null })).toBe("snap");
  });

  it("lands at once on another song, and under reduced motion", () => {
    expect(planPad({ still: true, reduced: false, from: box })).toBe("snap");
    expect(planPad({ still: false, reduced: true, from: box })).toBe("snap");
  });
});

describe("placePad and watchPad", () => {
  let pad: HTMLElement;
  let pill: HTMLElement;
  let keys: HTMLButtonElement[];
  let animate: ReturnType<typeof vi.fn>;
  let observers: StubObserver[];

  class StubObserver {
    observed = new Set<Element>();
    disconnected = false;
    callback: () => void;
    constructor(callback: () => void) {
      this.callback = callback;
      observers.push(this);
    }
    observe(el: Element) {
      this.observed.add(el);
    }
    unobserve(el: Element) {
      this.observed.delete(el);
    }
    disconnect() {
      this.disconnected = true;
    }
  }

  // jsdom has no layout: each key's box is set by hand.
  const place = (key: HTMLElement, x: number, y: number, w: number, h: number) => {
    for (const [name, value] of Object.entries({
      offsetLeft: x,
      offsetTop: y,
      offsetWidth: w,
      offsetHeight: h,
    })) {
      Object.defineProperty(key, name, { configurable: true, value });
    }
  };
  const select = (index: number) => {
    for (const [i, key] of keys.entries()) key.setAttribute("aria-pressed", String(i === index));
  };

  beforeEach(() => {
    observers = [];
    animate = vi.fn(() => ({ addEventListener: vi.fn(), cancel: vi.fn() }));
    vi.stubGlobal("ResizeObserver", StubObserver);
    vi.stubGlobal(
      "DOMMatrix",
      class {
        m41 = 0;
        m42 = 0;
        constructor(transform?: string) {
          const at = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(transform ?? "");
          if (at) {
            this.m41 = Number(at[1]);
            this.m42 = Number(at[2]);
          }
        }
      },
    );
    document.body.innerHTML = `<section><span class="chip-pill"></span><ul>
      <li><button class="chip-filter"></button></li>
      <li><button class="chip-filter"></button></li>
      <li><button class="chip-filter"></button></li></ul></section>`;
    pad = document.querySelector("section") as HTMLElement;
    pill = pad.querySelector(".chip-pill") as HTMLElement;
    pill.animate = animate as unknown as typeof pill.animate;
    keys = [...pad.querySelectorAll<HTMLButtonElement>(".chip-filter")];
    place(keys[0], 0, 0, 100, 40);
    place(keys[1], 100, 0, 50, 40);
    place(keys[2], 0, 48, 50, 40);
    select(0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lands the pill on the current key at once when there is none yet", () => {
    placePad(pad, { still: false });
    expect(animate).not.toHaveBeenCalled();
    expect(pill.style.transform).toBe("translate(0px, 0px)");
    expect(pill.style.width).toBe("100px");
    expect(pill.style.height).toBe("40px");
  });

  it("animates a step from the old box to the new one", () => {
    placePad(pad, { still: false });
    select(1);
    placePad(pad, { still: false });
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames, timing] = animate.mock.calls[0];
    expect(frames).toEqual([
      { transform: "translate(0px, 0px)", width: "100px", height: "40px", filter: "blur(0px)" },
      { offset: 0.5, filter: "blur(2px)" },
      { transform: "translate(100px, 0px)", width: "50px", height: "40px", filter: "blur(0px)" },
    ]);
    expect(timing).toMatchObject({ duration: 250 });
    expect(pill.style.transform).toBe("translate(100px, 0px)");
  });

  it("blurs the pill alone, 0 at both ends and most at the middle", () => {
    placePad(pad, { still: false });
    select(1);
    placePad(pad, { still: false });
    const frames = animate.mock.calls[0][0];
    expect(frames.map((f: Keyframe) => f.filter)).toEqual(["blur(0px)", "blur(2px)", "blur(0px)"]);
    expect(frames[1].offset).toBe(0.5);
    expect(pill.style.filter).toBe("");
    expect(keys[1].style.filter).toBe("");
  });

  it("does not blur under forced colours", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("forced-colors") }));
    placePad(pad, { still: false });
    select(1);
    placePad(pad, { still: false });
    const frames = animate.mock.calls[0][0];
    expect(frames).toHaveLength(2);
    for (const f of frames) expect(f.filter).toBeUndefined();
  });

  it("does not blur, or animate, under reduced motion", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduced-motion") }));
    placePad(pad, { still: false });
    select(1);
    placePad(pad, { still: false });
    expect(animate).not.toHaveBeenCalled();
    expect(pill.style.filter).toBe("");
  });

  it("does not blur, or animate, when the pill appears in place or the song changes", () => {
    placePad(pad, { still: false });
    expect(animate).not.toHaveBeenCalled();
    expect(pill.style.filter).toBe("");
    select(2);
    placePad(pad, { still: true });
    expect(animate).not.toHaveBeenCalled();
    expect(pill.style.filter).toBe("");
  });

  it("snaps a step in another song (still)", () => {
    placePad(pad, { still: false });
    select(2);
    placePad(pad, { still: true });
    expect(animate).not.toHaveBeenCalled();
    expect(pill.style.transform).toBe("translate(0px, 48px)");
  });

  it("does nothing for an update that is not a step", () => {
    placePad(pad, { still: false });
    select(1);
    placePad(pad, { still: false });
    placePad(pad, { still: false });
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("retargets mid-glide from where the pill is drawn", () => {
    placePad(pad, { still: false });
    select(1);
    placePad(pad, { still: false });
    select(2);
    placePad(pad, { still: false });
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls[1][0][0]).toMatchObject({
      transform: "translate(100px, 0px)",
      width: "50px",
      height: "40px",
    });
    expect(animate.mock.calls[1][0][2].transform).toBe("translate(0px, 48px)");
  });

  it("hides the pill with no current key", () => {
    placePad(pad, { still: false });
    for (const key of keys) key.setAttribute("aria-pressed", "false");
    placePad(pad, { still: false });
    expect(pill.style.display).toBe("none");
  });

  it("skips a key with no layout, and watchPad places it, unanimated, on show", () => {
    const stop = watchPad(pad);
    place(keys[0], 0, 0, 0, 0);
    placePad(pad, { still: false });
    expect(pill.style.display).toBe("none");
    place(keys[0], 0, 0, 100, 40);
    observers[0].callback();
    expect(pill.style.display).toBe("");
    expect(pill.style.width).toBe("100px");
    expect(animate).not.toHaveBeenCalled();
    stop();
  });

  it("keeps the pill on its key as the pad reflows, with no animation", () => {
    const stop = watchPad(pad);
    placePad(pad, { still: false });
    place(keys[0], 0, 0, 80, 40);
    observers[0].callback();
    expect(pill.style.width).toBe("80px");
    expect(animate).not.toHaveBeenCalled();
    stop();
  });

  it("observes the pad, its keys and the current key, and lets go on cleanup", () => {
    const stop = watchPad(pad);
    const [observer] = observers;
    expect(observer.observed.has(pad)).toBe(true);
    expect(observer.observed.has(pad.querySelector("ul") as Element)).toBe(true);
    expect(observer.observed.has(keys[0])).toBe(true);
    select(1);
    placePad(pad, { still: false });
    expect(observer.observed.has(keys[0])).toBe(false);
    expect(observer.observed.has(keys[1])).toBe(true);
    stop();
    expect(observer.disconnected).toBe(true);
  });
});
