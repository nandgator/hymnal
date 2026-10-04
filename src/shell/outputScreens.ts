import { type Accessor, createSignal, getOwner, onCleanup, runWithOwner } from "solid-js";
import type { ScreenInfo } from "../output/screens.ts";

/** The Window Management API's shape, as far as the app reads it; lib.dom has none of it. */
interface ScreenDetailedLike {
  label?: string;
  width: number;
  height: number;
  left: number;
  top: number;
  isPrimary?: boolean;
  isInternal?: boolean;
}
interface ScreenDetailsLike extends EventTarget {
  screens: readonly ScreenDetailedLike[];
  currentScreen: ScreenDetailedLike;
}
type WindowWithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetailsLike> };

const infoOf = (screen: ScreenDetailedLike): ScreenInfo => ({
  label: screen.label ?? "",
  width: screen.width,
  height: screen.height,
  left: screen.left,
  top: screen.top,
  isPrimary: !!screen.isPrimary,
  isInternal: !!screen.isInternal,
});

/** Whether the Window Management API exists here: Chrome and Edge on a desktop. */
export const screensSupported = () =>
  typeof window !== "undefined" &&
  typeof (window as WindowWithScreens).getScreenDetails === "function";

/** More than one screen is attached: a cheap check that needs no permission. */
export const screenIsExtended = () =>
  !!(globalThis.screen as { isExtended?: boolean } | undefined)?.isExtended;

/**
 * Whether "drag the Output to the projector" is worth saying: only when a
 * second screen may exist. `screen.isExtended` is the browser's own word for
 * it, with or without the Window Management API; where it is undefined
 * (Firefox, Safari) we cannot tell, and a single-screen user is not nagged.
 */
export const mayHaveSecondScreen = () => screenIsExtended();

export type ScreenStatus = "unknown" | "ready" | "denied" | "error";

export interface OutputScreens {
  supported: boolean;
  /** The attached screens, once asked: empty until then. */
  screens: Accessor<ScreenInfo[]>;
  /** The screen the operator's window is on. */
  current: Accessor<ScreenInfo | undefined>;
  status: Accessor<ScreenStatus>;
  /** `screen.isExtended`, kept live through `screen.onchange`; needs no permission. */
  extended: Accessor<boolean>;
  /** Asks for the screens: the browser's permission prompt the first time.
   * Never rejects. Call it from a gesture. */
  detect: () => Promise<boolean>;
}

/**
 * The attached screens (ADR-0028), kept live through `screenschange`. Nothing
 * is asked at start-up: a permission already granted is used quietly (no
 * prompt), so Go live can place the window synchronously; otherwise the
 * first Go live or the Detect Screens button asks. Call under a reactive owner.
 */
export function createOutputScreens(): OutputScreens {
  const supported = screensSupported();
  const [screens, setScreens] = createSignal<ScreenInfo[]>([]);
  const [current, setCurrent] = createSignal<ScreenInfo>();
  const [status, setStatus] = createSignal<ScreenStatus>("unknown");
  const [extended, setExtended] = createSignal(screenIsExtended());
  let details: ScreenDetailsLike | undefined;
  let pending: Promise<boolean> | undefined;
  const owner = getOwner();

  const snapshot = () => {
    if (!details) return;
    setScreens(details.screens.map(infoOf));
    setCurrent(infoOf(details.currentScreen));
    setExtended(details.screens.length > 1);
  };

  const detect = () => {
    if (!supported) return Promise.resolve(false);
    if (details) {
      snapshot();
      return Promise.resolve(true);
    }
    pending ??= (async () => {
      try {
        details = await (window as WindowWithScreens).getScreenDetails?.();
        if (!details) throw new Error("no details");
        const live = details;
        live.addEventListener("screenschange", snapshot);
        live.addEventListener("currentscreenchange", snapshot);
        if (owner)
          runWithOwner(owner, () =>
            onCleanup(() => {
              live.removeEventListener("screenschange", snapshot);
              live.removeEventListener("currentscreenchange", snapshot);
            }),
          );
        snapshot();
        setStatus("ready");
        return true;
      } catch (error) {
        setStatus((error as Error)?.name === "NotAllowedError" ? "denied" : "error");
        return false;
      } finally {
        pending = undefined;
      }
    })();
    return pending;
  };

  // A permission granted before is used without a prompt.
  const detectIfGranted = async () => {
    try {
      const state = await navigator.permissions?.query({
        name: "window-management" as PermissionName,
      });
      if (state?.state === "granted") await detect();
      else if (state?.state === "denied") setStatus("denied");
    } catch {
      // Unknown permission name, or no Permissions API: Go live asks.
    }
  };
  if (supported && screenIsExtended()) void detectIfGranted();

  // A display plugged in or out: `isExtended` follows, with or without the
  // permission. Where the screens are not yet known and the permission was
  // granted, they are read now.
  const onScreenChange = () => {
    setExtended(details ? details.screens.length > 1 : screenIsExtended());
    if (supported && !details && screenIsExtended()) void detectIfGranted();
  };
  const hostScreen = globalThis.screen as unknown as EventTarget | undefined;
  hostScreen?.addEventListener?.("change", onScreenChange);
  if (owner)
    runWithOwner(owner, () =>
      onCleanup(() => hostScreen?.removeEventListener?.("change", onScreenChange)),
    );

  return { supported, screens, current, status, extended, detect };
}
