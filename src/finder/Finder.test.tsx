import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HymnbookId, HymnNumber, HymnSource } from "../domain/types.ts";
import type { ContentStore, SearchResult } from "../persistence/content-store.ts";
import type { RecentEntry, UserState } from "../persistence/user-state.ts";
import { Finder, OPENING_SONGS } from "./Finder.tsx";

const HYMN_42: HymnSource = {
  number: 42,
  title: "Forty-Second Hymn",
  parts: [],
  sequence: [],
  meta: {},
};

function fakeStore(overrides: Partial<ContentStore> = {}): ContentStore {
  return {
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
    ...overrides,
  };
}

function fakeUserState(overrides: Partial<UserState> = {}): UserState {
  return {
    getLastPosition: async () => undefined,
    setLastPosition: async () => {},
    getRecents: async () => [],
    addRecent: async () => {},
    dropRecents: async () => {},
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
  /** A book of `count` songs, numbered from 1, listed backwards so the order is not the list's own. */
  const book = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      number: count - i,
      title: `Song Number ${count - i}`,
    }));
  const songsList = () => screen.getByRole("region", { name: "Songs" });

  it("with nothing typed, shows the book's first songs by number, not an empty recents line", async () => {
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({ listHymns: async () => book(50) })}
        userState={fakeUserState()}
        onSelect={vi.fn()}
      />
    ));
    await screen.findByRole("heading", { name: "From the start" });
    const rows = within(songsList()).getAllByRole("button");
    expect(rows).toHaveLength(OPENING_SONGS);
    expect(rows[0]).toHaveTextContent("#1");
    expect(rows[OPENING_SONGS - 1]).toHaveTextContent(`#${OPENING_SONGS}`);
    expect(screen.queryByText("No recent songs yet.")).not.toBeInTheDocument();
    // Recents has nothing to say, so it says nothing: no heading over an empty list.
    expect(screen.queryByRole("heading", { name: "Recents" })).not.toBeInTheDocument();
  });

  it("calls a short book's list Songs, and opens a song picked from it", async () => {
    const onSelect = vi.fn();
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({ listHymns: async () => book(3) })}
        userState={fakeUserState()}
        onSelect={onSelect}
      />
    ));
    await screen.findByRole("heading", { name: "Songs" });
    fireEvent.click(within(songsList()).getByRole("button", { name: /Song Number 2/ }));
    expect(onSelect).toHaveBeenCalledWith(2);
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
    const songsHeading = await screen.findByRole("heading", { name: "From the start" });
    expect(
      recentsHeading.compareDocumentPosition(songsHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText("No recent songs yet.")).not.toBeInTheDocument();
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
    await screen.findByRole("heading", { name: "From the start" });
    fireEvent.input(find(), { target: { value: "2" } });
    expect(screen.queryByRole("heading", { name: "From the start" })).not.toBeInTheDocument();
    fireEvent.input(find(), { target: { value: "" } });
    expect(await screen.findByRole("heading", { name: "From the start" })).toBeInTheDocument();
  });

  it("keeps the empty recents line where there is no song list to show instead", async () => {
    render(() => (
      <Finder
        hymnbookId="book"
        store={fakeStore({ listHymns: async () => [] })}
        userState={fakeUserState()}
        onSelect={vi.fn()}
      />
    ));
    expect(await screen.findByText("No recent songs yet.")).toBeInTheDocument();
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
      await screen.findByRole("heading", { name: "Songs" });
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
    expect(await screen.findByRole("heading", { name: "From the start" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recents" })).not.toBeInTheDocument();
  });

  it("lists the first songs of the book now searched, not the last one's", async () => {
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
    expect(
      await within(await screen.findByRole("region", { name: "Songs" })).findByText(
        "English Opening",
      ),
    ).toBeInTheDocument();
    setId("ml");
    expect(await screen.findByText("Malayalam Opening")).toBeInTheDocument();
    expect(screen.queryByText("English Opening")).not.toBeInTheDocument();
  });

  it("says which book it searches", async () => {
    render(() => (
      <Finder
        hymnbookId="book"
        bookTitle="Hymns of Fellowship"
        store={fakeStore()}
        userState={fakeUserState()}
        onSelect={vi.fn()}
      />
    ));
    expect(await screen.findByText("Hymns of Fellowship")).toBeInTheDocument();
    expect(find()).toHaveAccessibleDescription("Searching Hymns of Fellowship");
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
    await screen.findByRole("heading", { name: "Songs" });

    submit("42");

    expect(onSelect).toHaveBeenCalledWith(42);
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
    await screen.findByRole("heading", { name: "Songs" });

    submit("grace");

    expect(searchLyrics).toHaveBeenCalledWith("book", "grace");
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Forty-Second Hymn/ }));
    expect(onSelect).toHaveBeenCalledWith(42);
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
    await screen.findByRole("heading", { name: "Songs" });

    submit("line");

    expect(await screen.findByRole("option", { name: /^#1\s*Same Line$/ })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /^#2\s*Title\s*—\s*A different line$/ }),
    ).toBeInTheDocument();
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
    await screen.findByRole("heading", { name: "Songs" });

    submit("nothing like this");

    expect(await screen.findByText('No matches for "nothing like this".')).toBeInTheDocument();
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
    expect(onSelect).toHaveBeenCalledWith(42);
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
    await screen.findByRole("heading", { name: "Songs" });

    fireEvent.input(find(), { target: { value: "4" } });
    const options = await screen.findAllByRole("option");
    // Exact number first, then those starting with it; never "5".
    expect(options.map((o) => o.textContent)).toEqual(["#4Four", "#42Forty-Two", "#43Forty-Three"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");

    // ↓ then Enter takes the highlighted one.
    fireEvent.keyDown(find(), { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    expect(onSelect).toHaveBeenCalledWith(42);
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
    await screen.findByRole("heading", { name: "Songs" });

    fireEvent.input(find(), { target: { value: "grace" } });
    expect(await screen.findByRole("option", { name: /Forty-Second Hymn/ })).toBeInTheDocument();
    expect(searchLyrics).toHaveBeenCalledWith("book", "grace");
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
    await screen.findByRole("heading", { name: "Songs" });

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
    await screen.findByRole("heading", { name: "Songs" });
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
    await screen.findByRole("heading", { name: "Songs" });

    fireEvent.input(find(), { target: { value: "121" } });
    const [, second] = await screen.findAllByRole("option");
    // The row lands under a still pointer: enter fires, move doesn't.
    fireEvent.mouseEnter(second);
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    expect(onSelect).toHaveBeenCalledWith(121);

    // Moving the pointer does move the highlight.
    fireEvent.mouseMove(second);
    expect(second).toHaveAttribute("aria-selected", "true");
    // Leaving the list takes the highlight with it; Enter still takes the
    // top match.
    fireEvent.mouseLeave(screen.getByRole("listbox"));
    expect(screen.queryByRole("option", { selected: true })).toBeNull();
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    expect(onSelect).toHaveBeenLastCalledWith(121);
  });

  it("as the command menu, lists actions ahead of hymns, matched by word starts (SDD-0001 §16.5)", async () => {
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
      />
    ));
    const box = screen.getByRole("combobox", { name: "Find a song or action" });

    // Empty: every action, with its key.
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: /Blank the Output/ })).toHaveTextContent("B");

    fireEvent.input(box, { target: { value: "bl out" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.submit(box.closest("form") as HTMLFormElement);
    expect(blank).toHaveBeenCalled();

    // A number matches no action: the fast path still opens the hymn.
    fireEvent.input(box, { target: { value: "42" } });
    await screen.findByRole("option", { name: /Forty-Second/ });
    expect(screen.queryByRole("option", { name: /Output/ })).not.toBeInTheDocument();
    fireEvent.submit(box.closest("form") as HTMLFormElement);
    expect(onSelect).toHaveBeenCalledWith(42);
  });
});
