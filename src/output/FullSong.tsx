import {
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
import { boxOf, glideTiming, prefersReducedMotion } from "../presenter/glideGeometry.ts";
import { type FullLayout, layoutSong, type Measured } from "./fullSong.ts";
import { newTintState, placeTint, type TintStep } from "./fullSongGlide.ts";

/** The gap between columns, as a share of the sheet's width. */
const COLUMN_GAP = 0.03;
/** Layouts kept, by what they depend on: a song seen again at the same size. */
const CACHE_SIZE = 8;
/** A page turn: the old page out, the new one in (SDD-0005 § 3). */
const TURN_OUT_MS = 125;
const TURN_IN_MS = 175;

/** A cheap signature of a song's parts: ids, line counts and a hash of the
 * text, so an edited song is laid out again though its key is the same. */
export function signature(parts: { id: string; lines: string[] }[]): string {
  let hash = 5381;
  for (const part of parts) {
    for (const line of part.lines) {
      for (let i = 0; i < line.length; i++) hash = (hash * 33) ^ line.charCodeAt(i);
      hash = (hash * 33) ^ 10;
    }
    hash = (hash * 33) ^ 30;
  }
  return `${parts.length}.${(hash >>> 0).toString(36)}`;
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
}

/**
 * The whole song at once (SDD-0005): parts in printed order, in balanced
 * columns, the type as large as it all fits, pages when it would not reach
 * the floor. Nothing scrolls. The current part is tinted; the tint glides
 * (fullSongGlide.ts) and the text's colour follows in the same time (CSS,
 * keyed by `data-glide`).
 */
export function FullSong(props: FullSongProps) {
  let root!: HTMLDivElement;
  let sheet!: HTMLDivElement;
  let block!: HTMLDivElement;
  let tint!: HTMLDivElement;
  let ghost!: HTMLDivElement;
  const tintState = newTintState();
  const [layout, setLayout] = createSignal<Computed | null>(null);
  const [shown, setShown] = createSignal(0);
  let layoutId = 0;

  const currentIndex = createMemo(() => props.parts.findIndex((p) => p.id === props.current));

  // One part's height, and whether its words fit, at a column count and
  // scale: parts are set in a hidden column of the same width and classes.
  const measure = (columns: number, fit: number): Measured => {
    const gap = sheet.clientWidth * COLUMN_GAP;
    const width = (sheet.clientWidth - (columns - 1) * gap) / columns;
    const probe = document.createElement("div");
    probe.className = `full-col full-probe${columns === 1 ? " full-col-single" : ""}`;
    probe.style.width = `${width}px`;
    probe.style.setProperty("--fit", String(fit));
    for (const part of props.parts) {
      const el = document.createElement("div");
      el.className = "full-part";
      for (const text of part.lines) {
        const line = document.createElement("div");
        line.className = "full-line";
        line.textContent = text;
        el.append(line);
      }
      probe.append(el);
    }
    sheet.append(probe);
    const parts = [...probe.children] as HTMLElement[];
    const heights = parts.map((el) => el.offsetHeight);
    const fits = parts.map((el) =>
      [...el.children].every((line) => line.scrollWidth <= line.clientWidth + 1),
    );
    probe.remove();
    return { heights, fits };
  };

  // What a layout depends on, so it is made again only when one changes: the
  // song's identity and its parts' text (an edit changes it; the sequence
  // moving does not), the box, the margins, and the fonts.
  const songKey = createMemo(() => props.songKey);
  const partsKey = createMemo(() => `${songKey()}#${signature(props.parts)}`);
  const safeTop = createMemo(() => props.safeTop);
  const safeBottom = createMemo(() => props.safeBottom);
  let fontEpoch = 0;
  let lastKey = "";
  const cache = new Map<string, FullLayout>();

  const compute = () => {
    if (!sheet) return;
    const { clientWidth: w, clientHeight: h } = sheet;
    const key = `${partsKey()}|${w}x${h}|${safeTop()}|${safeBottom()}|${fontEpoch}`;
    if (key === lastKey) return;
    lastKey = key;
    let result = cache.get(key);
    if (!result) {
      result = untrack(() => layoutSong(props.parts.length, measure, h));
      cache.set(key, result);
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
    }
    sheet.style.setProperty("--fit", String(result.fit));
    layoutId += 1;
    setLayout({ ...result, sheetWidth: w, id: layoutId });
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
    const fonts = document.fonts;
    const fontsChanged = () => {
      fontEpoch += 1;
      schedule();
    };
    void fonts?.ready.then(fontsChanged);
    fonts?.addEventListener?.("loadingdone", fontsChanged);
    onCleanup(() => fonts?.removeEventListener?.("loadingdone", fontsChanged));
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
  const step = createMemo((): TintStep | "turn" => {
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
      setShown(untrack(targetPage));
    }),
  );

  // The page turn: out, swap, in. Nothing on screen says there are pages.
  createEffect(
    on(
      targetPage,
      (target) => {
        if (target === untrack(shown)) return;
        const l = untrack(layout);
        if (!l || untrack(step) !== "turn" || typeof block.animate !== "function") {
          setShown(target);
          return;
        }
        const { easing } = glideTiming(block);
        const out = block.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: TURN_OUT_MS,
          easing,
          fill: "forwards",
        });
        out.onfinish = () => {
          setShown(target);
          block.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: TURN_IN_MS,
            easing,
            fill: "backwards",
          });
          out.cancel();
        };
      },
      { defer: true },
    ),
  );

  const findPart = (index: number) =>
    block.querySelector<HTMLElement>(`[data-part-index="${index}"]`);

  // The tint follows the current part, on the page shown.
  let tintLayout: Computed | null = null;
  let tintPage = -1;
  createEffect(() => {
    const l = layout();
    const page = shown();
    const index = currentIndex();
    const how = step();
    if (!l) return;
    const el = findPart(index);
    // Mid-turn the current part is on the other page: the tint stays where it
    // is, fading out with its page.
    if (!el && how === "turn") return;
    if (!el) {
      placeTint({ tint, ghost }, tintState, null, "snap", 0);
      return;
    }
    // Another layout or page is a landing, not a step.
    const landing = tintLayout !== l || tintPage !== page;
    tintLayout = l;
    tintPage = page;
    const em = Number.parseFloat(getComputedStyle(sheet).fontSize) || 0;
    placeTint(
      { tint, ghost },
      tintState,
      boxOf(el, block),
      landing || how === "turn" || props.all ? "snap" : how,
      em,
    );
  });

  const page = () => layout()?.pages[shown()]?.columns ?? [];
  const single = () => page().length === 1;
  const columnWidth = () => {
    const l = layout();
    const k = page().length || 1;
    const gap = (l?.sheetWidth ?? 0) * COLUMN_GAP;
    return ((l?.sheetWidth ?? 0) - (k - 1) * gap) / k;
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
        <div
          ref={block}
          class="full-block"
          style={{
            "--col-width": `${columnWidth()}px`,
            "--col-gap": `${(layout()?.sheetWidth ?? 0) * COLUMN_GAP}px`,
          }}
        >
          <div ref={tint} class="full-tint" aria-hidden="true" />
          <div ref={ghost} class="full-tint" style={{ display: "none" }} aria-hidden="true" />
          <For each={page()}>
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
                                  (!props.lit || (k >= props.lit.start && k < props.lit.end))),
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
    </div>
  );
}
