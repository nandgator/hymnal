import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mocks, openFinder, updates, view } from "./App.testkit.tsx";
import App from "./App.tsx";
import type { BookRow } from "./persistence/content-store.ts";

vi.mock("./persistence/content-store.ts", async () =>
  (await import("./App.testkit.tsx")).contentStoreMock(),
);
vi.mock("./persistence/user-state.ts", async (importOriginal) =>
  (await import("./App.testkit.tsx")).userStateMock(
    await importOriginal<typeof import("./persistence/user-state.ts")>(),
  ),
);
vi.mock("./shell/updates.ts", async (importOriginal) =>
  (await import("./App.testkit.tsx")).updatesMock(
    await importOriginal<typeof import("./shell/updates.ts")>(),
  ),
);
vi.mock("./output/OutputView.tsx", async (importOriginal) =>
  (await import("./App.testkit.tsx")).outputViewMock(
    await importOriginal<typeof import("./output/OutputView.tsx")>(),
  ),
);

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("App: one-screen presenting (Board #41, SDD-0001 §16.7)", () => {
  const FULLSCREEN = { configurable: true } as const;
  const setFullscreen = (element: Element | null) =>
    Object.defineProperty(document, "fullscreenElement", {
      ...FULLSCREEN,
      value: element,
    });
  let requestFullscreen: ReturnType<typeof vi.fn>;
  let exitFullscreen: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    requestFullscreen = vi.fn(async () => {
      setFullscreen(document.documentElement);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    exitFullscreen = vi.fn(async () => {
      setFullscreen(null);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.assign(document.documentElement, { requestFullscreen });
    Object.assign(document, { exitFullscreen });
  });
  afterEach(() => {
    Reflect.deleteProperty(document.documentElement, "requestFullscreen");
    Reflect.deleteProperty(document, "exitFullscreen");
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(window, "getScreenDetails");
    Reflect.deleteProperty(window.screen, "isExtended");
    mocks.prefs = {};
    vi.restoreAllMocks();
  });

  const notices = (pattern: RegExp) =>
    screen.queryAllByText(pattern).filter((el) => !el.closest(".snackbar-leaving")).length;

  /** Song 3 (two parts) is up in the Presenter. */
  async function songUp() {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "3" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });
  }
  const region = () => screen.queryByRole("region", { name: "Presenting on this screen" });
  const lit = () => region()?.querySelector(".output-line-current")?.textContent;
  async function presentHere() {
    fireEvent.click(await screen.findByRole("button", { name: "Go Live" }));
    await screen.findByRole("region", { name: "Presenting on this screen" });
  }

  it("Go Live presents here when no external screen is known, with no second button in the header", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    await songUp();
    // Present Here lives in Live's toolbar, not beside Go Live.
    expect(screen.getAllByRole("button", { name: /Go Live|On Air/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
    await screen.findByRole("region", { name: "Presenting on this screen" });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("queues the failure snackbar while presenting here, blank, and shows it, without Reopen, once left (§16.9)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const noticeText = (pattern: RegExp) =>
      screen.queryAllByText(pattern).filter((el) => !el.closest(".snackbar-leaving")).length;
    try {
      await songUp();
      view.throws = true;
      fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
      const here = await screen.findByRole("region", {
        name: "Presenting on this screen",
      });
      await waitFor(() => expect(here.textContent).toBe(""));
      expect(noticeText(/The Output stopped working/)).toBe(0);
      fireEvent.keyDown(window, { key: "f" });
      await waitFor(() => expect(region()).toBeNull());
      await waitFor(() => expect(noticeText(/The Output stopped working/)).toBeGreaterThan(0));
      expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
      expect(screen.getByRole("button", { name: "Got It" })).toBeInTheDocument();
    } finally {
      view.throws = false;
    }
  });

  it("Go Live opens the Output window when Window Management shows a second screen", async () => {
    const screens = [
      {
        label: "A",
        width: 1440,
        height: 900,
        left: 0,
        top: 0,
        isPrimary: true,
      },
      { label: "B", width: 1280, height: 800, left: 1440, top: 0 },
    ];
    Object.assign(window, {
      getScreenDetails: async () =>
        Object.assign(new EventTarget(), {
          screens,
          currentScreen: screens[0],
        }),
    });
    Object.defineProperty(window.screen, "isExtended", {
      value: true,
      configurable: true,
    });
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    const goLive = await screen.findByRole("button", { name: "Go Live" });
    await waitFor(() => expect(goLive).toBeEnabled());
    expect(goLive).toHaveAttribute("title", expect.stringContaining("open the Output window"));
    fireEvent.click(goLive);
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(region()).toBeNull();
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  describe("the Go Live opens setting", () => {
    const panels = [
      {
        label: "A",
        width: 1440,
        height: 900,
        left: 0,
        top: 0,
        isPrimary: true,
      },
      { label: "B", width: 1280, height: 800, left: 1440, top: 0 },
    ];
    function externalScreen() {
      Object.assign(window, {
        getScreenDetails: async () =>
          Object.assign(new EventTarget(), {
            screens: panels,
            currentScreen: panels[0],
          }),
      });
      Object.defineProperty(window.screen, "isExtended", {
        value: true,
        configurable: true,
      });
    }
    const cases = [
      { goLive: "auto", external: false, outcome: "here" },
      { goLive: "auto", external: true, outcome: "window" },
      { goLive: "here", external: false, outcome: "here" },
      { goLive: "here", external: true, outcome: "here" },
      { goLive: "window", external: false, outcome: "window" },
      { goLive: "window", external: true, outcome: "window" },
      { goLive: "nonsense", external: true, outcome: "window" },
      { goLive: "nonsense", external: false, outcome: "here" },
    ];
    for (const { goLive, external, outcome } of cases) {
      it(`${goLive} with ${external ? "an external screen" : "one screen"} goes ${outcome}`, async () => {
        mocks.prefs = { goLive };
        if (external) externalScreen();
        const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
        render(() => <App />);
        const button = await screen.findByRole("button", { name: "Go Live" });
        await waitFor(() => expect(button).toBeEnabled());
        // Let the stored setting and the screens load.
        await waitFor(() =>
          expect(button.title).toContain(outcome === "window" ? "Output window" : "this screen"),
        );
        fireEvent.click(button);
        if (outcome === "window") {
          await waitFor(() => expect(open).toHaveBeenCalled());
          expect(region()).toBeNull();
        } else {
          await screen.findByRole("region", {
            name: "Presenting on this screen",
          });
          expect(open).not.toHaveBeenCalled();
        }
      });
    }

    it("leaves O and Shift+P as they are under any setting", async () => {
      mocks.prefs = { goLive: "here" };
      const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
      render(() => <App />);
      const button = await screen.findByRole("button", { name: "Go Live" });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.keyDown(window, { key: "o" });
      await waitFor(() => expect(open).toHaveBeenCalled());
    });
  });

  it("asks the browser for fullscreen on the click and shows the song full-bleed", async () => {
    await songUp();
    await presentHere();
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(lit()).toContain("First line");
  });

  it("is also entered from Shift+P and from the command list", async () => {
    await songUp();
    fireEvent.keyDown(window, { key: "P", shiftKey: true });
    await screen.findByRole("region", { name: "Presenting on this screen" });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(region()).toBeNull());
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const palette = within(await screen.findByRole("dialog", { name: "Search" }));
    fireEvent.input(palette.getByRole("combobox"), {
      target: { value: "present on" },
    });
    fireEvent.mouseDown(await palette.findByRole("option", { name: /Present on This Screen/ }));
    await screen.findByRole("region", { name: "Presenting on this screen" });
    expect(requestFullscreen).toHaveBeenCalledTimes(2);
  });

  it("steps through the song with the keys the Output window forwards", async () => {
    await songUp();
    await presentHere();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(lit()).toContain("Second line"));
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() => expect(lit()).toContain("First line"));
  });

  it("opens the switcher with Ctrl+K, and Enter shows the song at once", async () => {
    await songUp();
    await presentHere();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const switcher = within(await screen.findByRole("search", { name: "Switch song" }));
    const input = switcher.getByRole("combobox", { name: "Find a song" });
    expect(input).toHaveFocus();
    fireEvent.input(input, { target: { value: "1" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(lit()).toContain("A line"));
    expect(screen.queryByRole("search", { name: "Switch song" })).not.toBeInTheDocument();
    // Still presenting, still fullscreen.
    expect(region()).not.toBeNull();
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it("a match from another book, picked in the switcher, shows that song and records its book", async () => {
    const mocked = { ...(mocks.rows[0] as BookRow) };
    mocks.rows = [mocked, { ...mocked, key: "k1", title: "Hymns of Fellowship", addedAt: 2 }];
    mocks.searchAll.mockImplementation(async () => [
      {
        key: "k1",
        title: "Hymns of Fellowship",
        results: [{ number: 2, title: "Own", snippet: "x" }],
      },
    ]);
    try {
      await songUp();
      await presentHere();
      mocks.addRecent.mockClear();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      const switcher = within(await screen.findByRole("search", { name: "Switch song" }));
      fireEvent.input(switcher.getByRole("combobox", { name: "Find a song" }), {
        target: { value: "line" },
      });
      fireEvent.mouseDown(
        within(await switcher.findByRole("group", { name: "Hymns of Fellowship" })).getByRole(
          "option",
        ),
      );
      await waitFor(() => expect(lit()).toContain("A line"));
      await waitFor(() => expect(mocks.addRecent.mock.calls).toEqual([["k1", 2]]));
      expect(region()).not.toBeNull();
    } finally {
      mocks.searchAll.mockImplementation(async () => []);
    }
  });

  it("keeps a digit a stanza jump while presenting, never opening the switcher", async () => {
    await songUp();
    await presentHere();
    fireEvent.keyDown(window, { key: "2" });
    await waitFor(() => expect(lit()).toContain("Second line"));
    expect(screen.queryByRole("search", { name: "Switch song" })).not.toBeInTheDocument();
  });

  it("shows the cursor while the mouse moves and hides it once still, as the Output window does", async () => {
    await songUp();
    await presentHere();
    vi.useFakeTimers();
    try {
      expect(region()).not.toHaveClass("output-cursor");
      window.dispatchEvent(new MouseEvent("mousemove"));
      await vi.advanceTimersByTimeAsync(1999);
      expect(region()).toHaveClass("output-cursor");
      await vi.advanceTimersByTimeAsync(1);
      expect(region()).not.toHaveClass("output-cursor");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the Operator's own keys off the audience's screen: N, L and text size do nothing", async () => {
    await songUp();
    const selected = () =>
      [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map(
        (t) => t.textContent,
      );
    const scale = () => document.documentElement.getAttribute("style");
    await presentHere();
    const tabs = selected();
    const previews = screen.queryAllByRole("img", {
      name: "Live output preview",
    }).length;
    const before = scale();
    for (const key of ["n", "N", "l", "+", "=", "-"]) fireEvent.keyDown(window, { key });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(selected()).toEqual(tabs);
    expect(screen.queryAllByRole("img", { name: "Live output preview" })).toHaveLength(previews);
    expect(scale()).toBe(before);
    expect(region()).not.toBeNull();
  });

  it("says nothing over the audience's screen unasked: no hint where the switcher is", async () => {
    await songUp();
    await presentHere();
    expect(region()?.querySelector(".present-switcher-hint")).toBeNull();
    expect(screen.queryByText(/to switch songs/)).not.toBeInTheDocument();
  });

  it("steps the caption aside while the switcher is open", async () => {
    await songUp();
    await presentHere();
    expect(region()).not.toHaveClass("present-here-switching");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByRole("search", { name: "Switch song" });
    expect(region()).toHaveClass("present-here-switching");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(region()).not.toHaveClass("present-here-switching"));
  });

  it("Esc closes only the switcher when it is open, and leaves when it is not", async () => {
    await songUp();
    await presentHere();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: "Find a song" });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("search", { name: "Switch song" })).not.toBeInTheDocument(),
    );
    expect(region()).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(region()).toBeNull());
    expect(exitFullscreen).toHaveBeenCalled();
  });

  it("leaves with F, and returns to the Operator at the same song and part", async () => {
    await songUp();
    await presentHere();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(lit()).toContain("Second line"));
    fireEvent.keyDown(window, { key: "f" });
    await waitFor(() => expect(region()).toBeNull());
    expect(exitFullscreen).toHaveBeenCalled();
    // The Operator's own Presenter never went away: the same song, the same part.
    expect(screen.getByRole("button", { name: /#3\s*Mocked Hymn 3/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go Live" })).toBeInTheDocument();
  });

  it("leaves when the browser leaves fullscreen by itself (Esc where it is not captured)", async () => {
    await songUp();
    await presentHere();
    setFullscreen(null);
    document.dispatchEvent(new Event("fullscreenchange"));
    await waitFor(() => expect(region()).toBeNull());
  });

  it("shows no notice while presenting, and the queued one after leaving", async () => {
    await songUp();
    await presentHere();
    updates.set(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(notices(/Update ready/)).toBe(0);
    expect(document.querySelector(".snackbar")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(region()).toBeNull());
    await waitFor(() => expect(notices(/Update ready/)).toBeGreaterThan(0));
    updates.set(false);
  });

  it("keeps one live button, of one width, through Go Live, On Air, Held and Blanked", async () => {
    render(() => <App />);
    await screen.findByRole("button", { name: "Go Live" });
    const controls = document.querySelector(".live-controls") as HTMLElement;
    const box = controls.querySelector(".present-button") as HTMLElement;
    // The header's live controls are this one button in every state: no
    // chevron, no menu (End Live is Live's toolbar's). Its width is the
    // class's; the label's room is SwapLabel's.
    const seen = () => {
      expect([...controls.children].filter((el) => !el.matches(".hover-glide"))).toEqual([box]);
      expect(screen.queryByRole("button", { name: "Live options" })).not.toBeInTheDocument();
      expect(document.querySelector(".live-chevron")).toBeNull();
    };
    seen();
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    seen();
    fireEvent.keyDown(window, { key: "H", shiftKey: true });
    await screen.findByRole("button", { name: "Held" });
    seen();
    fireEvent.keyDown(window, { key: "b" });
    await screen.findByRole("button", { name: "Blanked" });
    seen();
    // The label's room is every label's, so the word never resizes the button.
    expect([...box.querySelectorAll(".swap-label-item")].map((item) => item.textContent)).toEqual([
      "Go Live",
      "On Air",
      "Blanked",
      "Held",
    ]);
    fireEvent.keyDown(window, { key: "b" });
    output.postMessage({ type: "bye", id: "test-output" });
    await screen.findByRole("button", { name: "Go Live" });
    seen();
    output.close();
  });

  it("shows the live state's glyph in the header button: broadcasting, a ring when blanked, pause bars when held", async () => {
    render(() => <App />);
    const goLive = await screen.findByRole("button", { name: "Go Live" });
    expect(goLive.querySelector(".icon-present")).not.toBeNull();
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    const onAir = await screen.findByRole("button", { name: "On Air" });
    expect(onAir.querySelector(".icon-sensors")).not.toBeNull();
    fireEvent.keyDown(window, { key: "H", shiftKey: true });
    const held = await screen.findByRole("button", { name: "Held" });
    expect(held.querySelector(".icon-hold")).not.toBeNull();
    expect(held.querySelector(".icon-stop")).toBeNull();
    fireEvent.keyDown(window, { key: "b" });
    const blanked = await screen.findByRole("button", { name: "Blanked" });
    expect(blanked.querySelector(".icon-blank")).not.toBeNull();
    expect(blanked.querySelector(".icon-hold, .icon-sensors")).toBeNull();
    fireEvent.keyDown(window, { key: "b" });
    fireEvent.keyDown(window, { key: "H", shiftKey: true });
    output.postMessage({ type: "bye", id: "test-output" });
    await screen.findByRole("button", { name: "Go Live" });
    output.close();
  });

  it("keeps Present Here in Live's toolbar always, and End Live once an Output window is live, with their keys", async () => {
    await songUp();
    const toolbar = screen.getByRole("toolbar", { name: "Output controls" });
    // Not live: Present Here is there and enabled, End Live waits.
    expect(within(toolbar).getByRole("button", { name: /^Present Here/ })).toBeEnabled();
    expect(within(toolbar).getByRole("button", { name: /^End Live/ })).toBeDisabled();
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    const end = within(toolbar).getByRole("button", { name: /^End Live/ });
    const here = within(toolbar).getByRole("button", { name: /^Present Here/ });
    expect(end).toHaveAttribute("aria-keyshortcuts", "Shift+E");
    expect(here).toHaveAttribute("aria-keyshortcuts", "Shift+P");
    output.close();
  });

  it("presents here from Live's toolbar when not live", async () => {
    await songUp();
    fireEvent.click(screen.getByRole("button", { name: /^Present Here/ }));
    await screen.findByRole("region", { name: "Presenting on this screen" });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("presents here from Live's toolbar once the Output window has closed", async () => {
    await songUp();
    const output = new BroadcastChannel("hymnal-output");
    output.onmessage = (event) => {
      if ((event.data as { type?: string }).type === "close")
        output.postMessage({ type: "bye", id: "test-output" });
    };
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    fireEvent.click(screen.getByRole("button", { name: /^Present Here/ }));
    await screen.findByRole("region", { name: "Presenting on this screen" });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    output.close();
  });

  it("is not offered while an Output window is live", async () => {
    render(() => <App />);
    await screen.findByRole("button", { name: "Go Live" });
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    expect(screen.queryByRole("button", { name: "Go Live" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "P", shiftKey: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(region()).toBeNull();
    expect(requestFullscreen).not.toHaveBeenCalled();
    output.postMessage({ type: "bye", id: "test-output" });
    output.close();
  });
});
