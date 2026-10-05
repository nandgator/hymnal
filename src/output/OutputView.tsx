import {
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  Index,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { LineRange } from "../domain/sequence-engine.ts";
import type { BandSize, Highlight, OutputCues } from "../persistence/user-state.ts";
import type { OutputMessage } from "./channel.ts";
import { FullSong, prepareFullSong, sungOf } from "./FullSong.tsx";
import { signature } from "./fullSongText.ts";
import { placeMarker } from "./inkEdge.ts";
import { cancelSwap, swapLayouts } from "./layoutSwap.ts";

type ContentMessage = Extract<OutputMessage, { type: "content" }>;
/** How a hymn lays out (SDD-0001 §16.1). */
type Layout = "flow" | "band" | "side";

/** Wider than tall, a square counting as wide (as the Output reports it to
 * Live, channel.ts); an unlaid-out view is neither. */
const isLandscape = (el: HTMLElement) => el.clientWidth > 0 && el.clientWidth >= el.clientHeight;

/** The band kept clear at top and bottom, as a share of the height: room for
 * the details (the caption at the bottom, the number badge at the top), a
 * still band which lit lines never enter, so its fade only dims lines not
 * being sung. Always reserved, whatever shows in it, in both layouts: a
 * detail turning on or off moves no lyric (DESIGN.md § Typography). */
const BAND = 0.16;
/** With cues set to fade: how long each shows after it last changed. */
const CUE_FADE_MS = 8000;
/** Where the focus centres, from the top: a little above middle, a
 * teleprompter's eyeline (DESIGN.md § Structure). */
const EYELINE = 0.42;
/** The scroll's type is this share of 7.5cqmin (styles.css, `--scroll-type`):
 * its fixed bands take 32% of the height, where they took 20%, so the type
 * is 0.85 of what it was and the same lines fit. The two constants below keep
 * their size on screen (0.45 and 0.7 of the old full size) in this scale. */
const SCROLL_TYPE = 0.85;
/** The smallest the type may shrink to make a hymn's longest part fit. */
const FIT_FLOOR = 0.45 / SCROLL_TYPE;
/** The chorus pins only if the type stays at least this fit — 70% of the
 * full size, 5.25% of the screen's shorter side — the same for every hymn
 * and resolution: what the back row needs is the type's share of the
 * screen, not its share of a hymn's own flowing size (SDD-0001 §16.1). */
const PIN_MIN_FIT = 0.7 / SCROLL_TYPE;
/** Where the focus centres within the verse column above a pinned chorus,
 * as a share of the column: the flowing eyeline's place within its margins. */
const PINNED_EYELINE = (EYELINE - BAND) / (1 - 2 * BAND);
/** The space between the verse column and a pinned chorus, in lines: a
 * fade to still ground that lit lines never enter. */
const PIN_GAP_LINES = 1;
/** How long after a manual scroll stops (its last wheel, touch or press, or
 * the last scroll its momentum carries on with) before the view returns to
 * the focus (SDD-0001 §16.1, drift back). */
const DRIFT_BACK_MS = 1000;
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
   * is in (the default), or one line — the Operator's Workspace
   * preference, sent in the presentation message. */
  bandSize?: BandSize;
  /** Which cues the caption shows; none by default (DESIGN.md). */
  cues?: OutputCues;
  /** Bumped to show faded cues again for their fade time. */
  reveal?: number;
  /** Pin the chorus in a band at the foot, where it fits (SDD-0001
   * §16.1). Off, or where it doesn't fit, the Output flows as ever. */
  pinChorus?: boolean;
  /** The whole song at once in columns, on a landscape view (SDD-0005):
   * nothing scrolls, and the chorus does not pin. A portrait view, or a
   * message without the song's parts, scrolls as ever. */
  wholeSong?: boolean;
  /** The view's shape where its own box does not say it (Live is always
   * 16:9): the Output window's. Unset, the view's own. */
  landscape?: boolean;
  /** What is lit: the current part (the default), or every line, in either
   * layout (SDD-0005 § 5). */
  highlight?: Highlight;
}

/** The cue caption, e.g. "Hymnbook · Amazing Grace · ×2": only the cues
 * switched on, ×N only on a repeat. Empty with none on. The number is its own
 * badge, and the part its own marker over the song, not part of it. */
export function cueCaption(message: ContentMessage, cues: OutputCues = {}): string {
  return [
    cues.hymnbook && message.hymnbookTitle,
    cues.title && message.title,
    cues.repeat && (message.repeat ?? 1) > 1 && `×${message.repeat}`,
  ]
    .filter(Boolean)
    .join(" · ");
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
  /** How this hymn lays out, decided at each fit (SDD-0001 §16.1): flowing,
   * or its chorus pinned in a band at the foot or beside the verses. Layout
   * reads the plain variable, applied to the DOM at once (classes on the
   * view): the fit measures and positions within one effect, before a signal
   * would reach the DOM. The signal only renders the chorus's pane. */
  let layoutNow: Layout = "flow";
  /** The pinned chorus's height, px, measured at its layout's width. */
  let chorusPx = 0;
  const [layout, setLayout] = createSignal<Layout>("flow");
  const setLayoutNow = (next: Layout) => {
    layoutNow = next;
    view?.classList.toggle("output-pinned-mode", next !== "flow");
    view?.classList.toggle("output-side-mode", next === "side");
    setLayout(next);
  };
  const pinnedNow = () => layoutNow !== "flow";
  const lineRefs: (HTMLLIElement | undefined)[] = [];
  // Full Song (SDD-0005): the whole song at once, on a landscape view. The
  // scroll's list stays in place, hidden, so its refs and fit are as ever.
  const [landscape, setLandscape] = createSignal(false);
  const lightAll = () => props.highlight === "song";
  const fullSong = createMemo(
    () => !!props.wholeSong && (props.landscape ?? landscape()) && !!props.message.parts?.length,
  );
  let lastHymnKey: string | undefined;
  // Switching between the two layouts is a soft zoom over a fading copy of the
  // old one (layoutSwap.ts); computed, so the copy is taken before the DOM
  // changes.
  // Only for a change the operator made, the setting turned on or off, that
  // really changes the layout: not for the view first learning its shape, a
  // late word of the Output window's shape, or a song that has no parts.
  let shapeKnown = false;
  let wasWhole = !!props.wholeSong;
  let wasFull = fullSong();
  createComputed(() => {
    const whole = !!props.wholeSong;
    const full = fullSong();
    const flipped = whole !== wasWhole;
    const changed = full !== wasFull;
    wasWhole = whole;
    wasFull = full;
    if (flipped && changed && shapeKnown && view && !props.blanked) swapLayouts(view);
  });
  // The whole song and a pinned chorus are never drawn together: the fit that
  // pins is skipped while Full Song shows, so a layout pinned before it came
  // on is dropped here, before the DOM changes (the refit on leaving makes it
  // again).
  createComputed(() => {
    if (fullSong() && layoutNow !== "flow") setLayoutNow("flow");
  });
  // A dark Output shows no lyric, so no copy of one lingers; nor after it goes.
  createEffect(() => {
    if (props.blanked && view) cancelSwap(view);
  });
  onCleanup(() => view && cancelSwap(view));

  // The parts as the layout is given them: each with its marker, or none.
  const songParts = createMemo(() => {
    const parts = props.message.parts ?? [];
    // The part cue, "Show parts", marks them here (SDD-0005 § 1).
    return props.cues?.part ? parts : parts.map(({ marker: _, ...part }) => part);
  });

  // The parts in the order they are sung (one per occurrence), and where the
  // focus is in it: a chorus sung on several pages is shown on each.
  const sequence = createMemo(() =>
    props.message.lines.flatMap((line) => (line.isPartStart ? [line.partId] : [])),
  );
  const sequenceAt = () => {
    let at = -1;
    for (let i = 0; i <= props.message.focus.start; i++)
      if (props.message.lines[i]?.isPartStart) at++;
    return Math.max(at, 0);
  };
  const sungParts = createMemo(() => sungOf(songParts(), props.message.chorus, sequence()));

  // Measure and lay the song out as it arrives, when the browser is idle, so
  // turning the layout on later has nothing left to do (SDD-0005 § 4).
  const partsSignature = createMemo(() => signature(songParts()));
  createEffect(
    on(partsSignature, () => {
      const parts = songParts();
      if (!parts?.length || !view) return;
      const measure = () => {
        if (view) prepareFullSong(view, parts, BAND, BAND, sungParts());
      };
      if (typeof requestIdleCallback === "function") {
        const id = requestIdleCallback(measure, { timeout: 1000 });
        onCleanup(() => cancelIdleCallback(id));
      } else {
        const id = setTimeout(measure, 0);
        onCleanup(() => clearTimeout(id));
      }
    }),
  );

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
  let drifting = false;
  onCleanup(() => {
    clearTimeout(restTimer);
    clearTimeout(driftTimer);
  });

  /** The band, in px from the top of the viewport; null when not scrolling. */
  let band: { top: number; bottom: number; whole: boolean } | null = null;
  /** The lines lit by the band; null means the focus is lit. */
  const [bandLit, setBandLit] = createSignal<LineRange | null>(null);
  const lit = () => bandLit() ?? props.message.focus;
  // Whether line i is the chorus's — the one part that pins.
  const isChorus = (i: number) => {
    const line = props.message.lines[i];
    return !!line && !!props.message.chorus && line.partId === props.message.chorus;
  };
  // The chorus's first showing: the lines a pinned band holds.
  const chorusBlock = createMemo(() => blocks().find((block) => isChorus(block.start)));
  const verseBlocks = createMemo(() => blocks().filter((block) => !isChorus(block.start)));
  // Hidden from the column while pinned: shown once, in the band.
  const pinnedAway = (i: number) => pinnedNow() && isChorus(i);
  const focusInChorus = () => isChorus(props.message.focus.start);
  // While the chorus is sung, the column holds the verse that comes next
  // (or, at the end, the last one), dimmed: what's coming is in view.
  const anchor = (): { start: number; end: number } => {
    const { focus } = props.message;
    if (!(pinnedNow() && focusInChorus())) return focus;
    const verses = verseBlocks();
    return verses.find((block) => block.start >= focus.end) ?? verses.at(-1) ?? focus;
  };
  // A pinned band's lines light where the focus lights its showing.
  const bandLineLit = (k: number) => {
    const { focus } = props.message;
    if (lightAll()) return layout() !== "flow";
    if (layout() === "flow" || !focusInChorus() || bandLit()) return false;
    const showing = blocks().find((block) => focus.start >= block.start && focus.start < block.end);
    const i = (showing?.start ?? 0) + k;
    return i >= focus.start && i < focus.end;
  };
  // Under line focus, the one line lit within its part (Full Song); null for
  // a whole part.
  const litWithinPart = () => {
    const { lines, focus } = props.message;
    let start = focus.start;
    while (start > 0 && !lines[start]?.isPartStart) start--;
    let end = focus.start + 1;
    while (end < lines.length && !lines[end]?.isPartStart) end++;
    const whole = focus.start === start && focus.end >= end;
    return whole ? null : { start: focus.start - start, end: focus.end - start };
  };
  // The caption names no part: each part carries its own marker, in both
  // layouts.
  const caption = () => cueCaption(props.message, props.cues);
  // Memos, so they change only when a cue turns on or off. The bands are
  // reserved (BAND), whether or not a detail shows in them: switching one on
  // or off moves no lyric, and the soft edges stay.
  const hasCaption = createMemo(() => !!caption());
  const badge = createMemo(() => !!props.cues?.number);
  const marked = createMemo(() => !!props.cues?.part);
  // The marker over a part's first line (SDD-0005 § 1): what Full Song prints
  // there, shown or hidden by "Show parts".
  const markerAt = (i: number) => {
    const line = props.message.lines[i];
    if (!marked() || !line?.isPartStart) return undefined;
    return props.message.parts?.find((part) => part.id === line.partId)?.marker || undefined;
  };
  // Lit with its part: any of the part's lines lit.
  const markerLit = (i: number) => {
    if (lightAll()) return true;
    const block = blocks().find((b) => b.start === i);
    return !!block && lit().start < block.end && lit().end > block.start;
  };
  // The room a line's marker takes above its text, px: in the line's own box,
  // so a block's height has it, and what centres or clamps is the text below.
  const leadOf = (line: HTMLElement | undefined) => {
    const first = line?.firstElementChild;
    return first instanceof HTMLElement && first.classList.contains("output-part-marker")
      ? first.offsetHeight
      : 0;
  };
  // A detail switched off fades away where it was: its last words are kept
  // while it does.
  const [heldCaption, setHeldCaption] = createSignal("");
  createComputed(() => {
    const now = caption();
    if (now) setHeldCaption(now);
  });
  // Cues set to fade (DESIGN.md § Typography): all show together at a new
  // hymn, on coming back from blank, or when the operator asks, then fade
  // together. Part steps (arrows, a hand scroll) don't bring them back: the
  // caption's part changed every verse, so it kept returning alone. Only
  // opacity changes; margins stay reserved, so the lyrics never move.
  const [restores, setRestores] = createSignal(0);
  createEffect(
    on(
      () => !!props.blanked,
      (blanked, was) => {
        if (was && !blanked) setRestores((n) => n + 1);
      },
      { defer: true },
    ),
  );
  const fading = (key: () => unknown) => {
    const [shown, setShown] = createSignal(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    createEffect(
      on([key, () => !!props.cues?.fade, () => props.reveal, restores], ([, fade]) => {
        clearTimeout(timer);
        setShown(true);
        if (fade) timer = setTimeout(() => setShown(false), CUE_FADE_MS);
      }),
    );
    onCleanup(() => clearTimeout(timer));
    return shown;
  };
  const cuesShown = fading(createMemo(() => `${props.message.hymnbookId}:${props.message.number}`));

  const startBand = () => {
    if (band || !view) return;
    const focus = anchor();
    const whole = (props.bandSize ?? "part") === "part";
    // Part-sized: the whole part the focus is in, even under line focus.
    const part = blocks().find((block) => focus.start >= block.start && focus.start < block.end);
    const { start, end } = whole && part ? part : { start: focus.start, end: focus.start + 1 };
    const first = lineRefs[start];
    if (!first) return;
    const height = view.clientHeight;
    const top = Math.max(height * BAND, first.offsetTop - view.scrollTop);
    const bottom = Math.min(columnBottom(), top + heightOf(start, end));
    band = { top, bottom, whole };
  };

  // A line's centre, its marker (if it opens a part) not counted.
  const centreOf = (line: HTMLLIElement) => {
    const lead = leadOf(line);
    return line.offsetTop + lead + (line.offsetHeight - lead) / 2 - (view?.scrollTop ?? 0);
  };

  // The lines whose centres sit inside the band — or, if it's thinner than
  // a line, the one nearest its centre.
  const updateBand = () => {
    if (!band) return;
    const { top, bottom } = band;
    const inside = lineRefs.flatMap((line, i) =>
      line && !pinnedAway(i) && centreOf(line) >= top && centreOf(line) <= bottom ? [i] : [],
    );
    const nearest = lineNearest((top + bottom) / 2);
    if (inside.length) setBandLit({ start: inside[0], end: inside[inside.length - 1] + 1 });
    else if (nearest !== undefined) setBandLit({ start: nearest, end: nearest + 1 });
  };

  const lineNearest = (y: number): number | undefined => {
    let nearest: number | undefined;
    let best = Number.POSITIVE_INFINITY;
    lineRefs.forEach((line, i) => {
      if (!line || pinnedAway(i)) return;
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

  /** Where the scrolling lyrics end, in px from the top of the view: above
   * a chorus pinned in the band, else the bottom safe margin. */
  const columnBottom = () => {
    const bottom = (view?.clientHeight ?? 0) * (1 - BAND);
    return layoutNow === "band" ? bottom - chorusPx - gapPx() : bottom;
  };
  const gapPx = () => (lineRefs.find(Boolean)?.offsetHeight ?? 0) * PIN_GAP_LINES;

  const position = (behavior: ScrollBehavior) => {
    if (fullSong()) return;
    armed = false;
    clearTimeout(restTimer);
    clearTimeout(driftTimer);
    drifting = false;
    endBand();
    if (pinnedNow()) {
      positionPinned(behavior);
      return;
    }
    const { start, end } = props.message.focus;
    const first = lineRefs[start];
    if (!view || !first) return;
    const height = view.clientHeight;
    // The text centres; its marker hangs above it, and must stay in the room.
    const lead = leadOf(first);
    const block = heightOf(start, end) - lead;
    const room = height * (1 - BAND - BAND);
    // Where the text's top should sit within the screen.
    const top =
      block + lead > room
        ? height * BAND + lead
        : Math.max(
            height * BAND + lead,
            Math.min(height * EYELINE - block / 2, height * (1 - BAND) - block),
          );
    view.scrollTo?.({ top: first.offsetTop + lead - top, behavior });
  };

  // Pinned: the verse column is the space above the band, or the left half
  // beside it. The focus (or, while the chorus is sung, the verse to come)
  // centres on the column's eyeline, clamped inside it; the chorus's pane
  // never scrolls. Beside the verses, it centres on the same eyeline.
  const positionPinned = (behavior: ScrollBehavior) => {
    const { start, end } = anchor();
    const first = lineRefs[start];
    if (!view || !first) return;
    const height = view.clientHeight;
    const areaTop = height * BAND;
    const areaBottom = columnBottom();
    if (layoutNow === "side") {
      const top = Math.max(
        areaTop,
        Math.min(height * EYELINE - chorusPx / 2, areaBottom - chorusPx),
      );
      view.style.setProperty("--pin-top", `${top}px`);
    }
    const lead = leadOf(first);
    const block = heightOf(start, end) - lead;
    const eyeline =
      layoutNow === "side" ? height * EYELINE : areaTop + (areaBottom - areaTop) * PINNED_EYELINE;
    const top =
      block + lead > areaBottom - areaTop
        ? areaTop + lead
        : Math.max(areaTop + lead, Math.min(eyeline - block / 2, areaBottom - block));
    view.scrollTo?.({ top: first.offsetTop + lead - top, behavior });
  };

  // Shrinks the type until `need()` (px, at the current type) fits the
  // room. Wrapping changes as the type shrinks, so it converges in a few
  // passes. Leaves --fit set to the result.
  // `wide` also shrinks for width: a word too long for its line's width
  // (Malayalam words don't break) must never cross into the next column.
  const fitTo = (room: number, need: () => number, wide = false): number => {
    let fit = 1;
    view?.style.setProperty("--fit", "1");
    for (let pass = 0; pass < 4 && room > 0; pass++) {
      const scale = Math.min(room / need(), wide ? widthScale() : 1);
      if (scale >= 1 || fit === FIT_FLOOR) break;
      fit = Math.max(FIT_FLOOR, fit * scale * 0.98);
      view?.style.setProperty("--fit", String(fit));
    }
    return fit;
  };
  // How much the widest overflowing line must shrink to fit its width; 1
  // when every line fits.
  const widthScale = () =>
    Math.min(
      1,
      ...lineRefs.map((line) =>
        line && line.scrollWidth > line.clientWidth ? line.clientWidth / line.scrollWidth : 1,
      ),
    );
  const tallestOf = (list: { start: number; end: number }[]) =>
    Math.max(0, ...list.map((b) => heightOf(b.start, b.end)));

  // The flowing fit: the hymn's tallest part fits the safe area, and its
  // longest word its width. Then, with pinning on, each pinned layout's fit,
  // measured at its own width: the band (the tallest verse over the
  // chorus, with the gap between) and side by side (each in half the
  // width). A layout qualifies if it truly fits (at the floor, fits can tie
  // without fitting) and keeps the type at PIN_MIN_FIT or more (SDD-0001
  // §16.1). A landscape screen takes side by side if it
  // qualifies, keeping the chorus at eye height where the band sits low,
  // behind the heads in front for the back rows; a portrait one the band.
  // Else the hymn flows exactly as it would with pinning off.
  const layOut = () => {
    if (!view || fullSong()) return;
    setLayoutNow("flow");
    const room = view.clientHeight * (1 - BAND - BAND);
    const flowing = fitTo(room, () => tallestOf(blocks()), true);
    const chorus = chorusBlock();
    if (!(props.pinChorus && chorus && verseBlocks().length > 0)) {
      position("instant");
      return;
    }
    const chorusHeight = () => heightOf(chorus.start, chorus.end);
    const candidate = (kind: Exclude<Layout, "flow">, need: () => number) => {
      const side = kind === "side";
      view?.classList.toggle("output-side-mode", side);
      const fit = fitTo(room, need, true);
      const ok = need() <= room && widthScale() >= 1 && fit >= PIN_MIN_FIT;
      view?.classList.remove("output-side-mode");
      return { kind, fit, ok };
    };
    const band = candidate("band", () => tallestOf(verseBlocks()) + chorusHeight() + gapPx());
    const side = candidate("side", () => Math.max(tallestOf(verseBlocks()), chorusHeight()));
    // A landscape screen prefers side by side, a portrait one the band
    // (half-width columns there would wrap every line); either only if it
    // holds the floor, else the other, else the hymn flows.
    const landscape = view.clientWidth > view.clientHeight;
    const best = (landscape ? [side, band] : [band, side]).find((c) => c.ok);
    if (!best) {
      view.style.setProperty("--fit", String(flowing));
      position("instant");
      return;
    }
    view.style.setProperty("--fit", String(best.fit));
    // Measure the chorus at the chosen layout's width, then take it.
    view.classList.toggle("output-side-mode", best.kind === "side");
    chorusPx = chorusHeight();
    setLayoutNow(best.kind);
    position("instant");
  };

  // A marker follows its part's own text alignment (SDD-0005 § 1): centred
  // lines, a centred marker on their axis; start-aligned lines, a marker at
  // the start, on the ink's edge. Read from the lines' computed text-align,
  // measured once laid out.
  const alignMarkers = () => {
    if (!view) return;
    // How far the lines' ink starts from the start edge of the first line's
    // box (its right edge, right-to-left).
    const inset = (lines: HTMLElement[]) => {
      const box = lines[0]?.getBoundingClientRect();
      if (!box) return 0;
      const rtl = lines[0] && getComputedStyle(lines[0]).direction === "rtl";
      let edge = rtl ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
      for (const line of lines) {
        const text = [...line.childNodes].find(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent,
        );
        if (!text || typeof document.createRange !== "function") continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        if (typeof range.getClientRects !== "function") continue;
        for (const rect of range.getClientRects())
          edge = rtl ? Math.max(edge, rect.right) : Math.min(edge, rect.left);
      }
      if (!Number.isFinite(edge)) return 0;
      return Math.max(0, rtl ? box.right - edge : edge - box.left);
    };
    const set = (lines: (HTMLElement | undefined)[]) => {
      const first = lines[0]?.firstElementChild;
      if (!(first instanceof HTMLElement) || !first.classList.contains("output-part-marker"))
        return;
      const own = lines.filter((l): l is HTMLElement => !!l);
      // Boxes are aligned; the ink is what the eye sees: a few tenths of a px.
      const align = placeMarker(
        first,
        first.querySelector<HTMLElement>(".output-part-marker-text"),
        own,
      );
      if (align === "start") first.style.setProperty("--marker-x", `${inset(own)}px`);
      else first.style.removeProperty("--marker-x");
    };
    for (const { start, end } of blocks()) set(lineRefs.slice(start, end));
    set([...view.querySelectorAll<HTMLElement>(".output-pinned > .output-line")]);
  };
  const refit = () => {
    layOut();
    alignMarkers();
  };

  // The part markers take room in the column, and pinning changes the layout:
  // fit again.
  createEffect(on([marked, () => !!props.pinChorus], refit, { defer: true }));

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
    if (fullSong()) return;
    armed = !!props.onSeek;
    if (armed) startBand();
    scheduleDrift();
  };
  const scheduleDrift = () => {
    clearTimeout(driftTimer);
    drifting = true;
    driftTimer = setTimeout(() => position("smooth"), DRIFT_BACK_MS);
  };
  const onScroll = () => {
    // A fling goes on scrolling after the last touch: the wait counts from
    // where it stops, so the glide back never fights it.
    if (drifting) scheduleDrift();
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

  // Back to the scroll: fit and position it again, now it shows.
  createEffect(on(fullSong, (active) => (active ? undefined : refit()), { defer: true }));

  onMount(() => {
    if (view) setLandscape(isLandscape(view));
    queueMicrotask(() => {
      shapeKnown = true;
    });
    void document.fonts?.ready.then(refit);
    if (typeof ResizeObserver !== "function" || !view) return;
    const observer = new ResizeObserver(() => {
      setLandscape(!!view && isLandscape(view));
      refit();
    });
    observer.observe(view);
    onCleanup(() => observer.disconnect());
  });

  // The chorus's own pane, pinned in the band or beside the verses.
  const chorusPane = () => (
    <Show when={chorusBlock()}>
      {(chorus) => (
        <ul class="output-list output-pinned">
          <Index each={props.message.lines.slice(chorus().start, chorus().end)}>
            {(line, k) => (
              <li
                class="output-line output-chorus"
                classList={{ "output-line-current": bandLineLit(k) }}
              >
                <Show when={k === 0 && markerAt(chorus().start)}>
                  {(marker) => (
                    <div class="output-part-marker" aria-hidden="true">
                      <span
                        class="output-part-marker-text"
                        classList={{
                          "output-part-marker-lit": props.message.lines
                            .slice(chorus().start, chorus().end)
                            .some((_, j) => bandLineLit(j)),
                        }}
                      >
                        {marker()}
                      </span>
                    </div>
                  )}
                </Show>
                {line().text}
              </li>
            )}
          </Index>
        </ul>
      )}
    </Show>
  );

  return (
    <div
      ref={view}
      class={`output-view output-view-${props.variant}`}
      style={{ "--safe-bottom": `${BAND * 100}cqh` }}
      classList={{
        ...props.classList,
        "output-blanked": !!props.blanked,
        "output-view-fullsong": fullSong(),
      }}
      // The mini view is a picture of the Output; the full one is the Output.
      {...(props.variant === "mini" ? { role: "img", "aria-label": "Live output preview" } : {})}
    >
      {/* The songbook number: top left, sticky and zero-height like the
          caption, and still — it changes only with the hymn. Always there, in
          both layouts, its soft edge too; the number fades in and out. */}
      <div class="output-badge" classList={{ "output-cue-faded": !cuesShown() }}>
        <p class="output-badge-text" classList={{ "output-cue-off": !badge() }}>
          {props.message.number}
        </p>
      </div>
      {/* Side by side (SDD-0001 §16.1): first, sticky to the top and
          zero-height like the badge, its pane placed beside the verses at
          --pin-top. */}
      <Show when={layout() === "side"}>
        <div class="output-pin-side">{chorusPane()}</div>
      </Show>
      <Show when={fullSong()}>
        <FullSong
          parts={songParts()}
          current={props.message.lines[props.message.focus.start]?.partId}
          chorus={props.message.chorus}
          sequence={sequence()}
          at={sequenceAt()}
          lit={litWithinPart()}
          all={lightAll()}
          safeTop={BAND}
          safeBottom={BAND}
          songKey={`${props.message.hymnbookId}:${props.message.number}`}
        />
      </Show>
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
                "output-line-current": lightAll() || (i >= lit().start && i < lit().end),
                // Parts are set apart by a gap, as in a printed hymnal.
                "output-part-start": line().isPartStart && i > 0,
                // The chorus pins; no other mark (SDD-0001 §16.1).
                "output-chorus": isChorus(i),
              }}
            >
              <Show when={markerAt(i)}>
                {(marker) => (
                  <div class="output-part-marker" aria-hidden="true">
                    <span
                      class="output-part-marker-text"
                      classList={{ "output-part-marker-lit": markerLit(i) }}
                    >
                      {marker()}
                    </span>
                  </div>
                )}
              </Show>
              {line().text}
            </li>
          )}
        </Index>
        <li class="output-spacer" aria-hidden="true" />
      </ul>
      {/* The pinned chorus (SDD-0001 §16.1), in the band: sticky above the
          bottom margin, still while the verses scroll above it; lit in place
          when sung. */}
      <Show when={layout() === "band"}>
        <div class="output-pin-band">{chorusPane()}</div>
      </Show>
      {/* Last, sticky to the bottom and zero-height: it rides the bottom
          safe margin, taking no room from the lyrics (DESIGN.md §
          Typography). */}
      <div class="output-caption" classList={{ "output-cue-faded": !cuesShown() }}>
        <p class="output-caption-text" classList={{ "output-cue-off": !hasCaption() }}>
          {heldCaption()}
        </p>
      </div>
    </div>
  );
}
