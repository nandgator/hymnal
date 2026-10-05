import { afterEach, describe, expect, it } from "vitest";
import { drift, hoverButton, hoverGlide, hoverGroup, roomOf } from "./hoverGlide.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

function list() {
  const ul = document.createElement("ul");
  ul.innerHTML = `<li><button>One</button></li><li><button>Two</button></li>`;
  document.body.append(ul);
  return ul;
}
const over = (el: Element) =>
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));

describe("hoverGlide", () => {
  it("adds one layer, shown on the row pointed at, and removes it on cleanup", () => {
    const ul = list();
    const stop = hoverGlide(ul, "button");
    const layers = () => ul.querySelectorAll<HTMLElement>(".hover-glide");
    expect(layers()).toHaveLength(1);
    expect(layers()[0]?.style.opacity).toBe("");

    over(ul.querySelectorAll("button")[1] as HTMLElement);
    expect(layers()[0]?.style.opacity).toBe("1");

    ul.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    expect(layers()[0]?.style.opacity).toBe("0");

    stop();
    expect(layers()).toHaveLength(0);
  });

  it("ignores touch: there is no hover to follow", () => {
    const ul = list();
    hoverGlide(ul, "button");
    (ul.querySelector("button") as HTMLElement).dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true, pointerType: "touch" }),
    );
    expect(ul.querySelector<HTMLElement>(".hover-glide")?.style.opacity).toBe("");
  });
});

describe("hoverButton and hoverGroup", () => {
  it("a lone button wears its own layer, and takes it off with its class", () => {
    document.body.innerHTML = "<button>Back</button>";
    const button = document.querySelector("button") as HTMLButtonElement;
    const stop = hoverButton(button);
    expect(button.classList.contains("glide-self")).toBe(true);
    const layer = () => button.querySelector<HTMLElement>(":scope > .hover-glide");
    expect(layer()).not.toBeNull();

    over(button);
    expect(layer()?.style.opacity).toBe("1");
    button.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }));
    expect(layer()?.style.opacity).toBe("0");

    stop();
    expect(layer()).toBeNull();
    expect(button.classList.contains("glide-self")).toBe(false);
  });

  it("a disabled lone button shows nothing", () => {
    document.body.innerHTML = "<button disabled>Undo</button>";
    const button = document.querySelector("button") as HTMLButtonElement;
    hoverButton(button);
    over(button);
    expect(button.querySelector<HTMLElement>(".hover-glide")?.style.opacity).toBe("");
  });

  it("a group shares one layer over its buttons", () => {
    const ul = list();
    const stop = hoverGroup(ul, "button");
    expect(ul.classList.contains("glide-group")).toBe(true);
    expect(ul.querySelectorAll(".hover-glide")).toHaveLength(1);
    over(ul.querySelectorAll("button")[1] as HTMLElement);
    expect(ul.querySelector<HTMLElement>(".hover-glide")?.style.opacity).toBe("1");
    stop();
    expect(ul.querySelectorAll(".hover-glide")).toHaveLength(0);
    expect(ul.classList.contains("glide-group")).toBe(false);
  });
});

describe("drift", () => {
  const box = { x: 8, y: 100, w: 400, h: 60 };

  it("goes half a row, at most 96px, beside where nothing limits it", () => {
    expect(drift(box, "right").x).toBe(104);
    expect(drift(box, "left").x).toBe(-88);
    expect(drift({ ...box, w: 100 }, "right").x).toBe(58);
    expect(drift(box, "bottom").y).toBe(160);
    expect(drift(box, "top").y).toBe(40);
  });

  it("never reaches past the room: a drift must not widen the scrollable overflow", () => {
    const room = { right: 416, bottom: 160, left: 0 };
    expect(drift(box, "right", room).x).toBe(16);
    expect(drift(box, "bottom", room).y).toBe(100);
    // A row already against the edge stays put rather than moving back.
    expect(drift(box, "right", { ...room, right: 300 }).x).toBe(8);
    expect(drift(box, "left", { ...room, left: 4 }).x).toBe(4);
  });
});

describe("roomOf", () => {
  const measured = (el: HTMLElement, sizes: Record<string, number>) => {
    for (const [key, value] of Object.entries(sizes))
      Object.defineProperty(el, key, { configurable: true, value });
  };

  it("is open where nothing is laid out", () => {
    const room = roomOf(list());
    expect(room.right).toBe(Number.POSITIVE_INFINITY);
    expect(room.bottom).toBe(Number.POSITIVE_INFINITY);
  });

  it("stops at the edge of the scroller the list sits in", () => {
    const ul = list();
    const scroller = document.createElement("div");
    ul.style.overflowX = "visible";
    ul.style.overflowY = "visible";
    scroller.style.overflowX = "auto";
    scroller.style.overflowY = "auto";
    document.body.append(scroller);
    scroller.append(ul);
    const rect = { left: 10, top: 20, width: 400, height: 300 } as DOMRect;
    measured(ul, { offsetWidth: 400, offsetHeight: 300, clientLeft: 0, clientTop: 0 });
    ul.getBoundingClientRect = () => rect;
    // The scroller is inset 8px from the list's origin, 416 wide, 300 tall.
    measured(scroller, { clientLeft: 0, clientTop: 0, scrollWidth: 416, clientWidth: 416 });
    measured(scroller, { scrollHeight: 900, clientHeight: 300 });
    scroller.getBoundingClientRect = () =>
      ({ left: 2, top: 20, width: 416, height: 300 }) as DOMRect;
    const room = roomOf(ul);
    // 416 wide from x = 2, the list's origin at x = 10: 408 from the list.
    expect(room.right).toBe(408);
    expect(room.bottom).toBe(900);
    expect(room.left).toBe(Number.NEGATIVE_INFINITY);
  });
});
