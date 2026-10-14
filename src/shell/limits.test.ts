import { describe, expect, it } from "vitest";
import {
  CODE_MAX,
  clampText,
  clipEcho,
  ECHO_MAX,
  NAME_MAX,
  NUMBER_MAX,
  SEARCH_MAX,
  TEXT_MAX,
  TEXT_TOO_LONG,
} from "./limits.ts";

const graphemes = (text: string) =>
  [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(
    (s) => s.segment,
  );

// "ക്ഷ" is one cluster of three code points; "മലയാളം" has combining signs too.
const MALAYALAM = "ക്ഷമലയാളം".repeat(40);

describe("the shared limits", () => {
  it("are the numbers the DESIGN.md rule states", () => {
    expect(SEARCH_MAX).toBe(100);
    expect(NAME_MAX).toBe(200);
    expect(CODE_MAX).toBeGreaterThanOrEqual(35);
    expect(NUMBER_MAX).toBe(6);
    expect(ECHO_MAX).toBe(40);
    expect(TEXT_MAX).toBeGreaterThanOrEqual(1_000_000);
    expect(TEXT_MAX).toBeLessThanOrEqual(2_000_000);
    expect(TEXT_TOO_LONG).toBe("That text is too long to add at once. Add it in parts.");
  });
});

describe("clipEcho", () => {
  it("leaves a short query as it is", () => {
    expect(clipEcho("grace")).toBe("grace");
    expect(clipEcho("")).toBe("");
  });

  it("cuts a long query to the cap and ends it with an ellipsis", () => {
    expect(clipEcho("a".repeat(5000))).toBe(`${"a".repeat(ECHO_MAX)}…`);
  });

  it("never cuts a Malayalam cluster in two", () => {
    const out = clipEcho(MALAYALAM);
    expect(out.endsWith("…")).toBe(true);
    const kept = out.slice(0, -1);
    expect(graphemes(kept)).toHaveLength(ECHO_MAX);
    expect(graphemes(MALAYALAM).slice(0, ECHO_MAX).join("")).toBe(kept);
  });

  it("does not split an emoji with a skin tone", () => {
    const out = clipEcho("👍🏽".repeat(100));
    expect(graphemes(out.slice(0, -1))).toHaveLength(ECHO_MAX);
  });
});

describe("clampText", () => {
  it("leaves text within the limit alone", () => {
    expect(clampText("abc", 100)).toBe("abc");
  });

  it("cuts to the limit in code units", () => {
    expect(clampText("a".repeat(5000), SEARCH_MAX)).toHaveLength(SEARCH_MAX);
  });

  it("cuts Malayalam on a cluster boundary", () => {
    const out = clampText(MALAYALAM, SEARCH_MAX);
    expect(out.length).toBeLessThanOrEqual(SEARCH_MAX);
    const all = graphemes(MALAYALAM);
    expect(graphemes(out)).toEqual(all.slice(0, graphemes(out).length));
    // Nothing more would have fit.
    expect(all.slice(0, graphemes(out).length + 1).join("").length).toBeGreaterThan(SEARCH_MAX);
  });
});
