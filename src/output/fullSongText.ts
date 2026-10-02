// Full Song's text metrics (SDD-0005 § 2): how tall a part is at a column
// count and type scale, worked out by arithmetic instead of by building the
// part in the page. Each word is measured once, at one size, with the real
// font (canvas); wrapping at any width is then a sum over those widths, as the
// browser's greedy line breaking does it. The DOM is touched once per song,
// to measure, and once to check the layout that was chosen.

/** One breakable piece of a line: its width and the space before it, in em. */
export interface Segment {
  width: number;
  gap: number;
}

/** A part's lines, each as its segments. */
export interface PartMetrics {
  lines: Segment[][];
}

export interface SongMetrics {
  parts: PartMetrics[];
}

/** The line-height of `.full-line`, in em. */
export const LINE_HEIGHT = 1.35;
/** A part's padding, in em: 0.3 above and below, 0.6 each side. */
export const PART_PAD_X = 0.6;
export const PART_PAD_Y = 0.3;
/** A word may overhang its box by this many px and still fit (as the DOM
 * check allows). */
const FIT_TOLERANCE_PX = 1;

/** A line's breakable pieces: at spaces, and after a hyphen that joins
 * letters. Text that is blank has none (it takes no height). */
export function splitLine(text: string): string[][] {
  const words = text.split(/ +/).filter((w) => w.length > 0);
  return words.map((word) => word.split(/(?<=[^\s-]-)(?=[^\s\d-])/));
}

/** How many lines `segments` wrap to in `avail` em: greedy, as CSS does, a
 * trailing space hanging. A piece wider than `avail` takes a line of its own
 * and overflows (the words never break). */
export function wrappedLines(segments: Segment[], avail: number): number {
  if (segments.length === 0) return 0;
  let lines = 1;
  let used = 0;
  for (const [i, s] of segments.entries()) {
    if (i === 0) {
      used = s.width;
    } else if (used + s.gap + s.width <= avail + 1e-6) {
      used += s.gap + s.width;
    } else {
      lines += 1;
      used = s.width;
    }
  }
  return lines;
}

/** The widest piece of a line, in em. */
export const widest = (segments: Segment[]) =>
  segments.reduce((most, s) => Math.max(most, s.width), 0);

/**
 * The height, in em, of a part at a column of `avail` em inside its padding,
 * and whether every piece fits that width.
 */
export function partAt(part: PartMetrics, avail: number, tolerance: number) {
  let height = 0;
  let fits = true;
  for (const line of part.lines) {
    height += wrappedLines(line, avail) * LINE_HEIGHT;
    if (widest(line) > avail + tolerance) fits = false;
  }
  return { height: height + 2 * PART_PAD_Y, fits };
}

/**
 * A `Measure` (fullSong.ts) over metrics. `emFull` is the px size of the type
 * at fit 1; `sheetWidth` and `gap` the sheet's width and the gap between
 * columns, in px.
 */
export function analyticMeasure(
  song: SongMetrics,
  emFull: number,
  sheetWidth: number,
  gap: number,
) {
  return (columns: number, fit: number) => {
    const em = emFull * fit;
    const column = (sheetWidth - (columns - 1) * gap) / columns;
    const avail = column / em - 2 * PART_PAD_X;
    const tolerance = FIT_TOLERANCE_PX / em;
    const heights: number[] = [];
    const fits: boolean[] = [];
    for (const part of song.parts) {
      const at = partAt(part, avail, tolerance);
      heights.push(at.height * em);
      fits.push(at.fits);
    }
    return { heights, fits };
  };
}

// ---- Measuring, in the page ----

const REFERENCE_PX = 100;
let canvas: CanvasRenderingContext2D | null | undefined;

function context() {
  if (canvas === undefined) {
    try {
      canvas = document.createElement("canvas").getContext("2d");
    } catch {
      canvas = null;
    }
  }
  return canvas;
}

/** The metrics of a song's parts in a font (`family` as CSS writes it, and
 * `weight`). Without a canvas (a test's DOM) each character is half an em. */
export function measureSong(
  parts: { lines: string[] }[],
  family: string,
  weight: string,
): SongMetrics {
  const ctx = context();
  if (ctx) ctx.font = `${weight} ${REFERENCE_PX}px ${family}`;
  const width = (text: string) =>
    ctx && typeof ctx.measureText === "function"
      ? ctx.measureText(text).width / REFERENCE_PX
      : text.length * 0.5;
  const space = width(" ");
  return {
    parts: parts.map((part) => ({
      lines: part.lines.map((text) =>
        splitLine(text).flatMap((word) =>
          word.map((piece, k) => ({ width: width(piece), gap: k === 0 ? space : 0 })),
        ),
      ),
    })),
  };
}

/** A cheap signature of a song's parts: ids, line counts and a hash of the
 * text, so an edited song is measured and laid out again though its key is
 * the same. */
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

// ---- Kept, by what they depend on ----

const KEPT = 8;
const kept = new Map<string, SongMetrics>();
let fontEpoch = 0;
const fontListeners = new Set<() => void>();
let listeningTo: unknown;

/** Fonts arriving change widths: metrics are made again, and `listener` told.
 * Returns how to stop. */
export function onFontsChange(listener: () => void): () => void {
  fontListeners.add(listener);
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (fonts && listeningTo !== fonts) {
    listeningTo = fonts;
    const changed = () => {
      fontEpoch += 1;
      for (const l of [...fontListeners]) l();
    };
    // Already loaded: nothing arrived. Otherwise measure again once they have.
    if (fonts.status !== "loaded") void fonts.ready?.then(changed);
    fonts.addEventListener?.("loadingdone", changed);
  }
  return () => fontListeners.delete(listener);
}

/** The fonts' state, for keys: changes when a font arrives. */
export const fontsEpoch = () => fontEpoch;

/** A song's metrics, measured once per song and font. */
export function metricsFor(
  parts: { id: string; lines: string[] }[],
  family: string,
  weight: string,
): SongMetrics {
  const key = `${family}|${weight}|${fontEpoch}|${signature(parts)}`;
  let metrics = kept.get(key);
  if (!metrics) {
    metrics = measureSong(parts, family, weight);
    kept.set(key, metrics);
    // A face the text needs but the page has not used yet: ask for it now.
    const text = parts.flatMap((part) => part.lines).join(" ");
    void document.fonts?.load?.(`${weight} 16px ${family}`, text)?.catch?.(() => undefined);
    if (kept.size > KEPT) kept.delete(kept.keys().next().value as string);
  }
  return metrics;
}
