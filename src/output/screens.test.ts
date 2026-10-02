import { describe, expect, it } from "vitest";
import {
  chooseScreen,
  describeScreen,
  featuresFor,
  keyOf,
  rememberedScreenOf,
  type ScreenInfo,
  screenAt,
} from "./screens.ts";

const screen = (over: Partial<ScreenInfo> = {}): ScreenInfo => ({
  label: "DELL",
  width: 1920,
  height: 1080,
  left: 0,
  top: 0,
  isPrimary: false,
  isInternal: false,
  ...over,
});
const laptop = screen({
  label: "Color LCD",
  width: 1440,
  height: 900,
  isPrimary: true,
  isInternal: true,
});
const projector = screen({ label: "EPSON PJ", width: 1280, height: 800, left: 1440 });
const monitor = screen({ label: "DELL U2720Q", width: 2560, height: 1440, left: 2720 });

describe("chooseScreen", () => {
  it("chooses nothing on one screen, or none", () => {
    expect(chooseScreen({ screens: [laptop], current: laptop }).why).toBe("none");
    expect(chooseScreen({ screens: [] }).why).toBe("none");
  });

  it("chooses the external non-primary screen", () => {
    const choice = chooseScreen({ screens: [laptop, projector], current: laptop });
    expect(choice).toEqual({ screen: projector, why: "automatic" });
  });

  it("skips the screen the operator is on, even when external and not primary", () => {
    const choice = chooseScreen({ screens: [projector, monitor], current: monitor });
    expect(choice.screen).toBe(projector);
  });

  it("skips the primary and the internal one", () => {
    const primaryExternal = screen({ label: "Main", isPrimary: true });
    const internalSecond = screen({ label: "Panel", isInternal: true });
    expect(
      chooseScreen({ screens: [primaryExternal, internalSecond], current: primaryExternal }).why,
    ).toBe("none");
  });

  it("takes the largest of several, then the landscape one", () => {
    expect(chooseScreen({ screens: [laptop, projector, monitor], current: laptop }).screen).toBe(
      monitor,
    );
    const portrait = screen({ label: "Rotated", width: 1080, height: 1920, left: 5000 });
    const landscape = screen({ label: "Wide", width: 1920, height: 1080, left: 6000 });
    expect(chooseScreen({ screens: [laptop, portrait, landscape], current: laptop }).screen).toBe(
      landscape,
    );
  });

  it("keeps the first of equals", () => {
    const a = screen({ label: "A", left: 1 });
    const b = screen({ label: "B", left: 2 });
    expect(chooseScreen({ screens: [laptop, a, b], current: laptop }).screen).toBe(a);
  });

  it("works without knowing the current screen", () => {
    expect(chooseScreen({ screens: [laptop, projector] }).screen).toBe(projector);
  });

  describe("a remembered screen", () => {
    it("wins over Automatic, matched by label and size, not position", () => {
      const moved = { ...projector, left: -1280 };
      const choice = chooseScreen({
        screens: [laptop, moved, monitor],
        current: laptop,
        remembered: keyOf(projector),
      });
      expect(choice).toEqual({ screen: moved, why: "remembered" });
    });

    it("is honoured even when it is the primary or the operator's screen", () => {
      const choice = chooseScreen({
        screens: [laptop, projector],
        current: laptop,
        remembered: keyOf(laptop),
      });
      expect(choice.screen).toBe(laptop);
    });

    it("falls back to Automatic when it is no longer attached", () => {
      const choice = chooseScreen({
        screens: [laptop, monitor],
        current: laptop,
        remembered: keyOf(projector),
      });
      expect(choice).toEqual({ screen: monitor, why: "automatic" });
    });

    it("needs the label and the size to agree", () => {
      const choice = chooseScreen({
        screens: [laptop, { ...projector, width: 1920 }],
        current: laptop,
        remembered: keyOf(projector),
      });
      expect(choice.why).toBe("automatic");
    });

    it("of two identical monitors, prefers the one the operator is not on", () => {
      const left = screen({ label: "Twin", left: 0 });
      const right = screen({ label: "Twin", left: 1920 });
      expect(
        chooseScreen({ screens: [left, right], current: left, remembered: keyOf(left) }).screen,
      ).toBe(right);
    });

    it("falls back to none with one screen and nothing remembered there", () => {
      expect(chooseScreen({ screens: [laptop], remembered: keyOf(projector) }).why).toBe("none");
    });
  });
});

describe("rememberedScreenOf", () => {
  it("reads a well-formed key and nothing else", () => {
    expect(rememberedScreenOf({ label: "A", width: 1, height: 2, extra: 3 })).toEqual({
      label: "A",
      width: 1,
      height: 2,
    });
    for (const bad of [undefined, null, "A", {}, { label: "A", width: "1", height: 2 }])
      expect(rememberedScreenOf(bad)).toBeUndefined();
  });
});

describe("describeScreen and featuresFor", () => {
  it("names the built-in panel, the browser's label otherwise, with the size", () => {
    expect(describeScreen(laptop)).toBe("Built-in, 1440×900");
    expect(describeScreen(projector)).toBe("EPSON PJ, 1280×800");
    expect(describeScreen({ label: "", width: 1, height: 2 }, 1)).toBe("Screen 2, 1×2");
  });

  it("covers the screen with the popup", () => {
    expect(featuresFor(projector)).toBe("popup,left=1440,top=0,width=1280,height=800");
  });
});

describe("screenAt", () => {
  it("finds the screen holding a point, or none", () => {
    expect(screenAt([laptop, projector], 100, 100)).toBe(laptop);
    expect(screenAt([laptop, projector], 1440 + 5, 10)).toBe(projector);
    expect(screenAt([laptop, projector], 9000, 10)).toBeUndefined();
  });
});
