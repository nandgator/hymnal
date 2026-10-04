import { afterEach, describe, expect, it, vi } from "vitest";
import { hoverButton, hoverGlide } from "./hoverGlide.ts";

type Keyframes = Record<string, string>[];
const flights: Keyframes[] = [];

afterEach(() => {
  (Element.prototype as { animate?: unknown }).animate = undefined;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

// jsdom has no Web Animations: a stand-in that records each glide's keyframes.
const stubAnimate = () => {
  flights.length = 0;
  Element.prototype.animate = (frames: unknown) => {
    flights.push(frames as Keyframes);
    return undefined as unknown as Animation;
  };
};

/** Three 60x40 rows, 80px apart along one axis. */
function laidOut(axis: "x" | "y") {
  const box = document.createElement("div");
  box.innerHTML = "<button>One</button><button>Two</button><button>Three</button>";
  document.body.append(box);
  const rows = [...box.querySelectorAll("button")];
  for (const [i, row] of rows.entries()) {
    const at = i * 80;
    const x = axis === "x" ? at : 0;
    const y = axis === "y" ? at : 0;
    const dims = { offsetLeft: x, offsetTop: y, offsetWidth: 60, offsetHeight: 40 };
    for (const [key, value] of Object.entries(dims))
      Object.defineProperty(row, key, { value, configurable: true });
    row.getBoundingClientRect = () => new DOMRect(x, y, 60, 40);
  }
  return { box, rows };
}

const pointer = (type: string, target: Element, init: PointerEventInit = {}) =>
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse", ...init }));
const layerOf = (box: HTMLElement) => box.querySelector<HTMLElement>(".hover-glide");

describe("the hover layer's travel, on both axes", () => {
  it("glides vertically from item to item in a vertical list", () => {
    stubAnimate();
    const { box, rows } = laidOut("y");
    hoverGlide(box, "button");
    pointer("pointerover", rows[0] as Element, { relatedTarget: box.parentElement });
    expect(layerOf(box)?.style.transform).toBe("translate(0px, 0px)");
    flights.length = 0;
    pointer("pointerover", rows[2] as Element, { relatedTarget: rows[0] });
    expect(layerOf(box)?.style.transform).toBe("translate(0px, 160px)");
    expect(flights[0]?.map((f) => f.transform)).toEqual([
      "translate(0px, 0px)",
      "translate(0px, 160px)",
    ]);
  });

  it("glides horizontally from item to item in a horizontal list", () => {
    stubAnimate();
    const { box, rows } = laidOut("x");
    hoverGlide(box, "button");
    pointer("pointerover", rows[0] as Element, { relatedTarget: box.parentElement });
    flights.length = 0;
    pointer("pointerover", rows[1] as Element, { relatedTarget: rows[0] });
    expect(layerOf(box)?.style.transform).toBe("translate(80px, 0px)");
    expect(flights[0]?.map((f) => f.transform)).toEqual([
      "translate(0px, 0px)",
      "translate(80px, 0px)",
    ]);
  });

  it("a slow pointer crossing the gap between two items keeps the layer, a resting one lets go", () => {
    vi.useFakeTimers();
    const { box, rows } = laidOut("y");
    hoverGlide(box, "button");
    pointer("pointerover", rows[0] as Element, { relatedTarget: box.parentElement });
    // Over the gap (the list itself), moving, each pause shorter than the wait.
    pointer("pointerover", box, { relatedTarget: rows[0] });
    pointer("pointermove", box, { clientX: 30, clientY: 50 });
    for (let i = 1; i <= 4; i++) {
      vi.advanceTimersByTime(100);
      pointer("pointermove", box, { clientX: 30, clientY: 50 + i });
    }
    expect(layerOf(box)?.style.opacity).toBe("1");
    vi.advanceTimersByTime(200);
    expect(layerOf(box)?.style.opacity).toBe("0");
  });
});

describe("a lone button's layer", () => {
  it("comes back when the button's text is written over it", () => {
    document.body.innerHTML = "<button>Close</button>";
    const button = document.querySelector("button") as HTMLButtonElement;
    hoverButton(button);
    button.textContent = "Cancel";
    expect(button.querySelector(".hover-glide")).toBeNull();
    pointer("pointerover", button);
    expect(button.querySelector<HTMLElement>(":scope > .hover-glide")?.style.opacity).toBe("1");
    expect(button.textContent).toBe("Cancel");
  });
});
