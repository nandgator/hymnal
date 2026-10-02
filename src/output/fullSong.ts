// The Output's Full Song layout rule (SDD-0005 § 2–3): parts in printed order,
// whole, cut into balanced columns, the type as large as everything fits,
// pages below a floor. Pure: the DOM is reached only through `measure`.

/** The type scale at its fullest: the scale model's own size. */
export const FULL_FIT_MAX = 1;
/** Below this the song splits into pages (24px on a 1080p screen). */
export const FULL_FIT_FLOOR = 0.3;
/** The least the type will ever go, when even pages cannot reach the floor. */
export const FULL_FIT_MIN = 0.15;
export const MAX_COLUMNS = 4;
/** A column is added only if it buys more than 1/COLUMN_GAIN in type size. */
export const COLUMN_GAIN = 0.9;
const BISECTIONS = 14;
/** Heights this close are the same: layout rounds. */
const EPSILON = 0.5;

export interface Measured {
  /** Each part's height in px at this column count and scale, padding in. */
  heights: number[];
  /** Whether each part's longest word fits the column's width. */
  fits: boolean[];
}

/** Measures every part (by printed index) at a column count and scale. */
export type Measure = (columns: number, fit: number) => Measured;

export interface FullLayout {
  /** The type scale, a multiplier of the Output's line size. */
  fit: number;
  /** Pages, each a list of columns, each a list of printed part indices. */
  pages: { columns: number[][] }[];
  /** No split reached the floor: a part too tall, the type below it. */
  belowFloor: boolean;
}

export interface Balanced {
  tallest: number;
  /** Runs of indices into `heights`, in order. */
  groups: number[][];
}

/**
 * Cut `heights` into exactly `count` runs of whole items in order, the
 * tallest run as short as it can be; among equal tallest, the one whose
 * squared run heights sum least (the most even); among those, the earlier runs
 * fuller (a column of the printed page fills before the next). Null if there are fewer
 * items than runs.
 */
export function balance(heights: number[], count: number): Balanced | null {
  const n = heights.length;
  if (count < 1 || count > n) return null;
  const prefix = [0];
  for (const h of heights) prefix.push(prefix[prefix.length - 1] + h);
  // best[c][j]: the best way to cut the first j items into c runs; `from` is
  // where its last run begins (a back-pointer, so no array is copied).
  type Cell = { max: number; squares: number; from: number };
  const best: (Cell | null)[][] = Array.from({ length: count + 1 }, () => Array(n + 1).fill(null));
  best[0][0] = { max: 0, squares: 0, from: -1 };
  for (let c = 1; c <= count; c++) {
    for (let j = c; j <= n; j++) {
      for (let i = c - 1; i < j; i++) {
        const before = best[c - 1][i];
        if (!before) continue;
        const run = prefix[j] - prefix[i];
        const max = Math.max(before.max, run);
        const squares = before.squares + run * run;
        const now = best[c][j];
        const better =
          !now ||
          max < now.max - EPSILON ||
          (Math.abs(max - now.max) <= EPSILON && squares <= now.squares + EPSILON);
        if (better) best[c][j] = { max, squares, from: i };
      }
    }
  }
  const last = best[count][n];
  if (!last) return null;
  const groups: number[][] = [];
  for (let c = count, to = n; c >= 1; c--) {
    const from = (best[c][to] as Cell).from;
    groups.unshift(Array.from({ length: to - from }, (_, k) => from + k));
    to = from;
  }
  return { tallest: last.max, groups };
}

interface PageFit {
  fit: number;
  columns: number;
  /** The tallest column at that fit, for comparing when nothing is feasible. */
  tallest: number;
}

/** What a page of `parts` (printed indices) does at one column count and scale. */
function tryColumns(
  parts: number[],
  columns: number,
  fit: number,
  measure: Measure,
  room: number,
): Balanced | null {
  if (columns > parts.length) return null;
  const measured = measure(columns, fit);
  if (parts.some((p) => !measured.fits[p])) return null;
  const balanced = balance(
    parts.map((p) => measured.heights[p]),
    columns,
  );
  if (!balanced || balanced.tallest > room + EPSILON) return null;
  return balanced;
}

/** The page's largest feasible scale per column count, and the count chosen. */
function fitPage(parts: number[], measure: Measure, room: number): PageFit {
  const options: PageFit[] = [];
  for (let columns = 1; columns <= Math.min(MAX_COLUMNS, parts.length); columns++) {
    const feasible = (fit: number) => tryColumns(parts, columns, fit, measure, room);
    let fit = 0;
    if (feasible(FULL_FIT_MAX)) fit = FULL_FIT_MAX;
    else if (feasible(FULL_FIT_MIN)) {
      let low = FULL_FIT_MIN;
      let high = FULL_FIT_MAX;
      for (let i = 0; i < BISECTIONS; i++) {
        const mid = (low + high) / 2;
        if (feasible(mid)) low = mid;
        else high = mid;
      }
      fit = low;
    }
    // The tallest column at the fit found, or at the least when none fits:
    // measured once, not per part.
    const at = fit || FULL_FIT_MIN;
    const heights = measure(columns, at).heights;
    const tallest =
      balance(
        parts.map((p) => heights[p]),
        columns,
      )?.tallest ?? Number.POSITIVE_INFINITY;
    options.push({ fit, columns, tallest });
  }
  const best = Math.max(...options.map((o) => o.fit));
  if (best === 0) {
    // Nothing fits even at the least: the shortest tallest column, at the least.
    const shortest = options.reduce((a, b) => (b.tallest < a.tallest ? b : a));
    return { ...shortest, fit: FULL_FIT_MIN };
  }
  return options.find((o) => o.fit > 0 && o.fit >= best * COLUMN_GAIN) as PageFit;
}

/** A page's columns at the song's scale: its own count, or more if wrapping
 * made that one infeasible there. */
function columnsAt(
  parts: number[],
  preferred: number,
  fit: number,
  measure: Measure,
  room: number,
): number[][] {
  const counts = [preferred];
  for (let c = 1; c <= Math.min(MAX_COLUMNS, parts.length); c++)
    if (c !== preferred) counts.push(c);
  for (const columns of counts) {
    const balanced = tryColumns(parts, columns, fit, measure, room);
    if (balanced) return balanced.groups.map((g) => g.map((k) => parts[k]));
  }
  // Nothing is feasible (a part taller than the room): the most even cut at
  // the preferred count, overflowing.
  const heights = measure(preferred, fit).heights;
  const fallback = balance(
    parts.map((p) => heights[p]),
    Math.min(preferred, parts.length),
  );
  return (fallback?.groups ?? [parts.map((_, k) => k)]).map((g) => g.map((k) => parts[k]));
}

/**
 * The layout of a song of `count` parts in `room` px of height.
 *
 * One page if its best fit reaches {@link FULL_FIT_FLOOR}. Otherwise the
 * fewest pages (whole parts, balanced by their heights at one column and the
 * floor) whose smallest page fit reaches it; if none does, the split with the
 * largest fit, flagged below the floor. The type is one size for the song:
 * the smallest page's.
 */
export function layoutSong(count: number, measure: Measure, room: number): FullLayout {
  if (count <= 0) return { fit: FULL_FIT_MAX, pages: [], belowFloor: false };
  const all = Array.from({ length: count }, (_, i) => i);
  const whole = fitPage(all, measure, room);
  const single = (): FullLayout => ({
    fit: whole.fit,
    pages: [{ columns: columnsAt(all, whole.columns, whole.fit, measure, room) }],
    belowFloor: whole.fit < FULL_FIT_FLOOR,
  });
  if (whole.fit >= FULL_FIT_FLOOR || count === 1) return single();

  const weights = measure(1, FULL_FIT_FLOOR).heights;
  let chosen: { pages: number[][]; fits: PageFit[]; fit: number } | null = null;
  for (let pages = 2; pages <= count; pages++) {
    const cut = balance(weights, pages);
    if (!cut) break;
    const fits = cut.groups.map((g) => fitPage(g, measure, room));
    const fit = Math.min(...fits.map((f) => f.fit));
    if (!chosen || fit > chosen.fit) chosen = { pages: cut.groups, fits, fit };
    if (fit >= FULL_FIT_FLOOR) {
      chosen = { pages: cut.groups, fits, fit };
      break;
    }
  }
  if (!chosen || chosen.fit <= whole.fit) return single();
  const { pages, fits, fit } = chosen;
  return {
    fit,
    pages: pages.map((g, i) => ({ columns: columnsAt(g, fits[i].columns, fit, measure, room) })),
    belowFloor: fit < FULL_FIT_FLOOR,
  };
}
