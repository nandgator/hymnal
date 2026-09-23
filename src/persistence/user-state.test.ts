import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Position } from "../domain/types.ts";
import { DEFAULT_PREFERENCES, openUserState, type UserState } from "./user-state.ts";

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
    expect(await state.getPreferences()).toEqual({ theme: "dark", fontScale: 1.25 });
  });

  it("overwrites on each set", async () => {
    await state.setPreferences({ theme: "dark", fontScale: 1.25 });
    await state.setPreferences({ theme: "light", fontScale: 1 });
    expect(await state.getPreferences()).toEqual({ theme: "light", fontScale: 1 });
  });
});
