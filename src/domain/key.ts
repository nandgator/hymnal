/**
 * A book's key: a UUIDv7 (RFC 9562), hand-written (SDD-0004 §5). 48 bits of
 * milliseconds since the epoch, version 7, variant 10, 74 random bits, as
 * lowercase hyphenated hex. A key is opaque and never parsed. The clock and
 * the random source are parameters so a test is deterministic.
 */
export function uuidv7(
  now: () => number = Date.now,
  fill: (bytes: Uint8Array<ArrayBuffer>) => void = (b) => {
    crypto.getRandomValues(b);
  },
): string {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(16);
  fill(bytes);
  let ms = Math.floor(now());
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
