// The Lyrics list's current-part tint, and the scroll that centres it.
//
// The tint is one layer (`.seq-tint`, behind the text) that slides and
// resizes from the old part to the new one, its leading edge arriving before
// its trailing edge (it stretches over the new part, then lets go of the
// old), landing together with the scroll as ONE motion: a single Web
// Animation is the clock, and the scroll reads its eased progress each
// frame, so the two can never drift apart (and a paused, seeked animation
// moves both). A step far from where the tint is doesn't travel through the
// song: the tint fades instead and the scroll lands at once. A list shown
// anew, and reduced motion, show the end state. The text's colour change
// keeps to the tint: it eases with the glide and the fade-in (styles.css),
// and goes at once when the tint snaps (`data-tint` on the list).

export type TintMode = "snap" | "glide" | "fade";
export type ScrollMode = "snap" | "glide";

export interface GlidePlan {
  tint: TintMode;
  scroll: ScrollMode;
}

export interface GlideInput {
  // The step is the one already shown (an update that isn't a step), or a
  // list shown anew, or another song: land at once.
  still: boolean;
  reduced: boolean;
  // Where the tint is now, or null when it hasn't been shown yet.
  tintTravel: number | null;
  scrollTravel: number;
  // The list's height: "more than about a screen" of travel fades.
  viewport: number;
}

/** What a step does: glide, fade (a far jump) or snap. Pure, for tests. */
export function planGlide(input: GlideInput): GlidePlan {
  if (input.still || input.reduced) return { tint: "snap", scroll: "snap" };
  const far = (travel: number) => travel > input.viewport;
  const scroll: ScrollMode = far(input.scrollTravel) ? "snap" : "glide";
  if (input.tintTravel === null) return { tint: "snap", scroll };
  // Only the tint travelling far fades. Far scroll with a near (or still)
  // tint, like Back to Current, just lands: the tint has nothing to flash.
  if (far(input.tintTravel)) return { tint: "fade", scroll: "snap" };
  return { tint: "glide", scroll };
}

/** The scrollTop that puts an element in the middle of the list, or at its top. */
export function scrollTargetTop(input: {
  top: number;
  height: number;
  viewport: number;
  scrollHeight: number;
  align: "center" | "start";
}): number {
  const raw =
    input.align === "center" ? input.top - (input.viewport - input.height) / 2 : input.top;
  const max = Math.max(0, input.scrollHeight - input.viewport);
  return Math.min(max, Math.max(0, raw));
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ListState {
  // Where the tint settles: the end state, whatever is animating.
  box: Box | null;
  scrollTo: number | null;
  anim: Animation | null;
  stopScroll: (() => void) | null;
  // The list was hidden at the last step: centre it, unanimated, on show.
  centrePending: boolean;
  // The size observer, and the block it watches besides the list: the
  // current one, moved on each step (a ×N chip grows it, nothing else does).
  observer: ResizeObserver | null;
  watched: Element | null;
}

const states = new WeakMap<HTMLElement, ListState>();
const stateOf = (list: HTMLElement): ListState => {
  let state = states.get(list);
  if (!state) {
    state = {
      box: null,
      scrollTo: null,
      anim: null,
      stopScroll: null,
      centrePending: false,
      observer: null,
      watched: null,
    };
    states.set(list, state);
  }
  return state;
};

const FALLBACK_EASING = "cubic-bezier(0.2, 0, 0, 1)";
// The leading edge has arrived by this share of the duration.
const LEAD = 0.65;
const EDGE_STEPS = 24;

// The x in [0,1] at which a rising f reaches y, by bisection.
function invert(f: (x: number) => number, y: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A CSS cubic-bezier() as a function of time; null if it is not one. */
export function parseEase(css: string): ((t: number) => number) | null {
  const m = /^cubic-bezier\(\s*([^,]+),([^,]+),([^,]+),([^)]+)\)$/.exec(css.trim());
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1, 5).map(Number);
  if ([x1, y1, x2, y2].some(Number.isNaN) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return null;
  const at = (a: number, b: number, u: number) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return at(
      y1,
      y2,
      invert((u) => at(x1, x2, u), t),
    );
  };
}

/**
 * The tint's boxes at even steps of the animation's eased progress, as
 * keyframes. The trailing edge follows that progress; the leading edge (the
 * bottom moving down, the top moving up) takes the same curve over the first
 * LEAD of the time, so it has reached the new part before the old is let go.
 * Pure, for tests.
 */
export function edgeBoxes(
  from: Box,
  to: Box,
  ease: (t: number) => number,
  steps = EDGE_STEPS,
): Box[] {
  const down = to.y >= from.y;
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const p = i / steps;
    const lead = i === steps ? 1 : ease(Math.min(1, invert(ease, p) / LEAD));
    const top = lerp(from.y, to.y, down ? p : lead);
    const bottom = lerp(from.y + from.h, to.y + to.h, down ? lead : p);
    return {
      x: lerp(from.x, to.x, p),
      y: top,
      w: lerp(from.w, to.w, p),
      h: Math.max(0, bottom - top),
    };
  });
}

const FALLBACK_MS = 250;

const tintOf = (list: HTMLElement) =>
  list.querySelector<HTMLElement>(":scope > .seq-tint") ?? undefined;

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

const boxOf = (el: HTMLElement, list: HTMLElement): Box => ({
  ...offsetIn(el, list),
  w: el.offsetWidth,
  h: el.offsetHeight,
});

const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

const frame = (b: Box) => ({
  transform: `translate(${b.x}px, ${b.y}px)`,
  width: `${b.w}px`,
  height: `${b.h}px`,
});

function paint(tint: HTMLElement, box: Box | null) {
  if (!box) {
    tint.style.display = "none";
    return;
  }
  tint.style.display = "";
  const f = frame(box);
  tint.style.transform = f.transform;
  tint.style.width = f.width;
  tint.style.height = f.height;
}

// Where the tint is drawn right now, mid-glide included.
function shownBox(tint: HTMLElement, state: ListState): Box | null {
  if (!state.anim || !state.box) return state.box;
  const cs = getComputedStyle(tint);
  const m = new DOMMatrix(cs.transform === "none" ? undefined : cs.transform);
  return { x: m.m41, y: m.m42, w: Number.parseFloat(cs.width), h: Number.parseFloat(cs.height) };
}

function stop(state: ListState) {
  state.stopScroll?.();
  state.stopScroll = null;
  state.anim?.cancel();
  state.anim = null;
}

// A tint that snaps takes the text's colour with it: `data-tint` on the list
// for one style recalculation turns the colour transition off, and is taken
// off again with the colour already changed.
function snapColour(list: HTMLElement) {
  list.dataset.tint = "snap";
  void list.offsetHeight;
  delete list.dataset.tint;
}

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function watchCurrent(state: ListState, block: Element | null) {
  if (!state.observer || state.watched === block) return;
  if (state.watched) state.observer.unobserve(state.watched);
  state.watched = block;
  if (block) state.observer.observe(block);
}

/** The current block, and the element to centre (its focused line, if any). */
function targetsOf(list: HTMLElement) {
  const block = list.querySelector<HTMLElement>('[aria-current="step"]');
  if (!block) return null;
  const line = block.querySelector<HTMLElement>('.seq-line[aria-current="true"]');
  const fits = block.offsetHeight <= list.clientHeight;
  return {
    block,
    el: line ?? block,
    align: line || fits ? ("center" as const) : ("start" as const),
  };
}

function scrollToFor(list: HTMLElement, targets: NonNullable<ReturnType<typeof targetsOf>>) {
  const at = boxOf(targets.el, list);
  return scrollTargetTop({
    top: at.y,
    height: at.h,
    viewport: list.clientHeight,
    scrollHeight: list.scrollHeight,
    align: targets.align,
  });
}

// What takes the list out of a glide: real scrolling input only — a wheel,
// a touch, a press (the scrollbar), or a key the list itself would scroll.
// Shift, Ctrl, Tab and the like leave it be.
const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", " ", "ArrowUp", "ArrowDown"]);
const takesOver = (event: Event) =>
  event.type !== "keydown" ||
  (() => {
    const key = event as KeyboardEvent;
    return (
      SCROLL_KEYS.has(key.key) &&
      !key.defaultPrevented &&
      !key.ctrlKey &&
      !key.altKey &&
      !key.metaKey
    );
  })();
const TAKEOVER = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

// The scroll rides the tint's animation: its eased progress, each frame. A
// hand on the list (wheel, touch, a press on the scrollbar, a key) lets go.
function rideScroll(list: HTMLElement, state: ListState, anim: Animation, to: number) {
  const from = list.scrollTop;
  let frameId = 0;
  const release = () => {
    cancelAnimationFrame(frameId);
    for (const type of TAKEOVER) list.removeEventListener(type, onInput);
    if (state.stopScroll === release) state.stopScroll = null;
  };
  const onInput = (event: Event) => {
    if (takesOver(event)) release();
  };
  const tick = () => {
    const finished = anim.playState === "finished" || anim.playState === "idle";
    const timing = anim.effect?.getComputedTiming();
    // Past the end (no fill) reads as null: that is the end, not the start.
    const done = timing?.progress == null && Number(timing?.localTime) > 0;
    const progress = finished || done ? 1 : (timing?.progress ?? 0);
    list.scrollTop = from + (to - from) * Number(progress);
    if (finished) release();
    else frameId = requestAnimationFrame(tick);
  };
  for (const type of TAKEOVER) list.addEventListener(type, onInput, { passive: true });
  state.stopScroll = release;
  tick();
}

/**
 * Bring the list's current part into view: the tint glides there as the
 * scroll lands. `still` skips the motion (a list shown anew, or an update
 * that isn't a step).
 */
export function glideLyrics(list: HTMLElement, options: { still: boolean }) {
  const state = stateOf(list);
  const tint = tintOf(list);
  const targets = targetsOf(list);
  watchCurrent(state, targets?.block ?? null);
  if (!targets) {
    stop(state);
    state.box = null;
    state.scrollTo = null;
    if (tint) paint(tint, null);
    return;
  }
  if (list.clientHeight === 0) {
    state.centrePending = true; // hidden: the observer measures and centres on show
    return;
  }
  state.centrePending = false;
  const to = boxOf(targets.block, list);
  const scrollTo = scrollToFor(list, targets);
  // An update that isn't a step while a glide is already heading here:
  // leave it be.
  if (options.still && state.anim && sameBox(state.box, to) && state.scrollTo === scrollTo) {
    return;
  }
  const from = tint ? shownBox(tint, state) : null;
  const plan = planGlide({
    still: options.still,
    reduced: prefersReducedMotion(),
    tintTravel: from ? Math.abs(to.y - from.y) : null,
    scrollTravel: Math.abs(scrollTo - list.scrollTop),
    viewport: list.clientHeight,
  });
  stop(state);
  state.box = to;
  state.scrollTo = scrollTo;
  if (tint) paint(tint, to);
  if (plan.scroll === "snap") list.scrollTop = scrollTo;
  if (!tint || typeof tint.animate !== "function") {
    if (plan.scroll === "glide") list.scrollTop = scrollTo;
    snapColour(list);
    return;
  }
  if (plan.tint === "snap" && plan.scroll === "snap") {
    snapColour(list);
    return;
  }

  const style = getComputedStyle(list);
  const duration = Number.parseFloat(style.getPropertyValue("--motion-medium")) || FALLBACK_MS;
  const easing = style.getPropertyValue("--motion-emphasized").trim() || FALLBACK_EASING;
  const start = from ?? to;
  let anim: Animation;
  if (plan.tint === "fade") {
    // Out where it was, in where it is: the offsets hold the move while it
    // is unseen. A tint that was already off screen has nothing to fade
    // out, so the new one fades straight in.
    const top = list.scrollTop;
    const seen = start.y + start.h > top && start.y < top + list.clientHeight;
    anim = seen
      ? tint.animate(
          [
            { ...frame(start), opacity: 1, offset: 0 },
            { ...frame(start), opacity: 0, offset: 0.4 },
            { ...frame(to), opacity: 0, offset: 0.6 },
            { ...frame(to), opacity: 1, offset: 1 },
          ],
          { duration, easing: "linear" },
        )
      : tint.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing });
  } else {
    // A snapped tint with a gliding scroll still needs the clock: it holds
    // still (start equals end). The effect's easing stays the clock the
    // scroll reads; the edges' own timing is in the keyframes.
    const ease = parseEase(easing);
    const boxes = ease && !sameBox(start, to) ? edgeBoxes(start, to, ease) : [start, to];
    anim = tint.animate(
      boxes.map((b, i) => ({ ...frame(b), offset: i / (boxes.length - 1) })),
      { duration, easing },
    );
  }
  state.anim = anim;
  const settle = () => {
    if (state.anim === anim) state.anim = null;
  };
  anim.addEventListener("finish", settle);
  anim.addEventListener("cancel", settle);
  if (plan.tint === "snap") snapColour(list);
  if (plan.scroll === "glide") rideScroll(list, state, anim, scrollTo);
}

/** Back to Current: scroll to the current part, gliding if it is near. */
export function glideBack(list: HTMLElement) {
  glideLyrics(list, { still: false });
}

/**
 * Keep the tint on its block as parts resize (type size, a split, a window
 * or a phone width, a repeat) — measured again, never animated. Returns the
 * stop function.
 */
export function watchTint(list: HTMLElement): () => void {
  if (typeof ResizeObserver !== "function") return () => {};
  const state = stateOf(list);
  const tint = tintOf(list);
  const remeasure = () => {
    const block = list.querySelector<HTMLElement>('[aria-current="step"]');
    watchCurrent(state, block);
    if (!tint) return;
    if (!block) {
      stop(state);
      state.box = null;
      paint(tint, null);
      return;
    }
    const box = boxOf(block, list);
    const centre = state.centrePending && list.clientHeight > 0;
    // A glide under way finishes at the new targets: the scroll never
    // stays part-way.
    const gliding = state.stopScroll !== null;
    const targets = centre || gliding ? targetsOf(list) : null;
    const scrollTo = targets && list.clientHeight > 0 ? scrollToFor(list, targets) : null;
    if (sameBox(box, state.box) && !centre && (!gliding || scrollTo === state.scrollTo)) return;
    stop(state);
    state.box = box;
    paint(tint, box);
    if (scrollTo !== null) {
      state.centrePending = false;
      state.scrollTo = scrollTo;
      list.scrollTop = scrollTo;
    }
  };
  const observer = new ResizeObserver(remeasure);
  state.observer = observer;
  const seq = list.querySelector(".seq-list");
  if (seq) observer.observe(seq);
  observer.observe(list);
  watchCurrent(state, list.querySelector('[aria-current="step"]'));
  return () => {
    observer.disconnect();
    state.observer = null;
    state.watched = null;
    stop(state);
    states.delete(list);
  };
}
