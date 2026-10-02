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
});
