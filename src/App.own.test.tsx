import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { booksReady, mocks } from "./App.testkit.tsx";
import App from "./App.tsx";
import type { BookRow } from "./persistence/content-store.ts";

vi.mock("./persistence/content-store.ts", async () =>
  (await import("./App.testkit.tsx")).contentStoreMock(),
);
vi.mock("./persistence/user-state.ts", async (importOriginal) =>
  (await import("./App.testkit.tsx")).userStateMock(
    await importOriginal<typeof import("./persistence/user-state.ts")>(),
  ),
);
vi.mock("./shell/updates.ts", async (importOriginal) =>
  (await import("./App.testkit.tsx")).updatesMock(
    await importOriginal<typeof import("./shell/updates.ts")>(),
  ),
);
vi.mock("./output/OutputView.tsx", async (importOriginal) =>
  (await import("./App.testkit.tsx")).outputViewMock(
    await importOriginal<typeof import("./output/OutputView.tsx")>(),
  ),
);

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("App: the books held (SDD-0004 §9, §10)", () => {
  const first = () => ({ ...(mocks.rows[0] as BookRow) });

  afterEach(() => {
    mocks.recents = [];
    mocks.rows = [first()];
    mocks.searchAll.mockImplementation(async () => []);
  });

  describe("Your books (ADR-0033, SDD-0004 §17)", () => {
    const assorted = (): BookRow => ({
      key: "as1",
      origin: "assorted",
      kind: "own",
      file: "/as1.1.sqlite3",
      title: "Assorted Hymns",
      language: "mul",
      script: "Zyyy",
      songs: 2,
      addedAt: 2,
      state: "ok",
    });
    afterEach(() => {
      mocks.assortedLast = true;
    });

    it("the first song added, with storage refused, says its own note, and Back Up opens the Backup section", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        storage: { persist: async () => false, persisted: async () => false },
      });
      const admin = mocks.admin as Record<string, unknown>;
      const was = { review: admin.review, add: admin.addToOwn };
      admin.review = async () => ({
        token: "t",
        sourceHash: "a".repeat(64),
        title: "Amazing Grace",
        language: "en",
        script: "Latn",
        origin: "assorted-song",
        songCount: 1,
        violations: [],
        verdict: { kind: "new" },
        held: { count: 0, books: [] },
        own: [
          { key: null, origin: "assorted", title: "Assorted Hymns", next: 1, has: {}, adding: [1] },
          { key: null, origin: "own", title: "", next: 1, has: {}, adding: [1] },
        ],
      });
      admin.addToOwn = async () => {
        mocks.rows = [...mocks.rows, assorted()];
        return {
          ok: true,
          key: "as1",
          numbers: [1],
          already: 0,
          created: true,
          firstLoad: true,
        };
      };
      try {
        render(() => <App />);
        await booksReady();
        fireEvent.click(
          screen.getAllByRole("button", {
            name: "From Text",
          })[0] as HTMLElement,
        );
        const text = within(await screen.findByRole("dialog", { name: "From Text" }));
        fireEvent.input(text.getByLabelText("Song text"), {
          target: { value: "1. Amazing Grace\n\nAmazing grace!\n" },
        });
        const box = text.getByRole("combobox", { name: /language/i });
        fireEvent.focus(box);
        fireEvent.input(box, { target: { value: "English" } });
        fireEvent.click(within(text.getByRole("listbox")).getAllByRole("option")[0] as HTMLElement);
        fireEvent.click(text.getByRole("button", { name: "Review Song" }));
        const review = within(await screen.findByRole("dialog", { name: "Add Song" }));
        fireEvent.click(await review.findByRole("button", { name: "Add Song" }));
        // Until the Output has answered it counts as live, so the song is only said to be added;
        // that notice is put away, and the storage note behind it shows.
        await screen.findAllByText(/was added to Assorted Hymns as 1/);
        fireEvent.click(screen.getByRole("button", { name: "Got It" }));
        const note = await screen.findAllByText(
          "Your browser may clear stored songs if space runs low. Back up from Settings to keep your books.",
        );
        expect(note.length).toBeGreaterThan(0);
        // Not the book-file note.
        expect(screen.queryByText(/Keep the book file/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Back Up" }));
        expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
        await waitFor(() =>
          expect(screen.queryByText(/Your browser may clear stored songs/)).toBeNull(),
        );
      } finally {
        admin.review = was.review;
        admin.addToOwn = was.add;
        vi.unstubAllGlobals();
      }
    });
  });

  it("says nothing when the review of several is closed", async () => {
    render(() => <App />);
    await booksReady();
    const files = ["a", "b", "c"].map((n) => new File(["x"], `${n}.hymnbook.json.gz`));
    fireEvent.change(screen.getByTestId("book-file"), { target: { files } });
    const dialog = within(await screen.findByRole("dialog", { name: "Load Books" }));
    expect(await dialog.findByText("Book 1 of 3")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText(/Book \d of 3/)).not.toBeInTheDocument());
    expect(screen.queryByText(/not loaded/)).not.toBeInTheDocument();
  });

  it("says once that settings and recents won’t be kept when user state falls to memory, and Got It puts it away", async () => {
    render(() => <App />);
    await booksReady();
    const text = "Settings and recents won’t be kept this time.";
    expect(screen.queryByText(text)).not.toBeInTheDocument();
    mocks.fallback();
    expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Got It" }));
    await waitFor(() => expect(screen.queryByText(text)).not.toBeInTheDocument());
  });
});
