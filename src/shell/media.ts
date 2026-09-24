import { createSignal, onCleanup } from "solid-js";

/** MD3's expanded window size class starts at 840dp (DESIGN.md § Structure). */
export const EXPANDED_QUERY = "(min-width: 840px)";

/**
 * Tracks a media query as a signal. Without matchMedia (jsdom), assumes it
 * matches, so tests see the wide layout unless they stub matchMedia.
 */
export function createMediaQuery(query: string) {
  const list = typeof window.matchMedia === "function" ? window.matchMedia(query) : undefined;
  const [matches, setMatches] = createSignal(list?.matches ?? true);
  const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
  list?.addEventListener("change", onChange);
  onCleanup(() => list?.removeEventListener("change", onChange));
  return matches;
}
