import { describe, expect, it } from "vitest";
import { ariaKeys, keyCaps, keyHint, SHORTCUTS, withKey } from "./keymap.ts";
import { PANES } from "./panes.ts";

describe("keymap", () => {
  it("gives every shortcut a unique id and a key", () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shortcut of SHORTCUTS) expect(shortcut.keys.length).toBeGreaterThan(0);
  });

  it("lists R and U, Repeat and Undo (SDD-0001 §16.5)", () => {
    expect(keyHint("repeat")).toBe("R");
    expect(keyHint("undo-repeat")).toBe("U");
  });

  it("derives a hint from the table: the first key, or the one at an index", () => {
    expect(keyHint("blank")).toBe("B");
    expect(keyHint("next-part")).toBe("→");
    expect(keyHint("lines", 1)).toBe("↑");
    expect(keyHint("text-size", 1)).toBe("−");
  });

  it("derives aria-keyshortcuts in KeyboardEvent names, from the same keys", () => {
    expect(ariaKeys("next-part")).toBe("ArrowRight PageDown Space");
    expect(ariaKeys("previous-part")).toBe("ArrowLeft PageUp Shift+Space");
    expect(ariaKeys("lines", 1)).toBe("ArrowUp");
    expect(ariaKeys("command-menu", 1)).toBe("Control+K");
    expect(ariaKeys("settings")).toBe("Control+,");
    expect(ariaKeys("close")).toBe("Escape");
    // "+" is ARIA's chord delimiter, so the key is spelled "Plus".
    expect(ariaKeys("text-size")).toBe("Plus -");
    expect(ariaKeys("text-size", 0)).toBe("Plus");
    expect(ariaKeys("command-menu")).toBe("/ Control+K");
    expect(ariaKeys("shortcuts")).toBe("?");
    // No display glyph survives into an ARIA value.
    for (const { id } of SHORTCUTS.filter(({ id }) => id !== "stanza")) {
      expect(ariaKeys(id)).not.toMatch(/[→←↑↓−]|Ctrl\b|Esc\b|Page /);
    }
  });

  it("splits a chord into caps, leaving a lone + whole", () => {
    expect(keyCaps("Ctrl+K")).toEqual(["Ctrl", "K"]);
    expect(keyCaps("+")).toEqual(["+"]);
    expect(keyCaps("Shift+Space")).toEqual(["Shift", "Space"]);
  });

  it("adds the key to a tooltip only where there is a keyboard", () => {
    expect(withKey("Repeat this part", "repeat", true)).toBe("Repeat this part (R)");
    expect(withKey("Previous line", "lines", true, 1)).toBe("Previous line (↑)");
    expect(withKey("Repeat this part", "repeat", false)).toBe("Repeat this part");
  });

  it("keeps every pane's key in the table", () => {
    for (const pane of PANES) {
      if (pane.shortcut) expect(keyHint(pane.shortcut)).not.toBe("");
    }
  });
});
