/** Words Chicago style keeps lowercase in a title unless first or after a colon. */
const MINOR = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "nor",
  "for",
  "so",
  "yet",
  "as",
  "at",
  "by",
  "in",
  "of",
  "on",
  "to",
  "via",
]);

/**
 * Title Case for what's pressed or navigated — commands, menu items,
 * buttons (DESIGN.md § Words): "Bring the Output Forward". Sentences
 * (descriptions, placeholders, empty states) stay in sentence case and never
 * pass through this. A word already capitalised, or with a capital inside
 * (a key, a name), is left alone. Song titles pass through it too, where
 * shown: a subtitle in brackets starts afresh, "Men of Faith (Shout to the
 * North)".
 */
export function titleCase(text: string): string {
  let first = true;
  return text.replace(/[\p{L}\p{N}'’]+|[:—–(]/gu, (word) => {
    if (/^[:—–(]$/.test(word)) {
      first = true;
      return word;
    }
    const keep = !first && MINOR.has(word.toLowerCase());
    first = false;
    if (keep || /[A-Z]/.test(word)) return word;
    return word[0].toUpperCase() + word.slice(1);
  });
}
