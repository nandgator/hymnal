import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import { type OutputMessage, subscribeOutput } from "./channel.ts";
import { OutputView } from "./OutputView.tsx";

const CURSOR_IDLE_MS = 2000;

/**
 * Board #11 — the chrome-less, audience-facing screen (SDD-0001 §16.1).
 * Mode 1: a continuous scroll through the whole hymn, the focus — a whole
 * part, or one line — brightened, everything else dimmed. No labels, no
 * controls, no part names, ever — those are Operator aids. The layout itself
 * is {@link OutputView}, shared with the Operator's Live pane.
 */
export function Output() {
  const [message, setMessage] = createSignal<Exclude<OutputMessage, { type: "blank" }>>({
    type: "idle",
  });
  const content = createMemo(() => {
    const current = message();
    return current.type === "content" ? current : undefined;
  });
  // Blank holds apart from the content, which keeps arriving underneath, so
  // restoring shows wherever the operator has got to (SDD-0001 §16.5).
  const [blanked, setBlanked] = createSignal(false);
  const receive = (next: OutputMessage) => {
    if (next.type === "blank") setBlanked(next.blanked);
    else setMessage(next);
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
          classList={{ "output-cursor": cursorVisible() }}
        />
      )}
    </Show>
  );
}
