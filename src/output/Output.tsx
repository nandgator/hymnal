import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { BandSize, Highlight, OutputCues } from "../persistence/user-state.ts";
import { easeThemeChange } from "../shell/theme.ts";
import {
  forwardKey,
  type OutputMessage,
  reportOutputPlacement,
  requestSeek,
  subscribeOutput,
} from "./channel.ts";
import { OutputView } from "./OutputView.tsx";
import { type DetailedScreen, parseTarget, pickTarget, reportPlacement } from "./placement.ts";
import { describeScreen } from "./screens.ts";

/** The Window Management API's shape, as far as the Output reads it. */
interface ScreenDetailsLike extends EventTarget {
  screens: readonly DetailedScreen[];
  currentScreen: DetailedScreen;
}
type WindowWithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetailsLike> };

const CURSOR_IDLE_MS = 2000;
/** Named keys forwarded to the Operator, besides every printable one. */
const FORWARDED_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

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
  const [partLabels, setPartLabels] = createSignal(true);
  const [highlight, setHighlight] = createSignal<Highlight>("part");
  const [bandSize, setBandSize] = createSignal<BandSize>("part");
  // Theme and cues follow the Operator's Settings live (SDD-0001 §16.1).
  const receive = (next: OutputMessage) => {
    if (next.type === "close") {
      // End Live: the Operator asks the window to go (SDD-0001 §16.4).
      window.close();
      return;
    }
    if (next.type === "blank" || next.type === "presentation") setStated(true);
    if (next.type === "blank") setBlanked(next.blanked);
    else if (next.type === "reveal") setReveal((n) => n + 1);
    else if (next.type === "presentation") {
      const root = document.documentElement;
      const current = root.getAttribute("data-output-theme");
      const apply = () => root.setAttribute("data-output-theme", next.theme);
      // The first theme is the Output's start, not a change.
      if (current && current !== next.theme) easeThemeChange(apply, ["data-output-theme", current]);
      else apply();
      setCues(next.cues);
      setPinChorus(next.pinChorus);
      setWholeSong(!!next.wholeSong);
      setPartLabels(next.partLabels ?? true);
      setHighlight(next.highlight ?? "part");
      setBandSize(next.bandSize);
    } else setMessage(next);
  };

  // Visible while the mouse moves, so the operator can position and
  // fullscreen the window; hidden once still, so it never sits parked
  // over the projected lyrics.
  const [cursorVisible, setCursorVisible] = createSignal(false);
  let cursorTimer: ReturnType<typeof setTimeout> | undefined;
  const onMouseMove = () => {
    setCursorVisible(true);
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => setCursorVisible(false), CURSOR_IDLE_MS);
  };
  onMount(() => window.addEventListener("mousemove", onMouseMove));
  onCleanup(() => {
    window.removeEventListener("mousemove", onMouseMove);
    clearTimeout(cursorTimer);
  });

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
  // Without a target there is nothing to look up: ready at once, so a click
  // goes fullscreen synchronously, while its activation is surely live.
  let detailsDone = !target;
  const [refused, setRefused] = createSignal(false);
  const report = () => {
    if (!target) return;
    reportOutputPlacement(placementNow());
  };
  const placementNow = () =>
    reportPlacement({
      target,
      picked,
      currentScreen: details?.currentScreen,
      fullscreen: !!document.fullscreenElement,
      fullscreenOnPicked,
    });
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
          live.addEventListener("currentscreenchange", report);
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
    const chosen = picked;
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
    report();
  };
  const goFullscreen = (): Promise<void> | undefined => {
    if (detailsDone) return requestNow();
    return detailsReady.then(requestNow);
  };
  onMount(() => {
    if (!placed || document.fullscreenElement) return;
    if (!document.documentElement.requestFullscreen) return;
    setWantsFullscreen(true);
    void goFullscreen();
  });
  const onFullscreenChange = () => {
    // Leaving fullscreen (a move to another screen) re-arms the click and F.
    if (!document.fullscreenElement) fullscreenOnPicked = false;
    setWantsFullscreen(placed && !document.fullscreenElement);
    report();
  };
  const onFirstClick = (event: MouseEvent) => {
    if (!wantsFullscreen()) return;
    event.stopPropagation();
    void goFullscreen();
  };
  onMount(() => {
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("click", onFirstClick, true);
  });
  onCleanup(() => {
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    window.removeEventListener("click", onFirstClick, true);
  });

  // Keys pressed here act as in the Operator (SDD-0001 §16.1): with the
  // Output fullscreen on the projector, a clicker's keys often land in this
  // window. Every plain key is forwarded, with whether it is auto-repeating (R and
  // U ignore a held key), rather than scrolling the view;
  // chords stay the browser's.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (wantsFullscreen() && (event.key === "f" || event.key === "F")) {
      event.preventDefault();
      void goFullscreen();
      return;
    }
    if (event.key.length !== 1 && !FORWARDED_KEYS.has(event.key)) return;
    event.preventDefault();
    forwardKey({ key: event.key, shiftKey: event.shiftKey, repeat: event.repeat });
  };
  onMount(() => window.addEventListener("keydown", onKeyDown));
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  onMount(() => {
    const unsubscribe = subscribeOutput(
      receive,
      () => (stated() ? { blanked: blanked() } : undefined),
      () => (target && detailsDone ? placementNow() : undefined),
    );
    onCleanup(unsubscribe);
  });

  return (
    <>
      <Show when={wantsFullscreen() && refused() && target}>
        {(wanted) => (
          <div class="output-prompt" role="status">
            Click here or press F to fill {describeScreen(wanted())}
          </div>
        )}
      </Show>
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
            partLabels={partLabels()}
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
    </>
  );
}
