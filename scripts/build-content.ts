import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { insertRows, packageRows } from "../src/domain/package-rows.ts";
import type { HymnbookSource, HymnSource } from "../src/domain/types.ts";
import { type HymnFile, type Violation, validateCorpus } from "../src/domain/validate.ts";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./content-schema.ts";

export interface SourceFile {
  name: string;
  bytes: Uint8Array;
}

export interface LoadedContent {
  hymnbook: unknown;
  files: HymnFile[];
  sources: SourceFile[];
  violations: Violation[];
}

export interface BuildResult {
  violations: Violation[];
  outFile?: string;
  contentHash?: string;
}

const HYMNBOOK_FILE = "hymnbook.json";

/** Reads a hymnbook directory. Unparseable or missing files become violations, not crashes. */
export function loadContent(dir: string): LoadedContent {
  const loaded: LoadedContent = { hymnbook: undefined, files: [], sources: [], violations: [] };
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();

  for (const name of names) {
    const bytes = readFileSync(join(dir, name));
    loaded.sources.push({ name, bytes });
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      loaded.violations.push({ rule: "parse", where: name, message });
      continue;
    }
    if (name === HYMNBOOK_FILE) loaded.hymnbook = value;
    else loaded.files.push({ file: name, hymn: value });
  }

  if (!names.includes(HYMNBOOK_FILE)) {
    loaded.violations.push({ rule: "missing-file", where: dir, message: `no ${HYMNBOOK_FILE}` });
  }
  return loaded;
}

/**
 * SHA-256 over every source file's name and bytes in name order, so any lyric
 * correction changes it and the same source always yields the same hash.
 */
export function hashContent(sources: SourceFile[]): string {
  const hash = createHash("sha256");
  const ordered = [...sources].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const { name, bytes } of ordered) {
    hash.update(name);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

interface PackageInput {
  hymnbook: HymnbookSource;
  hymns: HymnSource[];
  contentHash: string;
  outFile: string;
}

/** Builds the SQLite package (SDD-0001 §6). Input must already be validated. */
export function buildPackage({ hymnbook, hymns, contentHash, outFile }: PackageInput): void {
  mkdirSync(join(outFile, ".."), { recursive: true });
  const staging = `${outFile}.partial`;
  rmSync(staging, { force: true });

  const db = new DatabaseSync(staging);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(SCHEMA_SQL);
    const statements = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
    const run = (sql: string, bind: (string | number | null)[]) => {
      let statement = statements.get(sql);
      if (!statement) {
        statement = db.prepare(sql);
        statements.set(sql, statement);
      }
      statement.run(...bind);
    };

    db.exec("BEGIN");
    insertRows(
      run,
      // A shipped book's key and origin are its slug; it has matched no container.
      packageRows(hymnbook, hymns, {
        key: hymnbook.id,
        origin: hymnbook.id,
        sources: [],
        contentHash,
        schemaVersion: SCHEMA_VERSION,
      }),
    );
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  renameSync(staging, outFile);
}

/**
 * Adds a local overlay's hymns to a loaded hymnbook: `content-local/<id>/`,
 * git-ignored, for test hymns that must never be committed or deployed (CI
 * builds from the repo, where it doesn't exist). Its hymns are validated
 * with the book's, so a clash with a real number is caught; the book's
 * count grows to match.
 */
export function addOverlay(loaded: LoadedContent, overlayDir: string): number {
  if (!existsSync(overlayDir)) return 0;
  const overlay = loadContent(overlayDir);
  const hymns = overlay.files;
  loaded.files.push(...hymns);
  loaded.sources.push(...overlay.sources.filter((s) => s.name !== HYMNBOOK_FILE));
  loaded.violations.push(...overlay.violations.filter((v) => v.rule !== "missing-file"));
  const book = loaded.hymnbook as { hymnCount?: unknown } | undefined;
  if (book && typeof book.hymnCount === "number") {
    loaded.hymnbook = { ...book, hymnCount: book.hymnCount + hymns.length };
  }
  return hymns.length;
}

/** Every violation of a loaded book: the load's own, the corpus rules, and an
 * id that does not match its directory name. Shared by build and pack. */
export function bookViolations(loaded: LoadedContent, dir: string): Violation[] {
  const violations = [...loaded.violations, ...validateCorpus(loaded.hymnbook, loaded.files)];
  const name = basename(resolve(dir));
  const id = (loaded.hymnbook as { id?: unknown } | null)?.id;
  if (typeof id === "string" && id !== name) {
    violations.push({
      rule: "hymnbook-id",
      where: "hymnbook",
      message: `id ${id} must match its directory name ${name}`,
    });
  }
  return violations;
}

/** Loads, validates and (only if nothing is wrong) builds one hymnbook
 * directory, with its local overlay if there is one. */
export function buildContent({
  contentDir,
  outDir,
  overlayDir,
}: {
  contentDir: string;
  outDir: string;
  overlayDir?: string;
}) {
  const loaded = loadContent(contentDir);
  const local = overlayDir ? addOverlay(loaded, overlayDir) : 0;
  const violations = bookViolations(loaded, contentDir);

  if (violations.length > 0) return { violations } satisfies BuildResult;

  const contentHash = hashContent(loaded.sources);
  const outFile = join(outDir, `${basename(contentDir)}.sqlite`);
  buildPackage({
    hymnbook: loaded.hymnbook as HymnbookSource,
    hymns: loaded.files.map((f) => f.hymn as HymnSource),
    contentHash,
    outFile,
  });
  return { violations, outFile, contentHash, local } satisfies BuildResult & { local: number };
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const contentRoot = join(root, "content");
  // public/ is copied verbatim into the Vite build and served as-is in dev;
  // dist/ is emptied on every `vite build` and doesn't exist in dev at all.
  const outDir = join(root, "public", "content");
  const dirs = existsSync(contentRoot)
    ? readdirSync(contentRoot, { withFileTypes: true }).filter((d) => d.isDirectory())
    : [];

  let failed = false;
  for (const dir of dirs) {
    const result = buildContent({
      contentDir: join(contentRoot, dir.name),
      outDir,
      overlayDir: join(root, "content-local", dir.name),
    });
    if (result.violations.length > 0) {
      failed = true;
      console.error(`${dir.name}: ${result.violations.length} violation(s)`);
      for (const v of result.violations) console.error(`  [${v.rule}] ${v.where}: ${v.message}`);
    } else {
      console.log(`${dir.name}: built ${result.outFile}`);
      if ("local" in result && result.local)
        console.log(`  + ${result.local} local test hymn(s) from content-local/ (never deployed)`);
      console.log(`  content_hash ${result.contentHash}`);
    }
  }
  if (failed) process.exit(1);
}
