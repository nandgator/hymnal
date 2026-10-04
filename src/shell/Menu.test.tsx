import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ignoresShortcuts } from "./keymap.ts";
import { Menu } from "./Menu.tsx";

describe("Menu", () => {
  it("folds a lone item into its own button", () => {
    const run = vi.fn();
    render(() => <Menu label="Options" items={[{ label: "Move it", run, icon: "icon-move" }]} />);
    expect(screen.queryByRole("button", { name: "Options" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move it" }));
    expect(run).toHaveBeenCalled();
  });

  it("keeps the list for a lone item when asked, so a row's menu looks the same with one", () => {
    render(() => (
      <Menu label="Options" fold={false} items={[{ label: "Remove…", run: () => {} }]} />
    ));
    fireEvent.click(screen.getByRole("button", { name: "Options" }));
    expect(screen.getByRole("menuitem", { name: "Remove…" })).toBeInTheDocument();
  });

  it("opens a menu of several, moves with arrows, closes on Escape, pausing shortcuts", async () => {
    const second = vi.fn();
    render(() => (
      <Menu
        label="Options"
        items={[
          { label: "First", run: () => {} },
          { label: "Second", run: second },
        ]}
      />
    ));
    const button = screen.getByRole("button", { name: "Options" });
    fireEvent.click(button);
    const menu = screen.getByRole("menu");
    await Promise.resolve();
    expect(screen.getByRole("menuitem", { name: "First" })).toHaveFocus();
    expect(ignoresShortcuts(new KeyboardEvent("keydown", { key: "ArrowRight" }))).toBe(true);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Second" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    fireEvent.click(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "Second" }));
    expect(second).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("a split menu is a chevron button, its rows carrying an icon and their key", () => {
    const run = vi.fn();
    render(() => (
      <Menu
        split
        label="Live options"
        items={[{ label: "End Live", icon: "icon-stop", hint: "Shift+E", run }]}
      />
    ));
    // Even a lone item keeps the list: the chevron is not its own action.
    fireEvent.click(screen.getByRole("button", { name: "Live options" }));
    const item = screen.getByRole("menuitem", { name: /End Live/ });
    expect(item.querySelector(".icon-stop")).not.toBeNull();
    expect(item).toHaveTextContent(/Shift\W*E/);
    fireEvent.click(item);
    expect(run).toHaveBeenCalled();
  });

  it("a choice menu shows the choice, marks it, and opens on the arrow keys", async () => {
    const pick = vi.fn();
    render(() => (
      <Menu
        label="Output screen"
        choice="Automatic"
        items={[
          { label: "Automatic", current: true, run: () => {} },
          { label: "Projector", run: pick },
        ]}
      />
    ));
    const button = screen.getByRole("button", { name: "Output screen: Automatic" });
    expect(button).toHaveTextContent("Automatic");
    fireEvent.keyDown(button, { key: "ArrowDown" });
    await Promise.resolve();
    expect(screen.getByRole("menuitemradio", { name: "Automatic" })).toBeChecked();
    expect(screen.getByRole("menuitemradio", { name: "Automatic" })).toHaveFocus();
    expect(document.querySelector(".hover-glide")).not.toBeNull();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Projector" }));
    expect(pick).toHaveBeenCalled();
  });
});
