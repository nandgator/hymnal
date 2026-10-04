import { describe, expect, it } from "vitest";
import { extendHint, osOf, reviewScreens } from "./displayChange.ts";
import type { ScreenInfo } from "./screens.ts";

const laptop: ScreenInfo = {
  label: "Color LCD",
  width: 1440,
  height: 900,
  left: 0,
  top: 0,
  isPrimary: true,
  isInternal: true,
};
const projector: ScreenInfo = {
  label: "EPSON PJ",
  width: 1280,
  height: 800,
  left: 1440,
  top: 0,
  isPrimary: false,
  isInternal: false,
};
const snap = (screens: ScreenInfo[], extended = screens.length > 1) => ({ screens, extended });

describe("osOf", () => {
  it("reads userAgentData first, then navigator.platform", () => {
    expect(osOf({ userAgentData: { platform: "Windows" }, platform: "x" })).toBe("windows");
    expect(osOf({ platform: "MacIntel" })).toBe("mac");
    expect(osOf({ platform: "Linux x86_64" })).toBe("linux");
    expect(osOf({ platform: "Win32" })).toBe("windows");
    expect(osOf({ platform: "iPhone" })).toBe("other");
    expect(osOf({})).toBe("other");
  });
});

describe("extendHint", () => {
  it("gives the OS's own step", () => {
    expect(extendHint("windows")).toBe("Press Win+P and choose Extend.");
    expect(extendHint("mac")).toMatch(
      /System Settings → Displays.*Extended display \(not Mirror\)/,
    );
    expect(extendHint("linux")).toMatch(/Settings → Displays → Join Displays/);
    expect(extendHint("linux")).toMatch(/Super\+P/);
    expect(extendHint("other")).toMatch(/display settings/);
  });
});

describe("reviewScreens", () => {
  const base = {
    live: true,
    placed: undefined,
    goneFrom: undefined,
    current: laptop,
  };

  it("offers the new projector while live and the Output is on the main screen", () => {
    expect(
      reviewScreens({ ...base, before: snap([laptop]), after: snap([laptop, projector]) }),
    ).toEqual({ kind: "connected", screen: projector });
  });

  it("says nothing when not live", () => {
    expect(
      reviewScreens({
        ...base,
        live: false,
        before: snap([laptop]),
        after: snap([laptop, projector]),
      }),
    ).toEqual({ kind: "none" });
  });

  it("says nothing when the Output already sits on an external screen", () => {
    const tv = { ...projector, label: "TV", left: 2720 };
    expect(
      reviewScreens({
        ...base,
        placed: projector,
        before: snap([laptop, projector]),
        after: snap([laptop, projector, tv]),
      }),
    ).toEqual({ kind: "none" });
  });

  it("with no details, a screen appearing is connected without a name", () => {
    expect(reviewScreens({ ...base, before: snap([], false), after: snap([], true) })).toEqual({
      kind: "connected",
      screen: undefined,
    });
  });

  it("reports the Output's screen vanishing, naming the one left", () => {
    expect(
      reviewScreens({
        ...base,
        placed: projector,
        before: snap([laptop, projector]),
        after: snap([laptop]),
      }),
    ).toEqual({ kind: "disconnected", gone: projector, remaining: laptop });
  });

  it("says nothing when a screen the Output was not on vanishes", () => {
    const tv = { ...projector, label: "TV", left: 2720 };
    expect(
      reviewScreens({
        ...base,
        placed: projector,
        before: snap([laptop, projector, tv]),
        after: snap([laptop, projector]),
      }),
    ).toEqual({ kind: "none" });
  });

  it("with no details, extended turning off while live is a disconnect", () => {
    expect(reviewScreens({ ...base, before: snap([], true), after: snap([], false) })).toEqual({
      kind: "disconnected",
      gone: undefined,
      remaining: undefined,
    });
  });

  it("offers the screen it left back, rather than calling it a new projector", () => {
    expect(
      reviewScreens({
        ...base,
        goneFrom: projector,
        before: snap([laptop]),
        after: snap([laptop, projector]),
      }),
    ).toEqual({ kind: "back" });
  });
});
