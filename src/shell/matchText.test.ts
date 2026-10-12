import { describe, expect, it } from "vitest";
import { fold } from "./matchText.ts";

describe("fold", () => {
  it("ignores case and Latin accents", () => {
    expect(fold("Cantiques Français — Édition")).toBe("cantiques francais — edition");
  });

  it("keeps Malayalam as it is, vowel signs and virama included", () => {
    const title = "മലയാളം ഗീതങ്ങൾ";
    expect(fold(title)).toBe(title);
    expect(fold("ഗീതം")).not.toBe(fold("ഗതം"));
  });
});
