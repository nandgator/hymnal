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

export const THEME_MS = 500;
/** Material's standard easing: a gentle start, so the middle, where the
 * Output's current line is, doesn't flip at once (the emphasized curve
 * reached half the circle in a fifth of the time). */
const STANDARD = "cubic-bezier(0.4, 0, 0.2, 1)";
/** The edge is soft, this share of its reach: the new theme blurs in at
 * it, rather than a hard line crossing the text. A share, not a width, so
 * Live, a scale model of the Output, reveals as the Output does (24px on a
 * 1080p Output). */
const FEATHER = 0.022;
/** Softer in a Live strip: its one line of text is crossed side to side. */
const STRIP_FEATHER = 0.15;

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

/**
 * Opens a hole in `copy` from (x, y), its own coordinates, until it's gone:
 * a circle, or in a strip a curtain opening from its middle, rather than
 * a round blob crossing its one line of text.
 */
function open(
  copy: HTMLElement,
  [x, y]: [number, number],
  shape: "circle" | "strip",
  remove: () => void,
) {
  const { width, height } = copy.getBoundingClientRect();
  const feather = shape === "strip" ? STRIP_FEATHER : FEATHER;
  // Sized so that, fully open, even the feathered edge is past every corner.
  const [rx, ry] =
    shape === "strip"
      ? // So tall its sides are straight: the strip opens from the middle
        // like a curtain, two soft edges moving out across the line.
        [width / 2, height * 20]
      : Array(2).fill(Math.hypot(Math.max(x, width - x), Math.max(y, height - y)));
  copy.style.setProperty("--reveal-x", `${x}px`);
  copy.style.setProperty("--reveal-y", `${y}px`);
  copy.style.setProperty("--reveal-rx", `${rx / (1 - feather)}px`);
  copy.style.setProperty("--reveal-ry", `${ry / (1 - feather)}px`);
  copy.style.setProperty("--reveal-feather", `${feather * 100}%`);
  whenSteady(() =>
    copy
      .animate({ "--reveal-p": [0, 1] }, { duration: THEME_MS, easing: STANDARD })
      .finished.then(remove, remove),
  );
}

/**
 * Calls `start` once frames come steadily again (two in a row, or after
 * 600ms at most). The frame that first paints the copy and the page in its
 * new theme is slow (117–133ms, measured), and a change of the system's or
 * the browser's theme brings more as the browser repaints itself (150–367ms,
 * then some of 50–200ms): begun at once, the circle would jump through
 * them. Until then the copy is whole, the old theme still showing.
 */
function whenSteady(start: () => void) {
  const begun = performance.now();
  let last = begun;
  let steady = 0;
  const tick = (now: number) => {
    steady = now - last < 25 ? steady + 1 : 0;
    last = now;
    if (steady >= 2 || now - begun > 600) start();
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * The reveal carries the change, so the page's own colour transitions end
 * as they start: under the hole they'd fade the text on their own, faster
 * than the circle spreads, a crossfade after all (the Output's lines take
 * 200ms), and repaint the page every frame (86 of them, 50–117ms frames,
 * measured).
 */
function endTransitions(within: Document | HTMLElement) {
  const animations =
    within instanceof Document ? within.getAnimations() : within.getAnimations({ subtree: true });
  for (const animation of animations) if (animation instanceof CSSTransition) animation.finish();
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
  endTransitions(document);
  open(layer, [x, y], "circle", () => layer.remove());
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
  for (const live of lives) endTransitions(live);
  for (const copy of copies) {
    const { width, height } = copy.getBoundingClientRect();
    const shape = copy.matches(".output-view") ? "circle" : "strip";
    open(copy, [width / 2, height / 2], shape, () => copy.remove());
  }
}
