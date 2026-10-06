import "fake-indexeddb/auto";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Position } from "../domain/types.ts";
import {
  BLOCKED_MS,
  bandSizeOf,
  cleanUserDoc,
  DEFAULT_PREFERENCES,
  goLiveOf,
  openUserState,
  type UserStateHandle,
} from "./user-state.ts";

// A test can replace `openDB` to make the open fail or hang.
type OpenDBStub = (name: string, version: number, callbacks: object) => Promise<unknown>;
const stub = vi.hoisted(() => ({ openDB: undefined as undefined | OpenDBStub }));
vi.mock("idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb")>();
  return {
    ...actual,
    openDB: (...args: Parameters<typeof actual.openDB>) =>
      stub.openDB
        ? stub.openDB(...(args as unknown as Parameters<OpenDBStub>))
        : actual.openDB(...args),
  };
});

const position = (hymnNumber: number): Position => ({
  hymnbookId: "mal-ymef-athmeeya-geethangal-16",
  hymnNumber,
  occurrenceIndex: 0,
  lineIndex: null,
});

let state: UserStateHandle;
let dbName: string;
let dbCounter = 0;

beforeEach(() => {
  stub.openDB = undefined;
  dbName = `test-${++dbCounter}`;
  state = openUserState(dbName);
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

/** Stores `record` as the document, as an app of another version might have. */
async function seed(record: unknown) {
  const db = await openDB(dbName, 1, { upgrade: (d) => void d.createObjectStore("state") });
  await db.put("state", record, "root");
  db.close();
}
async function stored() {
  const db = await openDB(dbName, 1);
  const record = await db.get("state", "root");
  db.close();
  return record;
}

const recent = (hymnNumber: number) => ({ hymnbookId: "book", hymnNumber, viewedAt: hymnNumber });

describe("damage: fields read one by one (SDD-0001 §11.1)", () => {
  it("reads a document without a version as version 1, and writes nothing on a read", async () => {
    const record = { recents: [recent(1)], preferences: { theme: "dark" } };
    await seed(record);
    expect((await state.getPreferences()).theme).toBe("dark");
    expect(await state.getRecents()).toEqual([recent(1)]);
    expect(await stored()).toEqual(record);
    expect(cleanUserDoc(record).version).toBe(1);
  });

  it("drops a lastPosition that is not a Position, keeping the rest", async () => {
    await seed({ version: 1, lastPosition: { hymnbookId: "b" }, recents: [recent(1)] });
    expect(await state.getLastPosition()).toBeUndefined();
    expect(await state.getRecents()).toEqual([recent(1)]);
    await seed({ version: 1, lastPosition: position(3), recents: [] });
    expect(await openUserState(dbName).getLastPosition()).toEqual(position(3));
  });

  it("keeps the valid recents and drops the rest, still capped at 20", async () => {
    const good = Array.from({ length: 30 }, (_, i) => recent(i + 1));
    await seed({ recents: [null, { hymnbookId: 1 }, ...good.slice(0, 2), "x", ...good.slice(2)] });
    expect((await state.getRecents()).map((r) => r.hymnNumber)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    await seed({ recents: "nope" });
    expect(await openUserState(dbName).getRecents()).toEqual([]);
  });

  it("drops each wrong preference on its own, so its default applies", async () => {
    await seed({
      preferences: {
        theme: "purple",
        fontScale: "big",
        scrollSync: false,
        outputTheme: "neon",
        bandSize: 3,
        highlight: "song",
        goLive: "projector",
        pinChorus: "yes",
        outputScreen: { label: "x" },
        panes: { a: true, b: 1 },
        outputCues: { number: true, title: "no", bogus: true },
      },
    });
    expect(await state.getPreferences()).toEqual({
      ...DEFAULT_PREFERENCES,
      scrollSync: false,
      highlight: "song",
      panes: { a: true },
      outputCues: { number: true, part: true },
    });
  });

  it("reads a record that is not an object as the empty document", async () => {
    for (const record of ["text", 7, null, [1, 2]]) {
      await seed(record);
      const fresh = openUserState(dbName);
      expect(await fresh.getPreferences()).toEqual(DEFAULT_PREFERENCES);
      expect(await fresh.getRecents()).toEqual([]);
      expect(await fresh.getLastPosition()).toBeUndefined();
    }
    expect(cleanUserDoc("text")).toEqual({ version: 1, recents: [] });
  });

  it("stores the cleaned fields on the next ordinary write", async () => {
    await seed({ recents: [null, recent(1)], lastPosition: 5 });
    await state.addRecent("book", 2);
    const record = await stored();
    expect(record.recents.map((r: { hymnNumber: number }) => r.hymnNumber)).toEqual([2, 1]);
    expect(record).not.toHaveProperty("lastPosition");
  });
});

describe("damage: a newer app's fields survive (SDD-0001 §11.1)", () => {
  it("keeps unknown fields and a higher version on write", async () => {
    await seed({
      version: 3,
      recents: [],
      installed: ["a"],
      preferences: { theme: "dark", futurePref: { x: 1 } },
    });
    await state.addRecent("book", 1);
    await state.setPreferences({ ...(await state.getPreferences()), fontScale: 2 });
    expect(await stored()).toMatchObject({
      version: 3,
      installed: ["a"],
      recents: [recent(1)].map((r) => ({ ...r, viewedAt: expect.any(Number) })),
      preferences: { theme: "dark", fontScale: 2, futurePref: { x: 1 } },
    });
  });

  it("keeps an unknown preference even when the app writes preferences without it", async () => {
    await seed({ preferences: { futurePref: 1 } });
    await state.setPreferences({ theme: "light", fontScale: 1 });
    expect((await stored()).preferences).toEqual({ theme: "light", fontScale: 1, futurePref: 1 });
  });

  it("keeps a fractional stored version as it is", async () => {
    await seed({ version: 2.5, recents: [] });
    await state.addRecent("book", 1);
    expect((await stored()).version).toBe(2.5);
  });

  it("drops a stored preference named like an inherited property, and an own __proto__", async () => {
    await seed(
      JSON.parse(
        '{"preferences":{"theme":"dark","constructor":"x","toString":1,"__proto__":{"evil":true}}}',
      ),
    );
    const prefs = await state.getPreferences();
    expect(prefs).toEqual({ ...DEFAULT_PREFERENCES, theme: "dark" });
    expect(Object.hasOwn(prefs, "constructor")).toBe(false);
    expect(Object.hasOwn(prefs, "__proto__")).toBe(false);
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
  });

  it("writes version 1 for a fresh install", async () => {
    await state.addRecent("book", 1);
    expect((await stored()).version).toBe(1);
  });
});

describe("refused or blocked: memory for the session (SDD-0001 §11.1)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("carries on in memory when the open fails, and says so once", async () => {
    stub.openDB = () => Promise.reject(new DOMException("refused", "InvalidStateError"));
    const heard = vi.fn();
    state.onMemoryFallback(heard);
    expect(await state.getPreferences()).toEqual(DEFAULT_PREFERENCES);
    await state.addRecent("book", 1);
    await state.addRecent("book", 2);
    await state.setPreferences({ theme: "dark", fontScale: 1 });
    await state.setLastPosition(position(4));
    expect((await state.getRecents()).map((r) => r.hymnNumber)).toEqual([2, 1]);
    expect((await state.getPreferences()).theme).toBe("dark");
    expect(await state.getLastPosition()).toEqual(position(4));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("tells a listener that subscribes late, once", async () => {
    stub.openDB = () => Promise.reject(new Error("refused"));
    await state.getRecents();
    const heard = vi.fn();
    state.onMemoryFallback(heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("falls to memory when an open never settles within 5 s, not before", async () => {
    vi.useFakeTimers();
    stub.openDB = () => new Promise(() => {});
    const heard = vi.fn();
    state.onMemoryFallback(heard);
    const read = state.getRecents();
    await vi.advanceTimersByTimeAsync(BLOCKED_MS - 1);
    expect(heard).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await read).toEqual([]);
    expect(heard).toHaveBeenCalledTimes(1);
    await state.addRecent("book", 1);
    expect(await state.getRecents()).toHaveLength(1);
  });

  it("keeps the database when a slow open settles within 5 s", async () => {
    vi.useFakeTimers();
    stub.openDB = () =>
      new Promise((resolve) => setTimeout(resolve, 1000, { get: async () => undefined }));
    const heard = vi.fn();
    state.onMemoryFallback(heard);
    const read = state.getRecents();
    await vi.advanceTimersByTimeAsync(BLOCKED_MS + 1000);
    expect(await read).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
  });

  it("falls to memory on the next op after a newer tab's upgrade closes the connection", async () => {
    await state.addRecent("book", 1);
    const heard = vi.fn();
    state.onMemoryFallback(heard);
    (await openDB(dbName, 2)).close();
    expect((await state.getRecents()).map((r) => r.hymnNumber)).toEqual([1]);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("does not lose overlapping writes, in the database or across the fall to memory", async () => {
    await Promise.all([
      state.addRecent("book", 1),
      state.addRecent("book", 2),
      state.setPreferences({ theme: "dark", fontScale: 1 }),
      state.setLastPosition(position(9)),
    ]);
    expect((await state.getRecents()).map((r) => r.hymnNumber)).toEqual([2, 1]);
    expect((await state.getPreferences()).theme).toBe("dark");
    expect(await state.getLastPosition()).toEqual(position(9));

    const refused = openUserState(`${dbName}-refused`);
    stub.openDB = () => Promise.reject(new Error("refused"));
    await Promise.all([
      refused.addRecent("book", 1),
      refused.addRecent("book", 2),
      refused.setPreferences({ theme: "light", fontScale: 1 }),
    ]);
    expect((await refused.getRecents()).map((r) => r.hymnNumber)).toEqual([2, 1]);
    expect((await refused.getPreferences()).theme).toBe("light");
  });

  it("falls to memory when a write fails, keeping what was read and the write itself", async () => {
    await state.addRecent("book", 1);
    const real = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const heard = vi.fn();
    state.onMemoryFallback(heard);
    await state.addRecent("book", 2);
    put.mockRestore();
    expect(IDBObjectStore.prototype.put).toBe(real);
    expect((await state.getRecents()).map((r) => r.hymnNumber)).toEqual([2, 1]);
    await state.addRecent("book", 3);
    expect(heard).toHaveBeenCalledTimes(1);
    expect((await stored()).recents).toHaveLength(1);
  });

  it("closes its connection on versionchange, so a newer tab is not blocked", async () => {
    await state.addRecent("book", 1);
    const upgraded = await openDB(dbName, 2, { blocked: () => expect.fail("blocked") });
    upgraded.close();
  });
});

describe("reset", () => {
  it("deletes the database, books untouched, and a fresh open finds nothing", async () => {
    await state.addRecent("book", 1);
    await state.setPreferences({ theme: "dark", fontScale: 2 });
    await state.reset();
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(dbName);
    const fresh = openUserState(dbName);
    expect(await fresh.getRecents()).toEqual([]);
    expect(await fresh.getPreferences()).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("restoring from a backup (SDD-0006 §4)", () => {
  it("merges the backup's document into the stored one and reads back clean", async () => {
    await state.setPreferences({ theme: "dark", fontScale: 2 });
    await state.addRecent("held", 1);
    const backup = {
      version: 1,
      lastPosition: { hymnbookId: "held", hymnNumber: 4, occurrenceIndex: 0, lineIndex: null },
      recents: [
        { hymnbookId: "held", hymnNumber: 2, viewedAt: 5 },
        { hymnbookId: "gone", hymnNumber: 9, viewedAt: 6 },
        "garbage",
      ],
      preferences: { theme: "light", fontScale: 1.5 },
    };
    await state.restore(backup, new Set(["held"]));
    expect((await state.getRecents()).map((r) => [r.hymnbookId, r.hymnNumber])).toEqual([
      ["held", 1],
      ["held", 2],
    ]);
    expect(await state.getLastPosition()).toMatchObject({ hymnNumber: 4 });
    expect(await state.getPreferences()).toMatchObject({ theme: "light", fontScale: 1.5 });
    expect((await state.backupDoc()).recents).toHaveLength(2);
  });

  it("restores nothing from a document that is not one", async () => {
    await state.addRecent("held", 1);
    await state.restore("not a document", new Set(["held"]));
    expect(await state.getRecents()).toHaveLength(1);
  });
});
