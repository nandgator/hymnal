// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildTextBook, slugify, songCount } from "./textbook.ts";

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
      { ...fields, title: "", language: "", destination: "book" },
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
  const assorted = { ...fields, title: "", destination: "assorted" as const };
  const gunzip = async (bytes: Uint8Array) => {
    const { gunzipSync } = await import("fflate");
    return JSON.parse(new TextDecoder().decode(gunzipSync(bytes)));
  };
  it("needs only the song's language and script for Assorted Hymns: no title or number", () => {
    const r = buildTextBook(assorted, "A Song\n\nLine one\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.destination).toBe("assorted");
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
    expect(r.ok && r.destination).toBe("assorted");
    expect(r.ok && (await gunzip(r.bytes)).hymnbook.title).toBe("Assorted Hymns");
  });
  it("makes a new book of the title asked for, one song or several", async () => {
    const one = buildTextBook({ ...fields, destination: "book" }, "1. A\n\nLine\n");
    expect(one.ok && one.destination).toBe("book");
    expect(one.ok && one.title).toBe("T");
    const many = buildTextBook(
      { ...fields, destination: "book" },
      "1. A\n\nL\n\n---\n\n2. B\n\nL\n",
    );
    expect(many.ok && (await gunzip(many.bytes)).hymnbook.title).toBe("T");
    const untitled = buildTextBook({ ...fields, title: " ", destination: "book" }, "1. A\n\nL\n");
    expect(!untitled.ok && Object.keys(untitled.fields)).toEqual(["title"]);
  });
});
