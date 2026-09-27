import { createSignal, onCleanup } from "solid-js";
import { foldBeforeChange } from "./fold.ts";

/** MD3's expanded window size class starts at 840dp (DESIGN.md § Structure). */
export const EXPANDED_QUERY = "(min-width: 840px)";

/** Room for two tab groups beside What they see (SDD-0001 §16.4);
 * narrower, they merge into one. */
export const SPLIT_QUERY = "(min-width: 1400px)";

/** Height for the full Live preview beside the tabs as well as the part
 * keypad; shorter, the stage shows the Live strip (SDD-0001 §16.4). */
export const STAGE_QUERY = "(min-height: 640px)";

/**
 * Tracks a media query as a signal. Without matchMedia (jsdom), assumes it
 * matches, so tests see the wide layout unless they stub matchMedia.
 */
export function createMediaQuery(query: string) {
  const list = typeof window.matchMedia === "function" ? window.matchMedia(query) : undefined;
  const [matches, setMatches] = createSignal(list?.matches ?? true);
  const onChange = (event: MediaQueryListEvent) => {
    // Crossing 840px swaps the layout: the fold measures the old one first.
    if (query === EXPANDED_QUERY) foldBeforeChange();
    setMatches(event.matches);
  };
  list?.addEventListener("change", onChange);
  onCleanup(() => list?.removeEventListener("change", onChange));
  return matches;
}
