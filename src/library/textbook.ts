import { ASSORTED_TITLE } from "../domain/own.ts";
import { containerBytes } from "../import/container.ts";
import { parseSongText, type TextError, type TextNote, textBook } from "../import/songtext.ts";
import { isLanguageCode } from "./languages.ts";

export interface TextFields {
  /** The new book's title; used only when the songs go to a new book of yours. */
  title: string;
  /** The language every song takes: a song keeps its own language and script (ADR-0033 §2). */
  language: string;
  script: string;
  /** For a single song whose first line has no number; blank for the book's next number. */
  number: string;
  /** Where the songs go (ADR-0033 §4): the default book, Assorted Hymns, or a new book of yours. */
  destination?: Destination;
}

/** Assorted Hymns (the default book of yours), or a new book of yours. */
export type Destination = "assorted" | "book";

export type FieldProblems = Partial<Record<keyof TextFields, string>>;

export type TextBuild =
  | { ok: false; fields: FieldProblems; errors: TextError[] }
  | {
      ok: true;
      /** Where the songs go; `book` is a new book of yours named `title`. */
      destination: Destination;
      /** The songs' container file name, which the review shows. */
      id: string;
      /** The songs as a container file, built in memory like `bun run pack` builds it. */
      bytes: Uint8Array;
      notes: TextNote[];
      /** The new book's title, for `book`. */
      title: string;
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
 * person types.
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

/** The id of the container the songs are carried in to the review: the person never sees it. */
export const TEXT_BUILD_ID = "text-songs";

/**
 * Song text to a container, or to what is wrong: the fields, which are
 * required and never guessed, and the parser's errors, each with its line.
 * Nothing is written either way. `next` is the number a single song without
 * one takes: the target book's next number (ADR-0033 §5), 1 for a new book.
 */
export function buildTextBook(fields: TextFields, songText: string, next = 1): TextBuild {
  const destination: Destination = fields.destination === "book" ? "book" : "assorted";
  const title = fields.title.trim();
  const language = fields.language.trim();
  const script = fields.script.trim();
  const problems: FieldProblems = {};
  if (destination === "book" && !title) problems.title = "Give the book a title.";
  if (!language) problems.language = "Choose the song’s language.";
  else if (!isLanguageCode(language)) {
    problems.language = "That isn’t a language code. Choose from the list, or type one such as sd.";
  }
  if (!language) {
    // The script follows the language; nothing to say about it yet.
  } else if (!script) problems.script = "Give the script code, such as Latn or Mlym.";
  else if (!/^[A-Za-z]{4}$/.test(script))
    problems.script = "A script code is four letters, such as Latn.";

  let number: number | undefined = next;
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

  // The container's book is a carrier: its title is the new book's, else the song's, which the review shows.
  const carried =
    destination === "book"
      ? title
      : parsed.songs.length === 1
        ? (parsed.songs[0]?.title ?? "")
        : ASSORTED_TITLE;
  const { hymnbook } = textBook(parsed.songs, {
    id: TEXT_BUILD_ID,
    title: carried,
    language: Intl.getCanonicalLocales(language)[0] ?? language,
    script: script[0]?.toUpperCase() + script.slice(1).toLowerCase(),
  });
  return {
    ok: true,
    id: TEXT_BUILD_ID,
    destination,
    bytes: containerBytes(hymnbook, parsed.songs),
    notes: parsed.notes,
    title,
  };
}
