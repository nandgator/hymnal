import { afterEach, describe, expect, it } from "vitest";
import { hoverButton, hoverGlide, hoverGroup } from "./hoverGlide.ts";

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
