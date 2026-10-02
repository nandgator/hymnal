import { afterEach, describe, expect, it } from "vitest";
import { hoverGlide } from "./hoverGlide.ts";

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
