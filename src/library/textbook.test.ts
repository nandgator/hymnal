import { describe, expect, it } from "vitest";
import { buildTextBook, slugify } from "./textbook.ts";

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
    const r = buildTextBook({ ...fields, title: "", id: "" }, "1. A\n\nLine\n", "");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.fields)).toEqual(["title", "id"]);
  });
  it("takes the number of a single song from the field", () => {
    expect(buildTextBook(fields, "A Song\n\nLine one\n", "").ok).toBe(false);
    expect(buildTextBook({ ...fields, number: "7" }, "A Song\n\nLine one\n", "").ok).toBe(true);
  });
  it("builds the same bytes twice, so the same text is the same file", () => {
    const a = buildTextBook(fields, "1. A\n\nLine\n", "");
    const b = buildTextBook(fields, "1. A\n\nLine\n", "");
    expect(a.ok && b.ok && a.bytes).toEqual(a.ok && b.ok && b.bytes);
  });
});
