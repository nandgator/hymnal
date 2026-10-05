// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { HymnSource } from "../domain/types.ts";
import { draftBook, firstLineTitle, titleOf } from "./draft.ts";
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

describe("a stanza split by a column break", () => {
  // Song 6's second stanza starts at the foot of the left column; song 7 runs
  // a stanza of four to the foot of the left column and starts another at the
  // top of the right.
  const stubs = draftBook(
    [
      indexPage,
      page(
        2,
        [
          "# (6) THE STUB",
          "The widest line of this column runs out long",
          "Over the hill",
          "Under the sky",
          "Home again",
          "",
          "Down by the shore",
          "Out on the sea",
        ],
        [
          "Waves come and go along the whole wide shore",
          "Gulls wheel high above",
          "Salt in the air",
          "Wide and free",
          "",
          "Back to the shore",
          "Back to the sea",
          "Back to the sand",
          "Back to me",
        ],
      ),
      page(
        3,
        [
          "# (7) TWO OF FOUR",
          "The widest line of this column runs out long",
          "Over the hill",
          "Under the sky",
          "Home again",
          "",
          "Down by the shore",
          "Out on the sea",
          "Waves come and go",
          "Gulls overhead",
        ],
        ["Salt in the air", "Back to the shore", "Back to the sea", "Back to the sand"],
      ),
    ],
    profile,
  );
  const song = (number: number) => stubs.hymns.find((h) => h.number === number) as HymnSource;

  it("joins a half too short to be a block of this song to one as long as the others", () => {
    expect(song(6).parts.map((p) => p.lines.length)).toEqual([4, 6, 4]);
    expect(song(6).parts[1].lines.slice(0, 3)).toEqual([
      "Down by the shore",
      "Out on the sea",
      "Waves come and go along the whole wide shore",
    ]);
  });

  it("keeps two halves apart when each is as long as the song's blocks", () => {
    expect(song(7).parts.map((p) => p.lines.length)).toEqual([4, 4, 4]);
  });
});

describe("a chorus split by a column break", () => {
  // Song 12's only chorus runs 4 | 2 over the break among stanzas of four;
  // song 13 has another chorus, so its halves are measured against that.
  const stanza = (word: string) => [
    `Over the hill we ${word}`,
    `Under the sky we ${word}`,
    `Home again at last we ${word}`,
    `Back to the sea we ${word}`,
  ];
  const chorus = (word: string, n: number) =>
    Array.from({ length: n }, (_, i) => `_ Praise Him ${word} ${i + 1}`);
  const choruses = draftBook(
    [
      indexPage,
      page(
        2,
        ["# (12) ONE CHORUS", ...stanza("go"), "", ...stanza("sing"), "", ...chorus("now", 4)],
        [...chorus("now", 6).slice(4), "", "# (14) FILLER", ...stanza("run")],
      ),
      page(
        3,
        [
          "# (13) TWO CHORUSES",
          ...chorus("first", 2),
          "",
          ...stanza("go"),
          "",
          ...chorus("again", 4),
        ],
        [...chorus("again", 6).slice(4), "", "# (15) FILLER", ...stanza("hop")],
      ),
    ],
    profile,
  );
  const song = (number: number) => choruses.hymns.find((h) => h.number === number) as HymnSource;
  const sizes = (number: number) =>
    song(number)
      .parts.filter((p) => p.kind === "chorus")
      .map((p) => p.lines.length);

  it("joins the halves when the song has no other chorus", () => {
    expect(sizes(12)).toEqual([6]);
  });

  it("keeps a chorus half apart from a stanza half, with no other chorus", () => {
    const mixed = draftBook(
      [
        indexPage,
        page(
          2,
          ["# (16) MIXED", ...stanza("go"), "", ...chorus("now", 4)],
          [...stanza("sing"), "", "# (17) FILLER", ...stanza("run")],
        ),
        page(3, ["# (18) FILLER", ...stanza("hop")], [...stanza("skip")]),
      ],
      profile,
    );
    const parts = mixed.hymns.find((h) => h.number === 16)?.parts.map((p) => p.lines.length);
    expect(parts).toEqual([4, 4, 4]);
  });

  it("keeps them apart when the song has another chorus to measure against", () => {
    expect(sizes(13)).toEqual([2, 4, 2]);
  });
});

describe("a block twice the usual length", () => {
  // Song 8 prints two stanzas of three, then six lines with no gap between
  // them; song 9's chorus is twice its stanzas, and song 10's stanza of four
  // follows stanzas of two.
  const long = draftBook(
    [
      indexPage,
      page(
        2,
        [
          "# (8) NO GAP",
          "Over the hill we go",
          "Under the sky we sing",
          "Home again at last",
          "",
          "Down by the shore we walk",
          "Out on the sea we sail",
          "Back to the sand we come",
          "",
          "Stars in the sky above",
          "Moon on the sea below",
          "Salt in the air tonight",
          "Gulls on the wing at dawn",
          "Waves on the shore at noon",
          "Wind in the pines at dusk",
        ],
        [
          "# (9) BIG CHORUS",
          "Sing to the Lord a song",
          "Sing to the Lord again",
          "Sing to the Lord a song",
          "Sing to the Lord again",
          "",
          "Morning has broken now",
          "Evening will come again",
          "Night will fall soft",
          "Day will break clear",
          "",
          "_ Praise Him all you people",
          "_ Praise Him all you saints",
          "_ Praise Him all you nations",
          "_ Praise Him all you kings",
          "_ Praise Him in the heights",
          "_ Praise Him in the deeps",
          "_ Praise Him for His love",
          "_ Praise Him for His grace",
        ],
      ),
      page(
        3,
        ["# (11) FILLER", "Nothing to see here", "Nothing to hear either"],
        [
          "# (10) SHORT ONES",
          "One line here friends",
          "Another line follows",
          "",
          "A second pair arrives",
          "With another line too",
          "",
          "Now a verse of four",
          "That runs a bit longer",
          "Past the usual pair",
          "Before the song ends",
        ],
      ),
    ],
    profile,
  );
  const flagged = long.notes.filter((n) => n.kind === "long").map((n) => `${n.hymn} ${n.message}`);

  it("notes a stanza twice as long as the song's other stanzas, where they are three lines or more", () => {
    expect(flagged).toEqual([
      "8 stanza 3: 6 lines, twice the 3 of the song's other stanzas: two stanzas printed with no gap?",
    ]);
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

describe("the index against the heading", () => {
  /** A one-song book whose index lists the song as `listed`. */
  const indexed = (heading: string, listed: string) => {
    const index: SourcePage = {
      ...indexPage,
      lines: ["1", listed, "1"].map((text, j) => ({
        text,
        x: [30, 50, 180][j],
        y: 40,
        width: 20,
        size: 10,
        font: ROMAN,
      })),
    };
    const one = page(2, [`# (1) ${heading}`, "Sing out", "Sing the light"], [], "1");
    return draftBook([index, one], { ...profile, pages: { from: 2, to: 2 } });
  };

  it("takes the index's title where it differs by O and Oh, or & and and", () => {
    const oh = indexed("CHANGE MY HEART OH GOD", "Change my heart O God");
    expect(oh.hymns[0].title).toBe("Change my heart O God");
    expect(oh.notes.filter((n) => n.kind === "index")).toEqual([]);
    const and = indexed("COME YE SINNERS, POOR AND NEEDY", "Come ye sinners, poor & needy");
    expect(and.hymns[0].title).toBe("Come ye sinners, poor & needy");
    expect(and.notes.filter((n) => n.kind === "index")).toEqual([]);
  });

  it("keeps a bracketed subtitle the index leaves out, without a note", () => {
    const d = indexed("SOME GLAD MORNING (I’LL FLY AWAY)", "Some glad morning");
    expect(d.hymns[0].title).toBe("Some glad morning (I’ll fly away)");
    expect(d.notes.filter((n) => n.kind === "index")).toEqual([]);
  });

  it("takes the index's title where one begins with all the other's words", () => {
    const longer = indexed("ONLY BY GRACE", "Only by grace can we enter");
    expect(longer.hymns[0].title).toBe("Only by grace can we enter");
    expect(longer.notes.filter((n) => n.kind === "index")).toEqual([]);
    const shorter = indexed("BE STILL, FOR THE PRESENCE OF THE LORD", "Be still, for the presence");
    expect(shorter.hymns[0].title).toBe("Be still, for the presence");
    expect(shorter.notes.filter((n) => n.kind === "index")).toEqual([]);
  });

  it("doesn't take a single shared word for the same song", () => {
    const d = indexed("HOLY", "Holy holy holy");
    expect(d.hymns[0].title).toBe("Holy");
    expect(d.notes.filter((n) => n.kind === "index")).toHaveLength(1);
  });

  it("still notes a heading that differs from the index in its words", () => {
    const d = indexed("WHO HOLD THE HEAVENS", "Who holds the heavens");
    expect(d.notes.filter((n) => n.kind === "index").map((n) => n.message)).toEqual([
      `headed "WHO HOLD THE HEAVENS", listed as "Who holds the heavens"; titled "Who hold the heavens"`,
    ]);
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
      labels: { ...profile.labels, cho: "chorus", end: "outro" },
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

  it("reads a chorus's first line alone, trailing off, as that chorus", () => {
    const { parts, sequence } = drafted([
      "# (1) ONE SONG",
      "First verse here",
      "",
      "_ Jesus Messiah, name above all",
      "_ Lord of all",
      "",
      "Second verse here",
      "",
      "_ Jesus Messiah …..",
    ]);
    expect(parts).toHaveLength(3);
    expect(sequence).toBe("s1 c s2 c");
  });

  it("sings the chorus after a bridge, by the rule, and an ending last", () => {
    const { sequence } = drafted([
      "# (1) ONE SONG",
      "First verse here",
      "",
      "_ Sing it, sing it",
      "",
      "Second verse here",
      "",
      "Bridge:",
      "Over and over",
      "",
      "End:",
      "Amen, amen",
    ]);
    expect(sequence).toBe("s1 c s2 c b c o");
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

describe("a wrap before a line starting with I", () => {
  const drafted = (lines: string[]) => {
    const { hymns, notes } = draftBook([page(1, lines, [])], {
      ...profile,
      index: undefined,
      pages: { from: 1, to: 1 },
    });
    return {
      lines: hymns[0].parts.flatMap((p) => p.lines),
      wraps: notes.filter((n) => n.kind === "wrap").length,
    };
  };

  it("joins a short one, a guess, but not a line of its own", () => {
    const { lines, wraps } = drafted([
      "# (1) ONE SONG",
      "When the oceans rise and thunders roar all day", // 46 characters; the measure is the 47 below
      "I will soar with You above the storm",
      "In the mirror of all His word, reflections that",
      "I see",
    ]);
    expect(lines).toEqual([
      "When the oceans rise and thunders roar all day",
      "I will soar with You above the storm",
      "In the mirror of all His word, reflections that I see",
    ]);
    expect(wraps).toBe(1);
  });
});

describe("a deck: one song a slide, headed by a bare number, no titles", () => {
  // Slides of 24 pt type on a 26 pt pitch; "7" alone heads each song. Every
  // line is as long as the measure, so a printer's-wrap rule would join them.
  const long = "Lines as long as the widest line of the whole deck, ";
  const slide = (number: number, rows: string[], step = 26, at = number): SourcePage => {
    let y = 40;
    const lines: SourceLine[] = [
      { text: String(number), x: 440, y, width: 20, size: 28, font: BOLD },
    ];
    y += 30;
    for (const row of rows) {
      if (row === "") {
        y += step;
        continue;
      }
      const [font, text] = row.startsWith("_ ") ? [ITALIC, row.slice(2)] : [BOLD, row];
      lines.push({ text, x: 50, y, width: 900, size: 24, font });
      y += step;
    }
    return { number: at, width: 960, height: 540, lines };
  };
  const deckProfile = parseProfile({
    hymnbook: { id: "deck", title: "Deck", language: "en", script: "Latn" },
    pages: { from: 1, to: 4 },
    furniture: { pageNumber: false },
    title: { pattern: "^(?<number>\\d+)(?<title>)$" },
    chorus: { font: ITALIC },
    labels: {},
    wraps: false,
    pitch: "page",
    stanzaGap: 1.3,
  });
  const deck = draftBook(
    [
      slide(1, [
        `${long}and on,`,
        "continues here",
        "",
        "_ Refrain line one",
        "_ Refrain line two",
      ]),
      slide(2, ["Only stanza,", "of two lines"]),
      // A slide that shrank its type: stanza gap 32 on a pitch of 22.
      slide(3, ["One of four", "Two of four", "", "Three of four", "Four of four"], 22),
      slide(3, ["Printed twice"]),
    ],
    deckProfile,
  );

  it("keeps each slide line as the author's, without joining to the next", () => {
    expect(deck.hymns[0].parts[0].lines).toEqual([`${long}and on,`, "continues here"]);
    expect(deck.notes.filter((n) => n.kind === "wrap")).toEqual([]);
  });

  it("names an untitled song by its first line, and notes each", () => {
    expect(deck.hymns.map((h) => h.title)).toEqual([`${long}and on`, "Only stanza", "One of four"]);
    expect(deck.notes.filter((n) => n.kind === "untitled").map((n) => n.hymn)).toEqual([1, 2, 3]);
  });

  it("finds a chorus by font, and a deck's slide by its own pitch", () => {
    expect(deck.hymns[0].parts.map((p) => p.kind)).toEqual(["stanza", "chorus"]);
    expect(deck.hymns[2].parts.map((p) => p.lines.length)).toEqual([2, 2]);
  });

  it("leaves out a second song with the same number, and says so", () => {
    expect(deck.hymns).toHaveLength(3);
    expect(deck.notes.filter((n) => n.kind === "number").map((n) => n.message)).toEqual([
      "printed again; this copy is left out",
    ]);
    expect(deck.notes.filter((n) => n.kind === "invalid")).toEqual([]);
  });

  it("needs no chorus font", () => {
    const profile = parseProfile(bareProfile());
    expect(profile.chorus).toBeUndefined();
    const kinds = draftBook([slide(1, ["_ Italic as the rest", "Line"])], profile).hymns[0].parts;
    expect(kinds.map((p) => p.kind)).toEqual(["stanza"]);
  });

  it("checks the new fields", () => {
    expect(() => parseProfile({ ...bareProfile(), wraps: "no", pitch: "slide" })).toThrow(
      ["- wraps must be true or false", '- pitch must be "book" or "page"'].join("\n"),
    );
  });

  describe("continues", () => {
    const span = (to: number) => ({ ...bareProfile(), pages: { from: 1, to } });
    const withContinues = parseProfile({ ...span(6), continues: true, wraps: false });
    const without = parseProfile({ ...span(6), wraps: false });
    const pages = [
      slide(1, ["Stanza one,", "its second line"]),
      slide(2, ["First of two slides"]),
      slide(2, ["Second of two slides"], 26, 3),
      slide(4, ["Another song"]),
      slide(5, ["Far from its twin"]),
      slide(2, ["Not adjacent, so dropped"], 26, 6),
    ];

    it("joins a number printed again on the next slide, as a new stanza", () => {
      const draft = draftBook(pages, withContinues);
      const two = draft.hymns.find((h) => h.number === 2);
      expect(two?.parts.map((p) => p.lines)).toEqual([
        ["First of two slides"],
        ["Second of two slides"],
      ]);
      expect(two?.parts.map((p) => p.kind)).toEqual(["stanza", "stanza"]);
      expect(two?.sequence).toHaveLength(2);
      expect(draft.notes.filter((n) => n.kind === "invalid")).toEqual([]);
    });

    it("still drops a repeat that is not on the next slide, and says so", () => {
      const draft = draftBook(pages, withContinues);
      expect(draft.hymns.map((h) => h.number)).toEqual([1, 2, 4, 5]);
      const notes = draft.notes.filter((n) => n.kind === "number").map((n) => n.message);
      expect(notes.filter((m) => m.includes("left out"))).toHaveLength(1);
      expect(notes.filter((m) => m.includes("next stanza"))).toHaveLength(1);
    });

    it("is off by default: the repeat is left out", () => {
      const draft = draftBook(pages, without);
      const two = draft.hymns.find((h) => h.number === 2);
      expect(two?.parts.map((p) => p.lines)).toEqual([["First of two slides"]]);
      expect(draft.notes.filter((n) => n.message.includes("left out"))).toHaveLength(2);
    });

    it("chains a continuation of a continuation", () => {
      const draft = draftBook(
        [slide(1, ["A"]), slide(1, ["B"], 26, 2), slide(1, ["C"], 26, 3)],
        parseProfile({ ...span(3), continues: true, wraps: false }),
      );
      expect(draft.hymns).toHaveLength(1);
      expect(draft.hymns[0].parts.map((p) => p.lines)).toEqual([["A"], ["B"], ["C"]]);
    });

    it("continues from a song's last page, then drops a repeat further on", () => {
      const draft = draftBook(
        [slide(1, ["A"]), slide(1, ["B"], 26, 2), slide(1, ["C"], 26, 3)],
        parseProfile({ ...span(3), continues: true, wraps: false }),
      );
      expect(draft.notes.filter((n) => n.message.includes("left out"))).toEqual([]);
      const spanning = draftBook(
        [slide(1, ["A"]), slide(2, ["B"], 26, 2), slide(2, ["C"], 26, 3), slide(2, ["D"], 26, 5)],
        parseProfile({ ...span(5), continues: true, wraps: false }),
      );
      expect(spanning.hymns.find((h) => h.number === 2)?.parts).toHaveLength(2);
      expect(spanning.notes.filter((n) => n.message.includes("left out"))).toHaveLength(1);
    });

    it("does not leak a continuation's stanza break into the next song", () => {
      const empty = { ...slide(1, []), number: 2 };
      const draft = draftBook(
        [slide(1, ["A"]), empty, slide(2, ["B", "C"], 26, 3)],
        parseProfile({ ...span(3), continues: true, wraps: false }),
      );
      expect(draft.hymns.find((h) => h.number === 2)?.parts.map((p) => p.lines)).toEqual([
        ["B", "C"],
      ]);
    });

    it("notes a title on a continuation heading", () => {
      const titled = parseProfile({
        ...span(2),
        continues: true,
        wraps: false,
        title: { pattern: "^(?<number>\\d+)(?<title>.*)$" },
      });
      const heading = slide(1, ["A"]);
      const next = slide(1, ["B"], 26, 2);
      next.lines[0].text = "1 Named again";
      const draft = draftBook([heading, next], titled);
      expect(draft.notes.some((n) => n.message.includes("not compared"))).toBe(true);
    });

    it("checks the field", () => {
      expect(() => parseProfile({ ...span(1), continues: 1 })).toThrow(
        "- continues must be true or false",
      );
    });
  });

  it("passes the publisher through to the hymnbook", () => {
    const profile = parseProfile({
      ...bareProfile(),
      hymnbook: { ...bareProfile().hymnbook, publisher: "A Press, Town" },
    });
    expect(draftBook([slide(1, ["A line"])], profile).hymnbook.publisher).toBe("A Press, Town");
    expect(
      draftBook([slide(1, ["A line"])], parseProfile(bareProfile())).hymnbook,
    ).not.toHaveProperty("publisher");
  });

  it("notes an untitled song whose first line is empty, and it stays invalid", () => {
    const draft = draftBook([slide(1, ["—"])], parseProfile(bareProfile()));
    expect(draft.hymns[0].title).toBe("");
    expect(draft.notes.find((n) => n.kind === "untitled")?.message).toMatch(/first line is empty/);
    expect(draft.notes.some((n) => n.kind === "invalid" && /title/.test(n.message))).toBe(true);
  });

  it('measures a page with no step of its own by the book\'s pitch ("page")', () => {
    const lines = (ys: number[]): SourceLine[] =>
      ys.map((y) => ({ text: "x", x: 50, y, width: 100, size: 24, font: BOLD }));
    const pages: SourcePage[] = [
      { number: 1, width: 960, height: 540, lines: lines([40, 66, 92, 118]) },
      // Two lines closer than their type is tall, and a lone line: no step.
      { number: 2, width: 960, height: 540, lines: lines([40, 52]) },
      { number: 3, width: 960, height: 540, lines: lines([40]) },
    ];
    const flowed = flow(
      pages,
      parseProfile({ ...bareProfile(), pages: { from: 1, to: 3 }, pitch: "page" }),
    );
    expect(flowed.pitch).toBe(26);
    const [, close] = flowed.lines.filter((l) => l.page === 2);
    expect(close.gap).toBeCloseTo(12 / 26);
    expect(flowed.lines.find((l) => l.page === 3)?.gap).toBeNull();
  });

  it("trims what ended a first line", () => {
    expect(firstLineTitle("Lord, we are Thine; ")).toBe("Lord, we are Thine");
    expect(firstLineTitle("Rise, my soul!")).toBe("Rise, my soul!");
  });
});

function bareProfile() {
  return {
    hymnbook: { id: "d", title: "D", language: "en", script: "Latn" },
    pages: { from: 1, to: 1 },
    furniture: { pageNumber: false },
    title: { pattern: "^(?<number>\\d+)(?<title>)$" },
    labels: {},
    stanzaGap: 1.3,
  };
}
