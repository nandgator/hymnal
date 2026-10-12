import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// jsdom has no canvas: say so quietly, so text measuring takes its fallback.
if (typeof HTMLCanvasElement !== "undefined")
  HTMLCanvasElement.prototype.getContext = (() => null) as never;

// jsdom does not scroll: a stand-in that remembers where the page was told to go, so a
// windowed list (the Finder) reads back the position it set.
if (typeof window !== "undefined") {
  window.scrollTo = ((arg?: ScrollToOptions | number, y?: number) => {
    const top = typeof arg === "object" ? (arg.top ?? 0) : (y ?? 0);
    Object.defineProperty(window, "scrollY", { value: top, configurable: true, writable: true });
  }) as typeof window.scrollTo;
  afterEach(() => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true, writable: true });
  });
}
