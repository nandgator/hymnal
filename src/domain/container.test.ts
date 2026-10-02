// @vitest-environment node
// Node (as Bun, workers and browsers do) has DecompressionStream and crypto.subtle;
// jsdom, the default here, is not needed for pure domain code.
import { describe, expect, it, vi } from "vitest";
import { MAX_INFLATED_BYTES, readContainer } from "./container.ts";
import { canonicalSong, sameSongs, sha256Hex, songHash } from "./hash.ts";
import { uuidv7 } from "./key.ts";
import type { HymnSource } from "./types.ts";
import { hymnFileName, validateCorpus } from "./validate.ts";

async function gzip(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function hymn(number: number, overrides: Partial<HymnSource> = {}): HymnSource {
  return {
    number,
    title: `Title ${number}`,
    parts: [
      { id: "c", kind: "chorus", lines: ["chorus line"] },
      { id: "s1", kind: "stanza", label: "1", lines: ["first line", "second line"] },
    ],
    sequence: [{ partId: "s1" }, { partId: "c" }],
    meta: { author: "A. Writer" },
    ...overrides,
  };
}

function book(hymns: unknown[], hymnbook: Record<string, unknown> = {}) {
  return {
    hymnbook: {
      id: "sample",
      title: "Sample",
      language: "en",
      script: "Latn",
      format: 1,
      hymnCount: hymns.length,
      ...hymnbook,
    },
    hymns,
  };
}

const pack = (doc: unknown) => gzip(JSON.stringify(doc));

describe("readContainer", () => {
  it("reads a valid book to a source hash, the book and a hash per song", async () => {
    const bytes = await pack(book([hymn(1), hymn(12)]));
    const read = await readContainer(bytes);
    if (!read.ok) throw new Error(JSON.stringify(read.violations));
    expect(read.sourceHash).toBe(await sha256Hex(bytes));
    expect(read.book.hymns).toHaveLength(2);
    expect([...read.songHashes.keys()]).toEqual([1, 12]);
    expect(read.songHashes.get(1)).toBe(await songHash(hymn(1)));
  });

  it("refuses a file that is not gzip", async () => {
    const read = await readContainer(new TextEncoder().encode(JSON.stringify(book([hymn(1)]))));
    expect(read.ok).toBe(false);
    expect(!read.ok && read.violations[0].message).toMatch(/not a hymnbook container/);
  });

  it("enforces the ceiling while streaming, stopping early", async () => {
    const size = 64 * 1024 * 1024;
    const ceiling = 1024 * 1024;
    const bytes = await gzip(new Uint8Array(size));
    expect(bytes.byteLength).toBeLessThan(size / 100);
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, "cancel");
    const reads = vi.spyOn(ReadableStreamDefaultReader.prototype, "read");
    try {
      const refused = await readContainer(bytes, ceiling);
      expect(!refused.ok && refused.violations[0].message).toMatch(/not a hymnbook container/);
      expect(cancel).toHaveBeenCalled();
      // Chunks are small next to the 64 MB the stream would inflate to.
      expect(reads.mock.calls.length).toBeLessThan(1000);
    } finally {
      cancel.mockRestore();
      reads.mockRestore();
    }
    expect(MAX_INFLATED_BYTES).toBe(64 * 1024 * 1024);
    // Under the ceiling it gets past the size guard and fails later, as JSON.
    const under = await readContainer(await gzip(new Uint8Array(1024)));
    expect(!under.ok && under.violations[0].message).toMatch(/not JSON/);
  });

  it("refuses gzip that is not JSON, and JSON of the wrong shape", async () => {
    const notJson = await readContainer(await gzip("{nope"));
    expect(!notJson.ok && notJson.violations[0].message).toMatch(/not JSON/);
    for (const doc of [[], 3, { hymnbook: {} }, { hymns: [] }, { hymnbook: {}, hymns: {} }]) {
      const read = await readContainer(await pack(doc));
      expect(read.ok).toBe(false);
      expect(!read.ok && read.violations[0].rule).toBe("container");
    }
  });

  it("refuses gzip that is not UTF-8 text", async () => {
    const read = await readContainer(await gzip(new Uint8Array([0x7b, 0xff, 0xfe])));
    expect(!read.ok && read.violations[0].message).toMatch(/not a hymnbook container/);
  });

  it("judges odd numbers as a directory would (rules only)", async () => {
    for (const number of [1.5, -3, "7", undefined]) {
      const odd = { ...hymn(1), number };
      const doc = book([odd], { hymnCount: 1 });
      const read = await readContainer(await pack(doc));
      const directory = validateCorpus(doc.hymnbook, [
        { file: Number.isInteger(number) ? hymnFileName(number as number) : "odd.json", hymn: odd },
      ]);
      expect(read.ok).toBe(false);
      const rules = (vs: { rule: string }[]) => vs.map((v) => v.rule).sort();
      expect(rules(!read.ok ? read.violations : [])).toEqual(rules(directory));
      expect(directory.length).toBeGreaterThan(0);
    }
  });

  it("refuses an empty file", async () => {
    const read = await readContainer(new Uint8Array(0));
    expect(!read.ok && read.violations[0].message).toMatch(/not a hymnbook container/);
  });

  it("refuses an unknown top-level key", async () => {
    const read = await readContainer(await pack({ ...book([hymn(1)]), extra: 1 }));
    expect(!read.ok && read.violations[0].message).toMatch(/unknown key extra/);
  });

  it("refuses a newer format, naming both versions", async () => {
    const read = await readContainer(await pack(book([hymn(1)], { format: 2 })));
    expect(read.ok).toBe(false);
    const messages = !read.ok ? read.violations.map((v) => v.message).join() : "";
    expect(messages).toMatch(/needs a newer app/);
    expect(messages).toMatch(/format 2/);
    expect(messages).toMatch(/format 1/);
  });

  it("lists every violation and repairs none", async () => {
    const bad = hymn(3, { title: "" });
    const empty = hymn(4, { parts: [], sequence: [] });
    const read = await readContainer(
      await pack(book([hymn(1), bad, empty, { title: "no number" }], { hymnCount: 9 })),
    );
    expect(read.ok).toBe(false);
    if (read.ok) return;
    const rules = read.violations.map((v) => v.rule);
    expect(rules).toContain("I3");
    expect(rules).toContain("hymn-count");
    expect(read.violations.filter((v) => v.rule === "shape").length).toBeGreaterThanOrEqual(2);
    expect(read.violations.some((v) => v.where === "hymns[3]")).toBe(true);
    expect(read.violations.some((v) => v.where === "hymn 3")).toBe(true);
  });

  it("synthesises file names a directory would accept, and flags duplicate numbers", async () => {
    const ok = await readContainer(await pack(book([hymn(1), hymn(10000)])));
    expect(ok.ok).toBe(true);
    const dup = await readContainer(await pack(book([hymn(1), hymn(1)])));
    expect(!dup.ok && dup.violations.map((v) => v.rule)).toContain("I7");
  });

  it("flags unknown fields, and synthesis never trips the file-name rule", async () => {
    const read = await readContainer(await pack(book([{ ...hymn(1), surprise: true }])));
    expect(!read.ok && read.violations.map((v) => v.rule)).toEqual(["unknown-field"]);
  });
});

describe("songHash", () => {
  const base = hymn(1);
  const h = (x: HymnSource) => songHash(x);

  it("matches a known SHA-256 vector", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches the empty-input and a fixed canonical-form vector", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(canonicalSong(base)).toBe(
      '["Title 1",[["chorus","",["chorus line"]],["stanza","1",["first line","second line"]]],[1,0],["A. Writer","",""]]',
    );
    expect(await h(base)).toBe(await sha256Hex(canonicalSong(base)));
  });

  it("is equal across NFC, whitespace, absent and empty fields, renamed part ids, number", async () => {
    const variant = hymn(99, {
      title: "  Title  1 ",
      parts: [
        { id: "x", kind: "chorus", label: "", lines: ["chorus   line"] },
        { id: "y", kind: "stanza", label: "1", lines: ["first\tline", " second line "] },
      ],
      sequence: [{ partId: "y" }, { partId: "x" }],
      meta: { author: "A. Writer", tune: "", topics: ["ignored"] },
    });
    const nfd = hymn(1, { title: "Café" });
    const nfdVariant = hymn(1, { title: "Café" });
    expect(await h(variant)).toBe(await h(hymn(1, { title: "Title 1" })));
    expect(await h(nfd)).toBe(await h(nfdVariant));
    const noLabel = hymn(1, {
      parts: [{ id: "c", kind: "chorus", lines: ["a"] }],
      sequence: [{ partId: "c" }],
    });
    const emptyLabel = hymn(1, {
      parts: [{ id: "c", kind: "chorus", label: "", lines: ["a"] }],
      sequence: [{ partId: "c" }],
    });
    expect(await h(noLabel)).toBe(await h(emptyLabel));
    expect(await h(hymn(1, { meta: { author: "A. Writer" } }))).toBe(
      await h(hymn(1, { meta: { author: "A. Writer", meter: "" } })),
    );
  });

  it("differs on a changed word, label, kind, sequence or meta value", async () => {
    const hashes = await Promise.all([
      h(base),
      h(hymn(1, { title: "Other" })),
      h(
        hymn(1, {
          parts: [base.parts[0], { ...base.parts[1], lines: ["first line", "second lines"] }],
        }),
      ),
      h(hymn(1, { parts: [base.parts[0], { ...base.parts[1], label: "2" }] })),
      h(hymn(1, { parts: [{ ...base.parts[0], kind: "refrain" as never }, base.parts[1]] })),
      h(hymn(1, { sequence: [{ partId: "c" }, { partId: "s1" }] })),
      h(hymn(1, { sequence: [{ partId: "s1" }, { partId: "c" }, { partId: "c" }] })),
      h(hymn(1, { meta: { author: "B. Writer" } })),
      h(hymn(1, { meta: { author: "A. Writer", tune: "T" } })),
      h(hymn(1, { meta: { author: "A. Writer", meter: "8.8" } })),
    ]);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("differs when parts are reordered", async () => {
    const swapped = hymn(1, { parts: [base.parts[1], base.parts[0]] });
    expect(await h(swapped)).not.toBe(await h(base));
  });
});

describe("sameSongs", () => {
  const a = new Map([
    [1, "x"],
    [2, "y"],
  ]);
  it("is true for equal numbers and hashes, in any order", () => {
    expect(
      sameSongs(
        a,
        new Map([
          [2, "y"],
          [1, "x"],
        ]),
      ),
    ).toBe(true);
  });
  it("is false for an extra song, a missing one, a different number or a different hash", () => {
    expect(sameSongs(a, new Map([...a, [3, "z"]]))).toBe(false);
    expect(sameSongs(new Map([...a, [3, "z"]]), a)).toBe(false);
    expect(
      sameSongs(
        a,
        new Map([
          [1, "x"],
          [3, "y"],
        ]),
      ),
    ).toBe(false);
    expect(
      sameSongs(
        a,
        new Map([
          [1, "x"],
          [2, "w"],
        ]),
      ),
    ).toBe(false);
  });
});

describe("uuidv7", () => {
  const RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("has the version and variant bits and the timestamp, with a known layout", () => {
    const id = uuidv7(
      () => 0x0123456789ab,
      (b) => b.fill(0xff),
    );
    expect(id).toBe("01234567-89ab-7fff-bfff-ffffffffffff");
    expect(
      uuidv7(
        () => 0,
        (b) => b.fill(0),
      ),
    ).toBe("00000000-0000-7000-8000-000000000000");
    for (let i = 0; i < 50; i++) expect(uuidv7()).toMatch(RE);
  });

  it("sorts by time and differs between calls", () => {
    const ids = [1_000, 1_001, 70_000, 2 ** 40].map((t) => uuidv7(() => t));
    expect([...ids].sort()).toEqual(ids);
    expect(uuidv7()).not.toBe(uuidv7());
  });

  it("orders by millisecond when the randomness is equal, and keeps the random bits", () => {
    const fill = (b: Uint8Array) => b.fill(0xab);
    const a = uuidv7(() => 5_000, fill);
    const b = uuidv7(() => 5_001, fill);
    expect(a < b).toBe(true);
    expect(a).toMatch(/-7bab-abab-abababababab$/);
  });

  it("encodes the current time by default", () => {
    const before = Date.now();
    const ms = Number.parseInt(uuidv7().replace(/-/g, "").slice(0, 12), 16);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(Date.now());
  });
});
