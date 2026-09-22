import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import App from "./App.tsx";
import type { ContentStore } from "./persistence/content-store.ts";
import type { UserState } from "./persistence/user-state.ts";

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
    listHymns: async () => [],
    getHymn: async () => {
      throw new Error("not used");
    },
    searchLyrics: async () => [],
  };
  return { getContentStore: () => store };
});

vi.mock("./persistence/user-state.ts", () => {
  const userState: UserState = {
    getLastPosition: async () => undefined,
    setLastPosition: async () => {},
    getRecents: async () => [],
    addRecent: async () => {},
  };
  return { userState };
});

describe("App", () => {
  it("renders the Library, wired to the default content store", async () => {
    render(() => <App />);
    expect(await screen.findByText("Mocked Hymnbook")).toBeInTheDocument();
  });

  it("moves to Finder once the user chooses to find a hymn", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));
    expect(await screen.findByPlaceholderText("Hymn number or lyrics")).toBeInTheDocument();
  });
});
