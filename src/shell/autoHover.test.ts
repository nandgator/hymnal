import { afterEach, describe, expect, it } from "vitest";
import { autoHover } from "./autoHover.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

const over = (el: Element, pointerType = "mouse") =>
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType }));
const layerOf = (el: Element) => el.querySelector<HTMLElement>(":scope > .hover-glide");

describe("autoHover", () => {
  it("gives a standalone button the layer on its first hover, lit at once", () => {
    document.body.innerHTML = '<button class="btn-tonal">Load</button>';
    const stop = autoHover();
    const button = document.querySelector("button") as HTMLButtonElement;
    expect(layerOf(button)).toBeNull();
    over(button);
    expect(button.classList.contains("glide-self")).toBe(true);
    expect(layerOf(button)?.style.opacity).toBe("1");
    stop();
  });

  it("leaves alone a disabled button, a touch, a button a list lights, and any other element", () => {
    document.body.innerHTML = `
      <button class="btn-filled" disabled>Off</button>
      <button class="btn-text">Tap</button>
      <ul data-hover-glide=""><li><button class="btn-text">Row</button></li></ul>
      <button class="somewhere-else">Plain</button>
      <a class="btn-text" href="#x">Link</a>`;
    const stop = autoHover();
    const [off, tap, row, plain, link] = [...document.querySelectorAll("button, a")];
    over(off as Element);
    over(tap as Element, "touch");
    over(row as Element);
    over(plain as Element);
    over(link as Element);
    for (const el of [off, tap, row, plain, link]) {
      expect((el as Element).classList.contains("glide-self")).toBe(false);
    }
    stop();
  });

  it("takes the layer only once, however often the pointer comes back", () => {
    document.body.innerHTML = '<button class="btn-text">Once</button>';
    const stop = autoHover();
    const button = document.querySelector("button") as HTMLButtonElement;
    over(button);
    over(button);
    expect(button.querySelectorAll(".hover-glide")).toHaveLength(1);
    stop();
  });
});
