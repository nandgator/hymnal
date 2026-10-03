// The selected item's tonal pill, for any list or group of choices (the rail,
// the Library's books, a choice menu, a segmented button, the output
// themes): one layer behind the items that glides from the old selection's
// box to the new one's, softening to a 2px blur at the middle of the move,
// crisp on landing. It is the parts pad's pill (padGlide.ts) made general:
// the same geometry, the same plan (a glide only from a pill that is
// showing; reduced motion fades it up instead), the same timing.
//
// What it watches is the DOM: a `current` item appearing, or the attribute
// that marks it moving to another item, glides the pill; the container or
// the item changing size moves it without animating. A radio's `:checked`
// is a property, not an attribute, so a caller whose selection is one calls
// `sync()` when it changes.

import {
  type Box,
  boxOf,
  forcedColors,
  glideBox,
  paint,
  prefersReducedMotion,
  sameBox,
  shownBox,
} from "../presenter/glideGeometry.ts";
import { planPad } from "../presenter/padGlide.ts";

/** The pill alone softens (px) at the middle of a glide; the labels above it
 * stay sharp. Not under forced colours, where the pill is a system colour. */
export const PILL_BLUR = 2;
const FADE_MS = 150;

export const SELECTED =
  '[aria-current="page"], [aria-current="true"], [aria-selected="true"], [aria-pressed="true"], [aria-checked="true"]';

export interface SelectGlideOptions {
  /** What marks the selected item (default: the ARIA states of a selection). */
  current?: string;
  /** The element whose box the pill takes (default: the item itself). */
  target?: (item: HTMLElement) => HTMLElement | null;
  /** The pill's class, for its look (default `select-pill`). */
  className?: string;
}

export interface SelectGlide {
  /** Measures again and glides if the selected item has changed: for a
   * selection the DOM doesn't announce. */
  sync(): void;
  /** Removes the pill and the observers. */
  stop(): void;
}

/** A box with no layout (its container hidden) has nothing to mark. */
const shown = (box: Box) => box.w > 0 && box.h > 0;

/**
 * `container` must be positioned and isolated (the pill sits at z-index -1
 * in it, by layout offsets), and its items must paint no selection fill of
 * their own: the stylesheet takes that away from any container marked
 * `data-select-glide`, which this sets.
 */
export function selectGlide(container: HTMLElement, options: SelectGlideOptions = {}): SelectGlide {
  const selector = options.current ?? SELECTED;
  const pill = document.createElement("div");
  pill.className = options.className ?? "select-pill";
  pill.setAttribute("aria-hidden", "true");
  container.prepend(pill);
  container.dataset.selectGlide = "";

  let item: HTMLElement | null = null;
  let box: Box | null = null;
  let anim: Animation | null = null;

  const stopAnim = () => {
    anim?.cancel();
    anim = null;
  };

  const hidePill = () => {
    stopAnim();
    box = null;
    item = null;
    paint(pill, null);
  };

  const sync = () => {
    const next = container.querySelector<HTMLElement>(selector);
    const target = next ? (options.target ? options.target(next) : next) : null;
    const to = target ? boxOf(target, container) : null;
    if (!next || !to || !shown(to)) {
      hidePill();
      return;
    }
    // The same item, in the same place or heading there: nothing to do. The
    // same item elsewhere (the list reflowed): it lands at once.
    if (next === item && sameBox(box, to)) return;
    const stepped = next !== item;
    const from = stepped ? shownBox(pill, anim, box) : null;
    const reduced = prefersReducedMotion();
    const mode = planPad({ still: false, reduced: false, from });
    stopAnim();
    item = next;
    box = to;
    paint(pill, to);
    if (!stepped || mode === "snap" || !from || typeof pill.animate !== "function") return;
    if (reduced) {
      // No glide, no blur: the pill fades up where the selection now is.
      anim = pill.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: FADE_MS,
        easing: "linear",
      });
      return;
    }
    const gliding = glideBox(
      pill,
      from,
      to,
      () => {
        if (anim === gliding) anim = null;
      },
      forcedColors() ? 0 : PILL_BLUR,
    );
    anim = gliding;
  };

  const mutations = new MutationObserver(sync);
  mutations.observe(container, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "aria-current",
      "aria-selected",
      "aria-pressed",
      "aria-checked",
      "data-current",
      "hidden",
    ],
  });
  const resizes = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
  resizes?.observe(container);
  sync();

  return {
    sync,
    stop: () => {
      mutations.disconnect();
      resizes?.disconnect();
      stopAnim();
      pill.remove();
      delete container.dataset.selectGlide;
    },
  };
}
