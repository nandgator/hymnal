import { render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlatLine } from "../domain/sequence-engine.ts";
import type { OutputMessage } from "./channel.ts";
import { Output } from "./Output.tsx";

const channel = vi.hoisted(() => ({
  handler: undefined as ((message: OutputMessage) => void) | undefined,
  unsubscribe: vi.fn(),
}));
vi.mock("./channel.ts", () => ({
  subscribeOutput: (handler: (message: OutputMessage) => void) => {
    channel.handler = handler;
    return channel.unsubscribe;
  },
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
      const scroll = screen.getByRole("list");
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
});
