import type { Part, PartKind, SequenceEntry } from "../domain/types.ts";
import type { Flow, FlowLine } from "./flow.ts";
import type { Profile } from "./profile.ts";
import type { Note } from "./report.ts";
import type { FoundSong } from "./songs.ts";

/** A run of lines with no stanza gap inside it. */
interface Block {
  lines: FlowLine[];
  /** Given by a label printed above it. */
  kind?: PartKind;
  /** It starts a column: a break, not a gap, divides it from the last. */
  afterBreak: boolean;
}

/** A place in the printed song: a block, or a label standing for a part. */
type Printed = { block: Block } | { refers: PartKind; page: number };

const ID_PREFIX: Record<PartKind, string> = {
  intro: "i",
  stanza: "s",
  "pre-chorus": "p",
  chorus: "c",
  "post-chorus": "q",
  bridge: "b",
  outro: "o",
  tag: "t",
};

const REPEAT_MARK = /\((?:\d+\s*x?|x\s*\d+|twice|thrice|repeat[^)]*)\)|\bx\s*\d+\b/i;

/**
 * A found song → parts and a sequence (SDD-0003 §1). Blocks are split at
 * stanza gaps and labels, printer's wraps are joined, and each block's kind
 * comes from its label, else its font. Everything guessed is noted.
 */
export function toParts(
  song: FoundSong,
  flow: Flow,
  profile: Profile,
  notes: Note[],
): { parts: Part[]; sequence: SequenceEntry[] } {
  const note = (kind: Note["kind"], message: string, page = song.page) =>
    notes.push({ kind, message, hymn: song.number, page });

  const printed = labelled(blocks(song.lines, profile), profile, note);
  for (const item of printed) {
    if ("block" in item) item.block.lines = unwrap(item.block.lines, flow, note);
  }
  const joined = joinBreaks(printed, flow, profile, note);

  // Parts in printed order; a block printed again word for word is the same part.
  const parts: Part[] = [];
  const order: (Part | PartKind)[] = [];
  for (const item of joined) {
    if (!("block" in item)) {
      order.push(item.refers);
      continue;
    }
    const kind = item.block.kind ?? kindByFont(item.block, profile, note);
    const lines = item.block.lines.map((line) => line.text);
    const same = parts.find((p) => p.kind === kind && p.lines.join("\n") === lines.join("\n"));
    if (same) {
      order.push(same);
      continue;
    }
    const count = parts.filter((p) => p.kind === kind).length + 1;
    const id = kind === "stanza" || count > 1 ? `${ID_PREFIX[kind]}${count}` : ID_PREFIX[kind];
    const part: Part = { id, kind, lines, ...(kind === "stanza" ? { label: String(count) } : {}) };
    parts.push(part);
    order.push(part);
  }

  for (const part of parts) {
    const marked = part.lines.filter((line) => REPEAT_MARK.test(line));
    for (const line of marked) note("repeat", `"${line}"`);
  }
  return { parts, sequence: sequenceOf(parts, order, note) };
}

/** Splits at stanza gaps and at the top of each column. */
function blocks(lines: FlowLine[], profile: Profile): Block[] {
  const out: Block[] = [];
  for (const line of lines) {
    const current = out.at(-1);
    if (current && line.gap !== null && line.gap <= profile.stanzaGap) current.lines.push(line);
    else out.push({ lines: [line], afterBreak: line.gap === null && current !== undefined });
  }
  return out;
}

/**
 * Labels, as the profile words them: "Chorus:", "(chorus)", "Bridge", "End:".
 * Heading lines, a label gives them their kind; alone, or closing a block,
 * it stands for that part sung again.
 */
function labelled(
  input: Block[],
  profile: Profile,
  note: (kind: Note["kind"], message: string, page?: number) => void,
): Printed[] {
  const words = Object.keys(profile.labels).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return input.map((block) => ({ block }));
  const label = new RegExp(
    `^\\(?\\s*(${words.join("|")})\\s*[:.…]*\\s*\\)?\\s*[:.…]*\\s*(\\(.*\\)|x\\s*\\d+)?$`,
    "i",
  );

  const out: Printed[] = [];
  for (const block of input) {
    let rest: FlowLine[] = [];
    let kind: PartKind | undefined;
    let afterBreak = block.afterBreak;
    const flush = () => {
      if (rest.length > 0) out.push({ block: { lines: rest, kind, afterBreak } });
      rest = [];
      kind = undefined;
      afterBreak = false;
    };
    for (const [i, line] of block.lines.entries()) {
      const match = label.exec(line.text);
      if (!match) {
        rest.push(line);
        continue;
      }
      flush();
      const named = profile.labels[match[1].toLowerCase()];
      if (match[2]) note("repeat", `"${line.text}"`, line.page);
      if (i === block.lines.length - 1) out.push({ refers: named, page: line.page });
      else kind = named;
    }
    flush();
  }
  return out;
}

/**
 * Joins a printer's wraps: the next line's first word would not have fitted
 * on this one, so the line ran on. Where the next line starts with a
 * capital, only a short remainder after unpunctuated text is joined
 * ("the" + "King."), and noted as a guess.
 */
function unwrap(
  lines: FlowLine[],
  flow: Flow,
  note: (kind: Note["kind"], message: string, page?: number) => void,
): FlowLine[] {
  const out: FlowLine[] = [];
  for (const line of lines) {
    const prev = out.at(-1);
    const wrap = prev ? wraps(prev, line, flow) : "no";
    if (prev && wrap !== "no") {
      const guess = wrap === "guess" ? "(a guess) " : "";
      note("wrap", `${guess}"${prev.text}" + "${line.text}"`, line.page);
      out[out.length - 1] = { ...prev, text: `${prev.text} ${line.text}`, width: line.width };
    } else out.push(line);
  }
  return out;
}

type Wrap = "sure" | "guess" | "no";

function wraps(prev: FlowLine, line: FlowLine, flow: Flow): Wrap {
  const measure = flow.measure[prev.column] ?? 0;
  const perChar = line.width / Math.max(1, line.text.length);
  const firstWord = line.text.split(/\s/)[0];
  if (prev.width + perChar * (firstWord.length + 1) <= measure) return "no";
  const open = !/[.,;:!?)]$/.test(prev.text);
  if (/^\p{Ll}/u.test(line.text)) return open ? "sure" : "guess";
  const remainder = line.text.split(/\s+/).length <= 2 || /^(&|I\b)/.test(line.text);
  return open && remainder ? "guess" : "no";
}

/**
 * At a column or page break, a stanza gap can't be seen: it is suppressed
 * at the top of a column. The halves are joined when together they are as
 * long as the song's other blocks of that kind, and neither alone is.
 */
function joinBreaks(
  printed: Printed[],
  flow: Flow,
  profile: Profile,
  note: (kind: Note["kind"], message: string, page?: number) => void,
): Printed[] {
  const lengths = printed.map((item) => ("block" in item ? item.block.lines.length : undefined));
  const out: Printed[] = [];
  for (const [i, item] of printed.entries()) {
    const prev = out.at(-1);
    if (!("block" in item) || !item.block.afterBreak || !prev || !("block" in prev)) {
      out.push(item);
      continue;
    }
    const a = prev.block;
    const b = item.block;
    // The same font on both sides: a labelled bridge in italic runs on in italic.
    const runsOn =
      b.kind === undefined &&
      fontKind(b, profile) !== undefined &&
      fontKind(a, profile) === fontKind(b, profile);
    if (!runsOn) {
      out.push(item);
      continue;
    }
    const wrap = wraps(a.lines.at(-1) as FlowLine, b.lines[0], flow);
    if (wrap !== "no") {
      a.lines = unwrap([...a.lines, ...b.lines], flow, note);
      continue;
    }
    const others = lengths.filter((n, j): n is number => n !== undefined && j !== i && j !== i - 1);
    const usual = mode(others);
    const together = a.lines.length + b.lines.length;
    const join =
      usual === undefined ||
      together === usual ||
      (a.lines.length !== usual && b.lines.length !== usual);
    const where = `"${a.lines.at(-1)?.text}" | "${b.lines[0].text}"`;
    if (join) {
      a.lines.push(...b.lines);
      if (together !== usual) note("break", `joined, a guess: ${where}`, b.lines[0].page);
    } else {
      out.push(item);
      note("break", `kept apart: ${where}`, b.lines[0].page);
    }
  }
  return out;
}

/** "chorus" or "stanza" when one font sets the whole block, else undefined. */
function fontKind(block: Block, profile: Profile): PartKind | undefined {
  const chorus = block.lines.filter((line) => line.font === profile.chorus.font).length;
  if (chorus === block.lines.length) return "chorus";
  if (chorus === 0) return "stanza";
  return undefined;
}

function kindByFont(
  block: Block,
  profile: Profile,
  note: (kind: Note["kind"], message: string, page?: number) => void,
): PartKind {
  const kind = fontKind(block, profile);
  if (kind) return kind;
  const chorus = block.lines.filter((line) => line.font === profile.chorus.font);
  const most = chorus.length * 2 > block.lines.length ? "chorus" : "stanza";
  note(
    "fonts",
    `${chorus.length} of ${block.lines.length} lines in the chorus font, taken as a ${most}: "${block.lines[0].text}"`,
    block.lines[0].page,
  );
  return most;
}

/**
 * As printed, when the page spells it out: a label standing for a part, or
 * the chorus printed more than once. Otherwise ADR-0009's rule: the
 * chorus, printed once, is sung first if printed first, and after every
 * stanza. A chorus printed as several blocks in a row is sung whole.
 */
function sequenceOf(
  parts: Part[],
  order: (Part | PartKind)[],
  note: (kind: Note["kind"], message: string, page?: number) => void,
): SequenceEntry[] {
  const isChorus = (item: Part | PartKind) => typeof item !== "string" && item.kind === "chorus";
  const groups: string[][] = [];
  for (const [i, item] of order.entries()) {
    if (typeof item === "string" || item.kind !== "chorus") continue;
    if (i > 0 && isChorus(order[i - 1])) groups[groups.length - 1].push(item.id);
    else groups.push([item.id]);
  }
  const labelled = order.some((item) => typeof item === "string");
  const hasStanza = parts.some((p) => p.kind === "stanza");

  if (labelled || groups.length !== 1 || !hasStanza) {
    const ids: string[] = [];
    for (const item of order) {
      if (typeof item !== "string") {
        ids.push(item.id);
        continue;
      }
      const part = parts.find((p) => p.kind === item);
      if (part) ids.push(part.id);
      else note("sequence", `a label asks for a ${item}, and the song has none`);
    }
    if (new Set(groups.map((g) => g.join())).size > 1) {
      note("sequence", `${groups.length} different choruses, sung as printed`);
    }
    return ids.map((partId) => ({ partId }));
  }

  const [chorus] = groups;
  const ids: string[] = isChorus(order[0]) ? [...chorus] : [];
  for (const item of order) {
    if (typeof item === "string" || item.kind === "chorus") continue;
    ids.push(item.id);
    if (item.kind === "stanza") ids.push(...chorus);
  }
  const others = parts.filter((p) => p.kind !== "stanza" && p.kind !== "chorus");
  if (others.length > 0) {
    note(
      "sequence",
      `the chorus after every stanza; ${others.map((p) => p.kind).join(", ")} where printed`,
    );
  }
  return ids.map((partId) => ({ partId }));
}

function mode(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
}
