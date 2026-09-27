/**
 * The fold between the wide and phone layouts (DESIGN.md § Motion): when
 * the window crosses 840px, the panels glide and reshape into their new
 * places, as MD3's container transform does, rather than the screen
 * jumping.
 *
 * Not a View Transition: Chromium skips one on any viewport resize, and
 * crossing 840px is one. Not FLIP on the elements either: the two layouts
 * are different DOM (the stage becomes the Live strip and the dock), and
 * scaling a panel would stretch its corners and text. So the fold draws
 * plain rounded ghosts at the old places, moves and resizes them to the
 * new ones, and fades the old screen out over them and the new one in
 * under them as they land. The switcher row stays: it is one row either
 * way, and fading it would only blink it.
 *
 * It measures at the crossing, when the window is already its new size:
 * dragged across 840px, that's the layout just seen; snapped from far
 * wider or narrower, it's the old layout reflowed, which no earlier
 * moment could show.
 */

/** The pieces that fold, each paired old to new by key. A key matching
 * several on one side and one on the other folds them together: the tab
 * groups and the stage into a phone's single group, and back out. */
const PIECES: { key: string; selector: string; indexed?: boolean }[] = [
  { key: "area", selector: ".operator .area" },
  { key: "live", selector: ".operator .output-view-mini, .operator .live-strip-toggle" },
  { key: "transport", selector: ".operator .transport > button", indexed: true },
  { key: "chip", selector: ".operator .chip-set button", indexed: true },
];

/** As long as the Recents glide, eased the same (MD3 emphasized). */
export const FOLD_MS = 400;
const EMPHASIZED = "cubic-bezier(0.2, 0, 0, 1)";
/** The old screen is gone by this share of the fold; the new one arrives
 * from the next. */
const OUT_BY = 0.3;
const IN_FROM = 0.6;
/** Held at the start this long: the frame after the swap paints the new
 * screen and the copy for the first time, and is slow (50–67ms measured on
 * an integrated GPU), so the fold waits it out rather than skip ahead. */
const HOLD_MS = 50;

export interface Piece {
  key: string;
  rect: DOMRect;
  background: string;
  radius: string;
}

interface Snapshot {
  pieces: Piece[];
  /** The old screen, as it was, to fade out over the ghosts. */
  screen: HTMLElement;
  /** Its panes' scroll, restored once the copy is in the page. */
  scrolled: [HTMLElement, number, number][];
}

let pending: Snapshot | undefined;
let running: (() => void) | undefined;

function measure(root: ParentNode): Piece[] {
  const pieces: Piece[] = [];
  for (const { key, selector, indexed } of PIECES) {
    root.querySelectorAll<HTMLElement>(selector).forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const style = getComputedStyle(el);
      pieces.push({
        key: indexed ? `${key}-${i}` : key,
        rect,
        background: style.backgroundColor,
        radius: style.borderTopLeftRadius,
      });
    });
  }
  return pieces;
}

/** A still copy of the screen: inert and unnamed. */
function copyOf(shell: HTMLElement): Omit<Snapshot, "pieces"> {
  const copy = shell.cloneNode(true) as HTMLElement;
  const from = [shell, ...shell.querySelectorAll<HTMLElement>("*")];
  const to = [copy, ...copy.querySelectorAll<HTMLElement>("*")];
  const scrolled: [HTMLElement, number, number][] = [];
  from.forEach((el, i) => {
    const same = to[i];
    same.removeAttribute("id");
    if (el.scrollTop || el.scrollLeft) scrolled.push([same, el.scrollTop, el.scrollLeft]);
  });
  copy.setAttribute("inert", "");
  // An open sheet stays in the top layer, above the fold; its copy would
  // only draw again, out of place.
  for (const dialog of copy.querySelectorAll("dialog")) dialog.remove();
  // The live row shows through: it never left.
  copy.querySelector<HTMLElement>(".switcher-row")?.style.setProperty("visibility", "hidden");
  return { screen: copy, scrolled };
}

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * Call as the layout is about to change, before any of it has: from the
 * first media-query listener to hear of the crossing. It measures the old
 * screen now and plays the fold once every listener has applied its
 * change, in the same frame, before it's painted (animation frame
 * callbacks run after media queries are evaluated).
 */
export function foldBeforeChange() {
  if (pending || reduced() || typeof requestAnimationFrame !== "function") return;
  const shell = document.querySelector<HTMLElement>(".shell");
  if (!shell || typeof shell.animate !== "function") return;
  running?.();
  pending = { pieces: measure(document), ...copyOf(shell) };
  requestAnimationFrame(() => {
    const snapshot = pending;
    pending = undefined;
    if (snapshot) play(shell, snapshot);
  });
}

export function pairs(before: Piece[], after: Piece[]): [Piece, Piece][] {
  const out: [Piece, Piece][] = [];
  const keys = new Set(before.map((p) => p.key));
  for (const key of keys) {
    const olds = before.filter((p) => p.key === key);
    const news = after.filter((p) => p.key === key);
    if (news.length === 0) continue;
    const n = Math.max(olds.length, news.length);
    for (let i = 0; i < n; i++) {
      out.push([olds[Math.min(i, olds.length - 1)], news[Math.min(i, news.length - 1)]]);
    }
  }
  return out;
}

const box = (piece: Piece): Keyframe => ({
  left: `${piece.rect.left}px`,
  top: `${piece.rect.top}px`,
  width: `${piece.rect.width}px`,
  height: `${piece.rect.height}px`,
  borderRadius: piece.radius,
  backgroundColor: piece.background,
});

function play(shell: HTMLElement, { pieces, screen, scrolled }: Snapshot) {
  const layer = document.createElement("div");
  layer.className = "fold-layer";
  layer.setAttribute("aria-hidden", "true");
  const timing = { duration: FOLD_MS, delay: HOLD_MS, easing: EMPHASIZED, fill: "both" as const };
  const fade = { duration: FOLD_MS, delay: HOLD_MS, fill: "both" as const };
  const animations: Animation[] = [];

  // Ghosts in document order, so a piece inside another draws over it.
  for (const [from, to] of pairs(pieces, measure(document))) {
    const ghost = document.createElement("div");
    ghost.className = "fold-ghost";
    layer.append(ghost);
    animations.push(
      ghost.animate([box(from), box(to)], timing),
      ghost.animate([{ opacity: 1 }, { opacity: 1, offset: IN_FROM }, { opacity: 0 }], fade),
    );
  }

  // The old screen over the ghosts, where they start, fading as they move.
  layer.append(screen);
  document.body.append(layer);
  for (const [el, top, left] of scrolled) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
  animations.push(
    screen.animate([{ opacity: 1 }, { opacity: 0, offset: OUT_BY }, { opacity: 0 }], fade),
    ...[...shell.querySelectorAll<HTMLElement>(":scope > .nav-rail, .workspace")].map((el) =>
      el.animate([{ opacity: 0 }, { opacity: 0, offset: IN_FROM }, { opacity: 1 }], fade),
    ),
  );

  const done = () => {
    running = undefined;
    for (const animation of animations) animation.cancel();
    layer.remove();
  };
  running = done;
  animations[animations.length - 1].finished.then(done, () => {});
}
