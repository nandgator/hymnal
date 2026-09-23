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

const currentPart = () => within(screen.getByRole("region", { name: "Current part" }));

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
    expect(screen.getByText("Line 1a")).not.toHaveAttribute("aria-current");
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

    // Stored order ends on the refrain, so jumping to it again is adjacent.
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
    expect(screen.getByText("(Repeat 2)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Show repeat cues" }));
    expect(screen.queryByText("(Repeat 2)")).not.toBeInTheDocument();
  });

  it("moves through lines within a part, focusing one at a time", async () => {
    render(() => <Presenter hymnNumber={7} store={fakeStore()} userState={fakeUserState()} />);
    await screen.findByText("Test Hymn");

    fireEvent.click(screen.getByRole("button", { name: "Next line" }));
    expect(screen.getByText("Line 1a")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Line 1b")).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByRole("button", { name: "Next line" }));
    expect(screen.getByText("Line 1b")).toHaveAttribute("aria-current", "true");

    fireEvent.click(screen.getByRole("button", { name: "Previous line" }));
    expect(screen.getByText("Line 1a")).toHaveAttribute("aria-current", "true");
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
    expect(screen.getByText("Line 2a")).toHaveAttribute("aria-current", "true");

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
});
