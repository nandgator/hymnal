import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userState } from "../persistence/user-state.ts";
import { RootBoundary } from "./ErrorScreen.tsx";

function Boom(): never {
  throw new Error("kaboom: the Operator broke");
}

const reload = vi.fn();
const writeText = vi.fn(async (_text: string) => {});
const realLocation = window.location;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...realLocation, reload },
  });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});
afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
  reload.mockReset();
  writeText.mockReset();
  writeText.mockImplementation(async () => {});
  vi.restoreAllMocks();
});

const mount = () =>
  render(() => (
    <RootBoundary>
      <Boom />
    </RootBoundary>
  ));

describe("the error screen under the Operator's boundary (SDD-0001 §16.9)", () => {
  it("replaces the app with a calm screen, and logs the error", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(
      screen.getByText("The hymnal hit an error it couldn’t recover from. Your books are safe."),
    ).toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
  });

  it("focuses Reload, which reloads the page", () => {
    mount();
    const button = screen.getByRole("button", { name: "Reload" });
    expect(button).toHaveFocus();
    expect(button).toHaveClass("btn-filled");
    fireEvent.click(button);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("copies the message, stack, build and user agent, and nothing else", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy error details" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    const text = writeText.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("kaboom: the Operator broke");
    expect(text).toContain("Boom");
    expect(text).toContain("Build: test");
    expect(text).toContain(`User agent: ${navigator.userAgent}`);
    expect(text).not.toMatch(/recent/i);
  });

  it("never copies what was typed into a failed search, or more than a first line", async () => {
    function Search(): never {
      throw new Error('fts5: syntax error near "Amazing grace how sweet the sound"');
    }
    const first = render(() => (
      <RootBoundary>
        <Search />
      </RootBoundary>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Copy error details" }));
    await screen.findByRole("button", { name: "Copied" });
    const text = writeText.mock.calls[0]?.[0] ?? "";
    expect(text).toContain("Message: (a search failed)");
    expect(text).not.toContain("grace");
    first.unmount();

    function Long(): never {
      throw new Error(`${"x".repeat(300)}\nsecond line`);
    }
    render(() => (
      <RootBoundary>
        <Long />
      </RootBoundary>
    ));
    fireEvent.click(screen.getByRole("button", { name: "Copy error details" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    const message = (writeText.mock.calls[1]?.[0] ?? "").split("\n")[0];
    expect(message).toBe(`Message: ${"x".repeat(200)}`);
  });

  it("returns the copy button to its label after a moment", async () => {
    mount();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(screen.getByRole("button", { name: "Copy error details" }));
      await screen.findByRole("button", { name: "Copied" });
      await vi.advanceTimersByTimeAsync(3100);
      expect(screen.getByRole("button", { name: "Copy error details" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy error details" }));
    expect(await screen.findByRole("button", { name: "Couldn’t copy" })).toBeInTheDocument();
  });

  it("asks before resetting, and Cancel goes back with nothing deleted", async () => {
    const reset = vi.spyOn(userState, "reset");
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Reset settings and history…" }));
    expect(
      screen.getByRole("heading", { name: "Reset settings and history?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your books are not touched/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(reset).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("Reset deletes the user-state database, then reloads", async () => {
    await userState.setPreferences({ theme: "dark", fontScale: 1 });
    expect((await indexedDB.databases()).map((db) => db.name)).toContain("hymnal-user-state");
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Reset settings and history…" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect((await indexedDB.databases()).map((db) => db.name)).not.toContain("hymnal-user-state");
  });
});
