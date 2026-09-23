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
          getPreferences: async () => ({ theme: "dark", fontScale: 1.25 }),
        })}
      />
    ));

    await screen.findByText("Theme: dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.25");
  });

  it("clears data-theme for system, deferring to prefers-color-scheme", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(() => <Settings userState={fakeUserState()} />);

    await screen.findByText("Theme: system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("cycles system -> light -> dark -> system and persists each change", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByText("Theme: system");

    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
    expect(await screen.findByText("Theme: light")).toBeInTheDocument();
    expect(setPreferences).toHaveBeenCalledWith({ theme: "light", fontScale: 1 });

    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
    expect(await screen.findByText("Theme: dark")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Theme:/ }));
    expect(await screen.findByText("Theme: system")).toBeInTheDocument();
  });

  it("steps the font scale up and down within bounds", async () => {
    const setPreferences = vi.fn(async () => {});
    render(() => <Settings userState={fakeUserState({ setPreferences })} />);
    await screen.findByText("Theme: system");

    fireEvent.click(screen.getByRole("button", { name: "Increase text size" }));
    expect(setPreferences).toHaveBeenLastCalledWith({ theme: "system", fontScale: 1.125 });

    fireEvent.click(screen.getByRole("button", { name: "Decrease text size" }));
    fireEvent.click(screen.getByRole("button", { name: "Decrease text size" }));
    expect(setPreferences).toHaveBeenLastCalledWith({ theme: "system", fontScale: 0.875 });
  });

  it("disables the decrease button at the minimum scale", async () => {
    render(() => (
      <Settings
        userState={fakeUserState({
          getPreferences: async () => ({ theme: "system", fontScale: 0.75 }),
        })}
      />
    ));
    expect(await screen.findByRole("button", { name: "Decrease text size" })).toBeDisabled();
  });

  it("disables the increase button at the maximum scale", async () => {
    render(() => (
      <Settings
        userState={fakeUserState({
          getPreferences: async () => ({ theme: "system", fontScale: 2 }),
        })}
      />
    ));
    expect(await screen.findByRole("button", { name: "Increase text size" })).toBeDisabled();
  });
});
