/**
 * What the importer was unsure of, or couldn't do, said once and never
 * decided silently (SDD-0003 §4). Each note is about one hymn where it can
 * be; the rest are about the book.
 */
export interface Note {
  kind: NoteKind;
  message: string;
  hymn?: number;
  /** The source page, to find it in the document. */
  page?: number;
}

export type NoteKind =
  /** Text before the first title, or a page with no song. */
  | "stray"
  /** A number missing, repeated, or out of order. */
  | "number"
  /** The index disagrees with the page. */
  | "index"
  /** A printer's line wrap joined, both halves quoted. */
  | "wrap"
  /** A block split by a column or page break, joined or not. */
  | "break"
  /** A stanza twice the length of the song's others: two printed with no gap? */
  | "long"
  /** A block in mixed fonts, so neither clearly stanza nor chorus. */
  | "fonts"
  /** A sequence taken from a rule, not from the page. */
  | "sequence"
  /** "(2)", "(repeat)": taken out of the line. */
  | "repeat"
  /** "(ladies descant)", "(echo)": taken out of the line. */
  | "direction"
  /** A last line quoting the chorus's first ("Bind us together, Lord ..."): the chorus sung again. */
  | "cue"
  /** A violation of the content format. */
  | "invalid";

/** How a wrap note says it was a guess. */
export const GUESS = "(a guess) ";

const HEADINGS: Record<NoteKind, string> = {
  invalid: "Not valid content",
  stray: "Text outside any song",
  number: "Numbers",
  index: "Index and page disagree",
  break: "Blocks split by a column or page break",
  long: "Stanzas twice the usual length",
  fonts: "Blocks in mixed fonts",
  cue: "Chorus cues read as the chorus",
  sequence: "Sequences taken from a rule",
  wrap: "Line wraps joined",
  repeat: "Repeat marks taken out",
  direction: "Directions taken out",
};

/** report.md: a summary, then every note, grouped by kind, most serious first. */
export function renderReport(title: string, summary: string[], notes: Note[]): string {
  const out = [`# Import report: ${title}`, "", ...summary.map((line) => `- ${line}`)];
  for (const kind of Object.keys(HEADINGS) as NoteKind[]) {
    let these = notes.filter((note) => note.kind === kind);
    if (these.length === 0) continue;
    // A sure wrap is counted; only the guesses are listed.
    const sure = kind === "wrap" ? these.filter((note) => !note.message.startsWith(GUESS)) : [];
    if (kind === "wrap") these = these.filter((note) => note.message.startsWith(GUESS));
    out.push("", `## ${HEADINGS[kind]} (${these.length})`, "");
    if (sure.length > 0) {
      out.push(`${sure.length} joined where the next line starts lowercase after open text.`);
      if (these.length > 0) out.push("");
    }
    for (const note of these) {
      const where = [note.hymn && `#${note.hymn}`, note.page && `p.${note.page}`]
        .filter(Boolean)
        .join(", ");
      out.push(`- ${where ? `**${where}** ` : ""}${note.message}`);
    }
  }
  return `${out.join("\n")}\n`;
}
