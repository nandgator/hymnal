/**
 * A theme change eases (DESIGN.md § Motion): the new theme spreads over the
 * old in a soft-edged circle from where it was chosen, rather than
 * snapping. Never a crossfade: halfway between dark on light and light on
 * dark, text and ground are the same grey, unreadable. In a reveal, every
 * point but the thin edge is wholly one theme or the other, so text keeps
 * its contrast throughout.
 *
 * The page changes at once, under a still copy of it in the old theme, and
 * a hole grows in the copy. Not a View Transition: its snapshot is a
 * picture of the page, and when it gave way to the page at the end the
 * text visibly changed (a flicker). Here what shows through is the page
 * itself, so the end is only the copy, fully open, going away.
 */

import { stillCopy } from "./still.ts";

export const THEME_MS = 400;
const EMPHASIZED = "cubic-bezier(0.2, 0, 0, 1)";
/** The circle's edge is soft, this wide: the new theme blurs in at it,
 * rather than a hard line crossing the text (styles.css). */
const FEATHER = 24;

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
/** A hidden window paints nothing, so its reveal would stall, the copy left over it. */
const canAnimate = () =>
  typeof document.body.animate === "function" && !reduced() && !document.hidden;

/** The Operator's theme as shown now: its setting, or the system's. */
export function shownTheme(): "light" | "dark" {
  const set = document.documentElement.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Where the reveal starts: the control just used, else the middle. */
function origin(from: "control" | "middle"): [number, number] {
  const active = from === "control" ? document.activeElement : null;
  const control = active?.closest("label") ?? active;
  if (control && control !== document.body) {
    const rect = control.getBoundingClientRect();
    if (rect.width > 0) return [rect.left + rect.width / 2, rect.top + rect.height / 2];
  }
  return [innerWidth / 2, innerHeight / 2];
}

/** Opens a hole in `copy` from (x, y), its own coordinates, until it's gone. */
function open(copy: HTMLElement, x: number, y: number, remove: () => void) {
  const { width, height } = copy.getBoundingClientRect();
  const radius = Math.hypot(Math.max(x, width - x), Math.max(y, height - y)) + FEATHER;
  copy.style.setProperty("--reveal-x", `${x}px`);
  copy.style.setProperty("--reveal-y", `${y}px`);
  copy
    .animate({ "--reveal-r": ["0px", `${radius}px`] }, { duration: THEME_MS, easing: EMPHASIZED })
    .finished.then(remove, remove);
}

/** A still copy of the whole window: the page, and any open sheet over it
 * with its scrim, in a popover so it lies above the sheet too. */
function windowCopy(): { layer: HTMLElement; settle: () => void } {
  const layer = document.createElement("div");
  layer.className = "theme-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.setAttribute("inert", "");
  const settles: (() => void)[] = [];
  for (const child of document.body.children) {
    if (!(child instanceof HTMLElement) || child.matches("script, .theme-layer, .fold-layer"))
      continue;
    const { copy, settle } = stillCopy(child);
    for (const dialog of copy.querySelectorAll("dialog")) dialog.remove();
    layer.append(copy);
    settles.push(settle);
  }
  for (const dialog of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) {
    if (dialog.matches(":modal")) {
      const backdrop = getComputedStyle(dialog, "::backdrop");
      const scrim = document.createElement("div");
      scrim.className = "theme-layer-scrim";
      scrim.style.backgroundColor = backdrop.backgroundColor;
      scrim.style.backdropFilter = backdrop.backdropFilter;
      layer.append(scrim);
    }
    const rect = dialog.getBoundingClientRect();
    const { copy, settle } = stillCopy(dialog);
    copy.classList.add("theme-layer-sheet");
    copy.style.left = `${rect.left}px`;
    copy.style.top = `${rect.top}px`;
    copy.style.width = `${rect.width}px`;
    copy.style.height = `${rect.height}px`;
    layer.append(copy);
    settles.push(settle);
  }
  return {
    layer,
    settle: () => {
      for (const settle of settles) settle();
    },
  };
}

/**
 * Applies a theme change to the whole window, revealed. `was` is the
 * attribute that gives the copy the theme being left: `data-theme-copy`
 * for the Operator's, `data-output-theme` for the presentation's. `apply`
 * may do nothing, when the page has changed already (the system's theme).
 */
export function easeThemeChange(
  apply: () => void,
  was: [name: string, value: string],
  from: "control" | "middle" = "control",
) {
  if (!canAnimate()) return apply();
  const [x, y] = origin(from);
  const { layer, settle } = windowCopy();
  // Its ground from the theme it keeps (styles.css), not read off the page,
  // which may already be in the new one.
  layer.setAttribute(...was);
  layer.popover = "manual";
  document.body.append(layer);
  layer.showPopover?.();
  settle();
  // Still: a copied sheet would replay its opening.
  for (const animation of layer.getAnimations({ subtree: true })) animation.cancel();
  apply();
  // The reveal carries the change: the controls' own colour transitions
  // would repaint the page under it every frame (86 of them, 50–117ms
  // frames, measured), so they end as they start.
  for (const animation of document.getAnimations())
    if (animation instanceof CSSTransition) animation.finish();
  open(layer, x, y, () => layer.remove());
}

/**
 * Applies a change of the presentation's theme, revealed within each of
 * `lives` (the Operator's Live preview and strip) from its middle, as on
 * the Output: the rest of the Operator doesn't show it.
 */
export function revealWithin(lives: HTMLElement[], apply: () => void) {
  if (lives.length === 0 || !canAnimate()) return apply();
  const theme = document.documentElement.getAttribute("data-output-theme") ?? "";
  const copies = lives.map((live) => {
    const { copy, settle } = stillCopy(live);
    copy.removeAttribute("role");
    copy.setAttribute("aria-hidden", "true");
    copy.setAttribute("data-output-theme", theme);
    copy.classList.add("theme-reveal-old");
    if (getComputedStyle(live).position === "static") live.style.position = "relative";
    copy.style.top = `${live.scrollTop}px`;
    copy.style.left = `${live.scrollLeft}px`;
    live.append(copy);
    settle();
    return copy;
  });
  apply();
  for (const copy of copies) {
    const { width, height } = copy.getBoundingClientRect();
    open(copy, width / 2, height / 2, () => copy.remove());
  }
}
