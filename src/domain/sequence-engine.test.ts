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

    engine.repeatCurrent(); // immediately repeats it
    expect(engine.current()).toMatchObject({ repeatOrdinal: 2, isAdHoc: true });

    engine.repeatCurrent(); // repeats again
    expect(engine.current()).toMatchObject({ repeatOrdinal: 3, isAdHoc: true });
  });

  it("going back to an earlier part is a move, not a repeat", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(3); // s2
    engine.jumpToPart("s1"); // only behind — go back
    expect(engine.current()).toMatchObject({ repeatOrdinal: 1, isAdHoc: false });
    expect(engine.current().part.id).toBe("s1");
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

  // SDD-0001 §5.1 — a jump moves within the song's order; only a repeat
  // changes the path.
  const partsOf = (engine: ReturnType<typeof createSequenceEngine>) =>
    Array.from({ length: engine.length }, (_, i) => engine.occurrenceAt(i)?.part.id);

  it("goes forward: the path is untouched, Previous is the part before it in the song", () => {
    const hymn = fixtureHymn();
    const engine = createSequenceEngine(hymn);
    // r, s1, r, s2, r — at r (0), jump to s2.
    engine.jumpToPart("s2");

    expect(partsOf(engine)).toEqual(["r", "s1", "r", "s2", "r"]);
    expect(engine.current()).toMatchObject({ index: 3, isAdHoc: false });
    expect(hymn.sequence).toHaveLength(5); // stored sequence never mutated

    engine.next();
    expect(engine.current()).toMatchObject({ index: 4 }); // Next carries on from s2
    engine.previous();
    engine.previous();
    expect(engine.current()).toMatchObject({ index: 2 }); // the r before s2, not where we were
  });

  it("goes forward to the next occurrence of a recurring part", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(1); // s1
    engine.jumpToPart("r");
    expect(engine.cursor.occurrenceIndex).toBe(2);
  });

  it("restarts, never repeats, when jumping to the part already showing", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(2, 1); // the r after s1, on its second line
    engine.jumpToPart("r");
    engine.jumpToPart("r"); // a stray second tap

    expect(partsOf(engine)).toEqual(["r", "s1", "r", "s2", "r"]);
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 2, lineIndex: null });
  });

  it("repeats in place only when asked: repeatCurrent inserts it and resumes the plan", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(2); // the r after s1
    engine.repeatCurrent();

    expect(partsOf(engine)).toEqual(["r", "s1", "r", "r", "s2", "r"]);
    expect(engine.current()).toMatchObject({ index: 3, repeatOrdinal: 2, isAdHoc: true });
    engine.next();
    expect(engine.current().part.id).toBe("s2"); // resumes, nothing skipped
  });

  it("goes back: to the most recent occurrence of a part only behind, then the song resumes", () => {
    const hymn = fixtureHymn();
    hymn.sequence.pop(); // r, s1, r, s2 — no closing refrain
    const engine = createSequenceEngine(hymn);
    engine.goTo(3); // s2
    engine.jumpToPart("r");
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 2, lineIndex: null });

    engine.jumpToPart("s1");
    expect(partsOf(engine)).toEqual(["r", "s1", "r", "s2"]);
    expect(engine.cursor.occurrenceIndex).toBe(1);
    engine.next();
    expect(engine.current()).toMatchObject({ index: 2 }); // the song carries on
  });

  it("never disables Next after a jump into the middle of a hymn", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.jumpToPart("s1");
    expect(engine.cursor.occurrenceIndex).toBeLessThan(engine.length - 1);
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

  it("follows the path: inserted repeats included, a jump only moving the focus", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.repeatCurrent(); // repeat the opening refrain in place

    const { lines, focus } = flattenLines(engine);
    // r(2) + r(2) + s1(1) + r(2) + s2(2) + r(2) = 11 lines.
    expect(lines).toHaveLength(11);
    expect(lines.slice(2, 4).map((l) => l.text)).toEqual(["Refrain line 1", "Refrain line 2"]);
    expect(focus).toEqual({ start: 2, end: 4 });

    engine.jumpToPart("s2"); // forward past s1, r — both stay
    const after = flattenLines(engine);
    expect(after.lines).toHaveLength(11);
    // r(2) + r(2) + s1(1) + r(2) = 7 lines before s2.
    expect(after.focus).toEqual({ start: 7, end: 9 });
  });
});
