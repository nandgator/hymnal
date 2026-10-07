// @vitest-environment node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packBook } from "./pack.ts";

const script = join(import.meta.dirname, "text.ts");
const BOOK = ["--id", "t-book", "--title", "T", "--language", "en", "--script", "Latn"];
const GOOD = "1. One\n\nfirst a\nfirst b\n\nChorus:\nsing\n---\n2. Two\n\nsecond a\n";

let root: string;
let out: string;
const file = (name: string, text: string) => {
  const path = join(root, name);
  writeFileSync(path, text);
  return path;
};
const run = (...args: string[]) =>
  spawnSync("bun", [script, ...args], { cwd: root, encoding: "utf8" });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "text-"));
  out = join(root, "out");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("bun run text", () => {
  it("prints usage and exits 1 with no arguments", () => {
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Usage: bun run text");
  });

  it("writes a format 1 directory that pack accepts", () => {
    const r = run(file("a.txt", GOOD), ...BOOK, "--out", out);
    expect(r.status).toBe(0);
    const dir = join(out, "t-book");
    expect(readdirSync(dir).sort()).toEqual(["0001.json", "0002.json", "hymnbook.json"]);
    expect(JSON.parse(readFileSync(join(dir, "hymnbook.json"), "utf8")).hymnCount).toBe(2);
    expect(JSON.parse(readFileSync(join(dir, "0001.json"), "utf8")).sequence).toEqual([
      { partId: "s1" },
      { partId: "c1" },
    ]);
    const packed = packBook(dir, join(root, "packed"));
    expect(packed.ok).toBe(true);
  });

  it("lists every error with its line number, exits 1 and writes nothing", () => {
    const path = file("bad.txt", "1. One\n\nChrous:\nx\n---\n1. Dup\n\ny\n");
    const r = run(path, ...BOOK, "--out", out);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("2 error(s), nothing written");
    expect(r.stderr).toContain(`${path}:3:`);
    expect(r.stderr).toContain(`${path}:6: number 1 is also used on line 1`);
    expect(existsSync(out)).toBe(false);
  });

  it("asks for the book's fields rather than guessing them", () => {
    const r = run(file("a.txt", GOOD), "--out", out);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--id, --title, --language, --script");
    expect(existsSync(out)).toBe(false);
  });

  it("takes --number for a single song with none on its first line", () => {
    const r = run(file("a.txt", "Only\n\nline\n"), ...BOOK, "--out", out, "--number", "5");
    expect(r.status).toBe(0);
    expect(existsSync(join(out, "t-book", "0005.json"))).toBe(true);
  });

  it("replaces a previous run's songs and nothing else", () => {
    run(file("a.txt", GOOD), ...BOOK, "--out", out);
    writeFileSync(join(out, "t-book", "HAND-FIXES.md"), "keep");
    const r = run(file("b.txt", "1. One\n\nonly\n"), ...BOOK, "--out", out);
    expect(r.status).toBe(0);
    expect(readdirSync(join(out, "t-book")).sort()).toEqual([
      "0001.json",
      "HAND-FIXES.md",
      "hymnbook.json",
    ]);
  });

  it("prints usage and exits 0 for --help", () => {
    const r = run("--help");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage: bun run text");
  });

  it("refuses a missing text file", () => {
    expect(run(join(root, "nope.txt"), ...BOOK, "--out", out).stderr).toContain("no such file");
    expect(existsSync(out)).toBe(false);
  });

  it.each(["0", "1e3", "-2", "1.5", "abc"])("refuses --number %s", (n) => {
    const r = run(file("a.txt", "Only\n\nline\n"), ...BOOK, "--out", out, "--number", n);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--number");
    expect(existsSync(out)).toBe(false);
  });

  it("refuses an --id that is not a plain slug", () => {
    const args = ["--title", "T", "--language", "en", "--script", "Latn", "--out", out];
    const r = run(file("a.txt", GOOD), "--id", "../x", ...args);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("--id");
  });

  it("lists the validator's violations, exits 1 and writes nothing", () => {
    // a book that fails the corpus rules: an empty language
    const r = run(
      file("a.txt", GOOD),
      "--id",
      "t-book",
      "--title",
      "T",
      "--language",
      " ",
      "--script",
      "Latn",
      "--out",
      out,
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("violation(s), nothing written");
    expect(existsSync(out)).toBe(false);
  });

  it("refuses a directory that holds an import draft unless --force", () => {
    mkdirSync(join(out, "t-book"), { recursive: true });
    writeFileSync(join(out, "t-book", "report.md"), "draft");
    const r = run(file("a.txt", GOOD), ...BOOK, "--out", out);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("import draft");
    expect(existsSync(join(out, "t-book", "0001.json"))).toBe(false);
    expect(run(file("a.txt", GOOD), ...BOOK, "--out", out, "--force").status).toBe(0);
  });
});
