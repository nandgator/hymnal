// @vitest-environment node

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

  it("titles a song: names and capitals kept, a bracketed subtitle starting afresh", () => {
    expect(titleCase("I serve a risen Savior")).toBe("I Serve a Risen Savior");
    expect(titleCase("Give thanks to the LORD")).toBe("Give Thanks to the LORD");
    expect(titleCase("Men of faith (the shout to the north)")).toBe(
      "Men of Faith (The Shout to the North)",
    );
  });

  it("leaves a script without case as it is", () => {
    expect(titleCase("യേശുനാഥാ നിൻ കൃപയ്ക്കായ്")).toBe("യേശുനാഥാ നിൻ കൃപയ്ക്കായ്");
  });
});
