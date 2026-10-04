import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { KeyCombo } from "./KeyCombo.tsx";
import { SHORTCUTS } from "./keymap.ts";

const caps = (container: HTMLElement) =>
  [...container.querySelectorAll("kbd")].map((cap) => cap.textContent);
const pluses = (container: HTMLElement) => container.querySelectorAll(".key-plus").length;

describe("KeyCombo", () => {
  it("draws a lone key as one cap, no plus", () => {
    const { container } = render(() => <KeyCombo keys="K" />);
    expect(caps(container)).toEqual(["K"]);
    expect(pluses(container)).toBe(0);
  });

  it("joins a chord's caps with a plus that belongs to the key style", () => {
    const { container } = render(() => <KeyCombo keys="Ctrl+K" />);
    expect(caps(container)).toEqual(["Ctrl", "K"]);
    expect(pluses(container)).toBe(1);
    const plus = container.querySelector(".key-plus");
    expect(plus).toHaveAttribute("aria-hidden", "true");
    // Between the caps, inside the one combination.
    expect(plus?.parentElement).toHaveClass("key-combo");
  });

  it("keeps a comma and a lone plus as keys", () => {
    const comma = render(() => <KeyCombo keys="Ctrl+," />);
    expect(caps(comma.container)).toEqual(["Ctrl", ","]);
    const plus = render(() => <KeyCombo keys="+" />);
    expect(caps(plus.container)).toEqual(["+"]);
    expect(pluses(plus.container)).toBe(0);
  });

  it("joins every chord in the shortcut table: one plus fewer than its caps", () => {
    for (const shortcut of SHORTCUTS) {
      for (const key of shortcut.keys) {
        const { container, unmount } = render(() => <KeyCombo keys={key} />);
        expect(pluses(container)).toBe(caps(container).length - 1);
        unmount();
      }
    }
  });

  it("can be hidden from assistive tech where the control already says its key", () => {
    const { container } = render(() => <KeyCombo keys="Ctrl+K" decorative class="x" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(container.firstElementChild).toHaveClass("key-combo", "x");
  });
});

describe("the quick switcher's list (styles.css)", () => {
  // The hover layer drifts and blurs past the list's box; as scroll overflow it
  // made scrollbars flicker in and out and the list jump 15px under the
  // pointer (recorded 2026-10-04). Layout is not testable in jsdom, so this
  // pins the rule that keeps the layer out of the scroller.
  it("clips the hover layer so it adds no scroll area to the switcher", () => {
    const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    const rule = /\.present-switcher \[role="listbox"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/overflow:\s*clip/);
  });
});
