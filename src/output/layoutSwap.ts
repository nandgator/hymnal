// The change between the Output's two layouts, the whole song and the
// part-by-part scroll (SDD-0005 § 6): the new one settles in with the Operator
// cards' soft zoom (`tab-in`: from 98.5%, in the app's medium time at the
// emphasised easing) while a still copy of the old one fades away over it.
// The new layout is whole under the copy from the first frame, so the screen
// is never blank, and the copy fades as the new one settles, so they are
// never both clear for long. Reduced motion: the fade alone.

import { glideTiming, prefersReducedMotion } from "../presenter/glideGeometry.ts";
import { stillCopy } from "../shell/still.ts";

/** What the new layout starts from: `tab-in`'s scale (styles.css). */
export const SWAP_FROM_SCALE = 0.985;

/** Each view's swap under way, to end it. */
const leaving = new WeakMap<HTMLElement, () => void>();

/** Ends a view's swap at once, its copy gone: the view went dark, or went. */
export function cancelSwap(view: HTMLElement): void {
  leaving.get(view)?.();
}

/**
 * Call as the layout is about to change, before the DOM does: it copies the
 * view as it is and lays the copy over it, then fades the copy out and settles
 * the view. Nothing happens where there is no animation (a test's DOM).
 */
export function swapLayouts(view: HTMLElement): void {
  if (typeof view.animate !== "function") return;
  // A swap begun during another ends it: the copy of that one goes at once.
  cancelSwap(view);
  const rect = view.getBoundingClientRect();
  const { copy, settle } = stillCopy(view);
  copy.classList.add("output-swap");
  copy.setAttribute("aria-hidden", "true");
  Object.assign(copy.style, {
    position: "fixed",
    inset: "auto",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  document.body.append(copy);
  settle();

  const { duration, easing } = glideTiming(view);
  const fade = copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing, fill: "both" });
  const zoom = prefersReducedMotion()
    ? undefined
    : view.animate([{ transform: `scale(${SWAP_FROM_SCALE})` }, { transform: "scale(1)" }], {
        duration,
        easing,
      });
  const done = () => {
    leaving.delete(view);
    fade.cancel();
    zoom?.cancel();
    copy.remove();
  };
  leaving.set(view, done);
  fade.finished.then(
    () => {
      if (leaving.get(view) === done) done();
    },
    () => {},
  );
}
