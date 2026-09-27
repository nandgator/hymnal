import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { HymnbookId, HymnNumber, Position } from "../domain/types.ts";

export interface RecentEntry {
  hymnbookId: HymnbookId;
  hymnNumber: HymnNumber;
  viewedAt: number;
}

/** The Output's own look, apart from the Operator's theme — DESIGN.md
 * § Output view. */
export type OutputTheme = "dark" | "light" | "contrast" | "warm";

/** Which cues the Output's caption shows — each off unless set
 * (DESIGN.md § Typography, SDD-0001 §16.1). */
export interface OutputCues {
  /** The hymn's number, as a badge top-left — for those following in a
   * printed songbook. */
  number?: boolean;
  title?: boolean;
  hymnbook?: boolean;
  part?: boolean;
  repeat?: boolean;
  /** Not a cue but how they all behave: each shows when it changes, then
   * fades after a few seconds. */
  fade?: boolean;
}

/** The Output's preset when none is chosen. */
export const DEFAULT_OUTPUT_THEME: OutputTheme = "warm";

/** "system" defers to the OS/browser's own light/dark preference. */
export interface Preferences {
  theme: "system" | "light" | "dark";
  /** Multiplier over the responsive base size — arc42 §8.7's user-controlled text scale. */
  fontScale: number;
  /** Which supporting panes show, by pane id; absent means shown, so a new
   * pane needs no migration — SDD-0001 §16.4. */
  panes?: Record<string, boolean>;
  /** Whether scrolling the Output moves the Operator; absent means on —
   * SDD-0001 §16.1. */
  scrollSync?: boolean;
  /** The Output's preset; absent means {@link DEFAULT_OUTPUT_THEME} — SDD-0001 §16.1. */
  outputTheme?: OutputTheme;
  /** The Output's cues; absent means {@link DEFAULT_OUTPUT_CUES}, and once
   * set, missing ones are off. */
  outputCues?: OutputCues;
  /** Pin the refrain where it fits; absent means off — SDD-0001 §16.1. */
  pinRefrain?: boolean;
  /** The Operator's tab groups, as stored; read through `workspaceOf`, which
   * makes any stored value whole — SDD-0001 §16.4. */
  workspace?: unknown;
}

/** The cues when none are chosen: what a songbook congregation needs, the
 * number and the book, fading after a few seconds (DESIGN.md § Typography). */
export const DEFAULT_OUTPUT_CUES: OutputCues = { number: true, hymnbook: true, fade: true };

export const outputCuesOf = (preferences: Preferences): OutputCues =>
  preferences.outputCues ?? DEFAULT_OUTPUT_CUES;

export const pinRefrainOf = (preferences: Preferences) => preferences.pinRefrain ?? false;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  fontScale: 1,
};

/**
 * Small, mutable, irreplaceable — see ADR-0008 and SDD-0001 §11. One document
 * per install; nothing here is queried, only read and replaced whole.
 */
export interface UserState {
  getLastPosition(): Promise<Position | undefined>;
  setLastPosition(position: Position): Promise<void>;
  getRecents(): Promise<RecentEntry[]>;
  addRecent(hymnbookId: HymnbookId, hymnNumber: HymnNumber): Promise<void>;
  getPreferences(): Promise<Preferences>;
  setPreferences(preferences: Preferences): Promise<void>;
}

const STORE = "state";
const KEY = "root";
const MAX_RECENTS = 20;

interface StateDoc {
  lastPosition?: Position;
  recents: RecentEntry[];
  preferences?: Preferences;
}

interface UserStateSchema extends DBSchema {
  [STORE]: { key: string; value: StateDoc };
}

/** Exposed for tests, which need an isolated database per run — app code uses {@link userState}. */
export function openUserState(dbName: string): UserState {
  let dbPromise: Promise<IDBPDatabase<UserStateSchema>> | undefined;
  const getDB = () => {
    if (!dbPromise) {
      dbPromise = openDB<UserStateSchema>(dbName, 1, {
        upgrade(db) {
          db.createObjectStore(STORE);
        },
      });
    }
    return dbPromise;
  };

  const readDoc = async (): Promise<StateDoc> =>
    (await (await getDB()).get(STORE, KEY)) ?? { recents: [] };
  const writeDoc = async (doc: StateDoc): Promise<void> => {
    await (await getDB()).put(STORE, doc, KEY);
  };

  return {
    async getLastPosition() {
      return (await readDoc()).lastPosition;
    },

    async setLastPosition(position) {
      const doc = await readDoc();
      await writeDoc({ ...doc, lastPosition: position });
    },

    async getRecents() {
      return (await readDoc()).recents;
    },

    async addRecent(hymnbookId, hymnNumber) {
      const doc = await readDoc();
      const rest = doc.recents.filter(
        (entry) => entry.hymnbookId !== hymnbookId || entry.hymnNumber !== hymnNumber,
      );
      const recents = [{ hymnbookId, hymnNumber, viewedAt: Date.now() }, ...rest].slice(
        0,
        MAX_RECENTS,
      );
      await writeDoc({ ...doc, recents });
    },

    async getPreferences() {
      // Merged over the defaults, so a document saved before a preference
      // existed still loads complete — no migration needed. A retired one
      // is dropped: `navigator`, gone with the Parts | Lyrics switch
      // (SDD-0001 §16.4).
      const { navigator: _retired, ...stored } = ((await readDoc()).preferences ??
        {}) as Partial<Preferences> & { navigator?: unknown };
      return { ...DEFAULT_PREFERENCES, ...stored };
    },

    async setPreferences(preferences) {
      const doc = await readDoc();
      await writeDoc({ ...doc, preferences });
    },
  };
}

export const userState: UserState = openUserState("hymnal-user-state");
