import { describe, expect, it } from "vitest";
import { hymnFileName, validateCorpus, validateHymn } from "./validate.ts";

function hymn(overrides: Record<string, unknown> = {}) {
  return {
    number: 7,
    title: "First line",
    parts: [
      { id: "r", kind: "refrain", lines: ["refrain"] },
      { id: "s1", kind: "stanza", label: "1", lines: ["stanza"] },
    ],
    sequence: [{ partId: "r" }, { partId: "s1" }, { partId: "r" }],
    meta: {},
    ...overrides,
  };
}

const rules = (input: unknown) => validateHymn(input).map((v) => v.rule);

describe("validateHymn", () => {
  it("accepts a valid hymn", () => {
    expect(validateHymn(hymn())).toEqual([]);
  });

  it("accepts stored metadata", () => {
    expect(validateHymn(hymn({ meta: { author: "KVS", tune: "t", meter: "8.8" } }))).toEqual([]);
  });

  it("I1: duplicate part ids", () => {
    const parts = [
      { id: "s1", kind: "stanza", lines: ["a"] },
      { id: "s1", kind: "stanza", lines: ["b"] },
    ];
    expect(rules(hymn({ parts, sequence: [{ partId: "s1" }] }))).toEqual(["I1"]);
  });

  it("I2: dangling sequence reference", () => {
    const v = validateHymn(
      hymn({ sequence: [{ partId: "r" }, { partId: "s1" }, { partId: "x" }] }),
    );
    expect(v).toEqual([
      { rule: "I2", where: "hymn 7", message: "sequence[2] references unknown part x" },
    ]);
  });

  it("I3: empty sequence, and I5 for the parts it leaves unreferenced", () => {
    expect(rules(hymn({ sequence: [] }))).toEqual(["I3", "I5", "I5"]);
  });

  it("I4: a part with no lines", () => {
    const parts = [{ id: "s1", kind: "stanza", lines: [] }];
    expect(rules(hymn({ parts, sequence: [{ partId: "s1" }] }))).toEqual(["I4"]);
  });

  it("I5: an unreferenced part", () => {
    expect(rules(hymn({ sequence: [{ partId: "s1" }] }))).toEqual(["I5"]);
  });

  it("I6: empty or whitespace-only lines", () => {
    const parts = [{ id: "s1", kind: "stanza", lines: ["a", "", "  "] }];
    const v = validateHymn(hymn({ parts, sequence: [{ partId: "s1" }] }));
    expect(v.map((x) => x.message)).toEqual([
      "part s1 line 1 is empty after trimming",
      "part s1 line 2 is empty after trimming",
    ]);
  });

  it("rejects metadata the schema cannot store", () => {
    const v = validateHymn(hymn({ meta: { author: "a", topics: ["x"], copyright: "c" } }));
    expect(v.map((x) => x.message)).toEqual([
      "meta.topics cannot be stored by the current schema",
      "meta.copyright cannot be stored by the current schema",
    ]);
  });

  it("collects every violation instead of stopping at the first", () => {
    const parts = [
      { id: "s1", kind: "stanza", lines: [] },
      { id: "s1", kind: "stanza", lines: ["", "ok"] },
    ];
    expect(rules(hymn({ parts, sequence: [{ partId: "gone" }] }))).toEqual([
      "I4",
      "I6",
      "I1",
      "I2",
      "I5",
    ]);
  });
});

describe("validateHymn on malformed input", () => {
  it("reports a non-object without throwing", () => {
    expect(validateHymn("nope", "0001.json")).toEqual([
      { rule: "shape", where: "0001.json", message: "hymn is not an object" },
    ]);
  });

  it("reports missing fields", () => {
    expect(rules({})).toEqual(["shape", "shape", "shape", "shape", "shape"]);
  });

  it("does not check deeper rules when parts or sequence are not arrays", () => {
    expect(rules(hymn({ parts: "x", sequence: null }))).toEqual(["shape", "shape"]);
  });

  it("flags a bad number, title, part kind and line type", () => {
    expect(rules(hymn({ number: 0 }))).toEqual(["shape"]);
    expect(rules(hymn({ title: "  " }))).toEqual(["shape"]);
    const parts = [{ id: "s1", kind: "verse", lines: [3] }];
    expect(rules(hymn({ parts, sequence: [{ partId: "s1" }] }))).toEqual(["shape", "shape"]);
  });

  it("flags malformed parts and sequence entries", () => {
    const parts = [{ kind: "stanza", lines: ["a"] }];
    expect(rules(hymn({ parts, sequence: [{}] }))).toEqual(["shape", "shape"]);
  });
});

describe("hymnFileName", () => {
  it("pads to four digits", () => {
    expect(hymnFileName(7)).toBe("0007.json");
    expect(hymnFileName(1631)).toBe("1631.json");
  });
});

describe("validateCorpus", () => {
  const book = { id: "b", title: "T", language: "ml", script: "Mlym", hymnCount: 2 };
  const file = (number: number, name = hymnFileName(number)) => ({
    file: name,
    hymn: hymn({ number }),
  });

  it("accepts a consistent corpus", () => {
    expect(validateCorpus(book, [file(1), file(2)])).toEqual([]);
  });

  it("includes per-hymn violations, labelled by hymn", () => {
    const bad = { file: "0002.json", hymn: hymn({ number: 2, sequence: [] }) };
    const v = validateCorpus(book, [file(1), bad]);
    expect(v.map((x) => [x.rule, x.where])).toEqual([
      ["I3", "hymn 2"],
      ["I5", "hymn 2"],
      ["I5", "hymn 2"],
    ]);
  });

  it("file-name: a file that does not match its number", () => {
    const v = validateCorpus(book, [file(1), file(2, "0003.json")]);
    expect(v).toEqual([
      { rule: "file-name", where: "hymn 2", message: "0003.json should be named 0002.json" },
    ]);
  });

  it("I7: duplicate hymn numbers", () => {
    const v = validateCorpus(book, [file(1), { file: "copy.json", hymn: hymn({ number: 1 }) }]);
    expect(v.map((x) => x.rule)).toEqual(["file-name", "I7"]);
  });

  it("hymn-count: disagrees with hymnbook.json", () => {
    const v = validateCorpus(book, [file(1)]);
    expect(v).toEqual([
      {
        rule: "hymn-count",
        where: "hymnbook",
        message: "hymnCount is 2 but 1 hymn files were found",
      },
    ]);
  });

  it("checks the hymnbook shape", () => {
    expect(validateCorpus(null, []).map((x) => x.rule)).toEqual(["shape"]);
    const v = validateCorpus({ id: "", hymnCount: "x" }, []);
    expect(v.map((x) => x.message)).toEqual([
      "id must be a non-empty string",
      "title must be a non-empty string",
      "language must be a non-empty string",
      "script must be a non-empty string",
      "hymnCount must be an integer",
    ]);
  });
});
