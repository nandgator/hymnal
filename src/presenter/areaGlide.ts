const MS = 250;
const EASING = "cubic-bezier(0.2, 0, 0, 1)";
// A closing group's text goes in a few frames; then only the empty panel shrinks.
const TEXT_OUT_MS = 80;

const areasOf = (row: HTMLElement) =>
  [...row.children].filter(
    (el): el is HTMLElement => el.classList.contains("area") && !el.classList.contains("stage"),
  );

/**
 * Expanding, collapsing, closing or splitting glides the tab groups to their
 * new widths (SDD-0001 §16.4, DESIGN.md § Motion). Plain size animations in
 * the page, not a View Transition: that snapshots each area and cross-fades
 * the old and new snapshots, so the lyrics showed twice at two wrappings for
 * three frames, and a snapshot taken while the panel resized tore. Here the
 * one real element's flex-basis moves from its old width to its new, so the
 * text reflows as the panel does and the widths always sum to the row.
 *
 * A group that appears grows from nothing and fades in. One that closes
 * collapses in its own slot: the state change removes its element at once,
 * which would leave a gap the survivor then glided across, so an inert copy
 * of it stays in the row and shrinks to nothing while the survivor grows by
 * the same amount. Its text goes in the first few frames and, at a fixed
 * width inside the clipped, shrinking panel, never rewraps over the
 * survivor's (a copy faded over the survivor did). Flex `gap` is part of
 * the sum: an item at zero width still has its gap, so the one that comes or
 * goes pulls it in with a negative margin as it shrinks. The survivor's
 * content is the same text in another slot, so a tab's zoom-in, which a
 * remount would replay, is cancelled: only the panels move. `apply` runs the
 * state change; reduced motion, or a row that isn't on the page (the phone,
 * a test), just applies it.
 */
export function glideAreas(row: HTMLElement | undefined, apply: () => void): void {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!row?.isConnected || reduced || typeof row.animate !== "function") {
    apply();
    return;
  }
  for (const el of areasOf(row)) for (const a of el.getAnimations()) a.cancel();
  const olds = areasOf(row);
  const before = new Map(olds.map((el) => [el, el.getBoundingClientRect().width]));
  const oldMain = olds.find((el) => el.classList.contains("area-main"));
  const oldMainWidth = oldMain ? before.get(oldMain) : undefined;
  const leaving = olds.length === 2 ? olds.find((el) => el !== oldMain) : undefined;
  const leavingWas = leaving ? before.get(leaving) : undefined;
  const leavingBefore = leaving && oldMain ? olds.indexOf(leaving) < olds.indexOf(oldMain) : false;
  const copy = leaving?.cloneNode(true) as HTMLElement | undefined;
  apply();
  const after = areasOf(row);
  const closed = after.length < olds.length;
  const opened = after.length > olds.length;
  const gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
  const timing = { duration: MS, easing: EASING };
  const fixed = { flexGrow: 0, flexShrink: 0 };
  if (closed || opened) {
    for (const a of row.getAnimations({ subtree: true })) {
      if ((a as CSSAnimation).animationName === "tab-in") a.cancel();
    }
  }
  for (const el of after) {
    // Closing or splitting, a slot's width says nothing about the group now
    // in it: the main group is the one that was main, and the other is new.
    const main = el.classList.contains("area-main");
    const was = closed || opened ? (main ? oldMainWidth : undefined) : before.get(el);
    const to = el.getBoundingClientRect().width;
    if (was === to) continue;
    const entering = was === undefined;
    el.animate(
      [
        {
          ...fixed,
          flexBasis: `${was ?? 0}px`,
          ...(entering ? { opacity: 0, marginInlineEnd: `${-gap}px` } : {}),
        },
        {
          ...fixed,
          flexBasis: `${to}px`,
          ...(entering ? { opacity: 1, marginInlineEnd: "0px" } : {}),
        },
      ],
      timing,
    );
  }
  if (!closed || !copy || leavingWas === undefined) return;
  copy.removeAttribute("id");
  for (const el of copy.querySelectorAll("[id]")) el.removeAttribute("id");
  copy.setAttribute("aria-hidden", "true");
  copy.setAttribute("inert", "");
  copy.classList.remove("area-main");
  copy.style.overflow = "hidden";
  // The panel narrows around text that keeps its width, clipped.
  for (const part of copy.children) {
    if (part instanceof HTMLElement) {
      part.style.width = `${leavingWas}px`;
      part.style.flex = "none";
    }
  }
  for (const el of copy.querySelectorAll<HTMLElement>(".area-tab-content")) {
    el.style.animation = "none";
  }
  const survivor = after[0];
  row.insertBefore(copy, leavingBefore ? survivor : survivor.nextSibling);
  for (const part of copy.children) {
    part.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: TEXT_OUT_MS,
      easing: "linear",
      fill: "forwards",
    });
  }
  const shrink = copy.animate(
    [
      { ...fixed, flexBasis: `${leavingWas}px`, marginInlineEnd: "0px" },
      { ...fixed, flexBasis: "0px", marginInlineEnd: `${-gap}px` },
    ],
    timing,
  );
  const remove = () => copy.remove();
  shrink.finished.then(remove, remove);
}
