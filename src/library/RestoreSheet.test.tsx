import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type {
  BackupCommit,
  BackupReview,
  BackupReviewBook,
  ContentAdmin,
} from "../persistence/content-store.ts";

vi.mock("../persistence/content-store.ts", async (original) => ({
  ...(await original<typeof import("../persistence/content-store.ts")>()),
  forgetBook: vi.fn(),
}));

import { forgetBook } from "../persistence/content-store.ts";
import { madeLabel, RestoreSheet, type RestoreSheetProps, whatItDoes } from "./RestoreSheet.tsx";

const ok = (over: Partial<Extract<BackupReview, { ok: true }>> = {}): BackupReview => ({
  ok: true,
  token: "t1",
  created: "2026-09-27T09:41:00.000Z",
  build: "abc1234",
  books: [],
  problems: [],
  hasUserState: false,
  ...over,
});

const book = (over: Partial<BackupReviewBook> = {}): BackupReviewBook => ({
  key: "k1",
  title: "Hymns of Fellowship",
  songs: 275,
  verdict: { kind: "restore" },
  ...over,
});

const committed = (over: Partial<Extract<BackupCommit, { ok: true }>> = {}): BackupCommit => ({
  ok: true,
  books: [],
  held: [],
  ...over,
});

type Admin = Pick<ContentAdmin, "reviewBackup" | "commitBackup" | "cancelBackup" | "storageMode">;

function setup(
  review: BackupReview | Error,
  commit: BackupCommit = committed(),
  props: Partial<RestoreSheetProps> = {},
  mode: "opfs" | "memory" = "opfs",
) {
  const admin = {
    reviewBackup: vi.fn<Admin["reviewBackup"]>(async () => {
      if (review instanceof Error) throw review;
      return review;
    }),
    commitBackup: vi.fn<Admin["commitBackup"]>(async () => commit),
    cancelBackup: vi.fn<Admin["cancelBackup"]>(async () => true),
    storageMode: vi.fn<Admin["storageMode"]>(async () => mode),
  };
  const userState = { restore: vi.fn(async () => {}) };
  const onClose = vi.fn();
  const onRestored = vi.fn(async () => {});
  const onStorageRefused = vi.fn();
  const persist = vi.fn(async () => "granted" as const);
  render(() => (
    <RestoreSheet
      request={{ id: 1, file: new File(["x"], "backup.hymnal") }}
      placement="bottom"
      admin={admin}
      userState={userState}
      persist={persist}
      onClose={onClose}
      onRestored={onRestored}
      onStorageRefused={onStorageRefused}
      {...props}
    />
  ));
  return { admin, userState, onClose, onRestored, onStorageRefused, persist };
}

const sheet = () => screen.findByRole("dialog", { name: "Restore" });
const restoreButton = () => screen.getByRole("button", { name: "Restore" });

describe("RestoreSheet: the review", () => {
  it("names the backup's date and build", async () => {
    setup(ok({ books: [book()] }));
    const dialog = within(await sheet());
    expect(await dialog.findByRole("heading", { name: /^Backup from / })).toBeInTheDocument();
    expect(dialog.getByText("Build abc1234")).toBeInTheDocument();
  });

  it("words the date as Recents does", () => {
    const now = Date.parse("2026-10-06T12:00:00");
    expect(madeLabel("2026-10-06T09:41:00", now)).toMatch(/^Backup from today, /);
    expect(madeLabel("2026-10-05T09:41:00", now)).toMatch(/^Backup from yesterday, /);
    expect(madeLabel("2026-09-27T09:41:00", now)).toMatch(/^Backup from Sun, .*27/);
  });

  it("gives each verdict its row", async () => {
    setup(
      ok({
        books: [
          book({ key: "a", title: "Same", verdict: { kind: "already-here" } }),
          book({
            key: "b",
            title: "Copy",
            verdict: { kind: "already-here-as", book: { key: "z", title: "Held Title" } },
          }),
          book({ key: "c", title: "New", verdict: { kind: "restore" } }),
          book({ key: "d", title: "Broken", verdict: { kind: "restore", over: true } }),
          book({ key: "e", title: "Edited", verdict: { kind: "conflict", replaceable: true } }),
          book({
            key: "f",
            title: "Shipped-like",
            verdict: { kind: "conflict", replaceable: false },
          }),
        ],
      }),
    );
    const list = within(await screen.findByRole("list", { name: "Books in the backup" }));
    const row = (title: string) => within(list.getByText(title).closest("li") as HTMLElement);
    expect(row("Same").getByText("Already here")).toBeInTheDocument();
    expect(row("Copy").getByText("Already here as Held Title")).toBeInTheDocument();
    expect(row("New").getByText("Will be restored")).toBeInTheDocument();
    expect(
      row("Broken").getByText("Can’t be opened here. Restoring replaces it."),
    ).toBeInTheDocument();
    expect(row("Edited").getByText("A different edition is here")).toBeInTheDocument();
    expect(row("Edited").getByRole("radio", { name: "Keep this device’s" })).toBeChecked();
    expect(row("Edited").getByRole("radio", { name: "Replace" })).not.toBeChecked();
    expect(row("Shipped-like").getByText("A different edition is here")).toBeInTheDocument();
    expect(row("Shipped-like").getByRole("radio", { name: "Keep this device’s" })).toBeChecked();
    expect(row("Shipped-like").queryByRole("radio", { name: "Replace" })).not.toBeInTheDocument();
    expect(row("Same").queryByRole("radio")).not.toBeInTheDocument();
    expect(row("Same").getByText("275 songs")).toBeInTheDocument();
  });

  it("has one sentence for each verdict", () => {
    expect(whatItDoes(book({ verdict: { kind: "already-here" } }))).toBe("Already here");
  });

  it("lists the problems under Not restored, and the line about settings", async () => {
    setup(
      ok({
        books: [book()],
        hasUserState: true,
        problems: [
          { name: "k9", title: "Bad Book", reason: "damaged", message: "its checksum differs" },
        ],
      }),
    );
    const problems = within(await screen.findByRole("list", { name: "Not restored" }));
    expect(problems.getByText("Bad Book")).toBeInTheDocument();
    expect(problems.getByText(/its checksum differs/)).toBeInTheDocument();
    expect(screen.getByText("Settings and recent hymns come back too.")).toBeInTheDocument();
  });

  it("leaves the settings line out when the backup has none", async () => {
    setup(ok({ books: [book()] }));
    await screen.findByRole("list", { name: "Books in the backup" });
    expect(screen.queryByText(/come back too/)).not.toBeInTheDocument();
  });

  it("disables Restore when nothing would change and there is no user state", async () => {
    setup(
      ok({
        books: [
          book({ verdict: { kind: "already-here" } }),
          book({ key: "e", verdict: { kind: "conflict", replaceable: true } }),
        ],
      }),
    );
    await screen.findByRole("list", { name: "Books in the backup" });
    expect(restoreButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Replace" }));
    expect(restoreButton()).toBeEnabled();
  });

  it("enables Restore for the user state alone", async () => {
    setup(ok({ books: [book({ verdict: { kind: "already-here" } })], hasUserState: true }));
    await screen.findByRole("list", { name: "Books in the backup" });
    expect(restoreButton()).toBeEnabled();
  });
});

describe("RestoreSheet: refusals", () => {
  it("says a file that is not a backup is not one", async () => {
    setup({
      ok: false,
      refusal: { reason: "not-a-backup", message: "this is not a Hymnal backup" },
    });
    expect(await screen.findByText("This isn’t a Hymnal backup.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });

  it("names both versions when the backup needs a newer app", async () => {
    setup({
      ok: false,
      refusal: { reason: "needs-newer-app", found: 3, expected: 1, message: "needs a newer app" },
    });
    expect(await screen.findByText("This backup needs a newer app")).toBeInTheDocument();
    expect(screen.getByText("It is version 3; this app reads version 1.")).toBeInTheDocument();
  });

  it.each(["damaged", "unavailable"] as const)("shows the message of a %s file", async (reason) => {
    setup({ ok: false, refusal: { reason, message: "the zip ends early" } });
    expect(await screen.findByText("The zip ends early.")).toBeInTheDocument();
  });

  it("refuses with the reason when the read itself fails", async () => {
    setup(new Error("worker gone"));
    expect(await screen.findByText(/Couldn’t read the file: worker gone/)).toBeInTheDocument();
  });
});

describe("RestoreSheet: closing and committing", () => {
  it("throws the review away on Cancel", async () => {
    const s = setup(ok({ books: [book()] }));
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(within(await sheet()).getByRole("button", { name: "Cancel" }));
    expect(s.admin.cancelBackup).toHaveBeenCalledWith("t1");
    expect(s.onClose).toHaveBeenCalled();
  });

  it("sends every conflict's choice, keep by default", async () => {
    const s = setup(
      ok({
        books: [
          book({ key: "a", title: "A", verdict: { kind: "conflict", replaceable: true } }),
          book({ key: "b", title: "B", verdict: { kind: "conflict", replaceable: true } }),
          book({ key: "c", title: "C", verdict: { kind: "conflict", replaceable: false } }),
          book({ key: "d", title: "D", verdict: { kind: "restore" } }),
        ],
      }),
    );
    await screen.findByRole("list", { name: "Books in the backup" });
    const b = within(screen.getByText("B").closest("li") as HTMLElement);
    fireEvent.click(b.getByRole("radio", { name: "Replace" }));
    fireEvent.click(restoreButton());
    await waitFor(() => expect(s.admin.commitBackup).toHaveBeenCalled());
    expect(s.admin.commitBackup.mock.calls[0]?.[0]).toBe("t1");
    expect(s.admin.commitBackup.mock.calls[0]?.[1]).toEqual({ a: "keep", b: "replace", c: "keep" });
  });

  it("does not cancel a review that was committed, when it is closed afterwards", async () => {
    const s = setup(
      ok({ books: [book()] }),
      committed({
        books: [{ key: "k1", title: "Hymns of Fellowship", outcome: "restored" }],
        held: ["k1"],
      }),
    );
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    await screen.findByText("Restored 1 book.");
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0] as HTMLElement);
    expect(s.admin.cancelBackup).not.toHaveBeenCalled();
    expect(s.onClose).toHaveBeenCalled();
  });

  it("restores the user state with the held keys, refreshes, and asks to keep storage after a first load", async () => {
    const s = setup(
      ok({ books: [book()], hasUserState: true }),
      committed({
        books: [{ key: "k1", title: "Hymns of Fellowship", outcome: "restored" }],
        held: ["k1", "mal"],
        userState: { version: 1, recents: [] },
        firstLoad: true,
      }),
    );
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    expect(await screen.findByText("Restored 1 book.")).toBeInTheDocument();
    expect(screen.getByText("Settings and recent hymns are back.")).toBeInTheDocument();
    expect(s.userState.restore).toHaveBeenCalledWith(
      { version: 1, recents: [] },
      new Set(["k1", "mal"]),
    );
    expect(s.persist).toHaveBeenCalledTimes(1);
    expect(s.onRestored).toHaveBeenCalledTimes(1);
  });

  it("says to keep the file when storage is refused, and does not ask in memory mode", async () => {
    const refused = setup(
      ok({ books: [book()] }),
      committed({
        books: [{ key: "k1", title: "T", outcome: "restored" }],
        held: ["k1"],
        firstLoad: true,
      }),
      { persist: async () => "refused" },
    );
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    await screen.findByText("Restored 1 book.");
    await waitFor(() => expect(refused.onStorageRefused).toHaveBeenCalled());
  });

  it("shows the done state without waiting for the storage prompt, and says to keep the file when it is refused", async () => {
    let answer: (r: "refused") => void = () => {};
    const s = setup(
      ok({ books: [book()] }),
      committed({
        books: [{ key: "k1", title: "T", outcome: "restored" }],
        held: ["k1"],
        firstLoad: true,
      }),
      { persist: () => new Promise((resolve) => (answer = resolve)) },
    );
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    expect(await screen.findByText("Restored 1 book.")).toBeInTheDocument();
    expect(s.onRestored).toHaveBeenCalledTimes(1);
    expect(s.onStorageRefused).not.toHaveBeenCalled();
    answer("refused");
    await waitFor(() => expect(s.onStorageRefused).toHaveBeenCalled());
  });

  it("a storage request that throws changes nothing", async () => {
    const s = setup(
      ok({ books: [book()] }),
      committed({
        books: [{ key: "k1", title: "T", outcome: "restored" }],
        held: ["k1"],
        firstLoad: true,
      }),
      { persist: () => Promise.reject(new Error("no")) },
    );
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    expect(await screen.findByText("Restored 1 book.")).toBeInTheDocument();
    expect(s.onStorageRefused).not.toHaveBeenCalled();
  });

  it("does not ask to keep storage where the books are held in memory", async () => {
    const s = setup(
      ok({ books: [book()] }),
      committed({
        books: [{ key: "k1", title: "T", outcome: "restored" }],
        held: ["k1"],
        firstLoad: true,
      }),
      {},
      "memory",
    );
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    await screen.findByText("Restored 1 book.");
    expect(s.persist).not.toHaveBeenCalled();
  });

  it("summarises the results, naming a book that failed and why", async () => {
    setup(
      ok({ books: [book(), book({ key: "k2", title: "Second" })] }),
      committed({
        books: [
          { key: "k1", title: "Hymns of Fellowship", outcome: "restored" },
          { key: "k2", title: "Second", outcome: "failed", message: "the file is damaged" },
        ],
        held: ["k1"],
      }),
    );
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    expect(await screen.findByText("Restored 1 book.")).toBeInTheDocument();
    const failed = within(screen.getByRole("list", { name: "Not restored" }));
    expect(failed.getByText("Second")).toBeInTheDocument();
    expect(failed.getByText(/the file is damaged/)).toBeInTheDocument();
  });

  it("keeps the review and says why when the commit is refused", async () => {
    setup(ok({ books: [book()] }), { ok: false, reason: "failed", message: "disk full" });
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t restore the backup: disk full",
    );
    // The review’s token is used up: nothing is left to press.
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  });
});

describe("RestoreSheet: care around the commit", () => {
  const one = ok({ books: [book()] });

  it("says the year of a backup from another year", () => {
    const now = Date.parse("2026-10-06T12:00:00");
    expect(madeLabel("2025-09-27T09:41:00", now)).toMatch(/^Backup from Sat, .*27.*, 2025$/);
    expect(madeLabel("2026-09-27T09:41:00", now)).not.toMatch(/2026/);
  });

  it("forgets every attempted book, failed ones too, and refreshes", async () => {
    vi.mocked(forgetBook).mockClear();
    const s = setup(
      one,
      committed({
        books: [
          { key: "a", title: "A", outcome: "restored" },
          { key: "b", title: "B", outcome: "replaced" },
          { key: "c", title: "C", outcome: "failed", message: "bad" },
        ],
        held: ["a", "b"],
      }),
    );
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    await screen.findByText("Restored 2 books.");
    expect(vi.mocked(forgetBook).mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
    expect(s.onRestored).toHaveBeenCalledTimes(1);
  });

  it("still refreshes when writing the user state or the refresh itself fails, and says so", async () => {
    const s = setup(
      ok({ books: [book()], hasUserState: true }),
      committed({
        books: [{ key: "k1", title: "T", outcome: "restored" }],
        held: ["k1"],
        userState: {},
      }),
      {
        onRestored: async () => {
          throw new Error("list unreadable");
        },
      },
    );
    s.userState.restore.mockRejectedValueOnce(new Error("idb gone"));
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    expect(
      await screen.findByText(/Settings and recent hymns couldn’t be restored: idb gone/),
    ).toBeInTheDocument();
    expect(screen.getByText(/The Library couldn’t refresh: list unreadable/)).toBeInTheDocument();
  });

  it("has one Close in the results, and focuses the result", async () => {
    setup(
      one,
      committed({ books: [{ key: "k1", title: "T", outcome: "restored" }], held: ["k1"] }),
    );
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    const heading = await screen.findByText("Restored 1 book.");
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    await waitFor(() => expect(heading.closest(".callout")).toHaveFocus());
  });

  it("leaves no Restore to press after a commit that failed, whether it answered or threw", async () => {
    setup(one, { ok: false, reason: "failed", message: "disk full" });
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
  });

  it("treats a throwing commit as spent too", async () => {
    const s = setup(one);
    s.admin.commitBackup.mockRejectedValueOnce(new Error("worker gone"));
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("worker gone");
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  });

  it("does nothing on Close while it writes: the header says Restoring… and is disabled", async () => {
    let finish: (value: BackupCommit) => void = () => {};
    const s = setup(one);
    s.admin.commitBackup.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    const header = await screen.findByRole("button", { name: "Restoring…" });
    expect(header).toBeDisabled();
    fireEvent.keyDown(header, { key: "Escape" });
    expect(s.onClose).not.toHaveBeenCalled();
    expect(s.admin.cancelBackup).not.toHaveBeenCalled();
    finish(committed());
    await screen.findByText(/No books needed restoring|Restored/);
  });

  it("cancels the first review's token when a second request lands while it is read", async () => {
    const answers: ((r: BackupReview) => void)[] = [];
    const admin = {
      reviewBackup: vi.fn<Admin["reviewBackup"]>(
        () => new Promise((resolve) => answers.push(resolve)),
      ),
      commitBackup: vi.fn<Admin["commitBackup"]>(async () => committed()),
      cancelBackup: vi.fn<Admin["cancelBackup"]>(async () => true),
      storageMode: vi.fn<Admin["storageMode"]>(async () => "opfs"),
    };
    const [request, setRequest] = createSignal({ id: 1, file: new File(["x"], "a.hymnal") });
    render(() => (
      <RestoreSheet
        request={request()}
        placement="bottom"
        admin={admin}
        userState={{ restore: async () => {} }}
        onClose={() => {}}
        onRestored={() => {}}
      />
    ));
    await waitFor(() => expect(admin.reviewBackup).toHaveBeenCalledTimes(1));
    setRequest({ id: 2, file: new File(["y"], "b.hymnal") });
    await waitFor(() => expect(admin.reviewBackup).toHaveBeenCalledTimes(2));
    answers[0]?.(ok({ token: "first", books: [book()] }));
    await waitFor(() => expect(admin.cancelBackup).toHaveBeenCalledWith("first"));
    answers[1]?.(ok({ token: "second", books: [book({ title: "Second book" })] }));
    expect(await screen.findByText("Second book")).toBeInTheDocument();
    expect(admin.cancelBackup).not.toHaveBeenCalledWith("second");
  });

  it("ignores a new request while a commit is under way", async () => {
    let finish: (value: BackupCommit) => void = () => {};
    const admin = {
      reviewBackup: vi.fn<Admin["reviewBackup"]>(async () => one),
      commitBackup: vi.fn<Admin["commitBackup"]>(
        () => new Promise((resolve) => (finish = resolve)),
      ),
      cancelBackup: vi.fn<Admin["cancelBackup"]>(async () => true),
      storageMode: vi.fn<Admin["storageMode"]>(async () => "opfs"),
    };
    const [request, setRequest] = createSignal({ id: 1, file: new File(["x"], "a.hymnal") });
    render(() => (
      <RestoreSheet
        request={request()}
        placement="bottom"
        admin={admin}
        userState={{ restore: async () => {} }}
        onClose={() => {}}
        onRestored={() => {}}
      />
    ));
    await screen.findByRole("list", { name: "Books in the backup" });
    fireEvent.click(restoreButton());
    await waitFor(() => expect(admin.commitBackup).toHaveBeenCalled());
    setRequest({ id: 2, file: new File(["y"], "b.hymnal") });
    await Promise.resolve();
    expect(admin.reviewBackup).toHaveBeenCalledTimes(1);
    finish(committed({ books: [{ key: "k1", title: "T", outcome: "restored" }] }));
    expect(await screen.findByText("Restored 1 book.")).toBeInTheDocument();
  });

  it("throws a pending review away when it is unmounted", async () => {
    const s = setup(one);
    await screen.findByRole("list", { name: "Books in the backup" });
    cleanup();
    expect(s.admin.cancelBackup).toHaveBeenCalledWith("t1");
  });
});
