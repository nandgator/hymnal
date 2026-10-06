import { describe, expect, it } from "vitest";
import { otterbeinSong, tuneAndMeter } from "./sample-sources.ts";

// Gutenberg's layout, with made-up words.
const TEXT = [
  "7     Example Tune. 7s & 6s.",
  "",
  "_A Topic._     (12)",
  "",
  "First line of one,",
  "  second line of one--",
  "",
  "Cho.--Chorus line,",
  "      chorus again.",
  "",
  "2 First line of two,",
  "  second line of two.",
  "      deep line of two.",
  "",
  "     Some Author, 1800.",
  "",
  "",
  "8     Next Tune. L. M.",
];
const entry = {
  number: 7,
  title: "Example Tune. 7s & 6s.",
  first_line: "First line of one,",
  authors: [{ name: "Some Author", role: "author", died: 1800, source: "https://example.org" }],
  first_published: 1790,
  line_in_txt: 1,
};

describe("tuneAndMeter", () => {
  it("splits the tune from the meter, with or without a stop between", () => {
    expect(tuneAndMeter("18     Nicaea 11s, 12s, & 10s.")).toEqual({
      tune: "Nicaea",
      meter: "11s, 12s, & 10s",
    });
    expect(tuneAndMeter("101     Herald Angels. 7s D.")).toEqual({
      tune: "Herald Angels",
      meter: "7s D",
    });
    expect(tuneAndMeter("78     Elizabethtown. C. M.")).toEqual({
      tune: "Elizabethtown",
      meter: "C. M.",
    });
    expect(tuneAndMeter("267     Autumn. 8s & 7s.  Double.")).toEqual({
      tune: "Autumn",
      meter: "8s & 7s. Double",
    });
  });
});

describe("otterbeinSong", () => {
  const song = otterbeinSong(TEXT, entry, 7);

  it("keeps stanzas and the chorus, drops the topic and the author line", () => {
    expect(song.parts).toEqual([
      {
        id: "s1",
        kind: "stanza",
        label: "1",
        lines: ["First line of one,", "second line of one—"],
      },
      {
        id: "s2",
        kind: "stanza",
        label: "2",
        lines: ["First line of two,", "second line of two.", "deep line of two."],
      },
      { id: "c", kind: "chorus", lines: ["Chorus line,", "chorus again."] },
    ]);
  });

  it("sings the chorus after each stanza", () => {
    expect(song.sequence.map((s) => s.partId)).toEqual(["s1", "c", "s2", "c"]);
  });

  it("titles by the first line and keeps the author, tune and meter", () => {
    expect(song.title).toBe("First line of one");
    expect(song.meta).toEqual({ author: "Some Author", tune: "Example Tune", meter: "7s & 6s" });
  });

  it("refuses a line that is not the hymn's header", () => {
    expect(() => otterbeinSong(TEXT, { ...entry, line_in_txt: 2 }, 7)).toThrow(/no header/);
  });
});
