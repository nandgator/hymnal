import { chooseScreen, featuresFor, type ScreenInfo, type ScreenKey } from "../output/screens.ts";
import { type OutputScreens, screenIsExtended } from "./outputScreens.ts";

export type PlainReason = "unsupported" | "single" | "denied" | "error" | "none";

export type OpenOutcome =
  | { kind: "placed"; screen: ScreenInfo; win: Window | null }
  | { kind: "plain"; reason: PlainReason; win: Window | null };

export interface OpenOutputInput {
  url: string;
  name: string;
  screens: OutputScreens;
  remembered: ScreenKey | undefined;
  /** `window.open`, injectable. */
  open?: (url: string, name: string, features: string) => Window | null;
}

/** The URL a placed Output opens at: it knows to try fullscreen. */
export const placedUrl = (url: string) => `${url}${url.includes("?") ? "&" : "?"}placed=1`;

/**
 * Opens the Output (ADR-0028). With the Window Management API and a second
 * screen, on the chosen one; everywhere else, as a plain popup, which is
 * today's behaviour. Nothing here throws or waits on anything but the first
 * permission prompt, and `window.open` is called synchronously whenever the
 * screens are already known, so the click's activation is still live.
 */
export async function openOutputWindow({
  url,
  name,
  screens,
  remembered,
  open = (u, n, f) => window.open(u, n, f),
}: OpenOutputInput): Promise<OpenOutcome> {
  const plain = (reason: PlainReason): OpenOutcome => ({
    kind: "plain",
    reason,
    win: open(url, name, "popup"),
  });
  if (!screens.supported) return plain("unsupported");
  try {
    if (screens.screens().length === 0) {
      if (!screenIsExtended()) return plain("single");
      if (!(await screens.detect()))
        return plain(screens.status() === "denied" ? "denied" : "error");
    }
    const choice = chooseScreen({
      screens: screens.screens(),
      current: screens.current(),
      remembered,
    });
    if (!choice.screen) return plain(screens.screens().length < 2 ? "single" : "none");
    return {
      kind: "placed",
      screen: choice.screen,
      win: open(placedUrl(url), name, featuresFor(choice.screen)),
    };
  } catch {
    return plain("error");
  }
}

/**
 * Moves the open Output to a screen and says whether it got there. A fullscreen
 * window will not move, so it leaves fullscreen first (the Output re-arms its
 * click and F for fullscreen). `handle` is the window `open` returned, if this
 * Operator opened it; otherwise the named window is looked up, never reloaded.
 */
export async function moveOutputTo(
  screen: ScreenInfo,
  name: string,
  handle?: Window | null,
): Promise<boolean> {
  try {
    const win = handle && !handle.closed ? handle : window.open("", name);
    if (!win) return false;
    if (win.document.fullscreenElement) {
      await win.document.exitFullscreen();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    win.moveTo(screen.left, screen.top);
    win.resizeTo(screen.width, screen.height);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return Math.abs(win.screenX - screen.left) <= 80 && Math.abs(win.screenY - screen.top) <= 80;
  } catch {
    return false;
  }
}
