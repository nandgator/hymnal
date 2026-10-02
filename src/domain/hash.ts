import type { HymnSource } from "./types.ts";

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

/** SHA-256 of bytes or text (UTF-8), as lowercase hex. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return toHex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

/** The source hash: SHA-256 of a container file's bytes (SDD-0004 §4). */
export const sourceHash = (bytes: Uint8Array) => sha256Hex(bytes);

/** NFC, runs of whitespace to one space, ends trimmed. */
export const normalise = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

/**
 * The text a song hash is taken of (SDD-0004 §4): title, parts without ids,
 * the sequence as part positions, and author, tune, meter. The number and
 * `$schema` are left out; absent fields read as "".
 */
export function canonicalSong(hymn: HymnSource): string {
  const index = new Map<string, number>();
  hymn.parts.forEach((p, i) => {
    if (!index.has(p.id)) index.set(p.id, i);
  });
  const meta = hymn.meta ?? {};
  return JSON.stringify([
    normalise(hymn.title),
    hymn.parts.map((p) => [p.kind, normalise(p.label ?? ""), p.lines.map(normalise)]),
    hymn.sequence.map((e) => index.get(e.partId) ?? -1),
    [meta.author ?? "", meta.tune ?? "", meta.meter ?? ""].map(normalise),
  ]);
}

/** SHA-256, hex, of a song's canonical form. Expects a validated hymn. */
export const songHash = (hymn: HymnSource) => sha256Hex(canonicalSong(hymn));

/** Song hashes by hymn number. */
export type SongHashes = ReadonlyMap<number, string>;

/** "Same songs" (SDD-0004 §4): the same numbers, an equal hash at each. */
export function sameSongs(a: SongHashes, b: SongHashes): boolean {
  if (a.size !== b.size) return false;
  for (const [number, hash] of a) if (b.get(number) !== hash) return false;
  return true;
}
