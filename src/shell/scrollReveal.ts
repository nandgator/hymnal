import { onCleanup } from "solid-js";

/** Every scroll container whose scrollbar hides until needed (DESIGN.md §
 * Register) — the page itself included. */
const PANES = "html, .shell-main, .sequence, .navigator-body, .main-column, .sheet-content";
/** How long after the last scroll event a pane still counts as scrolling. */
const SETTLE_MS = 800;

/**
 * Marks a pane `data-scrolling` while it scrolls, so its scrollbar fades in
 * (styles.css), and clears the mark once it has been still for a moment.
 * One passive, capturing listener for the whole document: scroll events
 * don't bubble, but they do pass through the capture phase.
 */
export function installScrollReveal(): void {
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  const onScroll = (event: Event) => {
    // The page scrolling reports the document, not an element.
    const pane = event.target instanceof Document ? event.target.documentElement : event.target;
    if (!(pane instanceof Element) || !pane.matches(PANES)) return;
    pane.setAttribute("data-scrolling", "");
    clearTimeout(timers.get(pane));
    timers.set(
      pane,
      setTimeout(() => pane.removeAttribute("data-scrolling"), SETTLE_MS),
    );
  };
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  onCleanup(() => document.removeEventListener("scroll", onScroll, { capture: true }));
}
