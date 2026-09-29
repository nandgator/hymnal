import type { PartKind } from "../domain/types.ts";
import { PART_KINDS } from "../domain/validate.ts";
import { ImportError } from "./source.ts";

/**
 * What differs between books, as data: one file per book, holding no lyrics
 * (SDD-0003 §3). Everything a stage decides from appearance is named here,
 * so a new book is a new profile, not new code.
 */
export interface Profile {
  hymnbook: {
    id: string;
    title: string;
    language: string;
    script: string;
    publisher?: string;
    edition?: string;
  };
  /** The song pages; front matter and index are outside them. */
  pages: PageSpan;
  /** Where the book lists its songs: number, title, page on each row. */
  index?: { pages: PageSpan };
  /** Drops a line that is only a page number. */
  furniture: { pageNumber: boolean };
  /** A song starts at a line matching this, in this font if given. */
  title: { pattern: string; font?: string };
  /** A block set wholly in this font is a chorus. */
  chorus: { font: string };
  /**
   * The words that name a part, lower case, and the kind each names:
   * { "chorus": "chorus" }. Alone in its block, a label means "sing that
   * part here"; heading a block, it gives the block its kind.
   */
  labels: Record<string, PartKind>;
  /**
   * Words that direct the singers, lower case: "ladies", "men", "echo". A
   * bracket holding only these ("(ladies descant)", "[Together]") is taken
   * out of the line; echoed words in brackets are lyrics and stay.
   */
  directions?: string[];
  /** A gap wider than this, × the book's line pitch, ends a block. */
  stanzaGap: number;
}

export interface PageSpan {
  from: number;
  to: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Checks a profile read from JSON; every problem is listed, none repaired. */
export function parseProfile(value: unknown): Profile {
  const problems: string[] = [];
  const need = (ok: boolean, message: string) => {
    if (!ok) problems.push(message);
  };
  const known = (at: string, v: Record<string, unknown>, keys: string[]) => {
    for (const key of Object.keys(v))
      need(keys.includes(key), `${at}${key} is not a profile field`);
  };
  const text = (v: unknown) => typeof v === "string" && v.trim() !== "";
  const span = (at: string, v: unknown) => {
    if (!isRecord(v)) return need(false, `${at} must be { "from": n, "to": n }`);
    known(`${at}.`, v, ["from", "to"]);
    const ok = Number.isInteger(v.from) && Number.isInteger(v.to) && (v.from as number) >= 1;
    need(
      ok && (v.from as number) <= (v.to as number),
      `${at} must run from page ≥ 1 to a later one`,
    );
  };

  if (!isRecord(value)) throw new ImportError("A profile must be a JSON object.");
  const p = value;
  known("", p, [
    "hymnbook",
    "pages",
    "index",
    "furniture",
    "title",
    "chorus",
    "labels",
    "directions",
    "stanzaGap",
  ]);

  if (isRecord(p.hymnbook)) {
    const book = p.hymnbook;
    const fields = ["id", "title", "language", "script", "publisher", "edition"];
    known("hymnbook.", book, fields);
    for (const key of fields.slice(0, 4)) need(text(book[key]), `hymnbook.${key} is required`);
    for (const key of fields.slice(4)) {
      need(book[key] === undefined || text(book[key]), `hymnbook.${key} must be text`);
    }
  } else need(false, "hymnbook is required");

  span("pages", p.pages);
  if (p.index !== undefined) {
    if (isRecord(p.index)) {
      known("index.", p.index, ["pages"]);
      span("index.pages", p.index.pages);
    } else need(false, 'index must be { "pages": … }');
  }

  if (isRecord(p.furniture)) {
    known("furniture.", p.furniture, ["pageNumber"]);
    need(typeof p.furniture.pageNumber === "boolean", "furniture.pageNumber must be true or false");
  } else need(false, "furniture is required");

  if (isRecord(p.title)) {
    known("title.", p.title, ["pattern", "font"]);
    need(p.title.font === undefined || text(p.title.font), "title.font must be text");
    if (typeof p.title.pattern !== "string") need(false, "title.pattern is required");
    else {
      try {
        const groups = new RegExp(`${p.title.pattern}|`).exec("")?.groups ?? {};
        need(
          "number" in groups && "title" in groups,
          "title.pattern must name two groups, (?<number>…) and (?<title>…)",
        );
      } catch {
        need(false, "title.pattern is not a valid regular expression");
      }
    }
  } else need(false, "title is required");

  if (isRecord(p.chorus)) {
    known("chorus.", p.chorus, ["font"]);
    need(text(p.chorus.font), "chorus.font is required");
  } else need(false, "chorus is required");

  if (isRecord(p.labels)) {
    for (const [word, kind] of Object.entries(p.labels)) {
      need(word === word.toLowerCase() && text(word), `labels: "${word}" must be lower case`);
      need(PART_KINDS.includes(kind as PartKind), `labels.${word}: "${kind}" is not a part kind`);
    }
  } else need(false, "labels is required, {} if the book prints none");

  need(
    p.directions === undefined ||
      (Array.isArray(p.directions) &&
        p.directions.every((w) => typeof w === "string" && /^\p{Ll}+$/u.test(w))),
    "directions must be a list of lower-case words",
  );

  need(
    typeof p.stanzaGap === "number" && p.stanzaGap > 1,
    "stanzaGap must be a number above 1 (× line pitch)",
  );

  if (problems.length > 0) {
    throw new ImportError(`The profile has problems:\n- ${problems.join("\n- ")}`);
  }
  return p as unknown as Profile;
}
