/**
 * What every reader produces: pages of positioned, styled lines (SDD-0003 §2).
 * Pure, like src/domain/: no Node, DOM or library imports, so the browser
 * runs it unchanged.
 */

export interface SourceLine {
  text: string;
  /** Left edge and baseline, in points, origin top-left. */
  x: number;
  y: number;
  width: number;
  size: number;
  /** The line's dominant font, e.g. "TimesNewRomanPS-ItalicMT". */
  font: string;
}

export interface SourcePage {
  /** 1-based. */
  number: number;
  width: number;
  height: number;
  /** Top to bottom, then left to right. Columns are the flow stage's job. */
  lines: SourceLine[];
}

/** One run of text as a reader finds it, in the same coordinates as a line. */
export interface SourceRun {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  font: string;
}

/** A reason a document can't be imported, worded for the person importing it. */
export class ImportError extends Error {
  override name = "ImportError";
}

/** Subset fonts carry a random six-letter tag: "OYCPPR+Times-Italic" → "Times-Italic". */
export const fontKey = (name: string) => name.replace(/^[A-Z]{6}\+/, "");

/** Runs share a baseline when theirs differ by less than this, × font size. */
const BASELINE = 0.3;
/** A gap wider than this, × font size, is a word space. */
const SPACE = 0.15;

/** A band of the page, left to right, in points. */
export interface Band {
  from: number;
  to: number;
}

/**
 * Column gutters: vertical bands of the page that text does not cross,
 * with text beside them on both sides.
 *
 * No gap width tells a gutter from a word space. In a justified line a space
 * stretches to 1.6 em, wider than the narrowest gutter in Hymns of Fellowship
 * (1.5 em). But a line's stretched spaces fall at different places on every
 * line, while a gutter is empty all the way down the page.
 */
export function findGutters(runs: SourceRun[]): Band[] {
  if (runs.length === 0) return [];
  const left = Math.floor(Math.min(...runs.map((run) => run.x)));
  const right = Math.ceil(Math.max(...runs.map((run) => run.x + run.width)));
  const cover = new Uint16Array(right - left);
  for (const run of runs) {
    const end = Math.min(Math.ceil(run.x + run.width), right);
    for (let x = Math.floor(run.x); x < end; x++) cover[x - left]++;
  }

  // A stray run across a gutter, a folio or a centred heading, is tolerated.
  const tolerated = Math.max(1, Math.floor(runs.length * 0.02));
  const em = median(runs.map((run) => run.size));
  const bands: Band[] = [];
  let start: number | undefined;
  for (let i = 0; i <= cover.length; i++) {
    const open = i < cover.length && cover[i] <= tolerated;
    if (open && start === undefined) start = i;
    if (!open && start !== undefined) {
      const band = { from: left + start, to: left + i };
      if (band.to - band.from >= em / 4 && linesBeside(runs, band) >= GUTTER_LINES) {
        bands.push(band);
      }
      start = undefined;
    }
  }
  return bands;
}

/** A gutter separates text on at least this many baselines. */
const GUTTER_LINES = 3;

/**
 * How many runs start right of the band while another on their baseline
 * starts left of it and stops short of the next column. The band's left edge
 * can sit inside a column's longest line, the one run tolerated across it.
 */
function linesBeside(runs: SourceRun[], band: Band): number {
  const ends = runs.filter((run) => run.x < band.from && run.x + run.width <= band.to - 1);
  return runs.filter(
    (run) =>
      run.x >= band.to - 1 && ends.some((end) => Math.abs(end.y - run.y) <= BASELINE * run.size),
  ).length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Assembles runs into lines by position alone. Content-stream order is not
 * trusted: a PDF may draw a line in any order, and interleave columns. Runs on
 * one baseline form one line, unless a gutter falls between them.
 */
export function linesFromRuns(runs: SourceRun[]): SourceLine[] {
  const sorted = runs
    .filter((run) => run.text.trim() !== "")
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const gutters = findGutters(sorted);

  const baselines: SourceRun[][] = [];
  for (const run of sorted) {
    const current = baselines.at(-1);
    if (current && run.y - current[0].y <= BASELINE * run.size) current.push(run);
    else baselines.push([run]);
  }

  const lines: SourceLine[] = [];
  // A gutter's right edge is where the next column starts: exact, where its
  // left edge is ragged, and widened by any tolerated run.
  const splits = (a: SourceRun, b: SourceRun) =>
    gutters.some((g) => a.x < g.to - 1 && b.x >= g.to - 1);
  for (const baseline of baselines) {
    baseline.sort((a, b) => a.x - b.x);
    let group: SourceRun[] = [];
    for (const run of baseline) {
      const last = group.at(-1);
      if (last && splits(last, run)) {
        lines.push(toLine(group));
        group = [];
      }
      group.push(run);
    }
    lines.push(toLine(group));
  }
  return lines.sort((a, b) => a.y - b.y || a.x - b.x);
}

function toLine(runs: SourceRun[]): SourceLine {
  let text = "";
  for (const [i, run] of runs.entries()) {
    const prev = runs[i - 1];
    const gap = prev ? run.x - (prev.x + prev.width) : 0;
    if (prev && gap > SPACE * run.size && !/\s$/.test(text) && !/^\s/.test(run.text)) {
      text += " ";
    }
    text += run.text;
  }

  // The dominant font is the one carrying the most characters.
  const chars = new Map<string, number>();
  for (const run of runs) chars.set(run.font, (chars.get(run.font) ?? 0) + run.text.length);
  const font = [...chars].sort((a, b) => b[1] - a[1])[0][0];
  const size = Math.max(...runs.filter((run) => run.font === font).map((run) => run.size));

  const first = runs[0];
  const last = runs[runs.length - 1];
  return {
    text: text.replace(/\s+/g, " ").trim(),
    x: first.x,
    y: Math.min(...runs.map((run) => run.y)),
    width: last.x + last.width - first.x,
    size,
    font,
  };
}
