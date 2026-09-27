import type { PageSpan, Profile } from "./profile.ts";
import { type Band, findGutters, type SourceLine, type SourcePage } from "./source.ts";

/** A line in reading order, with where it sat. */
export interface FlowLine extends SourceLine {
  page: number;
  /** 0 is the leftmost column. */
  column: number;
  /** Space above it, × the book's line pitch; null at the top of a column. */
  gap: number | null;
}

export interface Flow {
  lines: FlowLine[];
  /** Baseline to baseline within a block, in points. */
  pitch: number;
  /** The widest line of each column, in points: what a line wraps against. */
  measure: number[];
  /** Page number → the number printed on it, where one is. */
  folios: Map<number, string>;
}

const FOLIO = /^(\d+|[ivxlcdm]+)$/i;

const within = (span: PageSpan, page: SourcePage) =>
  page.number >= span.from && page.number <= span.to;

/**
 * Lines → reading order: page, column, top to bottom (SDD-0003 §1). Drops the
 * page number. Columns are found per page by their gutters; a page with fewer
 * than most (a short last page) is split where most pages are.
 */
export function flow(pages: SourcePage[], profile: Profile): Flow {
  const folios = new Map<number, string>();
  const body = pages
    .filter((page) => within(profile.pages, page))
    .map((page) => {
      const lines = page.lines.filter((line) => {
        if (!profile.furniture.pageNumber || !FOLIO.test(line.text)) return true;
        folios.set(page.number, line.text);
        return false;
      });
      return { page, lines, gutters: findGutters(lines) };
    });

  const usual = mostCommon(body.map((b) => b.gutters.length));
  const fallback = body.find((b) => b.gutters.length === usual)?.gutters ?? [];

  const lines: FlowLine[] = [];
  for (const { page, lines: pageLines, gutters } of body) {
    const bands = gutters.length === usual ? gutters : fallback;
    const columnOf = (line: SourceLine) =>
      bands.filter((band: Band) => line.x >= band.to - 1).length;
    const ordered = pageLines
      .map((line) => ({ ...line, page: page.number, column: columnOf(line), gap: null }))
      .sort((a, b) => a.column - b.column || a.y - b.y || a.x - b.x);
    lines.push(...ordered);
  }

  const pitch = linePitch(lines);
  const measure: number[] = [];
  for (const [i, line] of lines.entries()) {
    const prev = lines[i - 1];
    if (prev && prev.page === line.page && prev.column === line.column) {
      line.gap = (line.y - prev.y) / pitch;
    }
    measure[line.column] = Math.max(measure[line.column] ?? 0, line.width);
  }
  return { lines, pitch, measure, folios };
}

/** The commonest baseline step between neighbours in a column. */
function linePitch(lines: FlowLine[]): number {
  const steps: number[] = [];
  for (const [i, line] of lines.entries()) {
    const prev = lines[i - 1];
    if (!prev || prev.page !== line.page || prev.column !== line.column) continue;
    const step = line.y - prev.y;
    if (step > 0 && step < 2 * line.size) steps.push(Math.round(step * 2) / 2);
  }
  return mostCommon(steps) || 1;
}

function mostCommon(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
}

export interface IndexEntry {
  number: number;
  title: string;
  /** As printed: the book's own page number. */
  page: string;
}

/**
 * The book's list of songs, read row by row: on each baseline, left to
 * right, a number, a title and a page, repeated per column. Rows that don't
 * fit that shape (headings) are skipped.
 */
export function readIndex(pages: SourcePage[], span: PageSpan): IndexEntry[] {
  const entries: IndexEntry[] = [];
  for (const page of pages.filter((p) => within(span, p))) {
    const rows = new Map<number, SourceLine[]>();
    for (const line of page.lines) {
      const key = [...rows.keys()].find((y) => Math.abs(y - line.y) < line.size * 0.3) ?? line.y;
      rows.set(key, [...(rows.get(key) ?? []), line]);
    }
    for (const row of rows.values()) {
      const cells = row.sort((a, b) => a.x - b.x).map((line) => line.text);
      for (let i = 0; i + 3 <= cells.length; i += 3) {
        const [number, title, at] = cells.slice(i, i + 3);
        if (/^\d+$/.test(number) && FOLIO.test(at)) {
          entries.push({ number: Number(number), title, page: at });
        }
      }
    }
  }
  return entries.sort((a, b) => a.number - b.number);
}
