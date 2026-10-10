import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickGoLive } from "./App.testkit.tsx";
import App from "./App.tsx";
import { subscribePlacement } from "./output/channel.ts";

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

  it("asks for the screens on Go live and opens the Output on the projector", async () => {
    const { getScreenDetails } = attach([laptop, projector]);
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));

    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(getScreenDetails).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\?output=1&placed=1&screen=.+EPSON.+$/),
      "hymnal-output",
      "popup,left=1440,top=0,width=1280,height=800",
    );
    // Nothing has verified the window is there (on Wayland it may not be),
    // so the notice says what to do, not that it is done.
    expect(
      (
        await screen.findAllByText(
          /press F there\) to put it on EPSON PJ, 1280×800/,
          {},
          { timeout: 3000 },
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(noticeText(/The Output is on the projector screen/)).toBe(0);
  });

  it("says it is on the projector screen only once the Output reports it verifiably is", async () => {
    const { output } = await goLive();
    output.postMessage({
      type: "placement",
      onTarget: false,
      fullscreen: false,
    });
    await screen.findAllByText(/press F there\) to put it on EPSON PJ/, {}, { timeout: 3000 });
    output.postMessage({ type: "placement", onTarget: true, fullscreen: true });
    await screen.findAllByText(/The Output is on the projector screen\./);
    expect(noticeText(/press F there/)).toBe(0);
    output.close();
  });

  it("tells the Operator how to move the Output when the system cannot place windows", async () => {
    const { output } = await goLiveHoldingGrace();
    await reportPlacement(output, {
      onTarget: false,
      fullscreen: false,
      refused: true,
    });
    await screen.findAllByText(/Move this window to EPSON PJ, 1280×800, then press F\./);
    expect(sessionStorage.getItem("placementRefused")).toBe("1");
    // The grace timer must not replace it with the click hint.
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    vi.useRealTimers();
    expect(noticeText(/press F there/)).toBe(0);
    output.postMessage({
      type: "placement",
      onTarget: true,
      fullscreen: true,
      refused: true,
    });
    await screen.findAllByText(/The Output is on the projector screen\./);
    expect(noticeText(/Move this window/)).toBe(0);
    sessionStorage.clear();
    output.close();
  });

  it("says the Output is fullscreen but its screen unconfirmed, and what to do", async () => {
    const { output } = await goLive();
    output.postMessage({
      type: "placement",
      onTarget: false,
      fullscreen: false,
      refused: true,
    });
    await screen.findAllByText(/Move this window to EPSON PJ/);
    output.postMessage({
      type: "placement",
      onTarget: false,
      fullscreen: true,
      refused: true,
      unconfirmed: true,
    });
    await screen.findAllByText(
      /The Output is fullscreen\. If it isn't on EPSON PJ, 1280×800, press Esc there, move it, and press F again\./,
    );
    expect(noticeText(/The Output is on the projector screen/)).toBe(0);
    sessionStorage.clear();
    output.close();
  });

  it("stays quiet when the Output verified the placement before the grace ran out", async () => {
    const { output } = await goLiveHoldingGrace();
    await reportPlacement(output, { onTarget: true, fullscreen: true });
    await vi.advanceTimersByTimeAsync(GRACE_MS);
    vi.useRealTimers();
    expect(noticeText(/press F there/)).toBe(0);
    expect(noticeText(/The Output is on the projector screen/)).toBe(0);
    output.close();
  });

  it("opens the plain popup, with a one-time drag hint, when the permission is denied", async () => {
    attach([laptop, projector], Object.assign(new Error("no"), { name: "NotAllowedError" }));
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));

    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\?output=1$/),
      "hymnal-output",
      "popup",
    );
    expect((await screen.findAllByText(/Drag the Output to the projector/)).length).toBeGreaterThan(
      0,
    );
  });

  it("opens the plain popup with one screen, without asking", async () => {
    const { getScreenDetails } = attach([laptop]);
    Object.defineProperty(window.screen, "isExtended", {
      value: false,
      configurable: true,
    });
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);

    await clickGoLive();

    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(getScreenDetails).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\?output=1$/),
      "hymnal-output",
      "popup",
    );
  });

  it("says so when the browser blocks the window", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    render(() => <App />);

    await clickGoLive();

    expect((await screen.findAllByText(/blocked the Output window/)).length).toBeGreaterThan(0);
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

  // A notice sliding away (aria-hidden, .snackbar-leaving) is already put away.
  const noticeText = (pattern: RegExp) =>
    screen.queryAllByText(pattern).filter((el) => !el.closest(".snackbar-leaving")).length;

  /**
   * Has the Output report where it is, and resolves once the App has handled
   * it: a subscriber on the App's own channel hears the same message after the
   * App's. Nothing waits a fixed time for it (delivery depends on load).
   */
  const reportPlacement = (output: BroadcastChannel, report: object) =>
    new Promise<void>((resolve) => {
      const unsubscribe = subscribePlacement(() => {
        unsubscribe();
        resolve();
      });
      output.postMessage({ type: "placement", ...report });
    });

  /**
   * Goes live with the placement grace held still, so a loaded machine can't
   * run it out before the test's report arrives; the test then steps past it.
   */
  async function goLiveHoldingGrace() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    return goLive();
  }
  const GRACE_MS = 1200;
});
