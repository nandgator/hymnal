import { describe, expect, it } from "vitest";
import type { HymnSource } from "../domain/types.ts";
import { draftBook, titleOf } from "./draft.ts";
import { flow, readIndex } from "./flow.ts";
import { type Profile, parseProfile } from "./profile.ts";
import type { SourceLine, SourcePage } from "./source.ts";

/**
 * A made-up two-column songbook, set the way a real one is (SDD-0003 §6):
 * bold numbered headings, choruses in italic, stanzas parted by a wider gap,
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
  chorus: { font: ITALIC },
  labels: { chorus: "chorus", bridge: "bridge" },
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
        chorus: { font: "I" },
        labels: { Chorus: "verse" },
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
        '- labels.Chorus: "verse" is not a part kind',
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

  it("takes an italic block as the chorus, sung first when printed first", () => {
    const h = hymn(1);
    expect(h.parts.map((p) => `${p.id} ${p.kind}`)).toEqual(["c chorus", "s1 stanza", "s2 stanza"]);
    expect(sequence(h)).toBe("c s1 c s2 c");
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
      "c chorus Rest now, rest now",
      "s2 stanza Up comes the moon",
      "b bridge Quiet, quiet",
    ]);
    expect(sequence(h)).toBe("s1 c s2 c b");
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

describe("titleOf", () => {
  const lines = [
    "I serve a risen Savior,",
    "A Savior who is Lord of all,",
    "Jesus paid it all,",
    "Give thanks to the KING,",
    "He knows my name",
  ];
  const title = (heading: string) => titleOf(heading, undefined, lines);

  it("cases each word as the song sets it within a line, not first in one", () => {
    expect(title("I SERVE A RISEN SAVIOR")).toBe("I serve a risen Savior");
  });

  it("falls back to a line's first word, then capitals, then lower case", () => {
    expect(title("JESUS PAID IT ALL")).toBe("Jesus paid it all");
    expect(title("THANKS TO THE KING")).toBe("Thanks to the KING");
    expect(title("NOT IN THE SONG")).toBe("Not in the song");
  });

  it("starts a subtitle in brackets with a capital, and keeps mixed case as printed", () => {
    expect(title("MY SAVIOR (HE KNOWS MY NAME)")).toBe("My Savior (He knows my name)");
    expect(title("I SERVE (Psalms 5:1-3)")).toBe("I serve (Psalms 5:1-3)");
  });

  it("takes the index's title when it names the same song", () => {
    const entry = { number: 1, title: "I serve a risen savior", page: "1" };
    expect(titleOf("I SERVE A RISEN SAVIOR", entry, lines)).toBe("I serve a risen savior");
  });
});

describe("a label within a block", () => {
  const sung = (lines: string[]) => {
    const { hymns } = draftBook([page(1, lines, [])], {
      ...profile,
      index: undefined,
      pages: { from: 1, to: 1 },
    });
    const [h] = hymns;
    return `${h.parts.map((p) => `${p.id}:${p.lines[0]}`).join(" ")} | ${sequence(h)}`;
  };

  it("closes the lines before it when what follows isn't in the chorus font", () => {
    expect(
      sung([
        "# (1) ONE SONG",
        "_ Sing it, sing it",
        "_ All day long",
        "",
        "First verse here",
        "Goes on and on",
        "(chorus)",
        "Second verse here",
        "Goes on again",
      ]),
    ).toBe("c:Sing it, sing it s1:First verse here s2:Second verse here | c s1 c s2");
  });

  it("heads what follows when that is in the chorus font", () => {
    expect(
      sung([
        "# (1) ONE SONG",
        "First verse here",
        "Goes on and on",
        "Chorus:",
        "_ Sing it, sing it",
        "_ All day long",
      ]),
    ).toBe("s1:First verse here c:Sing it, sing it | s1 c");
  });
});

describe("repeat marks", () => {
  const drafted = (lines: string[]) => {
    const { hymns, notes } = draftBook([page(1, lines, [])], {
      ...profile,
      index: undefined,
      pages: { from: 1, to: 1 },
    });
    const [h] = hymns;
    return {
      parts: h.parts.map((p) => `${p.id}: ${p.lines.join(" / ")}`),
      sequence: sequence(h),
      notes: notes.filter((n) => n.kind === "repeat").map((n) => n.message),
    };
  };

  it("are taken out of the line, a line left empty dropped, each noted", () => {
    const { parts, notes } = drafted([
      "# (1) ONE SONG",
      "Glory to the Lord (2)",
      "Thou art worthy (3) O Lord,",
      "Upon the cross (2).",
      "Thank you for the cross – 2",
      "Sing it again x 2",
      "(repeat)",
    ]);
    expect(parts).toEqual([
      "s1: Glory to the Lord / Thou art worthy O Lord, / Upon the cross. / Thank you for the cross / Sing it again",
    ]);
    expect(notes).toContain('"(repeat)" → dropped');
    expect(notes).toContain('"Thank you for the cross – 2" → "Thank you for the cross"');
  });

  it("leave a verse reference alone", () => {
    expect(drafted(["# (1) ONE SONG", "Give ear (Psalms 5 :1-3)"]).parts).toEqual([
      "s1: Give ear (Psalms 5 :1-3)",
    ]);
  });

  it('read "(Repeat Chorus)" as the chorus sung again', () => {
    expect(
      drafted([
        "# (1) ONE SONG",
        "_ Sing it, sing it",
        "",
        "First verse here",
        "(Repeat Chorus)",
        "Second verse here",
        "Chorus again",
      ]).sequence,
    ).toBe("c s1 c s2");
  });
});

describe("directions, cues and fonts", () => {
  const drafted = (lines: string[]) => {
    const { hymns, notes } = draftBook([page(1, lines, [])], {
      ...profile,
      index: undefined,
      pages: { from: 1, to: 1 },
      labels: { ...profile.labels, cho: "chorus" },
      directions: ["ladies", "men", "women", "together", "echo", "descant"],
    });
    const [h] = hymns;
    return {
      parts: h.parts.map((p) => `${p.id}: ${p.lines.join(" / ")}`),
      sequence: sequence(h),
      notes: (kind: string) => notes.filter((n) => n.kind === kind).map((n) => n.message),
    };
  };

  it("takes directions out of the line, and leaves echoed words", () => {
    const { parts, notes } = drafted([
      "# (1) ONE SONG",
      "(ladies descant)",
      "(Men) Worship the King, (Women)come and see",
      "He walked where I walked (echo)",
      "And hear us sing (and hear us sing)",
      "[Together]",
    ]);
    expect(parts).toEqual([
      "s1: Worship the King, come and see / He walked where I walked / And hear us sing (and hear us sing)",
    ]);
    expect(notes("direction")).toContain('"(ladies descant)" → dropped');
  });

  it("reads a label ending a line after an ellipsis as the part sung again", () => {
    const { parts, sequence } = drafted([
      "# (1) ONE SONG",
      "_ Sing it, sing it",
      "",
      "First verse here",
      "That I might live…Cho…",
      "Second verse here",
      "Goes on today. Cho…",
    ]);
    expect(parts).toEqual([
      "c: Sing it, sing it",
      "s1: First verse here / That I might live",
      "s2: Second verse here / Goes on today.",
    ]);
    expect(sequence).toBe("c s1 c s2 c");
  });

  it("reads the chorus's first line, quoted or in its font, as a cue", () => {
    const { parts, sequence, notes } = drafted([
      "# (1) ONE SONG",
      "_ Bind us together, Lord;",
      "_ Bind us with love.",
      "",
      "One God, one King",
      "_ Bind us together, Lord ...",
      "",
      "One Body, one song",
      "“Bind us together”",
    ]);
    expect(parts).toEqual([
      "c: Bind us together, Lord; / Bind us with love.",
      "s1: One God, one King",
      "s2: One Body, one song",
    ]);
    expect(sequence).toBe("c s1 c s2 c");
    expect(notes("fonts")).toEqual([]);
  });

  it("keeps a stanza's own last line that leads into the chorus", () => {
    const { parts } = drafted([
      "# (1) ONE SONG",
      "_ One day at a time sweet Jesus",
      "",
      "Teach me to take",
      "One day at a time…",
    ]);
    expect(parts).toContain("s1: Teach me to take / One day at a time…");
  });

  it("takes a label before the chorus printed as that chorus", () => {
    expect(
      drafted(["# (1) ONE SONG", "First verse here", "Goes on now…Cho…", "_ Sing it, sing it"])
        .sequence,
    ).toBe("s1 c");
  });

  it("gives a block in two fonts the kind of the font it starts in", () => {
    const { parts, notes } = drafted([
      "# (1) ONE SONG",
      "First verse here",
      "",
      "_ Passover, Passover",
      "_ Pass over me",
      "For see the Lamb has died",
      "And I will live",
      "I will live",
    ]);
    expect(parts[1]).toMatch(/^c: Passover/);
    expect(notes("fonts")).toEqual([
      '2 of 5 lines in the chorus font, taken as a chorus as it starts: "Passover, Passover"',
    ]);
  });
});
