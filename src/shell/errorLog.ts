/**
 * A stray `error` event or an unhandled rejection is logged, never shown
 * (SDD-0001 §16.9): most are one failed action, which its own caller reports.
 * Returns the function that removes the listeners.
 */
export function installErrorLogging(): () => void {
  const onError = (event: ErrorEvent) =>
    console.error("[hymnal] uncaught error", event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) =>
    console.error("[hymnal] unhandled rejection", event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
