// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  type BookChoice,
  buildTextBook,
  resolveChoice,
  scriptProblem,
  slugify,
  songCount,
  suggestBookTitle,
} from "./textbook.ts";

const fields = { title: "T", language: "en", script: "Latn", number: "" };

describe("slugify", () => {
  it("makes a lower-case ASCII id from a title", () => {
    expect(slugify("Hymns of Fellowship, 2nd ed.")).toBe("hymns-of-fellowship-2nd-ed");
    expect(slugify("Cantiques français")).toBe("cantiques-francais");
  });
  it("is empty for a title with no Latin letters, so the id is asked for", () => {
    expect(slugify("ആത്മീയ ഗീതങ്ങൾ")).toBe("");
  });
});

describe("buildTextBook", () => {
  it("asks for what is missing, and writes nothing", () => {
    const r = buildTextBook(
      { ...fields, title: "", language: "", destination: { kind: "new" } },
      "1. A\n\nLine\n",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fields)).toEqual(["title", "language"]);
  });
  it("gives a single song with no number the book's next number, or the field's", () => {
    expect(buildTextBook(fields, "A Song\n\nLine one\n").ok).toBe(true);
    expect(buildTextBook({ ...fields, number: "7" }, "A Song\n\nLine one\n").ok).toBe(true);
    expect(buildTextBook({ ...fields, number: "x" }, "A Song\n\nLine one\n").ok).toBe(false);
  });
  it("builds the same bytes twice, so the same text is the same file", () => {
    const a = buildTextBook(fields, "1. A\n\nLine\n");
    const b = buildTextBook(fields, "1. A\n\nLine\n");
    expect(a.ok && b.ok && a.bytes).toEqual(a.ok && b.ok && b.bytes);
  });
});

describe("songCount", () => {
  it("counts songs as the parser splits them", () => {
    expect(songCount("")).toBe(0);
    expect(songCount("# only a comment\n\n")).toBe(0);
    expect(songCount("A Song\n\nLine\n")).toBe(1);
    expect(songCount("A\n\nLine\n\n---\n\nB\n\nLine\n")).toBe(2);
    // A closing separator with nothing after it adds no song.
    expect(songCount("A\n\nLine\n\n---\n")).toBe(1);
  });
});

describe("buildTextBook for your books", () => {
  const assorted = { ...fields, title: "", destination: { kind: "default" } as const };
  const gunzip = async (bytes: Uint8Array) => {
    const { gunzipSync } = await import("fflate");
    return JSON.parse(new TextDecoder().decode(gunzipSync(bytes)));
  };
  it("needs only the song's language and script for Assorted Hymns: no title or number", () => {
    const r = buildTextBook(assorted, "A Song\n\nLine one\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.target).toEqual({ kind: "default" });
      expect(r.id).toBe("text-songs");
    }
    const missing = buildTextBook({ ...assorted, language: "" }, "A Song\n\nLine one\n");
    expect(!missing.ok && Object.keys(missing.fields)).toEqual(["language"]);
  });
  it("numbers a single song from the book's next number", async () => {
    const r = buildTextBook(assorted, "A Song\n\nLine one\n", 12);
    expect(r.ok && (await gunzip(r.bytes)).hymns[0].number).toBe(12);
  });
  it("keeps a number written in the text, whatever the next number is", async () => {
    const r = buildTextBook(assorted, "5. A Song\n\nLine one\n", 12);
    expect(r.ok && (await gunzip(r.bytes)).hymns[0].number).toBe(5);
  });
  it("takes several songs for Assorted Hymns, the container titled by it", async () => {
    const r = buildTextBook(assorted, "1. A\n\nLine\n\n---\n\n2. B\n\nLine\n");
    expect(r.ok && r.target).toEqual({ kind: "default" });
    expect(r.ok && (await gunzip(r.bytes)).hymnbook.title).toBe("Assorted Hymns");
  });
  it("makes a new book of the title asked for, one song or several", async () => {
    const one = buildTextBook({ ...fields, destination: { kind: "new" } }, "1. A\n\nLine\n");
    expect(one.ok && one.target).toEqual({ kind: "new", title: "T" });
    const many = buildTextBook(
      { ...fields, destination: { kind: "new" } },
      "1. A\n\nL\n\n---\n\n2. B\n\nL\n",
    );
    expect(many.ok && (await gunzip(many.bytes)).hymnbook.title).toBe("T");
    const untitled = buildTextBook(
      { ...fields, title: " ", destination: { kind: "new" } },
      "1. A\n\nL\n",
    );
    expect(!untitled.ok && Object.keys(untitled.fields)).toEqual(["title"]);
  });
});

describe("buildTextBook for a chosen book", () => {
  const gunzip = async (bytes: Uint8Array) => {
    const { gunzipSync } = await import("fflate");
    return JSON.parse(new TextDecoder().decode(gunzipSync(bytes)));
  };
  const chosen = { ...fields, destination: { kind: "book", key: "k1" } as const };
  it("targets the book by key", () => {
    const r = buildTextBook(chosen, "A Song\n\nLine\n", 4);
    expect(r.ok && r.target).toEqual({ kind: "book", key: "k1" });
  });
  it("counts songs with no number up from the book's next, skipping numbers written", async () => {
    const text = "A\n\nLine\n\n---\n\n5. B\n\nLine\n\n---\n\nC\n\nLine\n\n---\n\nD\n\nLine\n";
    const r = buildTextBook(chosen, text, 4);
    expect(r.ok && (await gunzip(r.bytes)).hymns.map((h: { number: number }) => h.number)).toEqual([
      4, 5, 6, 7,
    ]);
  });
  it("lets the Advanced number win for a single song", async () => {
    const r = buildTextBook({ ...chosen, number: "30" }, "A\n\nLine\n", 4);
    expect(r.ok && (await gunzip(r.bytes)).hymns[0].number).toBe(30);
  });
  it("refuses a script this device does not know", () => {
    const r = buildTextBook({ ...chosen, script: "Abcd" }, "A\n\nLine\n", 4);
    expect(!r.ok && r.fields.script).toMatch(/not a script/);
  });
  it("normalises the script's case", async () => {
    const r = buildTextBook({ ...chosen, script: "latn" }, "A\n\nLine\n", 4);
    expect(r.ok && (await gunzip(r.bytes)).hymnbook.script).toBe("Latn");
  });
});

describe("scriptProblem", () => {
  it("wants four letters, and a script the platform names", () => {
    expect(scriptProblem("")).toMatch(/Give the script code/);
    expect(scriptProblem("La")).toMatch(/four letters/);
    expect(scriptProblem("Latn1")).toMatch(/four letters/);
    expect(scriptProblem("Abcd")).toMatch(/“Abcd” is not a script/);
    expect(scriptProblem("Latn")).toBeUndefined();
    expect(scriptProblem("mlym")).toBeUndefined();
  });
});

describe("suggestBookTitle", () => {
  it("is My Songs, or the next free My Songs N", () => {
    expect(suggestBookTitle([])).toBe("My Songs");
    expect(suggestBookTitle(["my songs"])).toBe("My Songs 2");
    expect(suggestBookTitle(["My Songs", "My Songs 2"])).toBe("My Songs 3");
  });
});

describe("resolveChoice", () => {
  const book = (key: string, origin: string): BookChoice => ({
    key,
    origin,
    title: key,
    nextNumber: 1,
  });
  const books = [book("c1", "own"), book("as1", "assorted")];
  it("is what the person picked while that book is there", () => {
    expect(resolveChoice("c1", books, "as1")).toBe("c1");
    expect(resolveChoice("new", books, "as1")).toBe("new");
  });
  it("is the book last added to, else Assorted Hymns, else the default to be made", () => {
    expect(resolveChoice(undefined, books, "c1")).toBe("c1");
    expect(resolveChoice(undefined, books, "gone")).toBe("as1");
    expect(resolveChoice(undefined, [book("c1", "own")], undefined)).toBe("default");
    expect(resolveChoice("gone", books)).toBe("as1");
  });
});
