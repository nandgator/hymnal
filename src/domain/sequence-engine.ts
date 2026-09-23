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

  next(): void;
  previous(): void;
  nextLine(): void;
  previousLine(): void;

  goTo(occurrenceIndex: number, lineIndex?: number | null): void;

  /** Append an ad-hoc occurrence of `partId` and move to it. */
  jumpToPart(partId: PartId): void;
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
class HymnSequenceEngine implements SequenceEngine {
  readonly hymn: Hymn;
  private adHocEntries: SequenceEntry[] = [];
  private cursorIndex = 0;
  private cursorLineIndex: number | null = null;

  constructor(hymn: Hymn) {
    this.hymn = hymn;
  }

  private get effectiveSequence(): SequenceEntry[] {
    return [...this.hymn.sequence, ...this.adHocEntries];
  }

  get length(): number {
    return this.hymn.sequence.length + this.adHocEntries.length;
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
    const sequence = this.effectiveSequence;
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
      isAdHoc: index >= this.hymn.sequence.length,
    };
  }

  current(): Occurrence {
    const occurrence = this.occurrenceAt(this.cursorIndex);
    if (!occurrence) throw new Error(`cursor out of range: ${this.cursorIndex}`);
    return occurrence;
  }

  next(): void {
    if (this.cursorIndex < this.length - 1) {
      this.cursorIndex++;
      this.cursorLineIndex = null;
    }
  }

  previous(): void {
    if (this.cursorIndex > 0) {
      this.cursorIndex--;
      this.cursorLineIndex = null;
    }
  }

  nextLine(): void {
    const position = this.cursorLineIndex ?? -1;
    const { lines } = this.current().part;
    if (position + 1 < lines.length) {
      this.cursorLineIndex = position + 1;
    } else if (this.cursorIndex < this.length - 1) {
      this.cursorIndex++;
      this.cursorLineIndex = null;
    }
  }

  previousLine(): void {
    const position = this.cursorLineIndex ?? -1;
    if (position >= 1) {
      this.cursorLineIndex = position - 1;
    } else if (position === 0) {
      this.cursorLineIndex = null;
    } else if (this.cursorIndex > 0) {
      this.cursorIndex--;
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
    this.adHocEntries.push({ partId });
    this.cursorIndex = this.length - 1;
    this.cursorLineIndex = null;
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

/** The whole effective sequence flattened to individual lines, with the
 * focused range: the whole occurrence under whole-part focus
 * (`lineIndex: null`), a single line otherwise — SDD-0001 §16.1. */
export function flattenLines(engine: SequenceEngine): {
  lines: FlatLine[];
  focus: LineRange;
} {
  const lines: FlatLine[] = [];
  const focus: LineRange = { start: 0, end: 0 };
  const { occurrenceIndex, lineIndex } = engine.cursor;

  for (let i = 0; i < engine.length; i++) {
    const occurrence = engine.occurrenceAt(i);
    if (!occurrence) continue;

    if (i === occurrenceIndex) {
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
