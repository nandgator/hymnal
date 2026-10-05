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

// The lyrics glide, recorded: each call's `still` says whether it landed at
// once (a step glides; a list or song shown anew does not).
const glides = vi.hoisted(() => ({ stills: [] as boolean[] }));
vi.mock("./lyricsGlide.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./lyricsGlide.ts")>();
  return {
    ...real,
    glideLyrics: (list: HTMLElement, options: { still: boolean }) => {
      glides.stills.push(options.still);
      real.glideLyrics(list, options);
    },
  };
});

const HYMN: HymnSource = {
  number: 7,
  title: "Test Hymn",
  parts: [
    { id: "s1", kind: "stanza", label: "1", lines: ["Line 1a", "Line 1b"] },
    { id: "c", kind: "chorus", lines: ["Chorus line"] },
    { id: "s2", kind: "stanza", label: "2", lines: ["Line 2a"] },
  ],
  sequence: [{ partId: "s1" }, { partId: "c" }, { partId: "s2" }, { partId: "c" }],
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
    dropRecents: async () => {},
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

describe("Back to Current", () => {
  it("is offered for the part a song opens on, once it is scrolled out of view, with no tap first", async () => {
    // The observers made, each with the element it watches.
    const seen: { callback: IntersectionObserverCallback; el?: Element }[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        entry: { callback: IntersectionObserverCallback; el?: Element };
        constructor(callback: IntersectionObserverCallback) {
          this.entry = { callback };
          seen.push(this.entry);
        }
        observe(el: Element) {
          this.entry.el = el;
        }
        disconnect() {
          this.entry.el = undefined;
        }
        unobserve() {}
      },
    );
    try {
      render(() => (
        <Presenter
          hymnNumber={7}
          hymnbookId="book"
          store={fakeStore()}
          userState={fakeUserState()}
        />
      ));
      expect(await screen.findByText("Test Hymn")).toBeInTheDocument();
      const watching = seen.filter((o) => o.el?.getAttribute("aria-current") === "step");
      expect(watching).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Back to Current" })).not.toBeInTheDocument();
      // Scrolled away from it.
      watching[0].callback(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      expect(await screen.findByRole("button", { name: "Back to Current" })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Presenter", () => {
  it("shows nothing for a fast load, then its panels empty in place (DESIGN.md § Structure)", async () => {
    render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore({ getHymn: () => new Promise(() => {}) })}
        userState={fakeUserState()}
      />
    ));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("Loading…");
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
        hymnbookId="book"
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
    fireEvent.click(screen.getByRole("button", { name: "Back to Search" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("doesn't cue ordinary verse-chorus recurrence as a repeat (SDD-0001 §16.2)", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");

    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Chorus");
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
  });

  it("moves through lines within a part, focusing one at a time", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
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
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");

    const jumpList = within(screen.getByRole("region", { name: "Jump to part" }));
    fireEvent.click(jumpList.getByRole("button", { name: "Chorus" }));

    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Chorus");
  });

  it("disables Previous part on the first occurrence and Next part on the last", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");

    expect(screen.getByRole("button", { name: "Previous part" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(screen.getByRole("button", { name: "Next part" })).toBeDisabled();
  });

  it("widens line focus to the whole part at either end, from the keys or the dock", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");
    const line1a = () => screen.getByRole("button", { name: "Line 1a" });

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(line1a()).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Previous part" })).toBeEnabled();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(line1a()).not.toHaveAttribute("aria-current");
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Previous part" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "End" }); // the closing chorus, whole
    fireEvent.keyDown(window, { key: "ArrowDown" }); // its only line
    const chorusLine = () => currentPart().getByRole("button", { name: "Chorus line" });
    expect(chorusLine()).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(chorusLine()).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Next part" })).toBeDisabled();
  });

  it("navigates by keyboard, for remotes/clickers as well as arrow keys (arc42 §8.8)", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Chorus");

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
          text("Chorus line"),
          text("Line 2a"),
          text("Chorus line"),
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

  it("sends each part with its marker for the whole-song layout: a verse's number, else its kind", async () => {
    publishOutput.mockClear();
    render(() => (
      <Presenter hymnNumber={7} hymnbookId="book" store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");
    const last = publishOutput.mock.calls.at(-1)?.[0] as {
      parts: { id: string; marker?: string }[];
    };
    expect(last.parts.map((p) => [p.id, p.marker])).toEqual([
      ["s1", "1"],
      ["c", "Chorus"],
      ["s2", "2"],
    ]);
  });

  it("keeps Next and Previous meaningful after jumping to a part", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");
    const jumpList = within(screen.getByRole("region", { name: "Jump to part" }));

    // s1, r, s2, r — at s1, jump forward to s2.
    fireEvent.click(jumpList.getByRole("button", { name: "2" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Next part" })).toBeEnabled();

    // Previous follows the song — the chorus before 2 — not the tap.
    fireEvent.click(screen.getByRole("button", { name: "Previous part" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Chorus");
  });

  it("shows the whole sung order and goes to a block, or a line, when tapped (SDD-0001 §16.4)", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");
    const sequence = within(screen.getByRole("region", { name: "Lyrics" }));

    // s1, r, s2, r — every occurrence, the chorus twice.
    expect(sequence.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Verse 1",
      "Chorus",
      "Verse 2",
      "Chorus",
    ]);

    fireEvent.click(sequence.getByRole("button", { name: "Verse 2" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("2");

    fireEvent.click(screen.getByRole("button", { name: "Line 1b" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Line 1b" })).toHaveAttribute("aria-current", "true");
  });

  it("mirrors the Output in the Live pane", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");

    const live = within(screen.getByRole("img", { name: "Live output preview" }));
    // The same view as the Output, scaled: every line, the focus lit.
    expect(live.getByText("Line 1a")).toHaveClass("output-line-current");
    expect(live.getByText("Line 1b")).toHaveClass("output-line-current");
    for (const chorus of live.getAllByText("Chorus line")) {
      expect(chorus).not.toHaveClass("output-line-current");
    }
  });

  it("from 840px: This song and Recents side by side, What they see beside (SDD-0001 §16.4)", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
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
        hymnbookId="book"
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
          hymnbookId="book"
          store={fakeStore()}
          userState={fakeUserState({
            getRecents: async () => [
              { hymnbookId: "book", hymnNumber: 7, viewedAt: 2 },
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
      render(() => (
        <Presenter
          hymnbookId="book"
          hymnNumber={7}
          store={fakeStore()}
          userState={fakeUserState()}
        />
      ));
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
      render(() => (
        <Presenter
          hymnbookId="book"
          hymnNumber={7}
          store={fakeStore()}
          userState={fakeUserState()}
        />
      ));
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

  it("shows every part in full in Lyrics, a repeated chorus too, so a step never reshapes it", async () => {
    const hymn: HymnSource = {
      ...HYMN,
      parts: [
        { id: "s1", kind: "stanza", label: "1", lines: ["Line 1a"] },
        { id: "c", kind: "chorus", lines: ["Chorus one", "Chorus two"] },
        { id: "s2", kind: "stanza", label: "2", lines: ["Line 2a"] },
      ],
    };
    render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore({ getHymn: async () => hymn })}
        userState={fakeUserState()}
      />
    ));
    await screen.findByText("Test Hymn");
    const lyrics = within(screen.getByRole("region", { name: "Lyrics" }));

    // s1, r, s2, r: both choruses in full, before and after stepping.
    expect(lyrics.getAllByRole("button", { name: "Chorus two" })).toHaveLength(2);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(lyrics.getAllByRole("button", { name: "Chorus two" })).toHaveLength(2);
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
      render(() => (
        <Presenter
          hymnbookId="book"
          hymnNumber={7}
          store={fakeStore()}
          userState={fakeUserState()}
        />
      ));
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
        <Presenter
          hymnbookId="book"
          hymnNumber={7}
          store={fakeStore()}
          userState={fakeUserState()}
        />
      </>
    ));
    await screen.findByText("Test Hymn");

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Some field" }), { key: "ArrowRight" });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("1");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Chorus");
  });

  it("orders the keypad special parts first, then stanzas by number", async () => {
    const hymn: HymnSource = {
      ...HYMN,
      parts: [
        { id: "s2", kind: "stanza", label: "2", lines: ["Line 2a"] },
        { id: "s1", kind: "stanza", label: "1", lines: ["Line 1a"] },
        { id: "c", kind: "chorus", lines: ["Chorus line"] },
      ],
      sequence: [{ partId: "s1" }, { partId: "c" }, { partId: "s2" }],
    };
    render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore({ getHymn: async () => hymn })}
        userState={fakeUserState()}
      />
    ));
    await screen.findByText("Test Hymn");
    const keypad = within(screen.getByRole("region", { name: "Jump to part" }));
    expect(keypad.getAllByRole("button").map((b) => b.textContent)).toEqual(["Chorus", "1", "2"]);
  });

  it("keeps its shortcuts when a phone's tab has focus", async () => {
    stubMedia(() => false);
    try {
      render(() => (
        <Presenter
          hymnbookId="book"
          hymnNumber={7}
          store={fakeStore()}
          userState={fakeUserState()}
        />
      ));
      await screen.findByText("Test Hymn");

      const tab = screen.getByRole("tab", { name: "This Song" });
      fireEvent.click(tab);
      tab.focus();
      fireEvent.keyDown(tab, { key: "ArrowRight" });
      expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Chorus");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("restarts the current part when its chip is tapped again, adding no repeat", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
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

  it("takes the rest of the keymap: Space, Home/End, stanza digits, C (SDD-0001 §16.5)", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");
    const heading = () => currentPart().getByRole("heading", { level: 3 });

    fireEvent.keyDown(window, { key: " " });
    expect(heading()).toHaveTextContent("Chorus");
    fireEvent.keyDown(window, { key: " ", shiftKey: true });
    expect(heading()).toHaveTextContent("1");

    fireEvent.keyDown(window, { key: "End" });
    expect(screen.getByRole("button", { name: "Next part" })).toBeDisabled();
    fireEvent.keyDown(window, { key: "Home" });
    expect(screen.getByRole("button", { name: "Previous part" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "2" });
    expect(heading()).toHaveTextContent("2");
    fireEvent.keyDown(window, { key: "C" });
    expect(heading()).toHaveTextContent("Chorus");
    // Not a stanza: nothing happens.
    fireEvent.keyDown(window, { key: "9" });
    expect(heading()).toHaveTextContent("Chorus");
  });

  it("makes Space Next part even on a focused chip, never re-pressing it", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");
    const chip = within(screen.getByRole("region", { name: "Jump to part" })).getByRole("button", {
      name: "1",
    });
    chip.focus();

    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    chip.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Chorus");
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
        hymnbookId="book"
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
        hymnbookId="book"
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

  it("offers Hold beside Blank while presenting, pressed and reading Release while held, and Live shows what is held", async () => {
    const onToggleHold = vi.fn();
    const view = render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        presenting
        onToggleHold={onToggleHold}
      />
    ));
    await screen.findByText("Test Hymn");
    const hold = screen.getByRole("button", { name: /^Hold/ });
    expect(hold).toHaveAttribute("aria-pressed", "false");
    expect(hold).toHaveAttribute("aria-keyshortcuts", "Shift+H");
    expect(document.querySelector(".live-held-tag")).toBeNull();
    fireEvent.click(hold);
    expect(onToggleHold).toHaveBeenCalled();
    view.unmount();

    render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        presenting
        held={{
          content: {
            type: "content",
            hymnbookId: "book",
            number: 7,
            title: "Frozen Title",
            lines: [{ text: "Frozen line", partId: "s1", isPartStart: true }],
            focus: { start: 0, end: 1 },
          },
        }}
        onToggleHold={onToggleHold}
      />
    ));
    await screen.findByText("Test Hymn");
    expect(screen.getByRole("button", { name: /^Release/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.querySelector(".live-held-tag")).not.toBeNull();
    // Live is what the audience sees: the held content, not the Operator's.
    expect(screen.getByRole("img", { name: "Live output preview" })).toHaveTextContent(
      "Frozen line",
    );
  });

  it("groups Blank, Hold and End Live in one toolbar row under the Live preview", async () => {
    const onEndLive = vi.fn();
    render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        presenting
        onEndLive={onEndLive}
      />
    ));
    await screen.findByText("Test Hymn");
    const toolbar = screen.getByRole("toolbar", { name: "Output controls" });
    const names = [...toolbar.querySelectorAll("button")].map((b) => b.textContent);
    expect(names).toEqual(["BlankRestore", "HoldRelease", "Present Here", "End Live"]);
    // One row under the preview (not in the heading), each member with an
    // icon and a label, each the transport's tonal button.
    expect(toolbar.parentElement).toHaveClass("stage-live-bar");
    expect(toolbar.parentElement?.previousElementSibling).toHaveClass("live-pane");
    expect(screen.getByRole("heading", { name: "Live" }).parentElement).not.toContainElement(
      toolbar,
    );
    for (const button of toolbar.querySelectorAll("button")) {
      expect(button.querySelector(".icon")).not.toBeNull();
      expect(button).toHaveClass("btn-tonal", "live-control");
    }
    const end = screen.getByRole("button", { name: /^End Live/ });
    expect(end).toHaveAttribute("aria-keyshortcuts", "Shift+E");
    fireEvent.click(end);
    expect(onEndLive).toHaveBeenCalled();
  });

  it("keeps Present Here between Hold and End Live, whether or not an Output window is live", async () => {
    const onPresentHere = vi.fn();
    render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        presenting
        outputWindow
        onPresentHere={onPresentHere}
      />
    ));
    await screen.findByText("Test Hymn");
    const toolbar = screen.getByRole("toolbar", { name: "Output controls" });
    expect([...toolbar.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "BlankRestore",
      "HoldRelease",
      "Present Here",
      "End Live",
    ]);
    const here = screen.getByRole("button", { name: /^Present Here/ });
    expect(here).toHaveAttribute("aria-keyshortcuts", "Shift+P");
    expect(here.querySelector(".icon-here")).not.toBeNull();
    fireEvent.click(here);
    expect(onPresentHere).toHaveBeenCalled();
  });

  it("shows Present Here, enabled, while not live, with Blank, Hold and End Live disabled", async () => {
    const onPresentHere = vi.fn();
    render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        onPresentHere={onPresentHere}
      />
    ));
    await screen.findByText("Test Hymn");
    const toolbar = screen.getByRole("toolbar", { name: "Output controls" });
    expect(toolbar.querySelectorAll("button")).toHaveLength(4);
    const here = screen.getByRole("button", { name: /^Present Here/ });
    expect(here).toBeEnabled();
    expect(here).toHaveAttribute("title", expect.not.stringContaining("closing"));
    expect(screen.getByRole("button", { name: /^Hold/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^End Live/ })).toBeDisabled();
    fireEvent.click(here);
    expect(onPresentHere).toHaveBeenCalled();
  });

  it("draws Blank as a slashed circle, Restore as a dot, and Hold as pause in a circle", async () => {
    const view = render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        presenting
        blanked
      />
    ));
    await screen.findByText("Test Hymn");
    expect(
      screen.getByRole("button", { name: /^Restore/ }).querySelector(".icon-restore"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /^Hold/ }).querySelector(".icon-hold"),
    ).not.toBeNull();
    view.unmount();
    render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        presenting
      />
    ));
    await screen.findByText("Test Hymn");
    expect(
      screen.getByRole("button", { name: /^Blank/ }).querySelector(".icon-blank"),
    ).not.toBeNull();
  });

  it("disables End Live in the toolbar while no Output is open", async () => {
    render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        onEndLive={vi.fn()}
      />
    ));
    await screen.findByText("Test Hymn");
    expect(screen.getByRole("button", { name: /^End Live/ })).toBeDisabled();
  });

  it("gives every button of the Repeat group an icon, and the icon-only ones a name and tooltip", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");
    const row = document.querySelector(".repeat-row") as HTMLElement;
    const buttons = [...row.querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Repeat",
      "Undo repeat",
      "Reset repeat",
    ]);
    for (const button of buttons) {
      expect(button.querySelector(".icon")).not.toBeNull();
      expect(button).toHaveAttribute("title");
    }
  });

  it("disables Hold while no Output is open", async () => {
    render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        onToggleHold={vi.fn()}
      />
    ));
    await screen.findByText("Test Hymn");
    expect(screen.getByRole("button", { name: /^Hold/ })).toBeDisabled();
  });

  it("hides Live when preferences hide it, keeping Parts", async () => {
    render(() => (
      <Presenter
        hymnbookId="book"
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

    // Flattened: 1a 1b | Chorus | 2a | Chorus — line 3 is "Line 2a".
    seek.handler?.({ type: "seek", hymnbookId: "book", number: 7, line: 3, whole: false });
    expect(screen.getByRole("button", { name: "Line 2a" })).toHaveAttribute("aria-current", "true");

    // Next part carries on from there.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Chorus");
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
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");
    const published = () => publishOutput.mock.lastCall?.[0];
    const before = published();
    // The three buttons are queried once: a role query walks the whole
    // accessibility tree (tens of ms under jsdom, far more under CPU load), and
    // a dozen of them would put this test past its timeout on a busy machine.
    const repeat = screen.getByRole("button", { name: "Repeat" });
    const undo = screen.getByRole("button", { name: "Undo repeat" });
    const reset = screen.getByRole("button", { name: "Reset repeat" });
    // The row holds its place before any repeat: Undo and Reset disabled.
    expect(undo).toBeDisabled();
    expect(reset).toBeDisabled();

    fireEvent.click(repeat);
    fireEvent.click(repeat);
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

    fireEvent.click(undo);
    expect(count()).toHaveTextContent(/^×2/);
    // At ×2 Reset would only do what Undo does; it's offered from ×3.
    expect(reset).toBeDisabled();
    fireEvent.click(repeat);
    fireEvent.click(repeat);
    fireEvent.click(reset);
    expect(count()).toBeEmptyDOMElement();
    expect(published()).toMatchObject({ lines: before.lines, focus: before.focus });
    fireEvent.click(repeat);
    fireEvent.click(undo);
    expect(undo).toBeDisabled();
    expect(screen.queryByText(/×/)).not.toBeInTheDocument();

    // Next still carries on through the song.
    fireEvent.click(repeat);
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Chorus");
  });

  it("hands the shell its Repeat and Undo repeat while mounted", async () => {
    const onActions = vi.fn();
    const { unmount } = render(() => (
      <Presenter
        hymnbookId="book"
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

  it("repeats with R and undoes with U, as the buttons do (SDD-0001 §16.5)", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");
    const count = () => document.querySelector(".repeat-count");

    // Nothing to undo: silent, and the part stays put.
    fireEvent.keyDown(window, { key: "u" });
    expect(count()).toBeEmptyDOMElement();

    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "R" });
    expect(count()).toHaveTextContent(/^×3/);
    fireEvent.keyDown(window, { key: "u" });
    expect(count()).toHaveTextContent(/^×2/);
    expect(screen.getByRole("button", { name: "Undo repeat" })).toBeEnabled();
    fireEvent.keyDown(window, { key: "U" });
    expect(count()).toBeEmptyDOMElement();
    expect(screen.getByRole("button", { name: "Undo repeat" })).toBeDisabled();
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("1");
    // Next still carries on from the single showing.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Chorus");
  });

  it("takes a held R or U as one press, never auto-repeating (SDD-0001 §16.5)", async () => {
    render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");
    const count = () => document.querySelector(".repeat-count");
    const hold = (key: string) => {
      fireEvent.keyDown(window, { key });
      for (let i = 0; i < 20; i++) fireEvent.keyDown(window, { key, repeat: true });
    };

    hold("r");
    expect(count()).toHaveTextContent(/^×2/);
    hold("r");
    expect(count()).toHaveTextContent(/^×3/);
    hold("u");
    expect(count()).toHaveTextContent(/^×2/);
    // The arrows keep auto-repeating on purpose.
    fireEvent.keyDown(window, { key: "ArrowRight", repeat: true });
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("Chorus");
  });

  it("leaves R and U alone in a text field, a sheet, or with a modifier", async () => {
    render(() => (
      <>
        <input aria-label="Notes" />
        <Presenter
          hymnbookId="book"
          hymnNumber={7}
          store={fakeStore()}
          userState={fakeUserState()}
        />
      </>
    ));
    await screen.findByText("Test Hymn");
    const count = () => document.querySelector(".repeat-count");

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Notes" }), { key: "r" });
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    expect(count()).toBeEmptyDOMElement();

    const sheet = document.body.appendChild(document.createElement("dialog"));
    sheet.setAttribute("open", "");
    try {
      fireEvent.keyDown(window, { key: "r" });
      expect(count()).toBeEmptyDOMElement();
    } finally {
      sheet.remove();
    }
  });

  it("puts the key in each tooltip and aria-keyshortcuts, but not in a phone's tooltip", async () => {
    const tips = () =>
      ["Repeat", "Undo repeat", "Next part", "Previous line", "Next line"].map((name) => {
        const button = screen.getByRole("button", { name });
        return [button.getAttribute("title"), button.getAttribute("aria-keyshortcuts")];
      });
    const { unmount } = render(() => (
      <Presenter hymnbookId="book" hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />
    ));
    await screen.findByText("Test Hymn");
    expect(tips()).toEqual([
      ["Repeat this part (R)", "R"],
      ["Undo repeat (U)", "U"],
      ["Next part (→)", "ArrowRight PageDown Space"],
      ["Previous line (↑)", "ArrowUp"],
      ["Next line (↓)", "ArrowDown"],
    ]);
    unmount();

    // Under 840px there is usually no keyboard: the tooltip is the bare label.
    stubMedia(() => false);
    try {
      render(() => (
        <Presenter
          hymnbookId="book"
          hymnNumber={7}
          store={fakeStore()}
          userState={fakeUserState()}
        />
      ));
      await screen.findByText("Test Hymn");
      expect(tips().map(([title]) => title)).toEqual([
        "Repeat this part",
        "Undo repeat",
        "Next part",
        "Previous line",
        "Next line",
      ]);
      expect(tips().map(([, keys]) => keys)).toEqual([
        "R",
        "U",
        "ArrowRight PageDown Space",
        "ArrowUp",
        "ArrowDown",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("tells the Output which part is up, as a congregation reads it, and its repeat count", async () => {
    publishOutput.mockClear();
    render(() => (
      <Presenter
        hymnbookId="book"
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
    expect(published()).toMatchObject({ part: "Chorus", repeat: 2 });
  });

  it("swaps from a long path to a short one without reading past its end", async () => {
    const long: HymnSource = {
      ...HYMN,
      number: 3,
      title: "Long Hymn",
      sequence: [
        { partId: "s1" },
        { partId: "c" },
        { partId: "s2" },
        { partId: "c" },
        { partId: "s1" },
        { partId: "c" },
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
        hymnbookId="book"
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

  it("a song shown anew lands at once; only a step glides", async () => {
    const other: HymnSource = { ...HYMN, number: 8, title: "Other Hymn" };
    const [number, setNumber] = createSignal(7);
    render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={number()}
        store={fakeStore({ getHymn: async (_book, n) => (n === 7 ? HYMN : other) })}
        userState={fakeUserState()}
      />
    ));
    await screen.findByText("Test Hymn");
    glides.stills.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(glides.stills).toEqual([false]);

    // The hymn number changes first, the new engine (cursor at its start) a
    // moment later: neither is a step.
    glides.stills.length = 0;
    setNumber(8);
    await screen.findByText("Other Hymn");
    expect(glides.stills.length).toBeGreaterThan(0);
    expect(glides.stills.every(Boolean)).toBe(true);
  });
});

describe("stepping with the chorus pinned and the whole song lit (SDD-0001 §5.5)", () => {
  type Props = { pinChorus?: boolean; highlight?: "part" | "song"; wholeSong?: boolean };
  const open = async (props: Props) => {
    render(() => (
      <Presenter
        hymnbookId="book"
        hymnNumber={7}
        store={fakeStore()}
        userState={fakeUserState()}
        liveLandscape={true}
        {...props}
      />
    ));
    await screen.findByText("Test Hymn");
  };
  const heading = () => currentPart().getByRole("heading", { level: 3 });
  const key = (k: string, extra: KeyboardEventInit = {}) =>
    fireEvent.keyDown(window, { key: k, ...extra });

  it("Next and Previous part, the arrows and Space step over the chorus", async () => {
    await open({ pinChorus: true, highlight: "song" });
    expect(heading()).toHaveTextContent("1");
    key("ArrowRight");
    expect(heading()).toHaveTextContent("2");
    // Only the closing chorus is left, which is always in view: nowhere to go.
    expect(screen.getByRole("button", { name: "Next part" })).toBeDisabled();
    key("ArrowRight");
    expect(heading()).toHaveTextContent("2");
    key("ArrowLeft");
    expect(heading()).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Previous part" })).toBeDisabled();
    key(" ");
    expect(heading()).toHaveTextContent("2");
    key(" ", { shiftKey: true });
    key("PageDown");
    expect(heading()).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "Previous part" }));
    expect(heading()).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Next part" }));
    expect(heading()).toHaveTextContent("2");
  });

  it("the Output's forwarded keys step the same way", async () => {
    await open({ pinChorus: true, highlight: "song" });
    // The Output forwards a key as a keydown in the Operator (channel.ts).
    key("PageDown");
    expect(heading()).toHaveTextContent("2");
  });

  it("line steps skip the chorus's lines", async () => {
    await open({ pinChorus: true, highlight: "song" });
    key("ArrowDown");
    key("ArrowDown");
    key("ArrowDown"); // past 1b: the chorus is skipped, 2 is next, whole
    expect(heading()).toHaveTextContent("2");
    key("ArrowDown");
    expect(screen.getByRole("button", { name: "Line 2a" })).toHaveAttribute("aria-current", "true");
    key("ArrowUp");
    key("ArrowUp"); // back over the chorus to 1's last line
    expect(heading()).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Line 1b" })).toHaveAttribute("aria-current", "true");
  });

  it("a direct tap on the chorus still selects it", async () => {
    await open({ pinChorus: true, highlight: "song" });
    fireEvent.click(
      within(screen.getByRole("region", { name: "Jump to part" })).getByRole("button", {
        name: "Chorus",
      }),
    );
    expect(heading()).toHaveTextContent("Chorus");
    key("ArrowRight");
    expect(heading()).toHaveTextContent("2");
  });

  it("walks the chorus as ever when the highlight is This part", async () => {
    await open({ pinChorus: true, highlight: "part" });
    key("ArrowRight");
    expect(heading()).toHaveTextContent("Chorus");
    key("ArrowDown");
    key("ArrowDown");
    expect(heading()).toHaveTextContent("2");
  });

  it("walks the chorus as ever when the chorus is not pinned", async () => {
    await open({ pinChorus: false, highlight: "song" });
    key("ArrowRight");
    expect(heading()).toHaveTextContent("Chorus");
  });

  it("walks the chorus as ever in Full Song, which shows no pinned chorus", async () => {
    await open({ pinChorus: true, highlight: "song", wholeSong: true });
    key("ArrowRight");
    expect(heading()).toHaveTextContent("Chorus");
  });
});
