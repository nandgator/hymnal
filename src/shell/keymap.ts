/**
 * The keyboard shortcuts, as data (SDD-0001 §16.5): the `?` sheet renders
 * this table, and the command menu's hints, every tooltip and every
 * `aria-keyshortcuts` are derived from it, so they can't disagree. Handling
 * is split: the shell owns the keys that work on every screen, the Presenter
 * the ones that move its engine, and N.
 */
export interface Shortcut {
  id: ShortcutId;
  /** Each entry is one key or chord, as shown to the user. */
  keys: string[];
  label: string;
}

export type ShortcutId =
  | "next-part"
  | "previous-part"
  | "lines"
  | "first-last"
  | "stanza"
  | "chorus"
  | "repeat"
  | "undo-repeat"
  | "blank"
  | "hold"
  | "output"
  | "end-live"
  | "present-here"
  | "leave-present"
  | "tab"
  | "live"
  | "highlight"
  | "command-menu"
  | "text-size"
  | "shortcuts"
  | "settings"
  | "close";

export const SHORTCUTS: Shortcut[] = [
  { id: "next-part", keys: ["→", "Page Down", "Space"], label: "Next part" },
  { id: "previous-part", keys: ["←", "Page Up", "Shift+Space"], label: "Previous part" },
  { id: "lines", keys: ["↓", "↑"], label: "Next / previous line" },
  { id: "first-last", keys: ["Home", "End"], label: "First / last part" },
  { id: "stanza", keys: ["1–9"], label: "Stanza n (two digits: type both quickly)" },
  { id: "chorus", keys: ["C"], label: "Chorus" },
  { id: "repeat", keys: ["R"], label: "Repeat this part" },
  { id: "undo-repeat", keys: ["U"], label: "Undo the last repeat" },
  { id: "blank", keys: ["B", "."], label: "Blank the Output / restore" },
  { id: "hold", keys: ["Shift+H"], label: "Hold the Output on what it shows / release" },
  { id: "output", keys: ["O"], label: "Go live: open the Output, or bring it forward" },
  { id: "end-live", keys: ["Shift+E"], label: "End Live: close the Output window" },
  { id: "present-here", keys: ["Shift+P"], label: "Present on this screen, full screen" },
  { id: "leave-present", keys: ["F", "Esc"], label: "Leave presenting on this screen" },
  { id: "tab", keys: ["N"], label: "Next tab" },
  { id: "live", keys: ["L"], label: "Show or hide the Live preview" },
  { id: "highlight", keys: ["H"], label: "Light the whole song / only the current part" },
  { id: "command-menu", keys: ["/", "Ctrl+K"], label: "Search songs and actions" },
  { id: "text-size", keys: ["+", "−"], label: "Text size" },
  { id: "shortcuts", keys: ["?"], label: "Keyboard shortcuts" },
  { id: "settings", keys: ["Ctrl+,"], label: "Settings" },
  { id: "close", keys: ["Esc"], label: "Close a sheet or menu" },
];

/**
 * The key shown for a shortcut, e.g. "B". Its first key, or the one at
 * `index` where a row holds a pair of controls' keys: ↓ ↑ are Next line and
 * Previous line, + − Text size up and down.
 */
export function keyHint(id: ShortcutId, index = 0): string {
  return SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys[index] ?? "";
}

/** A key's caps: "Ctrl+K" is two, a lone "+" stays one. */
export const keyCaps = (key: string): string[] => key.split(/\+(?=.)/);

/** Display names that differ from `KeyboardEvent.key`, which ARIA uses. */
const ARIA_NAMES: Record<string, string> = {
  "→": "ArrowRight",
  "←": "ArrowLeft",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "Page Down": "PageDown",
  "Page Up": "PageUp",
  Esc: "Escape",
  Ctrl: "Control",
  "−": "-",
  // "+" joins a chord in ARIA, so the key itself is spelled out.
  "+": "Plus",
};

/**
 * `aria-keyshortcuts` for a shortcut: every one of its keys, or only the
 * one at `index` (see {@link keyHint}).
 */
export function ariaKeys(id: ShortcutId, index?: number): string {
  const keys = SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys ?? [];
  return (index === undefined ? keys : keys.slice(index, index + 1))
    .map((key) =>
      keyCaps(key)
        .map((cap) => ARIA_NAMES[cap] ?? cap)
        .join("+"),
    )
    .join(" ");
}

/**
 * A tooltip with its key, "Repeat this part (R)". `keyboard` is false on a
 * phone, where there's usually none: the tooltip is then the bare label.
 */
export function withKey(label: string, id: ShortcutId, keyboard: boolean, index = 0): string {
  return keyboard ? `${label} (${keyHint(id, index)})` : label;
}

/**
 * Whether a keydown is text entry, which every shortcut leaves alone. A
 * focused radio or checkbox isn't typing: it must not swallow the remote's
 * keys.
 */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("textarea, select") !== null ||
      (target instanceof HTMLInputElement &&
        !["radio", "checkbox", "button", "submit", "range"].includes(target.type)))
  );
}

/** Keys pressed in the Output window, replayed here (SDD-0001 §16.1). */
const forwarded = new WeakSet<Event>();

/** Replays a key pressed in the Output window through this window's keymap.
 * It was never meant for a sheet open here, so an open sheet doesn't stop
 * it. */
export function replayForwardedKey(key: string, shiftKey: boolean, repeat = false): void {
  const event = new KeyboardEvent("keydown", { key, shiftKey, repeat, cancelable: true });
  forwarded.add(event);
  window.dispatchEvent(event);
}

/**
 * Whether single-key shortcuts should ignore this keydown: typing, a sheet
 * or menu open (its own keys, e.g. the hymn picker's arrows, win), or a Ctrl/⌘/Alt
 * chord the browser owns. A key forwarded from the Output is none of these.
 */
export function ignoresShortcuts(event: KeyboardEvent): boolean {
  if (forwarded.has(event)) return event.defaultPrevented;
  return (
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    isTyping(event) ||
    document.querySelector('dialog[open], [role="menu"]') !== null
  );
}
