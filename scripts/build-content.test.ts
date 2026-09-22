import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildContent, hashContent, loadContent } from "./build-content.ts";
import { FTS_TOKENCHARS, SCHEMA_VERSION } from "./content-schema.ts";

const BOOK_ID = "test-book";
const book = { id: BOOK_ID, title: "T", language: "ml", script: "Mlym", hymnCount: 2 };

function hymn(number: number, lines: string[], overrides: Record<string, unknown> = {}) {
  return {
    number,
    title: lines[0],
    parts: [
      { id: "r", kind: "refrain", lines: [lines[0]] },
      { id: "s1", kind: "stanza", label: "1", lines: lines.slice(1) },
    ],
    sequence: [{ partId: "r" }, { partId: "s1" }, { partId: "r" }],
    meta: { author: "KVS" },
    ...overrides,
  };
}

let root: string;
let contentDir: string;
let outDir: string;

const write = (name: string, value: unknown) =>
  writeFileSync(
    join(contentDir, name),
    typeof value === "string" ? value : `${JSON.stringify(value)}\n`,
  );

function seed(hymns = [hymn(1, ["വാഴ്ത്തുക", "ദൈവം"]), hymn(2, ["വാഴ്ത്തി", "സ്തുതി"])]) {
  write("hymnbook.json", book);
  for (const h of hymns) write(`${String(h.number).padStart(4, "0")}.json`, h);
}

const open = (file: string) => new DatabaseSync(file, { readOnly: true });
const count = (db: DatabaseSync, table: string) =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "build-content-"));
  contentDir = join(root, "content", BOOK_ID);
  outDir = join(root, "dist", "content");
  mkdirSync(contentDir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("FTS_TOKENCHARS", () => {
  it("is exactly the Malayalam vowel signs, virama, ZWNJ and ZWJ", () => {
    const codepoints = [...FTS_TOKENCHARS].map((c) => c.codePointAt(0));
    expect(codepoints).toEqual([
      0x0d3e, 0x0d3f, 0x0d40, 0x0d41, 0x0d42, 0x0d43, 0x0d44, 0x0d46, 0x0d47, 0x0d48, 0x0d4a,
      0x0d4b, 0x0d4c, 0x0d4d, 0x200c, 0x200d,
    ]);
  });
});

describe("loadContent", () => {
  it("reads the hymnbook and hymn files, ignoring anything that is not json", () => {
    seed();
    write("notes.txt", "ignore me");
    const loaded = loadContent(contentDir);
    expect(loaded.violations).toEqual([]);
    expect(loaded.hymnbook).toEqual(book);
    expect(loaded.files.map((f) => f.file)).toEqual(["0001.json", "0002.json"]);
    expect(loaded.sources.map((s) => s.name)).toEqual(["0001.json", "0002.json", "hymnbook.json"]);
  });

  it("reports a file that is not valid JSON instead of throwing", () => {
    seed();
    write("0003.json", "{ nope");
    const { violations } = loadContent(contentDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ rule: "parse", where: "0003.json" });
  });

  it("reports a missing hymnbook.json", () => {
    write("0001.json", hymn(1, ["a", "b"]));
    expect(loadContent(contentDir).violations).toMatchObject([{ rule: "missing-file" }]);
  });
});

describe("hashContent", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);
  const files = [
    { name: "a.json", bytes: bytes("one") },
    { name: "b.json", bytes: bytes("two") },
  ];

  it("is deterministic and independent of input order", () => {
    expect(hashContent(files)).toBe(hashContent([...files].reverse()));
    expect(hashContent(files)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a single byte changes", () => {
    const edited = [files[0], { name: "b.json", bytes: bytes("twp") }];
    expect(hashContent(edited)).not.toBe(hashContent(files));
  });

  it("changes when a file is renamed", () => {
    const renamed = [files[0], { name: "c.json", bytes: files[1].bytes }];
    expect(hashContent(renamed)).not.toBe(hashContent(files));
  });

  it("does not confuse where one file ends and the next begins", () => {
    const a = [
      { name: "x", bytes: bytes("ab") },
      { name: "y", bytes: bytes("c") },
    ];
    const b = [
      { name: "x", bytes: bytes("a") },
      { name: "y", bytes: bytes("bc") },
    ];
    expect(hashContent(a)).not.toBe(hashContent(b));
  });
});

describe("buildContent", () => {
  it("builds a package holding every hymn, with sequence order preserved", () => {
    seed();
    const result = buildContent({ contentDir, outDir });
    expect(result.violations).toEqual([]);
    expect(result.outFile).toBe(join(outDir, `${BOOK_ID}.sqlite`));
    expect(existsSync(`${result.outFile}.partial`)).toBe(false);

    const db = open(result.outFile as string);
    expect(count(db, "hymn")).toBe(2);
    expect(count(db, "part")).toBe(4);
    expect(count(db, "hymn_fts")).toBe(2);
    expect(
      db.prepare("SELECT part_id FROM sequence_entry WHERE hymn_number = 1 ORDER BY idx").all(),
    ).toEqual([{ part_id: "r" }, { part_id: "s1" }, { part_id: "r" }]);
    expect(
      db
        .prepare("SELECT text FROM line WHERE hymn_number = 1 AND part_id = 's1' ORDER BY idx")
        .all(),
    ).toEqual([{ text: "ദൈവം" }]);
    db.close();
  });

  it("records the schema version, content hash and hymnbook metadata", () => {
    seed();
    const result = buildContent({ contentDir, outDir });
    const db = open(result.outFile as string);
    const row = db.prepare("SELECT * FROM hymnbook").get() as Record<string, unknown>;
    expect(row).toMatchObject({
      id: BOOK_ID,
      language: "ml",
      script: "Mlym",
      schema_version: SCHEMA_VERSION,
      content_hash: result.contentHash,
      publisher: null,
      isbn: null,
    });
    expect(db.prepare("SELECT author FROM hymn WHERE number = 1").get()).toEqual({
      author: "KVS",
    });
    db.close();
  });

  it("gives identical hashes for identical source, and a new hash after a correction", () => {
    seed();
    const first = buildContent({ contentDir, outDir });
    const again = buildContent({ contentDir, outDir });
    expect(again.contentHash).toBe(first.contentHash);

    write("0001.json", hymn(1, ["വാഴ്ത്തുക", "ദൈവമേ"]));
    expect(buildContent({ contentDir, outDir }).contentHash).not.toBe(first.contentHash);
  });

  it("indexes Malayalam words whole, not as bare consonants (risk R5)", () => {
    seed();
    const db = open(buildContent({ contentDir, outDir }).outFile as string);
    const match = (q: string) =>
      db.prepare("SELECT rowid FROM hymn_fts WHERE hymn_fts MATCH ?").all(q);

    // Hymn 1 has വാഴ്ത്തുക, hymn 2 has വാഴ്ത്തി: same consonants, different vowels.
    // Fragmented into consonants, each query would match both.
    expect(match("വാഴ്ത്തുക")).toEqual([{ rowid: 1 }]);
    expect(match("വാഴ്ത്തി")).toEqual([{ rowid: 2 }]);
    expect(match("വാഴ്ത്*")).toHaveLength(2);
    db.close();
  });

  it("returns every violation and writes nothing when the source is invalid", () => {
    seed([hymn(1, ["a", "b"], { sequence: [] }), hymn(2, ["c", "d"])]);
    write("0002.json", hymn(2, ["c", "d"], { meta: { topics: ["x"] } }));
    const result = buildContent({ contentDir, outDir });
    expect(result.violations.map((v) => v.rule).sort()).toEqual([
      "I3",
      "I5",
      "I5",
      "unsupported-meta",
    ]);
    expect(result.outFile).toBeUndefined();
    expect(existsSync(outDir)).toBe(false);
  });

  it("requires the hymnbook id to match its directory name", () => {
    seed();
    write("hymnbook.json", { ...book, id: "other" });
    const { violations } = buildContent({ contentDir, outDir });
    expect(violations).toMatchObject([{ rule: "hymnbook-id" }]);
  });

  it("does not leave the package behind when a source file is malformed", () => {
    seed();
    write("0003.json", readFileSync(join(contentDir, "0001.json"), "utf8").slice(0, 20));
    const result = buildContent({ contentDir, outDir });
    expect(result.violations.length).toBeGreaterThan(0);
    expect(existsSync(join(outDir, `${BOOK_ID}.sqlite`))).toBe(false);
  });
});
