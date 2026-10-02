import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  on,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";
import type { PartId } from "../domain/types.ts";
import { boxOf, prefersReducedMotion } from "../presenter/glideGeometry.ts";
import { type FullLayout, layoutSong } from "./fullSong.ts";
import { newTintState, placeTint, type TintStep } from "./fullSongGlide.ts";
import {
  analyticMeasure,
  fontsEpoch,
  metricsFor,
  onFontsChange,
  signature,
} from "./fullSongText.ts";

export { signature };

/** The gap between columns, as a share of the sheet's width. */
const COLUMN_GAP = 0.03;
/** Layouts kept. */
const CACHE_SIZE = 8;
/** A layout that overflows once built in the page is made again for a room
 * this much smaller (3%), up to this many times. */
const NUDGE = 0.97;
const MAX_NUDGES = 8;
/** A page turn that never reports its end is ended after this long. */
const TURN_GUARD_MS = 600;

interface Kept {
  layout: FullLayout;
  /** How many steps smaller than the arithmetic's first answer: what the page
   * itself agreed to. */
  nudge: number;
}

/** Layouts kept across components, by the song's text, the box and the fonts:
 * a song seen again at the same size, or laid out ahead of its turn. */
const kept = new Map<string, Kept>();

const layoutKey = (parts: { id: string; lines: string[] }[], w: number, h: number) =>
  `${signature(parts)}|${w}x${h}|${fontsEpoch()}`;

function remember(key: string, layout: FullLayout, nudge: number) {
  kept.set(key, { layout, nudge });
  if (kept.size > CACHE_SIZE) kept.delete(kept.keys().next().value as string);
}

/** The rule over a song's measured words, in a sheet `w` by `h` px, the type
 * `emFull` px at fit 1, the room `nudge` steps smaller. */
function solveFor(
  parts: { id: string; lines: string[] }[],
  w: number,
  h: number,
  emFull: number,
  font: { family: string; weight: string },
  nudge: number,
): FullLayout {
  const metrics = metricsFor(parts, font.family, font.weight);
  const measure = analyticMeasure(metrics, emFull, w, w * COLUMN_GAP);
  return layoutSong(parts.length, measure, h * NUDGE ** nudge);
}

/** Forget the layouts kept (for tests). */
export const forgetLayouts = () => kept.clear();

/**
 * Measure a song and lay it out for the view it is about to show in, ahead of
 * the layout being turned on: what the layout needs then is already kept. The
 * sheet's box is worked out from the view's (SDD-0005 § 1's margins); if it
 * is a pixel out, the layout is simply made when it is wanted.
 */
export function prepareFullSong(
  view: HTMLElement,
  parts: { id: string; lines: string[] }[],
  safeTop: number,
  safeBottom: number,
) {
  const { clientWidth: cw, clientHeight: ch } = view;
  if (!(cw > 0 && ch > 0) || parts.length === 0) return;
  const w = Math.round(cw * 0.9);
  const h = Math.round(ch * (1 - safeTop - safeBottom));
  const key = layoutKey(parts, w, h);
  if (kept.has(key)) return;
  const family = getComputedStyle(view).fontFamily;
  remember(key, solveFor(parts, w, h, 0.075 * Math.min(cw, ch), { family, weight: "500" }, 0), 0);
}

export interface FullSongProps {
  /** The song's parts, in printed order. */
  parts: { id: PartId; lines: string[] }[];
  /** The part being sung. */
  current: PartId | undefined;
  /** The lines lit within it, when the focus is one line; else the part. */
  lit: { start: number; end: number } | null;
  /** The safe margins, as shares of the height: more where a cue shows. */
  safeTop: number;
  safeBottom: number;
  /** Every part lit, none tinted (the Highlight setting's whole song). */
  all?: boolean;
  /** Changes with the song, so a new song lands at once. */
  songKey: string;
}

interface Computed extends FullLayout {
  sheetWidth: number;
  id: number;
  /** What it was made for, to make it again smaller if the page disagrees. */
  key: string;
  room: number;
  nudge: number;
}

/**
 * The whole song at once (SDD-0005): parts in printed order, in balanced
 * columns, the type as large as it all fits, pages when it would not reach
 * the floor. Nothing scrolls. The current part is tinted; the tint glides
 * (fullSongGlide.ts) and the text's colour follows in the same time (CSS,
 * keyed by `data-glide`). A page turn hands one page off to the next, the tint
 * crossing with them (fullSong.css rules `data-turn`).
 *
 * The layout is arithmetic over the song's measured words (fullSongText.ts);
 * the page it picks is then checked once, in the page, and nudged down a step
 * if the browser disagrees.
 */
export function FullSong(props: FullSongProps) {
  let root!: HTMLDivElement;
  let sheet!: HTMLDivElement;
  let stage!: HTMLDivElement;
  let tint!: HTMLDivElement;
  let ghost!: HTMLDivElement;
  const tintState = newTintState();
  const [layout, setLayout] = createSignal<Computed | null>(null);
  /** The page the current part is on, and the pages in the page: two, during
   * a turn. */
  const [shown, setShown] = createSignal(0);
  const [mounted, setMounted] = createSignal<number[]>([]);
  let layoutId = 0;

  const currentIndex = createMemo(() => props.parts.findIndex((p) => p.id === props.current));

  // What a layout depends on, so it is made again only when one changes: the
  // song's identity and its parts' text (an edit changes it; the sequence
  // moving does not), the box, the margins, and the fonts.
  const songKey = createMemo(() => props.songKey);
  const partsKey = createMemo(() => `${songKey()}#${signature(props.parts)}`);
  const safeTop = createMemo(() => props.safeTop);
  const safeBottom = createMemo(() => props.safeBottom);
  let lastKey = "";

  /** The layout for the sheet's box: the one kept, or made now, `nudge` steps
   * smaller than the first when the page has disagreed. */
  const build = (nudge: number): Computed => {
    const { clientWidth: w, clientHeight: h } = sheet;
    const key = layoutKey(props.parts, w, h);
    layoutId += 1;
    const made = { sheetWidth: w, id: layoutId, key, room: h, nudge };
    const have = nudge === 0 ? kept.get(key) : undefined;
    if (have) return { ...made, ...have.layout, nudge: have.nudge };
    // The type's size at fit 1, as the page works it out.
    sheet.style.setProperty("--fit", "1");
    const style = getComputedStyle(sheet);
    // 7.5cqmin, if the page gave no px size.
    const emFull = Number.parseFloat(style.fontSize) || 0.075 * Math.min(w, h);
    // No box to fit (nothing laid out yet): everything on one page.
    if (!(w > 0 && h > 0 && emFull > 0)) {
      const all = props.parts.map((_, i) => i);
      return { ...made, fit: 1, pages: [{ columns: [all] }], belowFloor: false };
    }
    const layout = solveFor(
      props.parts,
      w,
      h,
      emFull,
      { family: style.fontFamily, weight: style.fontWeight },
      nudge,
    );
    remember(key, layout, nudge);
    return { ...made, ...layout };
  };

  const use = (result: Computed) => {
    sheet.style.setProperty("--fit", String(result.fit));
    setLayout(result);
  };

  const compute = () => {
    if (!sheet) return;
    const { clientWidth: w, clientHeight: h } = sheet;
    const key = `${partsKey()}|${w}x${h}|${safeTop()}|${safeBottom()}|${fontsEpoch()}`;
    if (key === lastKey) return;
    lastKey = key;
    use(untrack(() => build(0)));
  };

  // Resizes, and fonts arriving, wait for the next frame: one layout for a
  // burst of them.
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      compute();
    });
  };
  onCleanup(() => cancelAnimationFrame(frame));

  createEffect(on([partsKey, safeTop, safeBottom], compute));
  onMount(() => {
    // A font loads when text first needs it, so the first layout of a script
    // may have used the fallback's metrics: measure again once it is in.
    onCleanup(onFontsChange(schedule));
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    onCleanup(() => observer.disconnect());
  });

  const locate = (l: Computed, index: number) => {
    for (const [page, { columns }] of l.pages.entries()) {
      const column = columns.findIndex((c) => c.includes(index));
      if (column >= 0) return { page, column };
    }
    return null;
  };

  // How the step that just happened moves: decided with the colours, in the
  // same batch, so the CSS transition timing matches the tint's.
  let was: { part: number; layout: Computed | null } | null = null;
  const step = createMemo((): TintStep => {
    const l = layout();
    const part = currentIndex();
    props.all; // a toggle is a colour change: timed, not snapped
    const before = was;
    was = { part, layout: l };
    if (!l || !before || before.layout !== l || prefersReducedMotion()) return "snap";
    if (before.part === part) return "slide";
    const from = locate(l, before.part);
    const to = locate(l, part);
    if (!from || !to) return "snap";
    if (from.page !== to.page) return "turn";
    return from.column === to.column ? "slide" : "cross";
  });

  const targetPage = createMemo(() => {
    const l = layout();
    return (l && locate(l, currentIndex())?.page) || 0;
  });

  // A new layout shows its current page at once.
  createEffect(
    on(layout, () => {
      const target = untrack(targetPage);
      batch(() => {
        setShown(target);
        setMounted([target]);
      });
    }),
  );

  // The page turn: the new page is mounted over the old, which fades out as
  // it fades in (CSS, `data-turn`), and the old one goes when it is done.
  // Never blank, never two turns at once.
  createEffect(
    on(
      targetPage,
      (target) => {
        const current = untrack(shown);
        if (target === current) return;
        const turning = untrack(step) === "turn" && untrack(mounted).length < 2;
        batch(() => {
          setMounted(turning ? [current, target] : [target]);
          setShown(target);
        });
      },
      { defer: true },
    ),
  );
  createEffect(() => {
    if (mounted().length < 2) return;
    const guard = setTimeout(() => setMounted([untrack(shown)]), TURN_GUARD_MS);
    onCleanup(() => clearTimeout(guard));
  });

  // The page was laid out by arithmetic: check what the browser made of it,
  // and make the layout again for a smaller room if it overflows or a word
  // does not fit.
  createEffect(
    on([layout, shown, mounted], ([l, page]) => {
      if (!l || l.nudge >= MAX_NUDGES) return;
      // After the page's own update, and before it is painted.
      queueMicrotask(() => {
        if (untrack(layout) !== l || untrack(shown) !== page) return;
        const el = stage.querySelector<HTMLElement>(`.full-page[data-page="${page}"]`);
        if (!el || el.dataset.layout !== String(l.id)) return;
        const block = el.firstElementChild as HTMLElement;
        const tooTall = block.offsetHeight > sheet.clientHeight + 1;
        const tooWide = [...block.querySelectorAll<HTMLElement>(".full-line")].some(
          (line) => line.scrollWidth > line.clientWidth + 1,
        );
        if (tooTall || tooWide) use(build(l.nudge + 1));
      });
    }),
  );

  const findPart = (index: number) =>
    stage.querySelector<HTMLElement>(`[data-part-index="${index}"]`);

  // The tint follows the current part, on the page shown. It does not depend
  // on which pages are mounted: the end of a turn must not disturb it.
  let tintLayout: Computed | null = null;
  createEffect(() => {
    const l = layout();
    shown();
    const index = currentIndex();
    const how = step();
    if (!l) return;
    const el = findPart(index);
    // Before the turn mounts the new page, the current part is not there yet:
    // the tint stays where it is until it is.
    if (!el && how === "turn") return;
    if (!el) {
      placeTint({ tint, ghost }, tintState, null, "snap", 0);
      return;
    }
    // Another layout is a landing, not a step.
    const landing = tintLayout !== l;
    tintLayout = l;
    const em = Number.parseFloat(getComputedStyle(sheet).fontSize) || 0;
    placeTint(
      { tint, ghost },
      tintState,
      boxOf(el, stage),
      landing || props.all ? "snap" : how,
      em,
    );
  });

  const columnWidth = (columns: number) => {
    const width = layout()?.sheetWidth ?? 0;
    return (width - (columns - 1) * width * COLUMN_GAP) / columns;
  };

  return (
    <div
      ref={root}
      class="full-song"
      data-glide={step()}
      data-lit={props.all ? "all" : undefined}
      style={{
        "--safe-top": `${props.safeTop * 100}cqh`,
        "--safe-bottom": `${props.safeBottom * 100}cqh`,
      }}
    >
      <div ref={sheet} class="full-sheet">
        <div ref={stage} class="full-stage">
          <div ref={tint} class="full-tint" aria-hidden="true" />
          <div ref={ghost} class="full-tint" style={{ display: "none" }} aria-hidden="true" />
          <For each={mounted()}>
            {(pageIndex) => {
              const columns = () => layout()?.pages[pageIndex]?.columns ?? [];
              const single = () => columns().length === 1;
              return (
                <div
                  class="full-page"
                  data-page={pageIndex}
                  data-layout={layout()?.id}
                  data-turn={
                    mounted().length > 1 ? (pageIndex === shown() ? "in" : "out") : undefined
                  }
                  onAnimationEnd={(event) => {
                    if (event.target === event.currentTarget && pageIndex === shown())
                      setMounted([shown()]);
                  }}
                >
                  <div
                    class="full-block"
                    style={{
                      "--col-width": `${columnWidth(columns().length || 1)}px`,
                      "--col-gap": `${(layout()?.sheetWidth ?? 0) * COLUMN_GAP}px`,
                    }}
                  >
                    <For each={columns()}>
                      {(column) => (
                        <div class="full-col" classList={{ "full-col-single": single() }}>
                          <For each={column}>
                            {(index) => (
                              <div
                                class="full-part"
                                classList={{ "full-part-current": index === currentIndex() }}
                                data-part-index={index}
                              >
                                <Index each={props.parts[index]?.lines ?? []}>
                                  {(text, k) => (
                                    <div
                                      class="full-line"
                                      classList={{
                                        "full-line-lit":
                                          !!props.all ||
                                          (index === currentIndex() &&
                                            (!props.lit ||
                                              (k >= props.lit.start && k < props.lit.end))),
                                      }}
                                    >
                                      {text()}
                                    </div>
                                  )}
                                </Index>
                              </div>
                            )}
                          </For>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
