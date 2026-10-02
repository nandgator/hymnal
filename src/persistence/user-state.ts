import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { HymnbookId, HymnNumber, Position } from "../domain/types.ts";
import type { ScreenKey } from "../output/screens.ts";

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

/** The Output's reading band while someone scrolls by hand: the part the
 * focus is in, or one line (SDD-0001 §16.1). */
export type BandSize = "part" | "line";
/** What the Output lights: the current part (the rest dimmed), or the whole
 * song, for a congregation singing straight through (SDD-0005 § 5). */
export type Highlight = "part" | "song";

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
  /** The Output's reading band; absent means `part` — SDD-0001 §16.1. */
  bandSize?: BandSize;
  /** Pin the chorus where it fits; absent means off — SDD-0001 §16.1. */
  pinChorus?: boolean;
  /** Show the whole song at once on a landscape Output (SDD-0005); absent
   * means off. */
  wholeSong?: boolean;
  /** What the Output lights; absent means the current part. */
  highlight?: Highlight;
  /** The Operator's tab groups, as stored; read through `workspaceOf`, which
   * makes any stored value whole — SDD-0001 §16.4. */
  workspace?: unknown;
  /** The Safari "add to Home Screen" note was dismissed; shown once — SDD-0001 §15. */
  homeScreenHintDismissed?: boolean;
  /** The screen the operator chose for the Output, by label and size; absent
   * means Automatic — SDD-0001 §16.1, ADR-0028. Read through `rememberedScreenOf`. */
  outputScreen?: ScreenKey;
  /** "Drag it to the projector and press F11" was shown; once. */
  dragHintDismissed?: boolean;
  /** "Click the Output, or press F, for fullscreen" was shown; once. */
  fullscreenHintDismissed?: boolean;
}

/** The cues when none are chosen: what a songbook congregation needs, the
 * number and the book, fading after a few seconds (DESIGN.md § Typography). */
export const DEFAULT_OUTPUT_CUES: OutputCues = { number: true, hymnbook: true, fade: true };

export const outputCuesOf = (preferences: Preferences): OutputCues =>
  preferences.outputCues ?? DEFAULT_OUTPUT_CUES;

/** Anything but "line", a stored value gone wrong included, is a part. */
export const bandSizeOf = (preferences: Preferences): BandSize =>
  preferences.bandSize === "line" ? "line" : "part";

export const pinChorusOf = (preferences: Preferences) => preferences.pinChorus ?? false;

/** Anything but "song", a stored value gone wrong included, is the part. */
export const highlightOf = (preferences: Preferences): Highlight =>
  preferences.highlight === "song" ? "song" : "part";

export const wholeSongOf = (preferences: Preferences) => preferences.wholeSong ?? false;

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
  /** Forgets a book's recents: removing a loaded book drops them (SDD-0004 §9). */
  dropRecents(hymnbookId: HymnbookId): Promise<void>;
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

    async dropRecents(hymnbookId) {
      const doc = await readDoc();
      await writeDoc({
        ...doc,
        recents: doc.recents.filter((entry) => entry.hymnbookId !== hymnbookId),
      });
    },

    async getPreferences() {
      // Merged over the defaults, so a document saved before a preference
      // existed still loads complete — no migration needed. A retired one
      // is dropped: `navigator`, gone with the Parts | Lyrics switch
      // (SDD-0001 §16.4). A renamed one is read under its old name:
      // `pinRefrain`, now `pinChorus` (ADR-0025).
      const {
        navigator: _retired,
        pinRefrain,
        bandSize,
        ...stored
      } = ((await readDoc()).preferences ?? {}) as Partial<Preferences> & {
        navigator?: unknown;
        pinRefrain?: boolean;
      };
      // A stored value that is neither is dropped: a part.
      return {
        ...DEFAULT_PREFERENCES,
        ...(pinRefrain === undefined ? {} : { pinChorus: pinRefrain }),
        ...stored,
        ...(bandSize === "part" || bandSize === "line" ? { bandSize } : {}),
      };
    },

    async setPreferences(preferences) {
      const doc = await readDoc();
      await writeDoc({ ...doc, preferences });
    },
  };
}

export const userState: UserState = openUserState("hymnal-user-state");
