import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES, type UserState } from "../persistence/user-state.ts";
import { createPreferences, Settings } from "./Settings.tsx";

function fakeUserState(overrides: Partial<UserState> = {}): UserState {
  return {
    getLastPosition: async () => undefined,
    setLastPosition: async () => {},
    getRecents: async () => [],
    addRecent: async () => {},
    dropRecents: async () => {},
    getPreferences: async () => DEFAULT_PREFERENCES,
    setPreferences: async () => {},
    ...overrides,
  };
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-output-theme");
  document.documentElement.style.removeProperty("--font-scale");
});

describe("Settings", () => {
  it("applies the loaded preferences to the document root", async () => {
    render(() => (
      <Settings
        userState={fakeUserState({
          getPreferences: async () => ({ theme: "dark", fontScale: 1.25 }),
        })}
      />
    ));

    await screen.findByText("125%");
    const display = within(screen.getByRole("region", { name: "Display" }));
    expect(display.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(screen.getByText("125%")).toBeInTheDocument();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.25");
  });

  it("clears data-theme for system, deferring to prefers-color-scheme", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(() => <Settings userState={fakeUserState()} />);

    expect(await screen.findByRole("radio", { name: "System" })).toBeChecked();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("groups Display, Workspace, Presentation and Keyboard (DESIGN.md § Structure)", async () => {
    const onShowShortcuts = vi.fn();
    render(() => <Settings userState={fakeUserState()} onShowShortcuts={onShowShortcuts} />);

    for (const name of ["Display", "Workspace", "Presentation", "Keyboard"]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /Keyboard Shortcuts/ }));
    expect(onShowShortcuts).toHaveBeenCalled();
  });

  it("leaves out the Keyboard section with nowhere to show shortcuts", () => {
    render(() => <Settings userState={fakeUserState()} />);
    expect(screen.queryByRole("region", { name: "Keyboard" })).not.toBeInTheDocument();
  });

  it("persists a theme choice", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByRole("radio", { name: "System" });

    const display = within(screen.getByRole("region", { name: "Display" }));
    fireEvent.click(display.getByRole("radio", { name: "Light" }));
    expect(setPreferences).toHaveBeenLastCalledWith({
      theme: "light",
      fontScale: 1,
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("steps the font scale up and down within bounds", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByText("100%");

    fireEvent.click(screen.getByRole("button", { name: "Increase text size" }));
    expect(setPreferences).toHaveBeenLastCalledWith({
      theme: "system",
      fontScale: 1.125,
    });

    fireEvent.click(screen.getByRole("button", { name: "Decrease text size" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease text size" }));
    expect(setPreferences).toHaveBeenLastCalledWith({
      theme: "system",
      fontScale: 0.875,
    });
  });

  it("disables the decrease button at the minimum scale", async () => {
    render(() => (
      <Settings
        userState={fakeUserState({
          getPreferences: async () => ({ theme: "system", fontScale: 0.75 }),
        })}
      />
    ));
    await screen.findByText("75%");
    expect(screen.getByRole("button", { name: "Decrease text size" })).toBeDisabled();
  });

  it("disables the increase button at the maximum scale", async () => {
    render(() => (
      <Settings
        userState={fakeUserState({
          getPreferences: async () => ({ theme: "system", fontScale: 2 }),
        })}
      />
    ));
    await screen.findByText("200%");
    expect(screen.getByRole("button", { name: "Increase text size" })).toBeDisabled();
  });

  it("shows each pane by default and remembers hiding one (SDD-0001 §16.4)", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByText("100%");

    const live = screen.getByRole("switch", { name: /Show Live/ });
    expect(live).toBeChecked();

    fireEvent.click(live);
    expect(setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ panes: { live: false } }),
    );
  });

  it("searches its settings, hiding what doesn't match and empty sections", async () => {
    render(() => <Settings userState={fakeUserState()} />);
    await screen.findByText("100%");

    fireEvent.input(screen.getByRole("searchbox", { name: "Search settings" }), {
      target: { value: "split" },
    });
    expect(screen.getByRole("switch", { name: /Split the tabs/ })).toBeVisible();
    expect(screen.getByText(/^Show Live/).closest(".settings-row")).not.toBeVisible();
    expect(screen.getByText("Presentation").closest("section")).not.toBeVisible();

    fireEvent.input(screen.getByRole("searchbox", { name: "Search settings" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(/No settings match/)).toBeInTheDocument();
  });

  it("search skips a setting inside a closed disclosure, and follows the layout as it changes", async () => {
    render(() => <Settings userState={fakeUserState()} />);
    await screen.findByText("100%");
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    const pin = () => screen.getByText("Pin the chorus").closest(".settings-row");
    // The search hides the Layout row itself ("pin" is not in it): reach it hidden.
    const layoutChoice = (name: string) =>
      within(screen.getByRole("group", { name: "Layout", hidden: true })).getByRole("radio", {
        name,
        hidden: true,
      });

    // Part by part (the default) opens "Pin the chorus".
    fireEvent.input(search, { target: { value: "pin" } });
    expect(pin()).toBeVisible();

    // Whole song closes it: the search still active, it drops out.
    fireEvent.click(layoutChoice("Whole song"));
    expect(pin()).not.toBeVisible();

    // And back: it returns.
    fireEvent.click(layoutChoice("Part by part"));
    expect(pin()).toBeVisible();
  });

  it("splits or merges the tab groups (SDD-0001 §16.4)", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByText("100%");

    const split = screen.getByRole("switch", { name: /Split the tabs/ });
    expect(split).toBeChecked();
    fireEvent.click(split);
    expect(setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ workspace: expect.objectContaining({ split: false }) }),
    );
  });

  it("has scroll sync on by default, and remembers turning it off (SDD-0001 §16.1)", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByText("100%");

    const sync = screen.getByRole("switch", { name: /Scrolling the Output moves this screen/ });
    expect(sync).toBeChecked();
    fireEvent.click(sync);
    expect(setPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ scrollSync: false }));
  });

  it("gives the Output its own theme, Warm by default (DESIGN.md § Output view)", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByText("100%");

    const presentation = within(screen.getByRole("region", { name: "Presentation" }));
    expect(presentation.getByRole("radio", { name: "Warm" })).toBeChecked();
    expect(document.documentElement.getAttribute("data-output-theme")).toBe("warm");

    fireEvent.click(presentation.getByRole("radio", { name: "Contrast" }));
    expect(setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ outputTheme: "contrast" }),
    );
    expect(document.documentElement.getAttribute("data-output-theme")).toBe("contrast");
    // The Operator's own theme is untouched.
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("defaults the Output to number and hymnbook, fading, chorus unpinned", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByText("100%");

    const presentation = within(screen.getByRole("region", { name: "Presentation" }));
    for (const name of [/song number/, /hymnbook/, /Show parts/, /Fade the details/]) {
      expect(presentation.getByRole("switch", { name })).toBeChecked();
    }
    for (const name of [/song title/, /repeat count/, /Pin the chorus/]) {
      expect(presentation.getByRole("switch", { name })).not.toBeChecked();
    }
    // Turning one on keeps the defaults it started from.
    fireEvent.click(presentation.getByRole("switch", { name: /song title/ }));
    expect(setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({
        outputCues: { number: true, hymnbook: true, fade: true, part: true, title: true },
      }),
    );
  });

  it("has one Show parts, on unless chosen otherwise, and no Part labels", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByText("100%");
    const presentation = within(screen.getByRole("region", { name: "Presentation" }));
    expect(presentation.queryByRole("switch", { name: /Part labels|Show part\b/ })).toBeNull();
    const toggle = presentation.getByRole("switch", { name: /Show parts/ });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ outputCues: expect.objectContaining({ part: false }) }),
    );
  });

  describe("a setting that applies only under another says so by structure", () => {
    const open = (el: HTMLElement) => el.closest(".settings-disclosure")?.getAttribute("data-open");

    const layout = (presentation: ReturnType<typeof within>) =>
      within(presentation.getByRole("group", { name: "Layout" }));

    it("chooses the layout, and only Part by part shows Pin the chorus, keeping its value", async () => {
      const setPreferences = vi.fn(async () => {});
      render(() => (
        <Settings
          userState={fakeUserState({
            setPreferences,
            getPreferences: async () => ({ ...DEFAULT_PREFERENCES, pinChorus: true }),
          })}
        />
      ));
      await screen.findByText("100%");
      const presentation = within(screen.getByRole("region", { name: "Presentation" }));
      expect(layout(presentation).getByRole("radio", { name: "Part by part" })).toBeChecked();
      const pin = presentation.getByRole("switch", { name: /Pin the chorus/ });
      const sync = presentation.getByRole("switch", { name: /Scrolling the Output moves/ });
      const band = presentation.getByRole("group", { name: "Highlight while scrolling" });
      for (const el of [pin, sync, band]) expect(open(el)).toBe("true");
      fireEvent.click(layout(presentation).getByRole("radio", { name: "Whole song" }));
      for (const el of [pin, sync, band]) {
        expect(open(el)).toBe("false");
        expect(el.closest(".settings-disclosure")).toHaveAttribute("inert");
      }
      // Hidden, not reset; and Whole song shows nothing of its own.
      expect(setPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ wholeSong: true, pinChorus: true }),
      );
      expect(presentation.getByRole("switch", { name: /Show song number/ })).toBeVisible();
      fireEvent.click(layout(presentation).getByRole("radio", { name: "Part by part" }));
      expect(setPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ wholeSong: false, pinChorus: true }),
      );
      expect(open(pin)).toBe("true");
      expect(pin).toBeChecked();
    });

    it("reflects a layout changed elsewhere (the command menu, a key)", async () => {
      const controller = createPreferences(fakeUserState());
      render(() => <Settings controller={controller} />);
      await screen.findByText("100%");
      const presentation = within(screen.getByRole("region", { name: "Presentation" }));
      controller.update({ ...controller.preferences(), wholeSong: true });
      expect(layout(presentation).getByRole("radio", { name: "Whole song" })).toBeChecked();
      expect(open(presentation.getByRole("switch", { name: /Pin the chorus/, hidden: true }))).toBe(
        "false",
      );
    });

    it("is a native radio group, so the arrow keys move it (checked in Chromium)", async () => {
      render(() => <Settings userState={fakeUserState()} />);
      await screen.findByText("100%");
      const presentation = within(screen.getByRole("region", { name: "Presentation" }));
      // jsdom has no arrow-key navigation: what the browser needs is one
      // name across both radios in a labelled group, one of them checked.
      const radios = layout(presentation).getAllByRole("radio") as HTMLInputElement[];
      expect(radios.map((radio) => radio.labels?.[0]?.textContent?.trim())).toEqual([
        "Part by part",
        "Whole song",
      ]);
      expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
      expect(radios.filter((radio) => radio.checked)).toHaveLength(1);
      expect(radios.every((radio) => radio.tabIndex !== -1)).toBe(true);
    });

    it("shows the fade switch only while some cue is on, keeping its value", async () => {
      render(() => (
        <Settings
          userState={fakeUserState({
            getPreferences: async () => ({
              ...DEFAULT_PREFERENCES,
              outputCues: { number: true, fade: true },
            }),
          })}
        />
      ));
      await screen.findByText("100%");
      const presentation = within(screen.getByRole("region", { name: "Presentation" }));
      const fade = presentation.getByRole("switch", { name: /Fade the details/ });
      expect(open(fade)).toBe("true");
      fireEvent.click(presentation.getByRole("switch", { name: /song number/ }));
      expect(open(fade)).toBe("false");
      expect(fade).toBeChecked();
      fireEvent.click(presentation.getByRole("switch", { name: /song title/ }));
      expect(open(fade)).toBe("true");
    });
  });

  it("sets the Output's reading band, a part unless chosen otherwise", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByText("100%");

    const presentation = within(screen.getByRole("region", { name: "Presentation" }));
    const band = within(presentation.getByRole("group", { name: "Highlight while scrolling" }));
    expect(band.getByRole("radio", { name: "Part" })).toBeChecked();
    fireEvent.click(band.getByRole("radio", { name: "Line" }));
    expect(setPreferences).toHaveBeenLastCalledWith(expect.objectContaining({ bandSize: "line" }));
    expect(band.getByRole("radio", { name: "Line" })).toBeChecked();
  });

  it("puts the text-size keys in its tooltips, derived from the keymap", async () => {
    render(() => <Settings userState={fakeUserState()} />);
    await screen.findByText("100%");
    expect(screen.getByRole("button", { name: "Decrease text size" })).toHaveAttribute(
      "title",
      "Decrease text size (−)",
    );
    expect(screen.getByRole("button", { name: "Decrease text size" })).toHaveAttribute(
      "aria-keyshortcuts",
      "-",
    );
    expect(screen.getByRole("button", { name: "Increase text size" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Plus",
    );
    expect(screen.getByRole("button", { name: "Increase text size" })).toHaveAttribute(
      "title",
      "Increase text size (+)",
    );
  });
});

describe("Settings: Output screen (ADR-0028)", () => {
  const panel = {
    label: "Color LCD",
    width: 1440,
    height: 900,
    left: 0,
    top: 0,
    isPrimary: true,
    isInternal: true,
  };
  const projector = {
    ...panel,
    label: "EPSON PJ",
    width: 1280,
    height: 800,
    isPrimary: false,
    isInternal: false,
  };

  function attach(screens: object[], reject?: Error) {
    const details = Object.assign(new EventTarget(), { screens, currentScreen: screens[0] });
    const getScreenDetails = vi.fn(async () => {
      if (reject) throw reject;
      return details;
    });
    Object.assign(window, { getScreenDetails });
    return { details, getScreenDetails };
  }
  afterEach(() => Reflect.deleteProperty(window, "getScreenDetails"));

  it("is left out where the browser has no Window Management API", () => {
    render(() => <Settings userState={fakeUserState()} />);
    expect(screen.queryByLabelText("Output screen")).not.toBeInTheDocument();
  });

  const choice = () => screen.getByRole("button", { name: /^Output screen/ });
  const options = () => screen.getAllByRole("menuitemradio").map((item) => item.textContent);

  it("lists Automatic, then the screens after Detect screens, built-in named as such", async () => {
    const { getScreenDetails } = attach([panel, projector]);
    render(() => <Settings userState={fakeUserState()} />);
    await screen.findByRole("button", { name: "Detect screens" });
    expect(choice()).toHaveTextContent("Automatic");
    expect(getScreenDetails).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Detect screens" }));

    await vi.waitFor(() => expect(getScreenDetails).toHaveBeenCalled());
    fireEvent.click(choice());
    await screen.findByRole("menuitemradio", { name: "EPSON PJ, 1280×800" });
    expect(options()).toEqual(["Automatic", "Built-in, 1440×900", "EPSON PJ, 1280×800"]);
    expect(screen.getByRole("menuitemradio", { name: "Automatic" })).toBeChecked();
  });

  it("stores the pick by label and size, and Automatic clears it", async () => {
    attach([panel, projector]);
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Detect screens" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /^Output screen/ })).toBeTruthy(),
    );
    await vi.waitFor(() => {
      fireEvent.click(choice());
      expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    });

    fireEvent.click(screen.getByRole("menuitemradio", { name: "EPSON PJ, 1280×800" }));
    expect(setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ outputScreen: { label: "EPSON PJ", width: 1280, height: 800 } }),
    );
    await vi.waitFor(() => expect(choice()).toHaveTextContent("EPSON PJ, 1280×800"));

    fireEvent.click(choice());
    expect(screen.getByRole("menuitemradio", { name: "EPSON PJ, 1280×800" })).toBeChecked();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Automatic" }));
    expect((setPreferences.mock.lastCall as unknown[] | undefined)?.[0]).not.toHaveProperty(
      "outputScreen",
    );
  });

  it("is keyboard operable: arrows move, Enter picks, Escape closes", async () => {
    attach([panel, projector]);
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Detect screens" }));
    await vi.waitFor(() => {
      fireEvent.click(choice());
      expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    });
    await Promise.resolve();
    const menu = screen.getByRole("menu");
    expect(screen.getByRole("menuitemradio", { name: "Automatic" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitemradio", { name: "EPSON PJ, 1280×800" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(choice()).toHaveFocus();
    expect(setPreferences).not.toHaveBeenCalled();
  });

  it("keeps a remembered screen that is not attached in the list, marked", async () => {
    attach([panel]);
    render(() => (
      <Settings
        userState={fakeUserState({
          getPreferences: async () => ({
            ...DEFAULT_PREFERENCES,
            outputScreen: { label: "EPSON PJ", width: 1280, height: 800 },
          }),
        })}
      />
    ));
    await vi.waitFor(() =>
      expect(choice()).toHaveTextContent("EPSON PJ, 1280×800 (not connected)"),
    );
    fireEvent.click(choice());
    expect(
      screen.getByRole("menuitemradio", { name: "EPSON PJ, 1280×800 (not connected)" }),
    ).toBeChecked();
  });

  it("explains a blocked permission", async () => {
    attach([panel, projector], Object.assign(new Error("no"), { name: "NotAllowedError" }));
    render(() => <Settings userState={fakeUserState()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Detect screens" }));
    expect(await screen.findByText(/blocked screen access/)).toBeInTheDocument();
  });

  it("follows screenschange, offering no list for one screen", async () => {
    const { details } = attach([panel]);
    render(() => <Settings userState={fakeUserState()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Detect screens" }));
    await screen.findByText("One screen attached");
    expect(screen.queryByRole("button", { name: /^Output screen/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detect screens" })).toBeInTheDocument();

    (details.screens as object[]).push(projector);
    details.dispatchEvent(new Event("screenschange"));

    await vi.waitFor(() => expect(choice()).toBeInTheDocument());
    fireEvent.click(choice());
    expect(
      await screen.findByRole("menuitemradio", { name: "EPSON PJ, 1280×800" }),
    ).toBeInTheDocument();
  });

  it("explains how to extend only once Detect screens finds one screen", async () => {
    attach([panel]);
    Object.defineProperty(navigator, "platform", { value: "Win32", configurable: true });
    try {
      render(() => <Settings userState={fakeUserState()} />);
      await screen.findByRole("button", { name: "Detect screens" });
      expect(screen.queryByText(/Win\+P/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Detect screens" }));

      expect(await screen.findByText(/Press Win\+P and choose Extend\./)).toBeInTheDocument();
      expect(screen.getByText(/connected as a mirror/)).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, "platform");
    }
  });
});
