import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookHits, ContentStore, SearchResult } from "../persistence/content-store.ts";
import type { SearchScope, UserState } from "../persistence/user-state.ts";
import { Finder } from "./Finder.tsx";
import { scopeOf } from "./sources.ts";

const BOOKS = [
  { key: "cur", title: "Current Book" },
  { key: "two", title: "Second Book" },
  { key: "three", title: "Third Book" },
];

const hit = (title: string, number: number): SearchResult => ({
  number,
  title,
  snippet: "a line",
});

/** Every book has a match; a search narrowed to some books finds only theirs. */
const everyBook = (): BookHits[] =>
  BOOKS.map((book, at) => ({
    key: book.key,
    title: book.title,
    results: [hit(`${book.title} Song`, 10 + at)],
  }));

const narrowed = (books: readonly string[] | undefined) =>
  everyBook().filter((hits) => !books || books.includes(hits.key));

function fakeStore(overrides: Partial<ContentStore> = {}): ContentStore {
  return {
    ensureInstalled: async () => ({ state: "ready" }),
    getHymnbook: async () => {
      throw new Error("not used");
    },
    listHymns: async () => [{ number: 42, title: "Forty-Second Hymn" }],
    getHymn: async () => {
      throw new Error("not used");
    },
    searchLyrics: async () => [],
    searchAll: async (_query, _key, books) => narrowed(books),
    searchNumber: async (_typed, _key, books) => narrowed(books),
    searchMore: async () => ({ results: [], more: false }),
    ...overrides,
  };
}

const userState = (): UserState => ({
  getLastPosition: async () => undefined,
  setLastPosition: async () => {},
  getRecents: async () => [],
  addRecent: async () => {},
  dropRecents: async () => {},
  dropSong: async () => {},
  getPreferences: async () => ({ theme: "system", fontScale: 1 }),
  setPreferences: async () => {},
});

const renderFinder = (props: Partial<Parameters<typeof Finder>[0]> = {}, store = fakeStore()) => {
  const onSelect = vi.fn();
  const onScope = vi.fn();
  render(() => (
    <Finder
      hymnbookId="cur"
      bookTitle="Current Book"
      bookCount={3}
      books={BOOKS}
      store={store}
      userState={userState()}
      onSelect={onSelect}
      onScope={onScope}
      commands={[{ label: "Blank the Output", run: () => {} }]}
      {...props}
    />
  ));
  return { onSelect, onScope };
};
const field = () => screen.getByRole("combobox");
const chip = (name: string | RegExp) => screen.getByRole("button", { name });
const type = (value: string) => fireEvent.input(field(), { target: { value } });

afterEach(cleanup);

describe("scopeOf", () => {
  const held = ["a", "b", "c"];
  it("is every book by default", () => {
    expect(scopeOf(undefined, held, "a")).toEqual({ mode: "all", keys: undefined });
    expect(scopeOf({ mode: "all" }, held, "a")).toEqual({ mode: "all", keys: undefined });
  });
  it("is the current book for This Book, or every book when there is none", () => {
    expect(scopeOf({ mode: "this" }, held, "b")).toEqual({ mode: "this", keys: ["b"] });
    expect(scopeOf({ mode: "this" }, held, undefined).mode).toBe("all");
    expect(scopeOf({ mode: "this" }, held, "gone").mode).toBe("all");
  });
  it("keeps the chosen books still held, in the Library's order", () => {
    expect(scopeOf({ mode: "books", books: ["c", "gone", "a"] }, held, "a")).toEqual({
      mode: "books",
      keys: ["a", "c"],
    });
  });
  it("is every book when no chosen book is held any more", () => {
    expect(scopeOf({ mode: "books", books: ["gone"] }, held, "a").mode).toBe("all");
    expect(scopeOf({ mode: "books" }, held, "a").mode).toBe("all");
  });
});

describe("Finder scope chips (SDD-0001 §13.4)", () => {
  it("shows This Book and one All Books chip, pressed, in songs mode with several books", () => {
    renderFinder();
    const row = screen.getByRole("group", { name: "Search in" });
    expect(
      within(row)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["This Book", "All Books"]);
    expect(chip("All Books")).toHaveAttribute("aria-pressed", "true");
    expect(chip("This Book")).toHaveAttribute("aria-pressed", "false");
    expect(chip("All Books")).toHaveAttribute("aria-haspopup", "listbox");
  });

  it("has no chips with one book, in commands, or in the quick switcher", () => {
    renderFinder({ books: [BOOKS[0] as (typeof BOOKS)[number]], bookCount: 1 });
    expect(screen.queryByRole("group", { name: "Search in" })).not.toBeInTheDocument();
    cleanup();
    renderFinder({ compact: true });
    expect(screen.queryByRole("group", { name: "Search in" })).not.toBeInTheDocument();
    cleanup();
    renderFinder();
    expect(screen.getByRole("group", { name: "Search in" })).toBeInTheDocument();
    type(">");
    expect(screen.queryByRole("group", { name: "Search in" })).not.toBeInTheDocument();
    type("");
    expect(screen.getByRole("group", { name: "Search in" })).toBeInTheDocument();
  });

  it("leaves out This Book when the current book is not one held", () => {
    renderFinder({ hymnbookId: "gone" });
    expect(screen.queryByRole("button", { name: "This Book" })).not.toBeInTheDocument();
  });

  it("searches every book by default, and only the current one under This Book", async () => {
    const searchAll = vi.fn(async (_q: string, _k: string, books?: readonly string[]) =>
      narrowed(books),
    );
    const { onScope } = renderFinder({}, fakeStore({ searchAll }));
    type("line");
    await screen.findByRole("group", { name: "Third Book" });
    expect(searchAll).toHaveBeenLastCalledWith("line", "cur", undefined);
    fireEvent.click(chip("This Book"));
    expect(onScope).toHaveBeenCalledWith({ mode: "this" });
    expect(chip("This Book")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(searchAll).toHaveBeenLastCalledWith("line", "cur", ["cur"]));
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "Third Book" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("option", { name: /Current Book Song/ })).toBeInTheDocument();
    // One book in scope: no heading to name it.
    expect(screen.queryByRole("group", { name: "Current Book" })).not.toBeInTheDocument();
  });

  it("scopes a typed number to the books in scope", async () => {
    const searchNumber = vi.fn(async (_t: string, _k: string, books?: readonly string[]) =>
      narrowed(books),
    );
    renderFinder(
      { scope: { mode: "books", books: ["two", "three"] } },
      fakeStore({ searchNumber }),
    );
    type("1");
    await screen.findByRole("group", { name: "Second Book" });
    expect(searchNumber).toHaveBeenLastCalledWith("1", "cur", ["two", "three"]);
    // The current book is outside the scope: not suggested, not highlighted.
    expect(screen.queryByRole("group", { name: "Current Book" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("reads the remembered scope, and a chosen book no longer held drops out", () => {
    renderFinder({ scope: { mode: "books", books: ["two", "gone"] } });
    expect(chip("1 Book")).toHaveAttribute("aria-pressed", "true");
    cleanup();
    renderFinder({ scope: { mode: "books", books: ["gone"] } });
    expect(chip("All Books")).toHaveAttribute("aria-pressed", "true");
  });

  describe("the books list", () => {
    const open = (name: string = "All Books") => {
      fireEvent.click(chip(name));
      return screen.getByRole("listbox", { name: "Books to search" });
    };
    const row = (name: string) => screen.getByRole("option", { name });
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ key: `b${i}`, title: `Hymnbook ${i + 1}` }));
    const ticked = () =>
      within(screen.getByRole("listbox", { name: "Books to search" }))
        .getAllByRole("option")
        .filter((r) => r.getAttribute("aria-selected") === "true")
        .map((r) => r.textContent);

    it("opens a multi-select list of titles, every book ticked, no checkbox and no Done", async () => {
      renderFinder();
      const list = open();
      expect(chip("All Books")).toHaveAttribute("aria-expanded", "true");
      expect(list).toHaveAttribute("aria-multiselectable", "true");
      const rows = within(list).getAllByRole("option");
      expect(rows.map((r) => r.textContent)).toEqual(["Current Book", "Second Book", "Third Book"]);
      expect(ticked()).toEqual(["Current Book", "Second Book", "Third Book"]);
      expect(rows[1]).toHaveAttribute("title", "Second Book");
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Filter books" })).not.toBeInTheDocument();
      await waitFor(() => expect(list).toHaveFocus());
    });

    it("unticking narrows at once: N Books, reported, searched; ticking all again is All Books", async () => {
      const searchAll = vi.fn(async (_q: string, _k: string, books?: readonly string[]) =>
        narrowed(books),
      );
      const { onScope } = renderFinder({}, fakeStore({ searchAll }));
      type("line");
      await screen.findByRole("group", { name: "Third Book" });
      open();
      fireEvent.click(row("Current Book"));
      expect(onScope).toHaveBeenLastCalledWith({ mode: "books", books: ["two", "three"] });
      expect(ticked()).toEqual(["Second Book", "Third Book"]);
      // The list stays open for the next tap.
      expect(screen.getByRole("listbox", { name: "Books to search" })).toBeInTheDocument();
      expect(chip("2 Books")).toHaveAttribute("aria-pressed", "true");
      await waitFor(() =>
        expect(searchAll).toHaveBeenLastCalledWith("line", "cur", ["two", "three"]),
      );
      fireEvent.click(row("Current Book"));
      expect(onScope).toHaveBeenLastCalledWith({ mode: "all" });
      expect(chip("All Books")).toHaveAttribute("aria-pressed", "true");
    });

    it("the last ticked book cannot be unticked: its row is aria-disabled and a tap does nothing", () => {
      const { onScope } = renderFinder({ scope: { mode: "books", books: ["three"] } });
      open("1 Book");
      expect(row("Third Book")).toHaveAttribute("aria-disabled", "true");
      expect(row("Second Book")).not.toHaveAttribute("aria-disabled");
      onScope.mockClear();
      fireEvent.click(row("Third Book"));
      expect(onScope).not.toHaveBeenCalled();
      expect(ticked()).toEqual(["Third Book"]);
      expect(chip("1 Book")).toHaveAttribute("aria-pressed", "true");
    });

    it("Escape closes only the list, and focus returns to the chip", () => {
      const { onScope } = renderFinder();
      const list = open();
      fireEvent.keyDown(list, { key: "Escape" });
      expect(screen.queryByRole("listbox", { name: "Books to search" })).not.toBeInTheDocument();
      expect(onScope).not.toHaveBeenCalled();
      expect(chip("All Books")).toHaveFocus();
    });

    it("the chip pressed again closes it, choosing nothing", () => {
      const { onScope } = renderFinder();
      open();
      fireEvent.click(chip("All Books"));
      expect(screen.queryByRole("listbox", { name: "Books to search" })).not.toBeInTheDocument();
      expect(onScope).not.toHaveBeenCalled();
    });

    it("the arrows move, Space and Enter toggle", () => {
      const { onScope } = renderFinder();
      const list = open();
      fireEvent.keyDown(list, { key: "ArrowDown" });
      expect(list).toHaveAttribute("aria-activedescendant", row("Second Book").id);
      fireEvent.keyDown(list, { key: " " });
      expect(onScope).toHaveBeenLastCalledWith({ mode: "books", books: ["cur", "three"] });
      fireEvent.keyDown(list, { key: "ArrowDown" });
      fireEvent.keyDown(list, { key: "Enter" });
      // Two books are left ticked, then one: the third is unticked, the first remains.
      expect(onScope).toHaveBeenLastCalledWith({ mode: "books", books: ["cur"] });
    });

    it("has a filter field past six books, none at six", async () => {
      renderFinder({ books: many(6), bookCount: 6 });
      open();
      expect(screen.queryByRole("combobox", { name: "Filter books" })).not.toBeInTheDocument();
      cleanup();
      renderFinder({ books: many(7), bookCount: 7 });
      open();
      const filter = screen.getByRole("combobox", { name: "Filter books" });
      expect(filter).toHaveAttribute("maxlength", "100");
      await waitFor(() => expect(filter).toHaveFocus());
    });

    it("filters by title, any case, every word; Enter toggles the first; Space types", () => {
      const books = [
        ...many(6),
        { key: "ml", title: "ഹൃദയ ഗീതങ്ങൾ" },
        { key: "fr", title: "Édition Française" },
      ];
      const { onScope } = renderFinder({ books, bookCount: books.length });
      open();
      const filter = screen.getByRole("combobox", { name: "Filter books" });
      const rows = () => screen.getAllByRole("option").map((r) => r.textContent);
      fireEvent.input(filter, { target: { value: "FRANCAISE edition" } });
      expect(rows()).toEqual(["Édition Française"]);
      fireEvent.input(filter, { target: { value: "ഗീത" } });
      expect(rows()).toEqual(["ഹൃദയ ഗീതങ്ങൾ"]);
      fireEvent.input(filter, { target: { value: "hymnbook 3" } });
      expect(rows()).toEqual(["Hymnbook 3"]);
      fireEvent.keyDown(filter, { key: " " });
      expect(onScope).not.toHaveBeenCalled();
      fireEvent.keyDown(filter, { key: "Enter" });
      expect(onScope).toHaveBeenCalledWith({
        mode: "books",
        books: ["b0", "b1", "b3", "b4", "b5", "ml", "fr"],
      });
      fireEvent.input(filter, { target: { value: "zzz" } });
      expect(screen.getByText("No book matches.")).toBeInTheDocument();
    });

    it("Enter in the filter does not submit the Finder", () => {
      const { onSelect } = renderFinder({ books: many(8), bookCount: 8 });
      open();
      const filter = screen.getByRole("combobox", { name: "Filter books" });
      const submitted = fireEvent.keyDown(filter, { key: "Enter" });
      expect(submitted).toBe(false);
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("starts at the first ticked book", () => {
      renderFinder({ scope: { mode: "books", books: ["three"] } });
      const list = open("1 Book");
      expect(ticked()).toEqual(["Third Book"]);
      expect(list).toHaveAttribute("aria-activedescendant", row("Third Book").id);
    });

    it("from This Book, one tap on the chip returns to the set it left and opens the list", () => {
      const { onScope } = renderFinder({ scope: { mode: "books", books: ["two", "three"] } });
      fireEvent.click(chip("This Book"));
      expect(chip("This Book")).toHaveAttribute("aria-pressed", "true");
      expect(chip("2 Books")).toHaveAttribute("aria-pressed", "false");
      onScope.mockClear();
      open("2 Books");
      expect(onScope).toHaveBeenCalledWith({ mode: "books", books: ["two", "three"] });
      expect(chip("2 Books")).toHaveAttribute("aria-pressed", "true");
      expect(chip("This Book")).toHaveAttribute("aria-pressed", "false");
      expect(ticked()).toEqual(["Second Book", "Third Book"]);
    });

    it("from This Book with All Books before it, the tap returns to All Books", () => {
      const { onScope } = renderFinder();
      fireEvent.click(chip("This Book"));
      onScope.mockClear();
      open();
      expect(onScope).toHaveBeenCalledWith({ mode: "all" });
      expect(chip("All Books")).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("This Book for one opening", () => {
    it("searches the current book without being remembered", () => {
      const { onScope } = renderFinder({ thisBookOnce: true, scope: { mode: "all" } });
      expect(chip("This Book")).toHaveAttribute("aria-pressed", "true");
      expect(chip("All Books")).toHaveAttribute("aria-pressed", "false");
      expect(onScope).not.toHaveBeenCalled();
    });

    it("the set chip pressed meanwhile is a choice: remembered, and it stays", () => {
      const { onScope } = renderFinder({ thisBookOnce: true, scope: { mode: "all" } });
      fireEvent.click(chip("All Books"));
      expect(onScope).toHaveBeenCalledWith({ mode: "all" });
      expect(chip("All Books")).toHaveAttribute("aria-pressed", "true");
    });

    it("without it the remembered scope rules", () => {
      renderFinder({ scope: { mode: "all" } });
      expect(chip("All Books")).toHaveAttribute("aria-pressed", "true");
    });
  });

  describe("no match in a narrowed scope", () => {
    const empty = fakeStore({ searchAll: async (_q, _k, books) => (books ? [] : everyBook()) });

    it("says where it looked and offers All Books, which searches again", async () => {
      const { onScope } = renderFinder({ scope: { mode: "this" } }, empty);
      type("zzz");
      await screen.findByRole("heading", { name: "No matches in This Book" });
      fireEvent.click(screen.getByRole("button", { name: "Search All Books" }));
      expect(onScope).toHaveBeenCalledWith({ mode: "all" });
      expect(chip("All Books")).toHaveAttribute("aria-pressed", "true");
      await screen.findByRole("group", { name: "Third Book" });
      expect(screen.queryByRole("heading", { name: /No matches/ })).not.toBeInTheDocument();
      expect(field()).toHaveFocus();
    });

    it("names a chosen set by its count", async () => {
      renderFinder({ scope: { mode: "books", books: ["cur", "two"] } }, empty);
      type("zzz");
      await screen.findByRole("heading", { name: "No matches in 2 Books" });
    });

    it("in All Books keeps the plain card, with no button", async () => {
      renderFinder({}, fakeStore({ searchAll: async () => [] }));
      type("zzz");
      await screen.findByRole("heading", { name: "No matches for “zzz”" });
      expect(screen.queryByRole("button", { name: "Search All Books" })).not.toBeInTheDocument();
    });
  });

  describe("keyboard", () => {
    it("Tab order is the field then the pressed chip; arrows move along the row", () => {
      renderFinder({ scope: { mode: "this" } });
      expect(chip("All Books")).toHaveAttribute("tabindex", "-1");
      expect(chip("This Book")).toHaveAttribute("tabindex", "0");
      chip("This Book").focus();
      fireEvent.keyDown(chip("This Book"), { key: "ArrowRight" });
      expect(chip("All Books")).toHaveFocus();
      fireEvent.keyDown(chip("All Books"), { key: "ArrowRight" });
      expect(chip("This Book")).toHaveFocus();
      fireEvent.keyDown(chip("This Book"), { key: "End" });
      expect(chip("All Books")).toHaveFocus();
      fireEvent.keyDown(chip("All Books"), { key: "Home" });
      expect(chip("This Book")).toHaveFocus();
    });

    it("the field's arrows and Enter are unchanged with the chips there", async () => {
      const { onSelect } = renderFinder();
      type("line");
      await screen.findByRole("group", { name: "Third Book" });
      fireEvent.keyDown(field(), { key: "ArrowDown" });
      fireEvent.submit(field().closest("form") as HTMLFormElement);
      expect(onSelect).toHaveBeenCalledWith(11, "two");
    });
  });

  it("the Songs heading waits for something typed", () => {
    renderFinder();
    expect(screen.queryByRole("heading", { name: "Songs" })).not.toBeInTheDocument();
    type("l");
    expect(screen.getByRole("heading", { name: "Songs" })).toBeInTheDocument();
  });

  it("the placeholder says what to type, and nothing of commands", () => {
    renderFinder();
    expect(field()).toHaveAttribute("placeholder", "Number, title or words");
    expect(field()).toHaveAccessibleName("Find a song or command");
    type(">");
    expect(field()).toHaveAttribute("placeholder", "Find a command");
  });

  it("a scope is typed as stored", () => {
    const scope: SearchScope = { mode: "books", books: ["two"] };
    renderFinder({ scope });
    expect(chip("1 Book")).toBeInTheDocument();
  });
});
