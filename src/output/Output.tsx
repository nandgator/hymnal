import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { BandSize, Highlight, OutputCues } from "../persistence/user-state.ts";
import { isPresentationKey } from "../shell/keymap.ts";
import { easeThemeChange } from "../shell/theme.ts";
import {
  forwardKey,
  type OutputMessage,
  type PresentationMessage,
  reportOutputFailed,
  reportOutputPlacement,
  requestSeek,
  subscribeOutput,
} from "./channel.ts";
import { createIdleCursor } from "./idleCursor.ts";
import { OutputBoundary } from "./OutputBoundary.tsx";
import { OutputView } from "./OutputView.tsx";
import {
  type DetailedScreen,
  type PlacementReport,
  parseTarget,
  pickTarget,
  placementWasRefused,
  rememberPlacementRefused,
  reportPlacement,
} from "./placement.ts";
import { describeScreen } from "./screens.ts";

/** The Window Management API's shape, as far as the Output reads it. */
interface ScreenDetailsLike extends EventTarget {
  screens: readonly DetailedScreen[];
  currentScreen: DetailedScreen;
}
type WindowWithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetailsLike> };

/**
 * Board #11 — the chrome-less, audience-facing screen (SDD-0001 §16.1).
 * Mode 1: a continuous scroll through the whole hymn, the focus — a whole
 * part, or one line — brightened, everything else dimmed. No labels, no
 * controls, no part names, ever — those are Operator aids. The layout itself
 * is {@link OutputView}, shared with the Operator's Live pane.
 */
export function Output() {
  const [message, setMessage] = createSignal<Extract<OutputMessage, { type: "content" | "idle" }>>({
    type: "idle",
  });
  const content = createMemo(() => {
    const current = message();
    return current.type === "content" ? current : undefined;
  });
  // Blank holds apart from the content, which keeps arriving underneath, so
  // restoring shows wherever the operator has got to (SDD-0001 §16.5).
  const [blanked, setBlanked] = createSignal(false);
  // Dark until an Operator has said anything about the settings or the blank
  // state: a window opened (or reloaded) while blanked must never paint the
  // song first and fade it. Content that arrives first waits
  // dark; the replay (channel.ts) sends the states before it.
  const [stated, setStated] = createSignal(false);
  const [cues, setCues] = createSignal<OutputCues>({});
  const [reveal, setReveal] = createSignal(0);
  const [pinChorus, setPinChorus] = createSignal(false);
  const [wholeSong, setWholeSong] = createSignal(false);
  const [highlight, setHighlight] = createSignal<Highlight>("part");
  const [bandSize, setBandSize] = createSignal<BandSize>("part");
  // Hold (SDD-0001 §16.6): while held, content and settings are ignored,
  // and the window reports what it froze on, for a reloaded Operator.
  const [held, setHeld] = createSignal(false);
  let lastPresentation: PresentationMessage | undefined;
  // Theme and cues follow the Operator's Settings live (SDD-0001 §16.1).
  const receive = (next: OutputMessage) => {
    if (next.type === "close") {
      // End Live: the Operator asks the window to go (SDD-0001 §16.4).
      window.close();
      return;
    }
    if (next.type === "hold") {
      setStated(true);
      setHeld(next.held);
      return;
    }
    if (held() && (next.type === "content" || next.type === "idle" || next.type === "presentation"))
      return;
    if (next.type === "blank" || next.type === "presentation") setStated(true);
    if (next.type === "blank") setBlanked(next.blanked);
    else if (next.type === "reveal") setReveal((n) => n + 1);
    else if (next.type === "presentation") {
      lastPresentation = next;
      const root = document.documentElement;
      const current = root.getAttribute("data-output-theme");
      const apply = () => root.setAttribute("data-output-theme", next.theme);
      // The first theme is the Output's start, not a change.
      if (current && current !== next.theme) easeThemeChange(apply, ["data-output-theme", current]);
      else apply();
      setCues(next.cues);
      setPinChorus(next.pinChorus);
      setWholeSong(!!next.wholeSong);
      setHighlight(next.highlight ?? "part");
      setBandSize(next.bandSize);
    } else setMessage(next);
  };

  // Visible while the mouse moves, hidden once still (idleCursor.ts).
  const cursorVisible = createIdleCursor();

  // Placed on a screen by the Operator (ADR-0028): fullscreen there. A
  // browser may refuse without a gesture in this window, so the first click
  // or F key goes fullscreen instead, and neither reaches the Operator.
  const placed = new URLSearchParams(window.location.search).has("placed");
  const [wantsFullscreen, setWantsFullscreen] = createSignal(false);
  // A Wayland compositor ignores where a client puts its own window, so the
  // window position proves nothing and a bare fullscreen lands on whatever
  // screen it is on. The Output therefore finds the Operator's screen itself
  // (the permission is per origin) and asks for fullscreen on that screen.
  const target = placed ? parseTarget(window.location.search) : undefined;
  let details: ScreenDetailsLike | undefined;
  let picked: DetailedScreen | undefined;
  let fullscreenOnPicked = false;
  // A fresh getScreenDetails() read: on Wayland the cached object's
  // currentScreen can stay stale after the compositor moves the window.
  let freshScreen: DetailedScreen | undefined;
  // Without a target there is nothing to look up: ready at once, so a click
  // goes fullscreen synchronously, while its activation is surely live.
  let detailsDone = !target;
  // The browser refused fullscreen without a gesture.
  const [refused, setRefused] = createSignal(false);
  // The system cannot put a window on another screen by fullscreen (Chromium
  // on GNOME Wayland): remembered for the session, so the next window skips
  // the attempt and goes straight to asking the person to move it.
  const [placementFailed, setPlacementFailed] = createSignal(placementWasRefused());
  const [onTarget, setOnTarget] = createSignal(false);
  const placementNow = (): PlacementReport => {
    const base = reportPlacement({
      target,
      picked,
      currentScreen: freshScreen ?? details?.currentScreen,
      fullscreen: !!document.fullscreenElement,
      fullscreenOnPicked,
    });
    return {
      ...base,
      ...(placementFailed() ? { refused: true } : {}),
      // The person's own fullscreen where the screen cannot be confirmed:
      // the Operator says so rather than "on the projector".
      ...(placementFailed() && base.fullscreen && !base.onTarget ? { unconfirmed: true } : {}),
    };
  };
  const refreshScreen = async () => {
    if (!target) return;
    try {
      const fresh = await (window as WindowWithScreens).getScreenDetails?.();
      if (fresh?.currentScreen) freshScreen = fresh.currentScreen;
    } catch {}
    report();
  };
  const report = () => {
    if (!target) return;
    const now = placementNow();
    // Fullscreen that was asked for on the target but is on another screen:
    // placement failed. Leave it at once, so the main screen is not taken over.
    if (now.fullscreen && fullscreenOnPicked && details?.currentScreen && !now.onTarget) {
      fullscreenOnPicked = false;
      setPlacementFailed(true);
      rememberPlacementRefused();
      setWantsFullscreen(true);
      void Promise.resolve(document.exitFullscreen?.()).catch(() => {});
    }
    const next = placementNow();
    setOnTarget(next.onTarget);
    reportOutputPlacement(next);
  };
  const detailsReady: Promise<void> = target
    ? (async () => {
        try {
          details = await (window as WindowWithScreens).getScreenDetails?.();
          if (!details) return;
          const live = details;
          picked = pickTarget(live.screens, target);
          live.addEventListener("screenschange", () => {
            picked = pickTarget(live.screens, target);
            report();
          });
          live.addEventListener("currentscreenchange", () => {
            // The event is newer than any earlier fresh read.
            freshScreen = undefined;
            report();
          });
        } catch {
          // No permission or no API: today's behaviour, and never "verified".
        } finally {
          detailsDone = true;
          report();
        }
      })()
    : Promise.resolve();
  const requestNow = async () => {
    const root = document.documentElement;
    if (!root.requestFullscreen) return;
    // Once placement has failed, a bare request fills the screen the window
    // is on. The person's F or click is never gated on currentScreen, which
    // Wayland does not keep current when the compositor moves the window.
    const chosen = placementFailed() ? undefined : picked;
    try {
      await (chosen
        ? root.requestFullscreen({ screen: chosen } as FullscreenOptions)
        : root.requestFullscreen());
      fullscreenOnPicked = !!chosen;
      setRefused(false);
      setWantsFullscreen(false);
    } catch {
      setRefused(true);
      setWantsFullscreen(true);
    }
    // An earlier fresh read predates this request.
    freshScreen = undefined;
    report();
    await refreshScreen();
  };
  const goFullscreen = (): Promise<void> | undefined => {
    if (detailsDone) return requestNow();
    return detailsReady.then(requestNow);
  };
  onMount(() => {
    if (!placed || document.fullscreenElement) return;
    if (!document.documentElement.requestFullscreen) return;
    setWantsFullscreen(true);
    if (placementFailed()) {
      // No futile attempt: wait for the screens, then say how to move.
      return;
    }
    void goFullscreen();
  });
  const onFullscreenChange = () => {
    // Leaving fullscreen (a move to another screen) re-arms the click and F.
    if (!document.fullscreenElement) fullscreenOnPicked = false;
    setWantsFullscreen(placed && !document.fullscreenElement);
    freshScreen = undefined;
    report();
    void refreshScreen();
  };
  // A Wayland move fires resize or visibility changes, not currentscreenchange.
  const onMoved = () => void refreshScreen();
  const onFirstClick = (event: MouseEvent) => {
    if (!wantsFullscreen()) return;
    event.stopPropagation();
    void goFullscreen();
  };
  onMount(() => {
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("click", onFirstClick, true);
    if (target) {
      window.addEventListener("resize", onMoved);
      document.addEventListener("visibilitychange", onMoved);
    }
  });
  onCleanup(() => {
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    window.removeEventListener("click", onFirstClick, true);
    window.removeEventListener("resize", onMoved);
    document.removeEventListener("visibilitychange", onMoved);
  });

  // Keys pressed here act as in the Operator (SDD-0001 §16.1): with the
  // Output fullscreen on the projector, a clicker's keys often land in this
  // window. Only the keys that act on the presentation are forwarded (the keymap's
  // "presentation" scope), with whether it is auto-repeating (R and U ignore a
  // held key), rather than scrolling the view; the Operator's own keys (N, L, O)
  // and chords stay here.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const isF = event.key === "f" || event.key === "F";
    // F toggles: fullscreen, it does what Esc does and leaves it.
    if (isF && document.fullscreenElement) {
      event.preventDefault();
      void document.exitFullscreen?.().catch(() => {});
      return;
    }
    if (wantsFullscreen() && isF) {
      event.preventDefault();
      void goFullscreen();
      return;
    }
    if (!isPresentationKey(event.key, event.shiftKey)) return;
    event.preventDefault();
    forwardKey({ key: event.key, shiftKey: event.shiftKey, repeat: event.repeat });
  };
  onMount(() => window.addEventListener("keydown", onKeyDown));
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  onMount(() => {
    const unsubscribe = subscribeOutput(
      receive,
      () =>
        stated()
          ? {
              blanked: blanked(),
              ...(held()
                ? {
                    held: {
                      ...(content() ? { content: content() } : {}),
                      ...(lastPresentation ? { presentation: lastPresentation } : {}),
                    },
                  }
                : {}),
            }
          : undefined,
      () => (target && detailsDone ? placementNow() : undefined),
    );
    onCleanup(unsubscribe);
  });

  return (
    <>
      <Show when={wantsFullscreen() && (placementFailed() || refused()) && target}>
        {(wanted) => {
          // The instruction in full is the Operator's notice; here a short
          // one, behind an icon the audience does not notice (ADR-0028).
          const hint = () =>
            placementFailed()
              ? onTarget()
                ? "Press F or click to fill this screen"
                : `Move this window to ${describeScreen(wanted())}, then press F`
              : `Press F or click to fill ${describeScreen(wanted())}`;
          return (
            <div class="output-hint" classList={{ "output-hint-awake": cursorVisible() }}>
              <button
                type="button"
                class="output-hint-icon"
                aria-label="How to place this window"
                aria-describedby="output-hint-tip"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9.5" />
                  <path d="M12 11v6M12 7.2v.1" />
                </svg>
              </button>
              <p id="output-hint-tip" class="output-hint-tip" role="tooltip">
                {hint()}
              </p>
            </div>
          );
        }}
      </Show>
      <OutputBoundary onFailed={reportOutputFailed}>
        <Show
          when={content()}
          fallback={<div class="output-idle" classList={{ "output-cursor": cursorVisible() }} />}
        >
          {(current) => (
            <OutputView
              message={current()}
              variant="full"
              blanked={blanked() || !stated()}
              cues={cues()}
              reveal={reveal()}
              pinChorus={pinChorus()}
              wholeSong={wholeSong()}
              highlight={highlight()}
              bandSize={bandSize()}
              onSeek={(line, whole) =>
                requestSeek({
                  hymnbookId: current().hymnbookId,
                  number: current().number,
                  line,
                  whole,
                })
              }
              classList={{ "output-cursor": cursorVisible() }}
            />
          )}
        </Show>
      </OutputBoundary>
    </>
  );
}
