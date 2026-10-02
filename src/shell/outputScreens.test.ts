import { afterEach, describe, expect, it } from "vitest";
import { mayHaveSecondScreen } from "./outputScreens.ts";

const setExtended = (value: unknown) =>
  Object.defineProperty(window.screen, "isExtended", { value, configurable: true });

afterEach(() => {
  Reflect.deleteProperty(window.screen, "isExtended");
  Reflect.deleteProperty(window, "getScreenDetails");
});

describe("mayHaveSecondScreen (the drag-to-the-projector hint)", () => {
  it("is true when the browser says a second screen is attached", () => {
    setExtended(true);
    expect(mayHaveSecondScreen()).toBe(true);
  });

  it("is false with one screen attached", () => {
    setExtended(false);
    expect(mayHaveSecondScreen()).toBe(false);
  });

  it("is false where the browser cannot tell (Firefox, Safari)", () => {
    expect((window.screen as { isExtended?: boolean }).isExtended).toBeUndefined();
    expect(mayHaveSecondScreen()).toBe(false);
  });

  it("with the Window Management API present, still follows isExtended", () => {
    Object.defineProperty(window, "getScreenDetails", { value: () => {}, configurable: true });
    setExtended(false);
    expect(mayHaveSecondScreen()).toBe(false);
    setExtended(true);
    expect(mayHaveSecondScreen()).toBe(true);
  });
});
