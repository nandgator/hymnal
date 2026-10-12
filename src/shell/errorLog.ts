/**
 * The browser's "ResizeObserver loop completed with undelivered notifications"
 * (Chromium; Firefox words it "loop limit exceeded") is not a failure: the
 * spec reports it when an observer's callback resizes something observed
 * higher up in the same frame, and the notification is simply delivered in the
 * next one. A sheet's morph re-measures the card inside its callback (Sheet.tsx
 * `retarget`), which the sheet's own height watcher then sees. It has no
 * `error` object and nothing to act on, so it is not logged as an uncaught
 * error; any other message still is.
 */
function isResizeObserverLoop(event: ErrorEvent): boolean {
  return !event.error && /^ResizeObserver loop (completed|limit exceeded)/.test(event.message);
}

/**
 * A stray `error` event or an unhandled rejection is logged, never shown
 * (SDD-0001 §16.9): most are one failed action, which its own caller reports.
 * Returns the function that removes the listeners.
 */
export function installErrorLogging(): () => void {
  const onError = (event: ErrorEvent) => {
    if (isResizeObserverLoop(event)) {
      // Cancelled, so the browser does not report it as an uncaught error either.
      event.preventDefault();
      return;
    }
    console.error("[hymnal] uncaught error", event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) =>
    console.error("[hymnal] unhandled rejection", event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
