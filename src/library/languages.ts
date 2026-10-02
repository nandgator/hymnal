/** Languages a book is likely to be in; anything else is typed as a code ("Other…"). */
export const LANGUAGE_CODES = [
  "en",
  "ml",
  "ta",
  "hi",
  "te",
  "kn",
  "bn",
  "mr",
  "gu",
  "pa",
  "or",
  "ur",
  "ne",
  "si",
  "as",
  "sa",
  "ar",
  "he",
  "fa",
  "tr",
  "ru",
  "uk",
  "el",
  "zh",
  "ja",
  "ko",
  "th",
  "vi",
  "id",
  "ms",
  "fil",
  "my",
  "km",
  "es",
  "pt",
  "fr",
  "de",
  "it",
  "nl",
  "sv",
  "no",
  "da",
  "fi",
  "pl",
  "cs",
  "hu",
  "ro",
  "sw",
  "am",
  "yo",
  "ig",
  "zu",
  "af",
] as const;

export interface LanguageOption {
  code: string;
  /** The language in its own script: "മലയാളം". */
  native: string;
  /** In English: "Malayalam". */
  english: string;
  /** "മലയാളം — Malayalam", or "English" when both are the same. */
  label: string;
}

const names = (locale: string, type: "language" | "script") => {
  try {
    return new Intl.DisplayNames([locale], { type });
  } catch {
    return undefined;
  }
};

/** A language's name in English, or undefined when the code means nothing. */
export function englishName(code: string): string | undefined {
  const name = names("en", "language")?.of(code);
  return name && name !== code ? name : undefined;
}

/** The label for a language code, in its own name and in English. */
export function languageOption(code: string): LanguageOption {
  const english = englishName(code) ?? code;
  let native = english;
  try {
    const own = names(code, "language")?.of(code);
    if (own && own !== code) native = own;
  } catch {
    // An engine without that language's names says it in English.
  }
  const same = native.toLowerCase() === english.toLowerCase();
  return { code, native, english, label: same ? english : `${native} — ${english}` };
}

/** The picker's list, in English alphabetical order. */
export function languageOptions(): LanguageOption[] {
  return LANGUAGE_CODES.map(languageOption).sort((a, b) =>
    a.english.localeCompare(b.english, "en"),
  );
}

/** Options whose names or code contain what was typed. */
export function filterLanguages(options: LanguageOption[], query: string): LanguageOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (o) =>
      o.english.toLowerCase().includes(q) ||
      o.native.toLowerCase().includes(q) ||
      o.code.toLowerCase().startsWith(q),
  );
}

/** Whether `code` is a language code the platform can read. */
export function isLanguageCode(code: string): boolean {
  try {
    return Intl.getCanonicalLocales(code).length === 1 && /^[A-Za-z]{2,3}(-|$)/.test(code);
  } catch {
    return false;
  }
}

/** The script a language is written in, by default ("ml" is Mlym); empty when unknown. */
export function scriptOf(language: string): string {
  if (!isLanguageCode(language)) return "";
  try {
    return new Intl.Locale(language).maximize().script ?? "";
  } catch {
    return "";
  }
}

/** A script's name in English: "Mlym" is Malayalam. */
export function scriptName(code: string): string {
  try {
    const name = names("en", "script")?.of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

/** The languages books are most often in, offered first when nothing has been typed. */
export const COMMON_CODES = [
  "en",
  "ml",
  "ta",
  "hi",
  "te",
  "kn",
  "bn",
  "mr",
  "gu",
  "pa",
  "or",
  "ur",
  "ne",
  "si",
] as const;
