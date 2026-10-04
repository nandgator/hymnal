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

export const forcedColors = () => window.matchMedia?.("(forced-colors: active)").matches ?? false;

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

/** How many steps a stretching glide is sampled in. */
const PATH_STEPS = 25;
/** An edge moving against the travel starts this far into the glide (of its
 * duration) and still ends with the rest. */
const LAG = 0.3;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** The progress curve of a CSS `cubic-bezier(x1, y1, x2, y2)` (a time in 0..1
 * to a progress), or the identity for anything else. */
export function easingOf(css: string): (t: number) => number {
  const m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(
    css,
  );
  if (!m) return (t) => t;
  const [x1, y1, x2, y2] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
  const at = (s: number, a: number, b: number) =>
    3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid, x1, x2) < t) lo = mid;
      else hi = mid;
    }
    return at((lo + hi) / 2, y1, y2);
  };
}

// Which way the layer travels along an axis (by its centre), and whether an
// edge goes against it.
const travel = (a0: number, a1: number, b0: number, b1: number) => Math.sign(b0 + b1 - (a0 + a1));
const against = (delta: number, dir: number) => dir !== 0 && delta * dir < 0;

/** One axis of a glide: the near and far edge, where `lead` (0..1) is how far
 * the edges that move with the travel have gone and `lag` how far those that
 * move against it have. The layer travels toward where its centre goes. */
export function axisAt(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  lead: number,
  lag: number,
): [number, number] {
  const dir = travel(a0, a1, b0, b1);
  const edge = (from: number, to: number) =>
    from + (to - from) * (against(to - from, dir) ? lag : lead);
  return [edge(a0, b0), edge(a1, b1)];
}

const stretches = (a0: number, a1: number, b0: number, b1: number) => {
  const dir = travel(a0, a1, b0, b1);
  return against(b0 - a0, dir) || against(b1 - a1, dir);
};

/** The keyframes of a glide from one box to another. Where no edge moves
 * against the travel (a key to a key, a move that only grows toward where it
 * goes), the two ends alone, for the animation's own easing. Otherwise the
 * real direction matters: a key on the right floating left into the chorus
 * bar must read as that key moving left, not as a bar growing out of its
 * middle. So the edge that would go against the travel holds still while the
 * rest sets off, and follows after (it starts `LAG` of the way in and
 * arrives with the others). That is sampled in time, with `ease` (the
 * animation's own curve) applied here, so the animation itself is linear:
 * `linear` is true then. `blur` (px) peaks at the middle of the move,
 * crisp at both ends. */
export function glidePath(
  from: Box,
  to: Box,
  blur = 0,
  ease: (t: number) => number = (t) => t,
): { frames: Keyframe[]; linear: boolean } {
  const fx = [from.x, from.x + from.w] as const;
  const tx = [to.x, to.x + to.w] as const;
  const fy = [from.y, from.y + from.h] as const;
  const ty = [to.y, to.y + to.h] as const;
  if (!stretches(...fx, ...tx) && !stretches(...fy, ...ty)) {
    return {
      linear: false,
      frames: blur
        ? [
            { ...frame(from), filter: "blur(0px)" },
            { offset: 0.5, filter: `blur(${blur}px)` },
            { ...frame(to), filter: "blur(0px)" },
          ]
        : [frame(from), frame(to)],
    };
  }
  const frames: Keyframe[] = [];
  for (let i = 0; i <= PATH_STEPS; i++) {
    const t = i / PATH_STEPS;
    const lead = ease(t);
    const lag = ease(clamp01((t - LAG) / (1 - LAG)));
    const [x0, x1] = axisAt(...fx, ...tx, lead, lag);
    const [y0, y1] = axisAt(...fy, ...ty, lead, lag);
    frames.push({
      offset: t,
      ...frame({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }),
      ...(blur ? { filter: `blur(${blur * (1 - Math.abs(2 * lead - 1))}px)` } : {}),
    });
  }
  return { frames, linear: true };
}

/** The layer glides from one box to another: position and size, never a
 * scale, so its corners keep their radius. */
export function glideBox(
  layer: HTMLElement,
  from: Box,
  to: Box,
  settle: () => void,
  blur = 0,
): Animation {
  const timing = glideTiming(layer);
  const { frames, linear } = glidePath(from, to, blur, easingOf(timing.easing));
  const anim = layer.animate(frames, linear ? { ...timing, easing: "linear" } : timing);
  onSettle(anim, settle);
  return anim;
}
