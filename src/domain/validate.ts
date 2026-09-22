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

const PART_KINDS: readonly PartKind[] = ["stanza", "refrain", "bridge", "tag"];
const STORED_META = ["author", "tune", "meter"];

export const hymnFileName = (number: number) => `${String(number).padStart(4, "0")}.json`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Checks one hymn from source. Returns every violation; never repairs or throws. */
export function validateHymn(input: unknown, where = "hymn"): Violation[] {
  const out: Violation[] = [];
  const add = (rule: string, message: string) => out.push({ rule, where, message });

  if (!isRecord(input)) return [{ rule: "shape", where, message: "hymn is not an object" }];
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
    for (const key of Object.keys(meta)) {
      if (!STORED_META.includes(key)) {
        add("unsupported-meta", `meta.${key} cannot be stored by the current schema`);
      }
    }
  }
  return out;
}

const relabel = (violations: Violation[], where: string) =>
  violations.map((v) => ({ ...v, where }));

/** Checks a whole hymnbook directory: the metadata, every hymn, and cross-hymn rules. */
export function validateCorpus(hymnbook: unknown, files: HymnFile[]): Violation[] {
  const out: Violation[] = [];

  let expectedCount: number | undefined;
  if (!isRecord(hymnbook)) {
    out.push({ rule: "shape", where: "hymnbook", message: "hymnbook.json is not an object" });
  } else {
    for (const key of ["id", "title", "language", "script"] as const) {
      if (!isNonEmptyString(hymnbook[key])) {
        out.push({
          rule: "shape",
          where: "hymnbook",
          message: `${key} must be a non-empty string`,
        });
      }
    }
    const count = (hymnbook as Partial<Hymnbook>).hymnCount;
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
      expectedCount = count;
    } else {
      out.push({ rule: "shape", where: "hymnbook", message: "hymnCount must be an integer" });
    }
  }

  const seen = new Map<number, string>();
  for (const { file, hymn } of files) {
    out.push(...validateHymn(hymn, file));
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
