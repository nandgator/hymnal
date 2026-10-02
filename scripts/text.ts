import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { validateCorpus } from "../src/domain/validate.ts";
import { parseSongText, textBook } from "../src/import/songtext.ts";
import { formatSourceCheck, sourceCheck } from "../src/import/sourcecheck.ts";

const USAGE = `Usage: bun run text <file.txt> --id <id> --title <title> --language <bcp47>
                    --script <iso15924> [--number <n>] [--source <src.txt>]
                    [--out <dir>] [--force]

Reads song text format 1 (docs/authoring/text-format.md) and writes the format 1
directory <out>/<id>/ (hymnbook.json and NNNN.json), by default under imports/.
Any error is listed with its line number and nothing is written. With --source,
the result is compared with the source text and every difference is listed
(added or altered lines, dropped lines); differences exit 1. The book's own
fields (--id, --title, --language, --script) are never guessed from the text.
--number applies only to a single song whose title line has no number (it is
ignored for a book). The id is letters, digits, "-" and "_". A directory that
holds an import draft (report.md) is refused unless --force.
Then: bun run pack <out>/<id>`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      source: { type: "string" },
      out: { type: "string" },
      number: { type: "string" },
      id: { type: "string" },
      title: { type: "string" },
      language: { type: "string" },
      script: { type: "string" },
      force: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || positionals.length !== 1) {
    (values.help ? console.log : console.error)(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  const file = positionals[0];
  if (!existsSync(file)) fail(`${file}: no such file`);
  if (values.source !== undefined && !existsSync(values.source)) {
    fail(`${values.source}: no such file`);
  }
  const number = values.number === undefined ? undefined : Number(values.number);
  if (
    values.number !== undefined &&
    !(/^\d+$/.test(values.number) && Number.isSafeInteger(number) && (number as number) >= 1)
  ) {
    fail("--number takes a whole number, 1 or more (digits only)");
  }
  if (values.id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(values.id)) {
    fail("--id is letters, digits, '-' and '_', starting with a letter or digit");
  }

  const parsed = parseSongText(readFileSync(file, "utf8"), { number });
  if (!parsed.ok) {
    console.error(`${file}: ${parsed.errors.length} error(s), nothing written`);
    for (const e of parsed.errors) console.error(`  ${file}:${e.line}: ${e.message}`);
    process.exit(1);
  }

  const missing = (["id", "title", "language", "script"] as const).filter((k) => !values[k]);
  if (missing.length > 0) {
    fail(
      `the book's own fields are asked for, never guessed: give ${missing.map((k) => `--${k}`).join(", ")}`,
    );
  }
  const { hymnbook, files } = textBook(parsed.songs, {
    id: values.id as string,
    title: values.title as string,
    language: values.language as string,
    script: values.script as string,
  });
  const violations = validateCorpus(hymnbook, files);
  if (violations.length > 0) {
    console.error(`${file}: ${violations.length} violation(s), nothing written`);
    for (const v of violations) console.error(`  [${v.rule}] ${v.where}: ${v.message}`);
    process.exit(1);
  }

  // A previous draft's files are replaced; nothing else in the directory is touched.
  const dir = join(values.out ?? "imports", hymnbook.id);
  if (existsSync(join(dir, "report.md")) && !values.force) {
    fail(`${dir} holds an import draft (report.md): nothing written; --force replaces its files`);
  }
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    if (name === "hymnbook.json" || /^\d{4,}\.json$/.test(name)) rmSync(join(dir, name));
  }
  const write = (name: string, value: unknown) =>
    writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
  write("hymnbook.json", hymnbook);
  for (const f of files) write(f.file, f.hymn);
  console.log(`wrote ${dir}: ${files.length} song(s)`);
  for (const n of parsed.notes) console.log(`  note, hymn ${n.hymn}: ${n.message}`);

  if (values.source !== undefined) {
    const report = formatSourceCheck(
      sourceCheck(readFileSync(values.source, "utf8"), parsed.songs),
    );
    if (report.length > 0) {
      console.log(`source check against ${values.source}:`);
      for (const line of report) console.log(line);
      console.log("the check reports, you decide: fix the text and run this again");
      process.exit(1);
    }
    console.log(`source check against ${values.source}: no differences`);
  } else {
    console.log("not checked against a source (--source)");
  }
  console.log(`next: bun run pack ${dir}`);
}

if (import.meta.main) main();
