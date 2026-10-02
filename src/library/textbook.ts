import { containerBytes } from "../import/container.ts";
import { parseSongText, type TextError, type TextNote, textBook } from "../import/songtext.ts";
import { type SourceCheck, sourceCheck } from "../import/sourcecheck.ts";

/** What the review says about the source check (ADR-0029): never run, or run. */
export type SourceState = { kind: "none" } | { kind: "checked"; check: SourceCheck };

export interface TextFields {
  title: string;
  language: string;
  script: string;
  id: string;
  /** For a single song whose first line has no number; blank otherwise. */
  number: string;
}

export type FieldProblems = Partial<Record<keyof TextFields, string>>;

export type TextBuild =
  | { ok: false; fields: FieldProblems; errors: TextError[] }
  | {
      ok: true;
      id: string;
      /** The book as a container file, built in memory like `bun run pack` builds it. */
      bytes: Uint8Array;
      notes: TextNote[];
      source: SourceState;
    };

/** A book id from a title: lower-case ASCII letters and digits, joined by "-". Empty when the title has none (Malayalam, say). */
export function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const ID_RULE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Song text (and an optional source text) to a container, or to what is wrong:
 * the book's own fields, which are required and never guessed, and the parser's
 * errors, each with its line. Nothing is written either way.
 */
export function buildTextBook(fields: TextFields, songText: string, sourceText: string): TextBuild {
  const title = fields.title.trim();
  const language = fields.language.trim();
  const script = fields.script.trim();
  const id = fields.id.trim();
  const problems: FieldProblems = {};
  if (!title) problems.title = "Give the book a title.";
  if (!language) problems.language = "Give the language code, such as en or ml.";
  if (!script) problems.script = "Give the script code, such as Latn or Mlym.";
  if (!id) problems.id = "Give the book an id: letters, digits, - and _.";
  else if (!ID_RULE.test(id)) {
    problems.id = "The id is letters, digits, - and _, starting with a letter or digit.";
  }

  let number: number | undefined;
  if (fields.number.trim()) {
    number = Number(fields.number.trim());
    if (!Number.isSafeInteger(number) || number < 1) {
      problems.number = "A whole number from 1, or leave it blank.";
    }
  }

  if (!songText.trim()) {
    return {
      ok: false,
      fields: problems,
      errors: [{ line: 0, message: "There is no song text." }],
    };
  }
  const parsed = parseSongText(songText, { number });
  if (!parsed.ok) return { ok: false, fields: problems, errors: parsed.errors };
  if (Object.keys(problems).length > 0) return { ok: false, fields: problems, errors: [] };

  const { hymnbook } = textBook(parsed.songs, { id, title, language, script });
  return {
    ok: true,
    id,
    bytes: containerBytes(hymnbook, parsed.songs),
    notes: parsed.notes,
    source: sourceText.trim()
      ? { kind: "checked", check: sourceCheck(sourceText, parsed.songs) }
      : { kind: "none" },
  };
}
