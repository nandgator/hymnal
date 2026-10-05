// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  encodeTarget,
  isTarget,
  parseTarget,
  pickTarget,
  reportPlacement,
  targetOf,
} from "./placement.ts";

const builtIn = { label: "Built-in", width: 1920, height: 1080, left: 0, top: 0 };
const hxa = { label: 'HXA 32"', width: 1280, height: 720, left: 1920, top: 0 };
const info = { ...hxa, isPrimary: false, isInternal: false };

describe("the target screen in the URL", () => {
  it("round-trips label, size and place", () => {
    const search = `?output=1&placed=1&screen=${encodeURIComponent(encodeTarget(info))}`;
    expect(parseTarget(search)).toEqual(targetOf(info));
  });
  it("treats absent or malformed as no target", () => {
    expect(parseTarget("?output=1&placed=1")).toBeUndefined();
    expect(parseTarget("?screen=%7Bnope")).toBeUndefined();
    expect(parseTarget(`?screen=${encodeURIComponent('{"label":1}')}`)).toBeUndefined();
  });
});

describe("pickTarget", () => {
  const target = targetOf(info);
  it("finds the screen by key and place", () => {
    expect(pickTarget([builtIn, hxa], target)).toBe(hxa);
  });
  it("of two identical monitors takes the one at the place", () => {
    const twin = { ...hxa, left: 3200 };
    expect(pickTarget([twin, hxa], target)).toBe(hxa);
  });
  it("falls back to the key when the displays were rearranged", () => {
    const moved = { ...hxa, left: 0, top: 1080 };
    expect(pickTarget([builtIn, moved], target)).toBe(moved);
  });
  it("is undefined when the screen is gone or there is no target", () => {
    expect(pickTarget([builtIn], target)).toBeUndefined();
    expect(pickTarget([builtIn, hxa], undefined)).toBeUndefined();
  });
});

describe("reportPlacement: never claims what it cannot know", () => {
  const target = targetOf(info);
  const base = { target, picked: hxa, fullscreen: false, fullscreenOnPicked: false };
  it("is on target when currentScreen is the target", () => {
    expect(reportPlacement({ ...base, currentScreen: hxa }).onTarget).toBe(true);
    expect(isTarget(hxa, target)).toBe(true);
  });
  it("is not when currentScreen is another screen (a Wayland window on the main screen)", () => {
    expect(reportPlacement({ ...base, currentScreen: builtIn }).onTarget).toBe(false);
  });
  it("is on target when fullscreen was entered on the picked screen", () => {
    const report = reportPlacement({
      ...base,
      currentScreen: undefined,
      fullscreen: true,
      fullscreenOnPicked: true,
    });
    expect(report).toEqual({ onTarget: true, fullscreen: true });
  });
  it("is not fullscreen on whatever screen it happened to be on", () => {
    const report = reportPlacement({ ...base, currentScreen: builtIn, fullscreen: true });
    expect(report).toEqual({ onTarget: false, fullscreen: true });
  });
  it("is not when nothing is known or there is no target", () => {
    expect(reportPlacement({ ...base, picked: undefined, currentScreen: undefined }).onTarget).toBe(
      false,
    );
    expect(reportPlacement({ ...base, target: undefined, currentScreen: hxa }).onTarget).toBe(
      false,
    );
  });
});
