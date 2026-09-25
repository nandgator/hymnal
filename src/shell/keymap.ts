/**
 * The keyboard shortcuts, as data (SDD-0001 §16.5): the `?` sheet renders
 * this table and the command menu reads its key hints from it, so the three
 * can't disagree. Handling is split: the shell owns the keys that work on
 * every screen, the Presenter the ones that move its engine.
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
  | "refrain"
  | "blank"
  | "output"
  | "navigator"
  | "live"
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
  { id: "refrain", keys: ["R"], label: "Refrain" },
  { id: "blank", keys: ["B", "."], label: "Blank the Output / restore" },
  { id: "output", keys: ["O"], label: "Show Output" },
  { id: "navigator", keys: ["N"], label: "Swap navigator (Parts ↔ Lyrics)" },
  { id: "live", keys: ["L"], label: "Show or hide Live" },
  { id: "command-menu", keys: ["/", "Ctrl+K"], label: "Command menu" },
  { id: "text-size", keys: ["+", "−"], label: "Text size" },
  { id: "shortcuts", keys: ["?"], label: "Keyboard shortcuts" },
  { id: "settings", keys: ["Ctrl+,"], label: "Settings" },
  { id: "close", keys: ["Esc"], label: "Close a sheet or menu" },
];

/** The key hint for a shortcut, e.g. "B" — its first key. */
export function keyHint(id: ShortcutId): string {
  return SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys[0] ?? "";
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
export function replayForwardedKey(key: string, shiftKey: boolean): void {
  const event = new KeyboardEvent("keydown", { key, shiftKey, cancelable: true });
  forwarded.add(event);
  window.dispatchEvent(event);
}

/**
 * Whether single-key shortcuts should ignore this keydown: typing, a sheet
 * open (its own keys, e.g. the hymn picker's arrows, win), or a Ctrl/⌘/Alt
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
    document.querySelector("dialog[open]") !== null
  );
}
