import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    listHymns: async () => [{ number: 1, title: "Mocked Hymn" }],
    getHymn: async () => ({
      number: 1,
      title: "Mocked Hymn",
      parts: [{ id: "s1", kind: "stanza", lines: ["A line"] }],
      sequence: [{ partId: "s1" }],
      meta: {},
    }),
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
    getPreferences: async () => ({ theme: "system", fontScale: 1 }),
    setPreferences: async () => {},
  };
  return { userState, DEFAULT_PREFERENCES: { theme: "system", fontScale: 1 } };
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

  it("goes back from Finder to the Library", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to hymnbooks" }));
    expect(await screen.findByText("Mocked Hymnbook")).toBeInTheDocument();
  });

  it("opens the Presenter once a hymn is picked in Finder", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));

    fireEvent.input(await screen.findByRole("textbox", { name: "Find a hymn" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));

    expect(await screen.findByText("Mocked Hymn")).toBeInTheDocument();
  });

  it("opens the Output as a named window, so a second click reuses it", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(() => <App />);

    fireEvent.click(screen.getByRole("button", { name: "Show Output" }));

    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\?output=1$/),
      "hymnal-output",
      "popup",
    );
  });

  it("renders only the chrome-less Output when loaded with ?output=1", () => {
    window.history.replaceState(null, "", "/?output=1");
    render(() => <App />);

    expect(screen.queryByRole("button", { name: "Show Output" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Display settings" })).not.toBeInTheDocument();
  });
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
