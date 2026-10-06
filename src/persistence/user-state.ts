import { type DBSchema, deleteDB, type IDBPDatabase, openDB } from "idb";
import type { HymnbookId, HymnNumber, Position } from "../domain/types.ts";
import { rememberedScreenOf, type ScreenKey } from "../output/screens.ts";

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
  /** Where you are in the song: "Verse 2" beside the number and title, or,
   * with the whole song on screen, the marker above each part (SDD-0005 § 1).
   * Replaces the retired `partLabels`. */
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
  /** Where Go Live shows the song; absent means Automatic — SDD-0001 §16.7.
   * Read through {@link goLiveOf}. */
  goLive?: GoLive;
  /** "Drag it to the projector and press F11" was shown; once. */
  dragHintDismissed?: boolean;
  /** "Click the Output, or press F, for fullscreen" was shown; once. */
  fullscreenHintDismissed?: boolean;
}

/** Where Go Live opens: the Output window when an external screen is known and
 * this screen otherwise (`auto`), always this screen, or always the window. */
export type GoLive = "auto" | "here" | "window";

/** An unknown stored value, or none, is Automatic. */
export const goLiveOf = (preferences: Preferences): GoLive =>
  preferences.goLive === "here" || preferences.goLive === "window" ? preferences.goLive : "auto";

/** The cues when none are chosen: what a songbook congregation needs, the
 * number and the book, fading after a few seconds (DESIGN.md § Typography). */
export const DEFAULT_OUTPUT_CUES: OutputCues = {
  number: true,
  hymnbook: true,
  part: true,
  fade: true,
};

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

/** What the shell needs beyond the accessors: the memory fallback notice and the reset. */
export interface UserStateHandle extends UserState {
  /** Calls `listener` once, when user state first carries on in memory
   * (SDD-0001 §11.1) — at once if it already has. Returns an unsubscribe. */
  onMemoryFallback(listener: () => void): () => void;
  /** Closes the connection and deletes the database; the caller reloads
   * (SDD-0001 §11.1 "Reset settings and history"). Never touches the books. */
  reset(): Promise<void>;
  /** The document as `cleanUserDoc` makes it: what a backup holds (SDD-0006 §1). */
  backupDoc(): Promise<UserStateDoc>;
  /**
   * Writes what a restore merges into the document (SDD-0006 §4): `raw` is the
   * backup's document, cleaned here, and `held` the keys of the books now on
   * the device. See {@link mergeRestoredDoc}.
   */
  restore(raw: unknown, held: ReadonlySet<string>): Promise<void>;
}

const STORE = "state";
const KEY = "root";
const MAX_RECENTS = 20;
/** The document's own version; a document without one is read as this. */
const DOC_VERSION = 1;
/** How long an upgrade blocked by another tab is waited for. */
export const BLOCKED_MS = 5000;

/** The stored document. Fields this app does not know ride along unread. */
export interface UserStateDoc {
  version: number;
  lastPosition?: Position;
  recents: RecentEntry[];
  preferences?: Preferences;
  [unknown: string]: unknown;
}

interface UserStateSchema extends DBSchema {
  [STORE]: { key: string; value: UserStateDoc };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const oneOf =
  <T extends string>(...allowed: T[]) =>
  (value: unknown): value is T =>
    allowed.includes(value as T);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const isPosition = (value: unknown): value is Position =>
  isRecord(value) &&
  typeof value.hymnbookId === "string" &&
  isFiniteNumber(value.hymnNumber) &&
  isCount(value.occurrenceIndex) &&
  (value.lineIndex === null || isCount(value.lineIndex));

const isRecent = (value: unknown): value is RecentEntry =>
  isRecord(value) &&
  typeof value.hymnbookId === "string" &&
  isFiniteNumber(value.hymnNumber) &&
  isFiniteNumber(value.viewedAt);

/** Each known preference with the test its value must pass; anything else is dropped. */
type Checked =
  | Exclude<keyof Preferences, "panes" | "outputCues" | "outputScreen">
  | "pinRefrain"
  | "partLabels";
const PREFERENCE_FIELDS = {
  theme: oneOf("system", "light", "dark"),
  fontScale: (value) => isFiniteNumber(value) && value > 0,
  scrollSync: isBoolean,
  outputTheme: oneOf("dark", "light", "contrast", "warm"),
  bandSize: oneOf("part", "line"),
  pinChorus: isBoolean,
  wholeSong: isBoolean,
  highlight: oneOf("part", "song"),
  homeScreenHintDismissed: isBoolean,
  goLive: oneOf("auto", "here", "window"),
  dragHintDismissed: isBoolean,
  fullscreenHintDismissed: isBoolean,
  // Read by the workspace itself, which makes any value whole.
  workspace: () => true,
  // Retired or renamed, still read once to carry their value over.
  pinRefrain: isBoolean,
  partLabels: isBoolean,
} satisfies Record<Checked, (value: unknown) => boolean>;
/** Retired outright: never read, never written back. */
const RETIRED_PREFERENCES = ["navigator"];
const CUE_KEYS = ["number", "title", "hymnbook", "part", "repeat", "fade"];
/** Preference fields this app owns; any other key is a newer app's. */
const KNOWN_PREFERENCES = new Set([
  ...Object.keys(PREFERENCE_FIELDS),
  ...RETIRED_PREFERENCES,
  "panes",
  "outputCues",
  "outputScreen",
]);

const pickBooleans = (value: unknown, keys?: string[]): Record<string, boolean> | undefined => {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(
      ([key, entry]) => isBoolean(entry) && (!keys || keys.includes(key)),
    ),
  ) as Record<string, boolean>;
};

/** One stored preferences record, each field checked on its own: a wrong one
 * is dropped so its default applies. Fields nobody here knows are kept. */
function cleanPreferences(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    // Names every object inherits (`constructor`, `__proto__`) are never preferences.
    if (RETIRED_PREFERENCES.includes(key) || key in Object.prototype) continue;
    if (Object.hasOwn(PREFERENCE_FIELDS, key)) {
      const valid = PREFERENCE_FIELDS[key as Checked];
      if (valid(value)) clean[key] = value;
    } else if (!KNOWN_PREFERENCES.has(key)) clean[key] = value;
  }
  const panes = pickBooleans(raw.panes);
  if (panes) clean.panes = panes;
  const outputCues = pickBooleans(raw.outputCues, CUE_KEYS);
  if (outputCues) clean.outputCues = outputCues;
  const outputScreen = rememberedScreenOf(raw.outputScreen);
  if (outputScreen) clean.outputScreen = outputScreen;
  return clean;
}

/**
 * Whatever was stored, made into a document this app can use (SDD-0001
 * §11.1): each field checked on its own, only what is wrong dropped, a
 * missing version read as 1, a record that is not an object the empty
 * document. Pure; nothing is written. Fields it does not know are kept.
 */
export function cleanUserDoc(raw: unknown): UserStateDoc {
  if (!isRecord(raw)) return { version: DOC_VERSION, recents: [] };
  const { version, lastPosition, recents, preferences, ...unknown } = raw;
  return {
    ...unknown,
    version: isFiniteNumber(version) && version >= DOC_VERSION ? version : DOC_VERSION,
    ...(isPosition(lastPosition) ? { lastPosition } : {}),
    recents: Array.isArray(recents) ? recents.filter(isRecent).slice(0, MAX_RECENTS) : [],
    ...(isRecord(preferences)
      ? { preferences: cleanPreferences(preferences) as unknown as Preferences }
      : {}),
  };
}

/**
 * What a restore leaves in the document (SDD-0006 §4). Restoring adds and never
 * takes away: settings come from the backup; recents are both lists with one
 * entry per song, newest first, capped, and only for books now held; the
 * position is the backup's if its book is held, else the device's stays. A
 * field this app does not know stays as the device has it. Pure.
 */
export function mergeRestoredDoc(
  device: UserStateDoc,
  backup: UserStateDoc,
  held: ReadonlySet<string>,
): UserStateDoc {
  const newest = new Map<string, RecentEntry>();
  for (const entry of [...device.recents, ...backup.recents]) {
    if (!held.has(entry.hymnbookId)) continue;
    const id = JSON.stringify([entry.hymnbookId, entry.hymnNumber]);
    const seen = newest.get(id);
    if (!seen || entry.viewedAt > seen.viewedAt) newest.set(id, entry);
  }
  const recents = [...newest.values()]
    .sort((a, b) => b.viewedAt - a.viewedAt)
    .slice(0, MAX_RECENTS);
  const { lastPosition: ours, preferences: _ours, ...rest } = device;
  const lastPosition =
    backup.lastPosition && held.has(backup.lastPosition.hymnbookId) ? backup.lastPosition : ours;
  // Preferences a newer app stored under names this one does not know stay, as `setPreferences` keeps them.
  const foreign = Object.fromEntries(
    Object.entries(device.preferences ?? {}).filter(([key]) => !KNOWN_PREFERENCES.has(key)),
  );
  const preferences = backup.preferences
    ? { ...foreign, ...backup.preferences }
    : device.preferences;
  return {
    ...rest,
    // Never the backup's: a document from elsewhere does not raise the version.
    version: Math.max(device.version, DOC_VERSION),
    ...(lastPosition ? { lastPosition } : {}),
    recents,
    ...(preferences ? { preferences: preferences as Preferences } : {}),
  };
}

/** Exposed for tests, which need an isolated database per run — app code uses {@link userState}. */
export function openUserState(dbName: string): UserStateHandle {
  let dbPromise: Promise<IDBPDatabase<UserStateSchema>> | undefined;
  /** Set once the database is given up on: the document lives here instead. */
  let memory: UserStateDoc | undefined;
  let lastRead: UserStateDoc = cleanUserDoc(undefined);
  const listeners = new Set<() => void>();

  const toMemory = (seed: UserStateDoc) => {
    if (memory) return;
    memory = seed;
    const heard = [...listeners];
    listeners.clear();
    for (const listener of heard) listener();
    const closing = dbPromise;
    dbPromise = undefined;
    closing?.then((db) => db.close()).catch(() => {});
  };

  const getDB = () => {
    dbPromise ??= new Promise<IDBPDatabase<UserStateSchema>>((resolve, reject) => {
      // From the start: an open that never settles is given up on too.
      let abandoned = false;
      const timer = setTimeout(() => {
        abandoned = true;
        reject(new Error("Opening user state took too long; another tab may block it."));
      }, BLOCKED_MS);
      let connection: IDBPDatabase<UserStateSchema> | undefined;
      openDB<UserStateSchema>(dbName, 1, {
        upgrade(db) {
          db.createObjectStore(STORE);
        },
        // A newer tab asks to upgrade: let go, so it is never blocked by this one.
        blocking() {
          connection?.close();
        },
      }).then(
        (db) => {
          clearTimeout(timer);
          connection = db;
          if (abandoned) db.close();
          else resolve(db);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
    return dbPromise;
  };

  const readDoc = async (): Promise<UserStateDoc> => {
    if (memory) return memory;
    try {
      lastRead = cleanUserDoc(await (await getDB()).get(STORE, KEY));
      return lastRead;
    } catch {
      toMemory(lastRead);
      return lastRead;
    }
  };
  /** Never lowers the stored version; keeps every field it does not know. */
  const writeDoc = async (doc: UserStateDoc): Promise<void> => {
    const next = { ...doc, version: Math.max(doc.version, DOC_VERSION) };
    if (memory) {
      memory = next;
      return;
    }
    try {
      await (await getDB()).put(STORE, next, KEY);
      lastRead = next;
    } catch {
      toMemory(next);
    }
  };

  // Each accessor reads, patches and writes; they queue on one chain so
  // overlapping calls cannot lose each other's change. A failure never breaks
  // the chain for the next.
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const run = tail.then(op);
    tail = run.catch(() => {});
    return run;
  };

  return {
    getLastPosition: () => serial(async () => (await readDoc()).lastPosition),
    setLastPosition: (position) =>
      serial(async () => {
        const doc = await readDoc();
        await writeDoc({ ...doc, lastPosition: position });
      }),
    getRecents: () => serial(async () => (await readDoc()).recents),
    addRecent: (hymnbookId, hymnNumber) =>
      serial(async () => {
        const doc = await readDoc();
        const rest = doc.recents.filter(
          (entry) => entry.hymnbookId !== hymnbookId || entry.hymnNumber !== hymnNumber,
        );
        const recents = [{ hymnbookId, hymnNumber, viewedAt: Date.now() }, ...rest].slice(
          0,
          MAX_RECENTS,
        );
        await writeDoc({ ...doc, recents });
      }),

    dropRecents: (hymnbookId) =>
      serial(async () => {
        const doc = await readDoc();
        await writeDoc({
          ...doc,
          recents: doc.recents.filter((entry) => entry.hymnbookId !== hymnbookId),
        });
      }),

    getPreferences: () =>
      serial(async () => {
        // Merged over the defaults, so a document saved before a preference
        // existed still loads complete — no migration needed. Each stored field
        // was checked on read (`cleanUserDoc`). A renamed one is read under its
        // old name: `pinRefrain`, now `pinChorus` (ADR-0025). `partLabels`
        // merged into the part cue: on if either was on (SDD-0005 § 1).
        const { pinRefrain, partLabels, ...stored } = ((await readDoc()).preferences ??
          {}) as Partial<Preferences> & {
          pinRefrain?: boolean;
          partLabels?: boolean;
        };
        // The cues once set list only what is on; the labels were on unless
        // turned off. A document that still holds `partLabels` merges the two; one
        // with cues that never named the part keeps it on; once the part cue is
        // named (written by a save) it is that cue's alone.
        const cues =
          stored.outputCues ??
          (partLabels === false ? { ...DEFAULT_OUTPUT_CUES, part: false } : undefined);
        const outputCues = cues
          ? {
              ...cues,
              part: partLabels === undefined ? (cues.part ?? true) : !!cues.part || partLabels,
            }
          : undefined;
        return {
          ...DEFAULT_PREFERENCES,
          ...(pinRefrain === undefined ? {} : { pinChorus: pinRefrain }),
          ...stored,
          ...(outputCues ? { outputCues } : {}),
        };
      }),

    setPreferences: (preferences) =>
      serial(async () => {
        const doc = await readDoc();
        // What a newer app stored under names this one does not know stays.
        const foreign = Object.fromEntries(
          Object.entries(doc.preferences ?? {}).filter(([key]) => !KNOWN_PREFERENCES.has(key)),
        );
        await writeDoc({ ...doc, preferences: { ...foreign, ...preferences } });
      }),

    onMemoryFallback(listener) {
      if (memory) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    backupDoc: () => serial(readDoc),

    restore: (raw, held) =>
      serial(async () => {
        const doc = await readDoc();
        await writeDoc(mergeRestoredDoc(doc, cleanUserDoc(raw), held));
      }),

    async reset() {
      const closing = dbPromise;
      dbPromise = undefined;
      await closing?.then((db) => db.close()).catch(() => {});
      await deleteDB(dbName);
    },
  };
}

export const userState: UserStateHandle = openUserState("hymnal-user-state");
