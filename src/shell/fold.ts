/**
 * The change between the wide and phone layouts (DESIGN.md § Motion): when
 * the window crosses 840px, MD3's fade-through, rather than the screen
 * jumping. The old screen fades out, then the new one fades in and settles.
 *
 * Not a View Transition: Chromium skips one on any viewport resize, and
 * crossing 840px is one. So a still copy of the old screen is laid over the
 * new one and faded. Nothing is paired or moved: the two layouts share too
 * little (the stage becomes the Live strip and the dock, the lyrics have no
 * phone counterpart while Parts shows), and a window still being dragged
 * would leave anything placed by measure stranded. The switcher row stays:
 * it is one row either way.
 */

import { stillCopy } from "./still.ts";

/** MD3's fade-through: out quickly, then in, zooming in from 92%, as MD3 specifies. */
export const OUT_MS = 90;
export const IN_MS = 210;
const EMPHASIZED_DECELERATE = "cubic-bezier(0.05, 0.7, 0.1, 1)";
const SETTLE_FROM = 0.92;
/** A slight blur, leaving and arriving, so the change reads as focus. */
const BLUR = "4px";

let running: (() => void) | undefined;
let pending = false;

/** A still copy of the screen, for the fade. */
function copyOf(shell: HTMLElement) {
  const { copy, settle } = stillCopy(shell);
  // An open sheet stays in the top layer, above the fade; its copy would
  // only draw again, out of place.
  for (const dialog of copy.querySelectorAll("dialog")) dialog.remove();
  // The live row shows through: it never left.
  copy.querySelector<HTMLElement>(".switcher-row")?.style.setProperty("visibility", "hidden");
  return { copy, settle };
}

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * Call as the layout is about to change, before any of it has: from the
 * first media-query listener to hear of the crossing. It copies the old
 * screen now and plays once every listener has applied its change, in the
 * same frame, before it's painted.
 */
export function foldBeforeChange() {
  if (pending || reduced() || typeof requestAnimationFrame !== "function") return;
  const shell = document.querySelector<HTMLElement>(".shell");
  if (!shell || typeof shell.animate !== "function") return;
  running?.();
  pending = true;
  const { copy, settle } = copyOf(shell);
  requestAnimationFrame(() => {
    pending = false;
    play(shell, copy, settle);
  });
}

function play(shell: HTMLElement, copy: HTMLElement, settle: () => void) {
  const layer = document.createElement("div");
  layer.className = "fold-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.append(copy);
  document.body.append(layer);
  settle();

  const animations = [
    copy.animate(
      [
        { opacity: 1, filter: "blur(0px)" },
        { opacity: 0, filter: `blur(${BLUR})` },
      ],
      {
        duration: OUT_MS,
        easing: "linear",
        fill: "both",
      },
    ),
    ...[...shell.querySelectorAll<HTMLElement>(":scope > .nav-rail, .workspace")].map((el) =>
      el.animate(
        [
          {
            opacity: 0,
            transform: el.matches(".workspace") ? `scale(${SETTLE_FROM})` : "none",
            filter: `blur(${BLUR})`,
          },
          { opacity: 1, transform: "none", filter: "blur(0px)" },
        ],
        { duration: IN_MS, delay: OUT_MS, easing: EMPHASIZED_DECELERATE, fill: "both" },
      ),
    ),
  ];

  const done = () => {
    running = undefined;
    for (const animation of animations) animation.cancel();
    layer.remove();
  };
  running = done;
  // The copy is gone once it has faded; the rest finish on their own.
  animations[0].finished.then(
    () => layer.remove(),
    () => {},
  );
  Promise.all(animations.map((a) => a.finished)).then(done, () => {});
}
