import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LegacyHymn } from "./legacy-convert.ts";
import { hymnFileName, migrate } from "./migrate-legacy.ts";

const hymnbook = {
  id: "test-book",
  title: "Test",
  language: "ml",
  script: "Mlym",
  hymnCount: 2,
};

const legacy = (id: number, overrides: Partial<LegacyHymn> = {}): LegacyHymn => ({
  id,
  author: "",
  starts: "chorus",
  chorus: ["c"],
  bridge: [],
  verses: [["v"]],
  ...overrides,
});

let root: string;
let outDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "migrate-"));
  outDir = join(root, "content", "test-book");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("hymnFileName", () => {
  it("pads to four digits", () => {
    expect(hymnFileName(7)).toBe("0007.json");
    expect(hymnFileName(1631)).toBe("1631.json");
  });
});

describe("migrate", () => {
  it("writes the hymnbook and one file per hymn, and reports", () => {
    const report = migrate({ outDir, hymnbook, legacy: [legacy(2), legacy(1)] });

    expect(readdirSync(outDir).sort()).toEqual(["0001.json", "0002.json", "hymnbook.json"]);
    expect(JSON.parse(readFileSync(join(outDir, "hymnbook.json"), "utf8"))).toEqual(hymnbook);

    const hymn = JSON.parse(readFileSync(join(outDir, "0001.json"), "utf8"));
    expect(hymn).toMatchObject({ number: 1, title: "c" });
    expect(hymn).not.toHaveProperty("hymnbookId");
    expect(report.total).toBe(2);
    expect(existsSync(`${outDir}.partial`)).toBe(false);
  });

  it("refuses to run when the output directory exists, leaving it untouched", () => {
    mkdirSync(outDir, { recursive: true });
    expect(() => migrate({ outDir, hymnbook, legacy: [legacy(1), legacy(2)] })).toThrow(
      /refusing to run/,
    );
    expect(readdirSync(outDir)).toEqual([]);
  });

  it("writes nothing when any hymn fails to convert", () => {
    const bad = legacy(2, { bridge: ["x"] });
    expect(() => migrate({ outDir, hymnbook, legacy: [legacy(1), bad] })).toThrow(/hymn 2/);
    expect(existsSync(outDir)).toBe(false);
    expect(existsSync(`${outDir}.partial`)).toBe(false);
  });

  it("rejects duplicate hymn numbers", () => {
    expect(() => migrate({ outDir, hymnbook, legacy: [legacy(1), legacy(1)] })).toThrow(
      /duplicate/,
    );
  });

  it("rejects a hymn count that disagrees with the hymnbook", () => {
    expect(() => migrate({ outDir, hymnbook, legacy: [legacy(1)] })).toThrow(/expected 2/);
  });
});
