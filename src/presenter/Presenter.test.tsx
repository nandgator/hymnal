import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { HymnSource } from "../domain/types.ts";
import type { SeekMessage } from "../output/channel.ts";
import type { ContentStore } from "../persistence/content-store.ts";
import type { UserState } from "../persistence/user-state.ts";
import { Presenter } from "./Presenter.tsx";

const publishOutput = vi.hoisted(() => vi.fn());
// The Output's seek requests (SDD-0001 §16.1), delivered by hand in tests.
const seek = vi.hoisted(() => ({
  handler: undefined as ((message: SeekMessage) => void) | undefined,
}));
vi.mock("../output/channel.ts", () => ({
  publishOutput,
  subscribeSeek: (handler: (message: SeekMessage) => void) => {
    seek.handler = handler;
    return () => {};
  },
}));

const HYMN: HymnSource = {
  number: 7,
  title: "Test Hymn",
  parts: [
    { id: "s1", kind: "stanza", label: "1", lines: ["Line 1a", "Line 1b"] },
    { id: "r", kind: "refrain", lines: ["Refrain line"] },
    { id: "s2", kind: "stanza", label: "2", lines: ["Line 2a"] },
  ],
  sequence: [{ partId: "s1" }, { partId: "r" }, { partId: "s2" }, { partId: "r" }],
  meta: {},
};

function fakeStore(overrides: Partial<ContentStore> = {}): ContentStore {
  return {
    ensureInstalled: async () => ({ state: "ready" }),
    getHymnbook: async () => {
      throw new Error("not used");
    },
    listHymns: async () => [{ number: 7, title: "Test Hymn" }],
    getHymn: async () => HYMN,
    searchLyrics: async () => [],
    ...overrides,
  };
}

function fakeUserState(overrides: Partial<UserState> = {}): UserState {
  return {
    getLastPosition: async () => undefined,
    setLastPosition: async () => {},
    getRecents: async () => [],
    addRecent: async () => {},
    getPreferences: async () => ({ theme: "system", fontScale: 1 }),
    setPreferences: async () => {},
    ...overrides,
  };
}

/** Stubs window size: `matches` decides each media query (SDD-0001 §16.4:
 * 840px expanded, 1400px split, 640px for the full Live beside the keypad). */
function stubMedia(matches: (query: string) => boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: matches(query),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

// The Lyrics list marks the current occurrence's block aria-current="step".
const currentPart = () => {
  const block = within(screen.getByRole("region", { name: "Lyrics" }))
    .getAllByRole("listitem")
    .find((item) => item.getAttribute("aria-current") === "step");
  if (!block) throw new Error("no current block");
  return within(block);
};

describe("Presenter", () => {
  it("shows a loading state before the store responds", () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("opens on the first part, whole part focused, and records it as recent", async () => {
    const addRecent = vi.fn(async () => {});
    render(() => (
      <Presenter
        hymnNumber={7}
        hymnbookId="book"
        store={fakeStore()}
        userState={fakeUserState({ addRecent })}
      />
    ));

    expect(await screen.findByText("Test Hymn")).toBeInTheDocument();
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Line 1a" })).not.toHaveAttribute("aria-current");
    expect(addRecent).toHaveBeenCalledWith("book", 7);
  });

  it("shows an error and a way back when the hymn doesn't exist", async () => {
    const onBack = vi.fn();
    render(() => (
      <Presenter
        hymnNumber={9999}
        store={fakeStore({
          getHymn: async () => {
            throw new Error("no such hymn");
          },
        })}
        userState={fakeUserState()}
        onBack={onBack}
      />
    ));

    expect(await screen.findByText("No song numbered 9999.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to search" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("doesn't cue ordinary verse-chorus recurrence as a repeat (SDD-0001 §16.2)", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");

    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Refrain");
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it("moves through lines within a part, focusing one at a time", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");

    fireEvent.click(screen.getByRole("button", { name: "Next line" }));
    expect(screen.getByRole("button", { name: "Line 1a" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Line 1b" })).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByRole("button", { name: "Next line" }));
    expect(screen.getByRole("button", { name: "Line 1b" })).toHaveAttribute("aria-current", "true");

    fireEvent.click(screen.getByRole("button", { name: "Previous line" }));
    expect(screen.getByRole("button", { name: "Line 1a" })).toHaveAttribute("aria-current", "true");
  });

  it("jumps straight to any part, overriding the stored order (R6)", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");

    const jumpList = within(screen.getByRole("region", { name: "Jump to part" }));
    fireEvent.click(jumpList.getByRole("button", { name: "Refrain" }));

    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Refrain");
  });

  it("disables Previous part on the first occurrence and Next part on the last", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");

    expect(screen.getByRole("button", { name: "Previous part" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(screen.getByRole("button", { name: "Next part" })).toBeDisabled();
  });

  it("widens line focus to the whole part at either end, from the keys or the dock", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");
    const line1a = () => screen.getByRole("button", { name: "Line 1a" });

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(line1a()).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Previous part" })).toBeEnabled();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(line1a()).not.toHaveAttribute("aria-current");
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Previous part" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "End" }); // the closing refrain, whole
    fireEvent.keyDown(window, { key: "ArrowDown" }); // its only line
    const refrainLine = () => currentPart().getByRole("button", { name: "Refrain line" });
    expect(refrainLine()).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(refrainLine()).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Next part" })).toBeDisabled();
  });

  it("navigates by keyboard, for remotes/clickers as well as arrow keys (arc42 §8.8)", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Refrain");

    fireEvent.keyDown(window, { key: "PageDown" });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("2");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "Line 2a" })).toHaveAttribute("aria-current", "true");

    fireEvent.keyDown(window, { key: "PageUp" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("1");
  });

  it("publishes every navigation to the Output window, and idle on unmount (SDD-0001 §16.1)", async () => {
    publishOutput.mockClear();
    const { unmount } = render(() => (
      <Presenter hymnNumber={7} hymnbookId="book" store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");

    const text = (t: string) => expect.objectContaining({ text: t });
    expect(publishOutput).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "content",
        hymnbookId: "book",
        number: 7,
        focus: { start: 0, end: 2 },
        lines: [
          text("Line 1a"),
          text("Line 1b"),
          text("Refrain line"),
          text("Line 2a"),
          text("Refrain line"),
        ],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(publishOutput).toHaveBeenLastCalledWith(
      expect.objectContaining({ focus: { start: 2, end: 3 } }),
    );

    unmount();
    expect(publishOutput).toHaveBeenLastCalledWith({ type: "idle" });
  });

  it("keeps Next and Previous meaningful after jumping to a part", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");
    const jumpList = within(screen.getByRole("region", { name: "Jump to part" }));

    // s1, r, s2, r — at s1, jump forward to s2.
    fireEvent.click(jumpList.getByRole("button", { name: "2" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Next part" })).toBeEnabled();

    // Previous follows the song — the refrain before 2 — not the tap.
    fireEvent.click(screen.getByRole("button", { name: "Previous part" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Refrain");
  });

  it("shows the whole sung order and goes to a block, or a line, when tapped (SDD-0001 §16.4)", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");
    const sequence = within(screen.getByRole("region", { name: "Lyrics" }));

    // s1, r, s2, r — every occurrence, the refrain twice.
    expect(sequence.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Verse 1",
      "Refrain",
      "Verse 2",
      "Refrain",
    ]);

    fireEvent.click(sequence.getByRole("button", { name: "Verse 2" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("2");

    fireEvent.click(screen.getByRole("button", { name: "Line 1b" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Line 1b" })).toHaveAttribute("aria-current", "true");
  });

  it("mirrors the Output in the Live pane", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");

    const live = within(screen.getByRole("img", { name: "Live output preview" }));
    // The same view as the Output, scaled: every line, the focus lit.
    expect(live.getByText("Line 1a")).toHaveClass("output-line-current");
    expect(live.getByText("Line 1b")).toHaveClass("output-line-current");
    for (const refrain of live.getAllByText("Refrain line")) {
      expect(refrain).not.toHaveClass("output-line-current");
    }
  });

  it("from 840px: This song and Recents side by side, What they see beside (SDD-0001 §16.4)", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");

    expect(
      within(screen.getByRole("region", { name: "This Song" })).getByRole("region", {
        name: "Lyrics",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recents" })).toBeInTheDocument();
    const rail = within(screen.getByRole("complementary", { name: "What they see" }));
    expect(rail.getByRole("region", { name: "Live" })).toBeInTheDocument();
    expect(rail.getByRole("region", { name: "Jump to part" })).toBeInTheDocument();
    // No Parts | Lyrics switch: both are on screen.
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("expands, collapses, closes and splits from the group headings", async () => {
    const onWorkspaceChange = vi.fn();
    render(() => (
      <Presenter
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        onWorkspaceChange={onWorkspaceChange}
      />
    ));
    await screen.findByText("Test Hymn");

    // Side by side, a pane toolbar per group: expand or collapse, move, close.
    const recents = () => within(screen.getByRole("region", { name: "Recents" }));
    fireEvent.click(recents().getByRole("button", { name: "Expand to main" }));
    expect(onWorkspaceChange).toHaveBeenLastCalledWith(expect.objectContaining({ main: 0 }));
    expect(recents().getByRole("button", { name: "Collapse to the side" })).toBeInTheDocument();

    // A lone tab has no Move: it would only do what Close group does.
    expect(recents().queryByRole("button", { name: /Move/ })).not.toBeInTheDocument();
    fireEvent.click(recents().getByRole("button", { name: "Close group" }));
    // Its tabs join the other: one tabbed area, still showing Recents.
    expect(screen.getByRole("tab", { name: "Recents" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "Split into two groups" }));
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "This Song" })).toBeInTheDocument();

    const hymn = within(screen.getByRole("region", { name: "This Song" }));
    fireEvent.click(hymn.getByRole("button", { name: "Close group" }));
    expect(onWorkspaceChange).toHaveBeenLastCalledWith(expect.objectContaining({ split: false }));
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("merges the groups into tabs when narrower, and N steps through them", async () => {
    stubMedia((query) => !query.includes("1400px"));
    try {
      const onWorkspaceChange = vi.fn();
      const onSelectHymn = vi.fn();
      render(() => (
        <Presenter
          hymnNumber={7}
          store={fakeStore()}
          userState={fakeUserState({
            getRecents: async () => [
              { hymnbookId: "mal-ymef-athmeeya-geethangal-16", hymnNumber: 7, viewedAt: 2 },
              { hymnbookId: "other-book", hymnNumber: 9, viewedAt: 1 },
            ],
          })}
          onWorkspaceChange={onWorkspaceChange}
          onSelectHymn={onSelectHymn}
        />
      ));
      await screen.findByText("Test Hymn");

      expect(screen.getByRole("tab", { name: "This Song" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      fireEvent.click(screen.getByRole("tab", { name: "Recents" }));
      expect(onWorkspaceChange).toHaveBeenLastCalledWith(expect.objectContaining({ main: 0 }));
      // This book's recents only, the one up now marked.
      const row = await screen.findByRole("button", { name: /#7/ });
      expect(row).toHaveAttribute("aria-current", "true");
      expect(screen.queryByRole("button", { name: /#9/ })).not.toBeInTheDocument();
      fireEvent.click(row);
      expect(onSelectHymn).toHaveBeenCalledWith(7);

      fireEvent.keyDown(window, { key: "n" });
      expect(screen.getByRole("tab", { name: "This Song" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("on a phone: the Live strip, then the tabs merged with Parts, opening on Parts", async () => {
    stubMedia(() => false);
    try {
      render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
      await screen.findByText("Test Hymn");

      const strip = screen.getByRole("button", { name: /^Live/ });
      expect(strip).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(strip);
      expect(screen.getByRole("img", { name: "Live output preview" })).toBeInTheDocument();

      // One merged group, no toolbar, no Parts | Lyrics switch, no stage.
      expect(screen.getAllByRole("tablist")).toHaveLength(1);
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "This Song",
        "Recents",
        "Parts",
      ]);
      expect(screen.getByRole("tab", { name: "Parts" })).toHaveAttribute("aria-selected", "true");
      expect(screen.queryByRole("radio", { name: "Lyrics" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Split/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("complementary")).not.toBeInTheDocument();

      // Parts holds the stage's Repeat row and keypad.
      const keypad = within(screen.getByRole("region", { name: "Jump to part" }));
      fireEvent.click(keypad.getByRole("button", { name: "2" }));
      fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
      expect(screen.getByRole("button", { name: "Undo repeat" })).toBeEnabled();

      fireEvent.click(screen.getByRole("tab", { name: "This Song" }));
      expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("2");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("on a phone, N steps through the tabs, Parts included", async () => {
    stubMedia(() => false);
    try {
      render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
      await screen.findByText("Test Hymn");
      const selected = () => screen.getByRole("tab", { selected: true }).textContent;

      expect(selected()).toBe("Parts");
      fireEvent.keyDown(window, { key: "n" });
      expect(selected()).toBe("This Song");
      fireEvent.keyDown(window, { key: "n" });
      expect(selected()).toBe("Recents");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows every part in full in Lyrics, a repeated refrain too, so a step never reshapes it", async () => {
    const hymn: HymnSource = {
      ...HYMN,
      parts: [
        { id: "s1", kind: "stanza", label: "1", lines: ["Line 1a"] },
        { id: "r", kind: "refrain", lines: ["Refrain one", "Refrain two"] },
        { id: "s2", kind: "stanza", label: "2", lines: ["Line 2a"] },
      ],
    };
    render(() => (
      <Presenter
        hymnNumber={7}
        store={fakeStore({ getHymn: async () => hymn })}
        userState={fakeUserState()}
      />
    ));
    await screen.findByText("Test Hymn");
    const lyrics = within(screen.getByRole("region", { name: "Lyrics" }));

    // s1, r, s2, r: both refrains in full, before and after stepping.
    expect(lyrics.getAllByRole("button", { name: "Refrain two" })).toHaveLength(2);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(lyrics.getAllByRole("button", { name: "Refrain two" })).toHaveLength(2);
  });

  it("uses the Live strip at compact height, even on a wide screen (MD3 height class)", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: !query.includes("min-height"), // wide, but short
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    try {
      render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
      await screen.findByText("Test Hymn");

      expect(screen.getByRole("button", { name: /^Live/ })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      // Still wide: What they see stays beside the tabs.
      expect(screen.getByRole("complementary", { name: "What they see" })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores its shortcuts while typing in a field, so a picker's arrows never move the Output", async () => {
    render(() => (
      <>
        <input aria-label="Some field" />
        <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
      </>
    ));
    await screen.findByText("Test Hymn");

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Some field" }), { key: "ArrowRight" });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("1");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Refrain");
  });

  it("orders the keypad special parts first, then stanzas by number", async () => {
    const hymn: HymnSource = {
      ...HYMN,
      parts: [
        { id: "s2", kind: "stanza", label: "2", lines: ["Line 2a"] },
        { id: "s1", kind: "stanza", label: "1", lines: ["Line 1a"] },
        { id: "r", kind: "refrain", lines: ["Refrain line"] },
      ],
      sequence: [{ partId: "s1" }, { partId: "r" }, { partId: "s2" }],
    };
    render(() => (
      <Presenter
        hymnNumber={7}
        store={fakeStore({ getHymn: async () => hymn })}
        userState={fakeUserState()}
      />
    ));
    await screen.findByText("Test Hymn");
    const keypad = within(screen.getByRole("region", { name: "Jump to part" }));
    expect(keypad.getAllByRole("button").map((b) => b.textContent)).toEqual(["Refrain", "1", "2"]);
  });

  it("keeps its shortcuts when a phone's tab has focus", async () => {
    stubMedia(() => false);
    try {
      render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
      await screen.findByText("Test Hymn");

      const tab = screen.getByRole("tab", { name: "This Song" });
      fireEvent.click(tab);
      tab.focus();
      fireEvent.keyDown(tab, { key: "ArrowRight" });
      expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Refrain");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("restarts the current part when its chip is tapped again, adding no repeat", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");
    const jumpList = within(screen.getByRole("region", { name: "Jump to part" }));

    fireEvent.click(screen.getByRole("button", { name: "Next line" }));
    fireEvent.click(screen.getByRole("button", { name: "Next line" }));
    expect(screen.getByRole("button", { name: "Line 1b" })).toHaveAttribute("aria-current", "true");

    fireEvent.click(jumpList.getByRole("button", { name: "1" }));
    fireEvent.click(jumpList.getByRole("button", { name: "1" }));
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Line 1b" })).not.toHaveAttribute("aria-current");
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("1");
  });

  it("takes the rest of the keymap: Space, Home/End, stanza digits, R (SDD-0001 §16.5)", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");
    const heading = () => currentPart().getByRole("heading", { level: 3 });

    fireEvent.keyDown(window, { key: " " });
    expect(heading()).toHaveTextContent("Refrain");
    fireEvent.keyDown(window, { key: " ", shiftKey: true });
    expect(heading()).toHaveTextContent("1");

    fireEvent.keyDown(window, { key: "End" });
    expect(screen.getByRole("button", { name: "Next part" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Home" });
    expect(screen.getByRole("button", { name: "Previous part" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "2" });
    expect(heading()).toHaveTextContent("2");
    fireEvent.keyDown(window, { key: "R" });
    expect(heading()).toHaveTextContent("Refrain");
    // Not a stanza: nothing happens.
    fireEvent.keyDown(window, { key: "9" });
    expect(heading()).toHaveTextContent("Refrain");
  });

  it("makes Space Next part even on a focused chip, never re-pressing it", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");
    const chip = within(screen.getByRole("region", { name: "Jump to part" })).getByRole("button", {
      name: "1",
    });
    chip.focus();

    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    chip.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Refrain");
  });

  it("waits briefly for a second stanza digit only when one could follow", async () => {
    const twelve: HymnSource = {
      ...HYMN,
      parts: Array.from({ length: 12 }, (_, i) => ({
        id: `s${i + 1}`,
        kind: "stanza" as const,
        label: String(i + 1),
        lines: [`Stanza ${i + 1}`],
      })),
      sequence: Array.from({ length: 12 }, (_, i) => ({ partId: `s${i + 1}` })),
    };
    render(() => (
      <Presenter
        hymnNumber={7}
        store={fakeStore({ getHymn: async () => twelve })}
        userState={fakeUserState()}
      />
    ));
    await screen.findByText("Test Hymn");
    const heading = () => currentPart().getByRole("heading", { level: 3 });
    vi.useFakeTimers();
    try {
      fireEvent.keyDown(window, { key: "3" });
      expect(heading()).toHaveTextContent("3"); // nothing longer starts with 3

      fireEvent.keyDown(window, { key: "1" });
      expect(heading()).toHaveTextContent("3"); // could be 10, 11 or 12
      fireEvent.keyDown(window, { key: "2" });
      expect(heading()).toHaveTextContent("12");

      fireEvent.keyDown(window, { key: "1" });
      vi.advanceTimersByTime(500);
      expect(heading()).toHaveTextContent("1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dims Live while the Output is blanked, with Restore in its heading", async () => {
    const onToggleBlank = vi.fn();
    render(() => (
      <Presenter
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        blanked
        onToggleBlank={onToggleBlank}
      />
    ));
    await screen.findByText("Test Hymn");

    expect(screen.getByRole("img", { name: "Live output preview" })).toHaveClass("live-blanked");
    const restore = screen.getByRole("button", { name: /Restore/ });
    expect(restore).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(restore);
    expect(onToggleBlank).toHaveBeenCalled();
  });

  it("hides Live when preferences hide it, keeping Parts", async () => {
    render(() => (
      <Presenter
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        panes={{ live: false }}
      />
    ));
    await screen.findByText("Test Hymn");

    expect(screen.queryByRole("region", { name: "Live" })).not.toBeInTheDocument();
    const rail = within(screen.getByRole("complementary", { name: "What they see" }));
    expect(rail.getByRole("region", { name: "Jump to part" })).toBeInTheDocument();
  });

  it("goes to the line a scroll of the Output rests on, with line focus (SDD-0001 §16.1)", async () => {
    render(() => (
      <Presenter hymnNumber={7} hymnbookId="book" store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");

    // Flattened: 1a 1b | Refrain | 2a | Refrain — line 3 is "Line 2a".
    seek.handler?.({ type: "seek", hymnbookId: "book", number: 7, line: 3, whole: false });
    expect(screen.getByRole("button", { name: "Line 2a" })).toHaveAttribute("aria-current", "true");

    // Next part carries on from there.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Refrain");
  });

  it("lands on the whole part when the scroll began from whole-part focus", async () => {
    render(() => (
      <Presenter hymnNumber={7} hymnbookId="book" store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");

    seek.handler?.({ type: "seek", hymnbookId: "book", number: 7, line: 3, whole: true });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Line 2a" })).not.toHaveAttribute("aria-current");
  });

  it("ignores a seek for another hymn, or with scroll sync off", async () => {
    const { unmount } = render(() => (
      <Presenter hymnNumber={7} hymnbookId="book" store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");
    seek.handler?.({ type: "seek", hymnbookId: "book", number: 8, line: 3, whole: false });
    expect(screen.getByRole("button", { name: "Line 2a" })).not.toHaveAttribute("aria-current");
    unmount();

    render(() => (
      <Presenter
        hymnNumber={7}
        hymnbookId="book"
        store={fakeStore()}
        userState={fakeUserState()}
        scrollSync={false}
      />
    ));
    await screen.findByText("Test Hymn");
    seek.handler?.({ type: "seek", hymnbookId: "book", number: 7, line: 3, whole: false });
    expect(screen.getByRole("button", { name: "Line 2a" })).not.toHaveAttribute("aria-current");
  });

  it("repeats in place: a count, Undo, one Lyrics block, the Output unmoved (SDD-0001 §5.1)", async () => {
    publishOutput.mockClear();
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");
    const published = () => publishOutput.mock.lastCall?.[0];
    const before = published();
    // The row holds its place before any repeat: Undo and Reset disabled.
    expect(screen.getByRole("button", { name: "Undo repeat" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset repeat" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    const count = () => document.querySelector(".repeat-count");
    expect(count()).toHaveTextContent(/^×3/);
    expect(published()).toMatchObject({ lines: before.lines, focus: before.focus });
    // Lyrics: one block for stanza 1, marked ×3, current.
    // The count rolls (RollingNumber), so its text spans two nodes.
    expect(
      currentPart().getByText((_, el) => !!el?.classList.contains("repeat-chip")),
    ).toHaveTextContent("×3");
    const lyrics = within(screen.getByRole("region", { name: "Lyrics" }));
    expect(lyrics.getAllByRole("button", { name: "Line 1a" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Undo repeat" }));
    expect(count()).toHaveTextContent(/^×2/);
    // At ×2 Reset would only do what Undo does; it's offered from ×3.
    expect(screen.getByRole("button", { name: "Reset repeat" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset repeat" }));
    expect(count()).toBeEmptyDOMElement();
    expect(published()).toMatchObject({ lines: before.lines, focus: before.focus });
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo repeat" }));
    expect(screen.getByRole("button", { name: "Undo repeat" })).toBeDisabled();
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();

    // Next still carries on through the song.
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Refrain");
  });

  it("hands the shell its Repeat and Undo repeat while mounted", async () => {
    const onActions = vi.fn();
    const { unmount } = render(() => (
      <Presenter
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        onActions={onActions}
      />
    ));
    await screen.findByText("Test Hymn");
    const actions = onActions.mock.lastCall?.[0];
    expect(actions.canUndoRepeat()).toBe(false);
    actions.repeat();
    expect(actions.canUndoRepeat()).toBe(true);
    expect(document.querySelector(".repeat-count")).toHaveTextContent(/^×2/);
    actions.undoRepeat();
    expect(actions.canUndoRepeat()).toBe(false);
    unmount();
    expect(onActions).toHaveBeenLastCalledWith(undefined);
  });

  it("tells the Output which part is up, as a congregation reads it, and its repeat count", async () => {
    publishOutput.mockClear();
    render(() => (
      <Presenter
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        hymnbookTitle="Test Book"
      />
    ));
    await screen.findByText("Test Hymn");
    const published = () => publishOutput.mock.lastCall?.[0];
    expect(published()).toMatchObject({ hymnbookTitle: "Test Book", part: "Verse 1", repeat: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    expect(published()).toMatchObject({ part: "Refrain", repeat: 2 });
  });

  it("swaps from a long path to a short one without reading past its end", async () => {
    const long: HymnSource = {
      ...HYMN,
      number: 3,
      title: "Long Hymn",
      sequence: [
        { partId: "s1" },
        { partId: "r" },
        { partId: "s2" },
        { partId: "r" },
        { partId: "s1" },
        { partId: "r" },
      ],
    };
    const short: HymnSource = {
      number: 6,
      title: "Short Hymn",
      parts: [{ id: "s1", kind: "stanza", label: "1", lines: ["Only line"] }],
      sequence: [{ partId: "s1" }],
      meta: {},
    };
    const [number, setNumber] = createSignal(3);
    render(() => (
      <Presenter
        hymnNumber={number()}
        store={fakeStore({ getHymn: async (_book, n) => (n === 3 ? long : short) })}
        userState={fakeUserState()}
      />
    ));
    await screen.findByText("Long Hymn");
    fireEvent.click(screen.getByRole("button", { name: "Repeat" }));
    setNumber(6);
    expect(await screen.findByText("Short Hymn")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Only line" })).toBeInTheDocument();
  });
});
