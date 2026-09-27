import { describe, expect, it } from "vitest";
import type { HymnSource } from "../domain/types.ts";
import { draftBook } from "./draft.ts";
import { flow, readIndex } from "./flow.ts";
import { type Profile, parseProfile } from "./profile.ts";
import type { SourceLine, SourcePage } from "./source.ts";

/**
 * A made-up two-column songbook, set the way a real one is (SDD-0003 §6):
 * bold numbered headings, refrains in italic, stanzas parted by a wider gap,
 * lines that wrap, labels, a folio. 10pt type, 5pt a character, 14pt pitch.
 */
const ROMAN = "Serif";
const ITALIC = "Serif-Italic";
const BOLD = "Serif-Bold";

/**
 * One column, top down. "# " is a heading, "_ " italic, "" a stanza gap.
 * Headings are centred, as printed.
 */
function column(x: number, entries: string[]): SourceLine[] {
  const lines: SourceLine[] = [];
  let y = 40;
  for (const entry of entries) {
    if (entry === "") {
      y += 8;
      continue;
    }
    const [font, text] = entry.startsWith("# ")
      ? [BOLD, entry.slice(2)]
      : entry.startsWith("_ ")
        ? [ITALIC, entry.slice(2)]
        : [ROMAN, entry];
    const width = text.length * 5;
    const left = font === BOLD ? x + (150 - width) / 2 : x;
    lines.push({ text, x: left, y, width, size: 10, font });
    y += 14;
  }
  return lines;
}

function page(number: number, left: string[], right: string[], folio?: string): SourcePage {
  const lines = [...column(30, left), ...column(230, right)];
  if (folio) lines.push({ text: folio, x: 195, y: 580, width: 5, size: 10, font: ROMAN });
  return { number, width: 400, height: 600, lines: lines.sort((a, b) => a.y - b.y || a.x - b.x) };
}

const indexPage: SourcePage = {
  number: 1,
  width: 400,
  height: 600,
  lines: [
    ["Song", "Title", "Page"],
    ["1", "Morning song", "1"],
    ["2", "Evening hymn of rest", "1"],
    ["3", "Night falls", "1"],
    ["5", "The last one", "2"],
  ].flatMap((row, i) =>
    row.map((text, j) => ({
      text,
      x: [30, 50, 180][j],
      y: 40 + i * 14,
      width: 20,
      size: 10,
      font: ROMAN,
    })),
  ),
};

const book: SourcePage[] = [
  indexPage,
  page(
    2,
    [
      "Printed before any song",
      "",
      "# (1) MORNING SONG",
      "_ Sing out, sing out the morning",
      "_ Sing out the light",
      "",
      "The river runs to meet the sea and", // the widest line: the measure
      "sings,",
      "The hills stand up to greet it",
      "Short line here",
      "and rest",
      "",
      "A second verse is sung",
      "And sung again",
    ],
    [
      "# (2) EVENING",
      "# HYMN OF REST",
      "Down goes the sun",
      "Over the field",
      "",
      "Chorus:",
      "Rest now, rest now",
      "All of the day is done",
      "",
      "Up comes the moon",
      "Over the hill",
      "(chorus)",
      "",
      "Bridge:",
      "_ Quiet, quiet",
      "_ Still",
    ],
    "1",
  ),
  page(
    3,
    [
      "# 3) NIGHT FALLS",
      "Stars in the sky",
      "Shining so high",
      "Moon on the sea",
      "Watching for me",
      "",
      "Owls in the tree",
      "Calling to me",
    ],
    [
      "Wind in the pines",
      "Singing its lines",
      "",
      "Stars in the sky",
      "Shining so high",
      "Moon on the sea",
      "Watching for me",
      "",
      "# (5) THE LAST ONE",
      "Only one verse",
      "Nothing to rehearse",
    ],
    "2",
  ),
];

const profile: Profile = parseProfile({
  hymnbook: { id: "test-book", title: "Test Book", language: "en", script: "Latn" },
  pages: { from: 2, to: 3 },
  index: { pages: { from: 1, to: 1 } },
  furniture: { pageNumber: true },
  title: { pattern: "^\\(?(?<number>\\d+)\\)\\s*(?<title>.+)$", font: BOLD },
  refrain: { font: ITALIC },
  labels: { chorus: "refrain", bridge: "bridge" },
  stanzaGap: 1.3,
});

const draft = draftBook(book, profile);
const hymn = (number: number) => draft.hymns.find((h) => h.number === number) as HymnSource;
const sequence = (h: HymnSource) => h.sequence.map((entry) => entry.partId).join(" ");
const notes = (kind: string) =>
  draft.notes.filter((n) => n.kind === kind).map((n) => `${n.hymn ?? ""} ${n.message}`.trim());

describe("parseProfile", () => {
  it("lists every problem, unknown fields included", () => {
    expect(() =>
      parseProfile({
        hymnbook: { id: "x", title: "X", language: "en" },
        pages: { from: 5, to: 2 },
        furniture: { pageNumber: true },
        title: { pattern: "^(\\d+) (.+)$" },
        refrain: { font: "I" },
        labels: { Chorus: "chorus" },
        stanzaGap: 1.5,
        columns: 2,
      }),
    ).toThrow(
      [
        "The profile has problems:",
        "- columns is not a profile field",
        "- hymnbook.script is required",
        "- pages must run from page ≥ 1 to a later one",
        "- title.pattern must name two groups, (?<number>…) and (?<title>…)",
        '- labels: "Chorus" must be lower case',
        '- labels.Chorus: "chorus" is not a part kind',
      ].join("\n"),
    );
  });
});

describe("flow", () => {
  const { lines, pitch, folios } = flow(book, profile);

  it("reads a page column by column, top to bottom, without its folio", () => {
    const texts = lines.filter((l) => l.page === 3).map((l) => l.text);
    expect(texts.slice(0, 2)).toEqual(["3) NIGHT FALLS", "Stars in the sky"]);
    expect(texts.indexOf("Calling to me")).toBeLessThan(texts.indexOf("Wind in the pines"));
    expect(texts).not.toContain("2");
    expect(folios.get(3)).toBe("2");
  });

  it("measures gaps in line pitches, none at the top of a column", () => {
    expect(pitch).toBe(14);
    const wind = lines.find((l) => l.text === "Wind in the pines");
    const owls = lines.find((l) => l.text === "Owls in the tree");
    expect(wind?.gap).toBeNull();
    expect(owls?.gap).toBeCloseTo(22 / 14);
  });
});

describe("readIndex", () => {
  it("reads number, title and page from each row, skipping headings", () => {
    expect(
      readIndex(book, { from: 1, to: 1 }).map((e) => `${e.number} ${e.title} ${e.page}`),
    ).toEqual([
      "1 Morning song 1",
      "2 Evening hymn of rest 1",
      "3 Night falls 1",
      "5 The last one 2",
    ]);
  });
});

describe("draftBook", () => {
  it("finds every song, numbered, titled as the index sets them", () => {
    expect(draft.hymns.map((h) => `${h.number} ${h.title}`)).toEqual([
      "1 Morning song",
      "2 Evening hymn of rest",
      "3 Night falls",
      "5 The last one",
    ]);
  });

  it("notes what it dropped or couldn't find, and writes valid content", () => {
    expect(notes("stray")).toEqual([
      `1 line(s) before the first title, dropped: "Printed before any song"`,
    ]);
    expect(notes("number")).toEqual(["no song numbered 4"]);
    expect(notes("invalid")).toEqual([]);
  });

  it("takes an italic block as the refrain, sung first when printed first", () => {
    const h = hymn(1);
    expect(h.parts.map((p) => `${p.id} ${p.kind}`)).toEqual([
      "r refrain",
      "s1 stanza",
      "s2 stanza",
    ]);
    expect(sequence(h)).toBe("r s1 r s2 r");
  });

  it("joins a printer's wrap, and only where the next word couldn't fit", () => {
    expect(hymn(1).parts[1].lines).toEqual([
      "The river runs to meet the sea and sings,",
      "The hills stand up to greet it",
      "Short line here",
      "and rest",
    ]);
    expect(notes("wrap")).toEqual([`1 "The river runs to meet the sea and" + "sings,"`]);
  });

  it("reads labels: a heading gives its block a kind, alone it sings that part again", () => {
    const h = hymn(2);
    expect(h.parts.map((p) => `${p.id} ${p.kind} ${p.lines[0]}`)).toEqual([
      "s1 stanza Down goes the sun",
      "r refrain Rest now, rest now",
      "s2 stanza Up comes the moon",
      "b bridge Quiet, quiet",
    ]);
    expect(sequence(h)).toBe("s1 r s2 r b");
  });

  it("joins a stanza split by a column break when that makes it as long as the rest", () => {
    const h = hymn(3);
    expect(h.parts.find((p) => p.id === "s2")?.lines).toEqual([
      "Owls in the tree",
      "Calling to me",
      "Wind in the pines",
      "Singing its lines",
    ]);
  });

  it("treats a stanza printed again word for word as the same part", () => {
    const h = hymn(3);
    expect(h.parts.map((p) => p.id)).toEqual(["s1", "s2"]);
    expect(sequence(h)).toBe("s1 s2 s1");
  });
});
