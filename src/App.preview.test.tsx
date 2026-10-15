import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mocks, openFinder } from "./App.testkit.tsx";
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

beforeEach(() => {
  mocks.prefs = { preview: true };
});

afterEach(() => {
  mocks.prefs = {};
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("Preview (Board #75, SDD-0001 §16.11)", () => {
  /** Picks a song through the Finder, the way a person would. */
  async function pick(number: string) {
    if (!screen.queryByRole("dialog", { name: "Search" })) {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    }
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song or command" }), {
      target: { value: number },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
  }

  /** A stand-in Output window that records what the Operator publishes. */
  async function liveOutput() {
    render(() => <App />);
    await openFinder();
    await pick("1");
    await screen.findByRole("img", { name: "Live output preview" });
    const output = new BroadcastChannel("hymnal-output");
    const seen: { type: string; number?: number }[] = [];
    output.onmessage = (event) => seen.push(event.data);
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    await waitFor(() => expect(contents(seen)).toHaveLength(1));
    return { output, seen };
  }
  const contents = (seen: { type: string }[]) =>
    seen.filter((m): m is { type: "content"; number: number } => m.type === "content");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  const liveNumber = () =>
    screen
      .getByRole("img", { name: "Live output preview" })
      .querySelector(".output-badge-text") as HTMLElement;

  it("holds a pick back while live: the Output stays, the Preview pane shows it", async () => {
    const { output, seen } = await liveOutput();
    seen.length = 0;
    await pick("3");
    const pane = await screen.findByRole("img", { name: "Preview output preview" });
    expect(within(pane).getByText("First line")).toBeInTheDocument();
    expect(liveNumber()).toHaveTextContent("1");
    await settle();
    expect(contents(seen)).toEqual([]);

    // Another pick replaces it.
    await pick("2");
    await waitFor(() =>
      expect(
        within(screen.getByRole("img", { name: "Preview output preview" })).getByText("A line"),
      ).toBeInTheDocument(),
    );
    expect(liveNumber()).toHaveTextContent("1");
    output.close();
  });

  it("Send makes the waiting song current and live, and Preview is empty again", async () => {
    const { output, seen } = await liveOutput();
    await pick("3");
    await screen.findByRole("img", { name: "Preview output preview" });
    seen.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(contents(seen).at(-1)?.number).toBe(3));
    expect(liveNumber()).toHaveTextContent("3");
    expect(screen.queryByRole("img", { name: "Preview output preview" })).toBeNull();
    expect(screen.getByText("Pick a song to preview it")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    output.close();
  });

  it("Clear drops the waiting song and leaves the Output as it was", async () => {
    const { output, seen } = await liveOutput();
    await pick("3");
    await screen.findByRole("img", { name: "Preview output preview" });
    seen.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() =>
      expect(screen.queryByRole("img", { name: "Preview output preview" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await settle();
    expect(contents(seen)).toEqual([]);
    expect(liveNumber()).toHaveTextContent("1");
    output.close();
  });

  it("goes straight to the Output when not live", async () => {
    render(() => <App />);
    await openFinder();
    await pick("1");
    await screen.findByRole("img", { name: "Live output preview" });
    await pick("3");
    await waitFor(() => expect(liveNumber()).toHaveTextContent("3"));
    expect(screen.queryByRole("img", { name: "Preview output preview" })).toBeNull();
    // Not live, there is no Preview pane at all.
    expect(screen.queryByRole("heading", { name: "Preview" })).toBeNull();
    expect(screen.queryByText("Pick a song to preview it")).toBeNull();
  });

  it("shows the pane only while live: a slim row empty, the song's name when one waits", async () => {
    const { output } = await liveOutput();
    expect(screen.getByRole("heading", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByText("Pick a song to preview it")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    await pick("3");
    await screen.findByRole("img", { name: "Preview output preview" });
    await waitFor(() =>
      expect(document.querySelector(".preview-song")).toHaveTextContent("#3 Mocked Hymn 3"),
    );
    expect(screen.queryByText("Pick a song to preview it")).toBeNull();
    output.close();
  });

  it("Enter sends the waiting song, when nothing focused uses it", async () => {
    const { output, seen } = await liveOutput();
    await pick("3");
    await screen.findByRole("img", { name: "Preview output preview" });
    seen.length = 0;
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(contents(seen).at(-1)?.number).toBe(3));
    expect(liveNumber()).toHaveTextContent("3");
    expect(screen.queryByRole("img", { name: "Preview output preview" })).toBeNull();
    output.close();
  });

  it("leaves Enter to a button, a field or an open sheet that has the focus", async () => {
    const { output, seen } = await liveOutput();
    await pick("3");
    await screen.findByRole("img", { name: "Preview output preview" });
    seen.length = 0;
    // A focused button: Enter is its own.
    fireEvent.keyDown(screen.getByRole("button", { name: "Clear" }), { key: "Enter" });
    // The Finder, open.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = await screen.findByRole("combobox", { name: "Find a song or command" });
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Enter" });
    await settle();
    expect(contents(seen)).toEqual([]);
    expect(liveNumber()).toHaveTextContent("1");
    expect(screen.getByRole("img", { name: "Preview output preview" })).toBeInTheDocument();
    output.close();
  });

  it("sends on Enter pressed in the Output window, whatever the Operator has focused", async () => {
    const { output, seen } = await liveOutput();
    await pick("3");
    await screen.findByRole("img", { name: "Preview output preview" });
    screen.getByRole("button", { name: "Clear" }).focus();
    seen.length = 0;
    output.postMessage({ type: "key", key: "Enter", shiftKey: false, repeat: false });
    await waitFor(() => expect(contents(seen).at(-1)?.number).toBe(3));
    expect(liveNumber()).toHaveTextContent("3");
    output.close();
  });

  it("does nothing on Enter with no song waiting", async () => {
    const { output, seen } = await liveOutput();
    seen.length = 0;
    fireEvent.keyDown(window, { key: "Enter" });
    await settle();
    expect(contents(seen)).toEqual([]);
    expect(liveNumber()).toHaveTextContent("1");
    output.close();
  });

  it("keeps a waiting song through End Live, and the next Go Live opens on it", async () => {
    const { output, seen } = await liveOutput();
    await pick("3");
    await screen.findByRole("img", { name: "Preview output preview" });
    // The Output window closes: no pane while not live, the song still waits.
    output.postMessage({ type: "bye", id: "test-output" });
    await screen.findByRole("button", { name: "Go Live" });
    expect(screen.queryByRole("heading", { name: "Preview" })).toBeNull();
    expect(liveNumber()).toHaveTextContent("1");
    // Send is not offered with no Output to send to, and says why.
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription("Go Live to send it");

    seen.length = 0;
    output.postMessage({ type: "hello", id: "test-output" });
    await screen.findByRole("button", { name: "On Air" });
    await waitFor(() => expect(contents(seen).at(-1)?.number).toBe(3));
    expect(liveNumber()).toHaveTextContent("3");
    expect(screen.getByText("Pick a song to preview it")).toBeInTheDocument();
    output.close();
  });

  it("sends a waiting song as Present Here starts, and then a pick goes live at once", async () => {
    const { output } = await liveOutput();
    await pick("3");
    await screen.findByRole("img", { name: "Preview output preview" });
    output.postMessage({ type: "bye", id: "test-output" });
    await screen.findByRole("button", { name: "Go Live" });
    fireEvent.keyDown(window, { key: "P", shiftKey: true });
    const here = await screen.findByRole("region", { name: "Presenting on this screen" });
    await waitFor(() => expect(here).toHaveTextContent("First line"));

    // Inside Present Here the switcher's pick is the audience's at once: nothing waits.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const switcher = within(await screen.findByRole("search", { name: "Switch song" }));
    const field = switcher.getByRole("combobox", { name: "Find a song" });
    fireEvent.input(field, { target: { value: "1" } });
    fireEvent.submit(field.closest("form") as HTMLFormElement);
    await waitFor(() => expect(here).toHaveTextContent("A line"));
    output.close();
  });

  it("goes straight to the Output with Preview off", async () => {
    mocks.prefs = {};
    const { output } = await liveOutput();
    await pick("3");
    await waitFor(() => expect(liveNumber()).toHaveTextContent("3"));
    expect(screen.queryByText("Preview")).toBeNull();
    expect(screen.getByRole("button", { name: "Hold" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    output.close();
  });

  it("swaps Hold for Send in Live's toolbar, disabled with its reason while nothing waits", async () => {
    const { output } = await liveOutput();
    const toolbar = within(screen.getByRole("toolbar", { name: "Output controls" }));
    const labels = toolbar.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(labels).toHaveLength(3);
    expect(labels[0]).toMatch(/^Blank/);
    expect(labels.slice(1)).toEqual(["Send", "End Live"]);
    expect(toolbar.queryByRole("button", { name: "Hold" })).toBeNull();
    const send = toolbar.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute("title", "Pick a song to preview it");
    expect(send).toHaveAccessibleDescription("Pick a song to preview it");
    await pick("3");
    await screen.findByRole("img", { name: "Preview output preview" });
    expect(toolbar.getByRole("button", { name: "Send" })).toBeEnabled();
    output.close();
  });

  it("does not hold with Shift+H, and offers no Hold command", async () => {
    const { output } = await liveOutput();
    fireEvent.keyDown(window, { key: "H", shiftKey: true });
    await settle();
    expect(screen.getByRole("button", { name: "On Air" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    expect(within(menu).queryByRole("option", { name: /Hold the Output/ })).toBeNull();
    expect(within(menu).getByRole("option", { name: "Turn Preview Off" })).toBeInTheDocument();
    output.close();
  });

  it("keeps Hold until it is released when Preview is turned on while held", async () => {
    mocks.prefs = {};
    const { output } = await liveOutput();
    fireEvent.keyDown(window, { key: "H", shiftKey: true });
    await screen.findByRole("button", { name: "Held" });

    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.mouseDown(within(menu).getByRole("option", { name: "Turn Preview On" }));
    await screen.findByText("Pick a song to preview it");
    const toolbar = within(screen.getByRole("toolbar", { name: "Output controls" }));
    expect(toolbar.getByRole("button", { name: /^Release/ })).toBeInTheDocument();
    expect(toolbar.queryByRole("button", { name: "Send" })).toBeNull();

    fireEvent.click(toolbar.getByRole("button", { name: /^Release/ }));
    await screen.findByRole("button", { name: "On Air" });
    expect(toolbar.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(toolbar.queryByRole("button", { name: "Hold" })).toBeNull();
    output.close();
  });

  it("turns Preview on and off from the command menu", async () => {
    render(() => <App />);
    await openFinder();
    await pick("1");
    await screen.findByRole("img", { name: "Live output preview" });
    mocks.prefs = {};
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    let menu = await screen.findByRole("dialog", { name: "Search" });
    expect(within(menu).queryByRole("option", { name: "Turn Preview On" })).toBeNull();
    fireEvent.mouseDown(within(menu).getByRole("option", { name: "Turn Preview Off" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    fireEvent.keyDown(window, { key: "P", ctrlKey: true, shiftKey: true });
    menu = await screen.findByRole("dialog", { name: "Search" });
    expect(within(menu).getByRole("option", { name: "Turn Preview On" })).toBeInTheDocument();
  });
});
