import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFERENCES, type UserState } from "../persistence/user-state.ts";
import { Settings } from "./Settings.tsx";

function fakeUserState(overrides: Partial<UserState> = {}): UserState {
  return {
    getLastPosition: async () => undefined,
    setLastPosition: async () => {},
    getRecents: async () => [],
    addRecent: async () => {},
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

    const sync = screen.getByRole("switch", { name: /Scrolling the Output moves the Operator/ });
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

  it("defaults the Output to number and hymnbook, fading, refrain unpinned", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByText("100%");

    const presentation = within(screen.getByRole("region", { name: "Presentation" }));
    for (const name of [/song number/, /hymnbook/, /Fade cues/]) {
      expect(presentation.getByRole("switch", { name })).toBeChecked();
    }
    for (const name of [/song title/, /part/, /repeat count/, /Pin the refrain/]) {
      expect(presentation.getByRole("switch", { name })).not.toBeChecked();
    }
    // Turning one on keeps the defaults it started from.
    fireEvent.click(presentation.getByRole("switch", { name: /part/ }));
    expect(setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({
        outputCues: { number: true, hymnbook: true, fade: true, part: true },
      }),
    );
  });
});
