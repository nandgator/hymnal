/**
 * The fold between the wide and phone layouts (DESIGN.md § Motion): when
 * the window crosses 840px, the panels glide into their new places with
 * their text in them, as MD3's container transform does, rather than the
 * screen jumping.
 *
 * Not a View Transition: Chromium skips one on any viewport resize, and
 * crossing 840px is one. The two layouts are different DOM (the stage
 * becomes the Live strip and the dock), so the fold keeps a copy of the
 * old screen over the new one and moves both: each panel of the old copy
 * travels to where its counterpart now is while it fades, and each panel
 * of the new screen travels from where its counterpart was while it
 * arrives, revealed from the old one's size. Moved and clipped, never
 * scaled, so no corner or line of text stretches; the two screens
 * crossfade with a little blur, so the text is never gone. The switcher
 * row stays: it is one row either way.
 *
 * It measures at the crossing, when the window is already its new size:
 * dragged across 840px, that's the layout just seen; snapped from far
 * wider or narrower, it's the old layout reflowed, which no earlier
 * moment could show.
 */

/** The pieces that fold, each paired old to new by key. A key matching
 * several on one side and one on the other folds them together: the tab
 * groups and the stage into a phone's single group, and back out. */
const PIECES: { key: string; selector: string; indexed?: boolean; reveal?: boolean }[] = [
  { key: "area", selector: ".operator .area", reveal: true },
  { key: "live", selector: ".operator .output-view-mini, .operator .live-strip-toggle" },
  { key: "transport", selector: ".operator .transport > button", indexed: true },
  { key: "chip", selector: ".operator .chip-set button", indexed: true },
];

/** As long as the Recents glide, eased the same (MD3 emphasized). */
export const FOLD_MS = 450;
const EMPHASIZED = "cubic-bezier(0.2, 0, 0, 1)";
/** The new screen is in, under the old copy, before the copy fades: one
 * of the two is always whole, so the text never dips. */
const IN_BY = 0.3;
const OUT_FROM = 0.1;
const OUT_BY = 0.55;
const BLUR = "4px";
/** Held at the start this long: the frame after the swap paints the new
 * screen and the copy for the first time, and is slow (50–67ms measured on
 * an integrated GPU), so the fold waits it out rather than skip ahead. */
const HOLD_MS = 50;

export interface Piece {
  key: string;
  rect: DOMRect;
  /** The element, in the page or in the old screen's copy. */
  el?: HTMLElement;
  main?: boolean;
  reveal?: boolean;
}

interface Snapshot {
  pieces: Piece[];
  /** The old screen, as it was, to fade out over the new. */
  screen: HTMLElement;
  /** Its panes' scroll, restored once the copy is in the page. */
  scrolled: [HTMLElement, number, number][];
}

let pending: Snapshot | undefined;
let running: (() => void) | undefined;

/** Every piece on screen; `from` is where they are measured, `into` the
 * tree whose matching elements they stand for (the copy, for the old). */
function measure(from: ParentNode, into: ParentNode = from): Piece[] {
  const pieces: Piece[] = [];
  for (const { key, selector, indexed, reveal } of PIECES) {
    const same = [...into.querySelectorAll<HTMLElement>(selector)];
    from.querySelectorAll<HTMLElement>(selector).forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pieces.push({
        key: indexed ? `${key}-${i}` : key,
        rect,
        el: same[i],
        main: el.classList.contains("area-main"),
        reveal,
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
  const copy = copyOf(shell);
  pending = { pieces: measure(shell, copy.screen), ...copy };
  requestAnimationFrame(() => {
    const snapshot = pending;
    pending = undefined;
    if (snapshot) play(shell, snapshot);
  });
}

/** For each piece on one side, its counterpart on the other: by position
 * when the sides match, else the main panel (or the only one) stands for
 * the rest. A piece with no counterpart is left to the crossfade. */
export function pairs(from: Piece[], to: Piece[]): [Piece, Piece][] {
  const out: [Piece, Piece][] = [];
  for (const piece of from) {
    const olds = from.filter((p) => p.key === piece.key);
    const news = to.filter((p) => p.key === piece.key);
    if (news.length === 0) continue;
    const other =
      olds.length === news.length
        ? news[olds.indexOf(piece)]
        : (news.find((p) => p.main) ?? news[0]);
    out.push([piece, other]);
  }
  return out;
}

/** How far a piece moves, less what the nearest moving piece around it
 * already carries it. */
function offsets(moves: Map<HTMLElement, [number, number]>) {
  const own = new Map<HTMLElement, [number, number]>();
  for (const [el, [x, y]] of moves) {
    let parent = el.parentElement;
    while (parent && !moves.has(parent)) parent = parent.parentElement;
    const [px, py] = parent ? (moves.get(parent) as [number, number]) : [0, 0];
    own.set(el, [x - px, y - py]);
  }
  return own;
}

function play(shell: HTMLElement, { pieces, screen, scrolled }: Snapshot) {
  const layer = document.createElement("div");
  layer.className = "fold-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.append(screen);
  document.body.append(layer);
  for (const [el, top, left] of scrolled) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }

  const now = measure(shell);
  const move = { duration: FOLD_MS, delay: HOLD_MS, easing: EMPHASIZED, fill: "both" as const };
  const fade = { duration: FOLD_MS, delay: HOLD_MS, fill: "both" as const };
  const animations: Animation[] = [];

  // The old copy's panels go to where their counterparts are now.
  const outgoing = new Map<HTMLElement, [number, number]>();
  for (const [old, next] of pairs(pieces, now)) {
    if (old.el)
      outgoing.set(old.el, [next.rect.left - old.rect.left, next.rect.top - old.rect.top]);
  }
  for (const [el, [x, y]] of offsets(outgoing)) {
    animations.push(
      el.animate([{ transform: "none" }, { transform: `translate(${x}px, ${y}px)` }], move),
    );
  }

  // The new screen's panels come from where their counterparts were, a
  // panel revealed from the old one's size.
  const incoming = new Map<HTMLElement, [number, number]>();
  const reveals = new Map<HTMLElement, [Piece, Piece]>();
  for (const [next, old] of pairs(now, pieces)) {
    if (!next.el) continue;
    incoming.set(next.el, [old.rect.left - next.rect.left, old.rect.top - next.rect.top]);
    if (next.reveal) reveals.set(next.el, [next, old]);
  }
  for (const [el, [x, y]] of offsets(incoming)) {
    const from: Keyframe = { transform: `translate(${x}px, ${y}px)` };
    const to: Keyframe = { transform: "none" };
    const reveal = reveals.get(el);
    if (reveal) {
      const [next, old] = reveal;
      const radius = getComputedStyle(el).borderTopLeftRadius;
      const right = Math.max(0, next.rect.width - old.rect.width);
      const bottom = Math.max(0, next.rect.height - old.rect.height);
      from.clipPath = `inset(0px ${right}px ${bottom}px 0px round ${radius})`;
      to.clipPath = `inset(0px 0px 0px 0px round ${radius})`;
    }
    animations.push(el.animate([from, to], move));
  }

  // The crossfade: the new screen in under the old, then the old out,
  // blurring as it goes so the two not lining up reads as motion. Only the
  // old: blurring the new too cost frames mid-glide (67–83ms, measured).
  animations.push(
    screen.animate(
      [
        { opacity: 1, filter: "blur(0px)" },
        { opacity: 1, filter: "blur(0px)", offset: OUT_FROM },
        { opacity: 0, filter: `blur(${BLUR})`, offset: OUT_BY },
        { opacity: 0, filter: `blur(${BLUR})` },
      ],
      fade,
    ),
    ...[...shell.querySelectorAll<HTMLElement>(":scope > .nav-rail, .workspace")].map((el) =>
      el.animate([{ opacity: 0 }, { opacity: 1, offset: IN_BY }, { opacity: 1 }], fade),
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
