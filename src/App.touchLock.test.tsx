import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeAppTimers, mocks, openFinder } from "./App.testkit.tsx";
import App from "./App.tsx";
import { HINT_TEXT, HOLD_MS } from "./shell/touchLock.ts";

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
  mocks.prefs = {};
  mocks.recents = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const pointer = (type: string, pointerType = "touch") => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 200,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
    pointerType: { value: pointerType },
  });
  return event;
};
const withPointer = (el: Element, work: () => void) => {
  el.dispatchEvent(pointer("pointerdown"));
  work();
  el.dispatchEvent(pointer("pointerup"));
};
/** A touch: down, up, then the browser's mouse events and click. */
const tap = (el: Element) => {
  withPointer(el, () => {});
  fireEvent.mouseDown(el, { detail: 1 });
  fireEvent.click(el, { detail: 1 });
};

describe("App: Touch Lock (Board #75, SDD-0001 §16.11)", { timeout: 30_000 }, () => {
  /** Song 3 (two parts) is up, and an Output window is open. */
  async function liveSong() {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song or command" }), {
      target: { value: "3" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });
    const output = new BroadcastChannel("hymnal-output");
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    return output;
  }
  const chip = (name: string) =>
    within(screen.getByRole("region", { name: "Jump to part" })).getByRole("button", { name });

  it("swallows a tap on a part and takes a held press, while live", async () => {
    mocks.prefs = { touchLock: true };
    const output = await liveSong();
    fakeAppTimers();
    expect(chip("1")).toHaveAttribute("aria-pressed", "true");

    tap(chip("2"));
    expect(chip("1")).toHaveAttribute("aria-pressed", "true");
    expect(chip("2")).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelector(".touch-lock-hint")).toHaveTextContent(HINT_TEXT);

    withPointer(chip("2"), () => vi.advanceTimersByTime(HOLD_MS));
    await waitFor(() => expect(chip("2")).toHaveAttribute("aria-pressed", "true"));
    output.close();
  });

  it("lets a key through at once, and Enter on a focused control", async () => {
    mocks.prefs = { touchLock: true };
    const output = await liveSong();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(chip("2")).toHaveAttribute("aria-pressed", "true"));
    // A click no pointer made (detail 0): Enter or Space, or a screen reader.
    fireEvent.click(chip("1"), { detail: 0 });
    await waitFor(() => expect(chip("1")).toHaveAttribute("aria-pressed", "true"));
    output.close();
  });

  it("asks a held press to pick a song from Recents, and Blank and Release", async () => {
    mocks.prefs = { touchLock: true };
    mocks.recents = [
      { hymnbookId: "mal-ymef-athmeeya-geethangal-16", hymnNumber: 1, viewedAt: Date.now() },
    ];
    const output = await liveSong();
    fakeAppTimers();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    await within(dialog).findByRole("button", { name: /Mocked Hymn/ });
    // The list settles as it opens: take the row afresh each time.
    const row = () => within(dialog).getByRole("button", { name: /Mocked Hymn/ });
    tap(row());
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeInTheDocument();

    withPointer(row(), () => vi.advanceTimersByTime(HOLD_MS));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Jump to part" })).toBeInTheDocument(),
    );

    const blank = screen.getByRole("button", { name: /^Blank/ });
    tap(blank);
    expect(blank).toHaveAttribute("aria-pressed", "false");
    withPointer(blank, () => vi.advanceTimersByTime(HOLD_MS));
    await waitFor(() => expect(blank).toHaveAttribute("aria-pressed", "true"));
    output.close();
  });

  it("does nothing while the Output is not live, or with the lock off", async () => {
    mocks.prefs = { touchLock: true };
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song or command" }), {
      target: { value: "3" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });
    // Not live: a plain tap on a part acts.
    tap(chip("2"));
    expect(chip("2")).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).not.toHaveAttribute("data-touch-lock");
  });

  it("is one state: the toolbar toggle and the Settings switch, off at first, marking the header while live", async () => {
    const output = await liveSong();
    const toggle = screen.getByRole("button", { name: "Touch Lock" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(document.documentElement).not.toHaveAttribute("data-touch-lock");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement).toHaveAttribute("data-touch-lock");
    expect(document.querySelector(".live-lock-badge")).not.toBeNull();
    expect(screen.getByRole("button", { name: "On Air" })).toHaveAccessibleDescription(
      "Touch Lock is on",
    );

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const settings = await screen.findByRole("dialog", { name: "Settings" });
    const sw = within(settings).getByRole("switch", { name: /^Touch Lock/ });
    expect(sw).toBeChecked();
    fireEvent.click(sw);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "false"));
    expect(document.documentElement).not.toHaveAttribute("data-touch-lock");
    output.close();
  });
});
