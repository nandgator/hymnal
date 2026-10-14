import { onCleanup } from "solid-js";

/**
 * Every scroll region that fades its top and bottom edge in proportion to how far it can
 * scroll that way (DESIGN.md § Register). styles.css lists the same selectors in its one
 * shared fade rule (a test holds the two together). Where the browser has scroll-driven
 * animations the CSS alone does it; this is for the rest.
 */
export const FADE_REGIONS = [
  ".shell-main",
  ".area-body",
  ".sheet-content",
  ".sequence",
  ".stage .parts-navigator > section",
  ".present-switcher .finder",
];

/**
 * Floating lists (menus, pickers) fade the same way but not by a mask, which would clip their
 * shadow: sticky strips of their own surface lie over the first and last rows, and their opacity
 * is the fade. The helper sets `--strip-a` and `--strip-b` on them.
 */
export const FADE_STRIP_REGIONS = [".menu-popover", ".pick-list"];

/** The distance (px) over which a fade grows from nothing to full. Keep in step with styles.css. */
export const FADE_RAMP = 24;

/**
 * A scroll fade's own animation (styles.css), which runs as long as the region exists. Code
 * that waits for "the animations in this element to finish" must not wait for it.
 */
export const isScrollFade = (animation: Animation) =>
  (animation as CSSAnimation).animationName?.startsWith("scroll-fade") === true;

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * The two strengths for a region, in scroll order: `a` how much has been scrolled away from
 * the start (0 at the start, 1 from the ramp on), `b` how much is still ahead (1 until the
 * last ramp's distance, 0 at the end). A region that does not scroll has neither. The sign
 * of `scrollTop` is dropped: a column-reverse region (the quick switcher) counts from where
 * it starts, as scroll-driven animations do.
 */
export function fadeStrengths(scrollTop: number, scrollHeight: number, clientHeight: number) {
  const max = scrollHeight - clientHeight;
  if (!(max > 0)) return { a: 0, b: 0 };
  const done = Math.abs(scrollTop);
  return { a: clamp(done / FADE_RAMP), b: clamp((max - done) / FADE_RAMP) };
}

/**
 * The fallback for browsers without scroll-driven animations: sets `--fade-a` and
 * `--fade-b` on each region (`--strip-a` and `--strip-b` on a floating list), which the shared CSS
 * rules turn into its two edge fades. One
 * passive capturing scroll listener for the document, one rAF per frame whatever the
 * number of events, and a layout read (three numbers) only for the region that scrolled;
 * every region is looked at again only when the DOM or the window changes.
 */
export function installScrollFade(): void {
  if (typeof CSS === "undefined" || CSS.supports?.("animation-timeline: scroll()")) return;
  const regionSelector = [...FADE_REGIONS, ...FADE_STRIP_REGIONS].join(", ");
  const stripSelector = FADE_STRIP_REGIONS.join(", ");
  const last = new WeakMap<Element, string>();
  const pending = new Set<Element>();
  let all = false;
  let frame = 0;

  const apply = (el: Element) => {
    const { a, b } = fadeStrengths(el.scrollTop, el.scrollHeight, el.clientHeight);
    const key = `${a.toFixed(3)} ${b.toFixed(3)}`;
    if (last.get(el) === key) return;
    last.set(el, key);
    const names = el.matches(stripSelector) ? ["--strip-a", "--strip-b"] : ["--fade-a", "--fade-b"];
    (el as HTMLElement).style.setProperty(names[0] as string, String(a));
    (el as HTMLElement).style.setProperty(names[1] as string, String(b));
  };
  const run = () => {
    frame = 0;
    const regions = all ? document.querySelectorAll(regionSelector) : pending;
    for (const el of regions) apply(el);
    pending.clear();
    all = false;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run);
  };
  const onScroll = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.matches(regionSelector)) return;
    pending.add(target);
    schedule();
  };
  const everything = () => {
    all = true;
    schedule();
  };

  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", everything);
  const watcher = new MutationObserver(everything);
  watcher.observe(document.body, { childList: true, subtree: true });
  everything();
  onCleanup(() => {
    document.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", everything);
    watcher.disconnect();
    if (frame) cancelAnimationFrame(frame);
  });
}
