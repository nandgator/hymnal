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
});
