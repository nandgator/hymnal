import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hymnbook } from "../src/domain/types.ts";
import {
  convertLegacyHymn,
  type LegacyHymn,
  type MigrationReport,
  summarize,
} from "./legacy-convert.ts";

const LEGACY_COMMIT = "155baea";
const LEGACY_DIR = "archive/data/lyrics/mal";

export const HYMNBOOK: Hymnbook = {
  id: "mal-ymef-athmeeya-geethangal-16",
  title: "ആത്മീയ ഗീതങ്ങൾ",
  language: "ml",
  script: "Mlym",
  publisher: "Premier Bible Publication & General YMEF",
  edition: "16th",
  hymnCount: 1631,
};

export interface MigrateOptions {
  outDir: string;
  hymnbook: Hymnbook;
  legacy: LegacyHymn[];
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export const hymnFileName = (number: number) => `${String(number).padStart(4, "0")}.json`;

/** Writes the corpus source. Refuses to touch an existing directory: it holds hand corrections. */
export function migrate({ outDir, hymnbook, legacy }: MigrateOptions): MigrationReport {
  if (existsSync(outDir)) {
    throw new Error(
      `refusing to run: ${outDir} already exists. Migration output is source with hand ` +
        "corrections in it (ADR-0009); it must never be regenerated wholesale.",
    );
  }

  const conversions = legacy.map(convertLegacyHymn);
  const numbers = new Set(conversions.map((c) => c.hymn.number));
  if (numbers.size !== conversions.length) throw new Error("duplicate hymn numbers in legacy data");
  if (conversions.length !== hymnbook.hymnCount) {
    throw new Error(`expected ${hymnbook.hymnCount} hymns, found ${conversions.length}`);
  }

  const staging = `${outDir}.partial`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, "hymnbook.json"), json(hymnbook));
  for (const { hymn } of conversions) {
    writeFileSync(join(staging, hymnFileName(hymn.number)), json(hymn));
  }
  renameSync(staging, outDir);

  return summarize(conversions);
}

function readLegacyFromGit(): LegacyHymn[] {
  const git = (...args: string[]) =>
    execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return git("ls-tree", "-r", "--name-only", LEGACY_COMMIT, LEGACY_DIR)
    .split("\n")
    .filter((path) => path.endsWith(".json"))
    .sort()
    .map((path) => JSON.parse(git("show", `${LEGACY_COMMIT}:${path}`)) as LegacyHymn);
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const outDir = join(root, "content", HYMNBOOK.id);
  const report = migrate({ outDir, hymnbook: HYMNBOOK, legacy: readLegacyFromGit() });

  console.log(`Wrote ${report.total} hymns to ${outDir}`);
  console.log("Shapes:", report.shapes);
  console.log(`Trimmed whitespace on ${report.trimmedLines} lines`);
  console.log(
    `Empty lines dropped, review by hand (${report.flaggedForReview.length}):`,
    report.flaggedForReview.join(", "),
  );
}
