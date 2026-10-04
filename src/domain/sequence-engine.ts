import type { Hymn, Occurrence, PartId, Position, SequenceEntry } from "./types.ts";

/**
 * Pure navigation over a hymn's effective sequence — see SDD-0001 §5.
 * No DOM, no framework, no storage.
 */
export interface SequenceEngine {
  readonly hymn: Hymn;
  readonly cursor: Position;
  /** Length of the effective sequence, including ad-hoc entries. */
  readonly length: number;

  occurrenceAt(index: number): Occurrence | undefined;
  current(): Occurrence;

  /**
   * Step by part or by line. `skip` names a part that is always in view (a
   * pinned chorus under a whole-song highlight): stepping goes past all its
   * showings, repeats included, and does nothing when only they remain. The
   * path itself is never changed (SDD-0001 §5.4).
   */
  next(skip?: PartId): void;
  previous(skip?: PartId): void;
  nextLine(skip?: PartId): void;
  previousLine(skip?: PartId): void;
  /** Whether a part step has anything to do: a showing to go to, or line
   * focus to widen. */
  hasNext(skip?: PartId): boolean;
  hasPrevious(skip?: PartId): boolean;

  goTo(occurrenceIndex: number, lineIndex?: number | null): void;

  /**
   * Move to `partId` within the path, never changing it (SDD-0001 §5.1):
   * restart it if it's the current part, else go forward to its next
   * occurrence or, when it lies only behind, back to its most recent one.
   */
  jumpToPart(partId: PartId): void;

  /** Sing the current part again: insert it right after the cursor and move
   * there. The only way to repeat — never a side effect of a jump. */
  repeatCurrent(): void;

  /** Whether the cursor is on a repeat {@link undoRepeat} can take back. */
  canUndoRepeat(): boolean;

  /**
   * Take back the repeat the cursor is on (SDD-0001 §5.1): remove that
   * ad-hoc entry and return to the showing before it, on the same line, so
   * the Output doesn't move. A no-op anywhere else.
   */
  undoRepeat(): void;

  /**
   * Take back every repeat of the current part's run at once: its ad-hoc
   * entries go, the cursor returns to the showing left, on the same line.
   * A no-op when the run holds no repeat.
   */
  resetRepeats(): void;
}

/**
 * `lineIndex` walks a flattened [null, 0, 1, ..., lastLine] sequence per
 * occurrence: null precedes line 0 within the same occurrence, so stepping
 * past either end of that local sequence rolls into the adjacent occurrence,
 * landing on its near end (null going forward, its last line going
 * backward). Occurrence-level moves (next/previous/goTo/jumpToPart) always
 * land on null, the arrival default from SDD-0001 §5.4 — itself flagged
 * there as an open question pending real on-screen validation.
 */
interface PathEntry extends SequenceEntry {
  isAdHoc: boolean;
}

class HymnSequenceEngine implements SequenceEngine {
  readonly hymn: Hymn;
  /**
   * The effective sequence: the path actually taken. Starts as a copy of the
   * stored sequence (which is never mutated); entries up to the cursor are
   * history and never change, jumps rewrite only what lies ahead.
   */
  private path: PathEntry[];
  private cursorIndex = 0;
  private cursorLineIndex: number | null = null;

  constructor(hymn: Hymn) {
    this.hymn = hymn;
    this.path = hymn.sequence.map((entry) => ({ partId: entry.partId, isAdHoc: false }));
  }

  get length(): number {
    return this.path.length;
  }

  get cursor(): Position {
    return {
      hymnbookId: this.hymn.hymnbookId,
      hymnNumber: this.hymn.number,
      occurrenceIndex: this.cursorIndex,
      lineIndex: this.cursorLineIndex,
    };
  }

  private partById(id: PartId) {
    const part = this.hymn.parts.find((p) => p.id === id);
    if (!part) throw new Error(`unknown part id: ${id}`);
    return part;
  }

  occurrenceAt(index: number): Occurrence | undefined {
    const sequence = this.path;
    const entry = sequence[index];
    if (!entry) return undefined;

    // Adjacency, not "anywhere earlier" — see SDD-0001 §2.2/§5.2. Walk
    // backward only while the part stays the same.
    let repeatOrdinal = 1;
    for (let j = index - 1; j >= 0 && sequence[j].partId === entry.partId; j--) {
      repeatOrdinal++;
    }

    return {
      index,
      part: this.partById(entry.partId),
      repeatOrdinal,
      isAdHoc: entry.isAdHoc,
    };
  }

  current(): Occurrence {
    const occurrence = this.occurrenceAt(this.cursorIndex);
    if (!occurrence) throw new Error(`cursor out of range: ${this.cursorIndex}`);
    return occurrence;
  }

  // Part steps always land on a whole part. At either end there's no part
  // to go to, but from line focus they still widen to the whole part the
  // cursor is in, rather than doing nothing.
  /** The nearest showing from the cursor, in `step` direction, whose part is not `skip`. */
  private stepTarget(step: 1 | -1, skip?: PartId): number | undefined {
    for (let i = this.cursorIndex + step; i >= 0 && i < this.length; i += step) {
      if (this.path[i].partId !== skip) return i;
    }
    return undefined;
  }

  hasNext(skip?: PartId): boolean {
    return this.cursorLineIndex !== null || this.stepTarget(1, skip) !== undefined;
  }

  hasPrevious(skip?: PartId): boolean {
    return this.cursorLineIndex !== null || this.stepTarget(-1, skip) !== undefined;
  }

  next(skip?: PartId): void {
    this.cursorIndex = this.stepTarget(1, skip) ?? this.cursorIndex;
    this.cursorLineIndex = null;
  }

  previous(skip?: PartId): void {
    this.cursorIndex = this.stepTarget(-1, skip) ?? this.cursorIndex;
    this.cursorLineIndex = null;
  }

  nextLine(skip?: PartId): void {
    const position = this.cursorLineIndex ?? -1;
    const { lines } = this.current().part;
    if (position + 1 < lines.length) {
      this.cursorLineIndex = position + 1;
      return;
    }
    const target = this.stepTarget(1, skip);
    if (target === undefined) return;
    this.cursorIndex = target;
    this.cursorLineIndex = null;
  }

  previousLine(skip?: PartId): void {
    const position = this.cursorLineIndex ?? -1;
    if (position >= 1) {
      this.cursorLineIndex = position - 1;
    } else if (position === 0) {
      this.cursorLineIndex = null;
    } else {
      const target = this.stepTarget(-1, skip);
      if (target === undefined) return;
      this.cursorIndex = target;
      this.cursorLineIndex = this.current().part.lines.length - 1;
    }
  }

  goTo(occurrenceIndex: number, lineIndex: number | null = null): void {
    if (occurrenceIndex < 0 || occurrenceIndex >= this.length) {
      throw new Error(`occurrence index out of range: ${occurrenceIndex}`);
    }
    this.cursorIndex = occurrenceIndex;
    this.cursorLineIndex = lineIndex;
  }

  jumpToPart(partId: PartId): void {
    this.partById(partId);
    const here = this.cursorIndex;
    if (this.path[here].partId === partId) {
      // Restart, never repeat: a stray tap on the current part's chip must
      // not queue it again (SDD-0001 §5.1).
      this.cursorLineIndex = null;
      return;
    }
    // A chip is a shortcut into the song, not a change to it: Next and
    // Previous keep walking the song's order from wherever it lands.
    const ahead = this.path.findIndex((entry, i) => i > here && entry.partId === partId);
    const behind = this.path.findLastIndex((entry, i) => i < here && entry.partId === partId);
    const target = ahead !== -1 ? ahead : behind;
    if (target === -1) throw new Error(`part not in the sequence: ${partId}`);
    this.cursorIndex = target;
    this.cursorLineIndex = null;
  }

  repeatCurrent(): void {
    const here = this.cursorIndex;
    this.path.splice(here + 1, 0, { partId: this.path[here].partId, isAdHoc: true });
    this.cursorIndex = here + 1;
    this.cursorLineIndex = null;
  }

  canUndoRepeat(): boolean {
    const here = this.cursorIndex;
    return (
      this.path[here].isAdHoc && here > 0 && this.path[here - 1].partId === this.path[here].partId
    );
  }

  undoRepeat(): void {
    if (!this.canUndoRepeat()) return;
    this.path.splice(this.cursorIndex, 1);
    this.cursorIndex--;
  }

  resetRepeats(): void {
    const { partId } = this.path[this.cursorIndex];
    let first = this.cursorIndex;
    while (first > 0 && this.path[first - 1].partId === partId) first--;
    let last = this.cursorIndex;
    while (last < this.length - 1 && this.path[last + 1].partId === partId) last++;
    const kept = this.path.slice(first, last + 1).filter((entry) => !entry.isAdHoc);
    // A run with no stored entry (none arises today) keeps its first.
    const run = kept.length > 0 ? kept : [this.path[first]];
    this.path.splice(first, last - first + 1, ...run);
    this.cursorIndex = first;
  }
}

export function createSequenceEngine(hymn: Hymn): SequenceEngine {
  return new HymnSequenceEngine(hymn);
}

/**
 * One line in the Output's continuous scroll (Board #11, SDD-0001 §16.1).
 * Pure — operates only on `SequenceEngine`'s public interface, so it can run
 * unchanged wherever a hymn's flowing line sequence needs rendering.
 */
export interface FlatLine {
  text: string;
  partId: PartId;
  /** True for a part's first line — lets a renderer show a grouping cue
   * without re-deriving part boundaries itself. */
  isPartStart: boolean;
}

/** Half-open range `[start, end)` into a {@link flattenLines} result. */
export interface LineRange {
  start: number;
  end: number;
}

/**
 * The effective sequence as runs: a part and its back-to-back repeats are
 * one run, shown once — a repeat stays in place (SDD-0001 §16.1). `first`
 * and `last` are occurrence indices, inclusive.
 */
export function repeatRuns(engine: SequenceEngine): { first: number; last: number }[] {
  const runs: { first: number; last: number }[] = [];
  for (let i = 0; i < engine.length; i++) {
    const occurrence = engine.occurrenceAt(i);
    if (!occurrence) continue;
    const run = runs.at(-1);
    if (run && occurrence.repeatOrdinal > 1) run.last = i;
    else runs.push({ first: i, last: i });
  }
  return runs;
}

/** The whole effective sequence flattened to individual lines, with the
 * focused range: the whole occurrence under whole-part focus
 * (`lineIndex: null`), a single line otherwise — SDD-0001 §16.1. A repeat
 * adds no lines: its focus is the copy it repeats, so the Output holds
 * still. */
export function flattenLines(engine: SequenceEngine): {
  lines: FlatLine[];
  focus: LineRange;
} {
  const lines: FlatLine[] = [];
  const focus: LineRange = { start: 0, end: 0 };
  const { occurrenceIndex, lineIndex } = engine.cursor;

  for (const run of repeatRuns(engine)) {
    const occurrence = engine.occurrenceAt(run.first);
    if (!occurrence) continue;

    if (occurrenceIndex >= run.first && occurrenceIndex <= run.last) {
      focus.start = lines.length + (lineIndex ?? 0);
      focus.end =
        lineIndex === null ? lines.length + occurrence.part.lines.length : focus.start + 1;
    }
    for (const [li, text] of occurrence.part.lines.entries()) {
      lines.push({ text, partId: occurrence.part.id, isPartStart: li === 0 });
    }
  }

  return { lines, focus };
}

/** The inverse of {@link flattenLines}: which occurrence and line a flattened
 * line index names, or undefined past the end — SDD-0001 §16.1, scroll sync.
 * A line in a repeated run names the showing being sung if the cursor is in
 * that run, else the run's last, so Next carries on past the repeats. */
export function positionOfLine(
  engine: SequenceEngine,
  line: number,
): { occurrenceIndex: number; lineIndex: number } | undefined {
  if (!Number.isInteger(line) || line < 0) return undefined;
  const here = engine.cursor.occurrenceIndex;
  let start = 0;
  for (const run of repeatRuns(engine)) {
    const count = engine.occurrenceAt(run.first)?.part.lines.length ?? 0;
    if (line < start + count) {
      const inRun = here >= run.first && here <= run.last;
      return { occurrenceIndex: inRun ? here : run.last, lineIndex: line - start };
    }
    start += count;
  }
  return undefined;
}
