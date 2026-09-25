import { fireEvent, render, screen } from "@solidjs/testing-library";
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
  document.documentElement.style.removeProperty("--font-scale");
});

describe("Settings", () => {
  it("applies the loaded preferences to the document root", async () => {
    render(() => (
      <Settings
        userState={fakeUserState({
          getPreferences: async () => ({ theme: "dark", fontScale: 1.25, navigator: "parts" }),
        })}
      />
    ));

    expect(await screen.findByRole("radio", { name: "Dark" })).toBeChecked();
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

  it("groups Display, Workspace and Keyboard (DESIGN.md § Structure)", async () => {
    const onShowShortcuts = vi.fn();
    render(() => <Settings userState={fakeUserState()} onShowShortcuts={onShowShortcuts} />);

    for (const name of ["Display", "Workspace", "Keyboard"]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: /Keyboard shortcuts/ }));
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

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(setPreferences).toHaveBeenLastCalledWith({
      theme: "light",
      fontScale: 1,
      navigator: "parts",
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
      navigator: "parts",
    });

    fireEvent.click(screen.getByRole("button", { name: "Decrease text size" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease text size" }));
    expect(setPreferences).toHaveBeenLastCalledWith({
      theme: "system",
      fontScale: 0.875,
      navigator: "parts",
    });
  });

  it("disables the decrease button at the minimum scale", async () => {
    render(() => (
      <Settings
        userState={fakeUserState({
          getPreferences: async () => ({ theme: "system", fontScale: 0.75, navigator: "parts" }),
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
          getPreferences: async () => ({ theme: "system", fontScale: 2, navigator: "parts" }),
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
    expect(screen.getByRole("switch", { name: /Show sidebar/ })).toBeChecked();

    fireEvent.click(live);
    expect(setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ panes: { live: false } }),
    );
  });

  it("sets which navigator leads", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByText("100%");

    fireEvent.click(screen.getByRole("radio", { name: "Lyrics" }));
    expect(setPreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ navigator: "lyrics" }),
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
});
