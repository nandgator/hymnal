// @vitest-environment node
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import containerSchema from "../../public/schema/1/container.schema.json" with { type: "json" };
import hymnSchema from "../../public/schema/1/hymn.schema.json" with { type: "json" };
import hymnbookSchema from "../../public/schema/1/hymnbook.schema.json" with { type: "json" };
import type { PartKind } from "./types.ts";
import { PART_KINDS, validateCorpus, validateHymn } from "./validate.ts";

/**
 * The published schema and validate.ts must agree (ADR-0022): on every file
 * here, both accept or both reject. The schema can't express the rules that
 * span a document, so those are validate.ts's alone, and tested as such.
 */
const ajv = new Ajv2020({ allErrors: true });
// Keyed by file name: the schemas refer to each other by relative path.
ajv.addSchema(hymnbookSchema, "hymnbook.schema.json");
ajv.addSchema(hymnSchema, "hymn.schema.json");
const added = (key: string) => {
  const validate = ajv.getSchema(key);
  if (!validate) throw new Error(`schema ${key} was not added`);
  return validate;
};
const schemaAccepts = {
  hymnbook: added("hymnbook.schema.json"),
  hymn: added("hymn.schema.json"),
  container: ajv.compile(containerSchema),
};

const hymn = (overrides: Record<string, unknown> = {}) => ({
  number: 1,
  title: "First line",
  parts: [
    { id: "c", kind: "chorus", lines: ["chorus"] },
    { id: "s1", kind: "stanza", label: "1", lines: ["stanza"] },
  ],
  sequence: [{ partId: "s1" }, { partId: "c" }],
  meta: { author: "KVS" },
  ...overrides,
});
const book = (overrides: Record<string, unknown> = {}) => ({
  format: 1,
  id: "b",
  title: "T",
  language: "ml",
  script: "Mlym",
  hymnCount: 1,
  ...overrides,
});
const withPart = (part: Record<string, unknown>) =>
  hymn({
    parts: [{ id: "s1", kind: "stanza", lines: ["a"], ...part }],
    sequence: [{ partId: "s1" }],
  });

const validAccepts = {
  hymn: (h: unknown) => validateHymn(h).length === 0,
  hymnbook: (b: unknown) => validateCorpus(b, [{ file: "0001.json", hymn: hymn() }]).length === 0,
};

describe("the schema and validate.ts agree", () => {
  const hymns: [string, unknown][] = [
    ["a valid hymn", hymn()],
    ["one naming its schema", hymn({ $schema: "../../public/schema/1/hymn.schema.json" })],
    ["no metadata", hymn({ meta: {} })],
    ["an unknown field", hymn({ tags: [] })],
    ["an unknown part field", withPart({ chords: [] })],
    [
      "an unknown sequence field",
      hymn({ sequence: [{ partId: "s1", times: 2 }, { partId: "c" }] }),
    ],
    ["unknown metadata", hymn({ meta: { topics: ["x"] } })],
    ["a non-string $schema", hymn({ $schema: 1 })],
    ["a non-string label", withPart({ label: 1 })],
    ["non-string metadata", hymn({ meta: { author: null } })],
    ["a missing title", hymn({ title: undefined })],
    ["a blank title", hymn({ title: "  " })],
    ["number 0", hymn({ number: 0 })],
    ["a fractional number", hymn({ number: 1.5 })],
    ["an unknown kind", withPart({ kind: "verse" })],
    ["a part with no lines (I4)", withPart({ lines: [] })],
    ["a blank line (I6)", withPart({ lines: ["a", " "] })],
    ["an empty sequence (I3)", hymn({ sequence: [] })],
    ["no meta object", hymn({ meta: undefined })],
  ];
  it.each(hymns)("hymn: %s", (_, h) => {
    const json = JSON.parse(JSON.stringify(h));
    expect(schemaAccepts.hymn(json)).toBe(validAccepts.hymn(json));
  });

  const books: [string, unknown][] = [
    ["a valid book", book()],
    ["one naming its schema", book({ $schema: "hymnbook.schema.json" })],
    ["optional fields", book({ publisher: "P", edition: "16th", isbn: "978" })],
    ["an unknown field", book({ region: "IN" })],
    ["a non-string isbn", book({ isbn: 978 })],
    ["format 2", book({ format: 2 })],
    ["no format", book({ format: undefined })],
    ["a blank id", book({ id: "" })],
    ["a negative hymnCount", book({ hymnCount: -1 })],
  ];
  it.each(books)("hymnbook: %s", (_, b) => {
    const json = JSON.parse(JSON.stringify(b));
    expect(schemaAccepts.hymnbook(json)).toBe(validAccepts.hymnbook(json));
  });
});

describe("rules only validate.ts can check", () => {
  it.each([
    ["duplicate part ids (I1)", hymn({ parts: [...hymn().parts, hymn().parts[0]] })],
    ["a sequence entry naming no part (I2)", hymn({ sequence: [{ partId: "x" }] })],
    ["a part never sung (I5)", hymn({ sequence: [{ partId: "s1" }] })],
  ])("%s: the schema accepts it, validate.ts doesn't", (_, h) => {
    expect(schemaAccepts.hymn(h)).toBe(true);
    expect(validAccepts.hymn(h)).toBe(false);
  });
});

describe("part kinds", () => {
  it("are the schema's, each one a PartKind", () => {
    // A Record makes the compiler demand every PartKind here, and no other.
    const kinds: Record<PartKind, true> = {
      intro: true,
      stanza: true,
      "pre-chorus": true,
      chorus: true,
      "post-chorus": true,
      bridge: true,
      outro: true,
      tag: true,
    };
    expect([...PART_KINDS].sort()).toEqual(Object.keys(kinds).sort());
  });

  it.each(PART_KINDS)("%s is accepted by both", (kind) => {
    const h = withPart({ kind });
    expect(schemaAccepts.hymn(h)).toBe(true);
    expect(validAccepts.hymn(h)).toBe(true);
  });
});

describe("the container schema", () => {
  it("accepts a whole book and checks each part against its own schema", () => {
    expect(schemaAccepts.container({ hymnbook: book(), hymns: [hymn()] })).toBe(true);
    expect(schemaAccepts.container({ hymnbook: book(), hymns: [hymn({ tags: [] })] })).toBe(false);
    expect(schemaAccepts.container({ hymnbook: book({ format: 2 }), hymns: [] })).toBe(false);
  });
});
