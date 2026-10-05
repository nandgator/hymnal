import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Position } from "../domain/types.ts";
import {
  bandSizeOf,
  DEFAULT_PREFERENCES,
  goLiveOf,
  openUserState,
  type UserState,
} from "./user-state.ts";

const position = (hymnNumber: number): Position => ({
  hymnbookId: "mal-ymef-athmeeya-geethangal-16",
  hymnNumber,
  occurrenceIndex: 0,
  lineIndex: null,
});

let state: UserState;
let dbCounter = 0;

beforeEach(() => {
  state = openUserState(`test-${++dbCounter}`);
});

describe("last position", () => {
  it("is unset for a fresh install", async () => {
    expect(await state.getLastPosition()).toBeUndefined();
  });

  it("round-trips", async () => {
    await state.setLastPosition(position(42));
    expect(await state.getLastPosition()).toEqual(position(42));
  });

  it("overwrites on each set", async () => {
    await state.setLastPosition(position(1));
    await state.setLastPosition(position(2));
    expect(await state.getLastPosition()).toEqual(position(2));
  });
});

describe("recents", () => {
  it("is empty for a fresh install", async () => {
    expect(await state.getRecents()).toEqual([]);
  });

  it("adds most-recent-first", async () => {
    await state.addRecent("book", 1);
    await state.addRecent("book", 2);
    const recents = await state.getRecents();
    expect(recents.map((r) => r.hymnNumber)).toEqual([2, 1]);
  });

  it("moves a re-viewed hymn to the front instead of duplicating it", async () => {
    await state.addRecent("book", 1);
    await state.addRecent("book", 2);
    await state.addRecent("book", 1);
    const recents = await state.getRecents();
    expect(recents.map((r) => r.hymnNumber)).toEqual([1, 2]);
  });

  it("caps the list at 20 entries", async () => {
    for (let n = 1; n <= 25; n++) await state.addRecent("book", n);
    const recents = await state.getRecents();
    expect(recents).toHaveLength(20);
    expect(recents.map((r) => r.hymnNumber)).toEqual(Array.from({ length: 20 }, (_, i) => 25 - i));
  });
});

describe("preferences", () => {
  it("defaults to system theme and unscaled text for a fresh install", async () => {
    expect(await state.getPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it("round-trips", async () => {
    await state.setPreferences({ theme: "dark", fontScale: 1.25 });
    expect(await state.getPreferences()).toEqual({
      theme: "dark",
      fontScale: 1.25,
    });
  });

  it("overwrites on each set", async () => {
    await state.setPreferences({ theme: "dark", fontScale: 1.25 });
    await state.setPreferences({ theme: "light", fontScale: 1 });
    expect(await state.getPreferences()).toEqual({
      theme: "light",
      fontScale: 1,
    });
  });

  it("fills a preference saved before it existed from the defaults, without migrating", async () => {
    await state.setPreferences({ theme: "dark" } as never);
    expect(await state.getPreferences()).toEqual({ theme: "dark", fontScale: 1 });
  });

  it("keeps the Output's band size, one part when none is chosen", async () => {
    expect(bandSizeOf(await state.getPreferences())).toBe("part");
    await state.setPreferences({ theme: "light", fontScale: 1, bandSize: "line" });
    expect(await state.getPreferences()).toEqual({
      theme: "light",
      fontScale: 1,
      bandSize: "line",
    });
    expect(bandSizeOf(await state.getPreferences())).toBe("line");
  });

  it("reads Go Live opens as Automatic when none is stored or the value is unknown", async () => {
    expect(goLiveOf(await state.getPreferences())).toBe("auto");
    await state.setPreferences({ theme: "light", fontScale: 1, goLive: "window" });
    expect(goLiveOf(await state.getPreferences())).toBe("window");
    await state.setPreferences({ theme: "light", fontScale: 1, goLive: "projector" } as never);
    expect(await state.getPreferences()).toEqual({ theme: "light", fontScale: 1 });
    expect(goLiveOf({ theme: "light", fontScale: 1, goLive: 3 } as never)).toBe("auto");
  });

  it("falls back to a part for a stored band size that is neither", async () => {
    await state.setPreferences({ theme: "light", fontScale: 1, bandSize: "paragraph" } as never);
    expect(await state.getPreferences()).toEqual({ theme: "light", fontScale: 1 });
    expect(bandSizeOf({ theme: "light", fontScale: 1, bandSize: 3 } as never)).toBe("part");
  });

  it("reads a renamed preference under its old name (ADR-0025)", async () => {
    await state.setPreferences({ theme: "dark", fontScale: 1, pinRefrain: true } as never);
    expect(await state.getPreferences()).toEqual({ theme: "dark", fontScale: 1, pinChorus: true });
  });

  describe("Part labels and the part cue became one, Show parts (SDD-0005 § 1)", () => {
    const read = async (stored: object) => {
      await state.setPreferences({ theme: "dark", fontScale: 1, ...stored } as never);
      return (await state.getPreferences()).outputCues;
    };

    it("is on if either was on", async () => {
      expect(await read({ outputCues: { part: true }, partLabels: false })).toMatchObject({
        part: true,
      });
      expect(await read({ outputCues: { number: true }, partLabels: true })).toMatchObject({
        part: true,
        number: true,
      });
    });

    it("is off only if both were off", async () => {
      expect(await read({ outputCues: { number: true }, partLabels: false })).toMatchObject({
        part: false,
      });
    });

    it("keeps the labels on for cues that never named the part, the labels' default", async () => {
      expect(await read({ outputCues: { number: true } })).toMatchObject({ part: true });
    });

    it("carries a labels-off choice into the default cues", async () => {
      expect(await read({ partLabels: false })).toMatchObject({
        number: true,
        hymnbook: true,
        part: false,
      });
    });

    it("leaves the one setting alone once saved: off stays off", async () => {
      const first = await state.getPreferences();
      await state.setPreferences({ ...first, outputCues: { number: true, part: false } });
      expect((await state.getPreferences()).outputCues).toEqual({ number: true, part: false });
    });

    it("drops the retired key", async () => {
      await state.setPreferences({ theme: "dark", fontScale: 1, partLabels: true } as never);
      expect(await state.getPreferences()).not.toHaveProperty("partLabels");
    });
  });

  it("drops a retired preference", async () => {
    await state.setPreferences({ theme: "dark", fontScale: 1, navigator: "lyrics" } as never);
    expect(await state.getPreferences()).toEqual({ theme: "dark", fontScale: 1 });
  });
});

describe("dropRecents", () => {
  it("forgets one book's recents and keeps the others", async () => {
    await state.addRecent("a", 1);
    await state.addRecent("b", 2);
    await state.addRecent("a", 3);
    await state.dropRecents("a");
    expect((await state.getRecents()).map((r) => [r.hymnbookId, r.hymnNumber])).toEqual([["b", 2]]);
  });

  it("is a no-op for a book with none", async () => {
    await state.addRecent("b", 2);
    await state.dropRecents("a");
    expect(await state.getRecents()).toHaveLength(1);
  });
});
