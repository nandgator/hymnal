import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FADE_REGIONS, FADE_STRIP_REGIONS, fadeStrengths } from "./scrollFade.ts";

describe("fadeStrengths", () => {
  it("has no fade where nothing scrolls", () => {
    expect(fadeStrengths(0, 300, 300)).toEqual({ a: 0, b: 0 });
  });

  it("fades only the bottom at the start, ramping over 24px", () => {
    expect(fadeStrengths(0, 1000, 400)).toEqual({ a: 0, b: 1 });
    expect(fadeStrengths(12, 1000, 400)).toEqual({ a: 0.5, b: 1 });
    expect(fadeStrengths(24, 1000, 400)).toEqual({ a: 1, b: 1 });
  });

  it("fades only the top at the end, and loses the bottom fade over the last 24px", () => {
    expect(fadeStrengths(600, 1000, 400)).toEqual({ a: 1, b: 0 });
    expect(fadeStrengths(588, 1000, 400)).toEqual({ a: 1, b: 0.5 });
    expect(fadeStrengths(576, 1000, 400)).toEqual({ a: 1, b: 1 });
  });

  it("is in proportion to how far a short scroll goes", () => {
    expect(fadeStrengths(0, 410, 400)).toEqual({ a: 0, b: 10 / 24 });
  });

  it("counts a column-reverse region (negative scrollTop) from where it starts", () => {
    expect(fadeStrengths(0, 1000, 400)).toEqual({ a: 0, b: 1 });
    expect(fadeStrengths(-600, 1000, 400)).toEqual({ a: 1, b: 0 });
  });
});

describe("the shared fade rule", () => {
  const css = readFileSync(`${import.meta.dirname}/../styles.css`, "utf8");

  it("lists every region of FADE_REGIONS, in the mask rule and in the scroll-driven one", () => {
    const rule = (open: string) => {
      const at = css.indexOf(open);
      return css.slice(at, css.indexOf("{", at));
    };
    const mask = rule(":where(\n  .shell-main");
    const driven = rule("  :where(\n    .shell-main");
    for (const region of FADE_REGIONS) {
      expect(mask, region).toContain(region);
      expect(driven, region).toContain(region);
    }
  });

  it("gives every floating list its two sticky strips, driven by scroll or by the helper", () => {
    for (const region of FADE_STRIP_REGIONS) {
      const name = region.slice(1);
      expect(css, region).toMatch(new RegExp(`:is\\([^)]*\\.${name}[^)]*\\)::before`));
    }
    expect(css).toContain("animation-timeline: scroll(nearest)");
    expect(css).toContain("opacity: var(--strip-a, 0)");
    expect(css).toContain("opacity: var(--strip-b, 0)");
  });

  it("keeps a floating list's own animations out of the way: no mask on it", () => {
    for (const region of FADE_STRIP_REGIONS) expect(FADE_REGIONS).not.toContain(region);
  });
});
