import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlatLine } from "../domain/sequence-engine.ts";
import type { OutputMessage } from "./channel.ts";
import { Output } from "./Output.tsx";

const channel = vi.hoisted(() => ({
  handler: undefined as ((message: OutputMessage) => void) | undefined,
  unsubscribe: vi.fn(),
  requestSeek: vi.fn(),
  forwardKey: vi.fn(),
}));
vi.mock("./channel.ts", () => ({
  subscribeOutput: (handler: (message: OutputMessage) => void) => {
    channel.handler = handler;
    return channel.unsubscribe;
  },
  requestSeek: channel.requestSeek,
  forwardKey: channel.forwardKey,
}));

const LINES: FlatLine[] = [
  { text: "Line 1a", partId: "s1", isPartStart: true },
  { text: "Line 1b", partId: "s1", isPartStart: false },
  { text: "Refrain line", partId: "r", isPartStart: true },
];

function show(start: number, end = start + 1, number = 7): void {
  channel.handler?.({
    type: "content",
    hymnbookId: "book",
    number,
    title: "Test Hymn",
    lines: LINES,
    focus: { start, end },
  });
}

// jsdom has no layout, so no scrolling — record calls instead. Where the
// focus lands on screen needs real geometry; that's the browser check.
const scrollTo = vi.fn();
beforeEach(() => {
  Element.prototype.scrollTo = scrollTo;
});
afterEach(() => {
  scrollTo.mockClear();
  channel.unsubscribe.mockClear();
  channel.requestSeek.mockClear();
  channel.forwardKey.mockClear();
  vi.useRealTimers();
});

describe("Output", () => {
  it("is blank until the Presenter publishes something", () => {
    render(() => <Output />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows every line, brightening only the focused one, with no title or labels", () => {
    render(() => <Output />);
    show(1);

    expect(screen.getAllByRole("listitem").filter((li) => li.textContent)).toHaveLength(3);
    expect(screen.getByText("Line 1b")).toHaveClass("output-line-current");
    expect(screen.getByText("Line 1a")).not.toHaveClass("output-line-current");
    expect(screen.queryByText("Test Hymn")).not.toBeInTheDocument();
  });

  it("brightens a whole part under whole-part focus", () => {
    render(() => <Output />);
    show(0, 2);

    expect(screen.getByText("Line 1a")).toHaveClass("output-line-current");
    expect(screen.getByText("Line 1b")).toHaveClass("output-line-current");
    expect(screen.getByText("Refrain line")).not.toHaveClass("output-line-current");
  });

  it("snaps to a new hymn, then scrolls smoothly within it", () => {
    render(() => <Output />);
    show(0);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "instant" }));

    show(2);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth" }));

    show(0, 1, 8);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "instant" }));
  });

  it("goes blank again on idle, and unsubscribes on unmount", () => {
    const { unmount } = render(() => <Output />);
    show(0);
    channel.handler?.({ type: "idle" });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    unmount();
    expect(channel.unsubscribe).toHaveBeenCalled();
  });

  it("shows the cursor while the mouse moves, and hides it once still", () => {
    vi.useFakeTimers();
    try {
      render(() => <Output />);
      show(0);
      // The class sits on the scroll container around the list.
      const scroll = screen.getByRole("list").parentElement;
      expect(scroll).not.toHaveClass("output-cursor");

      window.dispatchEvent(new MouseEvent("mousemove"));
      expect(scroll).toHaveClass("output-cursor");

      vi.advanceTimersByTime(1999);
      expect(scroll).toHaveClass("output-cursor");
      vi.advanceTimersByTime(1);
      expect(scroll).not.toHaveClass("output-cursor");
    } finally {
      vi.useRealTimers();
    }
  });

  it("drifts back to the focus a moment after a hand-scroll stops", () => {
    vi.useFakeTimers();
    try {
      render(() => <Output />);
      show(1);
      scrollTo.mockClear();
      const view = screen.getByRole("list").parentElement as HTMLElement;

      view.dispatchEvent(new WheelEvent("wheel"));
      vi.advanceTimersByTime(1000);
      view.dispatchEvent(new WheelEvent("wheel")); // still scrolling
      vi.advanceTimersByTime(1499);
      expect(scrollTo).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("fades to the bare background while blanked, still following the focus underneath", () => {
    render(() => <Output />);
    show(0);
    channel.handler?.({ type: "blank", blanked: true });

    const view = screen.getByText("Line 1a").closest(".output-view");
    expect(view).toHaveClass("output-blanked");
    show(2);
    expect(screen.getByText("Refrain line")).toHaveClass("output-line-current");

    channel.handler?.({ type: "blank", blanked: false });
    expect(view).not.toHaveClass("output-blanked");
  });

  it("takes the Operator's Output theme, live (SDD-0001 §16.1)", () => {
    render(() => <Output />);
    channel.handler?.({ type: "presentation", theme: "contrast", cues: {} });
    expect(document.documentElement.getAttribute("data-output-theme")).toBe("contrast");
    channel.handler?.({ type: "presentation", theme: "dark", cues: {} });
    expect(document.documentElement.getAttribute("data-output-theme")).toBe("dark");
  });

  it("shows no caption until a cue is on, then only the cues switched on", () => {
    render(() => <Output />);
    channel.handler?.({
      type: "content",
      hymnbookId: "book",
      number: 7,
      title: "Test Hymn",
      lines: LINES,
      focus: { start: 2, end: 3 },
      hymnbookTitle: "Test Book",
      part: "Refrain",
      repeat: 2,
    });
    expect(document.querySelector(".output-caption")).not.toBeInTheDocument();

    channel.handler?.({ type: "presentation", theme: "warm", cues: { title: true, repeat: true } });
    expect(document.querySelector(".output-caption")).toHaveTextContent("Test Hymn · ×2");
    expect(document.querySelector(".output-badge")).not.toBeInTheDocument();
    channel.handler?.({
      type: "presentation",
      theme: "warm",
      cues: { number: true, hymnbook: true, title: true, part: true, repeat: true },
    });
    expect(document.querySelector(".output-caption")).toHaveTextContent(
      "Test Book · Test Hymn · Refrain · ×2",
    );
    // The number is its own badge, for songbooks.
    expect(document.querySelector(".output-badge")).toHaveTextContent("7");
  });

  it("marks the refrain's lines as one band, each showing its own", () => {
    render(() => <Output />);
    channel.handler?.({
      type: "content",
      hymnbookId: "book",
      number: 7,
      title: "Test Hymn",
      lines: [...LINES, { text: "Line 2a", partId: "s2", isPartStart: true }, ...LINES.slice(2)],
      focus: { start: 0, end: 2 },
      refrain: "r",
    });
    const refrains = screen.getAllByText("Refrain line");
    expect(refrains).toHaveLength(2);
    for (const line of refrains) {
      expect(line).toHaveClass("output-refrain", "output-refrain-start", "output-refrain-end");
    }
    expect(screen.getByText("Line 1a")).not.toHaveClass("output-refrain");
  });

  it("fades each cue a few seconds after it changes, when set to", () => {
    vi.useFakeTimers();
    render(() => <Output />);
    channel.handler?.({
      type: "presentation",
      theme: "warm",
      cues: { part: true, number: true, fade: true },
    });
    const content = (focus: number, part: string) =>
      channel.handler?.({
        type: "content",
        hymnbookId: "book",
        number: 7,
        title: "Test Hymn",
        lines: LINES,
        focus: { start: focus, end: focus + 1 },
        part,
      });
    content(0, "Verse 1");
    const caption = () => document.querySelector(".output-caption");
    const badge = () => document.querySelector(".output-badge");
    expect(caption()).not.toHaveClass("output-cue-faded");

    vi.advanceTimersByTime(8000);
    expect(caption()).toHaveClass("output-cue-faded");
    expect(badge()).toHaveClass("output-cue-faded");

    content(2, "Refrain"); // the part changes: its caption returns, the number doesn't
    expect(caption()).not.toHaveClass("output-cue-faded");
    expect(badge()).toHaveClass("output-cue-faded");

    // The operator's "Show cues now" brings them all back for a while.
    channel.handler?.({ type: "reveal" });
    expect(badge()).not.toHaveClass("output-cue-faded");
    vi.advanceTimersByTime(8000);
    expect(badge()).toHaveClass("output-cue-faded");
  });

  it("still scrolls smoothly between steps with cues on, refitting only when they toggle", () => {
    render(() => <Output />);
    channel.handler?.({ type: "presentation", theme: "warm", cues: { part: true, number: true } });
    show(0);
    scrollTo.mockClear();
    show(2);
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });

  it("asks to seek once a person's scroll comes to rest (SDD-0001 §16.1)", () => {
    vi.useFakeTimers();
    render(() => <Output />);
    show(0);
    const view = screen.getByText("Line 1a").closest(".output-view") as HTMLElement;

    fireEvent.wheel(view);
    fireEvent.scroll(view);
    vi.advanceTimersByTime(100);
    fireEvent.scroll(view); // still moving: rest restarts
    vi.advanceTimersByTime(100);
    expect(channel.requestSeek).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);

    // jsdom has no layout, so every line sits at 0: the first is nearest.
    expect(channel.requestSeek).toHaveBeenCalledTimes(1);
    expect(channel.requestSeek).toHaveBeenCalledWith({
      hymnbookId: "book",
      number: 7,
      line: 0,
      // The band is part-sized by default, even from line focus.
      whole: true,
    });
  });

  it("never echoes its own re-centring back as a seek", () => {
    vi.useFakeTimers();
    render(() => <Output />);
    show(0);
    const view = screen.getByText("Line 1a").closest(".output-view") as HTMLElement;

    // A scroll with no gesture behind it: the view's own smooth scroll.
    fireEvent.scroll(view);
    vi.advanceTimersByTime(500);
    // A gesture, then the Operator moves first: that positioning disarms it.
    fireEvent.wheel(view);
    show(2);
    fireEvent.scroll(view);
    vi.advanceTimersByTime(500);

    expect(channel.requestSeek).not.toHaveBeenCalled();
  });

  it("forwards plain keys to the Operator instead of scrolling (SDD-0001 §16.1)", () => {
    render(() => <Output />);
    show(0);

    const arrow = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
    window.dispatchEvent(arrow);
    fireEvent.keyDown(window, { key: " ", shiftKey: true });
    fireEvent.keyDown(window, { key: "b" });
    // Chords stay the browser's; other named keys (Tab, Escape) too.
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(arrow.defaultPrevented).toBe(true);
    expect(channel.forwardKey.mock.calls).toEqual([
      [{ key: "ArrowRight", shiftKey: false }],
      [{ key: " ", shiftKey: true }],
      [{ key: "b", shiftKey: false }],
    ]);
  });

  it("sets each part after the first apart with a gap", () => {
    render(() => <Output />);
    show(0);

    expect(screen.getByText("Line 1a")).not.toHaveClass("output-part-start");
    expect(screen.getByText("Line 1b")).not.toHaveClass("output-part-start");
    expect(screen.getByText("Refrain line")).toHaveClass("output-part-start");
  });
});
