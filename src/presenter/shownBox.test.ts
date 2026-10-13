import { afterEach, describe, expect, it, vi } from "vitest";
import { type Box, frame, shownBox } from "./glideGeometry.ts";

// A layer whose computed size is not a length (display: none gives `auto`, a
// detached one gives nothing) must not hand its NaN to the next glide: the
// browser warns `Invalid keyframe value … NaNpx` and the glide jumps.
describe("shownBox", () => {
  afterEach(() => vi.unstubAllGlobals());

  const box: Box = { x: 10, y: 20, w: 100, h: 40 };
  const stubStyle = (style: Partial<CSSStyleDeclaration>) => {
    vi.stubGlobal(
      "DOMMatrix",
      class {
        m41 = 0;
        m42 = 0;
      },
    );
    vi.stubGlobal("getComputedStyle", () => ({ transform: "none", ...style }));
  };
  const animation = {} as Animation;

  it("reads the size the layer is drawn at, mid-glide", () => {
    stubStyle({ width: "80px", height: "30px" });
    expect(shownBox(document.createElement("div"), animation, box)).toEqual({
      x: 0,
      y: 0,
      w: 80,
      h: 30,
    });
  });

  it("falls back to the box where the computed size is auto or empty", () => {
    for (const size of ["auto", ""]) {
      stubStyle({ width: size, height: size });
      const shown = shownBox(document.createElement("div"), animation, box);
      expect(shown).toEqual({ x: 0, y: 0, w: 100, h: 40 });
      expect(JSON.stringify(frame(shown as Box))).not.toContain("NaN");
    }
  });
});
