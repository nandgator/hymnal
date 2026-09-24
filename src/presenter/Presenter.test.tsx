import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { HymnSource } from "../domain/types.ts";
import type { ContentStore } from "../persistence/content-store.ts";
import type { UserState } from "../persistence/user-state.ts";
import { Presenter } from "./Presenter.tsx";

const publishOutput = vi.hoisted(() => vi.fn());
vi.mock("../output/channel.ts", () => ({ publishOutput }));

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
    listHymns: async () => {
      throw new Error("not used");
    },
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

// The Sequence pane marks the current occurrence's block aria-current="step".
const currentPart = () => {
  const block = within(screen.getByRole("region", { name: "Sequence" }))
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

    expect(await screen.findByText("No hymn numbered 9999.")).toBeInTheDocument();
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
    expect(screen.queryByText(/Repeat/)).not.toBeInTheDocument();
  });

  it("counts back-to-back jumps to the same part as a running repeat", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");
    const jumpList = within(screen.getByRole("region", { name: "Jump to part" }));

    // The first tap skips ahead to the refrain (not a repeat); each further
    // tap repeats it in place (SDD-0001 §5.1).
    fireEvent.click(jumpList.getByRole("button", { name: "Refrain" }));
    expect(screen.queryByText(/Repeat/)).not.toBeInTheDocument();

    fireEvent.click(jumpList.getByRole("button", { name: "Refrain" }));
    expect(screen.getByText("(Repeat 2)")).toBeInTheDocument();

    fireEvent.click(jumpList.getByRole("button", { name: "Refrain" }));
    expect(screen.getByText("(Repeat 3)")).toBeInTheDocument();
  });

  it("hides the repeat cue when the presenter turns it off", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");

    const jumpList = within(screen.getByRole("region", { name: "Jump to part" }));
    fireEvent.click(jumpList.getByRole("button", { name: "Refrain" }));
    fireEvent.click(jumpList.getByRole("button", { name: "Refrain" }));
    expect(screen.getByText("(Repeat 2)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Show repeat cues" }));
    expect(screen.queryByText("(Repeat 2)")).not.toBeInTheDocument();
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

    // s1, r, s2, r — at s1, skip ahead to s2.
    fireEvent.click(jumpList.getByRole("button", { name: "2" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Next part" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous part" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("1");
  });

  it("shows the whole sung order and goes to a block, or a line, when tapped (SDD-0001 §16.4)", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");
    const sequence = within(screen.getByRole("region", { name: "Sequence" }));

    // s1, r, s2, r — every occurrence, the refrain twice.
    expect(sequence.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "1",
      "Refrain",
      "2",
      "Refrain",
    ]);

    fireEvent.click(sequence.getByRole("button", { name: "2" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("2");

    fireEvent.click(screen.getByRole("button", { name: "Line 1b" }));
    expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Line 1b" })).toHaveAttribute("aria-current", "true");
  });

  it("mirrors the Output in the Live pane", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");

    const live = within(screen.getByRole("img", { name: "Live output preview" }));
    expect(live.getByText("Line 1a")).toHaveClass("live-line-current");
    expect(live.getByText("Line 1b")).toHaveClass("live-line-current");
    expect(live.getByText("Refrain line")).not.toHaveClass("live-line-current");
  });

  it("puts supporting panes behind dock buttons on a narrow screen, nothing dropped", async () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    try {
      render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
      await screen.findByText("Test Hymn");

      expect(screen.queryByRole("region", { name: "Jump to part" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Parts" }));
      const jumpList = within(screen.getByRole("region", { name: "Jump to part" }));
      fireEvent.click(jumpList.getByRole("button", { name: "2" }));
      expect(currentPart().getByRole("heading", { level: 3 })).toHaveTextContent("2");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
