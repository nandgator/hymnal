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
  { text: "Chorus line", partId: "c", isPartStart: true },
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
    expect(screen.getByText("Chorus line")).not.toHaveClass("output-line-current");
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
    expect(screen.getByText("Chorus line")).toHaveClass("output-line-current");

    channel.handler?.({ type: "blank", blanked: false });
    expect(view).not.toHaveClass("output-blanked");
  });

  it("takes the Operator's Output theme, live (SDD-0001 §16.1)", () => {
    render(() => <Output />);
    channel.handler?.({
      type: "presentation",
      theme: "contrast",
      cues: {},
      pinChorus: false,
      bandSize: "part",
    });
    expect(document.documentElement.getAttribute("data-output-theme")).toBe("contrast");
    channel.handler?.({
      type: "presentation",
      theme: "dark",
      cues: {},
      pinChorus: false,
      bandSize: "part",
    });
    expect(document.documentElement.getAttribute("data-output-theme")).toBe("dark");
  });

  it("lights every line for the whole-song highlight, and only the focus again after", () => {
    render(() => <Output />);
    show(0);
    expect(screen.getByText("Chorus line")).not.toHaveClass("output-line-current");
    channel.handler?.({
      type: "presentation",
      theme: "warm",
      cues: {},
      pinChorus: false,
      highlight: "song",
      bandSize: "part",
    });
    for (const text of ["Line 1a", "Line 1b", "Chorus line"]) {
      expect(screen.getByText(text)).toHaveClass("output-line-current");
    }
    channel.handler?.({
      type: "presentation",
      theme: "warm",
      cues: {},
      pinChorus: false,
      bandSize: "part",
    });
    expect(screen.getByText("Chorus line")).not.toHaveClass("output-line-current");
    expect(screen.getByText("Line 1a")).toHaveClass("output-line-current");
  });

  it("shows the whole song, nothing scrolling, on a landscape view (a square counts)", () => {
    const sizes = vi.spyOn(HTMLElement.prototype, "clientWidth", "get");
    const heights = vi.spyOn(HTMLElement.prototype, "clientHeight", "get");
    sizes.mockReturnValue(1000);
    heights.mockReturnValue(1000);
    render(() => <Output />);
    channel.handler?.({
      type: "presentation",
      theme: "warm",
      cues: {},
      pinChorus: false,
      wholeSong: true,
      bandSize: "part",
    });
    channel.handler?.({
      type: "content",
      hymnbookId: "book",
      number: 7,
      title: "Test Hymn",
      lines: LINES,
      focus: { start: 2, end: 3 },
      parts: [
        { id: "s1", lines: ["Line 1a", "Line 1b"] },
        { id: "c", lines: ["Chorus line"] },
      ],
    });
    expect(document.querySelector(".output-view-fullsong")).toBeInTheDocument();
    expect([...document.querySelectorAll(".full-part")]).toHaveLength(2);
    expect(document.querySelector(".full-part-current")).toHaveTextContent("Chorus line");
    sizes.mockRestore();
    heights.mockRestore();
  });

  it("keeps scrolling while the whole song is on a view that is not landscape", () => {
    render(() => <Output />);
    channel.handler?.({
      type: "presentation",
      theme: "warm",
      cues: {},
      pinChorus: false,
      wholeSong: true,
      bandSize: "part",
    });
    channel.handler?.({
      type: "content",
      hymnbookId: "book",
      number: 7,
      title: "Test Hymn",
      lines: LINES,
      focus: { start: 0, end: 1 },
      parts: [
        { id: "s1", lines: ["Line 1a", "Line 1b"] },
        { id: "c", lines: ["Chorus line"] },
      ],
    });
    // jsdom has no layout: not wider than tall, so the scroll shows.
    expect(document.querySelector(".output-view-fullsong")).not.toBeInTheDocument();
    expect(document.querySelector(".full-song")).not.toBeInTheDocument();
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
      part: "Chorus",
      repeat: 2,
    });
    expect(document.querySelector(".output-caption")).not.toBeInTheDocument();

    channel.handler?.({
      type: "presentation",
      theme: "warm",
      cues: { title: true, repeat: true },
      pinChorus: false,
      bandSize: "part",
    });
    expect(document.querySelector(".output-caption")).toHaveTextContent("Test Hymn · ×2");
    expect(document.querySelector(".output-badge")).not.toBeInTheDocument();
    channel.handler?.({
      type: "presentation",
      theme: "warm",
      cues: { number: true, hymnbook: true, title: true, part: true, repeat: true },
      pinChorus: false,
      bandSize: "part",
    });
    expect(document.querySelector(".output-caption")).toHaveTextContent(
      "Test Book · Test Hymn · Chorus · ×2",
    );
    // The number is its own badge, for songbooks.
    expect(document.querySelector(".output-badge")).toHaveTextContent("7");
  });

  it("names the chorus's lines, unmarked while flowing", () => {
    render(() => <Output />);
    channel.handler?.({
      type: "content",
      hymnbookId: "book",
      number: 7,
      title: "Test Hymn",
      lines: [...LINES, { text: "Line 2a", partId: "s2", isPartStart: true }, ...LINES.slice(2)],
      focus: { start: 2, end: 3 },
      chorus: "c",
    });
    const choruses = screen.getAllByText("Chorus line");
    expect(choruses).toHaveLength(2);
    for (const line of choruses) expect(line).toHaveClass("output-chorus");
    expect(screen.getByText("Line 1a")).not.toHaveClass("output-chorus");
    // No mark while sung: the lit lines and the part gap say where we are.
    expect(choruses[0]).toHaveClass("output-line-current");
    expect(choruses[0].className).not.toMatch(/special/);
  });

  describe("the chorus, pinned (SDD-0001 §16.1)", () => {
    // Verse 1, chorus, verse 2, chorus again.
    const PINNABLE = [
      ...LINES,
      { text: "Line 2a", partId: "s2", isPartStart: true },
      ...LINES.slice(2),
    ];
    const present = (pinChorus: boolean, focus: number) => {
      channel.handler?.({
        type: "presentation",
        theme: "warm",
        cues: {},
        pinChorus,
        bandSize: "part",
      });
      channel.handler?.({
        type: "content",
        hymnbookId: "book",
        number: 7,
        title: "Test Hymn",
        lines: PINNABLE,
        focus: { start: focus, end: focus + 1 },
        chorus: "c",
      });
    };
    const band = () => document.querySelector(".output-pinned");

    it("shows the chorus once, in the band, its copies out of the column", () => {
      render(() => <Output />);
      present(true, 0);
      expect(band()).toHaveTextContent("Chorus line");
      const inColumn = screen.getAllByText("Chorus line").filter((line) => !band()?.contains(line));
      expect(inColumn).toHaveLength(2);
      // Hidden by the view's pinned mode, which the stylesheet applies.
      expect(inColumn[0].closest(".output-view")).toHaveClass("output-pinned-mode");
    });

    it("lights the band when the chorus is sung, the column otherwise", () => {
      render(() => <Output />);
      present(true, 0);
      const bandLine = () => band()?.querySelector(".output-line");
      expect(screen.getByText("Line 1a")).toHaveClass("output-line-current");
      expect(bandLine()).not.toHaveClass("output-line-current");

      present(true, 4); // the second showing of the chorus
      expect(bandLine()).toHaveClass("output-line-current");
    });

    it("flows exactly as ever with pinning off", () => {
      render(() => <Output />);
      present(false, 0);
      expect(band()).not.toBeInTheDocument();
      expect(screen.getByText("Line 1a").closest(".output-view")).not.toHaveClass(
        "output-pinned-mode",
      );
    });
  });

  it("fades the cues together, back only at a new hymn, a restore or on request", () => {
    vi.useFakeTimers();
    render(() => <Output />);
    channel.handler?.({
      type: "presentation",
      theme: "warm",
      cues: { part: true, number: true, fade: true },
      pinChorus: false,
      bandSize: "part",
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

    content(2, "Chorus"); // a part step brings nothing back: cues move as one
    expect(caption()).toHaveClass("output-cue-faded");
    expect(badge()).toHaveClass("output-cue-faded");
    expect(caption()).toHaveTextContent("Chorus"); // though its text keeps up

    // Back from blank, every cue returns together, even one that changed
    // while blanked, and an unchanged one too.
    vi.advanceTimersByTime(8000);
    channel.handler?.({ type: "blank", blanked: true });
    content(0, "Verse 1");
    channel.handler?.({ type: "blank", blanked: false });
    expect(caption()).not.toHaveClass("output-cue-faded");
    expect(badge()).not.toHaveClass("output-cue-faded");
    vi.advanceTimersByTime(8000);
    expect(caption()).toHaveClass("output-cue-faded");
    expect(badge()).toHaveClass("output-cue-faded");

    // The operator's "Show cues now" brings them all back for a while.
    channel.handler?.({ type: "reveal" });
    expect(badge()).not.toHaveClass("output-cue-faded");
    vi.advanceTimersByTime(8000);
    expect(badge()).toHaveClass("output-cue-faded");
  });

  it("still scrolls smoothly between steps with cues on, refitting only when they toggle", () => {
    render(() => <Output />);
    channel.handler?.({
      type: "presentation",
      theme: "warm",
      cues: { part: true, number: true },
      pinChorus: false,
      bandSize: "part",
    });
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

  it("sizes the reading band as the Operator's presentation says, a line or a part", () => {
    vi.useFakeTimers();
    render(() => <Output />);
    show(0);
    const view = screen.getByText("Line 1a").closest(".output-view") as HTMLElement;
    const scrollOnce = () => {
      fireEvent.wheel(view);
      fireEvent.scroll(view);
      vi.advanceTimersByTime(500);
    };

    channel.handler?.({
      type: "presentation",
      theme: "warm",
      cues: {},
      pinChorus: false,
      bandSize: "line",
    });
    scrollOnce();
    expect(channel.requestSeek).toHaveBeenLastCalledWith(expect.objectContaining({ whole: false }));

    // The Operator accepting the seek publishes, which ends the band.
    show(0);
    channel.handler?.({
      type: "presentation",
      theme: "warm",
      cues: {},
      pinChorus: false,
      bandSize: "part",
    });
    scrollOnce();
    expect(channel.requestSeek).toHaveBeenLastCalledWith(expect.objectContaining({ whole: true }));
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
    // R and U (Repeat, Undo repeat) are plain keys like the rest.
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "u" });
    fireEvent.keyDown(window, { key: "r", repeat: true });
    // Chords stay the browser's; other named keys (Tab, Escape) too.
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(arrow.defaultPrevented).toBe(true);
    expect(channel.forwardKey.mock.calls).toEqual([
      [{ key: "ArrowRight", shiftKey: false, repeat: false }],
      [{ key: " ", shiftKey: true, repeat: false }],
      [{ key: "b", shiftKey: false, repeat: false }],
      [{ key: "r", shiftKey: false, repeat: false }],
      [{ key: "u", shiftKey: false, repeat: false }],
      // A held key says so, so the Operator can ignore the auto-repeat.
      [{ key: "r", shiftKey: false, repeat: true }],
    ]);
  });

  it("sets each part after the first apart with a gap", () => {
    render(() => <Output />);
    show(0);

    expect(screen.getByText("Line 1a")).not.toHaveClass("output-part-start");
    expect(screen.getByText("Line 1b")).not.toHaveClass("output-part-start");
    expect(screen.getByText("Chorus line")).toHaveClass("output-part-start");
  });
});

describe("Output placed on a screen (ADR-0028)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    Reflect.deleteProperty(document, "fullscreenElement");
  });

  it("tries fullscreen when the Operator placed it", async () => {
    window.history.replaceState(null, "", "/?output=1&placed=1");
    const request = vi.fn(async () => {});
    Object.assign(document.documentElement, { requestFullscreen: request });
    render(() => <Output />);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  });

  it("goes fullscreen on the first click, once refused, and only then", async () => {
    window.history.replaceState(null, "", "/?output=1&placed=1");
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("needs a gesture"))
      .mockResolvedValue(undefined);
    Object.assign(document.documentElement, { requestFullscreen: request });
    render(() => <Output />);
    show(0);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("Line 1a"));
    expect(request).toHaveBeenCalledTimes(2);

    // Fullscreen entered: a click is just a click again.
    await new Promise((resolve) => setTimeout(resolve));
    Object.defineProperty(document, "fullscreenElement", {
      value: document.documentElement,
      configurable: true,
    });
    document.dispatchEvent(new Event("fullscreenchange"));
    fireEvent.click(screen.getByText("Line 1a"));
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("goes fullscreen on F, which is not forwarded to the Operator", async () => {
    window.history.replaceState(null, "", "/?output=1&placed=1");
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("needs a gesture"))
      .mockResolvedValue(undefined);
    Object.assign(document.documentElement, { requestFullscreen: request });
    render(() => <Output />);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(window, { key: "f" });

    expect(request).toHaveBeenCalledTimes(2);
    expect(channel.forwardKey).not.toHaveBeenCalled();
  });

  it("leaves clicks and F alone when it was not placed", () => {
    const request = vi.fn(async () => {});
    Object.assign(document.documentElement, { requestFullscreen: request });
    render(() => <Output />);
    show(0);
    fireEvent.keyDown(window, { key: "f" });
    expect(request).not.toHaveBeenCalled();
    expect(channel.forwardKey).toHaveBeenCalledWith(expect.objectContaining({ key: "f" }));
  });
});
