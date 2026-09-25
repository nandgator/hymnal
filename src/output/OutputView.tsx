import { createEffect, createMemo, Index, onCleanup, onMount } from "solid-js";
import type { OutputMessage } from "./channel.ts";

type ContentMessage = Extract<OutputMessage, { type: "content" }>;

/** Share of the height kept clear at top and bottom — the safe margin. */
const SAFE = 0.1;
/** Where the focus centres, from the top: a little above middle, a
 * teleprompter's eyeline (DESIGN.md § Structure). */
const EYELINE = 0.42;
/** The smallest the type may shrink to make a hymn's longest part fit. */
const FIT_FLOOR = 0.45;
/** How long after a manual scroll stops before the view returns to the
 * focus (SDD-0001 §16.1, drift back). */
const DRIFT_BACK_MS = 1500;

export interface OutputViewProps {
  message: ContentMessage;
  /** "full": the audience screen. "mini": the Operator's Live pane — the
   * same view, scaled to its box. */
  variant: "full" | "mini";
  /** Blanked (SDD-0001 §16.5): the text fades out, still laid out and
   * positioned underneath, so restoring is instant and in place. */
  blanked?: boolean;
  /** Extra classes on the scroll container (e.g. the Output's cursor). */
  classList?: Record<string, boolean>;
}

/**
 * The Output's layout, shared by the audience screen and the Operator's Live
 * pane so the two can't disagree (DESIGN.md § Structure). Sizes are
 * container units, so the mini view is an exact scale model.
 *
 * - **Fit, per hymn.** The type is sized so the hymn's longest part fits
 *   inside the safe margin, then held for the whole hymn — it never changes
 *   size between parts. Re-fitted on resize and font load; never below
 *   {@link FIT_FLOOR}.
 * - **Position.** The focus (a part or a line) centres on the eyeline,
 *   clamped inside the safe margin. A focus taller than the margin (only
 *   past the floor) starts at the top margin instead.
 * - **Motion.** Native smooth scroll: distance and duration scale together,
 *   so a line step and a part jump both feel proportional. A new hymn snaps.
 *
 * `<Index>`, not `<For>`: the flattened lines are a fresh array on every
 * navigation, so `<Index>` keeps the DOM (and each line's ref) stable by
 * position instead of remounting the list on every keypress, which would
 * fight the smooth scroll.
 */
export function OutputView(props: OutputViewProps) {
  let view: HTMLDivElement | undefined;
  const lineRefs: (HTMLLIElement | undefined)[] = [];
  let lastHymnKey: string | undefined;

  // Each occurrence's line range — the blocks the fit must make room for.
  const blocks = createMemo(() => {
    const starts = props.message.lines.flatMap((line, i) => (line.isPartStart ? [i] : []));
    return starts.map((start, k) => ({
      start,
      end: starts[k + 1] ?? props.message.lines.length,
    }));
  });

  const heightOf = (start: number, end: number) => {
    const first = lineRefs[start];
    const last = lineRefs[end - 1];
    if (!first || !last) return 0;
    return last.offsetTop + last.offsetHeight - first.offsetTop;
  };

  const position = (behavior: ScrollBehavior) => {
    const { start, end } = props.message.focus;
    const first = lineRefs[start];
    if (!view || !first) return;
    const height = view.clientHeight;
    const block = heightOf(start, end);
    const room = height * (1 - 2 * SAFE);
    // Where the block's top should sit within the screen.
    const top =
      block > room
        ? height * SAFE
        : Math.max(
            height * SAFE,
            Math.min(height * EYELINE - block / 2, height * (1 - SAFE) - block),
          );
    view.scrollTo?.({ top: first.offsetTop - top, behavior });
  };

  // Shrinks the type until the hymn's tallest part fits the safe area.
  // Wrapping changes as the type shrinks, so it converges in a few passes.
  const refit = () => {
    if (!view) return;
    const room = view.clientHeight * (1 - 2 * SAFE);
    let fit = 1;
    view.style.setProperty("--fit", "1");
    for (let pass = 0; pass < 4 && room > 0; pass++) {
      const tallest = Math.max(0, ...blocks().map((b) => heightOf(b.start, b.end)));
      if (tallest <= room || fit === FIT_FLOOR) break;
      fit = Math.max(FIT_FLOOR, fit * (room / tallest) * 0.98);
      view.style.setProperty("--fit", String(fit));
    }
    position("instant");
  };

  createEffect(() => {
    const { hymnbookId, number } = props.message;
    props.message.focus;
    const hymnKey = `${hymnbookId}:${number}`;
    if (hymnKey !== lastHymnKey) {
      lastHymnKey = hymnKey;
      refit();
    } else {
      position("smooth");
    }
  });

  // Drift back: a hand-scroll (wheel, touch or keys over the audience
  // screen) is followed, once it stops, by a return to the focus — the
  // audience is never left on empty screen. Programmatic scrolls don't fire
  // these events, so the view's own re-centring never triggers it.
  let driftTimer: ReturnType<typeof setTimeout> | undefined;
  const onHandScroll = () => {
    clearTimeout(driftTimer);
    driftTimer = setTimeout(() => position("smooth"), DRIFT_BACK_MS);
  };
  onCleanup(() => clearTimeout(driftTimer));

  onMount(() => {
    const events = ["wheel", "touchmove", "keydown"] as const;
    for (const type of events) view?.addEventListener(type, onHandScroll, { passive: true });
    onCleanup(() => {
      for (const type of events) view?.removeEventListener(type, onHandScroll);
    });
  });

  onMount(() => {
    void document.fonts?.ready.then(refit);
    if (typeof ResizeObserver !== "function" || !view) return;
    const observer = new ResizeObserver(() => refit());
    observer.observe(view);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      ref={view}
      class={`output-view output-view-${props.variant}`}
      classList={{ ...props.classList, "output-blanked": !!props.blanked }}
      // The mini view is a picture of the Output; the full one is the Output.
      {...(props.variant === "mini" ? { role: "img", "aria-label": "Live output preview" } : {})}
    >
      <ul class="output-list">
        <li class="output-spacer" aria-hidden="true" />
        <Index each={props.message.lines}>
          {(line, i) => (
            <li
              ref={(el) => {
                lineRefs[i] = el;
              }}
              class="output-line"
              classList={{
                "output-line-current":
                  i >= props.message.focus.start && i < props.message.focus.end,
              }}
            >
              {line().text}
            </li>
          )}
        </Index>
        <li class="output-spacer" aria-hidden="true" />
      </ul>
    </div>
  );
}
