// @vitest-environment node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hymnFileName } from "../src/domain/validate.ts";
import containerSchema from "../src/schema/1/container.schema.json" with { type: "json" };
import hymnSchema from "../src/schema/1/hymn.schema.json" with { type: "json" };
import hymnbookSchema from "../src/schema/1/hymnbook.schema.json" with { type: "json" };
import { loadContent } from "./build-content.ts";
import { gzipContainer, packBook } from "./pack.ts";

const ID = "pack-book";
const book = {
  $schema: "https://example.test/hymnbook.schema.json",
  format: 1,
  id: ID,
  title: "T",
  language: "ml",
  script: "Mlym",
  hymnCount: 3,
};
const hymn = (number: number) => ({
  number,
  title: `title ${number}`,
  parts: [
    { id: "c", kind: "chorus", lines: [`chorus ${number}`] },
    { id: "s1", kind: "stanza", label: "1", lines: [`a ${number}`, "b"] },
  ],
  sequence: [{ partId: "s1" }, { partId: "c" }],
  meta: { author: "A" },
});

let root: string;
let dir: string;
let out: string;
const write = (name: string, value: unknown) =>
  writeFileSync(join(dir, name), `${JSON.stringify(value)}\n`);
// Written out of order, to show the container sorts.
const seed = (numbers = [3, 1, 2]) => {
  write("hymnbook.json", book);
  for (const n of numbers) write(hymnFileName(n), hymn(n));
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pack-"));
  dir = join(root, ID);
  out = join(root, "out");
  mkdirSync(dir);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

// Pinned: fflate's deflate is fixed by bun.lock, so an upgrade that changes
// its output fails here (SDD-0004 §2) rather than silently changing hashes.
const GOLDEN_SHA256 = "00bc8d7010572239653971559eac6626c9005a05f0c7ebbbed97fc4f084103b2";

describe("packBook", () => {
  it("packs a fixed book to the golden sha256", () => {
    seed();
    const result = packBook(dir, out);
    if (!result.ok) throw new Error(JSON.stringify(result.violations));
    expect(result.sha256).toBe(GOLDEN_SHA256);
  });

  it("round-trips a directory to a container and back", () => {
    seed();
    const result = packBook(dir, out);
    if (!result.ok) throw new Error(JSON.stringify(result.violations));
    expect(result.outFile).toBe(join(out, `${ID}.hymnbook.json.gz`));
    expect(result.songs).toBe(3);
    const doc = JSON.parse(gunzipSync(readFileSync(result.outFile)).toString("utf8"));
    expect(Object.keys(doc)).toEqual(["hymnbook", "hymns"]);
    const source = loadContent(dir);
    expect(doc.hymnbook).toEqual(source.hymnbook);
    expect(doc.hymns.map((h: { number: number }) => h.number)).toEqual([1, 2, 3]);
    expect(doc.hymns).toEqual(
      [...source.files].sort((a, b) => a.file.localeCompare(b.file)).map((f) => f.hymn),
    );
  });

  it("writes a document the container schema accepts", () => {
    seed();
    const ajv = new Ajv2020({ allErrors: true });
    ajv.addSchema(hymnbookSchema, "hymnbook.schema.json");
    ajv.addSchema(hymnSchema, "hymn.schema.json");
    const validate = ajv.compile(containerSchema);
    const result = packBook(dir, out);
    if (!result.ok) throw new Error(JSON.stringify(result.violations));
    const doc = JSON.parse(gunzipSync(readFileSync(result.outFile)).toString("utf8"));
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
  });

  it("packs the same book to the same bytes, with a bare gzip header", () => {
    seed();
    const first = packBook(dir, out);
    const second = packBook(dir, join(root, "out2"));
    if (!first.ok || !second.ok) throw new Error("expected both to pack");
    expect(second.sha256).toBe(first.sha256);
    expect(Buffer.from(second.bytes).equals(Buffer.from(first.bytes))).toBe(true);
    const bytes = first.bytes;
    expect([...bytes.slice(0, 4)]).toEqual([0x1f, 0x8b, 8, 0]); // no name or comment flag
    expect([...bytes.slice(4, 8)]).toEqual([0, 0, 0, 0]); // no timestamp
    expect(bytes[9]).toBe(255); // OS: unknown
    expect(gzipContainer("x")).toEqual(gzipContainer("x"));
  });

  it("writes compact JSON with the files verbatim, $schema included", () => {
    seed();
    const result = packBook(dir, out);
    if (!result.ok) throw new Error(JSON.stringify(result.violations));
    const text = gunzipSync(result.bytes).toString("utf8");
    expect(text).not.toMatch(/\n|: |, /);
    const doc = JSON.parse(text);
    expect(doc.hymnbook.$schema).toBe(book.$schema);
    expect(text).toBe(JSON.stringify({ hymnbook: book, hymns: [1, 2, 3].map(hymn) }));
  });

  it("refuses a book with violations, lists every one, and writes nothing", () => {
    write("hymnbook.json", { ...book, hymnCount: 5 });
    write(hymnFileName(1), hymn(1));
    write(hymnFileName(2), { ...hymn(2), sequence: [{ partId: "zz" }] });
    writeFileSync(join(dir, "0003.json"), "{ not json");
    const result = packBook(dir, out);
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
    expect(result.violations.map((v) => v.rule)).toEqual(
      expect.arrayContaining(["parse", "hymn-count"]),
    );
    expect(result.ok).toBe(false);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses an id that does not match its directory", () => {
    write("hymnbook.json", { ...book, id: "other", hymnCount: 1 });
    write(hymnFileName(1), hymn(1));
    const result = packBook(dir, out);
    expect(result.violations.map((v) => v.rule)).toContain("hymnbook-id");
    expect(existsSync(out)).toBe(false);
  });

  it("makes a missing output directory", () => {
    seed();
    const nested = join(root, "a", "b");
    expect(packBook(dir, nested).ok).toBe(true);
    expect(existsSync(join(nested, `${ID}.hymnbook.json.gz`))).toBe(true);
  });
});

describe("bun run pack", () => {
  const script = join(import.meta.dirname, "pack.ts");
  const run = (cwd: string, ...args: string[]) =>
    spawnSync("bun", [script, ...args], { cwd, encoding: "utf8" });

  it("defaults to imports/ under the working directory and prints one line", () => {
    seed();
    const r = run(root, dir);
    expect(r.status).toBe(0);
    const file = join(root, "imports", `${ID}.hymnbook.json.gz`);
    expect(existsSync(file)).toBe(true);
    expect(r.stdout.trim()).toMatch(
      new RegExp(
        `^packed imports/${ID}\\.hymnbook\\.json\\.gz: 3 songs, [\\d.]+ KB, sha256 [0-9a-f]{64}$`,
      ),
    );
  });

  it("honours --out", () => {
    seed();
    const r = run(root, dir, "--out", "elsewhere");
    expect(r.status).toBe(0);
    expect(existsSync(join(root, "elsewhere", `${ID}.hymnbook.json.gz`))).toBe(true);
    expect(existsSync(join(root, "imports"))).toBe(false);
  });

  it("exits non-zero on a violation and writes nothing", () => {
    seed();
    write("hymnbook.json", { ...book, hymnCount: 9 });
    const r = run(root, dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("hymn-count");
    expect(existsSync(join(root, "imports"))).toBe(false);
  });

  it("prints usage and exits 1 with no directory", () => {
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage:");
  });

  it("refuses extra positionals with usage", () => {
    seed();
    const r = run(root, dir, dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage:");
    expect(existsSync(join(root, "imports"))).toBe(false);
  });

  it("prints usage and exits 0 for --help", () => {
    const r = run(root, "--help");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });

  it("gives a one-line error and exit 1 for a missing directory", () => {
    const r = run(root, join(root, "nope"));
    expect(r.status).toBe(1);
    expect(r.stderr.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain("not a directory");
    expect(r.stderr).not.toMatch(/\bat \S+ \(|node:internal|Error:/);
  });

  it("packs to the same bytes under bun as under node, matching the golden", () => {
    seed();
    const r = run(root, dir);
    expect(r.stdout).toContain(`sha256 ${GOLDEN_SHA256}`);
    const viaBun = readFileSync(join(root, "imports", `${ID}.hymnbook.json.gz`));
    const viaNode = packBook(dir, out);
    if (!viaNode.ok) throw new Error("expected to pack");
    expect(Buffer.from(viaNode.bytes).equals(viaBun)).toBe(true);
  });
});
