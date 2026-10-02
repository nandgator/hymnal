import { describe, expect, it } from "vitest";
import { placeMenu } from "./menuPlacement.ts";

const viewport = { w: 1280, h: 800 };
const menu = { w: 240, h: 150 };
const at = (top: number, left = 400) => ({ top, left, right: left + 120, bottom: top + 48 });

describe("placeMenu", () => {
  it("opens below the trigger when there is room", () => {
    expect(placeMenu({ trigger: at(100), menu, viewport, align: "start" })).toEqual({
      top: 152,
      left: 400,
      above: false,
    });
  });

  it("flips above when there is no room below and more above", () => {
    const p = placeMenu({ trigger: at(700), menu, viewport, align: "start" });
    expect(p.above).toBe(true);
    expect(p.top).toBe(700 - 4 - 150);
    expect(p.maxHeight).toBeUndefined();
  });

  it("stays below, scrolling, when above is no roomier", () => {
    const p = placeMenu({ trigger: at(30), menu: { w: 240, h: 900 }, viewport, align: "start" });
    expect(p.above).toBe(false);
    expect(p.maxHeight).toBe(800 - 78 - 4 - 8);
  });

  it("limits the height when neither side fits, on the roomier one", () => {
    const p = placeMenu({ trigger: at(500), menu: { w: 240, h: 600 }, viewport, align: "start" });
    expect(p.above).toBe(true);
    expect(p.maxHeight).toBe(500 - 4 - 8);
  });

  it("aligns to the end edge and keeps inside the viewport", () => {
    expect(placeMenu({ trigger: at(100, 600), menu, viewport, align: "end" }).left).toBe(480);
    expect(placeMenu({ trigger: at(100, 10), menu, viewport, align: "end" }).left).toBe(8);
    expect(placeMenu({ trigger: at(100, 1200), menu, viewport, align: "start" }).left).toBe(1032);
  });
});
