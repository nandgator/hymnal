import { createEffect, createMemo, createSignal, Index, onCleanup, onMount, Show } from "solid-js";
import { type OutputMessage, subscribeOutput } from "./channel.ts";

/**
 * Board #11 — the chrome-less, audience-facing screen (SDD-0001 §16.1).
 * Mode 1: a continuous scroll through the whole hymn, the focus — a whole
 * part, or one line — brightened, everything else dimmed. No labels, no controls, no part
 * names, ever — those are Operator aids.
 *
 * Scrolling is native (`scrollTo({ behavior: "smooth" })` on a real
 * `overflow-y` container), not a hand-rolled transform: browsers scroll
 * "smooth" at roughly constant velocity, so distance and duration scale
 * together automatically — a one-line step and a whole-part jump both feel
 * proportional, without reimplementing scroll physics by hand.
 *
 * `<Index>`, not `<For>`: the flattened line list is a fresh array (new
 * object identity) on every single navigation, even when its actual
 * content is unchanged — only `focus` usually moves. `<Index>`
 * reconciles by position, so the DOM (and each line's own ref) stays
 * stable across ordinary navigation instead of the whole list unmounting
 * and remounting on every keypress, which would fight the smooth-scroll
 * animation.
 */
export function Output() {
  const [message, setMessage] = createSignal<OutputMessage>({ type: "idle" });
  const content = createMemo(() => {
    const current = message();
    return current.type === "content" ? current : undefined;
  });

  const lineRefs: (HTMLLIElement | undefined)[] = [];
  let lastHymnKey: string | undefined;

  onMount(() => {
    const unsubscribe = subscribeOutput(setMessage);
    onCleanup(unsubscribe);
  });

  createEffect(() => {
    const current = content();
    if (!current) return;
    const hymnKey = `${current.hymnbookId}:${current.number}`;
    const isNewHymn = hymnKey !== lastHymnKey;
    lastHymnKey = hymnKey;
    // Centre the focus block itself — unless it's taller than the screen,
    // in which case its first line matters more than symmetry.
    const first = lineRefs[current.focus.start];
    const last = lineRefs[current.focus.end - 1];
    const container = first?.parentElement;
    if (!first || !last || !container) return;
    const top = first.offsetTop;
    const bottom = last.offsetTop + last.offsetHeight;
    const fits = bottom - top <= container.clientHeight;
    container.scrollTo({
      top: fits ? (top + bottom - container.clientHeight) / 2 : top,
      behavior: isNewHymn ? "instant" : "smooth",
    });
  });

  return (
    <Show when={content()} fallback={<div class="output-idle" />}>
      {(current) => (
        <ul class="output-scroll">
          <li class="output-spacer" aria-hidden="true" />
          <Index each={current().lines}>
            {(line, i) => (
              <li
                ref={(el) => {
                  lineRefs[i] = el;
                }}
                class="output-line"
                classList={{
                  "output-line-current": i >= current().focus.start && i < current().focus.end,
                }}
              >
                {line().text}
              </li>
            )}
          </Index>
          <li class="output-spacer" aria-hidden="true" />
        </ul>
      )}
    </Show>
  );
}
