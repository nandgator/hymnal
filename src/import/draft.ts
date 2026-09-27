import type { HymnbookSource, HymnSource } from "../domain/types.ts";
import { CONTENT_FORMAT, hymnFileName, validateCorpus } from "../domain/validate.ts";
import { flow, type IndexEntry, readIndex } from "./flow.ts";
import { toParts } from "./parts.ts";
import type { Profile } from "./profile.ts";
import type { Note } from "./report.ts";
import { findSongs } from "./songs.ts";
import type { SourcePage } from "./source.ts";

export interface Draft {
  hymnbook: HymnbookSource;
  hymns: HymnSource[];
  notes: Note[];
  /** One line each: what was found, for the top of the report. */
  summary: string[];
}

/**
 * Pages → a draft hymnbook in the content format, and every note on it
 * (SDD-0003 §1). Pure: the caller reads the file and writes the result.
 */
export function draftBook(pages: SourcePage[], profile: Profile): Draft {
  const notes: Note[] = [];
  const flowed = flow(pages, profile);
  const found = findSongs(flowed.lines, profile, notes);
  const index = profile.index ? readIndex(pages, profile.index.pages) : [];
  const listed = new Map(index.map((entry) => [entry.number, entry]));

  const hymns: HymnSource[] = [];
  const numbers = new Set<number>();
  let last = 0;
  for (const song of found) {
    if (numbers.has(song.number)) {
      notes.push({
        kind: "number",
        hymn: song.number,
        page: song.page,
        message: `printed again, as "${song.title}"; this copy is left out`,
      });
      continue;
    }
    if (song.number < last) {
      notes.push({
        kind: "number",
        hymn: song.number,
        page: song.page,
        message: `out of order, after ${last}`,
      });
    }
    last = Math.max(last, song.number);
    numbers.add(song.number);
    if (song.lines.length === 0) continue;

    const { parts, sequence } = toParts(song, flowed, profile, notes);
    const entry = listed.get(song.number);
    const title = titleOf(
      song.title,
      entry,
      parts.flatMap((p) => p.lines),
    );
    if (entry) checkAgainstIndex(song, entry, title, flowed.folios, notes);
    hymns.push({ number: song.number, title, parts, sequence, meta: {} });
  }
  hymns.sort((a, b) => a.number - b.number);

  const highest = hymns.at(-1)?.number ?? 0;
  const missing = range(1, highest).filter((n) => !numbers.has(n));
  if (missing.length > 0) {
    notes.push({ kind: "number", message: `no song numbered ${missing.join(", ")}` });
  }
  for (const entry of index.filter((e) => !numbers.has(e.number))) {
    notes.push({
      kind: "index",
      hymn: entry.number,
      message: `listed as "${entry.title}" on p.${entry.page}, and not found`,
    });
  }

  const hymnbook: HymnbookSource = {
    format: CONTENT_FORMAT,
    ...profile.hymnbook,
    hymnCount: hymns.length,
  };
  const files = hymns.map((hymn) => ({ file: hymnFileName(hymn.number), hymn }));
  for (const v of validateCorpus(hymnbook, files)) {
    notes.push({ kind: "invalid", message: `${v.where}: ${v.message} (${v.rule})` });
  }

  const count = (kind: string) => hymns.filter((h) => h.parts.some((p) => p.kind === kind)).length;
  const summary = [
    `${hymns.length} songs, numbered 1–${highest}; ${index.length} listed in the index`,
    `${count("chorus")} with a chorus, ${count("bridge")} with a bridge, ${count("outro")} with an ending`,
    `line pitch ${flowed.pitch} pt; column measures ${flowed.measure.map((m) => m.toFixed(0)).join(", ")} pt`,
    `${notes.length} notes`,
  ];
  return { hymnbook, hymns, notes, summary };
}

/**
 * The index's title where it names the same song as the heading (it is set
 * in the book's own case, where headings are often capitals). Otherwise
 * the heading, recased from the song's own words.
 */
function titleOf(heading: string, entry: IndexEntry | undefined, lines: string[]): string {
  if (entry && simplify(entry.title) === simplify(heading)) return entry.title;
  const WORD = /[\p{L}’']+/gu;
  const cased = new Map<string, string>();
  for (const word of lines.join(" ").match(WORD)?.reverse() ?? []) {
    cased.set(word.toLowerCase(), word);
  }
  // Only words set in capitals are recased; "(Psalms 5:1-3)" stays as printed.
  const recased = heading.replace(WORD, (word) =>
    word.length > 1 && word === word.toUpperCase()
      ? (cased.get(word.toLowerCase()) ?? word.toLowerCase())
      : word,
  );
  return recased.charAt(0).toUpperCase() + recased.slice(1);
}

const simplify = (title: string) =>
  title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();

function checkAgainstIndex(
  song: { number: number; title: string; page: number },
  entry: IndexEntry,
  title: string,
  folios: Map<number, string>,
  notes: Note[],
) {
  const at = { hymn: song.number, page: song.page };
  if (title !== entry.title) {
    notes.push({
      kind: "index",
      ...at,
      message: `headed "${song.title}", listed as "${entry.title}"; titled "${title}"`,
    });
  }
  const folio = folios.get(song.page);
  if (folio !== undefined && folio !== entry.page) {
    notes.push({
      kind: "index",
      ...at,
      message: `listed on p.${entry.page}, printed on p.${folio}`,
    });
  }
}

const range = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
