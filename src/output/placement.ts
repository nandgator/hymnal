/**
 * Where the Output really is (ADR-0028, "Wayland"): pure logic for picking the
 * Operator's screen inside the Output window and for saying whether the window
 * is verifiably on it. A client cannot position its own window on Wayland, so
 * `window.open` coordinates and `screenX` prove nothing there; only a
 * fullscreen request that names the screen, and `currentScreen`, do.
 */
import { keyOf, type ScreenInfo, type ScreenKey, sameKey } from "./screens.ts";

/** The screen the Operator chose, as the Output is told: key plus position. */
export type TargetScreen = ScreenKey & { left: number; top: number };

export const targetOf = (screen: ScreenInfo): TargetScreen => ({
  ...keyOf(screen),
  left: screen.left,
  top: screen.top,
});

/** The `screen` URL parameter value. */
export const encodeTarget = (screen: ScreenInfo): string => JSON.stringify(targetOf(screen));

/** Reads the target from a query string; anything malformed is no target. */
export function parseTarget(search: string): TargetScreen | undefined {
  const raw = new URLSearchParams(search).get("screen");
  if (!raw) return undefined;
  try {
    const { label, width, height, left, top } = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof label !== "string" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      typeof left !== "number" ||
      typeof top !== "number"
    )
      return undefined;
    return { label, width, height, left, top };
  } catch {
    return undefined;
  }
}

/** What the Output needs of a `ScreenDetailed`; the object itself is what `requestFullscreen` wants. */
export interface DetailedScreen {
  label?: string;
  width: number;
  height: number;
  left: number;
  top: number;
}

const matches = (screen: DetailedScreen, target: TargetScreen) =>
  sameKey({ label: screen.label ?? "", width: screen.width, height: screen.height }, target);

/** The same screen: key and place. */
export const isTarget = (screen: DetailedScreen | undefined, target: TargetScreen | undefined) =>
  !!screen &&
  !!target &&
  matches(screen, target) &&
  screen.left === target.left &&
  screen.top === target.top;

/** The attached screen the Operator meant: exact place first (of two identical
 * monitors), then the key alone (the displays were rearranged). */
export function pickTarget<T extends DetailedScreen>(
  screens: readonly T[],
  target: TargetScreen | undefined,
): T | undefined {
  if (!target) return undefined;
  return (
    screens.find((screen) => isTarget(screen, target)) ??
    screens.find((screen) => matches(screen, target))
  );
}

/** What the Output tells the Operator about where it is. */
export interface PlacementReport {
  /** Verifiably on the screen the Operator chose. */
  onTarget: boolean;
  fullscreen: boolean;
  /** This system cannot place a window by fullscreen (Wayland): the person moves it. */
  refused?: boolean;
}

/**
 * Verifiably there: the window's `currentScreen` is the target, or it is
 * fullscreen on a screen the Output itself asked for. An unreadable screen is
 * never "there".
 */
export function reportPlacement(input: {
  target: TargetScreen | undefined;
  picked: DetailedScreen | undefined;
  currentScreen: DetailedScreen | undefined;
  fullscreen: boolean;
  /** Fullscreen was requested with `{ screen: picked }` and accepted. */
  fullscreenOnPicked: boolean;
}): PlacementReport {
  const { target, picked, currentScreen, fullscreen, fullscreenOnPicked } = input;
  // A readable currentScreen decides; a fullscreen asked for on the picked
  // screen only counts where the window's screen cannot be read.
  const onTarget =
    !!target &&
    (currentScreen
      ? isTarget(currentScreen, target) || currentScreen === picked
      : fullscreen && fullscreenOnPicked && !!picked);
  return { onTarget, fullscreen };
}

/** The session flag: this system refused to place the window by fullscreen. */
const REFUSED_KEY = "placementRefused";

export function placementWasRefused(): boolean {
  try {
    return sessionStorage.getItem(REFUSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function rememberPlacementRefused(): void {
  try {
    sessionStorage.setItem(REFUSED_KEY, "1");
  } catch {}
}

/** Linux, where the window manager has its own shortcut for moving a window. */
export function isLinux(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /linux/i.test(nav.userAgentData?.platform ?? nav.platform ?? "");
}

/** What to do when the page cannot move the window itself. */
export const moveGuidance = (screenLabel: string): string =>
  `Move this window to ${screenLabel}, then press F.`;

/** The Linux-only extra line; `undefined` elsewhere. */
export const moveShortcutHint = (): string | undefined =>
  isLinux() ? "Super+Shift+Arrow moves a window to the next screen." : undefined;
