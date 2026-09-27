import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { hymnFileName } from "../src/domain/validate.ts";
import { type Draft, draftBook } from "../src/import/draft.ts";
import { parseProfile } from "../src/import/profile.ts";
import { type PageRange, readPdf } from "../src/import/read/pdf.ts";
import { renderReport } from "../src/import/report.ts";
import { ImportError, type SourcePage } from "../src/import/source.ts";

const USAGE = `Usage: bun run import <file.pdf> [--pages <from>[-<to>]]
       bun run import <file.pdf> --profile <profile.json> [--out <dir>]

Without a profile, prints each line of the PDF with its position, size and
font, then the fonts it uses: what a book's profile is written from.
With one, writes a draft hymnbook and report.md to <dir>, by default
imports/<id>/ (SDD-0003 §3, §5).`;

/** "5-12" → pages 5 to 12; "5" → page 5 alone; "5-" → page 5 to the end. */
export function parsePages(value: string): PageRange {
  const match = /^(\d+)(?:(-)(\d*))?$/.exec(value);
  if (!match) throw new ImportError(`--pages takes 5, 5-12 or 5-, not "${value}".`);
  const from = Number(match[1]);
  if (!match[2]) return { from, to: from };
  return match[3] ? { from, to: Number(match[3]) } : { from };
}

export interface FontUse {
  font: string;
  lines: number;
  /** Where it first appears, to find it in the document. */
  page: number;
  sample: string;
}

/** Every font, most lines first. A profile names its title and chorus fonts from this. */
export function fontSummary(pages: SourcePage[]): FontUse[] {
  const fonts = new Map<string, FontUse>();
  for (const page of pages) {
    for (const line of page.lines) {
      const use = fonts.get(line.font);
      if (use) use.lines++;
      else
        fonts.set(line.font, { font: line.font, lines: 1, page: page.number, sample: line.text });
    }
  }
  return [...fonts.values()].sort((a, b) => b.lines - a.lines);
}

const num = (n: number, width: number) => n.toFixed(1).padStart(width);

function print(pages: SourcePage[]) {
  const fonts = fontSummary(pages);
  const fontWidth = Math.max(4, ...fonts.map((f) => f.font.length));

  for (const page of pages) {
    console.log(`\npage ${page.number}  ${num(page.width, 0)} × ${num(page.height, 0)} pt`);
    for (const line of page.lines) {
      const at = `${num(line.x, 6)} ${num(line.y, 6)} ${num(line.size, 5)}`;
      console.log(`${at}  ${line.font.padEnd(fontWidth)}  ${line.text}`);
    }
  }

  console.log(`\n${"font".padEnd(fontWidth)}  lines  first seen`);
  for (const use of fonts) {
    const sample = use.sample.length > 40 ? `${use.sample.slice(0, 39)}…` : use.sample;
    console.log(
      `${use.font.padEnd(fontWidth)}  ${String(use.lines).padStart(5)}  p.${use.page} "${sample}"`,
    );
  }

  const blank = pages.filter((page) => page.lines.length === 0).map((page) => page.number);
  if (blank.length > 0) console.log(`\nNo text on page(s) ${blank.join(", ")}.`);
}

/** Replaces a previous draft's files in `dir`, and nothing else there. */
export function writeDraft(dir: string, draft: Draft) {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (/^(\d{4}\.json|hymnbook\.json|report\.md)$/.test(name)) rmSync(join(dir, name));
  }
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(join(dir, "hymnbook.json"), json(draft.hymnbook));
  for (const hymn of draft.hymns) writeFileSync(join(dir, hymnFileName(hymn.number)), json(hymn));
  writeFileSync(
    join(dir, "report.md"),
    renderReport(draft.hymnbook.title, draft.summary, draft.notes),
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      pages: { type: "string" },
      profile: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length !== 1) {
    console.log(USAGE);
    process.exit(values.help ? 0 : 1);
  }

  const profile = values.profile
    ? parseProfile(JSON.parse(readFileSync(values.profile, "utf8")))
    : undefined;
  if (profile && values.pages)
    throw new ImportError("--pages and --profile don't mix: the profile names its pages.");
  const range = values.pages ? parsePages(values.pages) : {};
  const pages = await readPdf(new Uint8Array(readFileSync(positionals[0])), pdfjs, range);
  if (pages.every((page) => page.lines.length === 0)) {
    throw new ImportError(
      "No text found: the PDF looks scanned. Scans need OCR, which isn't supported yet.",
    );
  }
  if (!profile) return print(pages);

  const draft = draftBook(pages, profile);
  const dir = values.out ?? join("imports", profile.hymnbook.id);
  writeDraft(dir, draft);
  for (const line of draft.summary) console.log(line);
  console.log(`Wrote ${dir}/ (see report.md)`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    if (!(error instanceof ImportError)) throw error;
    console.error(error.message);
    process.exit(1);
  });
}
