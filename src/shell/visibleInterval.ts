/** `tick` every `ms` while this page is visible. A hidden page holds no timer
 * (a background tab only wastes its battery on one); on coming back `tick`
 * runs at once, to catch up on what the wait skipped, and the period starts
 * again. Returns the stop function.
 *
 * For work that only paints this page. Anything that must run while it is
 * hidden (the Output window's own work) does not belong here. */
export function visibleInterval(tick: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const hold = () => {
    clearInterval(timer);
    timer = undefined;
  };
  const sync = () => {
    if (document.visibilityState === "visible") {
      if (timer === undefined) timer = setInterval(tick, ms);
    } else hold();
  };
  const onChange = () => {
    const was = timer;
    sync();
    if (was === undefined && timer !== undefined) tick();
  };
  sync();
  document.addEventListener("visibilitychange", onChange);
  return () => {
    hold();
    document.removeEventListener("visibilitychange", onChange);
  };
}
