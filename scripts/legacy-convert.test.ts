import { describe, expect, it } from "vitest";
import { convertLegacyHymn, type LegacyHymn, summarize } from "./legacy-convert.ts";

function legacy(overrides: Partial<LegacyHymn> = {}): LegacyHymn {
  return {
    id: 7,
    author: "",
    starts: "chorus",
    chorus: ["c1", "c2"],
    bridge: [],
    verses: [["a1", "a2"], ["b1"]],
    ...overrides,
  };
}

const order = (h: LegacyHymn) => convertLegacyHymn(h).hymn.sequence.map((e) => e.partId);

describe("convertLegacyHymn shapes", () => {
  it("chorus first: r, s1, r, s2, r", () => {
    const { hymn, shape } = convertLegacyHymn(legacy());
    expect(shape).toBe("chorus-first");
    expect(hymn.sequence.map((e) => e.partId)).toEqual(["r", "s1", "r", "s2", "r"]);
    expect(hymn.parts.map((p) => [p.id, p.kind, p.label])).toEqual([
      ["r", "refrain", undefined],
      ["s1", "stanza", "1"],
      ["s2", "stanza", "2"],
    ]);
    expect(hymn.title).toBe("c1");
  });

  it("verse first with a chorus: s1, r, s2, r", () => {
    const h = legacy({ starts: "verse-1" });
    const { hymn, shape } = convertLegacyHymn(h);
    expect(shape).toBe("verse-first");
    expect(order(h)).toEqual(["s1", "r", "s2", "r"]);
    expect(hymn.title).toBe("a1");
  });

  it("verses only, no chorus: s1, s2", () => {
    const h = legacy({ starts: "verse-1", chorus: [] });
    const { hymn, shape } = convertLegacyHymn(h);
    expect(shape).toBe("verses-only");
    expect(hymn.parts.map((p) => p.id)).toEqual(["s1", "s2"]);
    expect(order(h)).toEqual(["s1", "s2"]);
  });

  it("chorus only becomes one stanza, not a refrain", () => {
    const h = legacy({ verses: [] });
    const { hymn, shape } = convertLegacyHymn(h);
    expect(shape).toBe("chorus-only");
    expect(hymn.parts).toEqual([{ id: "s1", kind: "stanza", label: "1", lines: ["c1", "c2"] }]);
    expect(order(h)).toEqual(["s1"]);
  });
});

describe("convertLegacyHymn text and metadata", () => {
  it("maps id to number and keeps a non-empty author", () => {
    const { hymn } = convertLegacyHymn(legacy({ id: 42, author: "KVS" }));
    expect(hymn.number).toBe(42);
    expect(hymn.meta).toEqual({ author: "KVS" });
  });

  it("leaves author absent when empty", () => {
    expect(convertLegacyHymn(legacy({ author: "" })).hymn.meta).toEqual({});
  });

  it("trims whitespace and counts it", () => {
    const c = convertLegacyHymn(legacy({ chorus: [" c1 - ", "c2"], verses: [["a1 "]] }));
    expect(c.hymn.parts[0]?.lines).toEqual(["c1 -", "c2"]);
    expect(c.hymn.parts[1]?.lines).toEqual(["a1"]);
    expect(c.trimmedLines).toBe(2);
  });

  it("drops empty lines and counts them", () => {
    const c = convertLegacyHymn(legacy({ chorus: ["c1", "", "c2", ""], verses: [["a1"]] }));
    expect(c.hymn.parts[0]?.lines).toEqual(["c1", "c2"]);
    expect(c.droppedBlankLines).toBe(2);
  });

  it("does not normalise Unicode", () => {
    const zwj = "ന്‍";
    const c = convertLegacyHymn(legacy({ chorus: [zwj], verses: [] }));
    expect(c.hymn.parts[0]?.lines).toEqual([zwj]);
  });
});

describe("convertLegacyHymn failures", () => {
  it("rejects a non-empty bridge", () => {
    expect(() => convertLegacyHymn(legacy({ bridge: ["x"] }))).toThrow(/hymn 7.*bridge/);
  });

  it("rejects an unknown starts", () => {
    expect(() => convertLegacyHymn(legacy({ starts: "bridge" }))).toThrow(/starts/);
  });

  it("rejects an empty verse", () => {
    expect(() => convertLegacyHymn(legacy({ verses: [["a"], []] }))).toThrow(/verse has no lines/);
  });

  it("rejects a verse that is only blank lines", () => {
    expect(() => convertLegacyHymn(legacy({ verses: [["", " "]] }))).toThrow(/verse has no lines/);
  });

  it("rejects starts at chorus when there is no chorus", () => {
    expect(() => convertLegacyHymn(legacy({ chorus: [], starts: "chorus" }))).toThrow(/no chorus/);
  });

  it("rejects starts at verse-1 when there are no verses", () => {
    expect(() => convertLegacyHymn(legacy({ verses: [], starts: "verse-1" }))).toThrow(/no verses/);
  });

  it("rejects a hymn with no lyrics", () => {
    expect(() => convertLegacyHymn(legacy({ chorus: [], verses: [] }))).toThrow(/no lyrics/);
  });
});

describe("summarize", () => {
  it("counts shapes, trimmed lines and flags hymns that lost blank lines", () => {
    const report = summarize([
      convertLegacyHymn(legacy({ id: 1 })),
      convertLegacyHymn(legacy({ id: 2, starts: "verse-1" })),
      convertLegacyHymn(legacy({ id: 3, starts: "verse-1", chorus: [] })),
      convertLegacyHymn(legacy({ id: 4, verses: [], chorus: ["c1", "", "c2 "] })),
    ]);
    expect(report.total).toBe(4);
    expect(report.shapes).toEqual({
      "chorus-first": 1,
      "verse-first": 1,
      "verses-only": 1,
      "chorus-only": 1,
    });
    expect(report.flaggedForReview).toEqual([4]);
    expect(report.trimmedLines).toBe(1);
  });
});
