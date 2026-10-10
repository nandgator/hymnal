import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { expect, vi } from "vitest";
import type { BookRow, ContentAdmin, ContentStore } from "./persistence/content-store.ts";
import type { UserStateHandle } from "./persistence/user-state.ts";

// Shared by the App.*.test.tsx files. `vi.mock` is hoisted per file, so each
// file declares its own and builds the doubles with the factories here.

export const mocks = {
  rows: [] as import("./persistence/content-store.ts").BookRow[],
  recents: [] as import("./persistence/user-state.ts").RecentEntry[],
  addRecent: vi.fn(async (_book: string, _number: number) => {}),
  admin: {} as Record<string, unknown>,
  /** Stored preferences a test sets before it renders. */
  prefs: {} as Record<string, unknown>,
  /** The shell's listener for user state going to memory (SDD-0001 §11.1). */
  fallback: (() => {}) as () => void,
  /** Whether removing a song of Assorted Hymns takes its last one, and so the book. */
  assortedLast: true,
  /** What the Finder's lyric search finds across the books. */
  searchAll: vi.fn(
    async (
      _query: string,
      _currentKey: string,
    ): Promise<import("./persistence/search.ts").BookHits[]> => [],
  ),
};

export function contentStoreMock() {
  const store: ContentStore = {
    ensureInstalled: async () => ({ state: "ready" }),
    getHymnbook: async () => ({
      id: "mal-ymef-athmeeya-geethangal-16",
      title: "Mocked Hymnbook",
      language: "ml",
      script: "Malayalam",
      hymnCount: 1,
    }),
    listHymns: async () => [{ number: 1, title: "Mocked Hymn" }],
    getHymn: async (hymnbookId, number) => ({
      hymnbookId,
      number,
      title: number === 1 ? "Mocked Hymn" : `Mocked Hymn ${number}`,
      // Song 3 has two parts, for the tests that step through one.
      parts:
        number === 3
          ? [
              { id: "s1", kind: "stanza", label: "1", lines: ["First line"] },
              { id: "s2", kind: "stanza", label: "2", lines: ["Second line"] },
            ]
          : [{ id: "s1", kind: "stanza", lines: ["A line"] }],
      sequence: number === 3 ? [{ partId: "s1" }, { partId: "s2" }] : [{ partId: "s1" }],
      meta: {},
    }),
    searchLyrics: async () => [],
    searchAll: (query, currentKey) => mocks.searchAll(query, currentKey),
  };
  const row: BookRow = {
    key: "mal-ymef-athmeeya-geethangal-16",
    origin: "mal-ymef-athmeeya-geethangal-16",
    kind: "shipped",
    file: "/mal-ymef-athmeeya-geethangal-16.sqlite3",
    title: "Mocked Hymnbook",
    language: "ml",
    script: "Mlym",
    songs: 1,
    addedAt: 1,
    state: "ok",
  };
  mocks.rows = [row];
  const admin: Partial<ContentAdmin> = {
    listBooks: async () => mocks.rows,
    openBook: async () => ({ state: "ready" }),
    storageMode: async () => "opfs",
    review: async () => ({
      token: "t",
      sourceHash: "a".repeat(64),
      title: "Hymns of Fellowship",
      language: "en",
      script: "Latn",
      origin: "hof",
      songCount: 3,
      violations: [],
      verdict: { kind: "new" },
      held: { count: 0, books: [] },
    }),
    commit: async () => {
      mocks.rows = [
        ...mocks.rows,
        {
          ...row,
          key: "k1",
          kind: "loaded",
          title: "Hymns of Fellowship",
          songs: 3,
        },
      ];
      return { ok: true, action: "loaded", key: "k1", firstLoad: true };
    },
    cancel: async () => true,
    removeBook: async (key: string) => {
      mocks.rows = mocks.rows.filter((book) => book.key !== key);
      return true;
    },
    removeAssortedSong: async () => {
      if (mocks.assortedLast) mocks.rows = mocks.rows.filter((book) => book.kind !== "assorted");
      return { removed: true, key: "as1", bookRemoved: mocks.assortedLast };
    },
  };
  mocks.admin = admin;
  return {
    getContentStore: () => store,
    getContentAdmin: () => admin,
    forgetBook: () => {},
  };
}

export function userStateMock(original: typeof import("./persistence/user-state.ts")) {
  const userState: UserStateHandle = {
    getLastPosition: async () => undefined,
    setLastPosition: async () => {},
    getRecents: async () => mocks.recents,
    addRecent: (book, number) => mocks.addRecent(book, number),
    dropRecents: async () => {},
    dropSong: async () => {},
    getPreferences: async () => ({
      theme: "system",
      fontScale: 1,
      ...mocks.prefs,
    }),
    setPreferences: async () => {},
    onMemoryFallback: (listener) => {
      mocks.fallback = listener;
      return () => {};
    },
    mode: () => "idb",
    reset: async () => {},
    backupDoc: async () => ({ version: 1, recents: [] }),
    restore: async () => {},
  };
  return { ...original, userState };
}

/** The app's update: ready or not, as a test sets it. */
export const updates = { set: (_ready: boolean) => {} };
export function updatesMock(real: typeof import("./shell/updates.ts")) {
  return {
    ...real,
    createAppUpdates: () => {
      const [ready, setReady] = createSignal(false);
      updates.set = setReady;
      return { ready, restart: () => {} };
    },
  };
}

/** Present Here's view throws when a test says so (SDD-0001 §16.9). */
export const view = { throws: false };
export function outputViewMock(real: typeof import("./output/OutputView.tsx")) {
  return {
    ...real,
    OutputView: (props: Parameters<typeof real.OutputView>[0]) => {
      if (view.throws) throw new Error("view broke");
      return real.OutputView(props);
    },
  };
}

/** The Library has listed the books: the first run's wait is over. */
export const booksReady = () => screen.findByRole("heading", { name: "Library" });

/** Opens the Output window, once a book is held (it is off until then): the
 * O key, the explicit choice. The Go Live button decides by the screens
 * (SDD-0001 §16.7), and has its own tests. */
export async function clickGoLive() {
  const button = screen.getByRole("button", { name: "Go Live" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.keyDown(window, { key: "o" });
}

/** End Live by its key, Shift+E (SDD-0001 §16.4): its button is in Live's
 * toolbar, with a song open. */
export function endLiveFromMenu() {
  fireEvent.keyDown(window, { key: "E", shiftKey: true });
}

/** Present, from the rail: the Finder of the current book. */
export async function openFinder() {
  await booksReady();
  const present = within(screen.getByRole("navigation", { name: "Sections" })).getByRole("button", {
    name: "Present",
  });
  await waitFor(() => expect(present).toBeEnabled());
  fireEvent.click(present);
}
