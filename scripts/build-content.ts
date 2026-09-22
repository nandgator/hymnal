import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Hymnbook, HymnSource } from "../src/domain/types.ts";
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
  hymnbook: Hymnbook;
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
    const insertBook = db.prepare("INSERT INTO hymnbook VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertHymn = db.prepare("INSERT INTO hymn VALUES (?, ?, ?, ?, ?)");
    const insertPart = db.prepare("INSERT INTO part VALUES (?, ?, ?, ?)");
    const insertLine = db.prepare("INSERT INTO line VALUES (?, ?, ?, ?)");
    const insertEntry = db.prepare("INSERT INTO sequence_entry VALUES (?, ?, ?)");
    const insertFts = db.prepare("INSERT INTO hymn_fts (rowid, title, body) VALUES (?, ?, ?)");

    db.exec("BEGIN");
    insertBook.run(
      hymnbook.id,
      hymnbook.title,
      hymnbook.language,
      hymnbook.script,
      hymnbook.publisher ?? null,
      hymnbook.edition ?? null,
      hymnbook.isbn ?? null,
      SCHEMA_VERSION,
      contentHash,
    );
    for (const hymn of hymns) {
      const { author, tune, meter } = hymn.meta;
      insertHymn.run(hymn.number, hymn.title, author ?? null, tune ?? null, meter ?? null);
      for (const part of hymn.parts) {
        insertPart.run(hymn.number, part.id, part.kind, part.label ?? null);
        part.lines.forEach((text, idx) => {
          insertLine.run(hymn.number, part.id, idx, text);
        });
      }
      hymn.sequence.forEach((entry, idx) => {
        insertEntry.run(hymn.number, idx, entry.partId);
      });
      const body = hymn.parts.flatMap((part) => part.lines).join("\n");
      insertFts.run(hymn.number, hymn.title, body);
    }
    db.exec("COMMIT");
  } finally {
    db.close();
  }
  renameSync(staging, outFile);
}

/** Loads, validates and (only if nothing is wrong) builds one hymnbook directory. */
export function buildContent({ contentDir, outDir }: { contentDir: string; outDir: string }) {
  const loaded = loadContent(contentDir);
  const violations = [...loaded.violations, ...validateCorpus(loaded.hymnbook, loaded.files)];

  const id = (loaded.hymnbook as { id?: unknown } | null)?.id;
  if (typeof id === "string" && id !== basename(contentDir)) {
    violations.push({
      rule: "hymnbook-id",
      where: "hymnbook",
      message: `id ${id} must match its directory name ${basename(contentDir)}`,
    });
  }
  if (violations.length > 0) return { violations } satisfies BuildResult;

  const contentHash = hashContent(loaded.sources);
  const outFile = join(outDir, `${basename(contentDir)}.sqlite`);
  buildPackage({
    hymnbook: loaded.hymnbook as Hymnbook,
    hymns: loaded.files.map((f) => f.hymn as HymnSource),
    contentHash,
    outFile,
  });
  return { violations, outFile, contentHash } satisfies BuildResult;
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
    const result = buildContent({ contentDir: join(contentRoot, dir.name), outDir });
    if (result.violations.length > 0) {
      failed = true;
      console.error(`${dir.name}: ${result.violations.length} violation(s)`);
      for (const v of result.violations) console.error(`  [${v.rule}] ${v.where}: ${v.message}`);
    } else {
      console.log(`${dir.name}: built ${result.outFile}`);
      console.log(`  content_hash ${result.contentHash}`);
    }
  }
  if (failed) process.exit(1);
}
