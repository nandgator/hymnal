import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickGoLive, fakeAppTimers } from "./App.testkit.tsx";
import App from "./App.tsx";

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

describe("App: the Output on the projector screen (ADR-0028)", () => {
  const laptop = {
    label: "Color LCD",
    width: 1440,
    height: 900,
    left: 0,
    top: 0,
    isPrimary: true,
    isInternal: true,
  };
  const projector = {
    label: "EPSON PJ",
    width: 1280,
    height: 800,
    left: 1440,
    top: 0,
    isPrimary: false,
    isInternal: false,
  };

  /** A fake second screen: the Window Management API Chromium has, and `isExtended`. */
  function attach(screens: object[], reject?: Error) {
    const details = Object.assign(new EventTarget(), {
      screens,
      currentScreen: screens[0],
    });
    const getScreenDetails = vi.fn(async () => {
      if (reject) throw reject;
      return details;
    });
    Object.assign(window, { getScreenDetails });
    Object.defineProperty(window.screen, "isExtended", {
      value: true,
      configurable: true,
    });
    return { details, getScreenDetails };
  }

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, "getScreenDetails");
    Reflect.deleteProperty(window.screen, "isExtended");
    vi.restoreAllMocks();
  });

  /** A popup that moves when told, as far as the test needs. */
  const fakeWindow = () => {
    const win = {
      closed: false,
      focus: vi.fn(),
      screenX: 1440,
      screenY: 0,
      outerWidth: 1280,
      outerHeight: 800,
      document: {},
      moveTo: vi.fn((x: number, y: number) => {
        win.screenX = x;
        win.screenY = y;
      }),
      resizeTo: vi.fn(),
    };
    return win;
  };

  /** Goes live on the projector and has an Output answer, so the App is On Air. */
  async function goLive(screens: object[] = [laptop, projector]) {
    const { details } = attach(screens);
    const win = fakeWindow();
    vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
    await waitFor(() => expect(window.open).toHaveBeenCalled());
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    return { details, win, output };
  }
  const unplug = (details: EventTarget & { screens: unknown }) => {
    (details.screens as object[]).splice(1, 1);
    details.dispatchEvent(new Event("screenschange"));
  };
  const replug = (details: EventTarget & { screens: unknown }) => {
    (details.screens as object[]).push(projector);
    details.dispatchEvent(new Event("screenschange"));
  };
  // A notice sliding away (aria-hidden, .snackbar-leaving) is already put away.
  const noticeText = (pattern: RegExp) =>
    screen.queryAllByText(pattern).filter((el) => !el.closest(".snackbar-leaving")).length;

  it("lets Escape put away every screen notice", async () => {
    // blocked
    vi.spyOn(window, "open").mockReturnValue(null);
    const first = render(() => <App />);
    await clickGoLive();
    await screen.findAllByText(/blocked the Output window/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/blocked the Output window/)).toBe(0));
    first.unmount();
    vi.restoreAllMocks();

    // drag (a plain popup once, with a second screen around)
    Object.defineProperty(window.screen, "isExtended", {
      value: true,
      configurable: true,
    });
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    const second = render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    fireEvent.keyDown(window, { key: "o" });
    await screen.findAllByText(/Drag the Output to the projector/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/Drag the Output to the projector/)).toBe(0));
    second.unmount();
  });

  it("lets Escape put away the fullscreen, gone and back notices", async () => {
    const { details } = await goLive();
    await screen.findAllByText(/press F there/, {}, { timeout: 3000 });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/press F there/)).toBe(0));

    unplug(details as never);
    await screen.findAllByText(/projector was disconnected/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/projector was disconnected/)).toBe(0));

    // Escaping the gone notice leaves it to come back as an offer; Escape on
    // that offer is Stay, and no more is offered.
    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/That screen is back/)).toBe(0));
    unplug(details as never);
    replug(details as never);
    expect(noticeText(/That screen is back/)).toBe(0);
  });

  it("leaves the Output where it is when its screen goes, and offers it back, never jumping", async () => {
    const { details, win } = await goLive();
    unplug(details as never);
    await screen.findAllByText(/projector was disconnected/);
    expect(win.moveTo).not.toHaveBeenCalled();

    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    expect(win.moveTo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Move It" }));
    await waitFor(() => expect(win.moveTo).toHaveBeenCalledWith(1440, 0));
    await waitFor(() => expect(noticeText(/That screen is back/)).toBe(0));
  });

  it("Stay leaves the Output alone", async () => {
    const { details, win } = await goLive();
    unplug(details as never);
    await screen.findAllByText(/projector was disconnected/);
    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(noticeText(/That screen is back/)).toBe(0));
    expect(win.moveTo).not.toHaveBeenCalled();
  });

  it("offers a projector plugged in while live, never moving the Output by itself", async () => {
    const { details, win } = await goLive([laptop]);
    replug(details as never);

    await screen.findAllByText(/A projector is connected: EPSON PJ, 1280×800/);
    expect(win.moveTo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Move the Output There" }));
    await waitFor(() => expect(win.moveTo).toHaveBeenCalledWith(1440, 0));
    await waitFor(() => expect(noticeText(/A projector is connected/)).toBe(0));
  });

  it("where placement was refused, the offer gives the move guidance instead", async () => {
    sessionStorage.setItem("placementRefused", "1");
    try {
      const { details, win } = await goLive([laptop]);
      replug(details as never);
      await screen.findAllByText(/A projector is connected: EPSON PJ/);

      fireEvent.click(screen.getByRole("button", { name: "Move the Output There" }));

      await screen.findAllByText(/Move this window to EPSON PJ, 1280×800, then press F\./);
      expect(win.moveTo).not.toHaveBeenCalled();
    } finally {
      sessionStorage.removeItem("placementRefused");
    }
  });

  it("says nothing about a plugged-in projector when not live", async () => {
    Object.defineProperty(navigator, "permissions", {
      value: { query: async () => ({ state: "granted" }) },
      configurable: true,
    });
    try {
      fakeAppTimers();
      const { details, getScreenDetails } = attach([laptop]);
      render(() => <App />);
      await waitFor(() => expect(getScreenDetails).toHaveBeenCalled());
      replug(details as never);
      await vi.advanceTimersByTimeAsync(700);
      expect(noticeText(/A projector is connected/)).toBe(0);
    } finally {
      Reflect.deleteProperty(navigator, "permissions");
    }
  });

  it("without screen access, a screen appearing is still offered, unnamed", async () => {
    Reflect.deleteProperty(window, "getScreenDetails");
    Object.defineProperty(window.screen, "isExtended", {
      value: false,
      configurable: true,
    });
    // jsdom's Screen is no EventTarget; Chromium's is.
    const target = new EventTarget();
    Object.assign(window.screen, {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    });
    const win = fakeWindow();
    vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    render(() => <App />);
    await clickGoLive();
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });

    Object.defineProperty(window.screen, "isExtended", {
      value: true,
      configurable: true,
    });
    target.dispatchEvent(new Event("change"));

    await screen.findAllByText(/A projector is connected/);
    output.close();
    for (const key of ["addEventListener", "removeEventListener", "dispatchEvent"])
      Reflect.deleteProperty(window.screen, key);
  });

  it("when the Output's screen goes, says where it is now and offers Blank", async () => {
    const { details, win } = await goLive();
    unplug(details as never);

    await screen.findAllByText(
      /The projector was disconnected; the Output is on Built-in, 1440×900/,
    );
    expect(win.moveTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Blank" }));
    await screen.findByRole("button", { name: "Blanked" });
    await waitFor(() => expect(noticeText(/projector was disconnected/)).toBe(0));
    // Blank is held across the tests: restore it.
    fireEvent.keyDown(window, { key: "b" });
    await screen.findByRole("button", { name: "On Air" });
  });

  it("a burst of screen events is one change: a screen that went and came straight back is no news", async () => {
    fakeAppTimers();
    const { details } = await goLive();
    unplug(details as never);
    replug(details as never);
    unplug(details as never);
    replug(details as never);
    await vi.advanceTimersByTimeAsync(700);
    expect(noticeText(/projector was disconnected/)).toBe(0);
    expect(noticeText(/That screen is back/)).toBe(0);
  });

  it("with one screen at Go Live, explains how to extend a mirrored projector", async () => {
    attach([laptop]);
    Object.defineProperty(window.screen, "isExtended", {
      value: false,
      configurable: true,
    });
    Object.defineProperty(navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    try {
      vi.spyOn(window, "open").mockReturnValue({} as Window);
      render(() => <App />);
      await clickGoLive();
      await screen.findAllByText(/connected as a mirror.*Press Win\+P and choose Extend\./);
    } finally {
      Reflect.deleteProperty(navigator, "platform");
    }
  });

  it("says so when the Output cannot be moved", async () => {
    const { details, win } = await goLive();
    unplug(details as never);
    await screen.findAllByText(/projector was disconnected/);
    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    win.moveTo.mockImplementation(() => {});
    win.screenX = 50;
    fireEvent.click(screen.getByRole("button", { name: "Move It" }));
    await screen.findAllByText(/could not move/, {}, { timeout: 5000 });
  });

  it("moves an open Output when a screen is picked in Settings", async () => {
    const monitor = {
      ...projector,
      label: "DELL",
      width: 2560,
      height: 1440,
      left: 2720,
    };
    const { win } = await goLive([laptop, projector, monitor]);
    fireEvent.click(screen.getByRole("button", { name: /^(Settings|Menu)$/ }));
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: /^Output screen/ }));
      expect(screen.getAllByRole("menuitemradio")).toHaveLength(4);
    });

    fireEvent.click(screen.getByRole("menuitemradio", { name: "DELL, 2560×1440" }));

    await waitFor(() => expect(win.moveTo).toHaveBeenCalledWith(2720, 0));
  });

  it("leaves an open Output alone when any other setting changes, never taking it out of fullscreen", async () => {
    // Every preference change re-runs the screen-choice effect; only a change
    // of the chosen screen may move the Output (a move leaves fullscreen).
    fakeAppTimers();
    const { win } = await goLive();
    const exitFullscreen = vi.fn(() => Promise.resolve());
    Object.assign(win.document, { fullscreenElement: {}, exitFullscreen });
    fireEvent.click(screen.getByRole("button", { name: /^(Settings|Menu)$/ }));
    const title = await screen.findByRole("switch", {
      name: /Show song title/,
    });
    fireEvent.click(title);
    await waitFor(() => expect(title).toBeChecked());
    fireEvent.click(await screen.findByRole("switch", { name: /Show song number/ }));
    await vi.advanceTimersByTimeAsync(600);

    expect(exitFullscreen).not.toHaveBeenCalled();
    expect(win.moveTo).not.toHaveBeenCalled();
    expect(win.resizeTo).not.toHaveBeenCalled();
  });

  it("gives no drag hint to a single-screen user, with the API or without it", async () => {
    fakeAppTimers();
    attach([laptop]);
    Object.defineProperty(window.screen, "isExtended", {
      value: false,
      configurable: true,
    });
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    fireEvent.keyDown(window, { key: "o" });
    await waitFor(() => expect(open).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(100);
    expect(noticeText(/Drag the Output to the projector/)).toBe(0);
  });

  it("gives no drag hint where the browser cannot say (Firefox, Safari)", async () => {
    fakeAppTimers();
    Reflect.deleteProperty(window, "getScreenDetails");
    Reflect.deleteProperty(window.screen, "isExtended");
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    await clickGoLive();
    await waitFor(() => expect(open).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(100);
    expect(noticeText(/Drag the Output to the projector/)).toBe(0);
  });

  it("puts a hint away by itself, so it cannot hold the update notice back", async () => {
    fakeAppTimers();
    attach([laptop]);
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
    await screen.findAllByText(/Drag the Output to the projector/);
    // The hint stays its whole stay (HINT_MS in App.tsx), then goes by itself.
    await vi.advanceTimersByTimeAsync(8000);
    await waitFor(() => expect(noticeText(/Drag the Output to the projector/)).toBe(0), {
      timeout: 10000,
    });
  }, 15000);
});
