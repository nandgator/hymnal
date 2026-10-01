import { describe, expect, it } from "vitest";
import { GUESS, type Note, renderReport } from "./report.ts";

describe("renderReport", () => {
  const wrap = (message: string): Note => ({ kind: "wrap", message, hymn: 1, page: 2 });

  it("counts the sure wraps and lists only the guesses", () => {
    const text = renderReport(
      "T",
      [],
      [wrap('"a" + "b"'), wrap('"c" + "d"'), wrap(`${GUESS}"e." + "F"`)],
    );
    expect(text).toContain("## Line wraps joined (1)");
    expect(text).toContain("2 joined where the next line starts lowercase after open text.");
    expect(text).toContain(`- **#1, p.2** ${GUESS}"e." + "F"`);
    expect(text).not.toContain('"a" + "b"');
  });

  it("lists nothing under a heading with no guesses but a count", () => {
    const text = renderReport("T", [], [wrap('"a" + "b"')]);
    expect(text).toContain("## Line wraps joined (0)");
    expect(text).toContain("1 joined where");
  });
});
