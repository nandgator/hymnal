import { gzipSync } from "node:zlib";

export interface TestSong {
  title: string;
  lines: string[];
  /** How many stanzas the song has; two by default. */
  stanzas?: number;
}

// A small invented book: nothing here is a real hymn, and no lyrics from the
// maintainer's books ever go in the repository (ADR-0026).
const SONGS: TestSong[] = [
  {
    title: "Lantern Morning",
    lines: ["The lantern burns at break of day", "and shadows leave the hill"],
  },
  {
    title: "River Of Stones",
    lines: ["Come down to where the river runs", "over the quiet stones"],
  },
  {
    title: "Harbor Light",
    lines: ["The harbor waits beyond the dunes", "its window glowing gold"],
  },
];

/** A book as a file the picker accepts (SDD-0002 §1); songs are numbered from 1. */
export function makeBook(id: string, title: string, songs: TestSong[]) {
  const hymns = songs.map((song, index) => {
    const parts = Array.from({ length: song.stanzas ?? 2 }, (_, at) => ({
      id: `s${at + 1}`,
      kind: "stanza",
      label: String(at + 1),
      lines: at === 0 ? song.lines : ["Sing it once", "and sing it twice"],
    }));
    return {
      number: index + 1,
      title: song.title,
      parts,
      sequence: parts.map((part) => ({ partId: part.id })),
      meta: {},
    };
  });
  return {
    name: `${id}.hymnbook.json.gz`,
    mimeType: "application/gzip",
    buffer: gzipSync(
      Buffer.from(
        JSON.stringify({
          hymnbook: {
            format: 1,
            id,
            title,
            language: "en",
            script: "Latn",
            hymnCount: hymns.length,
          },
          hymns,
        }),
      ),
    ),
  };
}

export const BOOK_TITLE = "Demo Book";
export const BOOK_FILE = "demo.hymnbook.json.gz";

/** The book as a file the picker accepts (SDD-0002 §1). */
export const bookFile = makeBook("demo", BOOK_TITLE, SONGS);
