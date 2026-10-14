/**
 * How much a text field takes (DESIGN.md § Inputs). One set for the whole app, so no box is
 * without a limit and no two disagree. Lengths are UTF-16 code units, as `maxlength` counts.
 */

/** A search or filter box: the longest query anyone means. */
export const SEARCH_MAX = 100;
/** A book's name or title. */
export const NAME_MAX = 200;
/** A language tag (BCP 47 allows 35) or a script code (4 letters), typed by hand. */
export const CODE_MAX = 35;
/** A song number: up to six digits, far past any hymnbook. */
export const NUMBER_MAX = 6;
/**
 * The From Text area. A 1,600-song Malayalam book is about 1.2 million characters, so this fits
 * a whole real book and stops a paste of something else (a log, a page of HTML) outright.
 */
export const TEXT_MAX = 2_000_000;
/** What a card shows back of a query, in graphemes: one line, not a wall. */
export const ECHO_MAX = 40;

/** Said when a paste or a file would take the song text over {@link TEXT_MAX}; nothing is added. */
export const TEXT_TOO_LONG = "That text is too long to add at once. Add it in parts.";

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

/** The text's grapheme clusters; code points where the platform has no segmenter. */
function clusters(text: string): string[] {
  return segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : [...text];
}

/** `text` cut to at most `max` code units, never inside a grapheme cluster (a programmatic set, as `maxlength` does for typing). */
export function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  let out = "";
  for (const cluster of clusters(text.slice(0, max + 32))) {
    if (out.length + cluster.length > max) break;
    out += cluster;
  }
  return out;
}

/** A query to show back in a card: the first `max` graphemes and an ellipsis when there was more. */
export function clipEcho(text: string, max = ECHO_MAX): string {
  const parts = clusters(text);
  return parts.length <= max ? text : `${parts.slice(0, max).join("")}…`;
}
