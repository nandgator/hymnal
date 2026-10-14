import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HymnbookId, HymnNumber, HymnSource } from "../domain/types.ts";
import type { BookHits, ContentStore, SearchResult } from "../persistence/content-store.ts";
import type { RecentEntry, UserState } from "../persistence/user-state.ts";
import { Finder } from "./Finder.tsx";

const HYMN_42: HymnSource = {
  number: 42,
  title: "Forty-Second Hymn",
  parts: [],
  sequence: [],
  meta: {},
};

function fakeStore(overrides: Partial<ContentStore> = {}): ContentStore {
  const store: ContentStore = {
    ensureInstalled: async () => ({ state: "ready" }),
    getHymnbook: async () => {
      throw new Error("not used");
    },
    listHymns: async () => [{ number: 42, title: "Forty-Second Hymn" }],
    getHymn: async (_id: HymnbookId, number: HymnNumber) => {
      if (number === HYMN_42.number) return HYMN_42;
      throw new Error(`no such hymn: ${number}`);
    },
    searchLyrics: async (): Promise<SearchResult[]> => [],
    // One book held: all books is the current one, searched as searchLyrics does.
    searchAll: async (query, key) => {
      const results = await store.searchLyrics(key, query);
      return results.length ? [{ key, title: key, results }] : [];
    },
    searchNumber: async () => [],
    searchMore: async () => ({ results: [], more: false }),
    ...overrides,
  };
  return store;
}

function fakeUserState(overrides: Partial<UserState> = {}): UserState {
  return {
    getLastPosition: async () => undefined,
    setLastPosition: async () => {},
    getRecents: async () => [],
    addRecent: async () => {},
    dropRecents: async () => {},
    dropSong: async () => {},
    getPreferences: async () => ({ theme: "system", fontScale: 1 }),
    setPreferences: async () => {},
    ...overrides,
  };
}

const find = () => screen.getByRole("combobox", { name: "Find a song" });
const submit = (value: string) => {
  fireEvent.input(find(), { target: { value } });
  fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
};

describe("Finder", () => {
  /** A book of `count` songs, numbered from 1, listed as `listHymns` does: the Finder trusts that order. */
  const book = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      title: `Song Number ${i + 1}`,
    }));
  const options = () => screen.queryAllByRole("option");
  const listbox = () => screen.getByRole("listbox", { name: "Matching songs" });

  it("with nothing typed, lists Assorted Hymns in the order the book gives, under each language", async () => {
    const assorted = [
      { number: 7, title: "Amazing", language: "en", script: "Latn" },
      { number: 2, title: "Zion Song", language: "en", script: "Latn" },
      { number: 5, title: "മഹത്വം", language: "ml", script: "Mlym" },
    ];
    render(() => (
      <Finder
        hymnbookId="assorted"
        store={fakeStore({ listHymns: async () => assorted })}
        userState={fakeUserState()}
        onSelect={vi.fn()}
      />
    ));
    await screen.findByRole("group", { name: "English" });
    expect(options().map((row) => row.textContent)).toEqual([
      expect.stringContaining("Amazing"),
      expect.stringContaining("Zion Song"),
      expect.stringContaining("മഹത്വം"),
    ]);
    const malayalam = screen.getByRole("group", { name: "Malayalam" });
    expect(within(malayalam).getAllByRole("option")).toHaveLength(1);
  });

  it("with nothing typed, lists the whole book as All songs: a window of it, not all of it", async () => {
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({ listHymns: async () => book(1000) })}
        userState={fakeUserState()}
        onSelect={vi.fn()}
      />
    ));
    await screen.findByRole("group", { name: "All songs" });
    const rows = options();
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(60);
    expect(rows[0]).toHaveTextContent("#1");
    expect(screen.queryByText("No recent songs yet")).not.toBeInTheDocument();
    // Recents has nothing to say, so it says nothing: no heading over an empty list.
    expect(screen.queryByRole("heading", { name: "Recents" })).not.toBeInTheDocument();
    // Every option says where it is in the whole book.
    expect(rows[0]).toHaveAttribute("aria-setsize", "1000");
    expect(rows[0]).toHaveAttribute("aria-posinset", "1");
    expect(rows[3]).toHaveAttribute("aria-posinset", "4");
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-controls", listbox().id);
  });

  it("opens a song picked from the list", async () => {
    const onSelect = vi.fn();
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({ listHymns: async () => book(3) })}
        userState={fakeUserState()}
        onSelect={onSelect}
      />
    ));
    await screen.findByRole("group", { name: "All songs" });
    fireEvent.mouseDown(screen.getByRole("option", { name: /Song Number 2/ }));
    expect(onSelect).toHaveBeenCalledWith(2, "book");
  });

  it("puts the songs below Recents when there are recents", async () => {
    const recents: RecentEntry[] = [{ hymnbookId: "book", hymnNumber: 7, viewedAt: Date.now() }];
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({ listHymns: async () => book(30) })}
        userState={fakeUserState({ getRecents: async () => recents })}
        onSelect={vi.fn()}
      />
    ));
    const recentsHeading = await screen.findByRole("heading", { name: "Recents" });
    const songs = await screen.findByRole("group", { name: "All songs" });
    expect(
      recentsHeading.compareDocumentPosition(songs) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText("No recent songs yet")).not.toBeInTheDocument();
  });

  it("hides the songs once something is typed, and brings them back when it is cleared", async () => {
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({ listHymns: async () => book(30) })}
        userState={fakeUserState()}
        onSelect={vi.fn()}
      />
    ));
    await screen.findByRole("group", { name: "All songs" });
    fireEvent.input(find(), { target: { value: "2" } });
    expect(screen.queryByRole("group", { name: "All songs" })).not.toBeInTheDocument();
    fireEvent.input(find(), { target: { value: "" } });
    expect(await screen.findByRole("group", { name: "All songs" })).toBeInTheDocument();
  });

  describe("browsing with the keyboard (SDD-0001 §13.2)", () => {
    const renderBook = (count = 1000, onSelect = vi.fn()) => {
      render(() => (
        <Finder
          hymnbookId="book"
          store={fakeStore({ listHymns: async () => book(count) })}
          userState={fakeUserState()}
          onSelect={onSelect}
        />
      ));
      return onSelect;
    };
    const key = (name: string, extra: Partial<KeyboardEventInit> = {}) =>
      fireEvent.keyDown(find(), { key: name, ...extra });
    const selectedOption = () => options().find((o) => o.getAttribute("aria-selected") === "true");
    const enter = () => fireEvent.submit(find().closest("form") as HTMLFormElement);

    it("highlights nothing until an arrow key, and Enter then opens nothing", async () => {
      const onSelect = renderBook();
      await screen.findByRole("group", { name: "All songs" });
      expect(selectedOption()).toBeUndefined();
      expect(find()).not.toHaveAttribute("aria-activedescendant");
      enter();
      expect(onSelect).not.toHaveBeenCalled();
      key("ArrowDown");
      expect(selectedOption()).toHaveTextContent("#1");
      expect(find()).toHaveAttribute("aria-activedescendant", selectedOption()?.id);
      key("ArrowDown");
      enter();
      expect(onSelect).toHaveBeenCalledWith(2, "book");
    });

    it("End goes to the last song of the book and brings it into the window, Home back", async () => {
      const onSelect = renderBook();
      await screen.findByRole("group", { name: "All songs" });
      key("End");
      expect(selectedOption()).toHaveTextContent("#1000");
      expect(selectedOption()).toHaveAttribute("aria-posinset", "1000");
      expect(find()).toHaveAttribute("aria-activedescendant", selectedOption()?.id);
      expect(options().length).toBeLessThan(60);
      expect(screen.queryByText(/^#1$/)).not.toBeInTheDocument();
      enter();
      expect(onSelect).toHaveBeenCalledWith(1000, "book");
      key("Home");
      expect(selectedOption()).toHaveTextContent("#1");
    });

    it("the arrows wrap from the last song to the first, and Up from none goes to the last", async () => {
      renderBook(40);
      await screen.findByRole("group", { name: "All songs" });
      key("ArrowUp");
      expect(selectedOption()).toHaveTextContent("#40");
      key("ArrowDown");
      expect(selectedOption()).toHaveTextContent("#1");
    });

    it("PageDown moves a screenful on, bringing that row into the window", async () => {
      renderBook();
      await screen.findByRole("group", { name: "All songs" });
      key("ArrowDown");
      key("PageDown");
      const at = Number(selectedOption()?.getAttribute("aria-posinset"));
      expect(at).toBeGreaterThan(5);
      key("PageUp");
      expect(selectedOption()).toHaveTextContent("#1");
    });

    it("keeps Home and End for the caret once something is typed", async () => {
      render(() => (
        <Finder
          hymnbookId="book"
          store={fakeStore({
            listHymns: async () => book(60),
            searchLyrics: async () => [
              { number: 3, title: "Song Number 3", snippet: "a" },
              { number: 4, title: "Song Number 4", snippet: "b" },
            ],
          })}
          userState={fakeUserState()}
          onSelect={vi.fn()}
        />
      ));
      await screen.findByRole("group", { name: "All songs" });
      fireEvent.input(find(), { target: { value: "Song" } });
      await waitFor(() => expect(options().length).toBeGreaterThan(0));
      const before = selectedOption()?.id;
      key("End");
      expect(selectedOption()?.id).toBe(before);
    });

    it("the quick switcher shows no list of the book with nothing typed", async () => {
      render(() => (
        <Finder
          compact
          hymnbookId="book"
          store={fakeStore({ listHymns: async () => book(100) })}
          userState={fakeUserState()}
          onSelect={vi.fn()}
        />
      ));
      await Promise.resolve();
      expect(screen.queryAllByRole("option")).toHaveLength(0);
      expect(screen.queryByRole("group", { name: "All songs" })).not.toBeInTheDocument();
    });
  });

  describe("search past the first page (SDD-0001 §13.2)", () => {
    const page = (from: number, count: number): SearchResult[] =>
      Array.from({ length: count }, (_, i) => ({
        number: from + i,
        title: `Found ${from + i}`,
        snippet: `a lantern line ${from + i}`,
      }));
    const key = (name: string, extra: Partial<KeyboardEventInit> = {}) =>
      fireEvent.keyDown(find(), { key: name, ...extra });
    const lastOption = () => options().at(-1);
    const toEnd = () => key("End", { ctrlKey: true });

    const setup = (
      more: (offset: number, query: string) => Promise<{ results: SearchResult[]; more: boolean }>,
    ) => {
      const searchMore = vi.fn(async (_id: string, query: string, offset: number) =>
        more(offset, query),
      );
      const searchAll = vi.fn(
        async (query: string, id: string): Promise<BookHits[]> => [
          { key: id, title: id, results: page(1, 30), more: query === "lantern" },
        ],
      );
      render(() => (
        <Finder
          hymnbookId="book"
          store={fakeStore({ searchAll, searchMore })}
          userState={fakeUserState()}
          onSelect={vi.fn()}
        />
      ));
      return { searchMore, searchAll };
    };
    const typeLantern = async () => {
      fireEvent.input(find(), { target: { value: "lantern" } });
      await screen.findAllByRole("option");
    };

    it("asks for the next page when the end of the first comes into reach, and appends it in place", async () => {
      const { searchMore } = setup(async (offset) => ({
        results: page(offset + 1, 12),
        more: false,
      }));
      await typeLantern();
      expect(searchMore).not.toHaveBeenCalled();
      toEnd();
      await waitFor(() => expect(searchMore).toHaveBeenCalledWith("book", "lantern", 30));
      expect(searchMore).toHaveBeenCalledTimes(1);
      await waitFor(() => {
        toEnd();
        expect(lastOption()).toHaveAttribute("aria-setsize", "42");
      });
      await screen.findByText("End of results");
      expect(lastOption()).toHaveTextContent("#42");
    });

    it("lists no song twice when a page repeats one", async () => {
      setup(async () => ({ results: page(28, 5), more: false }));
      await typeLantern();
      toEnd();
      await waitFor(() => {
        toEnd();
        expect(lastOption()).toHaveAttribute("aria-setsize", "32");
      });
      await screen.findByText("End of results");
      expect(lastOption()).toHaveTextContent("#32");
    });

    it("pages again while more follow", async () => {
      let calls = 0;
      const { searchMore } = setup(async (offset) => ({
        results: page(offset + 1, 30),
        more: ++calls < 2,
      }));
      await typeLantern();
      toEnd();
      await waitFor(() => expect(searchMore).toHaveBeenCalledTimes(1));
      await waitFor(() => {
        toEnd();
        expect(lastOption()).toHaveAttribute("aria-setsize", "60");
      });
      await waitFor(() => expect(searchMore).toHaveBeenCalledTimes(2));
      expect(searchMore).toHaveBeenLastCalledWith("book", "lantern", 60);
      await waitFor(() => {
        toEnd();
        expect(lastOption()).toHaveAttribute("aria-setsize", "90");
      });
      await screen.findByText("End of results");
    });

    it("ArrowDown on the last row waits for the page instead of wrapping", async () => {
      setup(() => new Promise(() => {}));
      await typeLantern();
      toEnd();
      key("ArrowDown");
      expect(lastOption()).toHaveAttribute("aria-selected", "true");
    });

    it("a new query throws the pages away, and a page still on its way does not join it", async () => {
      let release: (page: { results: SearchResult[]; more: boolean }) => void = () => {};
      const { searchMore } = setup(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      await typeLantern();
      toEnd();
      await waitFor(() => expect(searchMore).toHaveBeenCalled());
      fireEvent.input(find(), { target: { value: "harbor" } });
      await waitFor(() => expect(screen.queryByText("Loading more")).not.toBeInTheDocument());
      release({ results: page(500, 5), more: false });
      await Promise.resolve();
      expect(screen.queryByText("Found 500")).not.toBeInTheDocument();
      expect(options()[0]).toHaveAttribute("aria-setsize", "30");
    });

    it("says when a page could not be loaded and tries again on a tap", async () => {
      let fail = true;
      const { searchMore } = setup(async (offset) => {
        if (fail) throw new Error("worker gone");
        return { results: page(offset + 1, 3), more: false };
      });
      await typeLantern();
      toEnd();
      const retry = await screen.findByText("Could not load more. Try again.");
      fail = false;
      fireEvent.mouseDown(retry);
      await screen.findByText("End of results");
      expect(searchMore).toHaveBeenCalledTimes(2);
    });
  });

  describe("focus on opening over nothing", () => {
    const original = window.matchMedia;
    const pointer = (fine: boolean) => {
      window.matchMedia = ((query: string) => ({
        matches: query === "(pointer: fine)" ? fine : false,
        media: query,
      })) as never;
    };
    afterEach(() => {
      window.matchMedia = original;
    });
    const open = () =>
      render(() => (
        <Finder
          hymnbookId="book"
          store={fakeStore()}
          userState={fakeUserState()}
          onSelect={vi.fn()}
        />
      ));

    it("takes the focus where there is a keyboard to type on", async () => {
      pointer(true);
      open();
      await waitFor(() => expect(find()).toHaveFocus());
    });

    it("leaves it alone on a touch screen, where the keyboard would cover the songs", async () => {
      pointer(false);
      open();
      await screen.findByRole("group", { name: "All songs" });
      await new Promise((r) => setTimeout(r, 20));
      expect(find()).not.toHaveFocus();
    });
  });

  it("forgets the last book's recents the moment the book changes", async () => {
    const recents: RecentEntry[] = [{ hymnbookId: "book", hymnNumber: 42, viewedAt: Date.now() }];
    let release: (rows: RecentEntry[]) => void = () => {};
    let reads = 0;
    const userState = fakeUserState({
      getRecents: () =>
        ++reads === 1 ? Promise.resolve(recents) : new Promise((resolve) => (release = resolve)),
    });
    const [id, setId] = createSignal("book");
    render(() => (
      <Finder
        hymnbookId={id()}
        store={fakeStore({ listHymns: async () => book(30) })}
        userState={userState}
        onSelect={vi.fn()}
      />
    ));
    expect(await screen.findByRole("heading", { name: "Recents" })).toBeInTheDocument();
    setId("other");
    // The other book's recents are still being read: nothing of the last one's shows.
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Recents" })).not.toBeInTheDocument(),
    );
    release([]);
    expect(await screen.findByRole("group", { name: "All songs" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recents" })).not.toBeInTheDocument();
  });

  it("lists the songs of the book now searched, not the last one's", async () => {
    const [id, setId] = createSignal("en");
    const store = fakeStore({
      listHymns: async (book) =>
        book === "en"
          ? [{ number: 1, title: "English Opening" }]
          : [{ number: 2, title: "Malayalam Opening" }],
    });
    render(() => (
      <Finder hymnbookId={id()} store={store} userState={fakeUserState()} onSelect={vi.fn()} />
    ));
    expect(await screen.findByText("English Opening")).toBeInTheDocument();
    setId("ml");
    expect(await screen.findByText("Malayalam Opening")).toBeInTheDocument();
    expect(screen.queryByText("English Opening")).not.toBeInTheDocument();
  });

  it("shows recents by number, title and when, as the Operator's tab does", async () => {
    const recents: RecentEntry[] = [{ hymnbookId: "book", hymnNumber: 42, viewedAt: 1 }];
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore()}
        userState={fakeUserState({ getRecents: async () => recents })}
        onSelect={vi.fn()}
      />
    ));
    expect(await screen.findByRole("heading", { name: "Recents" })).toBeInTheDocument();
    const rows = await screen.findAllByRole("button", { name: /Forty-Second Hymn/ });
    // The recent row has a "when"; the song's own row below it does not.
    expect(rows[0]?.querySelector(".recents-when")).not.toBeNull();
  });

  it("shows only this book's recents", async () => {
    const recents: RecentEntry[] = [
      { hymnbookId: "other", hymnNumber: 7, viewedAt: 2 },
      { hymnbookId: "book", hymnNumber: 42, viewedAt: 1 },
    ];
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore()}
        userState={fakeUserState({ getRecents: async () => recents })}
        onSelect={vi.fn()}
      />
    ));
    await screen.findByRole("heading", { name: "Recents" });
    await screen.findAllByRole("button", { name: /Forty-Second Hymn/ });
    expect(screen.queryByText("#7")).not.toBeInTheDocument();
  });

  it("hands an exact hymn number straight to onSelect", async () => {
    const onSelect = vi.fn();
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore()}
        userState={fakeUserState()}
        onSelect={onSelect}
      />
    ));
    await screen.findByRole("group", { name: "All songs" });

    submit("42");

    expect(onSelect).toHaveBeenCalledWith(42, "book");
  });

  it("searches lyrics for non-numeric input and hands the picked result to onSelect", async () => {
    const onSelect = vi.fn();
    const searchLyrics = vi.fn(
      async (): Promise<SearchResult[]> => [
        { number: 42, title: "Forty-Second Hymn", snippet: "a line of it" },
      ],
    );
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({ searchLyrics })}
        userState={fakeUserState()}
        onSelect={onSelect}
      />
    ));
    await screen.findByRole("group", { name: "All songs" });

    submit("grace");

    expect(searchLyrics).toHaveBeenCalledWith("book", "grace");
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Forty-Second Hymn/ }));
    expect(onSelect).toHaveBeenCalledWith(42, "book");
  });

  it("shows a result's snippet only when it adds something beyond the title", async () => {
    const searchLyrics = vi.fn(
      async (): Promise<SearchResult[]> => [
        { number: 1, title: "Same line", snippet: "Same line" },
        { number: 2, title: "Title", snippet: "A different line" },
      ],
    );
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({ searchLyrics })}
        userState={fakeUserState()}
        onSelect={vi.fn()}
      />
    ));
    await screen.findByRole("group", { name: "All songs" });

    submit("line");

    expect(await screen.findByRole("option", { name: /^#1\s*Same Line$/ })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /^#2\s*Title\s*—\s*A different line$/ }),
    ).toBeInTheDocument();
    // Title and matched line are separate items, so each ellipsizes in its
    // own style (a cut line ends in a muted "…", not the title's bright one).
    const row = screen.getByRole("option", { name: /^#2/ });
    expect(row.querySelector(".finder-title")?.textContent).toBe("Title");
    const snippet = row.querySelector(".finder-snippet");
    expect(snippet?.textContent).toMatch(/^—\s*A different line$/);
    expect(snippet?.classList.contains("list-row-supporting")).toBe(true);
    expect(snippet?.parentElement?.parentElement).toBe(
      row.querySelector(".finder-title")?.parentElement,
    );
  });

  it("reports no matches for a lyric search with no results", async () => {
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore()}
        userState={fakeUserState()}
        onSelect={vi.fn()}
      />
    ));
    await screen.findByRole("group", { name: "All songs" });

    submit("nothing like this");

    expect(
      await screen.findByRole("heading", { name: "No matches for “nothing like this”" }),
    ).toBeInTheDocument();
    // The field's own clear button empties the box, keeps focus in it, and brings the book back.
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getByRole("combobox")).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
    expect(await screen.findByRole("group", { name: "All songs" })).toBeInTheDocument();
  });

  it("keeps the no-match card up while the next search is on its way (the strip behind it must not shrink)", async () => {
    let release: (() => void) | undefined;
    const searchLyrics = vi
      .fn<ContentStore["searchLyrics"]>()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(
        () =>
          new Promise<SearchResult[]>((resolve) => {
            release = () => resolve([]);
          }),
      );
    render(() => (
      <Finder
        compact
        hymnbookId="book"
        store={fakeStore({ searchLyrics })}
        userState={fakeUserState()}
        onSelect={vi.fn()}
      />
    ));
    submit("qqq");
    await screen.findByRole("heading", { name: /^No matches/ });

    submit("qqqz");
    await waitFor(() => expect(searchLyrics).toHaveBeenCalledTimes(2));
    // The second search has not answered: the card has not gone, and has not flickered.
    expect(screen.getByRole("heading", { name: /^No matches/ })).toBeInTheDocument();

    release?.();
    expect(
      await screen.findByRole("heading", { name: "No matches for “qqqz”" }),
    ).toBeInTheDocument();
  });

  it("picking a recent hands its number straight to onSelect", async () => {
    const onSelect = vi.fn();
    const recents: RecentEntry[] = [{ hymnbookId: "book", hymnNumber: 42, viewedAt: 1 }];
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore()}
        userState={fakeUserState({ getRecents: async () => recents })}
        onSelect={onSelect}
      />
    ));

    // The recent first; the song's own row follows it in the list below.
    const rows = await screen.findAllByRole("button", { name: /Forty-Second Hymn/ });
    expect(rows[0]?.querySelector(".recents-when")).not.toBeNull();
    fireEvent.click(rows[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith(42, "book");
  });

  it("offers a way back to hymnbook selection", async () => {
    const onBack = vi.fn();
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore()}
        userState={fakeUserState()}
        onSelect={vi.fn()}
        onBack={onBack}
      />
    ));

    fireEvent.click(await screen.findByRole("button", { name: "Back to Hymnbooks" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("suggests hymns by number as you type, before any Enter (SDD-0001 §13)", async () => {
    const onSelect = vi.fn();
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({
          listHymns: async () => [
            { number: 4, title: "Four" },
            { number: 42, title: "Forty-Two" },
            { number: 43, title: "Forty-Three" },
            { number: 5, title: "Five" },
          ],
        })}
        userState={fakeUserState()}
        onSelect={onSelect}
      />
    ));
    await screen.findByRole("group", { name: "All songs" });

    fireEvent.input(find(), { target: { value: "4" } });
    const options = await screen.findAllByRole("option");
    // Exact number first, then those starting with it; never "5".
    expect(options.map((o) => o.textContent)).toEqual(["#4Four", "#42Forty-Two", "#43Forty-Three"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    // ↓ then Enter takes the highlighted one.
    fireEvent.keyDown(find(), { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    expect(onSelect).toHaveBeenCalledWith(42, "book");
  });

  it("searches lyrics as typing pauses, without Enter", async () => {
    const searchLyrics = vi.fn(
      async (): Promise<SearchResult[]> => [
        { number: 42, title: "Forty-Second Hymn", snippet: "x" },
      ],
    );
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({ searchLyrics })}
        userState={fakeUserState()}
        onSelect={vi.fn()}
      />
    ));
    await screen.findByRole("group", { name: "All songs" });

    fireEvent.input(find(), { target: { value: "grace" } });
    await waitFor(() => expect(searchLyrics).toHaveBeenCalledWith("book", "grace"));
    expect(await screen.findByRole("option", { name: /Forty-Second Hymn/ })).toBeInTheDocument();
  });

  it("keeps the list while the next query is pending, and empties it only for no results", async () => {
    let finish: (rows: SearchResult[]) => void = () => {};
    const searchLyrics = vi.fn(
      () =>
        new Promise<SearchResult[]>((resolve) => {
          finish = resolve;
        }),
    );
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({ searchLyrics })}
        userState={fakeUserState()}
        onSelect={vi.fn()}
      />
    ));
    await screen.findByRole("group", { name: "All songs" });

    // A number's suggestion stays up through the pause and the read of a words search.
    fireEvent.input(find(), { target: { value: "42" } });
    expect(await screen.findByRole("option", { name: /Forty-Second Hymn/ })).toBeInTheDocument();
    fireEvent.input(find(), { target: { value: "grace" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    await waitFor(() => expect(searchLyrics).toHaveBeenCalledWith("book", "grace"));
    expect(screen.getAllByRole("option")).toHaveLength(1);

    // Then the new results replace it; an empty set empties it.
    finish([{ number: 7, title: "Seventh Hymn", snippet: "x" }]);
    expect(await screen.findByRole("option", { name: /Seventh Hymn/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Forty-Second Hymn/ })).not.toBeInTheDocument();
    fireEvent.input(find(), { target: { value: "graces" } });
    await waitFor(() => expect(searchLyrics).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    finish([]);
    await waitFor(() => expect(screen.queryAllByRole("option")).toHaveLength(0));
  });

  it("clears the query on Escape", async () => {
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore()}
        userState={fakeUserState()}
        onSelect={vi.fn()}
      />
    ));
    await screen.findByRole("group", { name: "All songs" });
    fireEvent.input(find(), { target: { value: "42" } });
    fireEvent.keyDown(find(), { key: "Escape" });
    expect(find()).toHaveValue("");
  });

  it("keeps the top match highlighted when options appear under a resting pointer", async () => {
    const onSelect = vi.fn();
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({
          listHymns: async () => [
            { number: 121, title: "One-Two-One" },
            { number: 1210, title: "Twelve-Ten" },
          ],
        })}
        userState={fakeUserState()}
        onSelect={onSelect}
      />
    ));
    await screen.findByRole("group", { name: "All songs" });

    fireEvent.input(find(), { target: { value: "121" } });
    const [, second] = await screen.findAllByRole("option");
    // The row lands under a still pointer: enter fires, move doesn't.
    fireEvent.mouseEnter(second);
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    expect(onSelect).toHaveBeenCalledWith(121, "book");

    // Moving the pointer does move the highlight.
    fireEvent.mouseMove(second);
    expect(second).toHaveAttribute("aria-selected", "true");
    // Leaving the list takes the highlight with it; Enter still takes the
    // top match.
    fireEvent.mouseLeave(screen.getByRole("listbox"));
    expect(screen.queryByRole("option", { selected: true })).toBeNull();
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    expect(onSelect).toHaveBeenLastCalledWith(121, "book");
  });

  describe("modes: songs, and commands (SDD-0001 §13.3)", () => {
    const renderModes = (extra: Partial<Parameters<typeof Finder>[0]> = {}) => {
      const blank = vi.fn();
      const onSelect = vi.fn();
      render(() => (
        <Finder
          hymnbookId="book"
          store={fakeStore()}
          userState={fakeUserState()}
          onSelect={onSelect}
          commands={[
            { label: "Blank the Output", hint: "B", run: blank },
            { label: "Show Output", hint: "O", run: () => {} },
          ]}
          {...extra}
        />
      ));
      const box = screen.getByRole("combobox", { name: "Find a song or command" });
      const submit = () => fireEvent.submit(box.closest("form") as HTMLFormElement);
      return { blank, onSelect, box, submit };
    };

    it("lists songs only by default; the Songs heading waits for something typed", async () => {
      const { box } = renderModes();
      // The empty list has its own headings (Recents, All songs): no mode heading over them.
      expect(screen.queryByRole("heading", { name: "Songs" })).not.toBeInTheDocument();
      expect(box).toHaveAttribute("placeholder", "Find a song, or > for commands");
      await screen.findByRole("group", { name: "All songs" });
      expect(screen.queryByRole("option", { name: /Output/ })).not.toBeInTheDocument();
      fireEvent.input(box, { target: { value: "bl" } });
      expect(screen.getByRole("heading", { name: "Songs" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /Output/ })).not.toBeInTheDocument();
    });

    it("a > first lists the commands only, under a Commands heading", async () => {
      const { box } = renderModes();
      await screen.findByRole("group", { name: "All songs" });
      fireEvent.input(box, { target: { value: ">" } });
      expect(screen.getByRole("heading", { name: "Commands" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Songs" })).not.toBeInTheDocument();
      expect(box).toHaveAttribute("placeholder", "Find a command");
      expect(screen.getByRole("listbox")).toHaveAccessibleName("Matching commands");
      // Every command with its key; no song, no Recents, no book.
      expect(screen.getAllByRole("option")).toHaveLength(2);
      expect(screen.getByRole("option", { name: /Blank the Output/ })).toHaveTextContent("B");
      expect(screen.queryByText("Recents")).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: "All songs" })).not.toBeInTheDocument();
      // Nothing is highlighted until a word is typed: Enter on the bare > runs nothing.
      expect(screen.queryByRole("option", { selected: true })).toBeNull();
    });

    it("the rest of the box filters the commands by word starts, and Enter runs the top one", () => {
      const { box, blank, submit } = renderModes();
      fireEvent.input(box, { target: { value: ">bl out" } });
      expect(screen.getAllByRole("option")).toHaveLength(1);
      submit();
      expect(blank).toHaveBeenCalled();
      // A space after the marker is fine too.
      fireEvent.input(box, { target: { value: "> show" } });
      expect(screen.getByRole("option", { name: /Show Output/ })).toBeInTheDocument();
    });

    it("never mixes: a song search in commands finds no song, a word in songs no command", async () => {
      const { box } = renderModes();
      fireEvent.input(box, { target: { value: ">forty" } });
      expect(screen.queryByRole("option", { name: /Forty-Second/ })).not.toBeInTheDocument();
      expect(screen.getByText(/No matches for “forty”/)).toBeInTheDocument();
      fireEvent.input(box, { target: { value: "42" } });
      await screen.findByRole("option", { name: /Forty-Second/ });
      expect(screen.queryByRole("option", { name: /Output/ })).not.toBeInTheDocument();
    });

    it("no matching command is the same results card as no matching song", () => {
      const { box } = renderModes();
      fireEvent.input(box, { target: { value: ">zzz" } });
      expect(screen.getByText("No matches for “zzz”")).toBeInTheDocument();
      expect(screen.getByText(/other words from a command/)).toBeInTheDocument();
      expect(screen.queryAllByRole("option")).toHaveLength(0);
    });

    it("Backspace over the > returns to songs", async () => {
      const { box } = renderModes();
      fireEvent.input(box, { target: { value: ">" } });
      expect(screen.getByRole("heading", { name: "Commands" })).toBeInTheDocument();
      fireEvent.input(box, { target: { value: "" } });
      expect(screen.queryByRole("heading", { name: "Songs" })).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Commands" })).not.toBeInTheDocument();
      await screen.findByRole("group", { name: "All songs" });
      expect(screen.queryByRole("option", { name: /Output/ })).not.toBeInTheDocument();
    });

    it("Escape empties the box, which is songs again", async () => {
      const { box } = renderModes();
      fireEvent.input(box, { target: { value: ">bl" } });
      fireEvent.keyDown(box, { key: "Escape" });
      expect(box).toHaveValue("");
      expect(screen.queryByRole("heading", { name: "Commands" })).not.toBeInTheDocument();
    });

    it("a Finder opened with a > starts in commands", () => {
      renderModes({ initialQuery: ">" });
      expect(screen.getByRole("heading", { name: "Commands" })).toBeInTheDocument();
      expect(screen.getAllByRole("option")).toHaveLength(2);
    });

    it("without commands there are no modes: no heading, and a > is text", () => {
      render(() => (
        <Finder
          hymnbookId="book"
          store={fakeStore()}
          userState={fakeUserState()}
          onSelect={() => {}}
        />
      ));
      expect(screen.queryByRole("heading", { name: "Songs" })).not.toBeInTheDocument();
      fireEvent.input(screen.getByRole("combobox"), { target: { value: ">" } });
      expect(screen.queryByRole("heading", { name: "Commands" })).not.toBeInTheDocument();
    });

    it("the quick switcher has no modes: a > is a search for it, and no heading", () => {
      renderModes({ compact: true });
      expect(screen.queryByRole("heading", { name: "Songs" })).not.toBeInTheDocument();
      const box = screen.getByRole("combobox");
      fireEvent.input(box, { target: { value: ">bl" } });
      expect(screen.queryByRole("heading", { name: "Commands" })).not.toBeInTheDocument();
      expect(screen.queryByRole("option", { name: /Output/ })).not.toBeInTheDocument();
    });
  });

  describe("every book (SDD-0001 §13.1)", () => {
    /** `count` results numbered from `from`, each titled by its book. */
    const hits = (title: string, count: number, from = 1): SearchResult[] =>
      Array.from({ length: count }, (_, i) => ({
        number: from + i,
        title: `${title} Song ${from + i}`,
        snippet: `${title} line ${from + i}`,
      }));

    /** Three books held: the current one with eight matches, another with seven, a third with a song the first has too. */
    const allHits = (): BookHits[] => [
      { key: "cur", title: "Current Book", results: hits("Current", 8) },
      { key: "two", title: "Second Book", results: hits("Second", 7) },
      {
        key: "three",
        title: "Third Book",
        results: [{ number: 1, title: "Current Song 1", snippet: "a line" }],
      },
    ];
    const threeBooks = () => {
      const searchAll = vi.fn(async (_query: string, _key: string) => allHits());
      return { searchAll, store: fakeStore({ searchAll }) };
    };
    const oneBook = () =>
      fakeStore({
        searchAll: async () => [{ key: "cur", title: "Current Book", results: hits("Current", 8) }],
      });

    const renderMany = (
      props: Partial<Parameters<typeof Finder>[0]> = {},
      store = threeBooks().store,
    ) => {
      const onSelect = vi.fn();
      render(() => (
        <Finder
          hymnbookId="cur"
          bookTitle="Current Book"
          bookCount={3}
          store={store}
          userState={fakeUserState()}
          onSelect={onSelect}
          {...props}
        />
      ));
      return onSelect;
    };
    const type = async (value: string) => {
      fireEvent.input(find(), { target: { value } });
      await screen.findAllByRole("option");
    };
    const group = (name: string) => within(screen.getByRole("group", { name }));
    const options = () => screen.getAllByRole("option");
    const selected = () => options().findIndex((option) => option.ariaSelected === "true");

    it("groups the matches under their books' titles, the current book first", async () => {
      renderMany();
      await type("line");
      const groups = screen.getAllByRole("group");
      expect(groups).toHaveLength(3);
      expect(groups.map((g) => g.getAttribute("aria-labelledby")?.length)).not.toContain(0);
      expect(groups[0]).toHaveAccessibleName("Current Book");
      expect(groups[1]).toHaveAccessibleName("Second Book");
      expect(groups[2]).toHaveAccessibleName("Third Book");
      // The listbox holds only groups, and each option sits in one.
      for (const option of options()) expect(option.closest('[role="group"]')).not.toBeNull();
    });

    it("shows every result of the current book and the first five of another, then More in", async () => {
      renderMany();
      await type("line");
      expect(group("Current Book").getAllByRole("option")).toHaveLength(8);
      const second = group("Second Book").getAllByRole("option");
      expect(second).toHaveLength(6);
      expect(second[5]).toHaveTextContent("More in Second Book");
      // A book with five or fewer has no More in.
      expect(group("Third Book").getAllByRole("option")).toHaveLength(1);
    });

    it("More in opens that group in place, and a new search closes it", async () => {
      renderMany();
      await type("line");
      fireEvent.mouseDown(group("Second Book").getByRole("option", { name: /More in/ }));
      expect(group("Second Book").getAllByRole("option")).toHaveLength(7);
      expect(group("Second Book").queryByText(/More in/)).not.toBeInTheDocument();
      fireEvent.input(find(), { target: { value: "lines" } });
      await waitFor(() => expect(group("Second Book").getAllByRole("option")).toHaveLength(6));
    });

    it("the arrow keys move through every group as one list, More in included, and Enter opens it", async () => {
      renderMany();
      await type("line");
      expect(selected()).toBe(0);
      // Down past the current book's eight lands in the next group.
      for (let i = 0; i < 8; i++) fireEvent.keyDown(find(), { key: "ArrowDown" });
      expect(options()[8]).toHaveTextContent("Second Song 1");
      expect(selected()).toBe(8);
      // Five more reach More in.
      for (let i = 0; i < 5; i++) fireEvent.keyDown(find(), { key: "ArrowDown" });
      expect(options()[13]).toHaveTextContent("More in Second Book");
      expect(find()).toHaveAttribute("aria-activedescendant", options()[13].id);
      fireEvent.submit(find().closest("form") as HTMLFormElement);
      expect(group("Second Book").getAllByRole("option")).toHaveLength(7);
      // The highlight is on the first song that was hidden.
      expect(options()[13]).toHaveTextContent("Second Song 6");
      expect(selected()).toBe(13);
    });

    it("Enter on a highlighted row still picks while the next search is pending and a group had been opened", async () => {
      let release: (hits: BookHits[]) => void = () => {};
      const searchAll = vi.fn(async (query: string) =>
        query === "line" ? allHits() : await new Promise<BookHits[]>((r) => (release = r)),
      );
      const onSelect = renderMany({}, fakeStore({ searchAll }));
      await type("line");
      fireEvent.mouseDown(group("Second Book").getByRole("option", { name: /More in/ }));
      // Typing resets the highlight; the arrows then move it to the last of the sixteen rows.
      fireEvent.input(find(), { target: { value: "lines" } });
      fireEvent.keyDown(find(), { key: "ArrowUp" });
      expect(options()).toHaveLength(16);
      // The search starts after the pause, and has not answered: the list must not have shrunk.
      await waitFor(() => expect(searchAll).toHaveBeenCalledWith("lines", "cur", undefined));
      expect(options()).toHaveLength(16);
      fireEvent.submit(find().closest("form") as HTMLFormElement);
      expect(onSelect).toHaveBeenCalledWith(1, "three");
      release([]);
    });

    it("never shows an empty heading or an unnamed group as a number turns into words", async () => {
      renderMany();
      fireEvent.input(find(), { target: { value: "42" } });
      await screen.findByRole("option", { name: /Forty-Second Hymn/ });
      // Words typed: the number's suggestions stay up until the search answers.
      fireEvent.input(find(), { target: { value: "lord" } });
      expect(screen.getByRole("option", { name: /Forty-Second Hymn/ })).toBeInTheDocument();
      for (const heading of document.querySelectorAll(".finder-group-heading"))
        expect(heading.textContent).not.toBe("");
      for (const g of screen.queryAllByRole("group")) expect(g).toHaveAccessibleName();
    });

    it("Enter takes the top of the first group unless moved, and a pick in another book hands its key", async () => {
      const onSelect = renderMany();
      await type("line");
      fireEvent.submit(find().closest("form") as HTMLFormElement);
      expect(onSelect).toHaveBeenLastCalledWith(1, "cur");

      fireEvent.mouseDown(group("Second Book").getAllByRole("option")[2]);
      expect(onSelect).toHaveBeenLastCalledWith(3, "two");
    });

    it("shows a song held in two books under each, each handing its own book", async () => {
      const onSelect = renderMany();
      await type("line");
      expect(screen.getAllByRole("option", { name: /Current Song 1/ })).toHaveLength(2);
      fireEvent.mouseDown(group("Third Book").getByRole("option", { name: /Current Song 1/ }));
      expect(onSelect).toHaveBeenLastCalledWith(1, "three");
    });

    it("searches with the current book's key", async () => {
      const { searchAll, store } = threeBooks();
      renderMany({}, store);
      await type("line");
      expect(searchAll).toHaveBeenCalledWith("line", "cur", undefined);
    });

    describe("a number (ADR-0032, amended)", () => {
      const num = (title: string, number: number) => ({ number, title, snippet: "" });
      /** Other books holding 42 and 421; the current book holds 42 only. */
      const numberHits = (): BookHits[] => [
        { key: "cur", title: "Current Book", results: [num("Forty-Second Hymn", 42)] },
        {
          key: "two",
          title: "Second Book",
          results: [num("Second Forty-Two", 42), num("Second 421", 421)],
        },
        { key: "three", title: "Third Book", results: [num("Third Forty-Two", 42)] },
      ];
      const withNumbers = (
        searchNumber = vi.fn(async (_n: string, _k: string) => numberHits()),
      ) => ({
        searchNumber,
        store: fakeStore({ searchNumber }),
      });
      const submitForm = () => fireEvent.submit(find().closest("form") as HTMLFormElement);

      it("suggests the number from every book, grouped, the current book first and its exact match highlighted", async () => {
        const { searchNumber, store } = withNumbers();
        renderMany({}, store);
        fireEvent.input(find(), { target: { value: "42" } });
        await screen.findByRole("option", { name: /Second Forty-Two/ });
        expect(searchNumber).toHaveBeenCalledWith("42", "cur", undefined);
        const groups = screen.getAllByRole("group");
        expect(groups.map((g) => g.getAttribute("aria-label") ?? g.textContent)).toHaveLength(3);
        expect(groups[0]).toHaveAccessibleName("Current Book");
        expect(groups[1]).toHaveAccessibleName("Second Book");
        expect(groups[2]).toHaveAccessibleName("Third Book");
        // Exact first, then the prefix matches.
        expect(
          group("Second Book")
            .getAllByRole("option")
            .map((o) => o.textContent),
        ).toEqual([expect.stringContaining("Second Forty-Two"), expect.stringContaining("421")]);
        expect(selected()).toBe(0);
        expect(options()[0]).toHaveTextContent("Forty-Second Hymn");
      });

      it("Enter opens the current book's song, even before the other books have answered", async () => {
        const searchNumber = vi.fn(() => new Promise<BookHits[]>(() => {}));
        const onSelect = renderMany({}, withNumbers(searchNumber).store);
        fireEvent.input(find(), { target: { value: "42" } });
        await screen.findByRole("option", { name: /Forty-Second Hymn/ });
        submitForm();
        expect(onSelect).toHaveBeenCalledWith(42, "cur");
      });

      it("Enter on a number the current book lacks opens it there, not another book's song", async () => {
        const onSelect = renderMany(
          {},
          fakeStore({
            listHymns: async () => [],
            searchNumber: async () => [
              { key: "two", title: "Second Book", results: [num("Second Forty-Two", 42)] },
            ],
          }),
        );
        fireEvent.input(find(), { target: { value: "42" } });
        await screen.findByRole("option", { name: /Second Forty-Two/ });
        submitForm();
        expect(onSelect).toHaveBeenCalledWith(42, "cur");
      });

      it("the arrow keys reach another book's row, and picking it hands that book", async () => {
        const onSelect = renderMany({}, withNumbers().store);
        fireEvent.input(find(), { target: { value: "42" } });
        await screen.findByRole("option", { name: /Second Forty-Two/ });
        fireEvent.keyDown(find(), { key: "ArrowDown" });
        expect(options()[1]).toHaveTextContent("Second Forty-Two");
        expect(selected()).toBe(1);
        submitForm();
        expect(onSelect).toHaveBeenLastCalledWith(42, "two");
        fireEvent.mouseDown(group("Third Book").getByRole("option", { name: /Third Forty-Two/ }));
        expect(onSelect).toHaveBeenLastCalledWith(42, "three");
      });

      it("with one book held, or in the quick switcher, only the current book is suggested", async () => {
        const { searchNumber, store } = withNumbers();
        const onSelect = renderMany({ bookCount: 1 }, store);
        fireEvent.input(find(), { target: { value: "42" } });
        await screen.findByRole("option", { name: /Forty-Second Hymn/ });
        expect(screen.queryByRole("group")).not.toBeInTheDocument();
        submitForm();
        expect(onSelect).toHaveBeenCalledWith(42, "cur");
        cleanup();
        renderMany({ compact: true, bookTitle: undefined }, store);
        fireEvent.input(find(), { target: { value: "42" } });
        await screen.findByRole("option", { name: /Forty-Second Hymn/ });
        expect(options()).toHaveLength(1);
        expect(searchNumber).not.toHaveBeenCalled();
      });
    });

    it("in command mode no book's songs are listed, and the commands have no group", async () => {
      const blank = vi.fn();
      renderMany({ commands: [{ label: "Blank Line", run: blank }] });
      const box = screen.getByRole("combobox", { name: "Find a song or command" });
      fireEvent.input(box, { target: { value: "line" } });
      await screen.findAllByRole("option", { name: /Current Song 1/ });
      expect(screen.queryByRole("option", { name: "Blank Line" })).not.toBeInTheDocument();
      fireEvent.input(box, { target: { value: ">line" } });
      expect(options()).toHaveLength(1);
      expect(options()[0]).toHaveTextContent("Blank Line");
      expect(screen.queryByRole("group", { name: "Current Book" })).not.toBeInTheDocument();
      fireEvent.submit(box.closest("form") as HTMLFormElement);
      expect(blank).toHaveBeenCalled();
    });

    it("with one book held there are no groups or More in, and a pick names that book", async () => {
      const onSelect = renderMany({ bookCount: 1 }, oneBook());
      await type("line");
      expect(screen.queryByRole("group")).not.toBeInTheDocument();
      expect(options()).toHaveLength(8);
      expect(screen.queryByText(/More in/)).not.toBeInTheDocument();
      fireEvent.mouseDown(options()[1]);
      expect(onSelect).toHaveBeenCalledWith(2, "cur");
    });

    it("the quick switcher groups the same way, with a few songs from each book", async () => {
      renderMany({ compact: true, bookTitle: undefined });
      await type("line");
      expect(group("Current Book").getAllByRole("option")).toHaveLength(3);
      expect(group("Second Book").getAllByRole("option")).toHaveLength(3);
      expect(screen.queryByText(/More in/)).not.toBeInTheDocument();
    });

    it("the quick switcher shows five songs from the one book when only one is held", async () => {
      renderMany({ compact: true, bookCount: 1 }, oneBook());
      await type("line");
      expect(screen.queryByRole("group")).not.toBeInTheDocument();
      expect(options()).toHaveLength(5);
    });
  });
});
