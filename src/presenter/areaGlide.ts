const MS = 250;
const EASING = "cubic-bezier(0.2, 0, 0, 1)";

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
 * text reflows as the panel does and the two widths always sum to the row. A
 * group that appears grows from nothing and fades in; one that closes just
 * goes (a fading copy would lay its wrapping over the survivor's). `apply`
 * runs the state change; reduced motion, or a row that isn't on the page
 * (the phone, a test), just applies it.
 */
export function glideAreas(row: HTMLElement | undefined, apply: () => void): void {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!row?.isConnected || reduced || typeof row.animate !== "function") {
    apply();
    return;
  }
  for (const el of areasOf(row)) for (const a of el.getAnimations()) a.cancel();
  const before = new Map(areasOf(row).map((el) => [el, el.getBoundingClientRect().width]));
  apply();
  const timing = { duration: MS, easing: EASING };
  for (const el of areasOf(row)) {
    const was = before.get(el);
    const to = el.getBoundingClientRect().width;
    if (was === to) continue;
    const fixed = { flexGrow: 0, flexShrink: 0 };
    el.animate(
      [
        { ...fixed, flexBasis: `${was ?? 0}px`, ...(was === undefined ? { opacity: 0 } : {}) },
        { ...fixed, flexBasis: `${to}px`, ...(was === undefined ? { opacity: 1 } : {}) },
      ],
      timing,
    );
  }
}
