import { scriptOf } from "./languages.ts";

/**
 * A suggestion for a book's language from its pasted text (SDD-0004 §9). It
 * runs on this device and only suggests: the person's own choice wins, and
 * nothing is sent anywhere.
 */

/** A script by Unicode property, and what it says about the language. */
interface ScriptRule {
  test: RegExp;
  /** Set where the script implies one main language. */
  language?: string;
  /** Where it does not, the languages a detector's answer may be, to agree with the script. */
  candidates?: (code: string) => boolean;
}

const among =
  (...codes: string[]) =>
  (code: string) =>
    codes.includes(code);

// Scripts several languages write carry no language here, only the languages
// a detector may name for them.
const SCRIPTS: ScriptRule[] = [
  { test: /\p{Script=Malayalam}/u, language: "ml" },
  { test: /\p{Script=Tamil}/u, language: "ta" },
  { test: /\p{Script=Kannada}/u, language: "kn" },
  { test: /\p{Script=Telugu}/u, language: "te" },
  { test: /\p{Script=Gujarati}/u, language: "gu" },
  { test: /\p{Script=Gurmukhi}/u, language: "pa" },
  { test: /\p{Script=Oriya}/u, language: "or" },
  { test: /\p{Script=Sinhala}/u, language: "si" },
  { test: /\p{Script=Thai}/u, language: "th" },
  { test: /\p{Script=Hangul}/u, language: "ko" },
  { test: /\p{Script=Hebrew}/u, language: "he" },
  { test: /\p{Script=Greek}/u, language: "el" },
  { test: /\p{Script=Georgian}/u, language: "ka" },
  { test: /\p{Script=Armenian}/u, language: "hy" },
  { test: /\p{Script=Devanagari}/u, candidates: among("hi", "mr", "ne", "sa") },
  { test: /\p{Script=Bengali}/u, candidates: among("bn", "as") },
  { test: /\p{Script=Arabic}/u, candidates: among("ar", "fa", "ur") },
  { test: /\p{Script=Cyrillic}/u, candidates: among("ru", "uk") },
  { test: /\p{Script=Latin}/u, candidates: (code) => scriptOf(code) === "Latn" },
  { test: /\p{Script=Han}/u, candidates: among("zh", "ja") },
];

/** Fewest letters worth a guess, and the share the dominant script must hold. */
const MIN_LETTERS = 12;
const MIN_SHARE = 0.6;
/** Text read for the guess: the start of a book says what it is in. */
const SAMPLE = 2000;

/** The dominant script of `text` by letter count; undefined with too few letters or no script holding most. */
export function dominantScript(text: string): ScriptRule | undefined {
  const counts = new Map<ScriptRule, number>();
  let letters = 0;
  for (const char of text.slice(0, SAMPLE)) {
    if (!/\p{L}/u.test(char)) continue;
    letters++;
    const rule = SCRIPTS.find((r) => r.test.test(char));
    if (rule) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  if (letters < MIN_LETTERS) return undefined;
  let best: ScriptRule | undefined;
  let bestCount = 0;
  for (const [rule, n] of counts) {
    if (n > bestCount) {
      best = rule;
      bestCount = n;
    }
  }
  return best && bestCount / letters >= MIN_SHARE ? best : undefined;
}

/** The language a text's script implies ("ml" for Malayalam); undefined where several languages share the script. */
export function languageFromScript(text: string): string | undefined {
  return dominantScript(text)?.language;
}

/** The part of Chrome's on-device LanguageDetector this uses. */
export interface LanguageDetectorApi {
  availability(): Promise<string>;
  create(): Promise<{
    detect(text: string): Promise<{ detectedLanguage: string | null; confidence: number }[]>;
  }>;
}

/** A detector's answer below this is not offered. */
export const MIN_CONFIDENCE = 0.8;

const platformApi = (): LanguageDetectorApi | undefined =>
  "LanguageDetector" in self
    ? (self as unknown as { LanguageDetector: LanguageDetectorApi }).LanguageDetector
    : undefined;

/**
 * The language to suggest for `text`, if any: the script's own language where
 * it implies one; for a script several languages share, Chrome's on-device
 * detector, if there is one, only when its model is already on this device
 * (never downloaded for this) and only for a confident answer that agrees with
 * the script. Otherwise nothing, and the person picks.
 */
export async function suggestLanguage(
  text: string,
  api: LanguageDetectorApi | undefined = platformApi(),
): Promise<string | undefined> {
  const rule = dominantScript(text);
  if (!rule) return undefined;
  if (rule.language) return rule.language;
  if (!api || !rule.candidates) return undefined;
  try {
    if ((await api.availability()) !== "available") return undefined;
    const detector = await api.create();
    const [top] = await detector.detect(text.slice(0, SAMPLE));
    const code = top?.detectedLanguage?.toLowerCase();
    if (!code || top.confidence < MIN_CONFIDENCE) return undefined;
    return rule.candidates(code) ? code : undefined;
  } catch {
    return undefined;
  }
}
