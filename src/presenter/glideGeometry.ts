// What the Lyrics tint (lyricsGlide.ts) and the parts pad's pill (padGlide.ts)
// share: a layer that is placed by translate, width and height over the box
// of the element it marks, measured by layout offsets and glided between
// boxes by one Web Animation.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FALLBACK_EASING = "cubic-bezier(0.2, 0, 0, 1)";
export const FALLBACK_MS = 250;

// Layout offsets, not rects: a tab's zoom-in or a View Transition scales
// what getBoundingClientRect reports, but never an element's own layout.
function offsetIn(el: HTMLElement, list: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let n: HTMLElement | null = el; n && n !== list; n = n.offsetParent as HTMLElement | null) {
    x += n.offsetLeft;
    y += n.offsetTop;
  }
  return { x, y };
}

export const boxOf = (el: HTMLElement, list: HTMLElement): Box => ({
  ...offsetIn(el, list),
  w: el.offsetWidth,
  h: el.offsetHeight,
});

export const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

export const frame = (b: Box) => ({
  transform: `translate(${b.x}px, ${b.y}px)`,
  width: `${b.w}px`,
  height: `${b.h}px`,
});

export function paint(layer: HTMLElement, box: Box | null) {
  if (!box) {
    layer.style.display = "none";
    return;
  }
  layer.style.display = "";
  const f = frame(box);
  layer.style.transform = f.transform;
  layer.style.width = f.width;
  layer.style.height = f.height;
}

// Where the layer is drawn right now, mid-glide included.
export function shownBox(layer: HTMLElement, anim: Animation | null, box: Box | null): Box | null {
  if (!anim || !box) return box;
  const cs = getComputedStyle(layer);
  const m = new DOMMatrix(cs.transform === "none" ? undefined : cs.transform);
  return { x: m.m41, y: m.m42, w: Number.parseFloat(cs.width), h: Number.parseFloat(cs.height) };
}

export const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** The app's medium duration and emphasised easing, from the tokens. */
export function glideTiming(el: HTMLElement) {
  const style = getComputedStyle(el);
  return {
    duration: Number.parseFloat(style.getPropertyValue("--motion-medium")) || FALLBACK_MS,
    easing: style.getPropertyValue("--motion-emphasized").trim() || FALLBACK_EASING,
  };
}

/** Runs `settle` once the animation has finished or been cancelled. */
export function onSettle(anim: Animation, settle: () => void) {
  anim.addEventListener("finish", settle);
  anim.addEventListener("cancel", settle);
}

/** The layer glides from one box to another: position and size, never a
 * scale, so its corners keep their radius. */
export function glideBox(layer: HTMLElement, from: Box, to: Box, settle: () => void): Animation {
  const anim = layer.animate([frame(from), frame(to)], glideTiming(layer));
  onSettle(anim, settle);
  return anim;
}
