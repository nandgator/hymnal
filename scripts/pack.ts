import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Violation } from "../src/domain/validate.ts";
import { containerBytes, gzipContainer } from "../src/import/container.ts";
import { bookViolations, loadContent } from "./build-content.ts";

const USAGE = `Usage: bun run pack <dir> [--out <dir>]

Writes <id>.hymnbook.json.gz (SDD-0002 §1) from a hymnbook directory,
content/<id>/ or imports/<id>/, by default into imports/. The book is
validated first; any violation is listed and nothing is written.`;

export { gzipContainer };

export type PackResult =
  | { ok: false; violations: Violation[] }
  | {
      ok: true;
      violations: [];
      outFile: string;
      bytes: Uint8Array;
      songs: number;
      sha256: string;
    };

/** Loads, validates and (only if nothing is wrong) packs one hymnbook directory. */
export function packBook(dir: string, outDir: string): PackResult {
  const loaded = loadContent(dir);
  const violations = bookViolations(loaded, dir);
  if (violations.length > 0) return { ok: false, violations };

  const id = (loaded.hymnbook as { id: string }).id;
  const hymns = loaded.files.map((f) => f.hymn as { number: number });
  const bytes = containerBytes(loaded.hymnbook, hymns);
  const outFile = join(outDir, `${id}.hymnbook.json.gz`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { ok: true, violations: [], outFile, bytes, songs: hymns.length, sha256 };
}

const size = (n: number) =>
  n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { out: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  if (values.help || positionals.length !== 1) {
    (values.help ? console.log : console.error)(USAGE);
    process.exit(values.help ? 0 : 1);
  }
  const dir = positionals[0];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`${dir}: not a directory`);
    process.exit(1);
  }
  const result = packBook(dir, values.out ?? "imports");
  if (!result.ok) {
    console.error(`${dir}: ${result.violations.length} violation(s), nothing written`);
    for (const v of result.violations) console.error(`  [${v.rule}] ${v.where}: ${v.message}`);
    process.exit(1);
  }
  console.log(
    `packed ${result.outFile}: ${result.songs} songs, ${size(result.bytes.length)}, sha256 ${result.sha256}`,
  );
}

if (import.meta.main) main();
