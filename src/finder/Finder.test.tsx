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
    ...overrides,
  };
}

const find = () => screen.getByRole("textbox", { name: "Find a hymn" });
const submit = (value: string) => {
  fireEvent.input(find(), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Find" }));
};

describe("Finder", () => {
  it("shows an empty recents message when there are none", async () => {
    render(() => <Finder store={fakeStore()} userState={fakeUserState()} onSelect={vi.fn()} />);
    expect(await screen.findByText("No recent hymns yet.")).toBeInTheDocument();
  });

  it("shows recents by title, resolved from listHymns", async () => {
    const recents: RecentEntry[] = [{ hymnbookId: "book", hymnNumber: 42, viewedAt: 1 }];
    render(() => (
      <Finder
        store={fakeStore()}
        userState={fakeUserState({ getRecents: async () => recents })}
        onSelect={vi.fn()}
      />
    ));
    expect(await screen.findByRole("button", { name: "Forty-Second Hymn" })).toBeInTheDocument();
  });

  it("hands an exact hymn number straight to onSelect", async () => {
    const onSelect = vi.fn();
    render(() => <Finder store={fakeStore()} userState={fakeUserState()} onSelect={onSelect} />);
    await screen.findByText("No recent hymns yet.");

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
    await screen.findByText("No recent hymns yet.");

    submit("grace");

    expect(searchLyrics).toHaveBeenCalledWith("mal-ymef-athmeeya-geethangal-16", "grace");
    fireEvent.click(await screen.findByRole("button", { name: /Forty-Second Hymn/ }));
    expect(onSelect).toHaveBeenCalledWith(42);
  });

  it("reports no matches for a lyric search with no results", async () => {
    render(() => <Finder store={fakeStore()} userState={fakeUserState()} onSelect={vi.fn()} />);
    await screen.findByText("No recent hymns yet.");

    submit("nothing like this");

    expect(await screen.findByText('No matches for "nothing like this".')).toBeInTheDocument();
  });

  it("picking a recent hands its number straight to onSelect", async () => {
    const onSelect = vi.fn();
    const recents: RecentEntry[] = [{ hymnbookId: "book", hymnNumber: 42, viewedAt: 1 }];
    render(() => (
      <Finder
        store={fakeStore()}
        userState={fakeUserState({ getRecents: async () => recents })}
        onSelect={onSelect}
      />
    ));

    fireEvent.click(await screen.findByRole("button", { name: "Forty-Second Hymn" }));
    expect(onSelect).toHaveBeenCalledWith(42);
  });
});
