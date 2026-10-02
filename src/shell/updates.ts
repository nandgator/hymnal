import { type Accessor, createSignal, getOwner, onCleanup, runWithOwner } from "solid-js";

/** How often a long-open Operator asks the server whether a newer app exists. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

export interface UpdateState {
  /** A new version has downloaded and is waiting (the service worker's
   * "waiting" state). */
  ready: boolean;
  /** The Output is open: Go live has been pressed, so it is On Air or Blanked
   * (SDD-0001 §16.4), whichever it shows. */
  live: boolean;
}

/**
 * The one rule for updates (PLAN Board #32): a waiting update is announced and
 * applied only while the Output is not live. Restart reloads the page, which
 * would drop the Operator mid-service; the prompt itself is noise. Both
 * answers are the same today and are asked separately so a future "apply on
 * its own" (never while live) cannot reuse the prompt's answer by accident.
 */
export function updateGate({ ready, live }: UpdateState): { prompt: boolean; apply: boolean } {
  return { prompt: ready && !live, apply: ready && !live };
}

/** How long to wait for an Output window to answer the presence ping. */
export const PRESENCE_TIMEOUT_MS = 1000;

export interface Presence {
  /** An Output window is open. */
  open: Accessor<boolean>;
  /** Whether presence can be trusted yet: an Output window answers the ping
   * within moments, but silence means "none" only after a short wait. */
  known: Accessor<boolean>;
  /** Open, or not yet known: what the update gate treats as live, so a
   * reload at load time cannot slip an update in under an Output not yet
   * heard from. */
  live: Accessor<boolean>;
}

/** Tracks the Output's presence from a subscribe function (the channel's). Call under a reactive owner. */
export function createPresence(
  subscribe: (handler: (open: boolean) => void) => () => void,
  timeoutMs = PRESENCE_TIMEOUT_MS,
): Presence {
  const [open, setOpen] = createSignal(false);
  const [known, setKnown] = createSignal(false);
  const unsubscribe = subscribe((value) => {
    setOpen(value);
    setKnown(true);
  });
  const timer = setTimeout(() => setKnown(true), timeoutMs);
  onCleanup(() => {
    clearTimeout(timer);
    unsubscribe();
  });
  return { open, known, live: () => open() || !known() };
}

/** Runs `restart` only if the gate allows it now; says whether it did. */
export function restartIfAllowed(state: UpdateState, restart: () => void): boolean {
  if (!updateGate(state).apply) return false;
  restart();
  return true;
}

export type NoticeId = "update" | "safari-hint";

/**
 * Which notice the shell shows, if any — one at a time, the update first
 * (it needs a decision; the hint is advice). Nothing while the Output is live.
 */
export function pickNotice(state: {
  update: UpdateState;
  safariHint: boolean;
  updateDismissed: boolean;
}): NoticeId | undefined {
  if (state.update.live) return undefined;
  if (updateGate(state.update).prompt && !state.updateDismissed) return "update";
  if (state.safariHint) return "safari-hint";
  return undefined;
}

export type HomeScreenKind = "home-screen" | "dock";

/**
 * Whether to suggest installing: Safari (on iPhone, iPad or Mac), running in a
 * tab, not as an installed app. WebKit clears script-writable storage — OPFS
 * and IndexedDB, so the books — after 7 days without use unless the site is
 * installed (its Intelligent Tracking Prevention cap). Other browsers, and
 * Safari once installed, are left alone.
 */
export function homeScreenHint(env: {
  userAgent: string;
  maxTouchPoints?: number;
  standalone?: boolean;
}): HomeScreenKind | undefined {
  const { userAgent: ua } = env;
  const safari =
    /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPR\/|OPiOS|Android/.test(ua);
  if (!safari || env.standalone) return undefined;
  const iOS =
    /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (env.maxTouchPoints ?? 0) > 1);
  return iOS ? "home-screen" : "dock";
}

export function homeScreenHintHere(): HomeScreenKind | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & { standalone?: boolean };
  return homeScreenHint({
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    standalone:
      nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true,
  });
}

/** Whether a tab left running behind a newly activated worker should reload:
 * only one that had a worker before (not a first install) and is not live. */
export function shouldReloadOnTakeover(state: {
  hadController: boolean;
  live: boolean;
  restarting: boolean;
}): boolean {
  return state.hadController && !state.live && !state.restarting;
}

export interface AppUpdates {
  /** A new version is downloaded and waiting. */
  ready: Accessor<boolean>;
  /** Activates the waiting version and reloads. Callers gate it with {@link updateGate}. */
  restart: () => void;
}

/**
 * Registers the service worker in "prompt" mode (vite-plugin-pwa): a new
 * version downloads quietly, the old one keeps serving the open page — and
 * its files — until {@link AppUpdates.restart}, or until the next cold start,
 * when no page is left on the old one. Content (OPFS) and settings
 * (IndexedDB) are not in the service worker's caches, so neither is touched.
 * Production only; dev has no service worker.
 */
export function createAppUpdates(
  isLive: () => boolean = () => false,
  register: () => Promise<typeof import("virtual:pwa-register")> = () =>
    import("virtual:pwa-register"),
): AppUpdates {
  const [ready, setReady] = createSignal(false);
  let apply: ((reload?: boolean) => Promise<void>) | undefined;
  let restarting = false;
  // Cleanups registered from async callbacks need the owner captured here.
  const owner = getOwner();
  const hadController = !!globalThis.navigator?.serviceWorker?.controller;
  if (import.meta.env.PROD) {
    void register().then(({ registerSW }) => {
      // Another tab restarted: this one's worker was replaced and its old
      // precache deleted, so a tab not live reloads onto the new files. A
      // live one never reloads; it keeps running what it has loaded.
      const onTakeover = () => {
        if (shouldReloadOnTakeover({ hadController, live: isLive(), restarting }))
          location.reload();
      };
      navigator.serviceWorker?.addEventListener("controllerchange", onTakeover);
      if (owner)
        runWithOwner(owner, () =>
          onCleanup(() =>
            navigator.serviceWorker?.removeEventListener("controllerchange", onTakeover),
          ),
        );
      apply = registerSW({
        onNeedRefresh: () => setReady(true),
        onRegisteredSW: (_url, registration) => {
          if (!registration) return;
          // A tab open for days still learns of a deploy: hourly, and when it
          // comes back to the foreground.
          const check = () => {
            if (navigator.onLine) registration.update().catch(() => {});
          };
          const timer = setInterval(check, UPDATE_CHECK_MS);
          const onVisible = () => {
            if (document.visibilityState === "visible") check();
          };
          document.addEventListener("visibilitychange", onVisible);
          const stop = () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
          };
          if (owner) runWithOwner(owner, () => onCleanup(stop));
        },
      });
    });
  }
  return {
    ready,
    restart: () => {
      restarting = true;
      void apply?.(true);
    },
  };
}
