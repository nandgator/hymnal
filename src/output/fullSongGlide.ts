// The Full Song tint's motion (SDD-0005 § 4). The geometry is the Lyrics
// tint's (lyricsGlide.ts, glideGeometry.ts): a layer placed by translate,
// width and height over a part's box, glided by Web Animations.
//
// - slide: within a column, one layer slides and resizes, its leading edge
//   first (`edgeBoxes`), as This Song's tint does.
// - cross: to another column, a fade, overlapped so some part is always lit:
//   the old tint (a ghost layer) fades out in place over the first 60%, the
//   new one fades in from the 20% mark, travelling from the left.
// - turn: to another page, the tint goes with its page, a cross-dissolve as
//   the pages' is: the old one fades out in place as the new one rises 12px
//   into place and fades in, over the same time and easing (the two sum to
//   one), never travelling sideways. A tint that stays where it is (the same
//   box on both pages) is not touched.
// - snap: at once, the tint re-measured. Reduced motion is always this.

import {
  type Box,
  frame,
  glideTiming,
  onSettle,
  paint,
  prefersReducedMotion,
  sameBox,
  shownBox,
} from "../presenter/glideGeometry.ts";
import { edgeBoxes, parseEase } from "../presenter/lyricsGlide.ts";

export type TintStep = "snap" | "slide" | "cross" | "turn";

/** Where the incoming tint starts its travel, in em, left of its place. */
export const CROSS_TRAVEL_EM = 1.6;
/** The outgoing tint is gone by this share of the glide... */
export const CROSS_OUT = 0.6;
/** ...and the incoming one starts at this share, so the two overlap. */
export const CROSS_IN_START = 0.2;

export interface TintLayers {
  tint: HTMLElement;
  ghost: HTMLElement;
}

export interface TintState {
  /** Where the tint settles, whatever is animating. */
  box: Box | null;
  anims: Animation[];
}

export const newTintState = (): TintState => ({ box: null, anims: [] });

function stop(layers: TintLayers, state: TintState) {
  for (const anim of state.anims) anim.cancel();
  state.anims = [];
  layers.ghost.style.display = "none";
  layers.tint.style.opacity = "";
}

/** A page turn: the old tint fades out over the whole glide as the new one
 * fades in over the same, in the same easing, so their opacities sum to one:
 * the screen is never blank, and never two clear marks at once. The new one
 * rises this many px. */
export const TURN_OUT = 1;
export const TURN_IN_START = 0;
export const TURN_RISE_PX = 12;

/** The geometry of a cross-column fade, as keyframes (pure, for tests); a
 * page turn's has no travel, and rises instead. */
export function crossFrames(from: Box, to: Box, em: number, travel = CROSS_TRAVEL_EM, rise = 0) {
  const ghost: Keyframe[] = [
    { ...frame(from), opacity: 1 },
    { ...frame(from), opacity: 0 },
  ];
  const tint: Keyframe[] = [
    { ...frame({ ...to, x: to.x - travel * em, y: to.y + rise }), opacity: 0 },
    { ...frame(to), opacity: 1 },
  ];
  return { ghost, tint };
}

/**
 * Move the tint to `to` (null: hide it). `em` is the type's size in px, for
 * the travel. A glide begun mid-glide starts from where the tint is drawn.
 */
export function placeTint(
  layers: TintLayers,
  state: TintState,
  to: Box | null,
  step: TintStep,
  em: number,
) {
  const { tint, ghost } = layers;
  const was = state.anims.length > 0 ? shownBox(tint, state.anims[0], state.box) : state.box;
  stop(layers, state);
  state.box = to;
  paint(tint, to);
  if (!to || step === "snap" || !was || sameBox(was, to) || prefersReducedMotion()) return;
  if (typeof tint.animate !== "function") return;
  const { duration, easing } = glideTiming(tint);
  if (step === "slide") {
    const ease = parseEase(easing);
    const boxes = ease ? edgeBoxes(was, to, ease) : [was, to];
    const anim = tint.animate(
      boxes.map((b, i) => ({ ...frame(b), offset: i / (boxes.length - 1) })),
      { duration, easing: ease ? easing : "linear" },
    );
    state.anims = [anim];
    onSettle(anim, () => {
      state.anims = state.anims.filter((a) => a !== anim);
    });
    return;
  }
  // A turn runs with its pages: a handoff, the new tint rising into place.
  const turn = step === "turn";
  const outShare = turn ? TURN_OUT : CROSS_OUT;
  const inStart = turn ? TURN_IN_START : CROSS_IN_START;
  const frames = crossFrames(was, to, em, turn ? 0 : CROSS_TRAVEL_EM, turn ? TURN_RISE_PX : 0);
  paint(ghost, was);
  const out = ghost.animate(frames.ghost, {
    duration: duration * outShare,
    easing,
    fill: "forwards",
  });
  const into = tint.animate(frames.tint, {
    duration: duration * (1 - inStart),
    delay: duration * inStart,
    easing,
    fill: "backwards",
  });
  state.anims = [into, out];
  onSettle(out, () => {
    if (state.anims.includes(out)) ghost.style.display = "none";
  });
  onSettle(into, () => {
    state.anims = state.anims.filter((a) => a !== into && a !== out);
  });
}
