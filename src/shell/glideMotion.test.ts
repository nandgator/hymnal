import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { glideRows } from "./hoverGlide.ts";
import { selectGlide } from "./selectGlide.ts";

// jsdom has no layout and no Web Animations: boxes are given, and `animate`
// records the keyframes it is asked for, so what the layers do is read from
// them.
type Frames = Keyframe[];
let frames: Frames[];
let reduced = false;

function box(el: HTMLElement, x: number, y: number, w: number, h: number) {
  for (const [name, value] of Object.entries({
    offsetLeft: x,
    offsetTop: y,
    offsetWidth: w,
    offsetHeight: h,
  })) {
    Object.defineProperty(el, name, { value, configurable: true });
  }
}

function list(rows = 3) {
  const ul = document.createElement("ul");
  ul.innerHTML = Array.from({ length: rows }, (_, i) => `<li><button>${i}</button></li>`).join("");
  document.body.append(ul);
  ul.getBoundingClientRect = () => new DOMRect(0, 0, 200, 150);
  const buttons = [...ul.querySelectorAll("button")];
  buttons.forEach((b, i) => {
    box(b, 0, i * 50, 200, 50);
  });
  return { ul, buttons };
}

const pointer = (type: string, init: PointerEventInit) =>
  new PointerEvent(type, { bubbles: true, pointerType: "mouse", ...init });

const translateX = (frame: Keyframe | undefined) =>
  Number(/translate\((-?[\d.]+)px/.exec(String(frame?.transform))?.[1]);
const translateY = (frame: Keyframe | undefined) =>
  Number(/translate\([^,]+, (-?[\d.]+)px/.exec(String(frame?.transform))?.[1]);

beforeEach(() => {
  frames = [];
  reduced = false;
  vi.stubGlobal(
    "DOMMatrix",
    class {
      m41 = 0;
      m42 = 0;
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced && query.includes("reduced-motion"),
  }));
  Element.prototype.animate = ((keyframes: Frames) => {
    frames.push(keyframes);
    // Finished at once: no test waits for time to pass.
    return { playState: "finished", cancel() {}, addEventListener() {} };
  }) as unknown as typeof Element.prototype.animate;
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  // biome-ignore lint/suspicious/noExplicitAny: removes the stub
  delete (Element.prototype as any).animate;
});

describe("the hover highlight's direction", () => {
  it("comes in from the side the pointer entered by, fading up out of a blur", () => {
    const { ul, buttons } = list();
    glideRows(ul, "button");
    // The pointer comes in at the left edge, over the second row.
    buttons[1]?.dispatchEvent(
      pointer("pointerover", { clientX: 4, clientY: 75, relatedTarget: document.body }),
    );
    const [from, to] = frames[0] ?? [];
    expect(translateX(from)).toBeLessThan(translateX(to));
    expect(translateY(from)).toBe(translateY(to));
    expect(from?.opacity).toBe(0);
    expect(from?.filter).toMatch(/blur\([1-9]/);
    expect(to?.opacity).toBe(1);
    expect(to?.filter).toBe("blur(0px)");
  });

  it("comes in from above when the pointer entered by the top", () => {
    const { ul, buttons } = list();
    glideRows(ul, "button");
    buttons[0]?.dispatchEvent(
      pointer("pointerover", { clientX: 100, clientY: 3, relatedTarget: document.body }),
    );
    const [from, to] = frames[0] ?? [];
    expect(translateY(from)).toBeLessThan(translateY(to));
  });

  it("drifts out toward the side the pointer left by, fading into a blur", () => {
    const { ul, buttons } = list();
    glideRows(ul, "button");
    buttons[1]?.dispatchEvent(pointer("pointerover", { clientX: 100, clientY: 75 }));
    ul.dispatchEvent(pointer("pointerleave", { clientX: 230, clientY: 75 }));
    const [from, to] = frames.at(-1) ?? [];
    expect(translateX(to)).toBeGreaterThan(translateX(from));
    expect(from?.opacity).not.toBe(0);
    expect(to?.opacity).toBe(0);
    expect(to?.filter).toMatch(/blur\([1-9]/);
  });

  it("keyboard focus fades up in place, with no side to come from", () => {
    const { ul, buttons } = list();
    glideRows(ul, "button");
    // A stale pointer: it entered by the left edge and left, long ago.
    buttons[0]?.dispatchEvent(
      pointer("pointerover", { clientX: 2, clientY: 20, relatedTarget: document.body }),
    );
    ul.dispatchEvent(pointer("pointerleave", { clientX: -5, clientY: 20 }));
    frames.length = 0;
    const row = buttons[2] as HTMLElement;
    vi.spyOn(row, "matches").mockImplementation(
      ((selector: string) => selector === ":focus-visible") as never,
    );
    row.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const [from, to] = frames[0] ?? [];
    expect(translateX(from)).toBe(translateX(to));
    expect(translateY(from)).toBe(translateY(to));
    expect(from?.opacity).toBe(0);
  });

  it("under reduced motion only fades: no glide, no blur", () => {
    reduced = true;
    const { ul, buttons } = list();
    glideRows(ul, "button");
    buttons[1]?.dispatchEvent(
      pointer("pointerover", { clientX: 4, clientY: 75, relatedTarget: document.body }),
    );
    ul.dispatchEvent(pointer("pointerleave", { clientX: 230, clientY: 75 }));
    expect(frames.length).toBeGreaterThan(0);
    for (const keyframes of frames) {
      for (const frame of keyframes) {
        expect(Object.keys(frame)).toEqual(["opacity"]);
      }
    }
  });
});

describe("the hover highlight's rows", () => {
  it("follows a row it is shown, and lets go of it", () => {
    const { ul, buttons } = list();
    const glide = glideRows(ul, "button");
    const layer = ul.querySelector<HTMLElement>(".hover-glide");
    glide.show(buttons[1] as HTMLElement);
    expect(layer?.style.opacity).toBe("1");
    expect(layer?.style.transform).toBe("translate(0px, 50px)");
    glide.show(null);
    expect(layer?.style.opacity).toBe("0");
  });

  it("does not restart for the row it is already on", () => {
    const { ul, buttons } = list();
    const glide = glideRows(ul, "button");
    glide.show(buttons[1] as HTMLElement);
    const count = frames.length;
    glide.show(buttons[1] as HTMLElement);
    expect(frames.length).toBe(count);
  });

  it("marks its list while it is there, so the rows paint no hover of their own", () => {
    const { ul } = list();
    const glide = glideRows(ul, "button");
    expect(ul.dataset.hoverGlide).toBe("");
    glide.stop();
    expect(ul.dataset.hoverGlide).toBeUndefined();
  });

  it("waits a moment over a gap before it lets go", () => {
    vi.useFakeTimers();
    try {
      const { ul, buttons } = list();
      glideRows(ul, "button");
      const layer = ul.querySelector<HTMLElement>(".hover-glide");
      buttons[1]?.dispatchEvent(pointer("pointerover", { clientX: 100, clientY: 75 }));
      ul.dispatchEvent(pointer("pointerover", { clientX: 100, clientY: 101 }));
      expect(layer?.style.opacity).toBe("1");
      // The next row arrives first: the layer never lets go.
      buttons[2]?.dispatchEvent(pointer("pointerover", { clientX: 100, clientY: 110 }));
      vi.advanceTimersByTime(200);
      expect(layer?.style.opacity).toBe("1");
      ul.dispatchEvent(pointer("pointerover", { clientX: 100, clientY: 149 }));
      vi.advanceTimersByTime(200);
      expect(layer?.style.opacity).toBe("0");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("selectGlide", () => {
  function choices() {
    const group = document.createElement("div");
    group.innerHTML = `<button aria-current="true">A</button><button>B</button><button>C</button>`;
    document.body.append(group);
    const buttons = [...group.querySelectorAll("button")];
    buttons.forEach((b, i) => {
      box(b, i * 60, 0, 60, 40);
    });
    return { group, buttons };
  }
  const pillOf = (group: HTMLElement) => group.querySelector<HTMLElement>(".select-pill");

  it("puts one pill on the selected item, where it is, with no glide", () => {
    const { group } = choices();
    selectGlide(group);
    expect(group.querySelectorAll(".select-pill")).toHaveLength(1);
    expect(pillOf(group)?.style.transform).toBe("translate(0px, 0px)");
    expect(pillOf(group)?.style.width).toBe("60px");
    expect(group.dataset.selectGlide).toBe("");
    expect(frames).toHaveLength(0);
  });

  it("glides, blurring at the middle, when the selection moves to another item", async () => {
    const { group, buttons } = choices();
    selectGlide(group);
    buttons[0]?.removeAttribute("aria-current");
    buttons[2]?.setAttribute("aria-current", "true");
    await Promise.resolve();
    expect(pillOf(group)?.style.transform).toBe("translate(120px, 0px)");
    const [from, middle, to] = frames[0] ?? [];
    expect(translateX(from)).toBe(0);
    expect(translateX(to)).toBe(120);
    expect(middle?.filter).toBe("blur(2px)");
  });

  it("lands at once when the item only moves (a reflow)", async () => {
    const { group, buttons } = choices();
    const glide = selectGlide(group);
    box(buttons[0] as HTMLElement, 10, 0, 60, 40);
    glide.sync();
    expect(pillOf(group)?.style.transform).toBe("translate(10px, 0px)");
    expect(frames).toHaveLength(0);
  });

  it("only fades under reduced motion", async () => {
    reduced = true;
    const { group, buttons } = choices();
    selectGlide(group);
    buttons[0]?.removeAttribute("aria-current");
    buttons[1]?.setAttribute("aria-current", "true");
    await Promise.resolve();
    expect(frames[0]?.map((f) => Object.keys(f))).toEqual([["opacity"], ["opacity"]]);
  });

  it("takes the box of a part of the item, and a selection the DOM does not announce", () => {
    const { group, buttons } = choices();
    for (const b of buttons) {
      const inner = document.createElement("i");
      b.append(inner);
      box(inner, Number(b.offsetLeft) + 5, 5, 50, 30);
    }
    const input = document.createElement("input");
    input.type = "radio";
    buttons[1]?.append(input);
    const glide = selectGlide(group, {
      current: "input:checked",
      target: (el) => el.parentElement?.querySelector("i") ?? null,
    });
    expect(pillOf(group)?.style.display).toBe("none");
    input.checked = true;
    glide.sync();
    expect(pillOf(group)?.style.transform).toBe("translate(65px, 5px)");
    glide.stop();
    expect(pillOf(group)).toBeNull();
    expect(group.dataset.selectGlide).toBeUndefined();
  });
});
