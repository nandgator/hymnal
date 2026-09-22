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
    render(() => <Finder store={fakeStore()} userState={fakeUserState()} />);
    expect(await screen.findByText("No recent hymns yet.")).toBeInTheDocument();
  });

  it("shows recents by title, resolved from listHymns", async () => {
    const recents: RecentEntry[] = [{ hymnbookId: "book", hymnNumber: 42, viewedAt: 1 }];
    render(() => (
      <Finder store={fakeStore()} userState={fakeUserState({ getRecents: async () => recents })} />
    ));
    expect(await screen.findByRole("button", { name: "Forty-Second Hymn" })).toBeInTheDocument();
  });

  it("selects a hymn by exact number and records it as recent", async () => {
    const addRecent = vi.fn(async () => {});
    render(() => <Finder store={fakeStore()} userState={fakeUserState({ addRecent })} />);
    await screen.findByText("No recent hymns yet.");

    submit("42");

    expect(await screen.findByText("Selected: Forty-Second Hymn (#42)")).toBeInTheDocument();
    expect(addRecent).toHaveBeenCalledWith("mal-ymef-athmeeya-geethangal-16", 42);
  });

  it("reports an unknown hymn number", async () => {
    render(() => <Finder store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("No recent hymns yet.");

    submit("9999");

    expect(await screen.findByText("No hymn numbered 9999.")).toBeInTheDocument();
  });

  it("searches lyrics for non-numeric input and selects a result", async () => {
    const searchLyrics = vi.fn(
      async (): Promise<SearchResult[]> => [
        { number: 42, title: "Forty-Second Hymn", snippet: "a line of it" },
      ],
    );
    render(() => <Finder store={fakeStore({ searchLyrics })} userState={fakeUserState()} />);
    await screen.findByText("No recent hymns yet.");

    submit("grace");

    expect(searchLyrics).toHaveBeenCalledWith("mal-ymef-athmeeya-geethangal-16", "grace");
    fireEvent.click(await screen.findByRole("button", { name: /Forty-Second Hymn/ }));
    expect(await screen.findByText("Selected: Forty-Second Hymn (#42)")).toBeInTheDocument();
  });

  it("reports no matches for a lyric search with no results", async () => {
    render(() => <Finder store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("No recent hymns yet.");

    submit("nothing like this");

    expect(await screen.findByText('No matches for "nothing like this".')).toBeInTheDocument();
  });
});
