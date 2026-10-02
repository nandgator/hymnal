/**
 * The container writer (SDD-0004 §2) as a pure function, so the app and `bun run
 * pack` write the same bytes: the same book is the same file, and so the same
 * source hash, on any machine and runtime. No Node or DOM import.
 */
import { gzipSync } from "fflate";

/**
 * Gzip at level 9 with fflate (pure JS, its version pinned by bun.lock, so the
 * deflate body is the same on Bun, Node and any machine; node:zlib's differs
 * between runtimes). No timestamp, no file name, and the OS byte is set to 255
 * ("unknown"), which fflate otherwise sets to Unix (SDD-0004 §2).
 */
export function gzipContainer(text: string): Uint8Array {
  const bytes = gzipSync(new TextEncoder().encode(text), { level: 9, mtime: 0 });
  bytes[9] = 255;
  return bytes;
}

/** A book as a container file: hymns in number order, compact JSON, gzipped. */
export function containerBytes(
  hymnbook: unknown,
  hymns: ReadonlyArray<{ number: number }>,
): Uint8Array {
  const sorted = [...hymns].sort((a, b) => a.number - b.number);
  return gzipContainer(JSON.stringify({ hymnbook, hymns: sorted }));
}
