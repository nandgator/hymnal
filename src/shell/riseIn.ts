/** How far (px) results glide up into place. */
const RISE_PX = 8;
/** How long a change of results takes to settle. */
const RISE_MS = 180;

const running = new WeakMap<Element, Animation>();

/**
 * Results that changed, settling in place: they glide up a few pixels and fade in. It is on
 * the compositor (transform and opacity, one layer, no layout), so typing never stutters, and
 * it moves nothing else: a search dialog holds its size while its results change. Reduced
 * motion only fades. A change that lands mid-way restarts it, from the start.
 */
export function riseIn(el: Element | null | undefined): void {
  if (!el || typeof el.animate !== "function") return;
  // A `ref` runs before the element is in the page: an animation started there never plays
  // (it sat at its first frame). Once it is in.
  if (el.isConnected === false) {
    queueMicrotask(() => {
      if (el.isConnected) riseIn(el);
    });
    return;
  }
  running.get(el)?.cancel();
  const still =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const style = getComputedStyle(document.documentElement);
  const easing = style.getPropertyValue("--motion-emphasized").trim() || "ease-out";
  const run = el.animate(
    [
      { opacity: 0.4, transform: still ? "none" : `translateY(${RISE_PX}px)` },
      { opacity: 1, transform: "none" },
    ],
    { duration: still ? RISE_MS / 2 : RISE_MS, easing },
  );
  running.set(el, run);
  const done = () => {
    if (running.get(el) === run) running.delete(el);
  };
  void run.finished.then(done, done);
}
