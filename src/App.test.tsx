import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.tsx";
import type { BookRow, ContentAdmin, ContentStore } from "./persistence/content-store.ts";
import type { UserStateHandle } from "./persistence/user-state.ts";

const mocks = vi.hoisted(() => ({
  rows: [] as import("./persistence/content-store.ts").BookRow[],
  recents: [] as import("./persistence/user-state.ts").RecentEntry[],
  addRecent: vi.fn(async (_book: string, _number: number) => {}),
  admin: {} as Record<string, unknown>,
  /** Stored preferences a test sets before it renders. */
  prefs: {} as Record<string, unknown>,
  /** The shell's listener for user state going to memory (SDD-0001 §11.1). */
  fallback: (() => {}) as () => void,
}));

vi.mock("./persistence/content-store.ts", () => {
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
        { ...row, key: "k1", kind: "loaded", title: "Hymns of Fellowship", songs: 3 },
      ];
      return { ok: true, action: "loaded", key: "k1", firstLoad: true };
    },
    cancel: async () => true,
    removeBook: async (key: string) => {
      mocks.rows = mocks.rows.filter((book) => book.key !== key);
      return true;
    },
  };
  mocks.admin = admin;
  return { getContentStore: () => store, getContentAdmin: () => admin, forgetBook: () => {} };
});

vi.mock("./persistence/user-state.ts", async (importOriginal) => {
  const userState: UserStateHandle = {
    getLastPosition: async () => undefined,
    setLastPosition: async () => {},
    getRecents: async () => mocks.recents,
    addRecent: (book, number) => mocks.addRecent(book, number),
    dropRecents: async () => {},
    getPreferences: async () => ({ theme: "system", fontScale: 1, ...mocks.prefs }),
    setPreferences: async () => {},
    onMemoryFallback: (listener) => {
      mocks.fallback = listener;
      return () => {};
    },
    reset: async () => {},
    backupDoc: async () => ({ version: 1, recents: [] }),
    restore: async () => {},
  };
  return { ...(await importOriginal<typeof import("./persistence/user-state.ts")>()), userState };
});

// The app's update: ready or not, as a test sets it.
const updates = vi.hoisted(() => ({ set: (_ready: boolean) => {} }));
vi.mock("./shell/updates.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./shell/updates.ts")>();
  const { createSignal } = await import("solid-js");
  return {
    ...real,
    createAppUpdates: () => {
      const [ready, setReady] = createSignal(false);
      updates.set = setReady;
      return { ready, restart: () => {} };
    },
  };
});

// Present Here's view throws when a test says so (SDD-0001 §16.9).
const view = vi.hoisted(() => ({ throws: false }));
vi.mock("./output/OutputView.tsx", async (importOriginal) => {
  const real = await importOriginal<typeof import("./output/OutputView.tsx")>();
  return {
    ...real,
    OutputView: (props: Parameters<typeof real.OutputView>[0]) => {
      if (view.throws) throw new Error("view broke");
      return real.OutputView(props);
    },
  };
});

/** The Library has listed the books: the first run's wait is over. */
const booksReady = () => screen.findByRole("heading", { name: "Library" });

/** Opens the Output window, once a book is held (it is off until then): the
 * O key, the explicit choice. The Go Live button decides by the screens
 * (SDD-0001 §16.7), and has its own tests. */
async function clickGoLive() {
  const button = screen.getByRole("button", { name: "Go Live" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.keyDown(window, { key: "o" });
}

/** End Live by its key, Shift+E (SDD-0001 §16.4): its button is in Live's
 * toolbar, with a song open. */
function endLiveFromMenu() {
  fireEvent.keyDown(window, { key: "E", shiftKey: true });
}

/** Present, from the rail: the Finder of the current book. */
async function openFinder() {
  await booksReady();
  const present = within(screen.getByRole("navigation", { name: "Sections" })).getByRole("button", {
    name: "Present",
  });
  await waitFor(() => expect(present).toBeEnabled());
  fireEvent.click(present);
}

describe("App: the books held (SDD-0004 §9, §10)", () => {
  const second = (over: Partial<BookRow> = {}): BookRow => ({
    key: "k1",
    origin: "hof",
    kind: "loaded",
    file: "/k1.1.sqlite3",
    title: "Hymns of Fellowship",
    language: "en",
    script: "Latn",
    songs: 275,
    addedAt: 2,
    state: "ok",
    ...over,
  });
  const first = () => ({ ...(mocks.rows[0] as BookRow) });

  afterEach(() => {
    mocks.recents = [];
    mocks.rows = [first()];
  });

  it("starts on the book of the newest recent that is still held", async () => {
    mocks.rows = [first(), second()];
    mocks.recents = [
      { hymnbookId: "gone", hymnNumber: 1, viewedAt: 3 },
      { hymnbookId: "k1", hymnNumber: 4, viewedAt: 2 },
    ];
    render(() => <App />);
    const crumbs = within(await screen.findByRole("navigation", { name: "Hymnbook and song" }));
    expect(await crumbs.findByText("Hymns of Fellowship")).toBeInTheDocument();
  });

  it("starts on the first held book with no recents", async () => {
    mocks.rows = [first(), second()];
    render(() => <App />);
    const crumbs = within(await screen.findByRole("navigation", { name: "Hymnbook and song" }));
    expect(await crumbs.findByText("Mocked Hymnbook")).toBeInTheDocument();
  });

  it("reaches About from the sections", async () => {
    mocks.rows = [first()];
    render(() => <App />);
    const sections = within(await screen.findByRole("navigation", { name: "Sections" }));
    fireEvent.click(sections.getByRole("button", { name: "About" }));
    expect(await screen.findByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(sections.getByRole("button", { name: "About" })).toHaveAttribute("aria-current", "page");
  });

  it("lists every readable book in the hymnbook picker, and chooses one", async () => {
    mocks.rows = [
      first(),
      second(),
      second({ key: "bad", title: "Broken", state: "needs-reloading" }),
    ];
    render(() => <App />);
    const crumbs = within(await screen.findByRole("navigation", { name: "Hymnbook and song" }));
    fireEvent.click(await crumbs.findByRole("button", { name: /Mocked Hymnbook/ }));
    const books = within(await screen.findByRole("dialog", { name: "Hymnbooks" }));
    expect(books.queryByRole("button", { name: /Broken/ })).not.toBeInTheDocument();
    fireEvent.click(books.getByRole("button", { name: /Hymns of Fellowship/ }));
    expect(await crumbs.findByText("Hymns of Fellowship")).toBeInTheDocument();
  });

  describe("a book chosen is where the search looks; the song's book stays the song's", () => {
    const crumbs = () => within(screen.getByRole("navigation", { name: "Hymnbook and song" }));

    /** Two books, the second (Fellowship) the newest recent, so the Finder starts there; its song 1 is up. */
    async function fellowshipSongUp() {
      mocks.rows = [first(), second()];
      mocks.recents = [{ hymnbookId: "k1", hymnNumber: 1, viewedAt: 2 }];
      render(() => <App />);
      await openFinder();
      fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
        target: { value: "1" },
      });
      fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
      await screen.findByRole("img", { name: "Live output preview" });
    }

    const chooseFromHeader = async (title: RegExp) => {
      fireEvent.click(
        crumbs().getByRole("button", { name: /Hymns of Fellowship|Mocked Hymnbook/ }),
      );
      const books = within(await screen.findByRole("dialog", { name: "Hymnbooks" }));
      fireEvent.click(books.getByRole("button", { name: title }));
      return within(await screen.findByRole("dialog", { name: "Go to a Song" }));
    };

    it("the crumb shows the song's own book, and the other book only after one of its songs is picked", async () => {
      await fellowshipSongUp();
      expect(crumbs().getByRole("button", { name: /Hymns of Fellowship/ })).toBeInTheDocument();

      const picker = await chooseFromHeader(/Mocked Hymnbook/);
      // The Finder is aimed at the chosen book, and says so; the song and its book are untouched.
      expect(picker.getByText("Mocked Hymnbook")).toBeInTheDocument();
      expect(crumbs().getByRole("button", { name: /Hymns of Fellowship/ })).toBeInTheDocument();
      expect(crumbs().queryByRole("button", { name: /Mocked Hymnbook/ })).not.toBeInTheDocument();
      expect(crumbs().getByRole("button", { name: /#1/ })).toBeInTheDocument();

      fireEvent.input(picker.getByRole("combobox", { name: "Find a song" }), {
        target: { value: "2" },
      });
      fireEvent.submit(picker.getByRole("combobox").closest("form") as HTMLFormElement);
      await screen.findByRole("button", { name: /#2\s*Mocked Hymn 2/ });
      expect(crumbs().getByRole("button", { name: /Mocked Hymnbook/ })).toBeInTheDocument();
      expect(
        crumbs().queryByRole("button", { name: /Hymns of Fellowship/ }),
      ).not.toBeInTheDocument();
    });

    it("a Finder closed by anything else, such as another sheet opening, puts the search back too", async () => {
      await fellowshipSongUp();
      const sections = within(screen.getByRole("navigation", { name: "Sections" }));
      fireEvent.click(sections.getByRole("button", { name: "Library" }));
      await booksReady();
      fireEvent.click(
        await within(screen.getByRole("list", { name: "Books" })).findByRole("button", {
          name: /^Mocked Hymnbook/,
        }),
      );
      await screen.findByRole("dialog", { name: "Go to a Song" });
      // Settings opens over the picker, which closes without a pick, and is closed again.
      fireEvent.keyDown(window, { key: ",", ctrlKey: true });
      await screen.findByRole("dialog", { name: "Settings" });
      fireEvent.keyDown(window, { key: ",", ctrlKey: true });
      fireEvent.click(sections.getByRole("button", { name: "Library" }));
      await booksReady();
      const list = within(screen.getByRole("list", { name: "Books" }));
      await waitFor(() =>
        expect(list.getByRole("button", { name: /^Hymns of Fellowship/ })).toHaveAttribute(
          "aria-current",
          "true",
        ),
      );
      expect(list.getByRole("button", { name: /^Mocked Hymnbook/ })).not.toHaveAttribute(
        "aria-current",
      );
    });

    it("a song picked from the other book is recorded once, under that book", async () => {
      await fellowshipSongUp();
      await waitFor(() => expect(mocks.addRecent).toHaveBeenCalledWith("k1", 1));
      mocks.addRecent.mockClear();
      const picker = await chooseFromHeader(/Mocked Hymnbook/);
      fireEvent.input(picker.getByRole("combobox", { name: "Find a song" }), {
        target: { value: "2" },
      });
      fireEvent.submit(picker.getByRole("combobox").closest("form") as HTMLFormElement);
      await screen.findByRole("button", { name: /#2\s*Mocked Hymn 2/ });
      await new Promise((r) => setTimeout(r, 50));
      expect(mocks.addRecent.mock.calls).toEqual([["mal-ymef-athmeeya-geethangal-16", 2]]);
    });

    it("a Finder closed without a pick leaves the search where the song is", async () => {
      await fellowshipSongUp();
      const picker = await chooseFromHeader(/Mocked Hymnbook/);
      expect(picker.getByText("Mocked Hymnbook")).toBeInTheDocument();
      fireEvent.click(picker.getByRole("button", { name: "Close" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Go to a Song" })).not.toBeInTheDocument(),
      );
      fireEvent.click(crumbs().getByRole("button", { name: /#1/ }));
      const again = within(await screen.findByRole("dialog", { name: "Go to a Song" }));
      expect(again.getByText("Hymns of Fellowship")).toBeInTheDocument();
    });

    it("a book tapped in the Library opens the Finder on it, over the song, focused", async () => {
      await fellowshipSongUp();
      const sections = within(screen.getByRole("navigation", { name: "Sections" }));
      fireEvent.click(sections.getByRole("button", { name: "Library" }));
      await booksReady();
      fireEvent.click(
        await within(screen.getByRole("list", { name: "Books" })).findByRole("button", {
          name: /^Mocked Hymnbook/,
        }),
      );
      const picker = within(await screen.findByRole("dialog", { name: "Go to a Song" }));
      expect(picker.getByText("Mocked Hymnbook")).toBeInTheDocument();
      await waitFor(() => expect(picker.getByRole("combobox")).toHaveFocus());
      // Back on Present, with the song still up and its own book on the crumb.
      expect(crumbs().getByRole("button", { name: /Hymns of Fellowship/ })).toBeInTheDocument();
    });

    it("with no song up, the Finder in the page is aimed at the chosen book and has the focus", async () => {
      mocks.rows = [first(), second()];
      render(() => <App />);
      await openFinder();
      fireEvent.click(crumbs().getByRole("button", { name: /Mocked Hymnbook/ }));
      const books = within(await screen.findByRole("dialog", { name: "Hymnbooks" }));
      fireEvent.click(books.getByRole("button", { name: /Hymns of Fellowship/ }));
      expect(await screen.findAllByRole("combobox", { name: "Find a song" })).toHaveLength(1);
      expect(await screen.findByText("Searching", { exact: false })).toHaveTextContent(
        "Searching Hymns of Fellowship",
      );
      expect(crumbs().getByRole("button", { name: /Hymns of Fellowship/ })).toBeInTheDocument();
    });
  });

  it("removing the book the hymn on screen is from, with the Output closed, clears the hymn", async () => {
    mocks.rows = [first(), second()];
    mocks.recents = [{ hymnbookId: "k1", hymnNumber: 1, viewedAt: 2 }];
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await within(screen.getByRole("navigation", { name: "Hymnbook and song" })).findByRole(
      "button",
      { name: /#1/ },
    );

    const sections = within(screen.getByRole("navigation", { name: "Sections" }));
    fireEvent.click(sections.getByRole("button", { name: "Library" }));
    fireEvent.click(await screen.findByRole("button", { name: "More for Hymns of Fellowship" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Remove Book" }));
    // The Output has not answered yet, so it counts as live: wait for it to be heard from.
    await waitFor(() => expect(dialog.getByRole("button", { name: "Remove Book" })).toBeEnabled(), {
      timeout: 5000,
    });
    fireEvent.click(dialog.getByRole("button", { name: "Remove Book" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "More for Hymns of Fellowship" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(sections.getByRole("button", { name: "Present" }));
    // No hymn is left up: the Finder, not the Presenter.
    expect(await screen.findByRole("combobox", { name: "Find a song" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("navigation", { name: "Hymnbook and song" })).queryByRole("button", {
        name: /#1/,
      }),
    ).not.toBeInTheDocument();
  });

  it("refuses to remove the book on the Output while it is live (the Output has not answered yet)", async () => {
    mocks.rows = [first(), second()];
    mocks.recents = [{ hymnbookId: "k1", hymnNumber: 1, viewedAt: 2 }];
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await within(screen.getByRole("navigation", { name: "Hymnbook and song" })).findByRole(
      "button",
      { name: /#1/ },
    );
    const sections = within(screen.getByRole("navigation", { name: "Sections" }));
    fireEvent.click(sections.getByRole("button", { name: "Library" }));
    fireEvent.click(await screen.findByRole("button", { name: "More for Hymns of Fellowship" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Remove Book" }));
    expect(dialog.getByRole("button", { name: "Remove Book" })).toBeDisabled();
    expect(dialog.getByRole("alert")).toHaveTextContent(/End Live first/);
  });

  it("shows the keep-your-file note after a first load when storage was refused, and Got It puts it away", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      storage: { persist: async () => false, persisted: async () => false },
    });
    try {
      render(() => <App />);
      await booksReady();
      const input = screen.getByTestId("book-file");
      fireEvent.change(input, { target: { files: [new File(["x"], "hof.hymnbook.json.gz")] } });
      const dialog = within(await screen.findByRole("dialog", { name: "Load Books" }));
      fireEvent.click(dialog.getByRole("button", { name: "Load Book" }));
      const note = await screen.findAllByText(/Your browser may clear stored books/);
      expect(note.length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: "Got It" }));
      await waitFor(() =>
        expect(screen.queryByText(/Your browser may clear stored books/)).not.toBeInTheDocument(),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says how many books were left unloaded when the review of several is closed", async () => {
    render(() => <App />);
    await booksReady();
    const files = ["a", "b", "c"].map((n) => new File(["x"], `${n}.hymnbook.json.gz`));
    fireEvent.change(screen.getByTestId("book-file"), { target: { files } });
    const dialog = within(await screen.findByRole("dialog", { name: "Load Books" }));
    expect(await dialog.findByText("Book 1 of 3")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Close" }));
    expect((await screen.findAllByText("3 books not loaded")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Got It" }));
    await waitFor(() => expect(screen.queryByText("3 books not loaded")).not.toBeInTheDocument());
  });

  it("says once that settings and recents won’t be kept when user state falls to memory, and Got It puts it away", async () => {
    render(() => <App />);
    await booksReady();
    const text = "Settings and recents won’t be kept this time.";
    expect(screen.queryByText(text)).not.toBeInTheDocument();
    mocks.fallback();
    expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Got It" }));
    await waitFor(() => expect(screen.queryByText(text)).not.toBeInTheDocument());
  });
});

describe("App", () => {
  it("renders the Library, listing the books held, the current one marked", async () => {
    render(() => <App />);
    expect(await screen.findByRole("heading", { name: "Library" })).toBeInTheDocument();
    const list = within(await screen.findByRole("list", { name: "Books" }));
    const book = list.getByRole("button", { name: /^Mocked Hymnbook/ });
    await waitFor(() => expect(book).toHaveAttribute("aria-current", "true"));
  });

  it("moves to Finder once the user chooses to find a hymn", async () => {
    render(() => <App />);
    await openFinder();
    expect(await screen.findByPlaceholderText("Song number or lyrics")).toBeInTheDocument();
  });

  it("switches sections from the rail: Present, then back to the Library", async () => {
    render(() => <App />);
    await openFinder();
    const sections = within(screen.getByRole("navigation", { name: "Sections" }));
    expect(sections.getByRole("button", { name: "Present" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(sections.getByRole("button", { name: "Library" }));
    expect(await screen.findByRole("heading", { name: "Library" })).toBeInTheDocument();
  });

  it("opens the Presenter once a hymn is picked in Finder", async () => {
    render(() => <App />);
    await openFinder();

    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);

    expect(await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ })).toBeInTheDocument();
  });

  it("hot-swaps to another hymn from the switcher row, staying in the Presenter (SDD-0001 §16.4)", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);

    fireEvent.click(await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ }));
    const picker = within(await screen.findByRole("dialog", { name: "Go to a Song" }));
    fireEvent.input(picker.getByRole("combobox", { name: "Find a song" }), {
      target: { value: "2" },
    });
    fireEvent.submit(picker.getByRole("combobox").closest("form") as HTMLFormElement);

    expect(await screen.findByRole("button", { name: /#2\s*Mocked Hymn 2/ })).toBeInTheDocument();
    // Still presenting: the dock never left the screen.
    expect(screen.getByRole("navigation", { name: "Navigate" })).toBeInTheDocument();
  });

  it("choosing a hymnbook with no hymn up shows one Finder, not a picker over it", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.click(await screen.findByRole("button", { name: /Mocked Hymnbook/ }));
    const books = within(await screen.findByRole("dialog", { name: "Hymnbooks" }));
    fireEvent.click(books.getByRole("button", { name: /Mocked Hymnbook/ }));

    expect(await screen.findAllByRole("combobox", { name: "Find a song" })).toHaveLength(1);
  });

  it("Present with a hymn already up returns to it; the Hymnbooks picker has no Manage Books", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ });

    const sections = within(screen.getByRole("navigation", { name: "Sections" }));
    fireEvent.click(sections.getByRole("button", { name: "Library" }));
    await booksReady();
    fireEvent.click(sections.getByRole("button", { name: "Present" }));
    expect(await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Mocked Hymnbook/ }));
    const books = within(await screen.findByRole("dialog", { name: "Hymnbooks" }));
    // The Library is in the navigation.
    expect(books.queryByRole("button", { name: "Manage Books" })).not.toBeInTheDocument();
  });

  it("opens the Output as a named window, so a second click reuses it", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());

    fireEvent.keyDown(window, { key: "o" });

    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\?output=1$/),
      "hymnal-output",
      "popup",
    );
  });

  it("keeps Go Live off until a book is loaded: the button, the O key and the command menu", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const held = mocks.rows;
    mocks.rows = [];
    try {
      render(() => <App />);
      await screen.findByRole("heading", { name: "Bring a songbook" });
      const goLive = screen.getByRole("button", { name: "Go Live" });
      expect(goLive).toBeDisabled();
      expect(goLive).toHaveAttribute("aria-description", "Load a songbook first");
      fireEvent.keyDown(window, { key: "o" });
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      expect(open).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();
    } finally {
      mocks.rows = held;
    }
  });

  it("enables Go Live once any book is loaded, with no song chosen", async () => {
    render(() => <App />);
    await booksReady();
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Go Live" })).not.toHaveAttribute("aria-description");
  });

  it("renders only the chrome-less Output when loaded with ?output=1", () => {
    window.history.replaceState(null, "", "/?output=1");
    render(() => <App />);

    expect(screen.queryByRole("button", { name: "Go Live" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Display" })).not.toBeInTheDocument();
  });

  it("opens the command menu with Ctrl+K or /, and the shortcut sheet with ? (SDD-0001 §16.5)", async () => {
    render(() => <App />);
    // The menu waits for a hymnbook to search.
    await booksReady();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    expect(within(menu).getByRole("option", { name: /Blank the Output/ })).toBeInTheDocument();
    // Ctrl+K again closes it, even from inside its text box.
    fireEvent.keyDown(within(menu).getByRole("combobox"), { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "/" });
    expect(await screen.findByRole("dialog", { name: "Search" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    fireEvent.keyDown(window, { key: "?" });
    const sheet = await screen.findByRole("dialog", { name: "Keyboard Shortcuts" });
    expect(within(sheet).getByText("Blank the Output / restore")).toBeInTheDocument();
  });

  it("steps with keys pressed in the Output window, even with a sheet open here", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });
    // The mock hymn has one line: Down gives it line focus.
    const focused = () =>
      screen.getByRole("button", { name: "A line" }).getAttribute("aria-current");

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Settings" });
    // A key typed here still goes to the sheet, not the Operator.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(focused()).toBeNull();

    const outputWindow = new BroadcastChannel("hymnal-output");
    outputWindow.postMessage({ type: "key", key: "ArrowDown", shiftKey: false });
    await waitFor(() => expect(focused()).toBe("true"));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    outputWindow.close();
  });

  it("offers Repeat, then Undo repeat, in the command menu while presenting", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    let menu = await screen.findByRole("dialog", { name: "Search" });
    expect(within(menu).queryByRole("option", { name: /Undo Repeat/ })).not.toBeInTheDocument();
    // Wide enough for two groups (jsdom matches every query): they're offered.
    expect(within(menu).getByRole("option", { name: /Merge the Tabs/ })).toBeInTheDocument();
    fireEvent.mouseDown(within(menu).getByRole("option", { name: /Repeat This Part/ }));
    expect(document.querySelector(".repeat-count")).toHaveTextContent(/^×2/);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    menu = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.mouseDown(within(menu).getByRole("option", { name: /Undo Repeat/ }));
    expect(document.querySelector(".repeat-count")).toBeEmptyDOMElement();
  });

  /** Opens a hymn in the Presenter, the way a person would. */
  async function openHymn() {
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });
  }

  it("shows each action's key in the command menu, from the keymap; Show the details now has none", async () => {
    render(() => <App />);
    await openHymn();
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    const hintOf = (name: RegExp) =>
      within(menu).getByRole("option", { name }).querySelector("kbd")?.textContent;

    expect(hintOf(/Repeat This Part/)).toBe("R");
    expect(hintOf(/Undo Repeat/)).toBe("U");
    expect(hintOf(/Blank the Output/)).toBe("B");
    expect(hintOf(/Text Size Up/)).toBe("+");
    expect(hintOf(/Text Size Down/)).toBe("−");
    expect(hintOf(/Hide Live/)).toBe("L");
    // Occasional actions have no key (SDD-0001 §16.5).
    expect(hintOf(/Show the Details Now/)).toBeUndefined();
    expect(hintOf(/Reading Band/)).toBeUndefined();
    expect(within(menu).queryByRole("option", { name: /Reset Repeat/ })).not.toBeInTheDocument();
  });

  it("lists actions as you type in the command menu, ahead of hymns (SDD-0001 §16.5)", async () => {
    render(() => <App />);
    await openHymn();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    const box = within(menu).getByRole("combobox");

    fireEvent.input(box, { target: { value: "bl" } });
    expect(within(menu).getByRole("option", { name: /Blank the Output/ })).toBeInTheDocument();

    fireEvent.input(box, { target: { value: "open the" } });
    expect(
      within(menu).getByRole("option", { name: /Open the Output Window/ }),
    ).toBeInTheDocument();

    // Cleared, the actions and the book's songs are back.
    fireEvent.input(box, { target: { value: "" } });
    expect(within(menu).getByRole("option", { name: /Blank the Output/ })).toBeInTheDocument();
    expect(within(menu).getByRole("heading", { name: "Songs" })).toBeInTheDocument();
  });

  it("toggles the Output's reading band from the command menu, kept in preferences", async () => {
    render(() => <App />);
    await openHymn();
    const choose = async (name: RegExp) => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      const menu = await screen.findByRole("dialog", { name: "Search" });
      fireEvent.mouseDown(within(menu).getByRole("option", { name }));
    };

    await choose(/Reading Band a Line/);
    await choose(/Reading Band a Part/);
    // Back to the default: the menu offers the line again.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(
      within(await screen.findByRole("dialog", { name: "Search" })).getByRole("option", {
        name: /Reading Band a Line/,
      }),
    ).toBeInTheDocument();
  });

  it("repeats and undoes with R and U pressed in the Output window (SDD-0001 §16.1)", async () => {
    render(() => <App />);
    await openHymn();
    const count = () => document.querySelector(".repeat-count");
    const outputWindow = new BroadcastChannel("hymnal-output");

    outputWindow.postMessage({ type: "key", key: "r", shiftKey: false });
    await waitFor(() => expect(count()).toHaveTextContent(/^×2/));
    outputWindow.postMessage({ type: "key", key: "u", shiftKey: false });
    await waitFor(() => expect(count()).toBeEmptyDOMElement());
    outputWindow.close();
  });

  it("takes a held R or U forwarded from the Output as one press", async () => {
    render(() => <App />);
    await openHymn();
    const count = () => document.querySelector(".repeat-count");
    const outputWindow = new BroadcastChannel("hymnal-output");
    const hold = async (key: string) => {
      outputWindow.postMessage({ type: "key", key, shiftKey: false, repeat: false });
      for (let i = 0; i < 20; i++) {
        outputWindow.postMessage({ type: "key", key, shiftKey: false, repeat: true });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    };

    await hold("r");
    await waitFor(() => expect(count()).toHaveTextContent(/^×2/));
    await hold("u");
    await waitFor(() => expect(count()).toBeEmptyDOMElement());
    outputWindow.close();
  });

  it("titles Go live with its key from the keymap", async () => {
    render(() => <App />);
    await booksReady();
    const settings = screen.getByRole("button", { name: "Settings" });
    expect(settings).toHaveAttribute("title", "Settings (Ctrl+,)");
    expect(settings).toHaveAttribute("aria-keyshortcuts", "Control+,");
    const goLive = screen.getByRole("button", { name: "Go Live" });
    expect(goLive).toHaveAttribute("title", "Go Live: present on this screen (Shift+P)");
    expect(goLive).toHaveAttribute("aria-keyshortcuts", "O");
  });

  it("offers Split and Make main only where two tab groups fit (SDD-0001 §16.5)", async () => {
    // 1400px isn't met; every other query is.
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: !query.includes("1400px"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    expect(within(menu).getByRole("option", { name: /Next Tab/ })).toBeInTheDocument();
    expect(within(menu).queryByRole("option", { name: /the Tabs/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("option", { name: /Main/ })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("blanks the Output with B and restores it with a second press (.)", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });

    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByRole("img", { name: "Live output preview" })).toHaveClass("live-blanked");
    fireEvent.keyDown(window, { key: "." });
    expect(screen.getByRole("img", { name: "Live output preview" })).not.toHaveClass(
      "live-blanked",
    );
  });

  it("opens Settings with Ctrl+,; its shortcut sheet goes Back to it, not closed", async () => {
    render(() => <App />);
    await booksReady();

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const settings = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(within(settings).getByRole("button", { name: /Keyboard Shortcuts/ }));

    const sheet = await screen.findByRole("dialog", { name: "Keyboard Shortcuts" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Keyboard Shortcuts" })).not.toBeInTheDocument();

    // Opened on its own (?), it just closes.
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    fireEvent.keyDown(window, { key: "?" });
    expect(
      within(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).getByRole(
        "button",
        { name: "Close" },
      ),
    ).toBeInTheDocument();
  });

  it("pushes Keyboard Shortcuts inside the one Settings dialog: Back never closes it", async () => {
    render(() => <App />);
    await booksReady();

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const settings = await screen.findByRole("dialog", { name: "Settings" });
    const opened: boolean[] = [];
    new MutationObserver(() => opened.push(settings.hasAttribute("open"))).observe(settings, {
      attributes: true,
      attributeFilter: ["open"],
    });
    fireEvent.click(within(settings).getByRole("button", { name: /Keyboard Shortcuts/ }));
    expect(settings).toHaveAttribute("aria-label", "Keyboard Shortcuts");
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
    // Escape goes back one level.
    fireEvent(settings, new Event("cancel", { cancelable: true }));
    expect(settings).toHaveAttribute("aria-label", "Settings");
    expect(settings).toHaveAttribute("open");
    await Promise.resolve();
    expect(opened).not.toContain(false);
  });

  it("hides Live with L, remembered in preferences, and shows it again (SDD-0001 §16.4)", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });

    fireEvent.keyDown(window, { key: "l" });
    expect(screen.queryByRole("img", { name: "Live output preview" })).not.toBeInTheDocument();
    // Blanked with Live hidden: On Air, in the switcher row, says so.
    const outputWindow = new BroadcastChannel("hymnal-output");
    outputWindow.postMessage({ type: "hello", id: "test-output" });
    expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByRole("button", { name: "Blanked" }).closest(".switcher-row")).not.toBeNull();
    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByRole("button", { name: "On Air" })).toBeInTheDocument();
    outputWindow.close();

    fireEvent.keyDown(window, { key: "L" });
    expect(screen.getByRole("img", { name: "Live output preview" })).toBeInTheDocument();
  });

  it("replays keys pressed in the Output window, as if pressed here (SDD-0001 §16.1)", async () => {
    render(() => <App />);
    await booksReady();

    const outputWindow = new BroadcastChannel("hymnal-output");
    outputWindow.postMessage({ type: "key", key: "?", shiftKey: true });
    expect(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    outputWindow.close();
  });

  describe("Hold (Board #21, SDD-0001 §16.6)", () => {
    // A stand-in Output window: records what it is sent, and says hello.
    async function liveOutput() {
      render(() => <App />);
      await openHymn();
      const output = new BroadcastChannel("hymnal-output");
      const seen: {
        type: string;
        held?: boolean;
        focus?: { start: number; end: number };
        repeat?: number;
      }[] = [];
      output.onmessage = (event) => seen.push(event.data);
      output.postMessage({ type: "hello", id: "test-output" });
      await screen.findByRole("button", { name: "On Air" });
      // The replay to this hello has arrived.
      await waitFor(() => expect(contents(seen)).toHaveLength(1));
      return { output, seen };
    }
    // A hello from a new window is answered with a replay: a fence for what
    // came before it, and what a late window is shown.
    async function replay(output: BroadcastChannel, seen: unknown[], id: string) {
      seen.length = 0;
      output.postMessage({ type: "hello", id });
      await waitFor(() => expect(seen.length).toBeGreaterThan(0));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const contents = <T extends { type: string }>(seen: T[]) =>
      seen.filter((m) => m.type === "content");

    it("holds with Shift+H: navigation never reaches the Output, a late window gets the held content, and Release sends the current", async () => {
      const { output, seen } = await liveOutput();
      const shown = contents(seen).at(-1)?.repeat;
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      expect(await screen.findByRole("button", { name: "Held" })).toBeInTheDocument();
      const hold = screen.getByRole("button", { name: /^Release/ });
      expect(hold).toHaveAttribute("aria-pressed", "true");
      expect(document.querySelector(".live-held-tag")).not.toBeNull();

      fireEvent.keyDown(window, { key: "r" });
      await replay(output, seen, "late");
      expect(contents(seen)).toHaveLength(1);
      expect(contents(seen)[0]?.repeat).toEqual(shown);

      seen.length = 0;
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
      await waitFor(() => expect(contents(seen)).toHaveLength(1));
      expect(seen.map((m) => m.type).slice(0, 2)).toEqual(["hold", "presentation"]);
      expect(contents(seen)[0]?.repeat).not.toEqual(shown);
      expect(document.querySelector(".live-held-tag")).toBeNull();
      output.close();
    });

    it("is a button beside Blank and a command, only while an Output is open", async () => {
      render(() => <App />);
      await openHymn();
      const hold = () => screen.getByRole("button", { name: "Hold" });
      expect(hold()).toBeDisabled();
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      expect(screen.queryByRole("button", { name: "Held" })).not.toBeInTheDocument();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      let menu = await screen.findByRole("dialog", { name: "Search" });
      expect(within(menu).queryByRole("option", { name: /Hold the Output/ })).toBeNull();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());

      const output = new BroadcastChannel("hymnal-output");
      output.postMessage({ type: "hello", id: "test-output" });
      await screen.findByRole("button", { name: "On Air" });
      expect(hold()).toBeEnabled();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      menu = await screen.findByRole("dialog", { name: "Search" });
      const option = within(menu).getByRole("option", { name: /Hold the Output/ });
      expect(option.querySelector(".key-combo")?.textContent).toBe("Shift+H");
      fireEvent.mouseDown(option);
      expect(await screen.findByRole("button", { name: "Held" })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      menu = await screen.findByRole("dialog", { name: "Search" });
      expect(within(menu).getByRole("option", { name: /Release the Output/ })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
      // The button beside Blank releases it.
      fireEvent.click(screen.getByRole("button", { name: /^Release/ }));
      expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
      output.close();
    });

    it("keeps H the highlight toggle, and Blank works on top of Hold", async () => {
      const { output } = await liveOutput();
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      await screen.findByRole("button", { name: "Held" });
      fireEvent.keyDown(window, { key: "b" });
      expect(await screen.findByRole("button", { name: "Blanked" })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "b" });
      expect(await screen.findByRole("button", { name: "Held" })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      await screen.findByRole("button", { name: "On Air" });
      output.close();
    });

    it("End Live cancels the Hold", async () => {
      const { output, seen } = await liveOutput();
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      await screen.findByRole("button", { name: "Held" });
      endLiveFromMenu();
      output.postMessage({ type: "bye", id: "test-output" });
      await screen.findByRole("button", { name: "Go Live" });
      // The next window opens on the current content, not held.
      await replay(output, seen, "next");
      // A held window would be told so last, after the content.
      expect(seen.at(-1)?.type).toBe("content");
      expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
      output.close();
    });

    it("a reloaded Operator adopts the Hold the Output reports", async () => {
      const output = new BroadcastChannel("hymnal-output");
      render(() => <App />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
      output.postMessage({ type: "hello", id: "held", state: { blanked: false, held: {} } });
      expect(await screen.findByRole("button", { name: "Held" })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
      output.close();
    });

    it("lists Hold in the shortcut sheet", async () => {
      render(() => <App />);
      await booksReady();
      fireEvent.keyDown(window, { key: "?" });
      const sheet = await screen.findByRole("dialog", { name: "Keyboard Shortcuts" });
      expect(within(sheet).getByText(/Hold the Output/)).toBeInTheDocument();
    });
  });
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("App: the Output on the projector screen (ADR-0028)", () => {
  const laptop = {
    label: "Color LCD",
    width: 1440,
    height: 900,
    left: 0,
    top: 0,
    isPrimary: true,
    isInternal: true,
  };
  const projector = {
    label: "EPSON PJ",
    width: 1280,
    height: 800,
    left: 1440,
    top: 0,
    isPrimary: false,
    isInternal: false,
  };

  /** A fake second screen: the Window Management API Chromium has, and `isExtended`. */
  function attach(screens: object[], reject?: Error) {
    const details = Object.assign(new EventTarget(), { screens, currentScreen: screens[0] });
    const getScreenDetails = vi.fn(async () => {
      if (reject) throw reject;
      return details;
    });
    Object.assign(window, { getScreenDetails });
    Object.defineProperty(window.screen, "isExtended", { value: true, configurable: true });
    return { details, getScreenDetails };
  }

  afterEach(() => {
    Reflect.deleteProperty(window, "getScreenDetails");
    Reflect.deleteProperty(window.screen, "isExtended");
    vi.restoreAllMocks();
  });

  it("asks for the screens on Go live and opens the Output on the projector", async () => {
    const { getScreenDetails } = attach([laptop, projector]);
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));

    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(getScreenDetails).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\?output=1&placed=1&screen=.+EPSON.+$/),
      "hymnal-output",
      "popup,left=1440,top=0,width=1280,height=800",
    );
    // Nothing has verified the window is there (on Wayland it may not be),
    // so the notice says what to do, not that it is done.
    expect(
      (
        await screen.findAllByText(
          /press F there\) to put it on EPSON PJ, 1280×800/,
          {},
          { timeout: 3000 },
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(noticeText(/The Output is on the projector screen/)).toBe(0);
  });

  it("says it is on the projector screen only once the Output reports it verifiably is", async () => {
    const { output } = await goLive();
    output.postMessage({ type: "placement", onTarget: false, fullscreen: false });
    await screen.findAllByText(/press F there\) to put it on EPSON PJ/, {}, { timeout: 3000 });
    output.postMessage({ type: "placement", onTarget: true, fullscreen: true });
    await screen.findAllByText(/The Output is on the projector screen\./);
    expect(noticeText(/press F there/)).toBe(0);
    output.close();
  });

  it("tells the Operator how to move the Output when the system cannot place windows", async () => {
    const { output } = await goLive();
    output.postMessage({ type: "placement", onTarget: false, fullscreen: false, refused: true });
    await screen.findAllByText(/Move this window to EPSON PJ, 1280×800, then press F\./);
    expect(sessionStorage.getItem("placementRefused")).toBe("1");
    // The grace timer must not replace it with the click hint.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(noticeText(/press F there/)).toBe(0);
    output.postMessage({ type: "placement", onTarget: true, fullscreen: true, refused: true });
    await screen.findAllByText(/The Output is on the projector screen\./);
    expect(noticeText(/Move this window/)).toBe(0);
    sessionStorage.clear();
    output.close();
  });

  it("says the Output is fullscreen but its screen unconfirmed, and what to do", async () => {
    const { output } = await goLive();
    output.postMessage({ type: "placement", onTarget: false, fullscreen: false, refused: true });
    await screen.findAllByText(/Move this window to EPSON PJ/);
    output.postMessage({
      type: "placement",
      onTarget: false,
      fullscreen: true,
      refused: true,
      unconfirmed: true,
    });
    await screen.findAllByText(
      /The Output is fullscreen\. If it isn't on EPSON PJ, 1280×800, press Esc there, move it, and press F again\./,
    );
    expect(noticeText(/The Output is on the projector screen/)).toBe(0);
    sessionStorage.clear();
    output.close();
  });

  it("stays quiet when the Output verified the placement before the grace ran out", async () => {
    const { output } = await goLive();
    output.postMessage({ type: "placement", onTarget: true, fullscreen: true });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(noticeText(/press F there/)).toBe(0);
    expect(noticeText(/The Output is on the projector screen/)).toBe(0);
    output.close();
  });

  it("opens the plain popup, with a one-time drag hint, when the permission is denied", async () => {
    attach([laptop, projector], Object.assign(new Error("no"), { name: "NotAllowedError" }));
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));

    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\?output=1$/),
      "hymnal-output",
      "popup",
    );
    expect((await screen.findAllByText(/Drag the Output to the projector/)).length).toBeGreaterThan(
      0,
    );
  });

  it("opens the plain popup with one screen, without asking", async () => {
    const { getScreenDetails } = attach([laptop]);
    Object.defineProperty(window.screen, "isExtended", { value: false, configurable: true });
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);

    await clickGoLive();

    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(getScreenDetails).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\?output=1$/),
      "hymnal-output",
      "popup",
    );
  });

  it("says so when the browser blocks the window", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(() => <App />);

    await clickGoLive();

    expect((await screen.findAllByText(/blocked the Output window/)).length).toBeGreaterThan(0);
  });

  /** A popup that moves when told, as far as the test needs. */
  const fakeWindow = () => {
    const win = {
      closed: false,
      focus: vi.fn(),
      screenX: 1440,
      screenY: 0,
      outerWidth: 1280,
      outerHeight: 800,
      document: {},
      moveTo: vi.fn((x: number, y: number) => {
        win.screenX = x;
        win.screenY = y;
      }),
      resizeTo: vi.fn(),
    };
    return win;
  };

  /** Goes live on the projector and has an Output answer, so the App is On Air. */
  async function goLive(screens: object[] = [laptop, projector]) {
    const { details } = attach(screens);
    const win = fakeWindow();
    vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
    await waitFor(() => expect(window.open).toHaveBeenCalled());
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    return { details, win, output };
  }
  const unplug = (details: EventTarget & { screens: unknown }) => {
    (details.screens as object[]).splice(1, 1);
    details.dispatchEvent(new Event("screenschange"));
  };
  const replug = (details: EventTarget & { screens: unknown }) => {
    (details.screens as object[]).push(projector);
    details.dispatchEvent(new Event("screenschange"));
  };
  // A notice sliding away (aria-hidden, .snackbar-leaving) is already put away.
  const noticeText = (pattern: RegExp) =>
    screen.queryAllByText(pattern).filter((el) => !el.closest(".snackbar-leaving")).length;

  /** The Output window obeying End Live: it closes, and its bye follows. */
  const closesOnCommand = (output: BroadcastChannel, seen: unknown[]) => {
    output.onmessage = (event) => {
      seen.push(event.data);
      if ((event.data as { type?: string }).type === "close")
        output.postMessage({ type: "bye", id: "test-output" });
    };
  };

  it("ends Live by closing the Output window; Go Live opens it again on the same screen, asking nothing", async () => {
    const { output } = await goLive();
    const seen: unknown[] = [];
    closesOnCommand(output, seen);
    const opened = vi.mocked(window.open).mock.calls.length;

    endLiveFromMenu();
    await waitFor(() => expect(seen).toContainEqual({ type: "close" }));
    expect(await screen.findByRole("button", { name: "Go Live" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "On Air" })).not.toBeInTheDocument();
    await clickGoLive();
    await waitFor(() => expect(vi.mocked(window.open).mock.calls.length).toBe(opened + 1));
    // A new window at the Output's URL, placed on the remembered screen.
    const [url, , features] = vi.mocked(window.open).mock.calls[opened];
    expect(String(url)).toContain("placed=1");
    expect(String(features)).toContain(`left=${projector.left}`);
    output.postMessage({ type: "hello", id: "test-output" });
    expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
    output.close();
  });

  it("says the Output stopped working, and Reopen closes the window and opens it again on the same screen (§16.9)", async () => {
    const { output } = await goLive();
    const seen: unknown[] = [];
    closesOnCommand(output, seen);
    const opened = vi.mocked(window.open).mock.calls.length;

    output.postMessage({ type: "failed" });
    const reopen = await screen.findByRole("button", { name: "Reopen" });
    expect(noticeText(/The Output stopped working/)).toBeGreaterThan(0);
    fireEvent.click(reopen);
    await waitFor(() => expect(seen).toContainEqual({ type: "close" }));
    await waitFor(() => expect(vi.mocked(window.open).mock.calls.length).toBe(opened + 1));
    const [url, , features] = vi.mocked(window.open).mock.calls[opened];
    expect(String(url)).toContain("placed=1");
    expect(String(features)).toContain(`left=${projector.left}`);
    await waitFor(() => expect(noticeText(/The Output stopped working/)).toBe(0));
    output.close();
  });

  it("Reopen, when the window never says bye, closes it by its handle and opens a new one; the notice stays until then", async () => {
    const { output, win } = await goLive();
    (win as unknown as { close: () => void }).close = vi.fn();
    const opened = vi.mocked(window.open).mock.calls.length;
    output.postMessage({ type: "failed" });
    const reopen = await screen.findByRole("button", { name: "Reopen" });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(reopen);
      await vi.advanceTimersByTimeAsync(1000);
      // Still waiting on a window that has not answered: the notice stays.
      expect(noticeText(/The Output stopped working/)).toBeGreaterThan(0);
      expect(vi.mocked(window.open).mock.calls.length).toBe(opened);
      await vi.advanceTimersByTimeAsync(700);
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(vi.mocked(window.open).mock.calls.length).toBe(opened + 1));
    expect((win as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
    await waitFor(() => expect(noticeText(/The Output stopped working/)).toBe(0));
    output.close();
  });

  it("holds the update prompt while live, and shows it once End Live has closed the window (#32)", async () => {
    const { output } = await goLive();
    const seen: unknown[] = [];
    closesOnCommand(output, seen);
    updates.set(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(noticeText(/Update ready/)).toBe(0);
    endLiveFromMenu();
    await screen.findByRole("button", { name: "Go Live" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    await waitFor(() => expect(noticeText(/Update ready/)).toBeGreaterThan(0));
    output.close();
    updates.set(false);
  });

  it("does not raise the fullscreen hint for an Output closed before it was due", async () => {
    // The hint is due a moment after the window opens (to see whether it went
    // fullscreen by itself). Closed by then, it would be about a gone window,
    // and would hold the update notice back for its whole stay.
    const { output } = await goLive();
    updates.set(true);
    output.postMessage({ type: "bye", id: "test-output" });
    await waitFor(() => expect(noticeText(/Update ready/)).toBeGreaterThan(0));
    // Past the grace the hint waits (FULLSCREEN_GRACE_MS in App.tsx).
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(noticeText(/The Output is on the projector screen/)).toBe(0);
    expect(noticeText(/Update ready/)).toBeGreaterThan(0);
    output.close();
    updates.set(false);
  });

  it("a blank the Output holds is adopted too, so Restore is offered", async () => {
    const output = new BroadcastChannel("hymnal-output");
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    output.postMessage({ type: "hello", id: "held", state: { blanked: true } });
    expect(await screen.findByRole("button", { name: "Blanked" })).toBeInTheDocument();
    // Restore (B), so the held blank is not left for the next test.
    fireEvent.keyDown(window, { key: "b" });
    expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
    output.close();
  });

  it("ends Live from the keyboard (Shift+E) and from the command list, only while live", async () => {
    const { output } = await goLive();
    const seen: unknown[] = [];
    closesOnCommand(output, seen);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    const option = within(menu).getByRole("option", { name: /End Live/ });
    expect(option.querySelector(".key-combo")?.textContent).toBe("Shift+E");
    fireEvent.mouseDown(option);
    await waitFor(() => expect(seen).toContainEqual({ type: "close" }));
    expect(await screen.findByRole("button", { name: "Go Live" })).toBeInTheDocument();

    // Closed, there is nothing to end: neither the key nor the command.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const again = await screen.findByRole("dialog", { name: "Search" });
    expect(within(again).queryByRole("option", { name: /End Live/ })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await clickGoLive();
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    seen.length = 0;
    // A plain E does nothing; Shift+E ends it.
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyDown(window, { key: "E", shiftKey: true });
    await waitFor(() => expect(seen).toContainEqual({ type: "close" }));
    expect(seen.filter((m) => (m as { type?: string }).type === "close")).toHaveLength(1);
    await screen.findByRole("button", { name: "Go Live" });
    output.close();
  });

  it("lets Escape put away every screen notice", async () => {
    // blocked
    vi.spyOn(window, "open").mockReturnValue(null);
    const first = render(() => <App />);
    await clickGoLive();
    await screen.findAllByText(/blocked the Output window/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/blocked the Output window/)).toBe(0));
    first.unmount();
    vi.restoreAllMocks();

    // drag (a plain popup once, with a second screen around)
    Object.defineProperty(window.screen, "isExtended", { value: true, configurable: true });
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    const second = render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    fireEvent.keyDown(window, { key: "o" });
    await screen.findAllByText(/Drag the Output to the projector/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/Drag the Output to the projector/)).toBe(0));
    second.unmount();
  });

  it("lets Escape put away the fullscreen, gone and back notices", async () => {
    const { details } = await goLive();
    await screen.findAllByText(/press F there/, {}, { timeout: 3000 });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/press F there/)).toBe(0));

    unplug(details as never);
    await screen.findAllByText(/projector was disconnected/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/projector was disconnected/)).toBe(0));

    // Escaping the gone notice leaves it to come back as an offer; Escape on
    // that offer is Stay, and no more is offered.
    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/That screen is back/)).toBe(0));
    unplug(details as never);
    replug(details as never);
    expect(noticeText(/That screen is back/)).toBe(0);
  });

  it("leaves the Output where it is when its screen goes, and offers it back, never jumping", async () => {
    const { details, win } = await goLive();
    unplug(details as never);
    await screen.findAllByText(/projector was disconnected/);
    expect(win.moveTo).not.toHaveBeenCalled();

    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    expect(win.moveTo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Move It" }));
    await waitFor(() => expect(win.moveTo).toHaveBeenCalledWith(1440, 0));
    await waitFor(() => expect(noticeText(/That screen is back/)).toBe(0));
  });

  it("Stay leaves the Output alone", async () => {
    const { details, win } = await goLive();
    unplug(details as never);
    await screen.findAllByText(/projector was disconnected/);
    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(noticeText(/That screen is back/)).toBe(0));
    expect(win.moveTo).not.toHaveBeenCalled();
  });

  it("offers a projector plugged in while live, never moving the Output by itself", async () => {
    const { details, win } = await goLive([laptop]);
    replug(details as never);

    await screen.findAllByText(/A projector is connected: EPSON PJ, 1280×800/);
    expect(win.moveTo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Move the Output There" }));
    await waitFor(() => expect(win.moveTo).toHaveBeenCalledWith(1440, 0));
    await waitFor(() => expect(noticeText(/A projector is connected/)).toBe(0));
  });

  it("where placement was refused, the offer gives the move guidance instead", async () => {
    sessionStorage.setItem("placementRefused", "1");
    try {
      const { details, win } = await goLive([laptop]);
      replug(details as never);
      await screen.findAllByText(/A projector is connected: EPSON PJ/);

      fireEvent.click(screen.getByRole("button", { name: "Move the Output There" }));

      await screen.findAllByText(/Move this window to EPSON PJ, 1280×800, then press F\./);
      expect(win.moveTo).not.toHaveBeenCalled();
    } finally {
      sessionStorage.removeItem("placementRefused");
    }
  });

  it("says nothing about a plugged-in projector when not live", async () => {
    Object.defineProperty(navigator, "permissions", {
      value: { query: async () => ({ state: "granted" }) },
      configurable: true,
    });
    try {
      const { details, getScreenDetails } = attach([laptop]);
      render(() => <App />);
      await waitFor(() => expect(getScreenDetails).toHaveBeenCalled());
      replug(details as never);
      await new Promise((resolve) => setTimeout(resolve, 700));
      expect(noticeText(/A projector is connected/)).toBe(0);
    } finally {
      Reflect.deleteProperty(navigator, "permissions");
    }
  });

  it("without screen access, a screen appearing is still offered, unnamed", async () => {
    Reflect.deleteProperty(window, "getScreenDetails");
    Object.defineProperty(window.screen, "isExtended", { value: false, configurable: true });
    // jsdom's Screen is no EventTarget; Chromium's is.
    const target = new EventTarget();
    Object.assign(window.screen, {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    });
    const win = fakeWindow();
    vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    render(() => <App />);
    await clickGoLive();
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });

    Object.defineProperty(window.screen, "isExtended", { value: true, configurable: true });
    target.dispatchEvent(new Event("change"));

    await screen.findAllByText(/A projector is connected/);
    output.close();
    for (const key of ["addEventListener", "removeEventListener", "dispatchEvent"])
      Reflect.deleteProperty(window.screen, key);
  });

  it("when the Output's screen goes, says where it is now and offers Blank", async () => {
    const { details, win } = await goLive();
    unplug(details as never);

    await screen.findAllByText(
      /The projector was disconnected; the Output is on Built-in, 1440×900/,
    );
    expect(win.moveTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Blank" }));
    await screen.findByRole("button", { name: "Blanked" });
    await waitFor(() => expect(noticeText(/projector was disconnected/)).toBe(0));
    // Blank is held across the tests: restore it.
    fireEvent.keyDown(window, { key: "b" });
    await screen.findByRole("button", { name: "On Air" });
  });

  it("a burst of screen events is one change: a screen that went and came straight back is no news", async () => {
    const { details } = await goLive();
    unplug(details as never);
    replug(details as never);
    unplug(details as never);
    replug(details as never);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(noticeText(/projector was disconnected/)).toBe(0);
    expect(noticeText(/That screen is back/)).toBe(0);
  });

  it("with one screen at Go Live, explains how to extend a mirrored projector", async () => {
    attach([laptop]);
    Object.defineProperty(window.screen, "isExtended", { value: false, configurable: true });
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    try {
      vi.spyOn(window, "open").mockReturnValue({} as Window);
      render(() => <App />);
      await clickGoLive();
      await screen.findAllByText(/connected as a mirror.*Press Win\+P and choose Extend\./);
    } finally {
      Reflect.deleteProperty(navigator, "platform");
    }
  });

  it("says so when the Output cannot be moved", async () => {
    const { details, win } = await goLive();
    unplug(details as never);
    await screen.findAllByText(/projector was disconnected/);
    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    win.moveTo.mockImplementation(() => {});
    win.screenX = 50;
    fireEvent.click(screen.getByRole("button", { name: "Move It" }));
    await screen.findAllByText(/could not move/, {}, { timeout: 5000 });
  });

  it("moves an open Output when a screen is picked in Settings", async () => {
    const monitor = { ...projector, label: "DELL", width: 2560, height: 1440, left: 2720 };
    const { win } = await goLive([laptop, projector, monitor]);
    fireEvent.click(screen.getByRole("button", { name: /^(Settings|Menu)$/ }));
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: /^Output screen/ }));
      expect(screen.getAllByRole("menuitemradio")).toHaveLength(4);
    });

    fireEvent.click(screen.getByRole("menuitemradio", { name: "DELL, 2560×1440" }));

    await waitFor(() => expect(win.moveTo).toHaveBeenCalledWith(2720, 0));
  });

  it("leaves an open Output alone when any other setting changes, never taking it out of fullscreen", async () => {
    // Every preference change re-runs the screen-choice effect; only a change
    // of the chosen screen may move the Output (a move leaves fullscreen).
    const { win } = await goLive();
    const exitFullscreen = vi.fn(() => Promise.resolve());
    Object.assign(win.document, { fullscreenElement: {}, exitFullscreen });
    fireEvent.click(screen.getByRole("button", { name: /^(Settings|Menu)$/ }));
    const title = await screen.findByRole("switch", { name: /Show song title/ });
    fireEvent.click(title);
    await waitFor(() => expect(title).toBeChecked());
    fireEvent.click(await screen.findByRole("switch", { name: /Show song number/ }));
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(win.moveTo).not.toHaveBeenCalled();
    expect(win.resizeTo).not.toHaveBeenCalled();
  });

  it("gives no drag hint to a single-screen user, with the API or without it", async () => {
    attach([laptop]);
    Object.defineProperty(window.screen, "isExtended", { value: false, configurable: true });
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    fireEvent.keyDown(window, { key: "o" });
    await waitFor(() => expect(open).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(noticeText(/Drag the Output to the projector/)).toBe(0);
  });

  it("gives no drag hint where the browser cannot say (Firefox, Safari)", async () => {
    Reflect.deleteProperty(window, "getScreenDetails");
    Reflect.deleteProperty(window.screen, "isExtended");
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    await clickGoLive();
    await waitFor(() => expect(open).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(noticeText(/Drag the Output to the projector/)).toBe(0);
  });

  it("puts a hint away by itself, so it cannot hold the update notice back", async () => {
    attach([laptop]);
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
    await screen.findAllByText(/Drag the Output to the projector/);
    await waitFor(() => expect(noticeText(/Drag the Output to the projector/)).toBe(0), {
      timeout: 10000,
    });
  }, 15000);
});

describe("App: one-screen presenting (Board #41, SDD-0001 §16.7)", () => {
  const FULLSCREEN = { configurable: true } as const;
  const setFullscreen = (element: Element | null) =>
    Object.defineProperty(document, "fullscreenElement", { ...FULLSCREEN, value: element });
  let requestFullscreen: ReturnType<typeof vi.fn>;
  let exitFullscreen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    requestFullscreen = vi.fn(async () => {
      setFullscreen(document.documentElement);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    exitFullscreen = vi.fn(async () => {
      setFullscreen(null);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.assign(document.documentElement, { requestFullscreen });
    Object.assign(document, { exitFullscreen });
  });
  afterEach(() => {
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    Reflect.deleteProperty(document, "exitFullscreen");
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(window, "getScreenDetails");
    Reflect.deleteProperty(window.screen, "isExtended");
    mocks.prefs = {};
    vi.restoreAllMocks();
  });

  const notices = (pattern: RegExp) =>
    screen.queryAllByText(pattern).filter((el) => !el.closest(".snackbar-leaving")).length;

  /** Song 3 (two parts) is up in the Presenter. */
  async function songUp() {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "3" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });
  }
  const region = () => screen.queryByRole("region", { name: "Presenting on this screen" });
  const lit = () => region()?.querySelector(".output-line-current")?.textContent;
  async function presentHere() {
    fireEvent.click(await screen.findByRole("button", { name: "Go Live" }));
    await screen.findByRole("region", { name: "Presenting on this screen" });
  }

  it("Go Live presents here when no external screen is known, with no second button in the header", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    await songUp();
    // Present Here lives in Live's toolbar, not beside Go Live.
    expect(screen.getAllByRole("button", { name: /Go Live|On Air/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
    await screen.findByRole("region", { name: "Presenting on this screen" });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("queues the failure snackbar while presenting here, blank, and shows it, without Reopen, once left (§16.9)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const noticeText = (pattern: RegExp) =>
      screen.queryAllByText(pattern).filter((el) => !el.closest(".snackbar-leaving")).length;
    try {
      await songUp();
      view.throws = true;
      fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
      const here = await screen.findByRole("region", { name: "Presenting on this screen" });
      await waitFor(() => expect(here.textContent).toBe(""));
      expect(noticeText(/The Output stopped working/)).toBe(0);
      fireEvent.keyDown(window, { key: "f" });
      await waitFor(() => expect(region()).toBeNull());
      await waitFor(() => expect(noticeText(/The Output stopped working/)).toBeGreaterThan(0));
      expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
      expect(screen.getByRole("button", { name: "Got It" })).toBeInTheDocument();
    } finally {
      view.throws = false;
    }
  });

  it("Go Live opens the Output window when Window Management shows a second screen", async () => {
    const screens = [
      { label: "A", width: 1440, height: 900, left: 0, top: 0, isPrimary: true },
      { label: "B", width: 1280, height: 800, left: 1440, top: 0 },
    ];
    Object.assign(window, {
      getScreenDetails: async () =>
        Object.assign(new EventTarget(), { screens, currentScreen: screens[0] }),
    });
    Object.defineProperty(window.screen, "isExtended", { value: true, configurable: true });
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    const goLive = await screen.findByRole("button", { name: "Go Live" });
    await waitFor(() => expect(goLive).toBeEnabled());
    expect(goLive).toHaveAttribute("title", expect.stringContaining("open the Output window"));
    fireEvent.click(goLive);
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(region()).toBeNull();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  describe("the Go Live opens setting", () => {
    const panels = [
      { label: "A", width: 1440, height: 900, left: 0, top: 0, isPrimary: true },
      { label: "B", width: 1280, height: 800, left: 1440, top: 0 },
    ];
    function externalScreen() {
      Object.assign(window, {
        getScreenDetails: async () =>
          Object.assign(new EventTarget(), { screens: panels, currentScreen: panels[0] }),
      });
      Object.defineProperty(window.screen, "isExtended", { value: true, configurable: true });
    }
    const cases = [
      { goLive: "auto", external: false, outcome: "here" },
      { goLive: "auto", external: true, outcome: "window" },
      { goLive: "here", external: false, outcome: "here" },
      { goLive: "here", external: true, outcome: "here" },
      { goLive: "window", external: false, outcome: "window" },
      { goLive: "window", external: true, outcome: "window" },
      { goLive: "nonsense", external: true, outcome: "window" },
      { goLive: "nonsense", external: false, outcome: "here" },
    ];
    for (const { goLive, external, outcome } of cases) {
      it(`${goLive} with ${external ? "an external screen" : "one screen"} goes ${outcome}`, async () => {
        mocks.prefs = { goLive };
        if (external) externalScreen();
        const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
        render(() => <App />);
        const button = await screen.findByRole("button", { name: "Go Live" });
        await waitFor(() => expect(button).toBeEnabled());
        // Let the stored setting and the screens load.
        await waitFor(() =>
          expect(button.title).toContain(outcome === "window" ? "Output window" : "this screen"),
        );
        fireEvent.click(button);
        if (outcome === "window") {
          await waitFor(() => expect(open).toHaveBeenCalled());
          expect(region()).toBeNull();
        } else {
          await screen.findByRole("region", { name: "Presenting on this screen" });
          expect(open).not.toHaveBeenCalled();
        }
      });
    }

    it("leaves O and Shift+P as they are under any setting", async () => {
      mocks.prefs = { goLive: "here" };
      const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
      render(() => <App />);
      const button = await screen.findByRole("button", { name: "Go Live" });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.keyDown(window, { key: "o" });
      await waitFor(() => expect(open).toHaveBeenCalled());
    });
  });

  it("asks the browser for fullscreen on the click and shows the song full-bleed", async () => {
    await songUp();
    await presentHere();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(lit()).toContain("First line");
  });

  it("is also entered from Shift+P and from the command list", async () => {
    await songUp();
    fireEvent.keyDown(window, { key: "P", shiftKey: true });
    await screen.findByRole("region", { name: "Presenting on this screen" });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(region()).toBeNull());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const palette = within(await screen.findByRole("dialog", { name: "Search" }));
    fireEvent.input(palette.getByRole("combobox"), { target: { value: "present on" } });
    fireEvent.mouseDown(await palette.findByRole("option", { name: /Present on This Screen/ }));
    await screen.findByRole("region", { name: "Presenting on this screen" });
    expect(requestFullscreen).toHaveBeenCalledTimes(2);
  });

  it("steps through the song with the keys the Output window forwards", async () => {
    await songUp();
    await presentHere();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(lit()).toContain("Second line"));
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() => expect(lit()).toContain("First line"));
  });

  it("opens the switcher with Ctrl+K, and Enter shows the song at once", async () => {
    await songUp();
    await presentHere();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const switcher = within(await screen.findByRole("search", { name: "Switch song" }));
    const input = switcher.getByRole("combobox", { name: "Find a song" });
    expect(input).toHaveFocus();
    fireEvent.input(input, { target: { value: "1" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(lit()).toContain("A line"));
    expect(screen.queryByRole("search", { name: "Switch song" })).not.toBeInTheDocument();
    // Still presenting, still fullscreen.
    expect(region()).not.toBeNull();
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("keeps a digit a stanza jump while presenting, never opening the switcher", async () => {
    await songUp();
    await presentHere();
    fireEvent.keyDown(window, { key: "2" });
    await waitFor(() => expect(lit()).toContain("Second line"));
    expect(screen.queryByRole("search", { name: "Switch song" })).not.toBeInTheDocument();
  });

  it("shows the cursor while the mouse moves and hides it once still, as the Output window does", async () => {
    await songUp();
    await presentHere();
    vi.useFakeTimers();
    try {
      expect(region()).not.toHaveClass("output-cursor");
      window.dispatchEvent(new MouseEvent("mousemove"));
      await vi.advanceTimersByTimeAsync(1999);
      expect(region()).toHaveClass("output-cursor");
      await vi.advanceTimersByTimeAsync(1);
      expect(region()).not.toHaveClass("output-cursor");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing over the audience's screen unasked: no hint where the switcher is", async () => {
    await songUp();
    await presentHere();
    expect(region()?.querySelector(".present-switcher-hint")).toBeNull();
    expect(screen.queryByText(/to switch songs/)).not.toBeInTheDocument();
  });

  it("steps the caption aside while the switcher is open", async () => {
    await songUp();
    await presentHere();
    expect(region()).not.toHaveClass("present-here-switching");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByRole("search", { name: "Switch song" });
    expect(region()).toHaveClass("present-here-switching");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(region()).not.toHaveClass("present-here-switching"));
  });

  it("Esc closes only the switcher when it is open, and leaves when it is not", async () => {
    await songUp();
    await presentHere();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: "Find a song" });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("search", { name: "Switch song" })).not.toBeInTheDocument(),
    );
    expect(region()).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(region()).toBeNull());
    expect(exitFullscreen).toHaveBeenCalled();
  });

  it("leaves with F, and returns to the Operator at the same song and part", async () => {
    await songUp();
    await presentHere();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(lit()).toContain("Second line"));
    fireEvent.keyDown(window, { key: "f" });
    await waitFor(() => expect(region()).toBeNull());
    expect(exitFullscreen).toHaveBeenCalled();
    // The Operator's own Presenter never went away: the same song, the same part.
    expect(screen.getByRole("button", { name: /#3\s*Mocked Hymn 3/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go Live" })).toBeInTheDocument();
  });

  it("leaves when the browser leaves fullscreen by itself (Esc where it is not captured)", async () => {
    await songUp();
    await presentHere();
    setFullscreen(null);
    document.dispatchEvent(new Event("fullscreenchange"));
    await waitFor(() => expect(region()).toBeNull());
  });

  it("shows no notice while presenting, and the queued one after leaving", async () => {
    await songUp();
    await presentHere();
    updates.set(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(notices(/Update ready/)).toBe(0);
    expect(document.querySelector(".snackbar")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(region()).toBeNull());
    await waitFor(() => expect(notices(/Update ready/)).toBeGreaterThan(0));
    updates.set(false);
  });

  it("keeps one live button, of one width, through Go Live, On Air, Held and Blanked", async () => {
    render(() => <App />);
    await screen.findByRole("button", { name: "Go Live" });
    const controls = document.querySelector(".live-controls") as HTMLElement;
    const box = controls.querySelector(".present-button") as HTMLElement;
    // The header's live controls are this one button in every state: no
    // chevron, no menu (End Live is Live's toolbar's). Its width is the
    // class's; the label's room is SwapLabel's.
    const seen = () => {
      expect([...controls.children].filter((el) => !el.matches(".hover-glide"))).toEqual([box]);
      expect(screen.queryByRole("button", { name: "Live options" })).not.toBeInTheDocument();
      expect(document.querySelector(".live-chevron")).toBeNull();
    };
    seen();
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    seen();
    fireEvent.keyDown(window, { key: "H", shiftKey: true });
    await screen.findByRole("button", { name: "Held" });
    seen();
    fireEvent.keyDown(window, { key: "b" });
    await screen.findByRole("button", { name: "Blanked" });
    seen();
    // The label's room is every label's, so the word never resizes the button.
    expect([...box.querySelectorAll(".swap-label-item")].map((item) => item.textContent)).toEqual([
      "Go Live",
      "On Air",
      "Blanked",
      "Held",
    ]);
    fireEvent.keyDown(window, { key: "b" });
    output.postMessage({ type: "bye", id: "test-output" });
    await screen.findByRole("button", { name: "Go Live" });
    seen();
    output.close();
  });

  it("shows the live state's glyph in the header button: broadcasting, a ring when blanked, pause bars when held", async () => {
    render(() => <App />);
    const goLive = await screen.findByRole("button", { name: "Go Live" });
    expect(goLive.querySelector(".icon-present")).not.toBeNull();
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    const onAir = await screen.findByRole("button", { name: "On Air" });
    expect(onAir.querySelector(".icon-sensors")).not.toBeNull();
    fireEvent.keyDown(window, { key: "H", shiftKey: true });
    const held = await screen.findByRole("button", { name: "Held" });
    expect(held.querySelector(".icon-hold")).not.toBeNull();
    expect(held.querySelector(".icon-stop")).toBeNull();
    fireEvent.keyDown(window, { key: "b" });
    const blanked = await screen.findByRole("button", { name: "Blanked" });
    expect(blanked.querySelector(".icon-blank")).not.toBeNull();
    expect(blanked.querySelector(".icon-hold, .icon-sensors")).toBeNull();
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.keyDown(window, { key: "H", shiftKey: true });
    output.postMessage({ type: "bye", id: "test-output" });
    await screen.findByRole("button", { name: "Go Live" });
    output.close();
  });

  it("keeps Present Here in Live's toolbar always, and End Live once an Output window is live, with their keys", async () => {
    await songUp();
    const toolbar = screen.getByRole("toolbar", { name: "Output controls" });
    // Not live: Present Here is there and enabled, End Live waits.
    expect(within(toolbar).getByRole("button", { name: /^Present Here/ })).toBeEnabled();
    expect(within(toolbar).getByRole("button", { name: /^End Live/ })).toBeDisabled();
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    const end = within(toolbar).getByRole("button", { name: /^End Live/ });
    const here = within(toolbar).getByRole("button", { name: /^Present Here/ });
    expect(end).toHaveAttribute("aria-keyshortcuts", "Shift+E");
    expect(here).toHaveAttribute("aria-keyshortcuts", "Shift+P");
    output.close();
  });

  it("presents here from Live's toolbar when not live", async () => {
    await songUp();
    fireEvent.click(screen.getByRole("button", { name: /^Present Here/ }));
    await screen.findByRole("region", { name: "Presenting on this screen" });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("presents here from Live's toolbar once the Output window has closed", async () => {
    await songUp();
    const output = new BroadcastChannel("hymnal-output");
    output.onmessage = (event) => {
      if ((event.data as { type?: string }).type === "close")
        output.postMessage({ type: "bye", id: "test-output" });
    };
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    fireEvent.click(screen.getByRole("button", { name: /^Present Here/ }));
    await screen.findByRole("region", { name: "Presenting on this screen" });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    output.close();
  });

  it("is not offered while an Output window is live", async () => {
    render(() => <App />);
    await screen.findByRole("button", { name: "Go Live" });
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    expect(screen.queryByRole("button", { name: "Go Live" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "P", shiftKey: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(region()).toBeNull();
    expect(requestFullscreen).not.toHaveBeenCalled();
    output.postMessage({ type: "bye", id: "test-output" });
    output.close();
  });
});
