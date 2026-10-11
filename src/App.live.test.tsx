import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clickGoLive,
  endLiveFromMenu,
  fakeAppTimers,
  mocks,
  openFinder,
  updates,
} from "./App.testkit.tsx";
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

  // A notice sliding away (aria-hidden, .snackbar-leaving) is already put away.
  const noticeText = (pattern: RegExp) =>
    screen.queryAllByText(pattern).filter((el) => !el.closest(".snackbar-leaving")).length;

  /** The Output window obeying End Live: it closes, and its bye follows. */
  const closesOnCommand = (output: BroadcastChannel, seen: unknown[]) => {
    output.onmessage = (event) => {
      seen.push(event.data);
      if ((event.data as { type?: string }).type === "close")
        output.postMessage({ type: "bye", id: "test-output" });
    };
  };

  it("removing the song on the Output is refused while live, and goes through after End Live, clearing it (SDD-0004 §17)", async () => {
    const book = { ...(mocks.rows[0] as BookRow) };
    mocks.rows = [
      book,
      {
        ...book,
        key: "as1",
        origin: "assorted",
        kind: "own",
        title: "Assorted Hymns",
        language: "mul",
        script: "Zyyy",
        songs: 2,
      },
    ];
    mocks.recents = [{ hymnbookId: "as1", hymnNumber: 1, viewedAt: 2 }];
    mocks.assortedLast = false;
    try {
      const { output } = await goLive();
      const seen: unknown[] = [];
      closesOnCommand(output, seen);
      await openFinder();
      fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
        target: { value: "1" },
      });
      fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
      await within(screen.getByRole("navigation", { name: "Hymnbook and song" })).findByRole(
        "button",
        { name: /#1/ },
      );
      const sections = within(screen.getByRole("navigation", { name: "Sections" }));
      fireEvent.click(sections.getByRole("button", { name: "Library" }));
      fireEvent.click(
        await within(await screen.findByRole("list", { name: "Books" })).findByRole("button", {
          name: /^Assorted Hymns/,
        }),
      );
      const sheet = within(await screen.findByRole("dialog", { name: "Assorted Hymns" }));
      fireEvent.click(await sheet.findByRole("button", { name: "Remove Mocked Hymn" }));
      expect(await sheet.findByText(/on the Output now/)).toBeInTheDocument();
      expect(sheet.getByRole("button", { name: "Remove Song" })).toBeDisabled();

      fireEvent.click(sheet.getByRole("button", { name: "End Live" }));
      await waitFor(() => expect(seen).toContainEqual({ type: "close" }));
      await waitFor(() => expect(sheet.getByRole("button", { name: "Remove Song" })).toBeEnabled());
      fireEvent.click(sheet.getByRole("button", { name: "Remove Song" }));
      await waitFor(() =>
        expect(sheet.queryByRole("button", { name: "Remove Song" })).not.toBeInTheDocument(),
      );
      fireEvent.click(sections.getByRole("button", { name: "Present" }));
      expect(await screen.findByRole("combobox", { name: "Find a song" })).toBeInTheDocument();
      output.close();
    } finally {
      mocks.recents = [];
      mocks.assortedLast = true;
    }
  }, 15000);

  it("ends Live by closing the Output window; Go Live opens it again on the same screen, asking nothing", async () => {
    const { output } = await goLive();
    const seen: unknown[] = [];
    closesOnCommand(output, seen);
    const opened = vi.mocked(window.open).mock.calls.length;

    endLiveFromMenu();
    await waitFor(() => expect(seen).toContainEqual({ type: "close" }));
    expect(await screen.findByRole("button", { name: "Go Live" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "On Air" })).not.toBeInTheDocument();
    await clickGoLive();
    await waitFor(() => expect(vi.mocked(window.open).mock.calls.length).toBe(opened + 1));
    // A new window at the Output's URL, placed on the remembered screen.
    const [url, , features] = vi.mocked(window.open).mock.calls[opened];
    expect(String(url)).toContain("placed=1");
    expect(String(features)).toContain(`left=${projector.left}`);
    output.postMessage({ type: "hello", id: "test-output" });
    expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
    output.close();
  });

  it("says the Output stopped working, and Reopen closes the window and opens it again on the same screen (§16.9)", async () => {
    const { output } = await goLive();
    const seen: unknown[] = [];
    closesOnCommand(output, seen);
    const opened = vi.mocked(window.open).mock.calls.length;

    output.postMessage({ type: "failed" });
    const reopen = await screen.findByRole("button", { name: "Reopen" });
    expect(noticeText(/The Output stopped working/)).toBeGreaterThan(0);
    fireEvent.click(reopen);
    await waitFor(() => expect(seen).toContainEqual({ type: "close" }));
    await waitFor(() => expect(vi.mocked(window.open).mock.calls.length).toBe(opened + 1));
    const [url, , features] = vi.mocked(window.open).mock.calls[opened];
    expect(String(url)).toContain("placed=1");
    expect(String(features)).toContain(`left=${projector.left}`);
    await waitFor(() => expect(noticeText(/The Output stopped working/)).toBe(0));
    output.close();
  });

  it("Reopen, when the window never says bye, closes it by its handle and opens a new one; the notice stays until then", async () => {
    const { output, win } = await goLive();
    (win as unknown as { close: () => void }).close = vi.fn();
    const opened = vi.mocked(window.open).mock.calls.length;
    output.postMessage({ type: "failed" });
    const reopen = await screen.findByRole("button", { name: "Reopen" });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(reopen);
      await vi.advanceTimersByTimeAsync(1000);
      // Still waiting on a window that has not answered: the notice stays.
      expect(noticeText(/The Output stopped working/)).toBeGreaterThan(0);
      expect(vi.mocked(window.open).mock.calls.length).toBe(opened);
      await vi.advanceTimersByTimeAsync(700);
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(vi.mocked(window.open).mock.calls.length).toBe(opened + 1));
    expect((win as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
    await waitFor(() => expect(noticeText(/The Output stopped working/)).toBe(0));
    output.close();
  });

  it("holds the update prompt while live, and shows it once End Live has closed the window (#32)", async () => {
    fakeAppTimers();
    const { output } = await goLive();
    const seen: unknown[] = [];
    closesOnCommand(output, seen);
    updates.set(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(noticeText(/Update ready/)).toBe(0);
    endLiveFromMenu();
    await screen.findByRole("button", { name: "Go Live" });
    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => expect(noticeText(/Update ready/)).toBeGreaterThan(0));
    output.close();
    updates.set(false);
  });

  it("does not raise the fullscreen hint for an Output closed before it was due", async () => {
    // The hint is due a moment after the window opens (to see whether it went
    // fullscreen by itself). Closed by then, it would be about a gone window,
    // and would hold the update notice back for its whole stay.
    fakeAppTimers();
    const { output } = await goLive();
    updates.set(true);
    output.postMessage({ type: "bye", id: "test-output" });
    await waitFor(() => expect(noticeText(/Update ready/)).toBeGreaterThan(0));
    // Past the grace the hint waits (FULLSCREEN_GRACE_MS in App.tsx).
    await vi.advanceTimersByTimeAsync(1500);
    expect(noticeText(/The Output is on the projector screen/)).toBe(0);
    expect(noticeText(/Update ready/)).toBeGreaterThan(0);
    output.close();
    updates.set(false);
  });

  it("a blank the Output holds is adopted too, so Restore is offered", async () => {
    const output = new BroadcastChannel("hymnal-output");
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    output.postMessage({ type: "hello", id: "held", state: { blanked: true } });
    expect(await screen.findByRole("button", { name: "Blanked" })).toBeInTheDocument();
    // Restore (B), so the held blank is not left for the next test.
    fireEvent.keyDown(window, { key: "b" });
    expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
    output.close();
  });

  it("ends Live from the keyboard (Shift+E) and from the command list, only while live", async () => {
    const { output } = await goLive();
    const seen: unknown[] = [];
    closesOnCommand(output, seen);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    const option = within(menu).getByRole("option", { name: /End Live/ });
    expect(option.querySelector(".key-combo")?.textContent).toBe("Shift+E");
    fireEvent.mouseDown(option);
    await waitFor(() => expect(seen).toContainEqual({ type: "close" }));
    expect(await screen.findByRole("button", { name: "Go Live" })).toBeInTheDocument();

    // Closed, there is nothing to end: neither the key nor the command.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const again = await screen.findByRole("dialog", { name: "Search" });
    expect(within(again).queryByRole("option", { name: /End Live/ })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await clickGoLive();
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    seen.length = 0;
    // A plain E does nothing; Shift+E ends it.
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyDown(window, { key: "E", shiftKey: true });
    await waitFor(() => expect(seen).toContainEqual({ type: "close" }));
    expect(seen.filter((m) => (m as { type?: string }).type === "close")).toHaveLength(1);
    await screen.findByRole("button", { name: "Go Live" });
    output.close();
  });
});
