import { describe, expect, it } from "vitest";
import { createSequenceEngine, flattenLines, positionOfLine } from "./sequence-engine.ts";
import type { Hymn } from "./types.ts";

/** Chorus + verses, the most common corpus shape — SDD-0001 §7. */
function fixtureHymn(): Hymn {
  return {
    hymnbookId: "test-book",
    number: 1,
    title: "Test Hymn",
    parts: [
      { id: "c", kind: "chorus", lines: ["Chorus line 1", "Chorus line 2"] },
      { id: "s1", kind: "stanza", label: "1", lines: ["Stanza 1 line 1"] },
      { id: "s2", kind: "stanza", label: "2", lines: ["Stanza 2 line 1", "Stanza 2 line 2"] },
    ],
    sequence: [
      { partId: "c" },
      { partId: "s1" },
      { partId: "c" },
      { partId: "s2" },
      { partId: "c" },
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
    expect(engine.current().part.id).toBe("c");
  });

  it("does not treat the stored verse-chorus-verse-chorus pattern as a repeat", () => {
    const engine = createSequenceEngine(fixtureHymn());
    // r, s1, r, s2, r — no two adjacent entries share a part, so every
    // occurrence is "not a repeat" (repeatOrdinal 1), even though "c"
    // appears 3 times across the hymn — SDD-0001 §2.2/§5.2.
    for (let i = 0; i < engine.length; i++) {
      expect(engine.occurrenceAt(i)).toMatchObject({ repeatOrdinal: 1 });
    }
  });

  it("counts a genuine back-to-back repeat, extending across repeated ad-hoc jumps", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(4); // the last "c"

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
    // occurrence 0 is "c": whole-part, line 0, line 1, then roll.
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
    engine.goTo(4, 1); // last occurrence ("c"), its last line
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

    expect(partsOf(engine)).toEqual(["c", "s1", "c", "s2", "c"]);
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
    engine.jumpToPart("c");
    expect(engine.cursor.occurrenceIndex).toBe(2);
  });

  it("restarts, never repeats, when jumping to the part already showing", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(2, 1); // the r after s1, on its second line
    engine.jumpToPart("c");
    engine.jumpToPart("c"); // a stray second tap

    expect(partsOf(engine)).toEqual(["c", "s1", "c", "s2", "c"]);
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 2, lineIndex: null });
  });

  it("repeats in place only when asked: repeatCurrent inserts it and resumes the plan", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(2); // the r after s1
    engine.repeatCurrent();

    expect(partsOf(engine)).toEqual(["c", "s1", "c", "c", "s2", "c"]);
    expect(engine.current()).toMatchObject({ index: 3, repeatOrdinal: 2, isAdHoc: true });
    engine.next();
    expect(engine.current().part.id).toBe("s2"); // resumes, nothing skipped
  });

  it("widens line focus to the whole part when a part step has nowhere to go", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.nextLine(); // line 0 of the first part
    engine.previous();
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 0, lineIndex: null });

    engine.goTo(4, 1); // the last part, its second line
    engine.next();
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 4, lineIndex: null });
  });

  it("undoes the repeat it's on, on the same line, and nothing else", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(2);
    expect(engine.canUndoRepeat()).toBe(false);
    engine.undoRepeat(); // not on a repeat: nothing changes
    expect(partsOf(engine)).toEqual(["c", "s1", "c", "s2", "c"]);

    engine.repeatCurrent();
    engine.repeatCurrent(); // ×3
    engine.nextLine(); // line 0 of the third showing
    expect(engine.canUndoRepeat()).toBe(true);
    engine.undoRepeat();
    expect(partsOf(engine)).toEqual(["c", "s1", "c", "c", "s2", "c"]);
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 3, lineIndex: 0 });
    engine.undoRepeat();
    expect(partsOf(engine)).toEqual(["c", "s1", "c", "s2", "c"]);
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 2, lineIndex: 0 });
    expect(engine.canUndoRepeat()).toBe(false);
  });

  it("resets a run of repeats at once, from any showing in it, on the same line", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(2);
    engine.repeatCurrent();
    engine.repeatCurrent(); // r, s1, r, r, r, s2, r
    engine.previous(); // the middle showing
    engine.nextLine();
    engine.resetRepeats();
    expect(partsOf(engine)).toEqual(["c", "s1", "c", "s2", "c"]);
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 2, lineIndex: 0 });

    engine.resetRepeats(); // nothing left to reset
    expect(partsOf(engine)).toEqual(["c", "s1", "c", "s2", "c"]);
  });

  it("goes back: to the most recent occurrence of a part only behind, then the song resumes", () => {
    const hymn = fixtureHymn();
    hymn.sequence.pop(); // r, s1, r, s2 — no closing chorus
    const engine = createSequenceEngine(hymn);
    engine.goTo(3); // s2
    engine.jumpToPart("c");
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 2, lineIndex: null });

    engine.jumpToPart("s1");
    expect(partsOf(engine)).toEqual(["c", "s1", "c", "s2"]);
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
    first.jumpToPart("c");

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
      "Chorus line 1",
      "Chorus line 2",
      "Stanza 1 line 1",
      "Chorus line 1",
      "Chorus line 2",
      "Stanza 2 line 1",
      "Stanza 2 line 2",
      "Chorus line 1",
      "Chorus line 2",
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
    engine.goTo(2, 1); // the second "c", its second line

    // Lines before occurrence 2: r(2) + s1(1) = 3, then line 1 within it.
    expect(flattenLines(engine).focus).toEqual({ start: 4, end: 5 });

    engine.goTo(2); // same occurrence, whole part
    expect(flattenLines(engine).focus).toEqual({ start: 3, end: 5 });
  });

  it("keeps a repeat in place: no new lines, the focus stays on the copy it repeats", () => {
    const engine = createSequenceEngine(fixtureHymn());
    const before = flattenLines(engine);
    engine.repeatCurrent(); // repeat the opening chorus
    engine.repeatCurrent(); // and again

    const { lines, focus } = flattenLines(engine);
    expect(lines).toEqual(before.lines);
    expect(focus).toEqual({ start: 0, end: 2 });
    engine.nextLine(); // a line step inside the third showing
    expect(flattenLines(engine).focus).toEqual({ start: 0, end: 1 });

    engine.jumpToPart("s2"); // forward past s1, r
    // r(2) + s1(1) + r(2) = 5 lines before s2.
    expect(flattenLines(engine).focus).toEqual({ start: 5, end: 7 });
  });
});

describe("positionOfLine", () => {
  it("inverts flattenLines: every flattened line maps back to its occurrence and line", () => {
    const engine = createSequenceEngine(fixtureHymn());
    const { lines } = flattenLines(engine);
    let seen = 0;
    for (let i = 0; i < engine.length; i++) {
      const count = engine.occurrenceAt(i)?.part.lines.length ?? 0;
      for (let line = 0; line < count; line++) {
        expect(positionOfLine(engine, seen)).toEqual({ occurrenceIndex: i, lineIndex: line });
        seen++;
      }
    }
    expect(seen).toBe(lines.length);
  });

  it("lands a repeated run on the showing being sung, else its last, so Next carries on", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(2);
    engine.repeatCurrent(); // r, s1, r, [r], s2, r
    expect(positionOfLine(engine, 4)).toEqual({ occurrenceIndex: 3, lineIndex: 1 });
    engine.previous(); // on the first showing of the run
    expect(positionOfLine(engine, 3)).toEqual({ occurrenceIndex: 2, lineIndex: 0 });

    engine.goTo(0); // elsewhere: the run's last showing
    expect(positionOfLine(engine, 3)).toEqual({ occurrenceIndex: 3, lineIndex: 0 });
    // After the run, lines map past the repeat: s2 starts at line 5.
    expect(positionOfLine(engine, 5)).toEqual({ occurrenceIndex: 4, lineIndex: 0 });
  });

  it("names nothing outside the lines", () => {
    const engine = createSequenceEngine(fixtureHymn());
    const { lines } = flattenLines(engine);
    expect(positionOfLine(engine, lines.length)).toBeUndefined();
    expect(positionOfLine(engine, -1)).toBeUndefined();
    expect(positionOfLine(engine, 1.5)).toBeUndefined();
  });
});

describe("stepping over a part that is always in view (a pinned chorus)", () => {
  // c, s1, c, s2, c — the chorus is `skip`.
  const at = (engine: ReturnType<typeof createSequenceEngine>) => engine.cursor.occurrenceIndex;

  it("next and previous step over the chorus, and the stored sequence is unchanged", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.next("c"); // from the opening chorus
    expect(at(engine)).toBe(1);
    engine.next("c");
    expect(at(engine)).toBe(3);
    engine.next("c"); // only the closing chorus is left: nothing to step to
    expect(at(engine)).toBe(3);
    engine.previous("c");
    expect(at(engine)).toBe(1);
    engine.previous("c");
    expect(at(engine)).toBe(1);
    expect(engine.length).toBe(5);
  });

  it("without a part to skip, stepping is as ever", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.next();
    engine.next();
    expect(at(engine)).toBe(2);
    expect(engine.current().part.id).toBe("c");
  });

  it("a part step from line focus widens to the whole part even with nowhere to go", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(3, 1);
    engine.next("c");
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 3, lineIndex: null });
    engine.goTo(1, 0);
    engine.previous("c");
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 1, lineIndex: null });
  });

  it("a tapped chorus still selects, and stepping leaves it for a verse", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(2); // a direct tap
    expect(engine.current().part.id).toBe("c");
    engine.next("c");
    expect(at(engine)).toBe(3);
    engine.goTo(2);
    engine.previous("c");
    expect(at(engine)).toBe(1);
  });

  it("a repeat of the chorus stays in the sequence; stepping skips all its showings", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(2);
    engine.repeatCurrent(); // c, s1, c, c', s2, c
    expect(engine.length).toBe(6);
    expect(engine.canUndoRepeat()).toBe(true);
    engine.goTo(1);
    engine.next("c");
    expect(engine.current().part.id).toBe("s2");
    expect(at(engine)).toBe(4);
    engine.previous("c");
    expect(at(engine)).toBe(1);
    engine.goTo(3);
    engine.undoRepeat();
    expect(engine.length).toBe(5);
  });

  it("line steps skip the chorus's lines", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(1, 0); // s1's only line
    engine.nextLine("c");
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 3, lineIndex: null });
    engine.nextLine("c");
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 3, lineIndex: 0 });
    engine.nextLine("c");
    engine.nextLine("c"); // past s2's last line: only the chorus follows
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 3, lineIndex: 1 });

    engine.goTo(3, null);
    engine.previousLine("c"); // back over the chorus to s1's last line
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 1, lineIndex: 0 });
    engine.previousLine("c");
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 1, lineIndex: null });
    engine.previousLine("c"); // only the chorus lies behind
    expect(engine.cursor).toMatchObject({ occurrenceIndex: 1, lineIndex: null });
  });

  it("reports whether a step has anywhere to go", () => {
    const engine = createSequenceEngine(fixtureHymn());
    engine.goTo(3);
    expect(engine.hasNext()).toBe(true);
    expect(engine.hasNext("c")).toBe(false);
    expect(engine.hasPrevious("c")).toBe(true);
    engine.goTo(1);
    expect(engine.hasPrevious()).toBe(true);
    expect(engine.hasPrevious("c")).toBe(false);
    engine.goTo(1, 0);
    expect(engine.hasPrevious("c")).toBe(true); // widens to the whole part
  });
});
