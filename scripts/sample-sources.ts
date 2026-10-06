// The public-domain sample's sources (Board #43, ADR-0026): two book
// directories for `bun run pack`, and the rights page beside them. Plain code
// over the research files; no LLM touches the lyrics (CLAUDE.md).
//
//   bun scripts/sample-sources.ts [research dir] [corpus dir] [out dir]
//
// Defaults: content-local/sample-research, content/mal-ymef-athmeeya-geethangal-16,
// content-local/sample. The rights page is written to docs/sample/RIGHTS.md.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Author {
  name: string;
  role: string;
  died: number;
  source: string;
}
interface EnglishEntry {
  number: number;
  title: string;
  first_line: string;
  authors: Author[];
  first_published: number;
  line_in_txt: number;
}
interface MalayalamEntry {
  corpus_number: number;
  corpus_title: string;
  writer: string;
  died: number;
  death_source: string;
  attribution_source: string;
  us: string;
}
interface Part {
  id: string;
  kind: string;
  label?: string;
  lines: string[];
}
interface Song {
  number: number;
  title: string;
  parts: Part[];
  sequence: { partId: string }[];
  meta: Record<string, string>;
}

export const ENGLISH_ID = "otterbein-hymnal-sample";
export const MALAYALAM_ID = "malayalam-public-domain-sample";
const OTTERBEIN = "The Otterbein Hymnal (1890), Project Gutenberg eBook #16455";

const HEADER = /^(\d+)\s{3,}\S/;
const CHORUS = /^(?:Cho|Ref)\.--/;

/** Gutenberg's typing, set as printed: `--` is a dash. */
const typeset = (line: string) => line.trim().replace(/--/g, "—");

/** "Nicaea 11s, 12s, & 10s." → tune and meter. */
export function tuneAndMeter(header: string): { tune?: string; meter?: string } {
  const text = header.replace(/^\d+\s+/, "").trim();
  const match = /^(.*?)[.,]?\s+((?:\d+s|[LCSP]\. ?M\.|[LCS]\. ?P\. ?M\.).*?)\.?$/.exec(text);
  if (!match) return { tune: text.replace(/\.$/, "") };
  return { tune: match[1], meter: match[2]?.replace(/\s+/g, " ") };
}

/** One Otterbein hymn, from its header line to the next hymn's. */
export function otterbeinSong(lines: string[], entry: EnglishEntry, number: number): Song {
  const start = entry.line_in_txt - 1;
  if (!new RegExp(`^${entry.number}\\s{3,}`).test(lines[start] ?? ""))
    throw new Error(`hymn ${entry.number}: no header at line ${entry.line_in_txt}`);
  let end = start + 1;
  while (end < lines.length && !HEADER.test(lines[end] ?? "")) end++;

  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of lines.slice(start + 1, end)) {
    if (line.trim()) block.push(line);
    else if (block.length) {
      blocks.push(block);
      block = [];
    }
  }
  if (block.length) blocks.push(block);

  const stanzas: Part[] = [];
  let chorus: Part | undefined;
  for (const b of blocks) {
    const first = b[0] ?? "";
    if (CHORUS.test(first)) {
      chorus = {
        id: "c",
        kind: "chorus",
        lines: [first.replace(CHORUS, ""), ...b.slice(1)].map(typeset),
      };
      continue;
    }
    // A topic (`_Adoration._`), a cross-reference (`(219)`) or the author: one line, not lyrics.
    if (b.length === 1 && (/^\s{4,}\S/.test(first) || /^_.*_/.test(first.trim()))) continue;
    const numbered = /^(\d+) (.*)$/.exec(first);
    const label = numbered ? numbered[1] : "1";
    if (Number(label) !== stanzas.length + 1)
      throw new Error(`hymn ${entry.number}: stanza ${label} after ${stanzas.length}`);
    stanzas.push({
      id: `s${label}`,
      kind: "stanza",
      label,
      lines: [numbered ? (numbered[2] ?? "") : first, ...b.slice(1)].map(typeset),
    });
  }
  if (!stanzas.length) throw new Error(`hymn ${entry.number}: no stanzas`);

  const sequence = stanzas.flatMap((s) => [{ partId: s.id }, ...(chorus ? [{ partId: "c" }] : [])]);
  const { tune, meter } = tuneAndMeter(lines[start] ?? "");
  const meta: Record<string, string> = {
    author: entry.authors.map((a) => a.name).join(", "),
  };
  if (tune) meta.tune = tune;
  if (meter) meta.meter = meter;
  return {
    number,
    title: entry.first_line.replace(/[,;:.]+$/, ""),
    parts: chorus ? [...stanzas, chorus] : stanzas,
    sequence,
    meta,
  };
}

const pad = (n: number) => String(n).padStart(4, "0");

function writeBook(dir: string, hymnbook: Record<string, unknown>, songs: Song[]): void {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "hymnbook.json"),
    `${JSON.stringify({ format: 1, ...hymnbook, hymnCount: songs.length }, null, 2)}\n`,
  );
  for (const song of songs)
    writeFileSync(join(dir, `${pad(song.number)}.json`), `${JSON.stringify(song, null, 2)}\n`);
}

function rightsPage(english: EnglishEntry[], malayalam: MalayalamEntry[]): string {
  const out = [
    "# The sample's rights",
    "",
    "The sample books are in the public domain in India (life + 60 years), the EU",
    "(life + 70) and the US (published before 1931). Each song's record says why,",
    "with the sources it rests on (Board #43, ADR-0026). Generated by",
    "`scripts/sample-sources.ts`; do not edit by hand.",
    "",
    `## Otterbein Hymnal sample (\`${ENGLISH_ID}\`)`,
    "",
    `From ${OTTERBEIN}, numbered as printed there.`,
    "",
  ];
  for (const e of english) {
    const who = e.authors
      .map((a) => `${a.name} (${a.role}, died ${a.died}; [source](${a.source}))`)
      .join("; ");
    out.push(
      `- **${e.number}. ${e.first_line.replace(/[,;:.]+$/, "")}**: ${who}. First published ${e.first_published}.`,
    );
  }
  out.push(
    "",
    `## Malayalam sample (\`${MALAYALAM_ID}\`)`,
    "",
    "Text as in the maintainer's corpus; each writer died before 1931, so the song",
    "was published before 1931.",
    "",
  );
  malayalam.forEach((m, i) => {
    out.push(
      `- **${i + 1}. ${m.corpus_title}**: ${m.writer}, died ${m.died} ([death](${m.death_source}); [attribution](${m.attribution_source})).`,
    );
  });
  return `${out.join("\n")}\n`;
}

if (import.meta.main) {
  const [
    research = "content-local/sample-research",
    corpus = "content/mal-ymef-athmeeya-geethangal-16",
    out = "content-local/sample",
  ] = process.argv.slice(2);
  const lines = readFileSync(join(research, "otterbein.txt"), "utf8")
    .replace(/\r/g, "")
    .split("\n");
  const english = (
    JSON.parse(readFileSync(join(research, "sample-english.json"), "utf8")) as EnglishEntry[]
  )
    .slice()
    .sort((a, b) => a.number - b.number);
  const malayalam = (
    JSON.parse(readFileSync(join(research, "sample-malayalam.json"), "utf8")) as MalayalamEntry[]
  ).filter((m) => m.us === "free");

  writeBook(
    join(out, ENGLISH_ID),
    {
      id: ENGLISH_ID,
      title: "The Otterbein Hymnal: a sample",
      language: "en",
      script: "Latn",
      publisher: "United Brethren Publishing House",
      edition: "1890",
    },
    english.map((e) => otterbeinSong(lines, e, e.number)),
  );
  writeBook(
    join(out, MALAYALAM_ID),
    { id: MALAYALAM_ID, title: "സാമ്പിൾ ഗാനങ്ങൾ", language: "ml", script: "Mlym" },
    malayalam.map((m, i) => {
      const song = JSON.parse(
        readFileSync(join(corpus, `${pad(m.corpus_number)}.json`), "utf8"),
      ) as Song;
      if (song.title !== m.corpus_title)
        throw new Error(`corpus ${m.corpus_number}: title differs`);
      return { ...song, number: i + 1, meta: { ...song.meta, author: m.writer } };
    }),
  );
  mkdirSync("docs/sample", { recursive: true });
  writeFileSync("docs/sample/RIGHTS.md", rightsPage(english, malayalam));
  // Prose in this repo is wrapped by prettier (`bun run check`).
  execFileSync("bunx", ["prettier", "--write", "docs/sample/RIGHTS.md"], { stdio: "ignore" });
  console.log(
    `wrote ${english.length} + ${malayalam.length} songs to ${out}, and docs/sample/RIGHTS.md`,
  );
}
