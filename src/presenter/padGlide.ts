// The parts pad's current-key highlight: one pill behind the keys that
// glides from the old key's box to the new one's, whatever caused the step
// (a key, Part and Line, the keyboard, digits). It lands at once where
// there is nothing to glide from — the pad shown anew, another song — and
// under reduced motion. A pad that resizes or reflows keeps the pill on its
// key by measuring again, never animating.

import {
  type Box,
  boxOf,
  glideBox,
  paint,
  prefersReducedMotion,
  sameBox,
  shownBox,
} from "./glideGeometry.ts";

export type PadMode = "snap" | "glide";

/** Glide only from a pill that is showing, on a step in the same song. */
export function planPad(input: { still: boolean; reduced: boolean; from: Box | null }): PadMode {
  return input.still || input.reduced || !input.from ? "snap" : "glide";
}

interface PadState {
  box: Box | null;
  anim: Animation | null;
  observer: ResizeObserver | null;
  watched: Element | null;
}

const states = new WeakMap<HTMLElement, PadState>();
const stateOf = (pad: HTMLElement): PadState => {
  let state = states.get(pad);
  if (!state) {
    state = { box: null, anim: null, observer: null, watched: null };
    states.set(pad, state);
  }
  return state;
};

const pillOf = (pad: HTMLElement) =>
  pad.querySelector<HTMLElement>(":scope > .chip-pill") ?? undefined;
const currentOf = (pad: HTMLElement) =>
  pad.querySelector<HTMLElement>('.chip-filter[aria-pressed="true"]') ?? undefined;

function stop(state: PadState) {
  state.anim?.cancel();
  state.anim = null;
}

function watchKey(state: PadState, key: Element | undefined) {
  if (!state.observer || state.watched === key) return;
  if (state.watched) state.observer.unobserve(state.watched);
  state.watched = key ?? null;
  if (key) state.observer.observe(key);
}

// A key with no layout (its tab hidden, display: none) has no box to mark:
// the pill waits, and the observer places it, unanimated, on show.
const shown = (box: Box) => box.w > 0 && box.h > 0;

/** Put the pill on the current key: a glide from where it is, or at once
 * (`still`: the pad shown anew, or another song). */
export function placePad(pad: HTMLElement, options: { still: boolean }) {
  const state = stateOf(pad);
  const pill = pillOf(pad);
  const key = currentOf(pad);
  watchKey(state, key);
  if (!pill) return;
  if (!key) {
    stop(state);
    state.box = null;
    paint(pill, null);
    return;
  }
  const to = boxOf(key, pad);
  if (!shown(to)) {
    stop(state);
    state.box = null;
    paint(pill, null);
    return;
  }
  // An update that isn't a step: the pill is already there, or heading there.
  if (sameBox(state.box, to)) return;
  const from = shownBox(pill, state.anim, state.box);
  const mode = planPad({ still: options.still, reduced: prefersReducedMotion(), from });
  stop(state);
  state.box = to;
  paint(pill, to);
  if (mode === "snap" || !from || typeof pill.animate !== "function") return;
  const anim = glideBox(pill, from, to, () => {
    if (state.anim === anim) state.anim = null;
  });
  state.anim = anim;
}

/** Keep the pill on its key as the pad reflows (a window or phone width, the
 * Repeat row, a type size) — measured again, never animated. Returns the
 * stop function. */
export function watchPad(pad: HTMLElement): () => void {
  if (typeof ResizeObserver !== "function") return () => {};
  const state = stateOf(pad);
  const pill = pillOf(pad);
  const remeasure = () => {
    const key = currentOf(pad);
    watchKey(state, key);
    if (!pill) return;
    const box = key ? boxOf(key, pad) : null;
    if (!box || !shown(box)) {
      stop(state);
      state.box = null;
      paint(pill, null);
      return;
    }
    // Where it is going already: a glide under way carries on.
    if (sameBox(box, state.box)) return;
    // Elsewhere: a glide under way lands at once at the new place.
    stop(state);
    state.box = box;
    paint(pill, box);
  };
  const observer = new ResizeObserver(remeasure);
  state.observer = observer;
  observer.observe(pad);
  const keys = pad.querySelector("ul");
  if (keys) observer.observe(keys);
  watchKey(state, currentOf(pad));
  return () => {
    observer.disconnect();
    state.observer = null;
    state.watched = null;
    stop(state);
    states.delete(pad);
  };
}
