import { describe, expect, it } from "vitest";
import { fraction, type LoadProgress, phaseLine, throttled } from "./progress.ts";

describe("phaseLine", () => {
  it("names each phase, with the count where there is one", () => {
    expect(phaseLine({ phase: "reading", done: 0, total: 0 })).toBe("Reading…");
    expect(phaseLine({ phase: "checking", done: 812, total: 1631 })).toBe(
      "Checking 812 of 1,631 songs",
    );
    expect(phaseLine({ phase: "hashing", done: 100, total: 1631 })).toBe(
      "Comparing 100 of 1,631 songs",
    );
    expect(phaseLine({ phase: "saving", done: 1200, total: 1631 })).toBe(
      "Saving 1,200 of 1,631 songs",
    );
    expect(phaseLine({ phase: "indexing", done: 0, total: 0 })).toBe("Indexing for search…");
  });

  it("says a phase with no count without one", () => {
    expect(phaseLine({ phase: "checking", done: 0, total: 0 })).toBe("Checking…");
    expect(phaseLine({ phase: "saving", done: 0, total: 0 })).toBe("Saving…");
  });
});

describe("fraction", () => {
  it("is the share done where counted, and undefined (indeterminate) where not", () => {
    expect(fraction({ phase: "saving", done: 500, total: 1000 })).toBe(0.5);
    expect(fraction({ phase: "saving", done: 2000, total: 1000 })).toBe(1);
    expect(fraction({ phase: "indexing", done: 0, total: 0 })).toBeUndefined();
  });
});

describe("throttled", () => {
  const at = (phase: LoadProgress["phase"], done: number, total = 10): LoadProgress => ({
    phase,
    done,
    total,
  });

  it("passes nothing on when there is no listener", () => {
    expect(throttled(undefined)).toBeUndefined();
  });

  it("passes a phase's first and last report and one per interval between", () => {
    let t = 0;
    const heard: LoadProgress[] = [];
    const report = throttled(
      (p) => heard.push(p),
      100,
      () => t,
    ) as (p: LoadProgress) => void;
    for (let done = 0; done <= 10; done++) {
      report(at("saving", done));
      t += 30;
    }
    // 0 (first), then every 4th step (120 ms) until 10 (last)
    expect(heard.map((p) => p.done)).toEqual([0, 4, 8, 10]);
  });

  it("always passes a change of phase, however soon", () => {
    const heard: string[] = [];
    const report = throttled(
      (p) => heard.push(p.phase),
      1000,
      () => 0,
    ) as (p: LoadProgress) => void;
    report(at("reading", 0, 0));
    report(at("checking", 1));
    report(at("checking", 2));
    report(at("hashing", 1));
    report(at("indexing", 0, 0));
    expect(heard).toEqual(["reading", "checking", "hashing", "indexing"]);
  });
});
