import { cleanup, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { ContentStore } from "../persistence/content-store.ts";
import type { RecentEntry, UserState } from "../persistence/user-state.ts";
import { RecentsList } from "./RecentsList.tsx";

const store = (listHymns = vi.fn(async () => [{ number: 42, title: "Forty-Second Hymn" }])) =>
  ({ listHymns }) as unknown as ContentStore;

const userState = (getRecents: () => Promise<RecentEntry[]>) =>
  ({ getRecents }) as unknown as UserState;

const RECENTS: RecentEntry[] = [
  { hymnbookId: "book", hymnNumber: 42, viewedAt: 1 },
  { hymnbookId: "other", hymnNumber: 7, viewedAt: 2 },
];

describe("RecentsList", () => {
  it("shows this book's recents whole: number, title and when", async () => {
    render(() => (
      <RecentsList
        hymnbookId="book"
        store={store()}
        userState={userState(async () => RECENTS)}
        onSelect={() => {}}
      />
    ));
    const row = await screen.findByRole("button", { name: /Forty-Second Hymn/ });
    expect(row).toHaveTextContent("#42");
    expect(screen.queryByText("#7")).not.toBeInTheDocument();
  });

  it("says there are none only once it knows", async () => {
    let resolve: (entries: RecentEntry[]) => void = () => {};
    render(() => (
      <RecentsList
        hymnbookId="book"
        store={store()}
        userState={userState(() => new Promise((done) => (resolve = done)))}
        onSelect={() => {}}
      />
    ));
    expect(screen.queryByText("No recent songs yet.")).not.toBeInTheDocument();
    resolve([]);
    expect(await screen.findByText("No recent songs yet.")).toBeInTheDocument();
  });

  it("shows the last list at once on a remount, with the rest of the screen", async () => {
    const titles = vi.fn(async () => [{ number: 42, title: "Forty-Second Hymn" }]);
    const shared = store(titles);
    let reads = 0;
    const state = userState(() =>
      reads++ === 0 ? Promise.resolve(RECENTS) : new Promise(() => {}),
    );
    const mount = () =>
      render(() => (
        <RecentsList hymnbookId="book" store={shared} userState={state} onSelect={() => {}} />
      ));

    mount();
    await screen.findByRole("button", { name: /Forty-Second Hymn/ });
    cleanup();

    mount();
    // Synchronously: no wait for the read still pending.
    expect(screen.getByRole("button", { name: /Forty-Second Hymn/ })).toBeInTheDocument();
  });
});
