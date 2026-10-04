import { afterEach, describe, expect, it } from "vitest";
import { markerAlign, placeMarker } from "./inkEdge.ts";

// SDD-0005 § 1: the marker follows the part's own text alignment.
describe("a part marker's alignment follows the lines' text-align", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  const part = (style: string) => {
    const line = document.createElement("div");
    line.setAttribute("style", style);
    line.textContent = "Line";
    const row = document.createElement("div");
    const text = document.createElement("span");
    text.textContent = "Chorus";
    row.append(text);
    document.body.append(line, row);
    return { line, row, text };
  };

  it("centres the marker over centred lines, with no ink nudge", () => {
    const { line, row, text } = part("text-align: center");
    text.style.setProperty("--ink-nudge", "1px");
    expect(placeMarker(row, text, [line])).toBe("center");
    expect(row.dataset.align).toBe("center");
    expect(text.style.getPropertyValue("--ink-nudge")).toBe("");
  });

  it("starts the marker over start-aligned lines", () => {
    const { line, row, text } = part("text-align: start");
    expect(placeMarker(row, text, [line])).toBe("start");
    expect(row.dataset.align).toBe("start");
  });

  it("resolves left and right against the direction", () => {
    const [ltr, rtl] = [
      part("text-align: left; direction: ltr").line,
      part("text-align: left; direction: rtl").line,
    ];
    expect(markerAlign(ltr)).toBe("start");
    expect(markerAlign(rtl)).toBe("end");
  });

  it("keeps a right-to-left centred part centred, and drops the nudge from a start one", () => {
    const centred = part("text-align: center; direction: rtl");
    expect(placeMarker(centred.row, centred.text, [centred.line])).toBe("center");
    const start = part("text-align: start; direction: rtl");
    start.text.style.setProperty("--ink-nudge", "1px");
    expect(placeMarker(start.row, start.text, [start.line])).toBe("start");
    expect(start.text.style.getPropertyValue("--ink-nudge")).toBe("");
  });
});
