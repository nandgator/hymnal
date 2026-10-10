import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { booksReady, endLiveFromMenu, openFinder } from "./App.testkit.tsx";
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

describe("App", () => {
  /** Opens a hymn in the Presenter, the way a person would. */
  async function openHymn() {
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });
  }

  describe("Hold (Board #21, SDD-0001 §16.6)", () => {
    // A stand-in Output window: records what it is sent, and says hello.
    async function liveOutput() {
      render(() => <App />);
      await openHymn();
      const output = new BroadcastChannel("hymnal-output");
      const seen: {
        type: string;
        held?: boolean;
        focus?: { start: number; end: number };
        repeat?: number;
      }[] = [];
      output.onmessage = (event) => seen.push(event.data);
      output.postMessage({ type: "hello", id: "test-output" });
      await screen.findByRole("button", { name: "On Air" });
      // The replay to this hello has arrived.
      await waitFor(() => expect(contents(seen)).toHaveLength(1));
      return { output, seen };
    }
    // A hello from a new window is answered with a replay: a fence for what
    // came before it, and what a late window is shown. Its content arriving
    // proves everything posted before it has arrived too (one channel keeps
    // order), however long delivery takes; the short settle after it gives
    // anything that would wrongly trail the content a chance to show.
    async function replay(output: BroadcastChannel, seen: { type: string }[], id: string) {
      seen.length = 0;
      output.postMessage({ type: "hello", id });
      await waitFor(() => expect(contents(seen).length).toBeGreaterThan(0));
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const contents = <T extends { type: string }>(seen: T[]) =>
      seen.filter((m) => m.type === "content");

    it("holds with Shift+H: navigation never reaches the Output, a late window gets the held content, and Release sends the current", async () => {
      const { output, seen } = await liveOutput();
      const shown = contents(seen).at(-1)?.repeat;
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      expect(await screen.findByRole("button", { name: "Held" })).toBeInTheDocument();
      const hold = screen.getByRole("button", { name: /^Release/ });
      expect(hold).toHaveAttribute("aria-pressed", "true");
      expect(document.querySelector(".live-held-tag")).not.toBeNull();

      fireEvent.keyDown(window, { key: "r" });
      await replay(output, seen, "late");
      expect(contents(seen)).toHaveLength(1);
      expect(contents(seen)[0]?.repeat).toEqual(shown);

      seen.length = 0;
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
      await waitFor(() => expect(contents(seen)).toHaveLength(1));
      expect(seen.map((m) => m.type).slice(0, 2)).toEqual(["hold", "presentation"]);
      expect(contents(seen)[0]?.repeat).not.toEqual(shown);
      expect(document.querySelector(".live-held-tag")).toBeNull();
      output.close();
    });

    it("is a button beside Blank and a command, only while an Output is open", async () => {
      render(() => <App />);
      await openHymn();
      const hold = () => screen.getByRole("button", { name: "Hold" });
      expect(hold()).toBeDisabled();
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      expect(screen.queryByRole("button", { name: "Held" })).not.toBeInTheDocument();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      let menu = await screen.findByRole("dialog", { name: "Search" });
      expect(within(menu).queryByRole("option", { name: /Hold the Output/ })).toBeNull();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());

      const output = new BroadcastChannel("hymnal-output");
      output.postMessage({ type: "hello", id: "test-output" });
      await screen.findByRole("button", { name: "On Air" });
      expect(hold()).toBeEnabled();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      menu = await screen.findByRole("dialog", { name: "Search" });
      const option = within(menu).getByRole("option", {
        name: /Hold the Output/,
      });
      expect(option.querySelector(".key-combo")?.textContent).toBe("Shift+H");
      fireEvent.mouseDown(option);
      expect(await screen.findByRole("button", { name: "Held" })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      menu = await screen.findByRole("dialog", { name: "Search" });
      expect(within(menu).getByRole("option", { name: /Release the Output/ })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
      // The button beside Blank releases it.
      fireEvent.click(screen.getByRole("button", { name: /^Release/ }));
      expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
      output.close();
    });

    it("says why it is off before Go Live, while Blank arms (Board #57)", async () => {
      render(() => <App />);
      await openHymn();
      const hold = screen.getByRole("button", { name: "Hold" });
      expect(hold).toBeDisabled();
      expect(hold).toHaveAttribute("title", "Go Live to hold what the Output shows");
      expect(hold).toHaveAccessibleDescription("Go Live to hold what the Output shows");

      // Blank is usable before live: it arms, and the Output opens blank.
      const blank = screen.getByRole("button", { name: "Blank" });
      expect(blank).toBeEnabled();
      fireEvent.click(blank);
      expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
      const output = new BroadcastChannel("hymnal-output");
      output.postMessage({ type: "hello", id: "test-output" });
      expect(await screen.findByRole("button", { name: "Blanked" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Hold" })).toBeEnabled();
      fireEvent.keyDown(window, { key: "b" });
      await screen.findByRole("button", { name: "On Air" });
      output.close();
    });

    it("keeps H the highlight toggle, and Blank works on top of Hold", async () => {
      const { output } = await liveOutput();
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      await screen.findByRole("button", { name: "Held" });
      fireEvent.keyDown(window, { key: "b" });
      expect(await screen.findByRole("button", { name: "Blanked" })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "b" });
      expect(await screen.findByRole("button", { name: "Held" })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      await screen.findByRole("button", { name: "On Air" });
      output.close();
    });

    it("keeps the Output on the song while the Operator is in the Library, keys still driving it", async () => {
      const { output, seen } = await liveOutput();
      const sections = within(screen.getByRole("navigation", { name: "Sections" }));
      const repeatShown = () => contents(seen).at(-1)?.repeat;

      seen.length = 0;
      fireEvent.click(sections.getByRole("button", { name: "Library" }));
      await booksReady();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(seen.filter((m) => m.type === "idle")).toEqual([]);

      // A key still drives the Output from the Library while live: R repeats.
      fireEvent.keyDown(window, { key: "r" });
      await waitFor(() => expect(repeatShown()).toBe(2));

      // Back to Present: the song keeps its place, not started over.
      seen.length = 0;
      fireEvent.click(sections.getByRole("button", { name: "Present" }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(seen.filter((m) => m.type === "idle")).toEqual([]);
      expect(contents(seen).every((m) => m.repeat === 2)).toBe(true);
      output.close();
    });

    it("leaves the notice its width in the Library while live: no stage edge from the hidden song", async () => {
      const { output } = await liveOutput();
      const sections = within(screen.getByRole("navigation", { name: "Sections" }));
      fireEvent.click(sections.getByRole("button", { name: "Library" }));
      await booksReady();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(document.documentElement.style.getPropertyValue("--stage-left")).toBe("");
      output.close();
    });

    it("loads a book mid-service without touching the Output", async () => {
      const { output, seen } = await liveOutput();
      fireEvent.keyDown(window, { key: "r" });
      await waitFor(() => expect(contents(seen).at(-1)?.repeat).toBe(2));
      const shown = JSON.stringify(contents(seen).at(-1));
      seen.length = 0;
      const sections = within(screen.getByRole("navigation", { name: "Sections" }));
      fireEvent.click(sections.getByRole("button", { name: "Library" }));
      await booksReady();
      fireEvent.change(screen.getByTestId("book-file"), {
        target: { files: [new File(["x"], "hof.hymnbook.json.gz")] },
      });
      const dialog = within(await screen.findByRole("dialog", { name: "Load Books" }));
      fireEvent.click(dialog.getByRole("button", { name: "Load Book" }));
      await within(screen.getByRole("list", { name: "Books" })).findByRole("button", {
        name: /^Hymns of Fellowship/,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(seen.filter((m) => m.type === "idle")).toEqual([]);
      expect(contents(seen).every((m) => JSON.stringify(m) === shown)).toBe(true);
      expect(screen.getByRole("button", { name: "On Air" })).toBeInTheDocument();
      output.close();
    });

    it("End Live cancels the Hold", async () => {
      const { output, seen } = await liveOutput();
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      await screen.findByRole("button", { name: "Held" });
      endLiveFromMenu();
      output.postMessage({ type: "bye", id: "test-output" });
      await screen.findByRole("button", { name: "Go Live" });
      // The next window opens on the current content, not held.
      await replay(output, seen, "next");
      // A held window would be told so last, after the content.
      expect(seen.at(-1)?.type).toBe("content");
      expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
      output.close();
    });

    it("a reloaded Operator adopts the Hold the Output reports", async () => {
      const output = new BroadcastChannel("hymnal-output");
      render(() => <App />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
      output.postMessage({
        type: "hello",
        id: "held",
        state: { blanked: false, held: {} },
      });
      expect(await screen.findByRole("button", { name: "Held" })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "H", shiftKey: true });
      expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
      output.close();
    });

    it("lists Hold in the shortcut sheet", async () => {
      render(() => <App />);
      await booksReady();
      fireEvent.keyDown(window, { key: "?" });
      const sheet = await screen.findByRole("dialog", {
        name: "Keyboard Shortcuts",
      });
      expect(within(sheet).getByText(/Hold the Output/)).toBeInTheDocument();
    });
  });
});
