import { describe, expect, it } from "vitest";
import { titleCase } from "./case.ts";

describe("titleCase", () => {
  it("capitalises all but minor words, which stay lower unless first", () => {
    expect(titleCase("bring the Output forward")).toBe("Bring the Output Forward");
    expect(titleCase("make the other tab group main")).toBe("Make the Other Tab Group Main");
    expect(titleCase("text size up")).toBe("Text Size Up");
  });

  it("starts again after a colon, and leaves capitals alone", () => {
    expect(titleCase("go live: open the Output")).toBe("Go Live: Open the Output");
    expect(titleCase("hide song number on the Output")).toBe("Hide Song Number on the Output");
  });
});
