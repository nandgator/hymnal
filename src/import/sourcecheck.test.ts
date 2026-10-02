import { describe, expect, it } from "vitest";
import { parseSongText } from "./songtext.ts";
import { formatSourceCheck, normalise, sourceCheck } from "./sourcecheck.ts";

const parse = (text: string) => {
  const r = parseSongText(text);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.songs;
};

const SOURCE = [
  "1. Test Hymn",
  "",
  "Verse 1:",
  "first line of one",
  "second line of one",
  "",
  "Chorus:",
  "sing it out",
  "again and again",
  "",
  "Verse 2:",
  "first line of two",
  "second line of two",
].join("\n");

describe("normalise", () => {
  it("folds NFC, whitespace, quotes and dashes, and nothing else", () => {
    expect(normalise("  é  ‘a’\t“b” — c–d ")).toBe("é 'a' \"b\" - c-d");
    expect(normalise("Grace")).not.toBe(normalise("grace"));
  });
});

describe("sourceCheck", () => {
  it("finds no difference when the result is the source", () => {
    expect(sourceCheck(SOURCE, parse(SOURCE))).toEqual({ added: [], dropped: [] });
    expect(formatSourceCheck({ added: [], dropped: [] })).toEqual([]);
  });

  it("finds none across quote, dash and whitespace forms", () => {
    const source = "1. T\n\n‘Twas grace —  that taught\nit’s “so”";
    const result = parse("1. T\n\n'Twas grace - that taught\nit's \"so\"");
    expect(sourceCheck(source, result)).toEqual({ added: [], dropped: [] });
  });

  it("reports an altered word on both sides", () => {
    const check = sourceCheck(
      SOURCE,
      parse(SOURCE.replace("second line of one", "second line of won")),
    );
    expect(check.added).toEqual([
      { hymn: 1, part: "stanza 1", line: 2, text: "second line of won" },
    ]);
    expect(check.dropped).toEqual([{ line: 5, text: "second line of one" }]);
  });

  it("reports a dropped stanza with its source line numbers", () => {
    const result = parse(SOURCE.split("\n").slice(0, 9).join("\n"));
    const check = sourceCheck(SOURCE, result);
    expect(check.added).toEqual([]);
    expect(check.dropped).toEqual([
      { line: 12, text: "first line of two" },
      { line: 13, text: "second line of two" },
    ]);
  });

  it("reports an invented chorus, with its part", () => {
    const result = parse(`${SOURCE}\n\nBridge:\nan invented line`);
    expect(sourceCheck(SOURCE, result)).toEqual({
      added: [{ hymn: 1, part: "bridge", line: 1, text: "an invented line" }],
      dropped: [],
    });
  });

  it("a chorus in the source twice is matched twice; once, a second copy is added", () => {
    const twice = `${SOURCE}\n\nChorus 2:\nsing it out\nagain and again`;
    const twiceResult = parse(twice.replace("Chorus:", "Chorus 1:"));
    expect(sourceCheck(twice.replace("Chorus:", "Chorus 1:"), twiceResult)).toEqual({
      added: [],
      dropped: [],
    });
    const doubled = parse(twice.replace("Chorus:", "Chorus 1:"));
    expect(sourceCheck(SOURCE, doubled)).toEqual({
      added: [
        { hymn: 1, part: "chorus 2", line: 1, text: "sing it out" },
        { hymn: 1, part: "chorus 2", line: 2, text: "again and again" },
      ],
      dropped: [],
    });
  });

  it("a source that prints the chorus twice, against a result that has it once, lists the second", () => {
    const source = `${SOURCE}\n\nChorus:\nsing it out\nagain and again`;
    const check = sourceCheck(source, parse(SOURCE));
    expect(check.added).toEqual([]);
    expect(check.dropped.map((d) => d.text)).toEqual(["sing it out", "again and again"]);
    expect(check.dropped.map((d) => d.line)).toEqual([16, 17]);
  });

  it("matches a title with or without its number, and reports a changed title", () => {
    expect(sourceCheck("Test Hymn\n\nline", parse("1. Test Hymn\n\nline")).added).toEqual([]);
    expect(sourceCheck("12) Test Hymn\n\nline", parse("1. Test Hymn\n\nline")).added).toEqual([]);
    expect(sourceCheck("1. Test Hymn\n\nline", parse("1. Test Hymm\n\nline")).added).toEqual([
      { hymn: 1, text: "Test Hymm" },
    ]);
  });

  it("does not list labels, details, Sequence, comments or separators as dropped", () => {
    const source = "# note\n1. T\nAuthor: A\nSequence: 1\n\nVerse 1:\nline\n---\n";
    expect(sourceCheck(source, parse("1. T\n\nline")).dropped).toEqual([]);
  });

  it("hides only a label's exact shape: a lyric ending in a colon is checked", () => {
    const check = sourceCheck(
      "1. T\n\nChorus of angels sing:\nChorus 2:\nVerse:\nline",
      parse("1. T\n\nline"),
    );
    expect(check.dropped).toEqual([{ line: 3, text: "Chorus of angels sing:" }]);
    expect(sourceCheck("constructor:\nline", parse("1. T\n\nline")).dropped).toEqual([
      { line: 1, text: "constructor:" },
    ]);
  });

  it("does not fold primes into quotes", () => {
    expect(normalise("5\u2032 \u2033")).toBe("5\u2032 \u2033");
  });

  it("lists a heading and a page number as dropped, for a person to read", () => {
    const check = sourceCheck("HYMNS\n1. T\n\nline\n\n42", parse("1. T\n\nline"));
    expect(check.dropped).toEqual([
      { line: 1, text: "HYMNS" },
      { line: 6, text: "42" },
    ]);
  });

  it("words the report with hymn, part and line, and source line numbers", () => {
    const text = formatSourceCheck({
      added: [
        { hymn: 3, part: "chorus", line: 2, text: "x" },
        { hymn: 3, text: "T" },
      ],
      dropped: [{ line: 9, text: "y" }],
    });
    expect(text).toEqual([
      "(in a book of several songs, locations are approximate: lines are matched across the whole source)",
      "2 line(s) in the result that are not in the source (added or altered):",
      "  hymn 3, chorus, line 2: x",
      "  hymn 3, title: T",
      "1 line(s) in the source that are not in the result (dropped):",
      "  source line 9: y",
    ]);
  });
});
