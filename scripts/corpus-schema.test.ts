import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import hymnSchema from "../public/schema/1/hymn.schema.json" with { type: "json" };
import hymnbookSchema from "../public/schema/1/hymnbook.schema.json" with { type: "json" };

/** The committed corpus follows the published schema (ADR-0022), every file. */
describe("the committed corpus", () => {
  const ajv = new Ajv2020({ allErrors: true });
  const accepts = { hymnbook: ajv.compile(hymnbookSchema), hymn: ajv.compile(hymnSchema) };
  const root = join(import.meta.dirname, "..", "content");

  it.each(readdirSync(root))("%s follows the schema", (dir) => {
    const names = readdirSync(join(root, dir));
    expect(names).toContain("hymnbook.json");
    for (const name of names) {
      const value = JSON.parse(readFileSync(join(root, dir, name), "utf8"));
      const check = name === "hymnbook.json" ? accepts.hymnbook : accepts.hymn;
      expect(check(value), `${name}: ${ajv.errorsText(check.errors)}`).toBe(true);
    }
  });
});
