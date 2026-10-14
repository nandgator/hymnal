import { fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputMessage } from "./channel.ts";
import { BAR_HIDE_MS, PresentHere, type PresentHereProps } from "./PresentHere.tsx";

vi.mock("./OutputView.tsx", () => ({ OutputView: () => <p data-testid="lyrics">A line</p> }));
vi.mock("../finder/Finder.tsx", () => ({ Finder: () => <input aria-label="Find" /> }));

const content: Extract<OutputMessage, { type: "content" }> = {
  type: "content",
  hymnbookId: "book",
  number: 1,
  title: "A hymn",
  lines: [{ text: "A line", partId: "s1", isPartStart: true }],
  focus: { start: 0, end: 1 },
};

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

let keys: string[];
const record = (event: KeyboardEvent) => keys.push(event.key);
beforeEach(() => {
  keys = [];
  window.addEventListener("keydown", record);
  vi.useFakeTimers();
});
afterEach(() => {
  window.removeEventListener("keydown", record);
  vi.useRealTimers();
});

const view = () => screen.getByTestId("lyrics");
const shown = () => document.querySelector(".present-bar")?.hasAttribute("data-shown");
const button = (name: string) => screen.getByRole("button", { name, hidden: true });

function touch(
  from: [number, number],
  to: [number, number] = from,
  over: { pointerType?: string; target?: Element } = {},
) {
  const target = over.target ?? view();
  const init = { pointerId: 1, isPrimary: true, pointerType: over.pointerType ?? "touch" };
  fireEvent.pointerDown(target, { ...init, clientX: from[0], clientY: from[1] });
  fireEvent.pointerUp(target, { ...init, clientX: to[0], clientY: to[1] });
}

describe("Present Here by touch (Board #72, SDD-0001 §16.7)", () => {
  it("shows nothing until someone touches the screen", () => {
    render(() => <PresentHere {...props()} />);
    expect(shown()).toBe(false);
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("a tap shows the bar with its four buttons; a tap away hides it", () => {
    render(() => <PresentHere {...props()} />);
    touch([100, 100]);
    expect(shown()).toBe(true);
    for (const name of ["Search", "Previous", "Next", "Leave"]) {
      const b = screen.getByRole("button", { name });
      expect(b).toHaveAttribute("title");
    }
    touch([100, 100]);
    expect(shown()).toBe(false);
  });

  it("a pen taps too; a mouse click shows nothing", () => {
    render(() => <PresentHere {...props()} />);
    touch([100, 100], [100, 100], { pointerType: "mouse" });
    fireEvent.click(view());
    expect(shown()).toBe(false);
    touch([100, 100], [100, 100], { pointerType: "pen" });
    expect(shown()).toBe(true);
  });

  it("hides after about 3 s; a touch on the bar restarts the time", () => {
    render(() => <PresentHere {...props()} />);
    touch([100, 100]);
    vi.advanceTimersByTime(BAR_HIDE_MS - 500);
    expect(shown()).toBe(true);
    fireEvent.pointerDown(button("Next"), { pointerType: "touch", isPrimary: true, pointerId: 2 });
    vi.advanceTimersByTime(BAR_HIDE_MS - 500);
    expect(shown()).toBe(true);
    vi.advanceTimersByTime(600);
    expect(shown()).toBe(false);
  });

  it("Next and Previous replay the arrow keys; Leave leaves", () => {
    const onLeave = vi.fn();
    render(() => <PresentHere {...props({ onLeave })} />);
    touch([100, 100]);
    fireEvent.click(button("Next"));
    fireEvent.click(button("Previous"));
    expect(keys).toEqual(["ArrowRight", "ArrowLeft"]);
    expect(shown()).toBe(true);
    fireEvent.click(button("Leave"));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("Search opens the switcher and hides the bar; a tap outside closes it", () => {
    render(() => <PresentHere {...props()} />);
    touch([100, 100]);
    fireEvent.click(button("Search"));
    expect(screen.getByRole("search", { name: "Switch song" })).toBeInTheDocument();
    expect(shown()).toBe(false);
    touch([100, 100]);
    expect(screen.queryByRole("search", { name: "Switch song" })).toBeNull();
    expect(shown()).toBe(false);
  });

  it("a tap inside the switcher does not close it", () => {
    render(() => <PresentHere {...props({ startWithSwitcher: true })} />);
    const inside = screen.getByRole("search", { name: "Switch song" });
    touch([100, 100], [100, 100], { target: inside });
    expect(screen.getByRole("search", { name: "Switch song" })).toBeInTheDocument();
  });

  it("a swipe left steps next, a swipe right previous", () => {
    render(() => <PresentHere {...props()} />);
    touch([300, 200], [100, 210]);
    touch([100, 200], [300, 190]);
    expect(keys).toEqual(["ArrowRight", "ArrowLeft"]);
    expect(shown()).toBe(false);
  });

  it("a short, a vertical or a slanting drag does not step", () => {
    render(() => <PresentHere {...props()} />);
    touch([200, 200], [170, 200]);
    touch([200, 100], [200, 400]);
    touch([200, 200], [120, 150]);
    expect(keys).toEqual([]);
    expect(shown()).toBe(false);
  });

  it("a cancelled press (the browser took it to scroll) does nothing", () => {
    render(() => <PresentHere {...props()} />);
    fireEvent.pointerDown(view(), { pointerId: 1, isPrimary: true, pointerType: "touch" });
    fireEvent.pointerCancel(view(), { pointerId: 1, pointerType: "touch" });
    fireEvent.pointerUp(view(), { pointerId: 1, isPrimary: true, pointerType: "touch" });
    expect(shown()).toBe(false);
  });

  it("the keys are unchanged: F leaves, Esc closes the switcher before leaving", () => {
    const onLeave = vi.fn();
    render(() => <PresentHere {...props({ onLeave, startWithSwitcher: true })} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onLeave).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "f" });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
