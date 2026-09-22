import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { HymnbookId, HymnNumber, Position } from "../domain/types.ts";

export interface RecentEntry {
  hymnbookId: HymnbookId;
  hymnNumber: HymnNumber;
  viewedAt: number;
}

/**
 * Small, mutable, irreplaceable — see ADR-0008 and SDD-0001 §11. One document
 * per install; nothing here is queried, only read and replaced whole.
 */
export interface UserState {
  getLastPosition(): Promise<Position | undefined>;
  setLastPosition(position: Position): Promise<void>;
  getRecents(): Promise<RecentEntry[]>;
  addRecent(hymnbookId: HymnbookId, hymnNumber: HymnNumber): Promise<void>;
}

const STORE = "state";
const KEY = "root";
const MAX_RECENTS = 20;

interface StateDoc {
  lastPosition?: Position;
  recents: RecentEntry[];
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
  };
}

export const userState: UserState = openUserState("hymnal-user-state");
