// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildTextBook, slugify, songCount } from "./textbook.ts";

const fields = { title: "T", language: "en", script: "Latn", id: "t", number: "" };

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
    const r = buildTextBook({ ...fields, title: "", id: "" }, "1. A\n\nLine\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fields)).toEqual(["title", "id"]);
  });
  it("takes the number of a single song from the field", () => {
    expect(buildTextBook(fields, "A Song\n\nLine one\n").ok).toBe(false);
    expect(buildTextBook({ ...fields, number: "7" }, "A Song\n\nLine one\n").ok).toBe(true);
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

describe("buildTextBook for Assorted Hymns", () => {
  const assorted = { ...fields, title: "", id: "", destination: "assorted" as const };
  it("needs only the song's language and script: no title, id or number", () => {
    const r = buildTextBook(assorted, "A Song\n\nLine one\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.destination).toBe("assorted");
      expect(r.id).toBe("assorted-song");
    }
    const missing = buildTextBook({ ...assorted, language: "" }, "A Song\n\nLine one\n");
    expect(!missing.ok && Object.keys(missing.fields)).toEqual(["language"]);
  });
  it("is still a book for several songs, whatever was asked", () => {
    const r = buildTextBook(assorted, "1. A\n\nLine\n\n---\n\n2. B\n\nLine\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fields)).toEqual(["title", "id"]);
  });
  it("a book of its own stays so when asked, for one song", () => {
    const r = buildTextBook({ ...fields, destination: "book" }, "1. A\n\nLine\n");
    expect(r.ok && r.destination).toBe("book");
  });
});
