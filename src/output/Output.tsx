import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { BandSize, Highlight, OutputCues } from "../persistence/user-state.ts";
import { easeThemeChange } from "../shell/theme.ts";
import { forwardKey, type OutputMessage, requestSeek, subscribeOutput } from "./channel.ts";
import { OutputView } from "./OutputView.tsx";

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
  const [cues, setCues] = createSignal<OutputCues>({});
  const [reveal, setReveal] = createSignal(0);
  const [pinChorus, setPinChorus] = createSignal(false);
  const [wholeSong, setWholeSong] = createSignal(false);
  const [highlight, setHighlight] = createSignal<Highlight>("part");
  const [bandSize, setBandSize] = createSignal<BandSize>("part");
  // Theme and cues follow the Operator's Settings live (SDD-0001 §16.1).
  const receive = (next: OutputMessage) => {
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

  // Keys pressed here act as in the Operator (SDD-0001 §16.1): with the
  // Output fullscreen on the projector, a clicker's keys often land in this
  // window. Every plain key is forwarded, with whether it is auto-repeating (R and
  // U ignore a held key), rather than scrolling the view;
  // chords stay the browser's.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length !== 1 && !FORWARDED_KEYS.has(event.key)) return;
    event.preventDefault();
    forwardKey({ key: event.key, shiftKey: event.shiftKey, repeat: event.repeat });
  };
  onMount(() => window.addEventListener("keydown", onKeyDown));
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  onMount(() => {
    const unsubscribe = subscribeOutput(receive);
    onCleanup(unsubscribe);
  });

  return (
    <Show
      when={content()}
      fallback={<div class="output-idle" classList={{ "output-cursor": cursorVisible() }} />}
    >
      {(current) => (
        <OutputView
          message={current()}
          variant="full"
          blanked={blanked()}
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
  );
}
