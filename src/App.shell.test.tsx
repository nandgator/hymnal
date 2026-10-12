import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { booksReady, mocks, openFinder } from "./App.testkit.tsx";
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
  it("renders the Library, listing the books held, the current one marked", async () => {
    render(() => <App />);
    expect(await screen.findByRole("heading", { name: "Library" })).toBeInTheDocument();
    const list = within(await screen.findByRole("list", { name: "Books" }));
    const book = list.getByRole("button", { name: /^Mocked Hymnbook/ });
    await waitFor(() => expect(book).toHaveAttribute("aria-current", "true"));
  });

  it("moves to Finder once the user chooses to find a hymn", async () => {
    render(() => <App />);
    await openFinder();
    expect(await screen.findByPlaceholderText("Song number or lyrics")).toBeInTheDocument();
  });

  it("switches sections from the rail: Present, then back to the Library", async () => {
    render(() => <App />);
    await openFinder();
    const sections = within(screen.getByRole("navigation", { name: "Sections" }));
    expect(sections.getByRole("button", { name: "Present" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(sections.getByRole("button", { name: "Library" }));
    expect(await screen.findByRole("heading", { name: "Library" })).toBeInTheDocument();
  });

  it("opens the Presenter once a hymn is picked in Finder", async () => {
    render(() => <App />);
    await openFinder();

    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);

    expect(await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ })).toBeInTheDocument();
  });

  it("hot-swaps to another hymn from the switcher row, staying in the Presenter (SDD-0001 §16.4)", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);

    fireEvent.click(await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ }));
    const picker = within(await screen.findByRole("dialog", { name: "Go to a Song" }));
    fireEvent.input(picker.getByRole("combobox", { name: "Find a song" }), {
      target: { value: "2" },
    });
    fireEvent.submit(picker.getByRole("combobox").closest("form") as HTMLFormElement);

    expect(await screen.findByRole("button", { name: /#2\s*Mocked Hymn 2/ })).toBeInTheDocument();
    // Still presenting: the dock never left the screen.
    expect(screen.getByRole("navigation", { name: "Navigate" })).toBeInTheDocument();
  });

  it("choosing a hymnbook with no hymn up shows one Finder, not a picker over it", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.click(await screen.findByRole("button", { name: /Mocked Hymnbook/ }));
    const books = within(await screen.findByRole("dialog", { name: "Hymnbooks" }));
    fireEvent.click(books.getByRole("button", { name: /Mocked Hymnbook/ }));

    expect(await screen.findAllByRole("combobox", { name: "Find a song" })).toHaveLength(1);
  });

  it("Present with a hymn already up returns to it; the Hymnbooks picker has no Manage Books", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ });

    const sections = within(screen.getByRole("navigation", { name: "Sections" }));
    fireEvent.click(sections.getByRole("button", { name: "Library" }));
    await booksReady();
    fireEvent.click(sections.getByRole("button", { name: "Present" }));
    expect(await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Mocked Hymnbook/ }));
    const books = within(await screen.findByRole("dialog", { name: "Hymnbooks" }));
    // The Library is in the navigation.
    expect(books.queryByRole("button", { name: "Manage Books" })).not.toBeInTheDocument();
  });

  it("opens the Output as a named window, so a second click reuses it", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());

    fireEvent.keyDown(window, { key: "o" });

    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\?output=1$/),
      "hymnal-output",
      "popup",
    );
  });

  it("keeps Go Live off until a book is loaded: the button, the O key and the command menu", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const held = mocks.rows;
    mocks.rows = [];
    try {
      render(() => <App />);
      await screen.findByRole("heading", { name: "Bring a songbook" });
      const goLive = screen.getByRole("button", { name: "Go Live" });
      expect(goLive).toBeDisabled();
      expect(goLive).toHaveAttribute("aria-description", "Load a songbook first");
      fireEvent.keyDown(window, { key: "o" });
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      expect(open).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();
    } finally {
      mocks.rows = held;
    }
  });

  it("enables Go Live once any book is loaded, with no song chosen", async () => {
    render(() => <App />);
    await booksReady();
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Go Live" })).not.toHaveAttribute("aria-description");
  });

  it("renders only the chrome-less Output when loaded with ?output=1", () => {
    window.history.replaceState(null, "", "/?output=1");
    render(() => <App />);

    expect(screen.queryByRole("button", { name: "Go Live" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Display" })).not.toBeInTheDocument();
  });

  it("opens Settings with focus in its search field, also by a swap from the Finder and when reopened", async () => {
    render(() => <App />);
    await booksReady();
    const field = () => screen.getByRole("searchbox", { name: "Search settings" });

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Settings" });
    expect(document.activeElement).toBe(field());

    // Settings to the Finder and back: each lands on its own field.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const finder = await screen.findByRole("dialog", { name: "Search" });
    await waitFor(() => expect(document.activeElement).toBe(within(finder).getByRole("combobox")));
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Settings" });
    await waitFor(() => expect(document.activeElement).toBe(field()));

    // Closed and opened again.
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument(),
    );
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Settings" });
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });

  it("opens the command menu with Ctrl+K or /, and the shortcut sheet with ? (SDD-0001 §16.5)", async () => {
    render(() => <App />);
    // The menu waits for a hymnbook to search.
    await booksReady();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    expect(within(menu).getByRole("option", { name: /Blank the Output/ })).toBeInTheDocument();
    // Ctrl+K again closes it, even from inside its text box.
    fireEvent.keyDown(within(menu).getByRole("combobox"), {
      key: "k",
      ctrlKey: true,
    });
    expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "/" });
    expect(await screen.findByRole("dialog", { name: "Search" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    fireEvent.keyDown(window, { key: "?" });
    const sheet = await screen.findByRole("dialog", {
      name: "Keyboard Shortcuts",
    });
    expect(within(sheet).getByText("Blank the Output / restore")).toBeInTheDocument();
  });

  it("steps with keys pressed in the Output window, even with a sheet open here", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
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
    outputWindow.postMessage({
      type: "key",
      key: "ArrowDown",
      shiftKey: false,
    });
    await waitFor(() => expect(focused()).toBe("true"));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    outputWindow.close();
  });

  it("offers Repeat, then Undo repeat, in the command menu while presenting", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    let menu = await screen.findByRole("dialog", { name: "Search" });
    expect(within(menu).queryByRole("option", { name: /Undo Repeat/ })).not.toBeInTheDocument();
    // Wide enough for two groups (jsdom matches every query): they're offered.
    expect(within(menu).getByRole("option", { name: /Merge the Tabs/ })).toBeInTheDocument();
    fireEvent.mouseDown(within(menu).getByRole("option", { name: /Repeat This Part/ }));
    expect(document.querySelector(".repeat-count")).toHaveTextContent(/^×2/);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    menu = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.mouseDown(within(menu).getByRole("option", { name: /Undo Repeat/ }));
    expect(document.querySelector(".repeat-count")).toBeEmptyDOMElement();
  });

  /** Opens a hymn in the Presenter, the way a person would. */
  async function openHymn() {
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });
  }

  it("shows each action's key in the command menu, from the keymap; Show the details now has none", async () => {
    render(() => <App />);
    await openHymn();
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    const hintOf = (name: RegExp) =>
      within(menu).getByRole("option", { name }).querySelector("kbd")?.textContent;

    expect(hintOf(/Repeat This Part/)).toBe("R");
    expect(hintOf(/Undo Repeat/)).toBe("U");
    expect(hintOf(/Blank the Output/)).toBe("B");
    expect(hintOf(/Text Size Up/)).toBe("+");
    expect(hintOf(/Text Size Down/)).toBe("−");
    expect(hintOf(/Hide Live/)).toBe("L");
    // Occasional actions have no key (SDD-0001 §16.5).
    expect(hintOf(/Show the Details Now/)).toBeUndefined();
    expect(hintOf(/Reading Band/)).toBeUndefined();
    expect(within(menu).queryByRole("option", { name: /Reset Repeat/ })).not.toBeInTheDocument();
  });

  it("lists actions as you type in the command menu, ahead of hymns (SDD-0001 §16.5)", async () => {
    render(() => <App />);
    await openHymn();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    const box = within(menu).getByRole("combobox");

    fireEvent.input(box, { target: { value: "bl" } });
    expect(within(menu).getByRole("option", { name: /Blank the Output/ })).toBeInTheDocument();

    fireEvent.input(box, { target: { value: "open the" } });
    expect(
      within(menu).getByRole("option", { name: /Open the Output Window/ }),
    ).toBeInTheDocument();

    // Cleared, the actions and the book's songs are back.
    fireEvent.input(box, { target: { value: "" } });
    expect(within(menu).getByRole("option", { name: /Blank the Output/ })).toBeInTheDocument();
    expect(within(menu).getByRole("heading", { name: "Songs" })).toBeInTheDocument();
  });

  it("toggles the Output's reading band from the command menu, kept in preferences", async () => {
    render(() => <App />);
    await openHymn();
    const choose = async (name: RegExp) => {
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      const menu = await screen.findByRole("dialog", { name: "Search" });
      fireEvent.mouseDown(within(menu).getByRole("option", { name }));
    };

    await choose(/Reading Band a Line/);
    await choose(/Reading Band a Part/);
    // Back to the default: the menu offers the line again.
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(
      within(await screen.findByRole("dialog", { name: "Search" })).getByRole("option", {
        name: /Reading Band a Line/,
      }),
    ).toBeInTheDocument();
  });

  it("repeats and undoes with R and U pressed in the Output window (SDD-0001 §16.1)", async () => {
    render(() => <App />);
    await openHymn();
    const count = () => document.querySelector(".repeat-count");
    const outputWindow = new BroadcastChannel("hymnal-output");

    outputWindow.postMessage({ type: "key", key: "r", shiftKey: false });
    await waitFor(() => expect(count()).toHaveTextContent(/^×2/));
    outputWindow.postMessage({ type: "key", key: "u", shiftKey: false });
    await waitFor(() => expect(count()).toBeEmptyDOMElement());
    outputWindow.close();
  });

  it("takes a held R or U forwarded from the Output as one press", async () => {
    render(() => <App />);
    await openHymn();
    const count = () => document.querySelector(".repeat-count");
    const outputWindow = new BroadcastChannel("hymnal-output");
    const hold = async (key: string) => {
      outputWindow.postMessage({
        type: "key",
        key,
        shiftKey: false,
        repeat: false,
      });
      for (let i = 0; i < 20; i++) {
        outputWindow.postMessage({
          type: "key",
          key,
          shiftKey: false,
          repeat: true,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    };

    await hold("r");
    await waitFor(() => expect(count()).toHaveTextContent(/^×2/));
    await hold("u");
    await waitFor(() => expect(count()).toBeEmptyDOMElement());
    outputWindow.close();
  });

  it("titles Go live with its key from the keymap", async () => {
    render(() => <App />);
    await booksReady();
    const settings = screen.getByRole("button", { name: "Settings" });
    expect(settings).toHaveAttribute("title", "Settings (Ctrl+,)");
    expect(settings).toHaveAttribute("aria-keyshortcuts", "Control+,");
    const goLive = screen.getByRole("button", { name: "Go Live" });
    expect(goLive).toHaveAttribute("title", "Go Live: present on this screen (Shift+P)");
    expect(goLive).toHaveAttribute("aria-keyshortcuts", "O");
  });

  it("offers Split and Make main only where two tab groups fit (SDD-0001 §16.5)", async () => {
    // 1400px isn't met; every other query is.
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: !query.includes("1400px"),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    expect(within(menu).getByRole("option", { name: /Next Tab/ })).toBeInTheDocument();
    expect(within(menu).queryByRole("option", { name: /the Tabs/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("option", { name: /Main/ })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("blanks the Output with B and restores it with a second press (.)", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
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
    await booksReady();

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const settings = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(within(settings).getByRole("button", { name: /Keyboard Shortcuts/ }));

    const sheet = await screen.findByRole("dialog", {
      name: "Keyboard Shortcuts",
    });
    fireEvent.click(within(sheet).getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Keyboard Shortcuts" })).not.toBeInTheDocument();

    // Opened on its own (?), it just closes.
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    fireEvent.keyDown(window, { key: "?" });
    expect(
      within(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).getByRole(
        "button",
        { name: "Close" },
      ),
    ).toBeInTheDocument();
  });

  it("pushes Keyboard Shortcuts inside the one Settings dialog: Back never closes it", async () => {
    render(() => <App />);
    await booksReady();

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const settings = await screen.findByRole("dialog", { name: "Settings" });
    const opened: boolean[] = [];
    new MutationObserver(() => opened.push(settings.hasAttribute("open"))).observe(settings, {
      attributes: true,
      attributeFilter: ["open"],
    });
    fireEvent.click(within(settings).getByRole("button", { name: /Keyboard Shortcuts/ }));
    expect(settings).toHaveAttribute("aria-label", "Keyboard Shortcuts");
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
    // Escape goes back one level.
    fireEvent(settings, new Event("cancel", { cancelable: true }));
    expect(settings).toHaveAttribute("aria-label", "Settings");
    expect(settings).toHaveAttribute("open");
    await Promise.resolve();
    expect(opened).not.toContain(false);
  });

  it("opens Keyboard Shortcuts from the search as a page of its sheet; Back keeps the query", async () => {
    render(() => <App />);
    await booksReady();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const search = await screen.findByRole("dialog", { name: "Search" });
    const box = within(search).getByRole("combobox");
    fireEvent.input(box, { target: { value: "keyboard" } });
    fireEvent.mouseDown(await within(search).findByRole("option", { name: /Keyboard Shortcuts/ }));

    // The one dialog stays open and slides: no second card, no closed backdrop.
    expect(search).toHaveAttribute("aria-label", "Keyboard Shortcuts");
    expect(search).toHaveAttribute("open");
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
    fireEvent.click(within(search).getByRole("button", { name: "Back" }));
    expect(search).toHaveAttribute("aria-label", "Search");
    expect(search).toHaveAttribute("open");
    expect(within(search).getByRole("combobox")).toHaveValue("keyboard");
  });

  it("opens Settings on its first page, whatever page it was last closed on", async () => {
    render(() => <App />);
    await booksReady();
    const gear = () => screen.getAllByRole("button", { name: /^Settings/ })[0] as HTMLElement;

    // Closed on a page pushed from its row.
    fireEvent.click(gear());
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Settings" })).getByRole("button", {
        name: /Keyboard Shortcuts/,
      }),
    );
    expect(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    fireEvent.click(gear());
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Keyboard Shortcuts" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });

    // Closed on the direct page (?).
    fireEvent.keyDown(window, { key: "?" });
    expect(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    fireEvent.click(gear());
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
  });

  it("hides Live with L, remembered in preferences, and shows it again (SDD-0001 §16.4)", async () => {
    render(() => <App />);
    await openFinder();
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });

    fireEvent.keyDown(window, { key: "l" });
    expect(screen.queryByRole("img", { name: "Live output preview" })).not.toBeInTheDocument();
    // Blanked with Live hidden: On Air, in the switcher row, says so.
    const outputWindow = new BroadcastChannel("hymnal-output");
    outputWindow.postMessage({ type: "hello", id: "test-output" });
    expect(await screen.findByRole("button", { name: "On Air" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByRole("button", { name: "Blanked" }).closest(".switcher-row")).not.toBeNull();
    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByRole("button", { name: "On Air" })).toBeInTheDocument();
    outputWindow.close();

    fireEvent.keyDown(window, { key: "L" });
    expect(screen.getByRole("img", { name: "Live output preview" })).toBeInTheDocument();
  });

  it("replays keys pressed in the Output window, as if pressed here (SDD-0001 §16.1)", async () => {
    render(() => <App />);
    await booksReady();

    const outputWindow = new BroadcastChannel("hymnal-output");
    outputWindow.postMessage({ type: "key", key: "?", shiftKey: true });
    expect(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    outputWindow.close();
  });
});
