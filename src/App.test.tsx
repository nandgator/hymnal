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
    dropRecents: async () => {},
    getPreferences: async () => ({ theme: "system", fontScale: 1 }),
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
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));
    expect(await screen.findByPlaceholderText("Song number or lyrics")).toBeInTheDocument();
  });

  it("switches sections from the rail: Present, then back to the Library", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));

    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);

    expect(await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ })).toBeInTheDocument();
  });

  it("hot-swaps to another hymn from the switcher row, staying in the Presenter (SDD-0001 §16.4)", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));
    fireEvent.click(await screen.findByRole("button", { name: /Mocked Hymnbook/ }));
    const books = within(await screen.findByRole("dialog", { name: "Hymnbooks" }));
    fireEvent.click(books.getByRole("button", { name: /Mocked Hymnbook/ }));

    expect(await screen.findAllByRole("combobox", { name: "Find a song" })).toHaveLength(1);
  });

  it("'Find a Song' with a hymn already up opens the picker over it", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("button", { name: /#1\s*Mocked Hymn/ });

    const sections = within(screen.getByRole("navigation", { name: "Sections" }));
    fireEvent.click(sections.getByRole("button", { name: "Library" }));
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));

    expect(await screen.findByRole("dialog", { name: "Go to a Song" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Find a song" })).toBeInTheDocument();
  });

  it("opens the Output as a named window, so a second click reuses it", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(() => <App />);

    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));

    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\?output=1$/),
      "hymnal-output",
      "popup",
    );
  });

  it("renders only the chrome-less Output when loaded with ?output=1", () => {
    window.history.replaceState(null, "", "/?output=1");
    render(() => <App />);

    expect(screen.queryByRole("button", { name: "Go Live" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Display" })).not.toBeInTheDocument();
  });

  it("opens the command menu with Ctrl+K or /, and the shortcut sheet with ? (SDD-0001 §16.5)", async () => {
    render(() => <App />);
    // The menu waits for a hymnbook to search.
    await screen.findByRole("button", { name: "Find a Song" });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const menu = await screen.findByRole("dialog", { name: "Search" });
    expect(within(menu).getByRole("option", { name: /Blank the Output/ })).toBeInTheDocument();
    // Ctrl+K again closes it, even from inside its text box.
    fireEvent.keyDown(within(menu).getByRole("combobox"), { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "/" });
    expect(await screen.findByRole("dialog", { name: "Search" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });

    fireEvent.keyDown(window, { key: "?" });
    const sheet = await screen.findByRole("dialog", { name: "Keyboard Shortcuts" });
    expect(within(sheet).getByText("Blank the Output / restore")).toBeInTheDocument();
  });

  it("steps with keys pressed in the Output window, even with a sheet open here", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));
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
    outputWindow.postMessage({ type: "key", key: "ArrowDown", shiftKey: false });
    await waitFor(() => expect(focused()).toBe("true"));
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    outputWindow.close();
  });

  it("offers Repeat, then Undo repeat, in the command menu while presenting", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));
    fireEvent.input(await screen.findByRole("combobox", { name: "Find a song" }), {
      target: { value: "1" },
    });
    fireEvent.submit(screen.getByRole("combobox").closest("form") as HTMLFormElement);
    await screen.findByRole("img", { name: "Live output preview" });
  }

  it("shows each action's key in the command menu, from the keymap; Show cues now has none", async () => {
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
    expect(hintOf(/Show Cues Now/)).toBeUndefined();
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

    fireEvent.input(box, { target: { value: "go li" } });
    expect(within(menu).getByRole("option", { name: /Go Live/ })).toBeInTheDocument();

    // Cleared, the actions and Recents are back.
    fireEvent.input(box, { target: { value: "" } });
    expect(within(menu).getByRole("option", { name: /Blank the Output/ })).toBeInTheDocument();
    expect(within(menu).getByRole("heading", { name: "Recents" })).toBeInTheDocument();
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
      outputWindow.postMessage({ type: "key", key, shiftKey: false, repeat: false });
      for (let i = 0; i < 20; i++) {
        outputWindow.postMessage({ type: "key", key, shiftKey: false, repeat: true });
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
    await screen.findByRole("button", { name: "Find a Song" });
    const settings = screen.getByRole("button", { name: "Settings" });
    expect(settings).toHaveAttribute("title", "Settings (Ctrl+,)");
    expect(settings).toHaveAttribute("aria-keyshortcuts", "Control+,");
    const goLive = screen.getByRole("button", { name: "Go Live" });
    expect(goLive).toHaveAttribute("title", "Open the Output (O)");
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
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));
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
    await screen.findByRole("button", { name: "Find a Song" });

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const settings = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(within(settings).getByRole("button", { name: /Keyboard Shortcuts/ }));

    const sheet = await screen.findByRole("dialog", { name: "Keyboard Shortcuts" });
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

  it("hides Live with L, remembered in preferences, and shows it again (SDD-0001 §16.4)", async () => {
    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: "Find a Song" }));
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
    await screen.findByRole("button", { name: "Find a Song" });

    const outputWindow = new BroadcastChannel("hymnal-output");
    outputWindow.postMessage({ type: "key", key: "?", shiftKey: true });
    expect(await screen.findByRole("dialog", { name: "Keyboard Shortcuts" })).toBeInTheDocument();
    outputWindow.close();
  });
});

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
    const details = Object.assign(new EventTarget(), { screens, currentScreen: screens[0] });
    const getScreenDetails = vi.fn(async () => {
      if (reject) throw reject;
      return details;
    });
    Object.assign(window, { getScreenDetails });
    Object.defineProperty(window.screen, "isExtended", { value: true, configurable: true });
    return { details, getScreenDetails };
  }

  afterEach(() => {
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
      expect.stringMatching(/\?output=1&placed=1$/),
      "hymnal-output",
      "popup,left=1440,top=0,width=1280,height=800",
    );
    expect(
      (await screen.findAllByText(/click it or press F/, {}, { timeout: 3000 })).length,
    ).toBeGreaterThan(0);
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
    Object.defineProperty(window.screen, "isExtended", { value: false, configurable: true });
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);

    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));

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
  const unplug = (details: EventTarget & { screens: unknown }) => {
    (details.screens as object[]).splice(1, 1);
    details.dispatchEvent(new Event("screenschange"));
  };
  const replug = (details: EventTarget & { screens: unknown }) => {
    (details.screens as object[]).push(projector);
    details.dispatchEvent(new Event("screenschange"));
  };
  const noticeText = (pattern: RegExp) => screen.queryAllByText(pattern).length;

  it("lets Escape put away every screen notice", async () => {
    // blocked
    vi.spyOn(window, "open").mockReturnValue(null);
    const first = render(() => <App />);
    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
    await screen.findAllByText(/blocked the Output window/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/blocked the Output window/)).toBe(0));
    first.unmount();
    vi.restoreAllMocks();

    // drag (a plain popup once)
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    const second = render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
    await screen.findAllByText(/Drag the Output to the projector/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/Drag the Output to the projector/)).toBe(0));
    second.unmount();
  });

  it("lets Escape put away the fullscreen, gone and back notices", async () => {
    const { details } = await goLive();
    await screen.findAllByText(/click it or press F/, {}, { timeout: 3000 });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/click it or press F/)).toBe(0));

    unplug(details as never);
    await screen.findAllByText(/screen the Output was on is gone/);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(noticeText(/is gone/)).toBe(0));

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
    await screen.findAllByText(/is gone/);
    expect(win.moveTo).not.toHaveBeenCalled();

    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    expect(win.moveTo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Move it" }));
    await waitFor(() => expect(win.moveTo).toHaveBeenCalledWith(1440, 0));
    await waitFor(() => expect(noticeText(/That screen is back/)).toBe(0));
  });

  it("Stay leaves the Output alone", async () => {
    const { details, win } = await goLive();
    unplug(details as never);
    await screen.findAllByText(/is gone/);
    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(noticeText(/That screen is back/)).toBe(0));
    expect(win.moveTo).not.toHaveBeenCalled();
  });

  it("says so when the Output cannot be moved", async () => {
    const { details, win } = await goLive();
    unplug(details as never);
    await screen.findAllByText(/is gone/);
    replug(details as never);
    await screen.findAllByText(/That screen is back/);
    win.moveTo.mockImplementation(() => {});
    win.screenX = 50;
    fireEvent.click(screen.getByRole("button", { name: "Move it" }));
    await screen.findAllByText(/could not move/);
  });

  it("moves an open Output when a screen is picked in Settings", async () => {
    const monitor = { ...projector, label: "DELL", width: 2560, height: 1440, left: 2720 };
    const { win } = await goLive([laptop, projector, monitor]);
    fireEvent.click(screen.getByRole("button", { name: /^(Settings|Menu)$/ }));
    const select = (await screen.findByLabelText("Output screen")) as HTMLSelectElement;
    await screen.findByRole("option", { name: "DELL, 2560×1440" });

    fireEvent.change(select, { target: { value: "2" } });

    await waitFor(() => expect(win.moveTo).toHaveBeenCalledWith(2720, 0));
  });

  it("puts a hint away by itself, so it cannot hold the update notice back", async () => {
    attach([laptop]);
    Object.defineProperty(window.screen, "isExtended", { value: false, configurable: true });
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    render(() => <App />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Go Live" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Go Live" }));
    await screen.findAllByText(/Drag the Output to the projector/);
    await waitFor(() => expect(noticeText(/Drag the Output to the projector/)).toBe(0), {
      timeout: 10000,
    });
  }, 15000);
});
