import type { HymnbookSource, HymnSource } from "./types.ts";

/**
 * Your books, the books a person makes (ADR-0033, SDD-0004 §17). Pure: the
 * registry and the package come in as data.
 */

/** The origin of the default book of yours, the one a song goes to when none is chosen. */
export const ASSORTED_ORIGIN = "assorted";
export const ASSORTED_TITLE = "Assorted Hymns";
/** The origin of every other book of yours. */
export const OWN_ORIGIN = "own";
/** BCP-47 "multiple languages" and ISO 15924 "common". */
export const OWN_LANGUAGE = "mul";
export const OWN_SCRIPT = "Zyyy";

/** A package of this origin is a book of yours, whatever else the registry says of it. */
export const isOwnOrigin = (origin: string): boolean =>
  origin === ASSORTED_ORIGIN || origin === OWN_ORIGIN;

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
 * The order a book of yours lists its songs in: by the song's language tag
 * (code point order), then by title with `Intl.Collator(language)`, then by
 * number. A number still finds its song; this changes only the view. A song
 * with no language sorts first. Returns a new array.
 */
export function ownOrder<T extends { number: number; title: string; language?: string }>(
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

/** Where songs are added (ADR-0033 §4): one of your books, the default one, or a new one. */
export type OwnTarget =
  | { kind: "book"; key: string }
  /** The book with origin `assorted`, made if the device has none. */
  | { kind: "default" }
  | { kind: "new"; title: string };

/** What adding songs to a book of yours says of it, before anything is written (ADR-0033 §5). */
export interface OwnStatus {
  /** The book's key; null for a book not made yet (a new one, or the default before its first song). */
  key: string | null;
  origin: string;
  title: string;
  /** The number a song with none takes; null when the book cannot be opened, so nothing is added. */
  next: number | null;
  /** The file's songs already in the book by hash: the file's number to the number the book holds it under. */
  has: Record<number, number>;
  /** The numbers the file's other songs take if added (a song twice in the file counts once). */
  adding: number[];
  /** Why the songs cannot be added, in words (a number held or retired); absent when they can. */
  problem?: string;
}

/**
 * The status of a book for the songs of a file, before the file is added. `hymns`
 * are the file's songs, `held` the book's songs by hash (an empty book if it is
 * not made yet), `hashes` the file's songs' hashes by their number. A song of the
 * file whose hash the book holds is not added again and is not checked for a number.
 */
export function ownStatus(
  book: { key: string | null; origin: string; title: string },
  next: number | null,
  held: ReadonlyMap<string, number>,
  hymns: readonly { number: number; title: string }[],
  hashes: ReadonlyMap<number, string>,
): OwnStatus {
  const has: Record<number, number> = {};
  const fresh: { number: number; title: string }[] = [];
  const batch = new Set<string>();
  for (const hymn of hymns) {
    const hash = hashes.get(hymn.number);
    const there = hash === undefined ? undefined : held.get(hash);
    if (there !== undefined) {
      has[hymn.number] = there;
      continue;
    }
    if (hash !== undefined && batch.has(hash)) continue; // the same song twice in the file
    if (hash !== undefined) batch.add(hash);
    fresh.push(hymn);
  }
  const problem = next === null ? undefined : numberProblem(next, fresh);
  return {
    ...book,
    next,
    has,
    adding: fresh.map((h) => h.number),
    ...(problem ? { problem } : {}),
  };
}

/**
 * ADR-0033 §5: a number written in the text is kept when it is at or above the
 * book's next number (every number below it is held or retired) and not used
 * twice in the batch. Says which song and why, or nothing.
 */
export function numberProblem(
  next: number,
  songs: readonly { number: number; title: string }[],
): string | undefined {
  const seen = new Set<number>();
  for (const song of songs) {
    if (song.number < next) {
      return `Song ${song.number} “${song.title}” is numbered ${song.number}, which this book already holds or has retired. Its next free number is ${next}.`;
    }
    if (seen.has(song.number)) {
      return `Song ${song.number} “${song.title}” has a number that another song of these also has.`;
    }
    seen.add(song.number);
  }
  return undefined;
}

/**
 * The status that answers `target`, from the statuses a review lists: every book
 * of yours, the default one (made-to-be if the device has none, `key` null) and
 * a new one (`key` null, origin `own`, which takes the title the person gives).
 */
export function statusFor(list: readonly OwnStatus[], target: OwnTarget): OwnStatus | undefined {
  if (target.kind === "book") return list.find((s) => s.key === target.key);
  if (target.kind === "default") return list.find((s) => s.origin === ASSORTED_ORIGIN);
  const fresh = list.find((s) => s.key === null && s.origin === OWN_ORIGIN);
  return fresh && { ...fresh, title: target.title };
}

/** What adding songs to a book of yours gives, before it is written. */
export type OwnPlan =
  | {
      ok: true;
      book: HymnbookSource;
      hymns: HymnSource[];
      /** The songs added, with the hash each has. */
      added: { number: number; hash: string }[];
      /** The file's songs the book held already by hash, by the file's number: the number there. */
      already: Map<number, number>;
    }
  | { ok: false; message: string };

/**
 * Appends songs, each under its own number (ADR-0033 §5), and moves the counter
 * past the highest given. A song whose hash the book holds (or an earlier song
 * of the batch has) is not added twice. Never reuses a number, whatever the
 * songs held now. A song without its own language and script takes `language`
 * and `script`.
 */
export function addSongs(
  existing: { hymns: readonly HymnSource[]; nextNumber: number | null } | null,
  held: ReadonlyMap<string, number>,
  book: { origin: string; title: string },
  songs: readonly { hymn: HymnSource; hash: string }[],
  language: string,
  script: string,
): OwnPlan {
  const kept = existing?.hymns ?? [];
  const highest = kept.reduce((max, h) => Math.max(max, h.number), 0);
  // A counter below a held number would reuse it; the larger of the two is safe.
  const next = Math.max(existing?.nextNumber ?? 1, highest + 1);
  const already = new Map<number, number>();
  const fresh: { hymn: HymnSource; hash: string }[] = [];
  const batch = new Map<string, number>();
  for (const song of songs) {
    const there = held.get(song.hash) ?? batch.get(song.hash);
    if (there !== undefined) {
      already.set(song.hymn.number, there);
      continue;
    }
    batch.set(song.hash, song.hymn.number);
    fresh.push(song);
  }
  const problem = numberProblem(
    next,
    fresh.map((s) => s.hymn),
  );
  if (problem) return { ok: false, message: problem };
  const hymns = [
    ...kept,
    ...fresh.map(({ hymn }) => ({
      ...hymn,
      language: hymn.language ?? language,
      script: hymn.script ?? script,
    })),
  ];
  const top = fresh.reduce((max, s) => Math.max(max, s.hymn.number), 0);
  return {
    ok: true,
    hymns,
    book: ownBook(book.origin, book.title, hymns.length, Math.max(next, top + 1)),
    added: fresh.map((s) => ({ number: s.hymn.number, hash: s.hash })),
    already,
  };
}

/** The book record of a book of yours for `count` songs. */
export const ownBook = (
  origin: string,
  title: string,
  count: number,
  nextNumber: number,
): HymnbookSource => ({
  format: 1,
  id: origin,
  title,
  language: OWN_LANGUAGE,
  script: OWN_SCRIPT,
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
 * Merges a backup's songs into the device's book of the same kind (SDD-0004 §17,
 * "Backup and restore"). The backup's songs are taken in number order. One whose hash is
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

/**
 * The Library's order of books (SDD-0004 §17): your books first, the rest as the
 * registry lists them. The Library's rows and the Finder's groups (SDD-0001
 * §13.1) share it.
 */
export function libraryOrder<T extends { kind: string }>(books: readonly T[]): T[] {
  return [...books.filter((b) => b.kind === "own"), ...books.filter((b) => b.kind !== "own")];
}
