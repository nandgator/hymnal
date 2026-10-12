import { afterEach, describe, expect, it, vi } from "vitest";
import { installErrorLogging } from "./errorLog.ts";

describe("installErrorLogging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs a stray error and an unhandled rejection, and removes itself", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // The runner reports a stray error as a failure: these are on purpose.
    const keep = (event: Event) => event.preventDefault();
    window.addEventListener("error", keep);
    const remove = installErrorLogging();
    const error = new Error("stray");
    window.dispatchEvent(new ErrorEvent("error", { error, message: "stray" }));
    expect(log).toHaveBeenCalledWith("[hymnal] uncaught error", error);
    const reason = new Error("rejected");
    const rejection = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejection, "reason", { value: reason });
    window.dispatchEvent(rejection);
    expect(log).toHaveBeenCalledWith("[hymnal] unhandled rejection", reason);
    remove();
    log.mockClear();
    window.dispatchEvent(new ErrorEvent("error", { error }));
    expect(log).not.toHaveBeenCalled();
    window.removeEventListener("error", keep);
  });

  it("does not log the browser's benign ResizeObserver loop message", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const keep = (event: Event) => event.preventDefault();
    window.addEventListener("error", keep);
    const remove = installErrorLogging();
    for (const message of [
      "ResizeObserver loop completed with undelivered notifications.",
      "ResizeObserver loop limit exceeded",
    ])
      window.dispatchEvent(new ErrorEvent("error", { message }));
    expect(log).not.toHaveBeenCalled();
    // Only that message: another is logged, and so is one carrying an error.
    window.dispatchEvent(new ErrorEvent("error", { message: "ResizeObserver is not defined" }));
    const error = new Error("ResizeObserver loop completed with undelivered notifications.");
    window.dispatchEvent(new ErrorEvent("error", { error, message: error.message }));
    expect(log).toHaveBeenCalledTimes(2);
    remove();
    window.removeEventListener("error", keep);
  });
});
