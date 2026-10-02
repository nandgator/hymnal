import "@testing-library/jest-dom/vitest";

// jsdom has no canvas: say so quietly, so text measuring takes its fallback.
if (typeof HTMLCanvasElement !== "undefined")
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
