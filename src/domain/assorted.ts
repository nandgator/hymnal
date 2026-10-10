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
