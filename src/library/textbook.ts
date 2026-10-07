import { containerBytes } from "../import/container.ts";
import { parseSongText, type TextError, type TextNote, textBook } from "../import/songtext.ts";
import { isLanguageCode } from "./languages.ts";

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

/** Several text files as one song text: a `---` line between them, as the format allows (text-format.md §1). */
export function joinSongTexts(texts: string[]): string {
  return texts
    .map((text) =>
      text
        .replace(/\r\n?/g, "\n")
        .replace(/(\n\s*-{3,}\s*)+$/, "")
        .trimEnd(),
    )
    .filter((text) => text.trim() !== "")
    .join("\n\n---\n\n");
}

export const ID_RULE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Song text to a container, or to what is wrong:
 * the book's own fields, which are required and never guessed, and the parser's
 * errors, each with its line. Nothing is written either way.
 */
export function buildTextBook(fields: TextFields, songText: string): TextBuild {
  const title = fields.title.trim();
  const language = fields.language.trim();
  const script = fields.script.trim();
  const id = fields.id.trim();
  const problems: FieldProblems = {};
  if (!title) problems.title = "Give the book a title.";
  if (!language) problems.language = "Choose the book’s language.";
  else if (!isLanguageCode(language)) {
    problems.language = "That isn’t a language code. Choose from the list, or type one such as sd.";
  }
  if (!language) {
    // The script follows the language; nothing to say about it yet.
  } else if (!script) problems.script = "Give the script code, such as Latn or Mlym.";
  else if (!/^[A-Za-z]{4}$/.test(script))
    problems.script = "A script code is four letters, such as Latn.";
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

  const { hymnbook } = textBook(parsed.songs, {
    id,
    title,
    language: Intl.getCanonicalLocales(language)[0] ?? language,
    script: script[0]?.toUpperCase() + script.slice(1).toLowerCase(),
  });
  return {
    ok: true,
    id,
    bytes: containerBytes(hymnbook, parsed.songs),
    notes: parsed.notes,
  };
}
