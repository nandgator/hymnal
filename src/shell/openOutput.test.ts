import { describe, expect, it, vi } from "vitest";
import { encodeTarget, parseTarget } from "../output/placement.ts";
import type { ScreenInfo } from "../output/screens.ts";
import { type OpenOutputInput, openOutputWindow, placedUrl } from "./openOutput.ts";
import type { OutputScreens } from "./outputScreens.ts";

const screenOf = (over: Partial<ScreenInfo>): ScreenInfo => ({
  label: "X",
  width: 1920,
  height: 1080,
  left: 0,
  top: 0,
  isPrimary: false,
  isInternal: false,
  ...over,
});
const laptop = screenOf({ label: "Panel", isPrimary: true, isInternal: true });
const projector = screenOf({ label: "PJ", left: 1920 });

function fake(over: Partial<OutputScreens> = {}): OutputScreens {
  return {
    supported: true,
    screens: () => [],
    current: () => laptop,
    status: () => "unknown",
    detect: async () => false,
    ...over,
  };
}
const input = (screens: OutputScreens, extra: Partial<OpenOutputInput> = {}): OpenOutputInput => ({
  url: "/?output=1",
  name: "out",
  screens,
  remembered: undefined,
  open: vi.fn(() => ({}) as Window),
  ...extra,
});
const extended = (value: boolean) =>
  Object.defineProperty(window.screen, "isExtended", { value, configurable: true });

describe("openOutputWindow", () => {
  it("opens a plain popup, at once, where the API is missing", async () => {
    const args = input(fake({ supported: false }));
    const pending = openOutputWindow(args);
    expect(args.open).toHaveBeenCalledWith("/?output=1", "out", "popup");
    expect(await pending).toMatchObject({ kind: "plain", reason: "unsupported" });
  });

  it("opens on the chosen screen at once when the screens are already known", async () => {
    const args = input(fake({ screens: () => [laptop, projector] }));
    const pending = openOutputWindow(args);
    expect(args.open).toHaveBeenCalledWith(
      `/?output=1&placed=1&screen=${encodeURIComponent(encodeTarget(projector))}`,
      "out",
      "popup,left=1920,top=0,width=1920,height=1080",
    );
    expect(await pending).toMatchObject({ kind: "placed", screen: projector });
  });

  it("asks for the screens once on the first open, then places", async () => {
    extended(true);
    let known: ScreenInfo[] = [];
    const detect = vi.fn(async () => {
      known = [laptop, projector];
      return true;
    });
    const outcome = await openOutputWindow(input(fake({ screens: () => known, detect })));
    expect(detect).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe("placed");
  });

  it("does not ask on a single screen", async () => {
    extended(false);
    const detect = vi.fn(async () => true);
    expect(await openOutputWindow(input(fake({ detect })))).toMatchObject({
      kind: "plain",
      reason: "single",
    });
    expect(detect).not.toHaveBeenCalled();
  });

  it("falls back, with the reason, when the permission is denied or detection fails", async () => {
    extended(true);
    const denied = fake({ detect: async () => false, status: () => "denied" });
    expect(await openOutputWindow(input(denied))).toMatchObject({ reason: "denied" });
    const failed = fake({ detect: async () => false, status: () => "error" });
    expect(await openOutputWindow(input(failed))).toMatchObject({ reason: "error" });
  });

  it("falls back when no screen qualifies, or the remembered one is gone and none is external", async () => {
    const only = fake({
      screens: () => [laptop, screenOf({ label: "Main", isPrimary: true, left: 1 })],
    });
    expect(await openOutputWindow(input(only))).toMatchObject({ kind: "plain", reason: "none" });
  });

  it("uses the remembered screen over Automatic", async () => {
    const other = screenOf({ label: "TV", left: 4000, width: 3840, height: 2160 });
    const outcome = await openOutputWindow(
      input(fake({ screens: () => [laptop, projector, other] }), {
        remembered: { label: "PJ", width: 1920, height: 1080 },
      }),
    );
    expect(outcome).toMatchObject({ kind: "placed", screen: projector });
  });

  it("never throws: an error opening is a plain popup", async () => {
    const open = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("boom");
      })
      .mockReturnValue(null);
    const outcome = await openOutputWindow(
      input(fake({ screens: () => [laptop, projector] }), { open }),
    );
    expect(outcome).toMatchObject({ kind: "plain", reason: "error" });
  });
});

describe("placedUrl", () => {
  it("adds placed to a URL with or without a query", () => {
    expect(placedUrl("/?output=1")).toBe("/?output=1&placed=1");
    expect(placedUrl("/x")).toBe("/x?placed=1");
  });

  it("names the screen, so the Output can fullscreen on it itself", () => {
    const url = new URL(placedUrl("/?output=1", projector), "http://x");
    expect(parseTarget(url.search)).toEqual({
      label: projector.label,
      width: projector.width,
      height: projector.height,
      left: projector.left,
      top: projector.top,
    });
  });
});
