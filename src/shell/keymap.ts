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
  /**
   * Whether the key acts on what the audience sees ("presentation") or on
   * the Operator's own screen ("operator"). Only presentation keys are
   * forwarded from the Output window (SDD-0001 §16.5).
   */
  scope: ShortcutScope;
}

export type ShortcutScope = "presentation" | "operator";

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
  { id: "next-part", keys: ["→", "Page Down", "Space"], label: "Next part", scope: "presentation" },
  {
    id: "previous-part",
    keys: ["←", "Page Up", "Shift+Space"],
    label: "Previous part",
    scope: "presentation",
  },
  { id: "lines", keys: ["↓", "↑"], label: "Next / previous line", scope: "presentation" },
  { id: "first-last", keys: ["Home", "End"], label: "First / last part", scope: "presentation" },
  {
    id: "stanza",
    keys: ["1–9"],
    label: "Stanza n (two digits: type both quickly)",
    scope: "presentation",
  },
  { id: "chorus", keys: ["C"], label: "Chorus", scope: "presentation" },
  { id: "repeat", keys: ["R"], label: "Repeat this part", scope: "presentation" },
  { id: "undo-repeat", keys: ["U"], label: "Undo the last repeat", scope: "presentation" },
  { id: "blank", keys: ["B", "."], label: "Blank the Output / restore", scope: "presentation" },
  {
    id: "hold",
    keys: ["Shift+H"],
    label: "Hold the Output on what it shows / release",
    scope: "presentation",
  },
  {
    id: "output",
    keys: ["O"],
    label: "Open the Output window, or bring it forward",
    scope: "operator",
  },
  {
    id: "end-live",
    keys: ["Shift+E"],
    label: "End Live: close the Output window",
    scope: "presentation",
  },
  {
    id: "present-here",
    keys: ["Shift+P"],
    label: "Present on this screen, full screen",
    scope: "operator",
  },
  {
    id: "leave-present",
    keys: ["F", "Esc"],
    label: "Leave presenting on this screen",
    scope: "presentation",
  },
  { id: "tab", keys: ["N"], label: "Next tab", scope: "operator" },
  { id: "live", keys: ["L"], label: "Show or hide the Live preview", scope: "operator" },
  {
    id: "highlight",
    keys: ["H"],
    label: "Light the whole song / only the current part",
    scope: "presentation",
  },
  {
    id: "command-menu",
    keys: ["/", "Ctrl+K"],
    label: "Search songs and actions",
    scope: "operator",
  },
  { id: "text-size", keys: ["+", "−"], label: "Text size", scope: "operator" },
  { id: "shortcuts", keys: ["?"], label: "Keyboard shortcuts", scope: "operator" },
  { id: "settings", keys: ["Ctrl+,"], label: "Settings", scope: "operator" },
  { id: "close", keys: ["Esc"], label: "Close a sheet or menu", scope: "operator" },
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

/**
 * Whether a key pressed in the Output window acts on the presentation, and
 * so is forwarded to the Operator: it is some presentation shortcut's key.
 * Esc is left to the browser there (it leaves fullscreen). Shift counts only
 * where a shortcut names it (Shift+H, Shift+E); elsewhere it just changes
 * the case or direction.
 */
export function isPresentationKey(key: string, shiftKey: boolean): boolean {
  const lower = key.toLowerCase();
  return SHORTCUTS.some(
    (shortcut) =>
      shortcut.scope === "presentation" &&
      shortcut.keys.some((spec) => {
        const caps = keyCaps(spec);
        const base = caps[caps.length - 1] ?? "";
        if (base === "Esc") return false;
        if (caps.includes("Shift") && !shiftKey) return false;
        if (base === "1–9") return /^[1-9]$/.test(key);
        const name = base === "Space" ? " " : (ARIA_NAMES[base] ?? base);
        return name.toLowerCase() === lower;
      }),
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
