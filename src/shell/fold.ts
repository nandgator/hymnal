/**
 * Text as compared when searching a list by what is typed: lower case, Latin accents
 * removed ("Édition" matches "edition"). Only the combining accents of U+0300 to U+036F
 * go: the vowel signs and virama of Malayalam and other Indic scripts are marks too, and
 * part of the letters, so they stay.
 */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC").toLowerCase();
}
