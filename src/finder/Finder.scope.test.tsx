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
  it("shows All Books, This Book and Books…, All Books pressed, in songs mode with several books", () => {
    renderFinder();
    const row = screen.getByRole("group", { name: "Search in" });
    expect(
      within(row)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["All Books", "This Book", "Books…"]);
    expect(chip("All Books")).toHaveAttribute("aria-pressed", "true");
    expect(chip("This Book")).toHaveAttribute("aria-pressed", "false");
    expect(chip("Books…")).toHaveAttribute("aria-pressed", "false");
    expect(chip("Books…")).toHaveAttribute("aria-haspopup", "dialog");
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
    expect(chip("Books…")).toBeInTheDocument();
  });

  describe("Books…", () => {
    const open = (name: string = "Books…") => {
      fireEvent.click(chip(name));
      return screen.getByRole("dialog", { name: "Search these books" });
    };

    it("opens a checklist by title; none checked cannot be applied", () => {
      renderFinder();
      const dialog = open();
      expect(chip("Books…")).toHaveAttribute("aria-expanded", "true");
      expect(
        within(dialog)
          .getAllByRole("checkbox")
          .map((box) => box.parentElement?.textContent),
      ).toEqual(["Current Book", "Second Book", "Third Book"]);
      expect(within(dialog).getByRole("button", { name: "Done" })).toBeDisabled();
    });

    it("applies the checked books on Done: N Books, pressed, and reported", async () => {
      const searchAll = vi.fn(async (_q: string, _k: string, books?: readonly string[]) =>
        narrowed(books),
      );
      const { onScope } = renderFinder({}, fakeStore({ searchAll }));
      type("line");
      await screen.findByRole("group", { name: "Third Book" });
      const dialog = open();
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Second Book" }));
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Third Book" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
      expect(onScope).toHaveBeenCalledWith({ mode: "books", books: ["two", "three"] });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(chip("2 Books")).toHaveAttribute("aria-pressed", "true");
      expect(chip("All Books")).toHaveAttribute("aria-pressed", "false");
      await waitFor(() =>
        expect(searchAll).toHaveBeenLastCalledWith("line", "cur", ["two", "three"]),
      );
      await waitFor(() =>
        expect(screen.queryByRole("group", { name: "Current Book" })).not.toBeInTheDocument(),
      );
    });

    it("Escape drops the draft and closes only the checklist", () => {
      const { onScope } = renderFinder();
      const dialog = open();
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "Second Book" }));
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(onScope).not.toHaveBeenCalled();
      expect(chip("Books…")).toHaveFocus();
      expect(chip("All Books")).toHaveAttribute("aria-pressed", "true");
    });

    it("starts from the chosen books", () => {
      renderFinder({ scope: { mode: "books", books: ["three"] } });
      const dialog = open("1 Book");
      expect(within(dialog).getByRole("checkbox", { name: "Third Book" })).toBeChecked();
      expect(within(dialog).getByRole("checkbox", { name: "Second Book" })).not.toBeChecked();
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
      expect(chip("Books…")).toHaveFocus();
      fireEvent.keyDown(chip("Books…"), { key: "ArrowRight" });
      expect(chip("All Books")).toHaveFocus();
      fireEvent.keyDown(chip("All Books"), { key: "ArrowLeft" });
      expect(chip("Books…")).toHaveFocus();
      fireEvent.keyDown(chip("Books…"), { key: "Home" });
      expect(chip("All Books")).toHaveFocus();
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

  it("a scope is typed as stored", () => {
    const scope: SearchScope = { mode: "books", books: ["two"] };
    renderFinder({ scope });
    expect(chip("1 Book")).toBeInTheDocument();
  });
});
