/**
 * The source check (ADR-0029): compares the text a book started from with the
 * format 1 result, locally and deterministically, and reports what differs. It
 * judges nothing: it cannot tell a dropped stanza from a deliberate cut, so it
 * lists and the person decides. Pure, no Node or DOM import.
 */
import type { HymnSource } from "../domain/types.ts";
import { labelKind } from "./songtext.ts";

/** A result line (or title) with no match in the source. */
export interface AddedLine {
  hymn: number;
  /** Absent for a title, else e.g. "stanza 2" or "chorus". */
  part?: string;
  /** 1-based within the part; absent for a title. */
  line?: number;
  text: string;
}

/** A source line that matches nothing in the result. */
export interface DroppedLine {
  /** 1-based, in the source as given. */
  line: number;
  text: string;
}

export interface SourceCheck {
  added: AddedLine[];
  dropped: DroppedLine[];
}

type Checked = Pick<HymnSource, "number" | "title" | "parts">;

/**
 * Unicode NFC, whitespace collapsed and trimmed, and the quote and dash forms
 * folded. Deliberately narrow: spelling, case and punctuation are not fixed,
 * so a changed word is reported.
 */
export function normalise(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[‘’‚‛ʼ]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** A source line the text format has a place for: not lyrics, so never "dropped". */
function isStructure(key: string): boolean {
  if (key === "" || key.startsWith("#") || /^-{3,}$/.test(key)) return true;
  if (/^(author|tune|meter|sequence)\s*:/i.test(key)) return true;
  // A label: a label word, at most one label token, and the colon, nothing else.
  const m = /^(\S+)(?: \S+)?:$/.exec(key);
  return m !== null && labelKind(m[1]) !== undefined;
}

const withoutNumber = (key: string) => key.replace(/^\d+\s*[.)]?\s+/, "");

export function sourceCheck(sourceText: string, result: Checked[]): SourceCheck {
  const entries = sourceText
    .replace(/^﻿/, "")
    .split(/\r\n|\r|\n/)
    .map((text, i) => ({ line: i + 1, text, key: normalise(text), used: false }))
    .filter((e) => !isStructure(e.key));

  // Multiset: each source line explains at most one result line.
  const take = (match: (key: string) => boolean) => {
    const hit = entries.find((e) => !e.used && match(e.key));
    if (hit) hit.used = true;
    return hit !== undefined;
  };

  const added: AddedLine[] = [];
  for (const hymn of result) {
    const title = normalise(hymn.title);
    if (!take((k) => k === title || withoutNumber(k) === title)) {
      added.push({ hymn: hymn.number, text: hymn.title });
    }
  }
  for (const hymn of result) {
    for (const part of hymn.parts) {
      for (const [i, text] of part.lines.entries()) {
        const key = normalise(text);
        if (take((k) => k === key)) continue;
        const name = part.label ? `${part.kind} ${part.label}` : part.kind;
        added.push({ hymn: hymn.number, part: name, line: i + 1, text });
      }
    }
  }

  const dropped = entries
    .filter((e) => !e.used)
    .map((e) => ({ line: e.line, text: e.text.trim() }));
  return { added, dropped };
}

/** A person's reading of a check: empty when there is nothing to report. */
export function formatSourceCheck(check: SourceCheck): string[] {
  const out: string[] = [];
  if (check.added.length + check.dropped.length > 0) {
    out.push(
      "(in a book of several songs, locations are approximate: lines are matched across the whole source)",
    );
  }
  if (check.added.length > 0) {
    out.push(
      `${check.added.length} line(s) in the result that are not in the source (added or altered):`,
    );
    for (const a of check.added) {
      const where = a.part ? `hymn ${a.hymn}, ${a.part}, line ${a.line}` : `hymn ${a.hymn}, title`;
      out.push(`  ${where}: ${a.text}`);
    }
  }
  if (check.dropped.length > 0) {
    out.push(`${check.dropped.length} line(s) in the source that are not in the result (dropped):`);
    for (const d of check.dropped) out.push(`  source line ${d.line}: ${d.text}`);
  }
  return out;
}
