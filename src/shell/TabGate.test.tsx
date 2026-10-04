import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { TabGate } from "./TabGate.tsx";
import type { TabLock, TabState } from "./tabLock.ts";

vi.mock("../persistence/content-store.ts", () => ({
  releaseContent: async () => {},
  contentBusy: async () => false,
  getContentAdmin: () => ({}),
  getContentStore: () => ({}),
}));

/** A lock the test drives by hand. */
function fakeLock(initial: TabState = "checking") {
  let state = initial;
  const handlers = new Set<(state: TabState) => void>();
  const lock: TabLock & { go(next: TabState): void; used: number; started: number } = {
    used: 0,
    started: 0,
    state: () => state,
    onChange: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    start() {
      lock.started++;
    },
    useHere() {
      lock.used++;
    },
    dispose() {},
    go(next) {
      state = next;
      for (const handler of handlers) handler(next);
    },
  };
  return lock;
}

const mount = (lock?: TabLock) =>
  render(() => <TabGate makeLock={() => lock}>{() => <p>the app</p>}</TabGate>);

describe("TabGate", () => {
  it("shows the app at once where there is no lock", () => {
    mount();
    expect(screen.getByText("the app")).toBeInTheDocument();
  });

  it("shows nothing while the lock is being asked for, then the app to the owner", () => {
    const lock = fakeLock();
    mount(lock);
    expect(lock.started).toBe(1);
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    lock.go("owner");
    expect(screen.getByText("the app")).toBeInTheDocument();
  });

  it("shows the note and Use Here to a tab that is not the owner", () => {
    const lock = fakeLock();
    mount(lock);
    lock.go("other");
    expect(
      screen.getByRole("heading", { name: "Hymnal is open in another tab" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("the app")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use Here" }));
    expect(lock.used).toBe(1);
  });

  it("says why, and keeps Use Here enabled, after a refusal or silence", () => {
    const lock = fakeLock("other");
    mount(lock);
    const button = () => screen.getByRole("button", { name: "Use Here" });
    lock.go("asking");
    expect(button()).toBeDisabled();
    lock.go("presenting");
    expect(screen.getByText(/The other tab is presenting/)).toBeInTheDocument();
    expect(button()).toBeEnabled();
    lock.go("saving");
    expect(screen.getByText(/The other tab is saving a book/)).toBeInTheDocument();
    expect(button()).toBeEnabled();
    lock.go("silent");
    expect(
      screen.getByText("The other tab didn't answer. Close it, or try again."),
    ).toBeInTheDocument();
    expect(button()).toBeEnabled();
  });

  it("shows the note again to the tab that let go", () => {
    const lock = fakeLock("owner");
    mount(lock);
    lock.go("other");
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByRole("button", { name: "Use Here" })).toBeInTheDocument();
  });
});
