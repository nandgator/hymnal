import hymnSchema from "../schema/1/hymn.schema.json" with { type: "json" };
import hymnbookSchema from "../schema/1/hymnbook.schema.json" with { type: "json" };
import type { Hymnbook, PartKind } from "./types.ts";

export interface Violation {
  /** Short rule id: I1-I7 from SDD-0001 §4, or a pipeline rule name. */
  rule: string;
  /** What it concerns, e.g. "hymn 156" or "hymnbook". */
  where: string;
  message: string;
}

export interface HymnFile {
  file: string;
  hymn: unknown;
}

/** The content format this reader accepts, and the only one (SDD-0002 §5). */
export const CONTENT_FORMAT = 1;

/**
 * Every field of format 1, by level, read from its JSON Schema: the schema is
 * the one definition of which fields exist (ADR-0022). Anything else is a
 * violation. Everything else is checked here.
 */
const fields = (schema: { properties: object }) => Object.keys(schema.properties);
const HYMNBOOK_FIELDS = fields(hymnbookSchema);
const HYMN_FIELDS = fields(hymnSchema);
const PART_FIELDS = fields(hymnSchema.$defs.part);
const ENTRY_FIELDS = fields(hymnSchema.$defs.entry);
const META_FIELDS = fields(hymnSchema.$defs.meta);
/** Also the schema's; schema.test.ts checks it against `PartKind`. */
export const PART_KINDS = hymnSchema.$defs.part.properties.kind.enum as readonly PartKind[];

export const hymnFileName = (number: number) => `${String(number).padStart(4, "0")}.json`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

type Add = (rule: string, message: string) => void;

/** Flags fields format 1 doesn't define: never ignored, since ignoring drops content. */
function checkFields(record: Record<string, unknown>, known: string[], path: string, add: Add) {
  for (const key of Object.keys(record)) {
    if (!known.includes(key)) {
      add("unknown-field", `${path}${key} is not a field of format ${CONTENT_FORMAT}`);
    }
  }
}

/** Optional fields may be absent, but present ones must be strings. */
function checkOptionalStrings(
  record: Record<string, unknown>,
  keys: string[],
  path: string,
  add: Add,
) {
  for (const key of keys) {
    if (key in record && typeof record[key] !== "string") {
      add("shape", `${path}${key} must be a string`);
    }
  }
}

/** Checks one hymn from source. Returns every violation; never repairs or throws. */
export function validateHymn(input: unknown, where = "hymn"): Violation[] {
  const out: Violation[] = [];
  const add: Add = (rule, message) => out.push({ rule, where, message });

  if (!isRecord(input)) return [{ rule: "shape", where, message: "hymn is not an object" }];
  checkFields(input, HYMN_FIELDS, "", add);
  checkOptionalStrings(input, ["$schema"], "", add);
  const { number, title, parts, sequence, meta } = input;
  if (typeof number === "number" && Number.isInteger(number) && number > 0) {
    where = `hymn ${number}`;
  } else {
    add("shape", "number must be a positive integer");
  }
  if (!isNonEmptyString(title)) add("shape", "title must be a non-empty string");
  if (!Array.isArray(parts)) add("shape", "parts must be an array");
  if (!Array.isArray(sequence)) add("shape", "sequence must be an array");
  if (!isRecord(meta)) add("shape", "meta must be an object");
  if (!Array.isArray(parts) || !Array.isArray(sequence)) return relabel(out, where);

  const partIds: string[] = [];
  parts.forEach((part, i) => {
    if (!isRecord(part) || !isNonEmptyString(part.id)) {
      add("shape", `parts[${i}] needs a non-empty string id`);
      return;
    }
    partIds.push(part.id);
    checkFields(part, PART_FIELDS, `parts[${i}].`, add);
    checkOptionalStrings(part, ["label"], `parts[${i}].`, add);
    if (!PART_KINDS.includes(part.kind as PartKind)) {
      add("shape", `part ${part.id} has unknown kind ${JSON.stringify(part.kind)}`);
    }
    if (!Array.isArray(part.lines) || part.lines.some((l) => typeof l !== "string")) {
      add("shape", `part ${part.id} lines must be an array of strings`);
      return;
    }
    if (part.lines.length === 0) add("I4", `part ${part.id} has no lines`);
    part.lines.forEach((line: string, j: number) => {
      if (line.trim() === "") add("I6", `part ${part.id} line ${j} is empty after trimming`);
    });
  });

  for (const id of new Set(partIds.filter((id, i) => partIds.indexOf(id) !== i))) {
    add("I1", `part id ${id} is not unique`);
  }

  const referenced = new Set<string>();
  sequence.forEach((entry, i) => {
    if (!isRecord(entry) || !isNonEmptyString(entry.partId)) {
      add("shape", `sequence[${i}] needs a non-empty string partId`);
      return;
    }
    checkFields(entry, ENTRY_FIELDS, `sequence[${i}].`, add);
    referenced.add(entry.partId);
    if (!partIds.includes(entry.partId)) {
      add("I2", `sequence[${i}] references unknown part ${entry.partId}`);
    }
  });
  if (sequence.length === 0) add("I3", "sequence is empty");
  for (const id of new Set(partIds)) {
    if (!referenced.has(id)) add("I5", `part ${id} is never referenced by the sequence`);
  }

  if (isRecord(meta)) {
    checkFields(meta, META_FIELDS, "meta.", add);
    checkOptionalStrings(meta, META_FIELDS, "meta.", add);
  }
  return relabel(out, where);
}

const relabel = (violations: Violation[], where: string) =>
  violations.map((v) => ({ ...v, where }));

/** Checks a whole hymnbook directory: the metadata, every hymn, and cross-hymn rules. */
export function validateCorpus(
  hymnbook: unknown,
  files: HymnFile[],
  /** Told after each song, so a long check can show how far it has got. */
  onHymn?: (done: number, total: number) => void,
): Violation[] {
  const out: Violation[] = [];
  const add: Add = (rule, message) => out.push({ rule, where: "hymnbook", message });

  let expectedCount: number | undefined;
  if (!isRecord(hymnbook)) {
    add("shape", "hymnbook.json is not an object");
  } else {
    const { format } = hymnbook;
    if (typeof format !== "number" || !Number.isInteger(format)) {
      add("shape", "format must be an integer");
    } else if (format !== CONTENT_FORMAT) {
      // A book in another format is judged by rules this reader doesn't
      // know, so its other violations would only be noise.
      add("format", `the book is format ${format}; this reader knows format ${CONTENT_FORMAT}`);
      return out;
    }
    checkFields(hymnbook, HYMNBOOK_FIELDS, "", add);
    checkOptionalStrings(hymnbook, ["$schema", "publisher", "edition", "isbn"], "", add);
    for (const key of ["id", "title", "language", "script"] as const) {
      if (!isNonEmptyString(hymnbook[key])) add("shape", `${key} must be a non-empty string`);
    }
    const count = (hymnbook as Partial<Hymnbook>).hymnCount;
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
      expectedCount = count;
    } else {
      add("shape", "hymnCount must be an integer");
    }
  }

  const seen = new Map<number, string>();
  let checked = 0;
  for (const { file, hymn } of files) {
    out.push(...validateHymn(hymn, file));
    onHymn?.(++checked, files.length);
    const number = isRecord(hymn) ? hymn.number : undefined;
    if (typeof number !== "number") continue;
    if (file !== hymnFileName(number)) {
      out.push({
        rule: "file-name",
        where: `hymn ${number}`,
        message: `${file} should be named ${hymnFileName(number)}`,
      });
    }
    const first = seen.get(number);
    if (first === undefined) seen.set(number, file);
    else out.push({ rule: "I7", where: `hymn ${number}`, message: `also in ${first}` });
  }

  if (expectedCount !== undefined && files.length !== expectedCount) {
    out.push({
      rule: "hymn-count",
      where: "hymnbook",
      message: `hymnCount is ${expectedCount} but ${files.length} hymn files were found`,
    });
  }
  return out;
}
