import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.tsx";
import type { BookRow, ContentAdmin, ContentStore } from "./persistence/content-store.ts";
import type { UserState } from "./persistence/user-state.ts";

const mocks = vi.hoisted(() => ({
  rows: [] as import("./persistence/content-store.ts").BookRow[],
  recents: [] as import("./persistence/user-state.ts").RecentEntry[],
  addRecent: vi.fn(async (_book: string, _number: number) => {}),
  admin: {} as Record<string, unknown>,
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
      parts: [{ id: "s1", kind: "stanza", lines: ["A line"] }],
      sequence: [{ partId: "s1" }],
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
  const userState: UserState = {
    getLastPosition: async () => undefined,
    setLastPosition: async () => {},
    getRecents: async () => mocks.recents,
    addRecent: (book, number) => mocks.addRecent(book, number),
    dropRecents: async () => {},
    getPreferences: async () => ({ theme: "system", fontScale: 1 }),
    setPreferences: async () => {},
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

/** The Library has listed the books: the first run's wait is over. */
const booksReady = () => screen.findByRole("heading", { name: "Library" });

/** Go Live, once a book is held (it is off until then). */
async function clickGoLive() {
  const button = screen.getByRole("button", { name: "Go Live" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
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

  it("shows the keep-your-file note after a first load when storage was refused, and Got it puts it away", async () => {
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
      fireEvent.click(screen.getByRole("button", { name: "Got it" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByText("3 books not loaded")).not.toBeInTheDocument());
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

    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));

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

  it("shows each action's key in the command menu, from the keymap; Show cues now has none", async () => {
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
    expect(hintOf(/Show Cues Now/)).toBeUndefined();
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

    fireEvent.input(box, { target: { value: "go li" } });
    expect(within(menu).getByRole("option", { name: /Go Live/ })).toBeInTheDocument();

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
    expect(goLive).toHaveAttribute("title", "Open the Output (O)");
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
      expect.stringMatching(/\?output=1&placed=1$/),
      "hymnal-output",
      "popup,left=1440,top=0,width=1280,height=800",
    );
    expect(
      (await screen.findAllByText(/click it or press F/, {}, { timeout: 3000 })).length,
    ).toBeGreaterThan(0);
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

  it("ends Live: the window stays and goes dark, Go Live resumes it in place, no screen asked", async () => {
    const { output, win } = await goLive();
    const seen: unknown[] = [];
    output.onmessage = (event) => seen.push(event.data);
    const opened = vi.mocked(window.open).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "End Live" }));
    await waitFor(() => expect(seen).toContainEqual({ type: "ended", ended: true }));
    // The header is Go Live again; the window was not touched.
    expect(await screen.findByRole("button", { name: "Go Live" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "On Air" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End Live" })).not.toBeInTheDocument();
    expect(win.moveTo).not.toHaveBeenCalled();

    await clickGoLive();
    await waitFor(() => expect(seen).toContainEqual({ type: "ended", ended: false }));
    expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
    // Only the named window was brought forward: nothing opened at a URL.
    const later = vi.mocked(window.open).mock.calls.slice(opened);
    expect(later.every(([url]) => url === "")).toBe(true);
    output.close();
  });

  it("holds the update prompt while Live is ended (the window is still open), and shows it once the window closes", async () => {
    const { output } = await goLive();
    updates.set(true);
    fireEvent.click(screen.getByRole("button", { name: "End Live" }));
    await screen.findByRole("button", { name: "Go Live" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(noticeText(/Update ready/)).toBe(0);
    output.postMessage({ type: "bye", id: "test-output" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    await waitFor(() => expect(noticeText(/Update ready/)).toBeGreaterThan(0));
    output.close();
    updates.set(false);
  });

  it("an Operator reloaded while an Output is ended adopts it: Go Live, not On Air, and nothing posted over it", async () => {
    const output = new BroadcastChannel("hymnal-output");
    const seen: unknown[] = [];
    output.onmessage = (event) => seen.push(event.data);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    // The Output answers the ping with what it holds.
    output.postMessage({
      type: "hello",
      id: "held",
      state: { blanked: false, ended: true },
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByRole("button", { name: "Go Live" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "On Air" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End Live" })).not.toBeInTheDocument();
    expect(seen).not.toContainEqual({ type: "ended", ended: false });
    // Go Live is the one thing that says it is lit again.
    vi.spyOn(window, "open").mockReturnValue({ focus: vi.fn() } as unknown as Window);
    await clickGoLive();
    await waitFor(() => expect(seen).toContainEqual({ type: "ended", ended: false }));
    expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
    output.close();
  });

  it("a blank the Output holds is adopted too, so Restore is offered", async () => {
    const output = new BroadcastChannel("hymnal-output");
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    output.postMessage({ type: "hello", id: "held", state: { blanked: true, ended: false } });
    expect(await screen.findByRole("button", { name: "Blanked" })).toBeInTheDocument();
    // Restore (B), so the held blank is not left for the next test.
    fireEvent.keyDown(window, { key: "b" });
    expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
    output.close();
  });

  it("ends Live from the keyboard (Shift+E) and from the command list, only while live", async () => {
    const { output } = await goLive();
    const seen: unknown[] = [];
    output.onmessage = (event) => seen.push(event.data);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    const option = within(menu).getByRole("option", { name: /End Live/ });
    expect(option.querySelector("kbd")?.textContent).toBe("Shift+E");
    fireEvent.mouseDown(option);
    await waitFor(() => expect(seen).toContainEqual({ type: "ended", ended: true }));
    expect(await screen.findByRole("button", { name: "Go Live" })).toBeInTheDocument();

    // Dark, there is nothing to end: neither the key nor the command.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const again = await screen.findByRole("dialog", { name: "Search" });
    expect(within(again).queryByRole("option", { name: /End Live/ })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await clickGoLive();
    await screen.findByRole("button", { name: "On Air" });
    seen.length = 0;
    // A plain E does nothing; Shift+E ends it.
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyDown(window, { key: "E", shiftKey: true });
    await waitFor(() => expect(seen).toContainEqual({ type: "ended", ended: true }));
    expect(seen.filter((m) => (m as { ended?: boolean }).ended === true)).toHaveLength(1);
    // Lit again, so the held end is not left for the next test.
    fireEvent.click(await screen.findByRole("button", { name: "Go Live" }));
    await screen.findByRole("button", { name: "On Air" });
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
    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
    await screen.findAllByText(/Drag the Output to the projector/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/Drag the Output to the projector/)).toBe(0));
    second.unmount();
  });

  it("lets Escape put away the fullscreen, gone and back notices", async () => {
    const { details } = await goLive();
    await screen.findAllByText(/click it or press F/, {}, { timeout: 3000 });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/click it or press F/)).toBe(0));

    unplug(details as never);
    await screen.findAllByText(/screen the Output was on is gone/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/is gone/)).toBe(0));

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
    await screen.findAllByText(/is gone/);
    expect(win.moveTo).not.toHaveBeenCalled();

    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    expect(win.moveTo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Move it" }));
    await waitFor(() => expect(win.moveTo).toHaveBeenCalledWith(1440, 0));
    await waitFor(() => expect(noticeText(/That screen is back/)).toBe(0));
  });

  it("Stay leaves the Output alone", async () => {
    const { details, win } = await goLive();
    unplug(details as never);
    await screen.findAllByText(/is gone/);
    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(noticeText(/That screen is back/)).toBe(0));
    expect(win.moveTo).not.toHaveBeenCalled();
  });

  it("says so when the Output cannot be moved", async () => {
    const { details, win } = await goLive();
    unplug(details as never);
    await screen.findAllByText(/is gone/);
    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    win.moveTo.mockImplementation(() => {});
    win.screenX = 50;
    fireEvent.click(screen.getByRole("button", { name: "Move it" }));
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

  it("gives no drag hint to a single-screen user, with the API or without it", async () => {
    attach([laptop]);
    Object.defineProperty(window.screen, "isExtended", { value: false, configurable: true });
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
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
