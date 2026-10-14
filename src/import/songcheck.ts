/**
 * Song-text check (ADR-0034): does this text look like a song? Hand rules, pure
 * (no DOM, no UI), the same answer on every device. It returns `ok` or a reason
 * in plain words that a note on review can show. It never blocks anything.
 *
 * Any script (ADR-0034 §6): a letter is `\p{L}` or `\p{M}` (Malayalam's vowel
 * signs are marks), lengths are in graphemes as seen (`Intl.Segmenter`), the
 * zero-width joiners are never a signal, and the code and maths signals are
 * ASCII. An emoji is one grapheme however many code points it takes (§7).
 */

export type SongCheck = { ok: true } | { ok: false; reason: string };

const OK: SongCheck = { ok: true };
const no = (reason: string): SongCheck => ({ ok: false, reason });

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** One user-perceived character at a time. */
const split = (text: string): string[] => Array.from(graphemes.segment(text), (s) => s.segment);

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Presentation}/u;
const DIGIT = /\p{Nd}/u;
/** Space, and the zero-width characters that are never a sign of anything. */
const SPACE = /^(?:\s|[\u200b-\u200d\u2060\ufeff])+$/u;
/** What code is full of and a lyric rarely holds (ASCII, whatever the language). */
const CODE_SYMBOL = /^[{}[\];=<>\\&^%$#@~*+`_]$/;

interface Shape {
  /** The parts of the text between blank lines, each its trimmed non-empty lines. */
  groups: string[][];
  /** Non-empty lines, trimmed. */
  lines: string[];
  /** Lengths in graphemes. */
  lengths: number[];
  /** Every grapheme that is not space. */
  marks: string[];
}

function shape(text: string): Shape {
  const groups: string[][] = [[]];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") {
      if (groups[groups.length - 1]?.length) groups.push([]);
    } else groups[groups.length - 1]?.push(line);
  }
  if (groups[groups.length - 1]?.length === 0) groups.pop();
  const lines = groups.flat();
  const cells = lines.map(split);
  return {
    groups,
    lines,
    lengths: cells.map((c) => c.length),
    marks: cells.flat().filter((g) => !SPACE.test(g)),
  };
}

const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);

/** How many of the lines the test holds for, as a share. */
const shareOf = (lines: string[], test: (line: string) => boolean) =>
  share(lines.filter(test).length, lines.length);

/** The few most used code symbols in the text, for the reason. */
function commonSymbols(marks: string[]): string {
  const counts = new Map<string, number>();
  for (const m of marks) if (CODE_SYMBOL.test(m)) counts.set(m, (counts.get(m) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m]) => m)
    .join(" ");
}

/** The count of `delimiter` in a line, outside double quotes. */
function delimiters(line: string, delimiter: string): number {
  let quoted = false;
  let n = 0;
  let before = " ";
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === delimiter && !quoted && (delimiter !== "|" || /\s/.test(before))) n++;
    before = c;
  }
  return n;
}

/** Whether most lines hold the same number (at least `least`) of the delimiter: columns. */
function columns(lines: string[], delimiter: string, least: number): boolean {
  if (lines.length < 3) return false;
  const counts = lines.map((l) => delimiters(l, delimiter));
  const first = counts.find((c) => c >= least);
  if (first === undefined) return false;
  return share(counts.filter((c) => c === first).length, lines.length) >= 0.8;
}

const CODE_LINE =
  /^(?:if|elif|else|for|while|try|except|finally|with|def|class|switch|case)\b.*:$|^(?:return|raise|throw|print|yield|assert)\b\s*[\w"'([]|[{}]$|[()=[\]].*;$|^(?:\/\/|\/\*|\*\/|#!|#include|<\?|<\/?[A-Za-z!][^>]*>|\$ |(?:SELECT|INSERT|CREATE|UPDATE|DELETE|FROM|WHERE|GROUP BY|ORDER BY|LEFT JOIN)\b|(?:import|from \S+ import|def|class|function|const|let|var|export|package|fn|func|public|private|static|echo|sudo|git|npm|bun)\s+\S+.*[(=:{;]|\S+\s*(?:=|\+=|:=|=>|->)\s*\S)/;

/** Time or date at the start of a line, like a log or a chat. */
const STAMP = /^[[(]?(?:\d{4}-\d\d-\d\d|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}[:.]\d\d)/;

const LINK =
  /https?:\/\/\S+|\bwww\.\S+|[^\s@]+@[^\s@]+\.[A-Za-z]{2,}|\b[\w-]+\.(?:com|org|net|edu|gov|io|in|co)\b/i;

const MAIL_HEADER =
  /^(?:From|To|Cc|Bcc|Subject|Date|Sent|Reply-To|De|Para|Asunto|Von|An|Betreff|Objet):\s/i;

/** The song as text, the way a person would see it: title, then the parts between blank lines. */
export function songTextOf(song: { title: string; parts: { lines: string[] }[] }): string {
  return [song.title, ...song.parts.map((p) => p.lines.join("\n"))].join("\n\n");
}

/** Checks a parsed song (its title and the lines of its parts). */
export function checkSong(song: { title: string; parts: { lines: string[] }[] }): SongCheck {
  return checkSongText(songTextOf(song));
}

/** Checks the text of one song: its title and lines, with blank lines between parts. */
export function checkSongText(text: string): SongCheck {
  const s = shape(text);
  if (s.lines.length === 0 || s.marks.length < 8) return OK;
  const total = s.marks.length;
  const { lines, groups } = s;

  // Emoji (§7): a few as decoration pass, mostly emoji do not.
  const emoji = s.marks.filter((g) => EMOJI.test(g)).length;
  if (share(emoji, total) >= 0.3) return no("Lines are mostly emoji, not words.");
  const words = s.marks.filter((g) => !EMOJI.test(g));

  // Maths.
  if ((text.match(/\\[A-Za-z]{2,}/g) ?? []).length >= 2 || /\$[^$\n]+\$/.test(text)) {
    return no("Lines have formulas in them.");
  }
  if (
    lines.length >= 3 &&
    shareOf(lines, (l) => /=/.test(l) && DIGIT.test(l) && !/[{};[\]]|=>/.test(l)) >= 0.5
  ) {
    return no("Lines are equations.");
  }
  const sm = words.filter((g) => /^\p{Sm}$/u.test(g) && !/^[<>=+|~]$/.test(g)).length;
  if (sm >= 3 && share(sm, words.length) >= 0.06) return no("Lines are equations.");
  const digits = words.filter((g) => DIGIT.test(g)).length;
  if (share(digits, words.length) >= 0.3) return no("Lines are mostly numbers.");

  // Code and markup: ASCII symbols and line shapes.
  const symbols = words.filter((g) => CODE_SYMBOL.test(g)).length;
  if (symbols >= 4 && share(symbols, words.length) >= 0.05) {
    return no(`Lines are full of ${commonSymbols(words)} like code.`);
  }
  if (lines.length >= 2 && shareOf(lines, (l) => CODE_LINE.test(l)) >= 0.4) {
    return no("Lines read like code.");
  }
  if (lines.length >= 3 && shareOf(lines, (l) => /<\/?[A-Za-z][^>]*>/.test(l)) >= 0.3) {
    return no("Lines are full of tags like markup.");
  }

  // Email.
  if (lines.filter((l) => MAIL_HEADER.test(l)).length >= 2) return no("Reads like an email.");
  if (lines.filter((l) => l.startsWith(">")).length >= 2 || /wrote:$|^Sent from my /m.test(text)) {
    return no("Reads like an email.");
  }
  const first = groups[0];
  const last = groups[groups.length - 1];
  if (
    groups.length >= 3 &&
    first?.length === 1 &&
    /[,:，：]$/.test(first[0] ?? "") &&
    last &&
    last.length <= 4 &&
    /[,，]$/.test(last[0] ?? "")
  ) {
    return no("Reads like an email.");
  }

  // Links and paths.
  if (lines.length >= 2 && shareOf(lines, (l) => LINK.test(l)) >= 0.3) {
    return no("Lines are links or addresses.");
  }
  if (lines.length >= 3 && shareOf(lines, (l) => /^(?:\/|~\/|\.\/|[A-Za-z]:\\)\S/.test(l)) >= 0.5) {
    return no("Lines are file paths.");
  }

  // Data: columns, settings, times.
  if (
    columns(lines, "\t", 1) ||
    columns(lines, "|", 1) ||
    columns(lines, ";", 2) ||
    (lines.length >= 4 && columns(lines, ",", 2))
  ) {
    return no("Lines are split into columns, like a table.");
  }
  if (lines.length >= 3 && shareOf(lines, (l) => /^[A-Za-z_][\w.-]*\s*=\s*\S/.test(l)) >= 0.6) {
    return no("Lines look like settings (name = value).");
  }
  if (lines.length >= 3 && shareOf(lines, (l) => l.startsWith("|")) >= 0.5) {
    return no("Lines are split into columns, like a table.");
  }
  if (
    lines.length >= 5 &&
    shareOf(lines, (l) => /^(?:- )?[A-Za-z_][\w-]*:(?:\s+\S.*)?$/.test(l)) >= 0.7
  ) {
    return no("Lines look like settings (name: value).");
  }
  if (lines.length >= 3 && shareOf(lines, (l) => STAMP.test(l)) >= 0.5) {
    return no("Lines start with times or dates, like a log or a chat.");
  }
  if (
    lines.length >= 3 &&
    shareOf(lines, (l) => /^\S+\s.*\d[\d\-.]*$/.test(l) && /\d{3}/.test(l)) >= 0.6
  ) {
    return no("Lines end in numbers, like a list.");
  }

  // Chat.
  if (lines.length >= 3 && shareOf(lines, (l) => /^<[^>\s]{1,24}>\s/.test(l)) >= 0.5) {
    return no("Lines start with a name in < >, like a chat.");
  }
  const speaker = /^([\p{L}\p{M}\d_. -]{1,24}):\s+\S/u;
  if (lines.length >= 4 && shareOf(lines, (l) => speaker.test(l)) >= 0.6) {
    const names = new Map<string, number>();
    for (const l of lines) {
      const name = speaker.exec(l)?.[1];
      if (name) names.set(name, (names.get(name) ?? 0) + 1);
    }
    if (names.size <= 4 && [...names.values()].every((n) => n >= 2)) {
      return no("Lines start with a name and a colon, like a chat.");
    }
  }
  if (
    lines.length >= 3 &&
    shareOf(lines, (l) => /\b\d{1,2}:\d\d\s*(?:[AaPp][Mm])?$/.test(l)) >= 0.2
  ) {
    return no("Lines carry times, like a chat.");
  }

  // Prose: paragraphs, not lines.
  const longest = Math.max(...s.lengths);
  const single = groups.every((g) => g.length === 1);
  if (longest >= 220) return no("Reads like a paragraph, not lines.");
  if (single && longest >= 100 && (lines.length <= 3 || groups.length >= 3)) {
    return no("Reads like a paragraph, not lines.");
  }
  if (single && groups.length >= 2 && median(s.lengths) >= 40) {
    return no("Reads like paragraphs, not lines.");
  }
  if (wrapped(groups)) return no("Lines are cut at a margin, like a paragraph.");
  if (numbered(lines) && longest >= 60) {
    return no("Lines are numbered, like verses or articles read from a page.");
  }

  return OK;
}

/** Most lines start with a number, or with one word and a number (Article 1, Verse 2). */
function numbered(lines: string[]): boolean {
  if (lines.length < 3) return false;
  if (shareOf(lines, (l) => /^\p{Nd}+[.)]?\s/u.test(l)) >= 0.7) return true;
  const labels = new Map<string, number>();
  for (const l of lines) {
    const m = /^(\S+)\s+\p{Nd}+[.:)]?\s+\S/u.exec(l);
    if (m?.[1]) labels.set(m[1], (labels.get(m[1]) ?? 0) + 1);
  }
  return Math.max(0, ...labels.values()) >= Math.max(3, lines.length * 0.7);
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * Lines of near one width that stop mid-sentence: text cut at a margin. The last
 * line of each paragraph is shorter and is left out.
 */
function wrapped(groups: string[][]): boolean {
  const body = groups.flatMap((g) => (g.length > 1 ? g.slice(0, -1) : []));
  if (body.length < 3) return false;
  const lengths = body.map((l) => split(l).length);
  const widest = Math.max(...lengths);
  const near = share(lengths.filter((n) => n >= widest * 0.8).length, body.length);
  const ends = shareOf(body, (l) => /[\p{P}\p{S}\u0e2f\u0e5a\u0e5b]$/u.test(l));
  // Short lines are a song's. Only a long run with no stanza break and no stops is a page.
  if (widest < 40) return body.length >= 10 && groups.length === 1 && near >= 0.75 && ends <= 0.2;
  return near >= 0.75 && ends <= 0.5;
}
