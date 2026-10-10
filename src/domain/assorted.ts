import type { HymnbookSource, HymnSource } from "./types.ts";

/**
 * Assorted Hymns, the person's own book of single songs (ADR-0031, SDD-0004
 * §17). Pure: the registry and the package come in as data.
 */

/** The origin of the one Assorted Hymns a device holds. */
export const ASSORTED_ORIGIN = "assorted";
export const ASSORTED_TITLE = "Assorted Hymns";
/** BCP-47 "multiple languages" and ISO 15924 "common". */
export const ASSORTED_LANGUAGE = "mul";
export const ASSORTED_SCRIPT = "Zyyy";

/** A BCP-47 tag in shape (subtags of letters and digits, the first a language): not a registry lookup. */
export const isLanguageTag = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(value);

/** An ISO 15924 code: four letters, the first capital. */
export const isScriptCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z][a-z]{3}$/.test(value);

/** Code point order, which is not the order of `<` on UTF-16 units, and not locale order. */
function byCodePoint(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

/** A collator for a tag, or the default one for a tag the runtime does not know. */
function collatorFor(language: string, made: Map<string, Intl.Collator>): Intl.Collator {
  let collator = made.get(language);
  if (!collator) {
    try {
      collator = new Intl.Collator(language);
    } catch {
      collator = new Intl.Collator();
    }
    made.set(language, collator);
  }
  return collator;
}

/**
 * The order Assorted Hymns' songs are listed in: by the song's language tag
 * (code point order), then by title with `Intl.Collator(language)`, then by
 * number. A number still finds its song; this changes only the view. A song
 * with no language sorts first. Returns a new array.
 */
export function assortedOrder<T extends { number: number; title: string; language?: string }>(
  songs: readonly T[],
): T[] {
  const made = new Map<string, Intl.Collator>();
  return [...songs].sort((a, b) => {
    const la = a.language ?? "";
    const lb = b.language ?? "";
    if (la !== lb) return byCodePoint(la, lb);
    return collatorFor(la, made).compare(a.title, b.title) || a.number - b.number;
  });
}

/**
 * The book and songs as `validateCorpus` knows them: format 1 has no
 * `nextNumber` and no per-song `language` or `script`, and refuses them, so the
 * check is on a copy without them.
 */
export function asContainerShape(
  book: HymnbookSource,
  hymns: readonly HymnSource[],
): { book: HymnbookSource; hymns: HymnSource[] } {
  const { nextNumber: _next, ...rest } = book;
  return {
    book: rest,
    hymns: hymns.map(({ language: _language, script: _script, ...hymn }) => hymn),
  };
}

/** What adding one song to Assorted Hymns gives, before it is written. */
export interface AssortedPlan {
  book: HymnbookSource;
  hymns: HymnSource[];
  /** The number the new song took. */
  number: number;
}

/**
 * Appends a song under `nextNumber` (1 for a book not yet made) and moves the
 * counter one past it. Never reuses a number, whatever the songs held now.
 */
export function addSong(
  existing: { hymns: readonly HymnSource[]; nextNumber: number | null } | null,
  song: HymnSource,
  language: string,
  script: string,
): AssortedPlan {
  const held = existing?.hymns ?? [];
  const highest = held.reduce((max, h) => Math.max(max, h.number), 0);
  // A counter below a held number would reuse it; the larger of the two is safe.
  const number = Math.max(existing?.nextNumber ?? 1, highest + 1);
  const hymns = [...held, { ...song, number, language, script }];
  return {
    number,
    hymns,
    book: assortedBook(hymns.length, number + 1),
  };
}

/** The book record of Assorted Hymns for `count` songs. */
export const assortedBook = (count: number, nextNumber: number): HymnbookSource => ({
  format: 1,
  id: ASSORTED_ORIGIN,
  title: ASSORTED_TITLE,
  language: ASSORTED_LANGUAGE,
  script: ASSORTED_SCRIPT,
  hymnCount: count,
  nextNumber,
});

/** What merging a backup's Assorted Hymns into the device's gives, before it is written. */
export interface MergePlan {
  /** The device's songs, then each added one under the number it took. */
  hymns: HymnSource[];
  nextNumber: number;
  /**
   * For every song of the backup, the number the device holds it under: the one
   * it took if it was added, the device's own copy's if it was already there.
   */
  numbers: Map<number, number>;
  added: number;
}

/**
 * Merges a backup's songs into the device's (SDD-0004 §17, "Backup and
 * restore"). The backup's songs are taken in number order. One whose hash is
 * already on the device is skipped and points at the device's copy. Any other
 * keeps its backup number if that is at or above the counter (every number
 * below it is held or retired), else it takes the counter; either way the
 * counter then moves one past it. The counter starts as `addSong`'s does: the
 * larger of `next_number` and one past the highest number held. Each song
 * carries its own language and script.
 */
export function mergeSongs(
  device: { hymns: readonly HymnSource[]; nextNumber: number | null },
  deviceHashes: ReadonlyMap<number, string>,
  incoming: readonly HymnSource[],
  incomingHashes: ReadonlyMap<number, string>,
): MergePlan {
  // The backup's own retired numbers are not carried (SDD-0004 §17); recents on them are dropped.
  const held = new Map<string, number>();
  for (const [number, hash] of [...deviceHashes].sort((a, b) => a[0] - b[0])) {
    if (!held.has(hash)) held.set(hash, number);
  }
  const highest = device.hymns.reduce((max, h) => Math.max(max, h.number), 0);
  let next = Math.max(device.nextNumber ?? 1, highest + 1);
  const hymns = [...device.hymns];
  const numbers = new Map<number, number>();
  let added = 0;
  for (const song of [...incoming].sort((a, b) => a.number - b.number)) {
    const hash = incomingHashes.get(song.number);
    const there = hash === undefined ? undefined : held.get(hash);
    if (there !== undefined) {
      numbers.set(song.number, there);
      continue;
    }
    const number = song.number >= next ? song.number : next;
    next = number + 1;
    hymns.push({ ...song, number });
    numbers.set(song.number, number);
    if (hash !== undefined) held.set(hash, number);
    added++;
  }
  return { hymns, nextNumber: next, numbers, added };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A backup's user-state document with its recents and position on one book
 * moved to another key and its songs to other numbers, before the user-state
 * merge. An entry on a number that `numbers` does not know is dropped, since
 * under the device's key it would name another song. Pure; the document is
 * untrusted and goes through `cleanUserDoc` after.
 */
export function followBook(
  doc: unknown,
  from: string,
  to: string,
  numbers: ReadonlyMap<number, number>,
): unknown {
  if (!isRecord(doc)) return doc;
  const moved = (entry: Record<string, unknown>) => {
    const number = typeof entry.hymnNumber === "number" ? numbers.get(entry.hymnNumber) : undefined;
    return number === undefined ? null : { ...entry, hymnbookId: to, hymnNumber: number };
  };
  const out: Record<string, unknown> = { ...doc };
  if (Array.isArray(doc.recents)) {
    out.recents = doc.recents.flatMap((entry: unknown) => {
      if (!isRecord(entry) || entry.hymnbookId !== from) return [entry];
      const next = moved(entry);
      return next ? [next] : [];
    });
  }
  const position = doc.lastPosition;
  if (isRecord(position) && position.hymnbookId === from) {
    const next = moved(position);
    if (next) out.lastPosition = next;
    else delete out.lastPosition;
  }
  return out;
}
