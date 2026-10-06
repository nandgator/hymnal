import { type SongHashes, songHash, sourceHash } from "./hash.ts";
import type { OnLoadProgress } from "./progress.ts";
import type { HymnbookSource, HymnSource } from "./types.ts";
import { CONTENT_FORMAT, hymnFileName, type Violation, validateCorpus } from "./validate.ts";

/** Inflated size past which a file is refused (SDD-0004 §3): a guard, not a limit on books. */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

export interface ContainerBook {
  hymnbook: HymnbookSource;
  hymns: HymnSource[];
}

/**
 * What reading a container gives (SDD-0004 §3). `sourceHash` is always there,
 * taken before anything else. A rejected file has violations, all of them,
 * and nothing repaired; an accepted one has the book and a hash per song.
 */
export type ContainerRead =
  | { ok: true; sourceHash: string; book: ContainerBook; songHashes: SongHashes }
  | { ok: false; sourceHash: string; violations: Violation[] };

const refuse = (hash: string, rule: string, message: string): ContainerRead => ({
  ok: false,
  sourceHash: hash,
  violations: [{ rule, where: "file", message }],
});

const NOT_CONTAINER = "not a hymnbook container";

/** Gunzips to text; null when it fails to decompress or inflates past the ceiling. */
async function gunzip(bytes: Uint8Array, ceiling: number): Promise<string | null> {
  try {
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ceiling) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(all);
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Songs hashed together before the next report: one await each, not one per song. */
const HASH_BATCH = 100;

/**
 * A hash per song, in batches, so the count moves and the worker answers its
 * other messages between them.
 */
export async function hashSongs(
  hymns: readonly HymnSource[],
  onProgress?: OnLoadProgress,
): Promise<Map<number, string>> {
  const hashes: string[] = [];
  const total = hymns.length;
  onProgress?.({ phase: "hashing", done: 0, total });
  for (let at = 0; at < total; at += HASH_BATCH) {
    hashes.push(...(await Promise.all(hymns.slice(at, at + HASH_BATCH).map(songHash))));
    onProgress?.({ phase: "hashing", done: hashes.length, total });
  }
  return new Map(hymns.map((h, i) => [h.number, hashes[i]] as const));
}

/**
 * Reads a container file's bytes: gunzip, parse, shape, validate, hash. Never
 * throws. `onProgress` hears the phases (SDD-0004 §14): reading, then each
 * song checked, then each song hashed.
 */
export async function readContainer(
  bytes: Uint8Array,
  ceiling = MAX_INFLATED_BYTES,
  onProgress?: OnLoadProgress,
): Promise<ContainerRead> {
  onProgress?.({ phase: "reading", done: 0, total: 0 });
  const hash = await sourceHash(bytes);
  const text = await gunzip(bytes, ceiling);
  if (text === null) return refuse(hash, "container", NOT_CONTAINER);

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return refuse(hash, "container", `${NOT_CONTAINER}: not JSON`);
  }
  if (!isRecord(doc) || !("hymnbook" in doc) || !Array.isArray(doc.hymns)) {
    return refuse(hash, "container", `${NOT_CONTAINER}: needs hymnbook and a hymns array`);
  }
  const extra = Object.keys(doc).filter((k) => k !== "hymnbook" && k !== "hymns");
  if (extra.length > 0) {
    return refuse(hash, "container", `${NOT_CONTAINER}: unknown key ${extra.join(", ")}`);
  }

  // A container has no file names; synthesise the ones a directory would have.
  const files = doc.hymns.map((hymn: unknown, i) => ({
    file:
      isRecord(hymn) && Number.isInteger(hymn.number) && typeof hymn.number === "number"
        ? hymnFileName(hymn.number)
        : `hymns[${i}]`,
    hymn,
  }));
  const violations = validateCorpus(
    doc.hymnbook,
    files,
    onProgress && ((done, total) => onProgress({ phase: "checking", done, total })),
  );
  if (violations.length > 0) {
    // A newer format reads "needs a newer app", naming both versions (ADR-0019).
    const format = isRecord(doc.hymnbook) ? doc.hymnbook.format : undefined;
    const newer = typeof format === "number" && format > CONTENT_FORMAT;
    return {
      ok: false,
      sourceHash: hash,
      violations: newer
        ? violations.map((v) =>
            v.rule === "format"
              ? {
                  ...v,
                  message: `this book needs a newer app: it is format ${format}; this app reads format ${CONTENT_FORMAT}`,
                }
              : v,
          )
        : violations,
    };
  }

  const book = { hymnbook: doc.hymnbook as HymnbookSource, hymns: doc.hymns as HymnSource[] };
  const songHashes = await hashSongs(book.hymns, onProgress);
  return { ok: true, sourceHash: hash, book, songHashes };
}
