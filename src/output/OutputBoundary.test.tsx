import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputMessage } from "./channel.ts";
import { Output } from "./Output.tsx";
import { PresentHere, type PresentHereProps } from "./PresentHere.tsx";

// The view throws whenever it is asked to draw a song.
vi.mock("./OutputView.tsx", () => ({
  OutputView: () => {
    throw new Error("view broke");
  },
}));
vi.mock("../finder/Finder.tsx", () => ({ Finder: () => <input /> }));

const channel = vi.hoisted(() => ({
  handler: undefined as ((message: OutputMessage) => void) | undefined,
  reportOutputFailed: vi.fn(),
}));
vi.mock("./channel.ts", () => ({
  subscribeOutput: (handler: (message: OutputMessage) => void) => {
    channel.handler = handler;
    return () => {};
  },
  requestSeek: vi.fn(),
  forwardKey: vi.fn(),
  reportOutputPlacement: vi.fn(),
  reportOutputFailed: channel.reportOutputFailed,
}));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  channel.reportOutputFailed.mockClear();
  vi.restoreAllMocks();
});

const content: Extract<OutputMessage, { type: "content" }> = {
  type: "content",
  hymnbookId: "book",
  number: 1,
  title: "A hymn",
  lines: [{ text: "A line", partId: "s1", isPartStart: true }],
  focus: { start: 0, end: 1 },
};

describe("the Output's boundary (SDD-0001 §16.9)", () => {
  it("goes blank, with nothing on it, and tells the Operator once", async () => {
    const { container } = render(() => <Output />);
    expect(channel.reportOutputFailed).not.toHaveBeenCalled();
    channel.handler?.(content);
    await waitFor(() => expect(channel.reportOutputFailed).toHaveBeenCalledTimes(1));
    expect(container.querySelector(".output-idle")).toBeInTheDocument();
    expect(container.textContent).toBe("");
    expect(screen.queryByText(/wrong|error/i)).toBeNull();
  });
});

describe("Present Here's boundary", () => {
  const props = (over: Partial<PresentHereProps> = {}): PresentHereProps => ({
    message: content,
    blanked: false,
    theme: "warm",
    cues: {},
    reveal: 0,
    pinChorus: false,
    wholeSong: false,
    highlight: "part",
    bandSize: "part",
    hymnbookId: "book",
    onSelect: () => {},
    onLeave: vi.fn(),
    onFailed: vi.fn(),
    ...over,
  });

  it("goes blank, tells the Operator, and F and Esc still leave", async () => {
    const onLeave = vi.fn();
    const onFailed = vi.fn();
    render(() => <PresentHere {...props({ onLeave, onFailed })} />);
    await waitFor(() => expect(onFailed).toHaveBeenCalledTimes(1));
    const here = screen.getByRole("region", { name: "Presenting on this screen" });
    expect(here.textContent).toBe("");
    fireEvent.keyDown(window, { key: "f" });
    expect(onLeave).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onLeave).toHaveBeenCalledTimes(2);
  });
});
