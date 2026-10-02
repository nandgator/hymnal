// The Full Song tint's motion (SDD-0005 § 4). The geometry is the Lyrics
// tint's (lyricsGlide.ts, glideGeometry.ts): a layer placed by translate,
// width and height over a part's box, glided by Web Animations.
//
// - slide: within a column, one layer slides and resizes, its leading edge
//   first (`edgeBoxes`), as This Song's tint does.
// - cross: to another column, a fade, overlapped so some part is always lit:
//   the old tint (a ghost layer) fades out in place over the first 60%, the
//   new one fades in from the 20% mark, travelling from the left.
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

export type TintStep = "snap" | "slide" | "cross";

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

/** The geometry of a cross-column fade, as keyframes (pure, for tests). */
export function crossFrames(from: Box, to: Box, em: number) {
  const ghost: Keyframe[] = [
    { ...frame(from), opacity: 1 },
    { ...frame(from), opacity: 0 },
  ];
  const tint: Keyframe[] = [
    { ...frame({ ...to, x: to.x - CROSS_TRAVEL_EM * em }), opacity: 0 },
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
  const frames = crossFrames(was, to, em);
  paint(ghost, was);
  const out = ghost.animate(frames.ghost, {
    duration: duration * CROSS_OUT,
    easing,
    fill: "forwards",
  });
  const into = tint.animate(frames.tint, {
    duration: duration * (1 - CROSS_IN_START),
    delay: duration * CROSS_IN_START,
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
