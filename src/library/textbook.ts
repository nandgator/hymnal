import { ASSORTED_ORIGIN, ASSORTED_TITLE, type OwnTarget } from "../domain/own.ts";
import { containerBytes } from "../import/container.ts";
import { parseSongText, type TextError, type TextNote, textBook } from "../import/songtext.ts";
import { isLanguageCode, scriptName } from "./languages.ts";

export interface TextFields {
  /** The new book's name; used only when the songs go to a new book of yours. */
  title: string;
  /** The language every song takes: a song keeps its own language and script (ADR-0033 §2). */
  language: string;
  script: string;
  /** For a single song whose first line has no number; blank for the book's next number. */
  number: string;
  /** Where the songs go (ADR-0033 §4); absent means the default book. */
  destination?: Destination;
}

/** Where the songs go: the default book (Assorted Hymns), one of yours by key, or a new book of yours. */
export type Destination = { kind: "default" } | { kind: "book"; key: string } | { kind: "new" };

export type FieldProblems = Partial<Record<keyof TextFields, string>>;

export type TextBuild =
  | { ok: false; fields: FieldProblems; errors: TextError[] }
  | {
      ok: true;
      /** Where the songs go, as the review and the add take it. */
      target: OwnTarget;
      /** The songs' container file name, which the review shows. */
      id: string;
      /** The songs as a container file, built in memory like `bun run pack` builds it. */
      bytes: Uint8Array;
      notes: TextNote[];
    };

/** A script code in its usual case: "latn" is "Latn". */
export const normalScript = (script: string): string =>
  script.trim().slice(0, 1).toUpperCase() + script.trim().slice(1).toLowerCase();

/** What is wrong with a script code, or nothing: four letters, and a script this device knows. */
export function scriptProblem(script: string): string | undefined {
  const code = script.trim();
  if (!code) return "Give the script code, such as Latn or Mlym.";
  if (!/^[A-Za-z]{4}$/.test(code)) return "A script code is four letters, such as Latn.";
  const titled = normalScript(code);
  // An unknown code names itself; a known one has a name of its own.
  if (scriptName(titled) === titled) {
    return `“${titled}” is not a script this device knows. Try Latn, Mlym or Taml.`;
  }
  return undefined;
}

/** The name to suggest for a new book: "My Songs", or "My Songs 2" when that is taken. */
export function suggestBookTitle(taken: readonly string[]): string {
  const held = new Set(taken.map((t) => t.trim().toLowerCase()));
  const name = (n: number) => (n === 1 ? "My Songs" : `My Songs ${n}`);
  let n = 1;
  while (held.has(name(n).toLowerCase())) n++;
  return name(n);
}

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
 * Nothing is written either way. `next` is the number a song without one
 * takes, counting up: the target book's next number (ADR-0033 §5), 1 for a
 * new book.
 */
export function buildTextBook(fields: TextFields, songText: string, next = 1): TextBuild {
  const destination: Destination = fields.destination ?? { kind: "default" };
  const title = fields.title.trim();
  const language = fields.language.trim();
  const script = fields.script.trim();
  const problems: FieldProblems = {};
  if (destination.kind === "new" && !title) problems.title = "Give the book a name.";
  if (!language) problems.language = "Choose the song’s language.";
  else if (!isLanguageCode(language)) {
    problems.language = "That isn’t a language code. Choose from the list, or type one such as sd.";
  }
  // The script follows the language; nothing to say about it yet.
  if (language) {
    const bad = scriptProblem(script);
    if (bad) problems.script = bad;
  }

  let single: number | undefined;
  if (fields.number.trim()) {
    single = Number(fields.number.trim());
    if (!Number.isSafeInteger(single) || single < 1) {
      problems.number = "A whole number from 1, or leave it blank.";
      single = undefined;
    }
  }

  if (!songText.trim()) {
    return {
      ok: false,
      fields: problems,
      errors: [{ line: 0, message: "There are no songs to add. Paste them or open a .txt file." }],
    };
  }
  const parsed = parseSongText(songText, { number: single, next });
  if (!parsed.ok) return { ok: false, fields: problems, errors: parsed.errors };
  if (Object.keys(problems).length > 0) return { ok: false, fields: problems, errors: [] };

  // The container's book is a carrier: its title is the new book's, else the song's, which the review shows.
  const carried =
    destination.kind === "new"
      ? title
      : parsed.songs.length === 1
        ? (parsed.songs[0]?.title ?? "")
        : ASSORTED_TITLE;
  const { hymnbook } = textBook(parsed.songs, {
    id: TEXT_BUILD_ID,
    title: carried,
    language: Intl.getCanonicalLocales(language)[0] ?? language,
    script: normalScript(script),
  });
  const target: OwnTarget =
    destination.kind === "new"
      ? { kind: "new", title }
      : destination.kind === "book"
        ? { kind: "book", key: destination.key }
        : { kind: "default" };
  return {
    ok: true,
    id: TEXT_BUILD_ID,
    target,
    bytes: containerBytes(hymnbook, parsed.songs),
    notes: parsed.notes,
  };
}

/** One of the person's books, as the Add to picker and the numbering know it. */
export interface BookChoice {
  key: string;
  origin: string;
  title: string;
  /** The number a song with none takes (1 when the book has none yet). */
  nextNumber: number;
}

/** The picker's values besides a book's key: the default book before it is made, and a new book. */
export const CHOICE_DEFAULT = "default";
export const CHOICE_NEW = "new";

/**
 * The picker's value for what the person chose, if anything, else the book
 * last added to, else Assorted Hymns (its key when it exists, "default" when
 * the next song makes it). A book that is gone falls back the same way.
 */
export function resolveChoice(
  chosen: string | undefined,
  books: readonly BookChoice[],
  remembered?: string,
): string {
  if (chosen === CHOICE_NEW) return CHOICE_NEW;
  const assorted = books.find((b) => b.origin === ASSORTED_ORIGIN)?.key ?? CHOICE_DEFAULT;
  const held = (key: string | undefined) => !!key && books.some((b) => b.key === key);
  if (chosen === CHOICE_DEFAULT) return assorted;
  if (chosen && held(chosen)) return chosen;
  return remembered && held(remembered) ? remembered : assorted;
}

/** The destination a picker value stands for. */
export const destinationOf = (choice: string): Destination =>
  choice === CHOICE_NEW
    ? { kind: "new" }
    : choice === CHOICE_DEFAULT
      ? { kind: "default" }
      : { kind: "book", key: choice };

/** The number a song with none takes in the book chosen: its next number, 1 in a book not made yet. */
export const nextNumberFor = (choice: string, books: readonly BookChoice[]): number =>
  books.find((b) => b.key === choice)?.nextNumber ?? 1;
