import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { booksReady, mocks, openFinder, openPresent } from "./App.testkit.tsx";
import App from "./App.tsx";
import type { BookRow } from "./persistence/content-store.ts";

vi.mock("./persistence/content-store.ts", async () =>
  (await import("./App.testkit.tsx")).contentStoreMock(),
);
vi.mock("./persistence/user-state.ts", async (importOriginal) =>
  (await import("./App.testkit.tsx")).userStateMock(
    await importOriginal<typeof import("./persistence/user-state.ts")>(),
  ),
);
vi.mock("./shell/updates.ts", async (importOriginal) =>
  (await import("./App.testkit.tsx")).updatesMock(
    await importOriginal<typeof import("./shell/updates.ts")>(),
  ),
);
vi.mock("./output/OutputView.tsx", async (importOriginal) =>
  (await import("./App.testkit.tsx")).outputViewMock(
    await importOriginal<typeof import("./output/OutputView.tsx")>(),
  ),
);

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

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
    mocks.searchAll.mockImplementation(async () => []);
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

  it("has no About in the sections; Search for About opens Settings, where it is last", async () => {
    mocks.rows = [first()];
    render(() => <App />);
    const sections = within(await screen.findByRole("navigation", { name: "Sections" }));
    expect(sections.queryByRole("button", { name: "About" })).not.toBeInTheDocument();
    await openPresent();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const search = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.input(within(search).getByRole("combobox"), {
      target: { value: ">about" },
    });
    fireEvent.mouseDown(await within(search).findByRole("option", { name: /About/ }));
    const settings = await screen.findByRole("dialog", { name: "Settings" });
    const headings = within(settings).getAllByRole("heading", { level: 3 });
    expect(headings.at(-1)).toHaveTextContent("About");
    expect(within(settings).getByRole("button", { name: "Copy Diagnostics" })).toBeInTheDocument();
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

  describe("the hymnbook picker's search field", () => {
    const openPicker = async () => {
      mocks.rows = [
        first(),
        second(),
        second({ key: "k2", title: "Cantiques Français — Édition", songs: 90 }),
        second({ key: "k3", title: "മലയാളം ഗീതങ്ങൾ", language: "ml", script: "Mlym" }),
      ];
      render(() => <App />);
      const crumbs = within(await screen.findByRole("navigation", { name: "Hymnbook and song" }));
      fireEvent.click(await crumbs.findByRole("button", { name: /Mocked Hymnbook/ }));
      return within(await screen.findByRole("dialog", { name: "Hymnbooks" }));
    };
    const search = (books: ReturnType<typeof within>) =>
      books.getByRole("searchbox", { name: "Search hymnbooks" });
    const type = (books: ReturnType<typeof within>, value: string) =>
      fireEvent.input(search(books), { target: { value } });

    it("has the field at the top and focuses it on open", async () => {
      const books = await openPicker();
      expect(search(books)).toHaveFocus();
      expect(books.getAllByRole("button", { name: /songs/ })).toHaveLength(4);
    });

    it("filters the books by title, ignoring case and accents", async () => {
      const books = await openPicker();
      type(books, "FELLOW");
      expect(books.getAllByRole("button", { name: /songs/ })).toHaveLength(1);
      expect(books.getByRole("button", { name: /Hymns of Fellowship/ })).toBeInTheDocument();
      type(books, "francais edition");
      expect(books.getByRole("button", { name: /Cantiques/ })).toBeInTheDocument();
      expect(books.getAllByRole("button", { name: /songs/ })).toHaveLength(1);
    });

    it("finds a Malayalam title", async () => {
      const books = await openPicker();
      type(books, "ഗീതങ്ങൾ");
      expect(books.getAllByRole("button", { name: /songs/ })).toHaveLength(1);
      expect(books.getByRole("button", { name: /മലയാളം/ })).toBeInTheDocument();
    });

    it("says so when no book matches, and a cleared field lists them all again", async () => {
      const books = await openPicker();
      type(books, "zzz");
      expect(books.queryAllByRole("button", { name: /songs/ })).toHaveLength(0);
      expect(books.getByText(/No hymnbooks match/)).toBeInTheDocument();
      type(books, "");
      expect(books.getAllByRole("button", { name: /songs/ })).toHaveLength(4);
      expect(books.queryByText(/No hymnbooks match/)).not.toBeInTheDocument();
    });

    it("holds 100 characters, and echoes a long query clipped to one line", async () => {
      const books = await openPicker();
      expect(search(books)).toHaveAttribute("maxlength", "100");
      type(books, "ക്ഷമലയാളം".repeat(60));
      const heading = books.getByRole("heading", { name: /^No hymnbooks match/ });
      const echoed = /“(.*)”/.exec(heading.textContent ?? "")?.[1] ?? "";
      expect(echoed.endsWith("…")).toBe(true);
      expect([
        ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(echoed.slice(0, -1)),
      ]).toHaveLength(40);
      expect(heading.className).toContain("empty-echo");
    });
  });

  describe("a book chosen is where the search looks; the song's book stays the song's", () => {
    const crumbs = () => within(screen.getByRole("navigation", { name: "Hymnbook and song" }));

    /** Two books, the second (Fellowship) the newest recent, so the Finder starts there; its song 1 is up. */
    async function fellowshipSongUp() {
      mocks.rows = [first(), second()];
      mocks.recents = [{ hymnbookId: "k1", hymnNumber: 1, viewedAt: 2 }];
      render(() => <App />);
      await openFinder();
      fireEvent.input(await screen.findByRole("combobox", { name: "Find a song or command" }), {
        target: { value: "1" },
      });
      fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
      await screen.findByRole("img", { name: "Live output preview" });
    }

    const chooseFromHeader = async (title: RegExp) => {
      fireEvent.click(
        crumbs().getByRole("button", {
          name: /Hymns of Fellowship|Mocked Hymnbook/,
        }),
      );
      const books = within(await screen.findByRole("dialog", { name: "Hymnbooks" }));
      fireEvent.click(books.getByRole("button", { name: title }));
      return within(await screen.findByRole("dialog", { name: "Search" }));
    };

    it("the crumb shows the song's own book, and the other book only after one of its songs is picked", async () => {
      await fellowshipSongUp();
      expect(crumbs().getByRole("button", { name: /Hymns of Fellowship/ })).toBeInTheDocument();

      const picker = await chooseFromHeader(/Mocked Hymnbook/);
      // The song and its book are untouched by choosing another book to search.
      expect(crumbs().getByRole("button", { name: /Hymns of Fellowship/ })).toBeInTheDocument();
      expect(crumbs().queryByRole("button", { name: /Mocked Hymnbook/ })).not.toBeInTheDocument();
      expect(crumbs().getByRole("button", { name: /#1/ })).toBeInTheDocument();

      fireEvent.input(picker.getByRole("combobox"), {
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
      await screen.findByRole("dialog", { name: "Search" });
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
      fireEvent.input(picker.getByRole("combobox"), {
        target: { value: "2" },
      });
      fireEvent.submit(picker.getByRole("combobox").closest("form") as HTMLFormElement);
      await screen.findByRole("button", { name: /#2\s*Mocked Hymn 2/ });
      await waitFor(() =>
        expect(mocks.addRecent.mock.calls).toEqual([["mal-ymef-athmeeya-geethangal-16", 2]]),
      );
    });

    it("a lyric match in another book makes that book current and opens the song in one step", async () => {
      await fellowshipSongUp();
      mocks.addRecent.mockClear();
      mocks.searchAll.mockImplementation(async () => [
        {
          key: "k1",
          title: "Hymns of Fellowship",
          results: [{ number: 1, title: "Own", snippet: "x" }],
        },
        {
          key: "mal-ymef-athmeeya-geethangal-16",
          title: "Mocked Hymnbook",
          results: [{ number: 2, title: "Mocked Hymn 2", snippet: "a line" }],
        },
      ]);
      fireEvent.click(crumbs().getByRole("button", { name: /#1/ }));
      const picker = within(await screen.findByRole("dialog", { name: "Search" }));
      fireEvent.input(picker.getByRole("combobox"), {
        target: { value: "line" },
      });
      const mocked = await picker.findByRole("group", {
        name: "Mocked Hymnbook",
      });
      fireEvent.mouseDown(within(mocked).getByRole("option", { name: /Mocked Hymn 2/ }));
      await screen.findByRole("button", { name: /#2\s*Mocked Hymn 2/ });
      expect(crumbs().getByRole("button", { name: /Mocked Hymnbook/ })).toBeInTheDocument();
      await waitFor(() =>
        expect(mocks.addRecent.mock.calls).toEqual([["mal-ymef-athmeeya-geethangal-16", 2]]),
      );
    });

    it("while live, a pick in another book from the command menu puts that song on the Output and records its book", async () => {
      await fellowshipSongUp();
      const output = new BroadcastChannel("hymnal-output");
      const seen: { type: string; title?: string; hymnbookTitle?: string }[] = [];
      output.onmessage = (event) => seen.push(event.data);
      output.postMessage({ type: "hello", id: "test-output" });
      await screen.findByRole("button", { name: "On Air" });
      mocks.addRecent.mockClear();
      mocks.searchAll.mockImplementation(async () => [
        {
          key: "mal-ymef-athmeeya-geethangal-16",
          title: "Mocked Hymnbook",
          results: [{ number: 2, title: "Mocked Hymn 2", snippet: "a line" }],
        },
      ]);
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      const search = within(await screen.findByRole("dialog", { name: "Search" }));
      fireEvent.input(search.getByRole("combobox"), {
        target: { value: "line" },
      });
      fireEvent.mouseDown(await search.findByRole("option", { name: /Mocked Hymn 2/ }));
      await waitFor(() =>
        expect(seen.some((m) => m.type === "content" && m.title === "Mocked Hymn 2")).toBe(true),
      );
      expect(seen.findLast((m) => m.type === "content")?.hymnbookTitle).toBe("Mocked Hymnbook");
      await waitFor(() =>
        expect(mocks.addRecent.mock.calls).toEqual([["mal-ymef-athmeeya-geethangal-16", 2]]),
      );
      output.postMessage({ type: "bye", id: "test-output" });
      output.close();
    });

    it("a Finder closed without a pick leaves the search where the song is", async () => {
      await fellowshipSongUp();
      const picker = await chooseFromHeader(/Mocked Hymnbook/);
      fireEvent.click(picker.getByRole("button", { name: "Close" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument(),
      );
      fireEvent.click(crumbs().getByRole("button", { name: /#1/ }));
      await screen.findByRole("dialog", { name: "Search" });
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
      const picker = within(await screen.findByRole("dialog", { name: "Search" }));
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
      expect(
        await screen.findAllByRole("combobox", { name: "Find a song or command" }),
      ).toHaveLength(1);
      expect(crumbs().getByRole("button", { name: /Hymns of Fellowship/ })).toBeInTheDocument();
    });
  });

  it("removing the book the hymn on screen is from, with the Output closed, clears the hymn", async () => {
    mocks.rows = [first(), second()];
    mocks.recents = [{ hymnbookId: "k1", hymnNumber: 1, viewedAt: 2 }];
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song or command" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await within(screen.getByRole("navigation", { name: "Hymnbook and song" })).findByRole(
      "button",
      { name: /#1/ },
    );

    const sections = within(screen.getByRole("navigation", { name: "Sections" }));
    fireEvent.click(sections.getByRole("button", { name: "Library" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "More for Hymns of Fellowship",
      }),
    );
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
    // No hymn is left up: the empty card, not the Presenter.
    expect(await screen.findByRole("heading", { name: "No song selected" })).toBeInTheDocument();
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
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song or command" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await within(screen.getByRole("navigation", { name: "Hymnbook and song" })).findByRole(
      "button",
      { name: /#1/ },
    );
    const sections = within(screen.getByRole("navigation", { name: "Sections" }));
    fireEvent.click(sections.getByRole("button", { name: "Library" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "More for Hymns of Fellowship",
      }),
    );
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
      fireEvent.change(input, {
        target: { files: [new File(["x"], "hof.hymnbook.json.gz")] },
      });
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
});
