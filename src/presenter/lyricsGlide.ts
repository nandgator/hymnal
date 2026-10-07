// The Lyrics list's current-part tint, and the scroll that centres it.
//
// The tint is one layer (`.seq-tint`, behind the text) that slides and
// resizes from the old part to the new one, its leading edge arriving before
// its trailing edge (it stretches over the new part, then lets go of the
// old), landing together with the scroll as ONE motion: a single Web
// Animation is the clock, and the scroll reads its eased progress each
// frame, so the two can never drift apart (and a paused, seeked animation
// moves both). A step far from where the tint is (a wrap), or with a far scroll,
// doesn't travel through the song: the tint fades out where it was, the
// scroll lands unseen in the middle, and the tint fades in at the new part. A list shown
// anew, and reduced motion, show the end state. The text's colour change
// keeps to the tint: it eases with the glide and the fade-in (styles.css),
// and goes at once when the tint snaps (`data-tint` on the list).

import {
  type Box,
  boxOf,
  frame,
  glideTiming,
  onSettle,
  paint,
  prefersReducedMotion,
  sameBox,
  shownBox,
} from "./glideGeometry.ts";

export type TintMode = "snap" | "glide" | "fade";
// "land": the list holds while the card fades out where it was, lands unseen
// at the middle of the fade, and the card fades in at its new part.
export type ScrollMode = "snap" | "glide" | "land";

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
  // Back to Current: the scroll glides however far it is.
  back?: boolean;
}

/** What a step does: glide, fade (a far jump) or snap. Pure, for tests. */
export function planGlide(input: GlideInput): GlidePlan {
  if (input.still || input.reduced) return { tint: "snap", scroll: "snap" };
  const far = (travel: number) => travel > input.viewport;
  const farScroll = far(input.scrollTravel) && !input.back;
  if (input.tintTravel === null) return { tint: "snap", scroll: farScroll ? "snap" : "glide" };
  // A card that has not moved has nothing to ease: a far scroll just lands
  // (Back to Current glides it instead).
  if (input.tintTravel === 0 && farScroll) return { tint: "glide", scroll: "snap" };
  // A far card jump (a wrap) or a far scroll never travels through the song,
  // and never snaps the list under a card that is still easing (that read as
  // a jerk): the card leaves where it was, the list lands, the card arrives.
  if (far(input.tintTravel) || farScroll) return { tint: "fade", scroll: "land" };
  return { tint: "glide", scroll: "glide" };
}

/** How long Back to Current takes: the app's duration for a screen or less;
 * beyond a screen, 80ms more for every 1000px, to at most 450ms more, so a
 * long way is still seen going. */
export function backDuration(base: number, travel: number, viewport: number): number {
  return base + Math.min(450, Math.max(0, travel - viewport) * 0.08);
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
 * The edges lead and trail as the eye sees them: the list scrolls under the
 * card in the same motion (`scroll`, the list's scrollTop at the two ends,
 * moving with the progress), and an edge eased in the list's own frame would
 * lunge against that scroll and fall back, a jerk before the card settled. So
 * each edge is eased in screen space, from where it is drawn to where it will
 * be, and the scroll is added back to give its place in the list.
 * Pure, for tests.
 */
export function edgeBoxes(
  from: Box,
  to: Box,
  ease: (t: number) => number,
  steps = EDGE_STEPS,
  scroll: { from: number; to: number } = { from: 0, to: 0 },
): Box[] {
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  const top0 = from.y - scroll.from;
  const top1 = to.y - scroll.to;
  const bottom0 = from.y + from.h - scroll.from;
  const bottom1 = to.y + to.h - scroll.to;
  // Which way the card travels, as seen: the leading edge goes that way.
  const seenDown = top1 + bottom1 - (top0 + bottom0);
  const down = seenDown === 0 ? to.y >= from.y : seenDown > 0;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const p = i / steps;
    const lead = i === steps ? 1 : ease(Math.min(1, invert(ease, p) / LEAD));
    const at = lerp(scroll.from, scroll.to, p);
    const top = lerp(top0, top1, down ? p : lead) + at;
    const bottom = lerp(bottom0, bottom1, down ? lead : p) + at;
    return {
      x: lerp(from.x, to.x, p),
      y: top,
      w: lerp(from.w, to.w, p),
      h: Math.max(0, bottom - top),
    };
  });
}

const tintOf = (list: HTMLElement) =>
  list.querySelector<HTMLElement>(":scope > .seq-tint") ?? undefined;

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
// With `land`, the list holds until the middle of the animation and lands
// there, while the card is faded out.
function rideScroll(
  list: HTMLElement,
  state: ListState,
  anim: Animation,
  to: number,
  land = false,
) {
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
    const at = land ? (Number(progress) >= 0.5 ? 1 : 0) : Number(progress);
    list.scrollTop = from + (to - from) * at;
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
export function glideLyrics(list: HTMLElement, options: { still: boolean; back?: boolean }) {
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
  const scrolledFrom = list.scrollTop;
  const from = tint ? shownBox(tint, state.anim, state.box) : null;
  const plan = planGlide({
    still: options.still,
    reduced: prefersReducedMotion(),
    tintTravel: from ? Math.abs(to.y - from.y) : null,
    scrollTravel: Math.abs(scrollTo - list.scrollTop),
    viewport: list.clientHeight,
    back: options.back,
  });
  stop(state);
  state.box = to;
  state.scrollTo = scrollTo;
  if (tint) paint(tint, to);
  const start = from ?? to;
  // The old card is on screen, to fade out there (before the list moves).
  const seen = start.y + start.h > scrolledFrom && start.y < scrolledFrom + list.clientHeight;
  const lands = plan.scroll === "land" && seen;
  if (plan.scroll === "snap" || (plan.scroll === "land" && !seen)) list.scrollTop = scrollTo;
  if (!tint || typeof tint.animate !== "function") {
    if (plan.scroll !== "snap") list.scrollTop = scrollTo;
    snapColour(list);
    return;
  }
  if (plan.tint === "snap" && plan.scroll === "snap") {
    snapColour(list);
    return;
  }

  const timing = glideTiming(list);
  const { easing } = timing;
  const duration = options.back
    ? backDuration(timing.duration, Math.abs(scrollTo - scrolledFrom), list.clientHeight)
    : timing.duration;
  let anim: Animation;
  if (plan.tint === "fade") {
    // Out where it was, in where it is: the offsets hold the move while it
    // is unseen, and the list lands in the middle of them. A tint that was
    // already off screen has nothing to fade out, so the new one fades
    // straight in.
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
    const boxes =
      ease && !sameBox(start, to)
        ? edgeBoxes(start, to, ease, EDGE_STEPS, { from: scrolledFrom, to: scrollTo })
        : [start, to];
    anim = tint.animate(
      boxes.map((b, i) => ({ ...frame(b), offset: i / (boxes.length - 1) })),
      { duration, easing },
    );
  }
  state.anim = anim;
  const settle = () => {
    if (state.anim === anim) state.anim = null;
  };
  onSettle(anim, settle);
  if (plan.tint === "snap") snapColour(list);
  if (plan.scroll === "glide") rideScroll(list, state, anim, scrollTo);
  else if (lands) rideScroll(list, state, anim, scrollTo, true);
}

/** Back to Current: scroll to the current part, gliding if it is near. */
export function glideBack(list: HTMLElement) {
  glideLyrics(list, { still: false, back: true });
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
