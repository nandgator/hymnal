import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.tsx";
import type { ContentStore } from "./persistence/content-store.ts";
import type { UserState } from "./persistence/user-state.ts";

vi.mock("./persistence/content-store.ts", () => {
  const store: ContentStore = {
    ensureInstalled: async () => ({ state: "ready" }),
    getHymnbook: async () => ({
      id: "mal-ymef-athmeeya-geethangal-16",
      title: "Mocked Hymnbook",
      language: "ml",
      script: "Malayalam",
      hymnCount: 1,
    }),
    listHymns: async () => [{ number: 1, title: "Mocked Hymn" }],
    getHymn: async (_hymnbookId, number) => ({
      number,
      title: number === 1 ? "Mocked Hymn" : `Mocked Hymn ${number}`,
      parts: [{ id: "s1", kind: "stanza", lines: ["A line"] }],
      sequence: [{ partId: "s1" }],
      meta: {},
    }),
    searchLyrics: async () => [],
  };
  return { getContentStore: () => store };
});

vi.mock("./persistence/user-state.ts", async (importOriginal) => {
  const userState: UserState = {
    getLastPosition: async () => undefined,
    setLastPosition: async () => {},
    getRecents: async () => [],
    addRecent: async () => {},
    getPreferences: async () => ({ theme: "system", fontScale: 1, navigator: "parts" }),
    setPreferences: async () => {},
  };
  return { ...(await importOriginal<typeof import("./persistence/user-state.ts")>()), userState };
});

describe("App", () => {
  it("renders the Library, wired to the default content store", async () => {
    render(() => <App />);
    expect(await screen.findByRole("heading", { name: "Mocked Hymnbook" })).toBeInTheDocument();
  });

  it("moves to Finder once the user chooses to find a hymn", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));
    expect(await screen.findByPlaceholderText("Hymn number or lyrics")).toBeInTheDocument();
  });

  it("switches sections from the rail: Present, then back to the Library", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));
    const sections = within(screen.getByRole("navigation", { name: "Sections" }));
    expect(sections.getByRole("button", { name: "Present" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(sections.getByRole("button", { name: "Library" }));
    expect(await screen.findByRole("heading", { name: "Mocked Hymnbook" })).toBeInTheDocument();
  });

  it("opens the Presenter once a hymn is picked in Finder", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));

    fireEvent.input(await screen.findByRole("combobox", { name: "Find a hymn" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));

    expect(await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ })).toBeInTheDocument();
  });

  it("hot-swaps to another hymn from the switcher row, staying in the Presenter (SDD-0001 §16.4)", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a hymn" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));

    fireEvent.click(await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ }));
    const picker = within(await screen.findByRole("dialog", { name: "Go to a hymn" }));
    fireEvent.input(picker.getByRole("combobox", { name: "Find a hymn" }), {
      target: { value: "2" },
    });
    fireEvent.click(picker.getByRole("button", { name: "Find" }));

    expect(await screen.findByRole("button", { name: /#2\s*Mocked Hymn 2/ })).toBeInTheDocument();
    // Still presenting: the dock never left the screen.
    expect(screen.getByRole("navigation", { name: "Navigate" })).toBeInTheDocument();
  });

  it("choosing a hymnbook with no hymn up shows one Finder, not a picker over it", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));
    fireEvent.click(await screen.findByRole("button", { name: /Mocked Hymnbook/ }));
    const books = within(await screen.findByRole("dialog", { name: "Hymnbooks" }));
    fireEvent.click(books.getByRole("button", { name: /Mocked Hymnbook/ }));

    expect(await screen.findAllByRole("combobox", { name: "Find a hymn" })).toHaveLength(1);
  });

  it("'Find a hymn' with a hymn already up opens the picker over it", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a hymn" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ });

    const sections = within(screen.getByRole("navigation", { name: "Sections" }));
    fireEvent.click(sections.getByRole("button", { name: "Library" }));
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));

    expect(await screen.findByRole("dialog", { name: "Go to a hymn" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Find a hymn" })).toBeInTheDocument();
  });

  it("opens the Output as a named window, so a second click reuses it", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(() => <App />);

    fireEvent.click(screen.getByRole("button", { name: "Show Output" }));

    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\?output=1$/),
      "hymnal-output",
      "popup",
    );
  });

  it("renders only the chrome-less Output when loaded with ?output=1", () => {
    window.history.replaceState(null, "", "/?output=1");
    render(() => <App />);

    expect(screen.queryByRole("button", { name: "Show Output" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Display" })).not.toBeInTheDocument();
  });

  it("opens the command menu with Ctrl+K or /, and the shortcut sheet with ? (SDD-0001 §16.5)", async () => {
    render(() => <App />);
    // The menu waits for a hymnbook to search.
    await screen.findByRole("button", { name: "Find a hymn" });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Command menu" });
    expect(within(menu).getByRole("option", { name: /Blank the Output/ })).toBeInTheDocument();
    // Ctrl+K again closes it, even from inside its text box.
    fireEvent.keyDown(within(menu).getByRole("combobox"), { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Command menu" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "/" });
    expect(await screen.findByRole("dialog", { name: "Command menu" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    fireEvent.keyDown(window, { key: "?" });
    const sheet = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(within(sheet).getByText("Blank the Output / restore")).toBeInTheDocument();
  });

  it("steps with keys pressed in the Output window, even with a sheet open here", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a hymn" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await screen.findByRole("img", { name: "Live output preview" });
    // The mock hymn has one line: Down gives it line focus.
    const focused = () =>
      screen.getByRole("button", { name: "A line" }).getAttribute("aria-current");

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Settings" });
    // A key typed here still goes to the sheet, not the Operator.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(focused()).toBeNull();

    const outputWindow = new BroadcastChannel("hymnal-output");
    outputWindow.postMessage({ type: "key", key: "ArrowDown", shiftKey: false });
    await waitFor(() => expect(focused()).toBe("true"));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    outputWindow.close();
  });

  it("offers Repeat, then Undo repeat, in the command menu while presenting", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a hymn" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await screen.findByRole("img", { name: "Live output preview" });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    let menu = await screen.findByRole("dialog", { name: "Command menu" });
    expect(within(menu).queryByRole("option", { name: /Undo repeat/ })).not.toBeInTheDocument();
    fireEvent.mouseDown(within(menu).getByRole("option", { name: /Repeat this part/ }));
    expect(document.querySelector(".repeat-count")).toHaveTextContent(/^×2/);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    menu = await screen.findByRole("dialog", { name: "Command menu" });
    fireEvent.mouseDown(within(menu).getByRole("option", { name: /Undo repeat/ }));
    expect(document.querySelector(".repeat-count")).not.toBeInTheDocument();
  });

  it("blanks the Output with B and restores it with a second press (.)", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a hymn" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await screen.findByRole("img", { name: "Live output preview" });

    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByRole("img", { name: "Live output preview" })).toHaveClass("live-blanked");
    fireEvent.keyDown(window, { key: "." });
    expect(screen.getByRole("img", { name: "Live output preview" })).not.toHaveClass(
      "live-blanked",
    );
  });

  it("opens Settings with Ctrl+,; its shortcut sheet goes Back to it, not closed", async () => {
    render(() => <App />);
    await screen.findByRole("button", { name: "Find a hymn" });

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const settings = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(within(settings).getByRole("button", { name: /Keyboard shortcuts/ }));

    const sheet = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).not.toBeInTheDocument();

    // Opened on its own (?), it just closes.
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    fireEvent.keyDown(window, { key: "?" });
    expect(
      within(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).getByRole(
        "button",
        { name: "Close" },
      ),
    ).toBeInTheDocument();
  });

  it("hides Live with L, remembered in preferences, and shows it again (SDD-0001 §16.4)", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a hymn" }));
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a hymn" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    await screen.findByRole("img", { name: "Live output preview" });

    fireEvent.keyDown(window, { key: "l" });
    expect(screen.queryByRole("img", { name: "Live output preview" })).not.toBeInTheDocument();
    // Blanked with Live hidden: the badge sits in the switcher row.
    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByRole("button", { name: /Blanked/ }).closest(".switcher-row")).not.toBeNull();
    fireEvent.keyDown(window, { key: "b" });

    fireEvent.keyDown(window, { key: "L" });
    expect(screen.getByRole("img", { name: "Live output preview" })).toBeInTheDocument();
  });

  it("replays keys pressed in the Output window, as if pressed here (SDD-0001 §16.1)", async () => {
    render(() => <App />);
    await screen.findByRole("button", { name: "Find a hymn" });

    const outputWindow = new BroadcastChannel("hymnal-output");
    outputWindow.postMessage({ type: "key", key: "?", shiftKey: true });
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    outputWindow.close();
  });
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});
