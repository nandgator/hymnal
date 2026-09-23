import { describe, expect, it } from "vitest";
import { createSequenceEngine, flattenLines } from "./sequence-engine.ts";
import type { Hymn } from "./types.ts";

/** Chorus + verses, the most common corpus shape — SDD-0001 §7. */
function fixtureHymn(): Hymn {
  return {
    hymnbookId: "test-book",
    number: 1,
    title: "Test Hymn",
    parts: [
      { id: "r", kind: "refrain", lines: ["Refrain line 1", "Refrain line 2"] },
      { id: "s1", kind: "stanza", label: "1", lines: ["Stanza 1 line 1"] },
      { id: "s2", kind: "stanza", label: "2", lines: ["Stanza 2 line 1", "Stanza 2 line 2"] },
    ],
    sequence: [
      { partId: "r" },
      { partId: "s1" },
      { partId: "r" },
      { partId: "s2" },
      { partId: "r" },
    ],
    meta: {},
  };
}

describe("createSequenceEngine", () => {
  it("starts at the first occurrence with a whole-part cursor", () => {
    const engine = createSequenceEngine(fixtureHymn());
    expect(engine.length).toBe(5);
    expect(engine.cursor).toEqual({
      hymnbookId: "test-book",
      hymnNumber: 1,
      occurrenceIndex: 0,
      lineIndex: null,
    });
    expect(engine.current().part.id).toBe("r");
  });

  it("does not treat the stored verse-chorus-verse-chorus pattern as a repeat", () => {
    const engine = createSequenceEngine(fixtureHymn());
    // r, s1, r, s2, r — no two adjacent entries share a part, so every
    // occurrence is "not a repeat" (repeatOrdinal 1), even though "r"
    // appears 3 times across the hymn — SDD-0001 §2.2/§5.2.
    for (let i = 0; i < engine.length; i++) {
      expect(engine.occurrenceAt(i)).toMatchObject({ repeatOrdinal: 1 });
    }
  });

  it("counts a genuine back-to-back repeat, extending across repeated ad-hoc jumps", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(4); // the last "r"

    engine.jumpToPart("r"); // immediately repeats it
    expect(engine.current()).toMatchObject({ repeatOrdinal: 2, isAdHoc: true });

    engine.jumpToPart("r"); // repeats again
    expect(engine.current()).toMatchObject({ repeatOrdinal: 3, isAdHoc: true });
  });

  it("a jump to a part different from the effective sequence's current tail is not a repeat", () => {
    const engine = createSequenceEngine(fixtureHymn());
    // jumpToPart always appends after the tail, not wherever the cursor is —
    // the stored sequence already ends in "r" (index 4), so jumping to a
    // *different* part is what's needed to see a non-repeat here.
    engine.goTo(1); // cursor position is irrelevant to adjacency
    engine.jumpToPart("s2");
    expect(engine.current()).toMatchObject({ repeatOrdinal: 1, isAdHoc: true });
  });

  it("returns undefined for an out-of-range occurrence", () => {
    const engine = createSequenceEngine(fixtureHymn());
    expect(engine.occurrenceAt(99)).toBeUndefined();
    expect(engine.occurrenceAt(-1)).toBeUndefined();
  });

  it("next/previous move the cursor and reset to whole-part focus", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(1, 0);

    engine.next();
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 2, lineIndex: null });

    engine.previous();
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 1, lineIndex: null });
  });

  it("next is a no-op at the last occurrence", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(4);
    engine.next();
    expect(engine.cursor.occurrenceIndex).toBe(4);
  });

  it("previous is a no-op at the first occurrence", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.previous();
    expect(engine.cursor.occurrenceIndex).toBe(0);
  });

  it("nextLine walks whole-part, then lines, then rolls into the next occurrence", () => {
    const engine = createSequenceEngine(fixtureHymn());
    // occurrence 0 is "r": whole-part, line 0, line 1, then roll.
    expect(engine.cursor.lineIndex).toBeNull();

    engine.nextLine();
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 0, lineIndex: 0 });

    engine.nextLine();
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 0, lineIndex: 1 });

    engine.nextLine();
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 1, lineIndex: null });
  });

  it("nextLine is a no-op on the last line of the last occurrence", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(4, 1); // last occurrence ("r"), its last line
    engine.nextLine();
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 4, lineIndex: 1 });
  });

  it("previousLine walks lines backward, then whole-part, then the prior occurrence's last line", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(1, 0); // "s1", its only line

    engine.previousLine();
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 1, lineIndex: null });

    engine.previousLine();
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 0, lineIndex: 1 });
  });

  it("previousLine is a no-op at the whole-part focus of the first occurrence", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.previousLine();
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 0, lineIndex: null });
  });

  it("goTo jumps directly and validates range", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(3, 1);
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 3, lineIndex: 1 });

    expect(() => engine.goTo(99)).toThrow();
  });

  it("jumpToPart appends an ad-hoc occurrence without mutating the stored sequence", () => {
    const hymn = fixtureHymn();
    const engine = createSequenceEngine(hymn);

    engine.jumpToPart("r");

    expect(hymn.sequence).toHaveLength(5);
    expect(engine.length).toBe(6);
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 5, lineIndex: null });

    // The stored sequence's last entry (index 4) is already "r", so this
    // ad-hoc jump lands immediately adjacent to it — a genuine repeat.
    const occurrence = engine.current();
    expect(occurrence).toMatchObject({ repeatOrdinal: 2, isAdHoc: true });
  });

  it("jumpToPart throws for an unknown part id", () => {
    const engine = createSequenceEngine(fixtureHymn());
    expect(() => engine.jumpToPart("nope")).toThrow();
  });

  it("presenting the same hymn twice starts identically", () => {
    const hymn = fixtureHymn();
    const first = createSequenceEngine(hymn);
    first.jumpToPart("r");

    const second = createSequenceEngine(hymn);
    expect(second.length).toBe(5);
    expect(second.cursor).toMatchObject({ occurrenceIndex: 0, lineIndex: null });
  });
});

describe("flattenLines", () => {
  it("flattens every occurrence's lines in order, whole-part focus spanning the whole part", () => {
    const engine = createSequenceEngine(fixtureHymn());
    const { lines, focus } = flattenLines(engine);

    // r(2) + s1(1) + r(2) + s2(2) + r(2) = 9 lines.
    expect(lines).toHaveLength(9);
    expect(lines.map((l) => l.text)).toEqual([
      "Refrain line 1",
      "Refrain line 2",
      "Stanza 1 line 1",
      "Refrain line 1",
      "Refrain line 2",
      "Stanza 2 line 1",
      "Stanza 2 line 2",
      "Refrain line 1",
      "Refrain line 2",
    ]);
    expect(lines.map((l) => l.isPartStart)).toEqual([
      true,
      false,
      true,
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(focus).toEqual({ start: 0, end: 2 });
  });

  it("narrows focus to the single focused line of the focused occurrence", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(2, 1); // the second "r", its second line

    // Lines before occurrence 2: r(2) + s1(1) = 3, then line 1 within it.
    expect(flattenLines(engine).focus).toEqual({ start: 4, end: 5 });

    engine.goTo(2); // same occurrence, whole part
    expect(flattenLines(engine).focus).toEqual({ start: 3, end: 5 });
  });

  it("includes ad-hoc occurrences appended by jumpToPart", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.jumpToPart("s1");

    const { lines, focus } = flattenLines(engine);
    expect(lines).toHaveLength(10);
    expect(lines.at(-1)).toMatchObject({ text: "Stanza 1 line 1", partId: "s1" });
    expect(focus).toEqual({ start: 9, end: 10 });
  });
});
