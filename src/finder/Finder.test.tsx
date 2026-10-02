import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { HymnbookId, HymnNumber, HymnSource } from "../domain/types.ts";
import type { ContentStore, SearchResult } from "../persistence/content-store.ts";
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
  it("shows an empty recents message when there are none", async () => {
    render(() => <Finder store={fakeStore()} userState={fakeUserState()} onSelect={vi.fn()} />);
    expect(await screen.findByText("No recent songs yet.")).toBeInTheDocument();
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
    expect(await screen.findByRole("button", { name: /Forty-Second Hymn/ })).toBeInTheDocument();
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
    await screen.findByRole("button", { name: /Forty-Second Hymn/ });
    expect(screen.queryByText("#7")).not.toBeInTheDocument();
  });

  it("hands an exact hymn number straight to onSelect", async () => {
    const onSelect = vi.fn();
    render(() => <Finder store={fakeStore()} userState={fakeUserState()} onSelect={onSelect} />);
    await screen.findByText("No recent songs yet.");

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
      <Finder store={fakeStore({ searchLyrics })} userState={fakeUserState()} onSelect={onSelect} />
    ));
    await screen.findByText("No recent songs yet.");

    submit("grace");

    expect(searchLyrics).toHaveBeenCalledWith("mal-ymef-athmeeya-geethangal-16", "grace");
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
      <Finder store={fakeStore({ searchLyrics })} userState={fakeUserState()} onSelect={vi.fn()} />
    ));
    await screen.findByText("No recent songs yet.");

    submit("line");

    expect(await screen.findByRole("option", { name: /^#1\s*Same Line$/ })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /^#2\s*Title\s*—\s*A different line$/ }),
    ).toBeInTheDocument();
  });

  it("reports no matches for a lyric search with no results", async () => {
    render(() => <Finder store={fakeStore()} userState={fakeUserState()} onSelect={vi.fn()} />);
    await screen.findByText("No recent songs yet.");

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

    fireEvent.click(await screen.findByRole("button", { name: /Forty-Second Hymn/ }));
    expect(onSelect).toHaveBeenCalledWith(42);
  });

  it("offers a way back to hymnbook selection", async () => {
    const onBack = vi.fn();
    render(() => (
      <Finder store={fakeStore()} userState={fakeUserState()} onSelect={vi.fn()} onBack={onBack} />
    ));

    fireEvent.click(await screen.findByRole("button", { name: "Back to hymnbooks" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("suggests hymns by number as you type, before any Enter (SDD-0001 §13)", async () => {
    const onSelect = vi.fn();
    render(() => (
      <Finder
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
    await screen.findByText("No recent songs yet.");

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
      <Finder store={fakeStore({ searchLyrics })} userState={fakeUserState()} onSelect={vi.fn()} />
    ));
    await screen.findByText("No recent songs yet.");

    fireEvent.input(find(), { target: { value: "grace" } });
    expect(await screen.findByRole("option", { name: /Forty-Second Hymn/ })).toBeInTheDocument();
    expect(searchLyrics).toHaveBeenCalledWith("mal-ymef-athmeeya-geethangal-16", "grace");
  });

  it("clears the query on Escape", async () => {
    render(() => <Finder store={fakeStore()} userState={fakeUserState()} onSelect={vi.fn()} />);
    await screen.findByText("No recent songs yet.");
    fireEvent.input(find(), { target: { value: "42" } });
    fireEvent.keyDown(find(), { key: "Escape" });
    expect(find()).toHaveValue("");
  });

  it("keeps the top match highlighted when options appear under a resting pointer", async () => {
    const onSelect = vi.fn();
    render(() => (
      <Finder
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
    await screen.findByText("No recent songs yet.");

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
