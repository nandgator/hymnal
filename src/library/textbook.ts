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
  /** Where one song goes (SDD-0004 §17); a book of its own when absent, and always for several songs. */
  destination?: Destination;
}

/** Assorted Hymns, or a book of its own. */
export type Destination = "assorted" | "book";

export type FieldProblems = Partial<Record<keyof TextFields, string>>;

export type TextBuild =
  | { ok: false; fields: FieldProblems; errors: TextError[] }
  | {
      ok: true;
      id: string;
      /** Where the song(s) go: `assorted` only for exactly one song, asked for. */
      destination: Destination;
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

/**
 * How many songs the text holds, counted as the parser splits them (a `---`
 * line between, comments dropped), without reading them: it is asked as the
 * person types, to know whether Assorted Hymns is on offer.
 */
export function songCount(text: string): number {
  let songs = 0;
  let has = false;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (line.startsWith("#")) continue;
    if (/^-{3,}$/.test(line)) {
      if (has) songs++;
      has = false;
    } else if (line !== "") has = true;
  }
  return has ? songs + 1 : songs;
}

/** The id of the one-song book built for Assorted Hymns: the person never sees it. */
export const ASSORTED_BUILD_ID = "assorted-song";

export const ID_RULE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Song text to a container, or to what is wrong:
 * the book's own fields, which are required and never guessed, and the parser's
 * errors, each with its line. Nothing is written either way.
 */
export function buildTextBook(fields: TextFields, songText: string): TextBuild {
  const toAssorted = fields.destination === "assorted" && songCount(songText) === 1;
  const title = fields.title.trim();
  const language = fields.language.trim();
  const script = fields.script.trim();
  const id = fields.id.trim();
  const problems: FieldProblems = {};
  if (!title && !toAssorted) problems.title = "Give the book a title.";
  if (!language)
    problems.language = toAssorted ? "Choose the song’s language." : "Choose the book’s language.";
  else if (!isLanguageCode(language)) {
    problems.language = "That isn’t a language code. Choose from the list, or type one such as sd.";
  }
  if (!language) {
    // The script follows the language; nothing to say about it yet.
  } else if (!script) problems.script = "Give the script code, such as Latn or Mlym.";
  else if (!/^[A-Za-z]{4}$/.test(script))
    problems.script = "A script code is four letters, such as Latn.";
  if (toAssorted) {
    // The book's id and title and the song's number are the container's, not the person's.
  } else if (!id) problems.id = "Give the book an id: letters, digits, - and _.";
  else if (!ID_RULE.test(id)) {
    problems.id = "The id is letters, digits, - and _, starting with a letter or digit.";
  }

  let number: number | undefined;
  if (toAssorted) number = 1;
  else if (fields.number.trim()) {
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

  // The one-song book of Assorted Hymns is titled by its song, which the review shows.
  const bookTitle = toAssorted ? (parsed.songs[0]?.title ?? "") : title;
  const bookId = toAssorted ? ASSORTED_BUILD_ID : id;
  const { hymnbook } = textBook(parsed.songs, {
    id: bookId,
    title: bookTitle,
    language: Intl.getCanonicalLocales(language)[0] ?? language,
    script: script[0]?.toUpperCase() + script.slice(1).toLowerCase(),
  });
  return {
    ok: true,
    id: bookId,
    destination: toAssorted ? "assorted" : "book",
    bytes: containerBytes(hymnbook, parsed.songs),
    notes: parsed.notes,
  };
}
