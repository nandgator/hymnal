/**
 * Displays coming and going while the app is open (ADR-0028, SDD-0001 §16.1):
 * pure, so a plugged-in or unplugged projector is testable without one. The
 * events themselves are read in `shell/outputScreens.ts`.
 */
import { type ScreenInfo, type ScreenKey, sameKey } from "./screens.ts";

export type Os = "windows" | "mac" | "linux" | "other";

/** The OS, from `navigator.userAgentData?.platform` with `navigator.platform` as the fallback. */
export function osOf(nav: { userAgentData?: { platform?: string }; platform?: string }): Os {
  const platform = nav.userAgentData?.platform || nav.platform || "";
  if (/win/i.test(platform)) return "windows";
  if (/mac/i.test(platform)) return "mac";
  if (/linux|x11|cros/i.test(platform)) return "linux";
  return "other";
}

export const currentOs = (): Os => osOf(navigator as Parameters<typeof osOf>[0]);

/**
 * How to switch a mirrored projector to extended. A web page cannot do it, so
 * it says how. GNOME cannot be told from other Linux here, so Linux names
 * both.
 */
export function extendHint(os: Os = currentOs()): string {
  switch (os) {
    case "windows":
      return "Press Win+P and choose Extend.";
    case "mac":
      return "System Settings → Displays → choose the projector and set it as Extended display (not Mirror).";
    case "linux":
      return "Settings → Displays → Join Displays (Super+P cycles modes on many setups).";
    default:
      return "Open your system's display settings and set the projector to extend, not mirror.";
  }
}

/** What the user sees when only one screen is known: one sentence, then the step. */
export const mirroredNote = (os: Os = currentOs()): string =>
  `Only one screen was found. A projector connected as a mirror looks like one screen. ${extendHint(os)}`;

export interface ScreensSnapshot {
  /** The screens, empty where the Window Management API is not granted. */
  screens: readonly ScreenInfo[];
  /** `screen.isExtended`, which needs no permission. */
  extended: boolean;
}

export type ScreenReview =
  | { kind: "none" }
  /** A projector appeared; `screen` is unknown without screen access. */
  | { kind: "connected"; screen: ScreenInfo | undefined }
  /** The Output's screen went; `gone` is unknown without screen access. */
  | { kind: "disconnected"; gone: ScreenKey | undefined; remaining: ScreenInfo | undefined }
  /** The screen the Output left has returned. */
  | { kind: "back" };

const samePlace = (a: ScreenInfo, b: ScreenInfo) =>
  sameKey(a, b) && a.left === b.left && a.top === b.top;

/**
 * What a settled change of displays means for a live Output. Never acts on its
 * own: it names the notice, and the person decides. Not live, it says nothing
 * (Go Live picks the screen as Automatic does).
 */
export function reviewScreens(input: {
  before: ScreensSnapshot;
  after: ScreensSnapshot;
  live: boolean;
  /** The screen the Output was placed on, if any. */
  placed: ScreenKey | undefined;
  /** A screen the Output was on that went away. */
  goneFrom: ScreenKey | undefined;
  /** The screen the operator's window is on. */
  current: ScreenInfo | undefined;
}): ScreenReview {
  const { before, after, live, placed, goneFrom, current } = input;
  if (!live) return { kind: "none" };
  const named = before.screens.length > 0 && after.screens.length > 0;
  const appeared = named
    ? after.screens.filter((s) => !before.screens.some((b) => samePlace(b, s)))
    : [];
  const vanished = named
    ? before.screens.filter((s) => !after.screens.some((a) => samePlace(a, s)))
    : [];
  const unnamedAppeared = !named && !before.extended && after.extended;
  const unnamedVanished = !named && before.extended && !after.extended;

  if (goneFrom && after.screens.some((s) => sameKey(s, goneFrom))) return { kind: "back" };

  if (vanished.length > 0 && placed && vanished.some((s) => sameKey(s, placed)))
    return {
      kind: "disconnected",
      gone: placed,
      remaining:
        current && after.screens.some((s) => samePlace(s, current)) ? current : after.screens[0],
    };
  if (unnamedVanished) return { kind: "disconnected", gone: undefined, remaining: undefined };

  if (appeared.length > 0) {
    const onMain =
      !placed || after.screens.some((s) => sameKey(s, placed) && (s.isInternal || s.isPrimary));
    const offered = appeared.find((s) => !s.isInternal) ?? appeared[0];
    if (onMain && offered) return { kind: "connected", screen: offered };
  }
  if (unnamedAppeared) return { kind: "connected", screen: undefined };
  return { kind: "none" };
}
