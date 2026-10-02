import type { Part, PartKind, SequenceEntry } from "../domain/types.ts";
import type { Flow, FlowLine } from "./flow.ts";
import type { Profile } from "./profile.ts";
import { GUESS, type Note } from "./report.ts";
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

/** "(2)", "(x 3)", "(twice)", "(repeat)", "x 2", "– 2" ending a line, and "Repeat" alone. */
const REPEAT_MARK =
  /\((?:\d+\s*x?|x\s*\d+|twice|thrice|repeat[^)]*)\)|\bx\s*\d+\b|\s[–-]\s*\d+\s*$|^\s*repeat\s*[.…:]*\s*$/gi;

/** A line without what `pattern` finds, and no space left before punctuation. */
function without(text: string, pattern: RegExp): string {
  if (!new RegExp(pattern.source, pattern.flags.replace("g", "")).test(text)) return text;
  return text
    .replace(pattern, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * The Output shows lyrics: the operator repeats with Repeat, and the singers
 * know their parts. Repeat marks and directions are taken out of each line,
 * a line left empty is dropped, and each is noted.
 */
function lyricsOnly(
  lines: FlowLine[],
  profile: Profile,
  note: (kind: Note["kind"], message: string, page?: number) => void,
): FlowLine[] {
  const words = profile.directions?.join("|");
  const direction = words
    ? new RegExp(`[(\\[]\\s*(?:${words})(?:[\\s,&]+(?:and|${words}))*\\s*[)\\]]`, "giu")
    : undefined;
  return lines.flatMap((line) => {
    let text = line.text;
    for (const [kind, pattern] of [
      ["repeat", REPEAT_MARK],
      ["direction", direction],
    ] as const) {
      if (!pattern) continue;
      const out = without(text, pattern);
      if (out !== text) note(kind, `"${text}" → ${out ? `"${out}"` : "dropped"}`, line.page);
      text = out;
    }
    return text ? [{ ...line, text }] : [];
  });
}

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
    if ("block" in item && profile.wraps !== false) {
      item.block.lines = unwrap(item.block.lines, flow, note);
    }
  }
  const lyrics = joinBreaks(printed, flow, profile, note).filter((item) => {
    if (!("block" in item)) return true;
    item.block.lines = lyricsOnly(item.block.lines, profile, note);
    return item.block.lines.length > 0;
  });
  const joined = cued(lyrics, profile, note);

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

  // A book that prints two stanzas with no gap between them leaves one long block.
  for (const part of parts) {
    if (part.kind !== "stanza") continue;
    const usual = mode(
      parts.filter((p) => p !== part && p.kind === "stanza").map((p) => p.lines.length),
    );
    if (usual !== undefined && usual >= 3 && part.lines.length >= 2 * usual) {
      note(
        "long",
        `stanza ${part.label}: ${part.lines.length} lines, twice the ${usual} of the song's other stanzas: two stanzas printed with no gap?`,
      );
    }
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
 * it stands for that part sung again, as it does ending a line after an
 * ellipsis or before one ("covered me…Cho….", "today. Ch…"). Within a
 * block, a chorus label heads what follows only if that is set in the
 * chorus font: otherwise it closes the lines before it, and a new block
 * starts (the printer left no gap between "Cho…" and the next stanza).
 */
function labelled(
  input: Block[],
  profile: Profile,
  note: (kind: Note["kind"], message: string, page?: number) => void,
): Printed[] {
  const words = Object.keys(profile.labels).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (words.length === 0) return input.map((block) => ({ block }));
  const label = new RegExp(
    `^\\(?\\s*(repeat\\s+)?(${words.join("|")})\\s*[:.…]*\\s*\\)?\\s*[:.…]*\\s*(\\(.*\\)|x\\s*\\d+)?$`,
    "i",
  );
  const ending = new RegExp(
    `^(.*?)\\s*(?:(?:…|\\.{2,})\\s*(${words.join("|")})\\s*[:.…]*|\\s(${words.join("|")})\\s*(?:…|\\.{2,})[.…]*)\\s*$`,
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
      const ends = match ? null : ending.exec(line.text);
      if (ends) {
        const text = ends[1].replace(/\s*(?:…|\.{2,})+$/, "");
        if (text) rest.push({ ...line, text });
        flush();
        out.push({ refers: profile.labels[(ends[2] ?? ends[3]).toLowerCase()], page: line.page });
        continue;
      }
      if (!match) {
        rest.push(line);
        continue;
      }
      flush();
      const named = profile.labels[match[2].toLowerCase()];
      if (match[3]) note("repeat", `"${line.text}"`, line.page);
      const after = block.lines.slice(i + 1);
      const next = after.findIndex((l) => label.test(l.text));
      // "(Repeat Chorus)" only ever stands for the chorus.
      const heads =
        !match[1] &&
        (i === 0 ||
          named !== "chorus" ||
          after
            .slice(0, next < 0 ? undefined : next)
            .every((l) => l.font === profile.chorus?.font));
      if (i === block.lines.length - 1 || !heads) out.push({ refers: named, page: line.page });
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
      const guess = wrap === "guess" ? GUESS : "";
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
  // "I" and "&" are capitals that don't mark a new line, so they get a little more room.
  const words = line.text.split(/\s+/).length;
  const remainder = words <= 2 || (words <= 4 && /^(&|I\b)/.test(line.text));
  return open && remainder ? "guess" : "no";
}

/**
 * At a column or page break, a stanza gap can't be seen: it is suppressed
 * at the top of a column. The halves are joined when together they are as
 * long as the song's other blocks, and neither alone is; or when the first is
 * shorter than they are and the second as long (a stanza's stub at the foot
 * of a column, its rest at the top of the next); or when both are chorus and
 * the song has no other chorus.
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
    // `wraps: false` (profile) means the reader's lines are never printer's wraps.
    const wrap =
      profile.wraps === false ? "no" : wraps(a.lines.at(-1) as FlowLine, b.lines[0], flow);
    if (wrap !== "no") {
      a.lines = unwrap([...a.lines, ...b.lines], flow, note);
      continue;
    }
    const others = lengths.filter((n, j): n is number => n !== undefined && j !== i && j !== i - 1);
    const usual = mode(others);
    const together = a.lines.length + b.lines.length;
    // The song's only chorus has no other to measure against.
    const onlyChorus =
      (a.kind ?? fontKind(a, profile)) === "chorus" &&
      (b.kind ?? fontKind(b, profile)) === "chorus" &&
      !printed.some(
        (other, j) =>
          j !== i &&
          j !== i - 1 &&
          "block" in other &&
          (other.block.kind ?? fontKind(other.block, profile)) === "chorus",
      );
    const join =
      usual === undefined ||
      onlyChorus ||
      together === usual ||
      (a.lines.length !== usual && b.lines.length !== usual) ||
      (a.lines.length < usual && b.lines.length === usual);
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

/**
 * A block's last line that quotes the chorus's first, in quotes or in the
 * chorus's font ("“Who is this Man?”", "Bind us together, Lord ..."), is a
 * cue: the chorus sung again, not a lyric, as is a chorus's first line
 * printed alone, trailing off. Before the chorus printed, a cue
 * or a label is that chorus. Every block is given its kind here, the
 * cue taken off first.
 */
function cued(
  printed: Printed[],
  profile: Profile,
  note: (kind: Note["kind"], message: string, page?: number) => void,
): Printed[] {
  // As it starts, till a cue is off: a cue is often set in the chorus's font.
  const kindOf = (block: Block) =>
    block.kind ?? (block.lines[0].font === profile.chorus?.font ? "chorus" : "stanza");
  const words = (text: string) =>
    text
      .toLowerCase()
      .match(/[\p{L}\p{N}’']+/gu)
      ?.join(" ") ?? "";
  const starts = printed.flatMap((item) =>
    "block" in item && kindOf(item.block) === "chorus" ? [words(item.block.lines[0].text)] : [],
  );
  const out: Printed[] = [];
  for (const [i, item] of printed.entries()) {
    out.push(item);
    if (!("block" in item)) continue;
    const block = item.block;
    if (kindOf(block) === "chorus") {
      // A chorus's first line alone, trailing off ("Jesus Messiah …..").
      const only = words(block.lines[0].text);
      const again =
        block.lines.length === 1 &&
        /(…|\.{2,})$/.test(block.lines[0].text.trim()) &&
        only.includes(" ") &&
        starts.some((start) => start.startsWith(`${only} `));
      if (again) {
        note("cue", `"${block.lines[0].text}"`, block.lines[0].page);
        out[out.length - 1] = { refers: "chorus", page: block.lines[0].page };
      } else block.kind ??= kindByFont(block, profile, note);
      continue;
    }
    const last = block.lines.at(-1) as FlowLine;
    const next = printed[i + 1];
    const chorusNext = next !== undefined && !("block" in next) && next.refers === "chorus";
    const quoted = words(last.text);
    // Trailing off alone isn't enough: a stanza's own last line often leads
    // into the chorus with its words ("One day at a time…").
    const set =
      /^[“"‘'].*[”"’']$/.test(last.text.trim()) ||
      (last.font === profile.chorus?.font && block.lines[0].font !== profile.chorus?.font);
    const cue =
      set &&
      quoted.includes(" ") &&
      starts.some((start) => start === quoted || start.startsWith(`${quoted} `));
    if (cue) {
      note("cue", `"${last.text}"`, last.page);
      block.lines.pop();
    }
    if (block.lines.length === 0) out.pop();
    else block.kind ??= kindByFont(block, profile, note);
    if (cue && !chorusNext) out.push({ refers: "chorus", page: last.page });
  }
  return out.filter((item, i) => {
    const next = out[i + 1];
    return (
      "block" in item ||
      item.refers !== "chorus" ||
      !next ||
      !("block" in next) ||
      next.block.kind !== "chorus"
    );
  });
}

/** "chorus" or "stanza" when one font sets the whole block, else undefined. */
function fontKind(block: Block, profile: Profile): PartKind | undefined {
  const chorus = block.lines.filter((line) => line.font === profile.chorus?.font).length;
  if (chorus === block.lines.length) return "chorus";
  if (chorus === 0) return "stanza";
  return undefined;
}

/**
 * A block's kind: its label's, else its font's. In two fonts, the one it
 * starts in: a chorus's italic can stop partway, and a stanza can end on
 * the chorus's first line in italic, a cue.
 */
function kindByFont(
  block: Block,
  profile: Profile,
  note: (kind: Note["kind"], message: string, page?: number) => void,
): PartKind {
  const kind = fontKind(block, profile);
  if (kind) return kind;
  const chorus = block.lines.filter((line) => line.font === profile.chorus?.font);
  const first = block.lines[0].font === profile.chorus?.font ? "chorus" : "stanza";
  note(
    "fonts",
    `${chorus.length} of ${block.lines.length} lines in the chorus font, taken as a ${first} as it starts: "${block.lines[0].text}"`,
    block.lines[0].page,
  );
  return first;
}

/**
 * As printed, when the page spells it out: a label standing for a part, or
 * the chorus printed more than once. Otherwise ADR-0009's rule: the
 * chorus, printed once, is sung first if printed first, and after every
 * stanza and bridge (a band comes back to it). A chorus printed as several
 * blocks in a row is sung whole.
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
    if (item.kind === "stanza" || item.kind === "bridge") ids.push(...chorus);
  }
  const others = parts.filter((p) => p.kind !== "stanza" && p.kind !== "chorus");
  if (others.length > 0) {
    const after = others.some((p) => p.kind === "bridge") ? "stanza and bridge" : "stanza";
    const printed = others.filter((p) => p.kind !== "bridge").map((p) => p.kind);
    note(
      "sequence",
      `the chorus after every ${after}${printed.length > 0 ? `; ${printed.join(", ")} where printed` : ""}`,
    );
  }
  return ids.map((partId) => ({ partId }));
}

function mode(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];
}
