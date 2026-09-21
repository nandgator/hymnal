import type { Hymn, Part } from "../src/domain/types.ts";

export interface LegacyHymn {
  id: number;
  author: string;
  starts: string;
  chorus: string[];
  bridge: string[];
  verses: string[][];
}

export type MigratedHymn = Omit<Hymn, "hymnbookId">;

export type LegacyShape = "chorus-first" | "verse-first" | "verses-only" | "chorus-only";

export interface Conversion {
  hymn: MigratedHymn;
  shape: LegacyShape;
  droppedBlankLines: number;
  trimmedLines: number;
}

export interface MigrationReport {
  total: number;
  shapes: Record<LegacyShape, number>;
  /** Hymns that had empty lines dropped, flagged for hand correction. */
  flaggedForReview: number[];
  trimmedLines: number;
}

function clean(lines: string[]) {
  const kept: string[] = [];
  let dropped = 0;
  let trimmed = 0;
  for (const line of lines) {
    const text = line.trim();
    if (text === "") {
      dropped++;
      continue;
    }
    if (text !== line) trimmed++;
    kept.push(text);
  }
  return { kept, dropped, trimmed };
}

/** Applies the SDD-0001 §7 rules to one legacy hymn. Throws on anything they don't cover. */
export function convertLegacyHymn(legacy: LegacyHymn): Conversion {
  const fail = (why: string): never => {
    throw new Error(`hymn ${legacy.id}: ${why}`);
  };

  if (legacy.bridge.length > 0) fail("non-empty bridge is not covered by the rules");
  if (legacy.starts !== "chorus" && legacy.starts !== "verse-1") {
    fail(`unknown starts "${legacy.starts}"`);
  }

  const chorus = clean(legacy.chorus);
  const verses = legacy.verses.map((verse) => clean(verse));
  if (verses.some((v) => v.kept.length === 0)) fail("verse has no lines");

  const hasChorus = chorus.kept.length > 0;
  const hasVerses = verses.length > 0;
  const stanzas: Part[] = verses.map((v, i) => ({
    id: `s${i + 1}`,
    kind: "stanza",
    label: String(i + 1),
    lines: v.kept,
  }));
  const refrain: Part = { id: "r", kind: "refrain", lines: chorus.kept };

  let parts: Part[];
  let order: string[];
  let shape: LegacyShape;

  if (hasChorus && hasVerses) {
    parts = [refrain, ...stanzas];
    if (legacy.starts === "chorus") {
      shape = "chorus-first";
      order = ["r", ...stanzas.flatMap((s) => [s.id, "r"])];
    } else {
      shape = "verse-first";
      order = stanzas.flatMap((s) => [s.id, "r"]);
    }
  } else if (hasVerses) {
    if (legacy.starts !== "verse-1") fail(`starts "chorus" but there is no chorus`);
    shape = "verses-only";
    parts = stanzas;
    order = stanzas.map((s) => s.id);
  } else if (hasChorus) {
    if (legacy.starts !== "chorus") fail(`starts "verse-1" but there are no verses`);
    shape = "chorus-only";
    parts = [{ id: "s1", kind: "stanza", label: "1", lines: chorus.kept }];
    order = ["s1"];
  } else {
    return fail("no lyrics");
  }

  const expected = [...chorus.kept, ...verses.flatMap((v) => v.kept)];
  const actual = parts.flatMap((p) => p.lines);
  if (expected.length !== actual.length || expected.some((line, i) => line !== actual[i])) {
    fail("lines were lost or reordered during conversion");
  }

  const first = parts.find((p) => p.id === order[0]);
  const author = legacy.author.trim();

  return {
    hymn: {
      number: legacy.id,
      title: first?.lines[0] ?? fail("empty first part"),
      parts,
      sequence: order.map((partId) => ({ partId })),
      meta: author === "" ? {} : { author },
    },
    shape,
    droppedBlankLines: chorus.dropped + verses.reduce((n, v) => n + v.dropped, 0),
    trimmedLines: chorus.trimmed + verses.reduce((n, v) => n + v.trimmed, 0),
  };
}

export function summarize(conversions: Conversion[]): MigrationReport {
  const report: MigrationReport = {
    total: conversions.length,
    shapes: { "chorus-first": 0, "verse-first": 0, "verses-only": 0, "chorus-only": 0 },
    flaggedForReview: [],
    trimmedLines: 0,
  };
  for (const c of conversions) {
    report.shapes[c.shape]++;
    report.trimmedLines += c.trimmedLines;
    if (c.droppedBlankLines > 0) report.flaggedForReview.push(c.hymn.number);
  }
  return report;
}
