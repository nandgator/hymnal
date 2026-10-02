import { type SongHashes, sameSongs } from "./hash.ts";

/**
 * The duplicate check of SDD-0004 §8: what loading a file would do, against
 * the books held. Pure: the registry's rows come in as data.
 */

/** A book held, as the registry knows it: its sources and a hash per song. */
export interface HeldBook {
  key: string;
  title: string;
  origin: string;
  kind: "shipped" | "loaded";
  /** Only an `ok` book is compared: the others have no song or source rows. */
  state: string;
  sources: readonly string[];
  songs: SongHashes;
}

/** What is known of a file once it is read and valid. */
export interface Incoming {
  sourceHash: string;
  origin: string;
  songHashes: SongHashes;
}

export interface BookRef {
  key: string;
  title: string;
}

/** The rows of §8's table, in its order: the first that holds wins. */
export type Verdict =
  | { kind: "same-file"; book: BookRef }
  | { kind: "same-songs"; book: BookRef }
  /** Keep both is always offered; Replace for each book that is not shipped. */
  | { kind: "same-origin"; books: (BookRef & { replaceable: boolean })[] }
  | { kind: "new" };

const ref = (b: HeldBook): BookRef => ({ key: b.key, title: b.title });

export function verdict(file: Incoming, held: readonly HeldBook[]): Verdict {
  const readable = held.filter((b) => b.state === "ok");
  const sameFile = readable.find((b) => b.sources.includes(file.sourceHash));
  if (sameFile) return { kind: "same-file", book: ref(sameFile) };
  const sameSong = readable.find((b) => sameSongs(file.songHashes, b.songs));
  if (sameSong) return { kind: "same-songs", book: ref(sameSong) };
  const origin = readable.filter((b) => b.origin === file.origin);
  if (origin.length > 0) {
    return {
      kind: "same-origin",
      books: origin.map((b) => ({ ...ref(b), replaceable: b.kind === "loaded" })),
    };
  }
  return { kind: "new" };
}

/** Songs of a file already held in a book (§8, "a song already held"). */
export interface HeldElsewhere {
  /** Songs of the file whose hash is held in at least one book. */
  count: number;
  books: { key: string; title: string; count: number }[];
}

/** Never a verdict: the summary counts them, by book, and the load proceeds. */
export function heldElsewhere(songHashes: SongHashes, held: readonly HeldBook[]): HeldElsewhere {
  const books: HeldElsewhere["books"] = [];
  const hashes = new Set(songHashes.values());
  const seen = new Set<string>();
  for (const book of held) {
    if (book.state !== "ok") continue;
    const theirs = new Set(book.songs.values());
    let count = 0;
    for (const hash of songHashes.values()) if (theirs.has(hash)) count++;
    for (const hash of theirs) if (hashes.has(hash)) seen.add(hash);
    if (count > 0) books.push({ key: book.key, title: book.title, count });
  }
  const count = [...songHashes.values()].filter((h) => seen.has(h)).length;
  return { count, books };
}

/** Two verdicts name the same thing, whatever order the books come in. */
export function sameVerdict(a: Verdict, b: Verdict): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "same-origin" && b.kind === "same-origin") {
    const flat = (v: typeof a) =>
      v.books
        .map((x) => `${x.key}\0${x.replaceable}`)
        .sort()
        .join("\n");
    return flat(a) === flat(b);
  }
  if ("book" in a && "book" in b) return a.book.key === b.book.key;
  return true;
}
