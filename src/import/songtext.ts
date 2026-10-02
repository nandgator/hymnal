/**
 * Song text format 1 → content format 1 (docs/authoring/text-format.md, ADR-0029).
 * Pure, like src/domain/: no Node or DOM import, so the app and the CLI run the
 * same code. A deterministic parser, no judgement: a line it cannot place is an
 * error with its line number, and nothing is repaired.
 */

import type { HymnbookSource, HymnMeta, HymnSource, Part, PartKind } from "../domain/types.ts";
import type { HymnFile } from "../domain/validate.ts";
import { hymnFileName } from "../domain/validate.ts";

export interface TextError {
  /** 1-based, in the file as given (comments and blank lines count). */
  line: number;
  message: string;
}

/** Something to look at, not an error: the review says so (text-format §2.6). */
export interface TextNote {
  hymn: number;
  message: string;
}

export type ParseResult =
  | { ok: true; songs: HymnSource[]; notes: TextNote[] }
  | { ok: false; errors: TextError[] };

export interface ParseOptions {
  /** The number of a single song whose first line has none. */
  number?: number;
}

/** The label word of a block's first line → its kind (§2.3). */
const LABEL_TABLE: Record<string, PartKind> = {
  chorus: "chorus",
  refrain: "chorus",
  verse: "stanza",
  stanza: "stanza",
  "pre-chorus": "pre-chorus",
  "post-chorus": "post-chorus",
  bridge: "bridge",
  intro: "intro",
  outro: "outro",
  tag: "tag",
};

/** The label word → kind, own properties only ("constructor" is no label word). */
export const labelKind = (word: string): PartKind | undefined => {
  const key = word.toLowerCase();
  return Object.hasOwn(LABEL_TABLE, key) ? LABEL_TABLE[key] : undefined;
};

/** The first letter of each kind's part ids (the importer shares it, with its own counting rule). */
export const ID_PREFIX: Record<PartKind, string> = {
  intro: "i",
  stanza: "s",
  "pre-chorus": "p",
  chorus: "c",
  "post-chorus": "q",
  bridge: "b",
  outro: "o",
  tag: "t",
};

const DETAIL_KEYS = ["author", "tune", "meter"] as const;

interface Line {
  no: number;
  text: string;
}

interface Draft {
  kind: PartKind;
  label?: string;
  lines: string[];
  /** The part's first line, for errors. */
  first: number;
}

/** A block of consecutive non-blank lines. */
type Block = Line[];

const isSeparator = (text: string) => /^-{3,}$/.test(text);

/** The kind word and label text of a block's first line, if it is one (ends in a colon). */
function labelOf(text: string): { word: string; label: string } | undefined {
  if (!text.endsWith(":")) return undefined;
  const inner = text.slice(0, -1).trim();
  const [word = "", ...rest] = inner.split(/\s+/);
  return { word, label: rest.join(" ") };
}

/** Parses song text. Every error is reported, with its line; nothing is written or repaired. */
export function parseSongText(input: string, options: ParseOptions = {}): ParseResult {
  const errors: TextError[] = [];
  const notes: TextNote[] = [];
  const err = (line: number, message: string) => errors.push({ line, message });

  const raw = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  // A comment is neither text nor a blank line: it is not there.
  const lines: Line[] = raw
    .map((text, i) => ({ no: i + 1, text: text.trim() }))
    .filter((l) => !l.text.startsWith("#"));

  // Songs: segments between separators, with the separator lines for errors.
  const segments: { lines: Line[]; separator: number }[] = [];
  let current: Line[] = [];
  let previousSeparator = 0;
  for (const line of lines) {
    if (isSeparator(line.text)) {
      segments.push({ lines: current, separator: line.no });
      current = [];
      previousSeparator = line.no;
    } else current.push(line);
  }
  segments.push({ lines: current, separator: previousSeparator });

  const songs: Line[][] = [];
  for (const [i, segment] of segments.entries()) {
    // A closing separator with nothing after it is ignored.
    if (i === segments.length - 1 && i > 0 && segment.lines.every((l) => l.text === "")) continue;
    if (segment.lines.every((l) => l.text === "")) {
      if (segments.length === 1) err(1, "the file has no song");
      else err(segment.separator, "an empty song");
    } else songs.push(segment.lines);
  }

  const single = songs.length === 1;
  const numbers = new Map<number, number>();
  const result: HymnSource[] = [];
  for (const song of songs) {
    const hymn = parseSong(song, single, options, errors, notes, numbers);
    if (hymn) result.push(hymn);
  }

  if (errors.length > 0) {
    return { ok: false, errors: errors.sort((a, b) => a.line - b.line) };
  }
  return { ok: true, songs: result, notes };
}

function parseSong(
  all: Line[],
  single: boolean,
  options: ParseOptions,
  errors: TextError[],
  notes: TextNote[],
  numbers: Map<number, number>,
): HymnSource | undefined {
  const err = (line: number, message: string) => errors.push({ line, message });
  const start = all.findIndex((l) => l.text !== "");
  const title = all[start];
  const body = all.slice(start + 1);
  const before = errors.length;

  // 2.1 The title line.
  let number: number | undefined;
  let name = title.text;
  const m = /^(\d+)(?:\s*[.)]\s*|\s+|$)(.*)$/.exec(title.text);
  if (m) {
    number = Number(m[1]);
    name = m[2].trim();
    if (!(number >= 1 && Number.isSafeInteger(number))) {
      err(title.no, "the number must be a whole number, 1 or more");
    } else if (numbers.has(number)) {
      err(title.no, `number ${number} is also used on line ${numbers.get(number)}`);
    } else numbers.set(number, title.no);
  } else if (single && options.number !== undefined) {
    number = options.number;
    if (!(Number.isSafeInteger(number) && number >= 1)) {
      err(title.no, "the number must be a whole number, 1 or more");
    }
  } else {
    err(title.no, single ? "no number: write one on the title line or give it" : "no number");
  }
  if (name === "") err(title.no, "the title is empty");

  // 2.2 Details: directly after the title, up to the first blank line.
  const meta: HymnMeta = {};
  let sequence: { text: string; line: number } | undefined;
  let i = 0;
  const seen = new Set<string>();
  for (; i < body.length && body[i].text !== ""; i++) {
    const line = body[i];
    const d = /^([^:]+):(.*)$/.exec(line.text);
    const key = d?.[1].trim().toLowerCase();
    if (!d || !key || !([...DETAIL_KEYS, "sequence"] as string[]).includes(key)) {
      err(line.no, `"${line.text}" is not a detail (Author, Tune, Meter or Sequence)`);
      continue;
    }
    const value = d[2].trim();
    if (value === "") err(line.no, `${d[1].trim()} has no value`);
    else if (seen.has(key)) err(line.no, `${d[1].trim()} is given twice`);
    else if (key === "sequence") sequence = { text: value, line: line.no };
    else meta[key as (typeof DETAIL_KEYS)[number]] = value;
    seen.add(key);
  }

  // 2.3 Blocks.
  const blocks: Block[] = [];
  let block: Block = [];
  for (const line of body.slice(i)) {
    if (line.text === "") {
      if (block.length > 0) blocks.push(block);
      block = [];
    } else block.push(line);
  }
  if (block.length > 0) blocks.push(block);

  interface Ref {
    kind: PartKind;
    label: string;
    line: number;
  }
  const drafts: Draft[] = [];
  const order: (Draft | Ref)[] = [];

  let seenBlock = false;
  for (const b of blocks) {
    const first = b[0];
    const isSequence = /^sequence\s*:/i.test(first.text);
    if (!isSequence) seenBlock = true;
    if (/^sequence\s*:/i.test(first.text)) {
      const value = first.text.replace(/^sequence\s*:/i, "").trim();
      if (sequence) err(first.no, "a second Sequence line");
      else if (b.length > 1 || seenBlock) {
        err(first.no, "a Sequence line stands in the details or alone before the first part");
      } else if (value === "") err(first.no, "Sequence has no value");
      else sequence = { text: value, line: first.no };
      continue;
    }
    const head = labelOf(first.text);
    if (!head) {
      const draft: Draft = { kind: "stanza", lines: b.map((l) => l.text), first: first.no };
      drafts.push(draft);
      order.push(draft);
      continue;
    }
    const kind = labelKind(head.word);
    if (!kind) {
      err(first.no, `"${head.word}" is not a label word (Chorus, Refrain, Verse, Stanza, ...)`);
      continue;
    }
    if (b.length === 1) {
      order.push({ kind, label: head.label, line: first.no });
      continue;
    }
    const draft: Draft = {
      kind,
      ...(head.label ? { label: head.label } : {}),
      lines: b.slice(1).map((l) => l.text),
      first: first.no,
    };
    drafts.push(draft);
    order.push(draft);
  }

  // Unlabelled blocks are stanzas 1, 2, ..., skipping numbers taken explicitly.
  const taken = new Set(drafts.filter((d) => d.kind === "stanza" && d.label).map((d) => d.label));
  let next = 1;
  for (const d of drafts) {
    if (d.kind !== "stanza" || d.label) continue;
    while (taken.has(String(next))) next++;
    d.label = String(next++);
  }
  const keyOf = (kind: PartKind, label: string | undefined) => `${kind}\n${label ?? ""}`;
  const known = new Map<string, Draft>();
  for (const d of drafts) {
    const key = keyOf(d.kind, d.label);
    if (known.has(key)) {
      const what = d.label ? `${d.kind} ${d.label}` : d.kind;
      err(d.first, `${what} is already a part: give it a label of its own`);
    } else known.set(key, d);
  }

  const parts: Part[] = [];
  const ids = new Map<Draft, string>();
  const counts = new Map<PartKind, number>();
  for (const d of drafts) {
    const n = (counts.get(d.kind) ?? 0) + 1;
    counts.set(d.kind, n);
    const id = `${ID_PREFIX[d.kind]}${n}`;
    ids.set(d, id);
    parts.push({ id, kind: d.kind, ...(d.label ? { label: d.label } : {}), lines: d.lines });
  }
  const ofKind = (kind: PartKind) => drafts.filter((d) => d.kind === kind);

  // 2.4 References.
  let hasReference = false;
  const printed: string[] = [];
  for (const item of order) {
    if ("lines" in item) {
      printed.push(ids.get(item) as string);
      continue;
    }
    hasReference = true;
    const candidates = ofKind(item.kind);
    const named = item.label
      ? candidates.filter((d) => d.label?.toLowerCase() === item.label.toLowerCase())
      : candidates;
    const what = item.label ? `${item.kind} ${item.label}` : item.kind;
    if (named.length === 0) err(item.line, `"${what}" sung again, but the song has no such part`);
    else if (named.length > 1) {
      err(
        item.line,
        `"${what}" could be any of ${named.length} parts: name one (e.g. "Chorus 1:")`,
      );
    } else printed.push(ids.get(named[0]) as string);
  }

  // 2.5 / 2.6 The sequence.
  let order2: string[] | undefined;
  if (sequence) {
    order2 = parseSequence(sequence, drafts, ids, err);
    if (order2) {
      for (const d of drafts) {
        if (!order2.includes(ids.get(d) as string)) {
          err(
            d.first,
            `${d.label ? `${d.kind} ${d.label}` : d.kind} is not in the Sequence: every part must be sung`,
          );
        }
      }
    }
  } else if (hasReference || ofKind("chorus").length === 0) {
    order2 = printed;
  } else if (
    ofKind("chorus").length === 1 &&
    !ofKind("pre-chorus").length &&
    !ofKind("post-chorus").length
  ) {
    // Rule 3. With no stanza or bridge to follow, the chorus is sung as printed, with no note.
    const chorus = ids.get(ofKind("chorus")[0]) as string;
    const kinds = new Map(parts.map((p) => [p.id, p.kind]));
    if (drafts.some((d) => d.kind === "stanza" || d.kind === "bridge")) {
      order2 = printed[0] === chorus ? [chorus] : [];
      for (const id of printed) {
        if (id === chorus) continue;
        order2.push(id);
        const kind = kinds.get(id);
        if (kind === "stanza" || kind === "bridge") order2.push(chorus);
      }
    } else order2 = printed;
  } else {
    order2 = printed;
    if (number !== undefined) {
      notes.push({
        hymn: number,
        message:
          "several choruses, or a pre-chorus or post-chorus, and no references or Sequence line: sung as printed; add a Sequence line if that is wrong",
      });
    }
  }

  if (errors.length > before || number === undefined || !order2) return undefined;
  return {
    number,
    title: name,
    meta,
    parts,
    sequence: order2.map((partId) => ({ partId })),
  };
}

/** Greedy reading of a Sequence value (§2.5). Returns part ids, or undefined with errors reported. */
function parseSequence(
  sequence: { text: string; line: number },
  drafts: Draft[],
  ids: Map<Draft, string>,
  err: (line: number, message: string) => void,
): string[] | undefined {
  const tokens = sequence.text.split(/\s+/);
  const out: string[] = [];
  let ok = true;
  const fail = (message: string) => {
    err(sequence.line, message);
    ok = false;
  };
  const idOf = (d: Draft) => ids.get(d) as string;
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t];
    const kind = labelKind(token);
    if (!kind) {
      const hit = drafts.filter(
        (d) => d.kind === "stanza" && d.label?.toLowerCase() === token.toLowerCase(),
      );
      if (hit.length === 1) out.push(idOf(hit[0]));
      else fail(`"${token}" names no part`);
      continue;
    }
    const ofKind = drafts.filter((d) => d.kind === kind);
    const next = tokens[t + 1];
    const labelled =
      next === undefined
        ? undefined
        : ofKind.find((d) => d.label?.toLowerCase() === next.toLowerCase());
    if (labelled) {
      out.push(idOf(labelled));
      t++;
    } else if (ofKind.length === 1) out.push(idOf(ofKind[0]));
    else if (ofKind.length === 0) fail(`"${token}" names no part: the song has none`);
    else fail(`"${token}" is ambiguous: ${ofKind.length} parts of that kind, name one`);
  }
  return ok ? out : undefined;
}

export interface BookFields {
  id: string;
  title: string;
  language: string;
  script: string;
}

/** The book and its files, as the validator and `pack` read them (§3). */
export function textBook(
  songs: HymnSource[],
  fields: BookFields,
): { hymnbook: HymnbookSource; files: HymnFile[] } {
  return {
    hymnbook: { format: 1, ...fields, hymnCount: songs.length },
    files: songs.map((hymn) => ({ file: hymnFileName(hymn.number), hymn })),
  };
}

/** JSON with keys sorted and two-space indent, so two documents compare by text. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}
