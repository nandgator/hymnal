import { createEffect, createMemo, createSignal, Index, onCleanup, onMount } from "solid-js";
import type { LineRange } from "../domain/sequence-engine.ts";
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
/** How long scrolling must pause to count as having come to rest. */
const SEEK_REST_MS = 200;

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
  /** Scroll sync (SDD-0001 §16.1): called once a person's scroll comes to
   * rest, with the flattened line at the reading band's centre and whether
   * the focus was a whole part. The full view only; Live never seeks. */
  onSeek?: (line: number, whole: boolean) => void;
  /** The reading band's height while scrolling by hand: the part the focus
   * is in (the default), or one line. A future shortcut may switch it
   * (PLAN Board #20). */
  bandSize?: "part" | "line";
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

  // Scroll sync (SDD-0001 §16.1). A person's gesture arms a seek, sent once
  // scrolling rests. While they scroll, the highlight is a reading band
  // fixed to the viewport where the focus's part sat, one part tall by
  // default (or one line): lines light as they pass through it, whatever
  // part they're in, so nothing jumps as a trackpad glides. Any positioning by the view itself ends the
  // band and disarms the seek, so its own re-centring never echoes back.
  let armed = false;
  let restTimer: ReturnType<typeof setTimeout> | undefined;
  let driftTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearTimeout(restTimer);
    clearTimeout(driftTimer);
  });

  /** The band, in px from the top of the viewport; null when not scrolling. */
  let band: { top: number; bottom: number; whole: boolean } | null = null;
  /** The lines lit by the band; null means the focus is lit. */
  const [bandLit, setBandLit] = createSignal<LineRange | null>(null);
  const lit = () => bandLit() ?? props.message.focus;

  const startBand = () => {
    if (band || !view) return;
    const { focus } = props.message;
    const whole = (props.bandSize ?? "part") === "part";
    // Part-sized: the whole part the focus is in, even under line focus.
    const part = blocks().find((block) => focus.start >= block.start && focus.start < block.end);
    const { start, end } = whole && part ? part : { start: focus.start, end: focus.start + 1 };
    const first = lineRefs[start];
    if (!first) return;
    const height = view.clientHeight;
    const top = Math.max(height * SAFE, first.offsetTop - view.scrollTop);
    const bottom = Math.min(height * (1 - SAFE), top + heightOf(start, end));
    band = { top, bottom, whole };
  };

  const centreOf = (line: HTMLLIElement) =>
    line.offsetTop + line.offsetHeight / 2 - (view?.scrollTop ?? 0);

  // The lines whose centres sit inside the band — or, if it's thinner than
  // a line, the one nearest its centre.
  const updateBand = () => {
    if (!band) return;
    const { top, bottom } = band;
    const inside = lineRefs.flatMap((line, i) =>
      line && centreOf(line) >= top && centreOf(line) <= bottom ? [i] : [],
    );
    const nearest = lineNearest((top + bottom) / 2);
    if (inside.length) setBandLit({ start: inside[0], end: inside[inside.length - 1] + 1 });
    else if (nearest !== undefined) setBandLit({ start: nearest, end: nearest + 1 });
  };

  const lineNearest = (y: number): number | undefined => {
    let nearest: number | undefined;
    let best = Number.POSITIVE_INFINITY;
    lineRefs.forEach((line, i) => {
      if (!line) return;
      const distance = Math.abs(centreOf(line) - y);
      if (distance < best) {
        best = distance;
        nearest = i;
      }
    });
    return nearest;
  };

  const endBand = () => {
    band = null;
    setBandLit(null);
  };

  const position = (behavior: ScrollBehavior) => {
    armed = false;
    clearTimeout(restTimer);
    clearTimeout(driftTimer);
    endBand();
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

  // Drift back: a hand-scroll (wheel, touch or pointer over the audience
  // screen) is followed by a return to the focus, unless a new message
  // re-positions the view first — the Operator accepting a seek, or any
  // step. So the audience is never left on empty screen, with sync off or
  // the Operator gone. Programmatic scrolls don't fire these events. Keys
  // don't scroll the Output: the window forwards them to the Operator.
  const onHandScroll = () => {
    armed = !!props.onSeek;
    if (armed) startBand();
    clearTimeout(driftTimer);
    driftTimer = setTimeout(() => position("smooth"), DRIFT_BACK_MS);
  };
  const onScroll = () => {
    if (!armed) return;
    updateBand();
    clearTimeout(restTimer);
    restTimer = setTimeout(() => {
      armed = false;
      if (!band) return;
      const line = lineNearest((band.top + band.bottom) / 2);
      if (line !== undefined) props.onSeek?.(line, band.whole);
    }, SEEK_REST_MS);
  };

  onMount(() => {
    const events = ["wheel", "touchmove", "pointerdown"] as const;
    for (const type of events) view?.addEventListener(type, onHandScroll, { passive: true });
    view?.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => {
      for (const type of events) view?.removeEventListener(type, onHandScroll);
      view?.removeEventListener("scroll", onScroll);
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
                "output-line-current": i >= lit().start && i < lit().end,
                // Parts are set apart by a gap, as in a printed hymnal.
                "output-part-start": line().isPartStart && i > 0,
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
