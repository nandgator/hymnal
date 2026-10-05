// @vitest-environment node

import { describe, expect, it } from "vitest";
import sampleMd from "../../docs/authoring/sample.md?raw";
import { validateCorpus } from "../domain/validate.ts";
import { canonicalJson, parseSongText, textBook } from "./songtext.ts";

const ok = (text: string, number?: number) => {
  const r = parseSongText(text, { number });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const errors = (text: string, number?: number) => {
  const r = parseSongText(text, { number });
  if (r.ok) throw new Error("expected errors");
  return r.errors;
};
const ids = (text: string) => ok(text).songs[0].sequence.map((e) => e.partId);

describe("the sample", () => {
  const md = sampleMd;
  const blocks = [...md.matchAll(/```(\w+)\n([\s\S]*?)```/g)].map((m) => ({
    lang: m[1],
    body: m[2],
  }));
  const text = blocks.find((b) => b.lang === "text")?.body ?? "";
  const json = blocks.filter((b) => b.lang === "json").map((b) => JSON.parse(b.body));

  it("parses to the JSON the sample shows, byte for byte once canonical", () => {
    const { songs } = ok(text);
    const book = textBook(songs, {
      id: "sample-public-domain",
      title: "Sample hymns",
      language: "en",
      script: "Latn",
    });
    expect(json).toHaveLength(4);
    expect(canonicalJson(book.hymnbook)).toBe(canonicalJson(json[0]));
    expect(songs).toHaveLength(3);
    songs.forEach((song, i) => {
      expect(canonicalJson(song)).toBe(canonicalJson(json[i + 1]));
    });
    expect(validateCorpus(book.hymnbook, book.files)).toEqual([]);
  });
});

describe("the file", () => {
  it("ignores a byte-order mark and reads \\r\\n and \\r as newlines", () => {
    const a = ok("﻿1. T\r\n\r\nline one\r\nline two\r\n");
    const b = ok("1. T\n\nline one\nline two");
    const c = ok("1. T\r\rline one\rline two");
    expect(a.songs).toEqual(b.songs);
    expect(c.songs).toEqual(b.songs);
  });

  it("trims line ends, keeps inner spacing, ignores blank lines at the ends", () => {
    const { songs } = ok("\n\n1. T  \n\n   a  b   \n  c\n\n\n");
    expect(songs[0].parts[0].lines).toEqual(["a  b", "c"]);
  });

  it("ignores comment lines everywhere, without ending a block", () => {
    const { songs } = ok(
      "# top\n1. T\n# between\nAuthor: A\n\nline one\n# inside\nline two\n\n# lone\n",
    );
    expect(songs[0].meta).toEqual({ author: "A" });
    expect(songs[0].parts[0].lines).toEqual(["line one", "line two"]);
    expect(songs[0].parts).toHaveLength(1);
  });

  it("a comment between a title and its details leaves them details", () => {
    expect(ok("1. T\n# c\nTune: X\n\na").songs[0].meta).toEqual({ tune: "X" });
  });

  it("counts lines of the file as given, comments and blanks included", () => {
    expect(errors("# a\n\n# b\n0. T\n\nline")).toEqual([
      { line: 4, message: "the number must be a whole number, 1 or more" },
    ]);
  });
});

describe("the title line", () => {
  it.each([
    ["12. Amazing Grace", 12, "Amazing Grace"],
    ["12) Amazing Grace", 12, "Amazing Grace"],
    ["12 Amazing Grace", 12, "Amazing Grace"],
    ["12.Amazing Grace", 12, "Amazing Grace"],
    ["1 2 3 Jesus Loves Me", 1, "2 3 Jesus Loves Me"],
  ])("%s", (line, number, title) => {
    const song = ok(`${line}\n\nx`).songs[0];
    expect([song.number, song.title]).toEqual([number, title]);
  });

  it("bounds the number to what a file name and a safe integer hold", () => {
    const big = "9".repeat(20);
    expect(errors(`${big}. T\n\nx`)).toHaveLength(1);
    expect(errors(`${big}. T\n\nx`)[0].line).toBe(1);
    expect(errors("Untitled\n\nx", 0)).toHaveLength(1);
    expect(errors("Untitled\n\nx", 2 ** 60)).toHaveLength(1);
    expect(ok("999999999999999. T\n\nx").songs[0].number).toBe(999999999999999);
  });

  it("takes a single song's missing number from the call", () => {
    const song = ok("Amazing Grace\n\nx", 7).songs[0];
    expect([song.number, song.title]).toEqual([7, "Amazing Grace"]);
  });

  it("errors on a single song with no number and none given", () => {
    expect(errors("Amazing Grace\n\nx")).toEqual([
      { line: 1, message: "no number: write one on the title line or give it" },
    ]);
  });

  it("errors on a book song with no number, even if a number is given", () => {
    expect(errors("1. A\n\nx\n---\nB\n\ny", 9)).toEqual([{ line: 5, message: "no number" }]);
  });

  it("errors on number 0, a number used twice and an empty title", () => {
    expect(errors("0. A\n\nx\n---\n3. B\n\ny\n---\n3. C\n\nz\n---\n4.\n\nw")).toEqual([
      { line: 1, message: "the number must be a whole number, 1 or more" },
      { line: 9, message: "number 3 is also used on line 5" },
      { line: 13, message: "the title is empty" },
    ]);
  });

  it("a bare number is an empty title", () => {
    expect(errors("5\n\nx")).toEqual([{ line: 1, message: "the title is empty" }]);
  });
});

describe("details", () => {
  it("reads Author, Tune and Meter, keys in any case, values trimmed", () => {
    const { songs } = ok("1. T\nAUTHOR:  J N \ntune: New Britain\nMeter:8.6.8.6\n\nx");
    expect(songs[0].meta).toEqual({ author: "J N", tune: "New Britain", meter: "8.6.8.6" });
  });

  it("gives an empty meta when there are none", () => {
    expect(ok("1. T\n\nx").songs[0].meta).toEqual({});
  });

  it("errors on an empty value and a key given twice", () => {
    expect(errors("1. T\nAuthor:\nTune: A\nTune: B\n\nx")).toEqual([
      { line: 2, message: "Author has no value" },
      { line: 4, message: "Tune is given twice" },
    ]);
  });

  it("errors on any other key and on a first block with no blank line before it", () => {
    expect(errors("1. T\nComposer: X\nVerse 1:\nline")).toEqual([
      { line: 2, message: '"Composer: X" is not a detail (Author, Tune, Meter or Sequence)' },
      { line: 3, message: '"Verse 1:" is not a detail (Author, Tune, Meter or Sequence)' },
      { line: 4, message: '"line" is not a detail (Author, Tune, Meter or Sequence)' },
    ]);
  });
});

describe("blocks and labels", () => {
  it("maps each label word to its kind, case-insensitively, with the rest as the label", () => {
    const text = [
      "1. T",
      "",
      "Intro:\ni",
      "",
      "VERSE 3:\nv3",
      "",
      "stanza:\nv-un",
      "",
      "Pre-chorus:\np",
      "",
      "Refrain 2:\nr2",
      "",
      "Post-chorus:\nq",
      "",
      "Bridge:\nb",
      "",
      "Outro:\no",
      "",
      "Tag:\nt",
    ].join("\n");
    const parts = ok(text).songs[0].parts;
    expect(parts.map((p) => [p.id, p.kind, p.label])).toEqual([
      ["i1", "intro", undefined],
      ["s1", "stanza", "3"],
      ["s2", "stanza", "1"],
      ["p1", "pre-chorus", undefined],
      ["c1", "chorus", "2"],
      ["q1", "post-chorus", undefined],
      ["b1", "bridge", undefined],
      ["o1", "outro", undefined],
      ["t1", "tag", undefined],
    ]);
  });

  it("numbers unlabelled stanzas around explicit Verse N, wherever it stands", () => {
    const { songs } = ok("1. T\n\na\n\nVerse 2:\nb\n\nc\n\nd");
    expect(songs[0].parts.map((p) => p.label)).toEqual(["1", "2", "3", "4"]);
    expect(songs[0].parts.map((p) => p.lines[0])).toEqual(["a", "b", "c", "d"]);
    const late = ok("1. T\n\na\n\nb\n\nVerse 1:\nc").songs[0];
    expect(late.parts.map((p) => p.label)).toEqual(["2", "3", "1"]);
  });

  it("never joins or splits lines", () => {
    expect(ok("1. T\n\nlong line\nshort\n\nnext").songs[0].parts.map((p) => p.lines)).toEqual([
      ["long line", "short"],
      ["next"],
    ]);
  });

  it("errors on a label word outside the table, and a lyric ending in a colon first in a block", () => {
    expect(errors("1. T\n\nChrous:\nx\n\nAnd then he said:\ny")).toEqual([
      { line: 3, message: '"Chrous" is not a label word (Chorus, Refrain, Verse, Stanza, ...)' },
      { line: 6, message: '"And" is not a label word (Chorus, Refrain, Verse, Stanza, ...)' },
    ]);
  });

  it("does not take an object property for a label word", () => {
    for (const word of ["constructor", "__proto__", "toString"]) {
      expect(errors(`1. T\n\n${word}:\nx`)).toHaveLength(1);
    }
  });

  it("allows a lyric ending in a colon later in a block", () => {
    expect(ok("1. T\n\nsomething\nHe said:").songs[0]).toBeDefined();
  });

  it("errors on the same kind and label as an earlier part, at the label line", () => {
    expect(errors("1. T\n\nVerse 1:\na\n\nVerse 1:\nb\n\nChorus:\nc\n\nChorus:\nd")).toEqual([
      { line: 6, message: "stanza 1 is already a part: give it a label of its own" },
      { line: 12, message: "chorus is already a part: give it a label of its own" },
    ]);
  });

  it("two choruses are written Chorus 1: and Chorus 2:", () => {
    const parts = ok("1. T\n\nChorus 1:\na\n\nChorus 2:\nb").songs[0].parts;
    expect(parts.map((p) => [p.id, p.label])).toEqual([
      ["c1", "1"],
      ["c2", "2"],
    ]);
  });
});

describe("references", () => {
  it("is a label alone: the part sung again, in the order as printed", () => {
    const song = ok("1. T\n\na\n\nChorus:\nc\n\nb\n\nChorus:").songs[0];
    expect(song.parts.map((p) => p.id)).toEqual(["s1", "c1", "s2"]);
    expect(song.sequence.map((e) => e.partId)).toEqual(["s1", "c1", "s2", "c1"]);
  });

  it("may name a part printed after it, by kind and label", () => {
    expect(ids("1. T\n\na\n\nChorus 2:\n\nb\n\nChorus 1:\nx\n\nChorus 2:\ny")).toEqual([
      "s1",
      "c2",
      "s2",
      "c1",
      "c2",
    ]);
  });

  it("errors on a reference to nothing, and on a bare one with several candidates", () => {
    expect(errors("1. T\n\na\n\nBridge:\n\nb")).toEqual([
      { line: 5, message: '"bridge" sung again, but the song has no such part' },
    ]);
    expect(errors("1. T\n\nChorus 1:\nx\n\nChorus 2:\ny\n\nChorus:")).toEqual([
      { line: 9, message: '"chorus" could be any of 2 parts: name one (e.g. "Chorus 1:")' },
    ]);
    expect(errors("1. T\n\nChorus 3:\nx\n\nChorus 4:")).toEqual([
      { line: 6, message: '"chorus 4" sung again, but the song has no such part' },
    ]);
  });
});

describe("Sequence", () => {
  const base = "1. T\nSequence: SEQ\n\na\n\nb\n\nChorus:\nc";

  it("stands in the details; greedy words; numbers are stanzas", () => {
    expect(ids(base.replace("SEQ", "1 Chorus 2 Chorus"))).toEqual(["s1", "c1", "s2", "c1"]);
    expect(ids(base.replace("SEQ", "Verse 1 chorus Stanza 2"))).toEqual(["s1", "c1", "s2"]);
  });

  it("stands alone as a one-line block before the first part", () => {
    expect(ids("1. T\n\nSequence: 1 Chorus 2\n\na\n\nb\n\nChorus:\nc")).toEqual(["s1", "c1", "s2"]);
  });

  it("takes a kind word's token as its label only if that part exists", () => {
    const text = "1. T\nSequence: 1 Chorus 2 Chorus 3 Chorus\n\na\n\nb\n\nc\n\nChorus:\nx";
    expect(ids(text)).toEqual(["s1", "c1", "s2", "c1", "s3", "c1"]);
    const two =
      "1. T\nSequence: Chorus 2 Chorus 1 Verse 1 Verse 2\n\nChorus 1:\nx\n\nChorus 2:\ny\n\na\n\nb";
    expect(ids(two)).toEqual(["c2", "c1", "s1", "s2"]);
  });

  it("lets a part appear any number of times, and the line wins over the default", () => {
    expect(ids("1. T\nSequence: 1 1 2 Chorus\n\na\n\nb\n\nChorus:\nc")).toEqual([
      "s1",
      "s1",
      "s2",
      "c1",
    ]);
  });

  it("errors on an entry that names no part or is ambiguous", () => {
    expect(errors("1. T\nSequence: 1 9\n\na")[0]).toEqual({
      line: 2,
      message: '"9" names no part',
    });
    expect(errors("1. T\nSequence: 1 Bridge\n\na")[0]).toEqual({
      line: 2,
      message: '"Bridge" names no part: the song has none',
    });
    expect(errors("1. T\nSequence: Chorus\n\nChorus 1:\nx\n\nChorus 2:\ny\n\na")[0]).toEqual({
      line: 2,
      message: '"Chorus" is ambiguous: 2 parts of that kind, name one',
    });
  });

  it("errors on a second Sequence line, and on a misplaced one", () => {
    expect(errors("1. T\nSequence: 1\n\nSequence: 1\n\na")).toEqual([
      { line: 4, message: "a second Sequence line" },
    ]);
    expect(errors("1. T\n\na\n\nSequence: 1")).toEqual([
      { line: 5, message: "a Sequence line stands in the details or alone before the first part" },
    ]);
  });

  it("errors on a part no entry names, at its first line", () => {
    expect(errors("1. T\nSequence: 1\n\na\n\nb\n\nChorus:\nc")).toEqual([
      { line: 6, message: "stanza 2 is not in the Sequence: every part must be sung" },
      { line: 8, message: "chorus is not in the Sequence: every part must be sung" },
    ]);
  });

  it("errors on a Sequence block after a reference or a block with a bad label", () => {
    const after = "a\n\nChorus:\nx\n\nChorus:\n\nSequence: 1";
    expect(errors(`1. T\n\n${after}`).map((e) => e.line)).toEqual([10]);
    expect(errors("1. T\n\nChorus:\n\nSequence: 1\n\na").map((e) => e.line)).toContain(5);
    expect(errors("1. T\n\nChrous:\nx\n\nSequence: 1\n\na").map((e) => e.line)).toEqual([3, 6]);
  });

  it("errors on an empty Sequence value", () => {
    expect(errors("1. T\nSequence:\n\na")).toEqual([{ line: 2, message: "Sequence has no value" }]);
  });
});

describe("the default sequence", () => {
  const s = (n: number) => Array.from({ length: n }, (_, i) => `v${i + 1}`).join("\n\n");

  it("1. references: the order as printed", () => {
    expect(ids("1. T\n\nChorus:\nc\n\na\n\nChorus:\n\nb")).toEqual(["c1", "s1", "c1", "s2"]);
  });

  it("2. no references and no chorus: the order as printed", () => {
    expect(ids(`1. T\n\n${s(3)}\n\nBridge:\nb`)).toEqual(["s1", "s2", "s3", "b1"]);
  });

  it("3. one chorus printed last: after every stanza", () => {
    expect(ids(`1. T\n\n${s(2)}\n\nChorus:\nc`)).toEqual(["s1", "c1", "s2", "c1"]);
  });

  it("3. one chorus printed first: first, and after every stanza and bridge", () => {
    expect(ids("1. T\n\nChorus:\nc\n\na\n\nBridge:\nb\n\nb2")).toEqual([
      "c1",
      "s1",
      "c1",
      "b1",
      "c1",
      "s2",
      "c1",
    ]);
  });

  it("3. an intro, outro and tag stay where printed", () => {
    expect(ids("1. T\n\nIntro:\ni\n\na\n\nChorus:\nc\n\nOutro:\no\n\nTag:\nt")).toEqual([
      "i1",
      "s1",
      "c1",
      "o1",
      "t1",
    ]);
  });

  it("3. a chorus with no stanza or bridge is sung as printed, with no note", () => {
    expect(ids("1. T\n\nIntro:\ni\n\nChorus:\nc")).toEqual(["i1", "c1"]);
    expect(ok("1. T\n\nIntro:\ni\n\nChorus:\nc").notes).toEqual([]);
  });

  it("4. several choruses, or a pre-chorus: as printed, with a note", () => {
    const two = ok("7. T\n\na\n\nChorus 1:\nx\n\nb\n\nChorus 2:\ny");
    expect(two.songs[0].sequence.map((e) => e.partId)).toEqual(["s1", "c1", "s2", "c2"]);
    expect(two.notes).toHaveLength(1);
    expect(two.notes[0].hymn).toBe(7);
    const pre = ok("1. T\n\na\n\nPre-chorus:\np\n\nChorus:\nc");
    expect(pre.songs[0].sequence.map((e) => e.partId)).toEqual(["s1", "p1", "c1"]);
    expect(pre.notes).toHaveLength(1);
  });

  it("gives no note when a rule decides", () => {
    expect(ok(`1. T\n\n${s(2)}\n\nChorus:\nc`).notes).toEqual([]);
  });
});

describe("songs in a file", () => {
  it("splits at --- alone on a line (three or more hyphens)", () => {
    expect(ok("1. A\n\nx\n---\n2. B\n\ny\n-----\n3. C\n\nz").songs.map((s) => s.number)).toEqual([
      1, 2, 3,
    ]);
  });

  it("restarts labels, ids and sequence in each song", () => {
    const { songs } = ok("1. A\n\nx\n\ny\n---\n2. B\n\nz");
    expect(songs[1].parts[0]).toMatchObject({ id: "s1", label: "1" });
  });

  it("errors on an empty song between separators, at the separator, and on an empty file", () => {
    expect(errors("1. A\n\nx\n---\n\n---\n2. B\n\ny")).toEqual([
      { line: 6, message: "an empty song" },
    ]);
    expect(errors("")).toEqual([{ line: 1, message: "the file has no song" }]);
    expect(errors("# only a comment\n")).toEqual([{ line: 1, message: "the file has no song" }]);
  });

  it("ignores a closing separator with nothing after it", () => {
    expect(ok("1. A\n\nx\n---\n").songs).toHaveLength(1);
    expect(ok("1. A\n\nx\n---\n2. B\n\ny\n---\n\n").songs).toHaveLength(2);
  });

  it("errors on a file of only separators", () => {
    expect(errors("---\n").length).toBeGreaterThan(0);
  });

  it("reports every error in every song, in line order", () => {
    const found = errors("1. A\n\nChrous:\nx\n---\n1. B\n\nVerse 1:\ny\n\nVerse 1:\nz");
    expect(found.map((e) => e.line)).toEqual([3, 6, 11]);
  });
});

describe("the book", () => {
  it("builds hymnbook and files the validator accepts", () => {
    const { songs } = ok("1. A\n\nx\n---\n2. B\n\ny");
    const book = textBook(songs, { id: "b", title: "B", language: "en", script: "Latn" });
    expect(book.hymnbook).toEqual({
      format: 1,
      id: "b",
      title: "B",
      language: "en",
      script: "Latn",
      hymnCount: 2,
    });
    expect(book.files.map((f) => f.file)).toEqual(["0001.json", "0002.json"]);
    expect(validateCorpus(book.hymnbook, book.files)).toEqual([]);
  });
});
