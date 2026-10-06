import { gzipSync } from "node:zlib";

// A small invented book: nothing here is a real hymn, and no lyrics from the
// maintainer's books ever go in the repository (ADR-0026).
const SONGS = [
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

const hymns = SONGS.map((song, index) => ({
  number: index + 1,
  title: song.title,
  parts: [
    { id: "s1", kind: "stanza", label: "1", lines: song.lines },
    { id: "s2", kind: "stanza", label: "2", lines: ["Sing it once", "and sing it twice"] },
  ],
  sequence: [{ partId: "s1" }, { partId: "s2" }],
  meta: {},
}));

export const BOOK_TITLE = "Demo Book";
export const BOOK_FILE = "demo.hymnbook.json.gz";

/** The book as a file the picker accepts (SDD-0002 §1). */
export const bookFile = {
  name: BOOK_FILE,
  mimeType: "application/gzip",
  buffer: gzipSync(
    Buffer.from(
      JSON.stringify({
        hymnbook: {
          format: 1,
          id: "demo",
          title: BOOK_TITLE,
          language: "en",
          script: "Latn",
          hymnCount: hymns.length,
        },
        hymns,
      }),
    ),
  ),
};
