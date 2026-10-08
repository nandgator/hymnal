import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type {
  BookRow,
  Choice,
  CommitResult,
  ContentStatus,
  LoadReview,
  OnLoadProgress,
  StorageMode,
} from "../persistence/content-store.ts";
import { createBooks, type LibraryAdmin } from "./books.ts";
import { Library } from "./Library.tsx";

const row = (over: Partial<BookRow> = {}): BookRow => ({
  key: "mal",
  origin: "mal",
  kind: "shipped",
  file: "/mal.sqlite3",
  title: "Athmeeya Geethangal",
  language: "ml",
  script: "Mlym",
  songs: 1631,
  addedAt: 1,
  state: "ok",
  ...over,
});

const loaded = (over: Partial<BookRow> = {}) =>
  row({
    key: "k1",
    origin: "hof",
    kind: "loaded",
    title: "Hymns of Fellowship",
    language: "en",
    script: "Latn",
    songs: 275,
    file: "/k1.1.sqlite3",
    ...over,
  });

const review = (over: Partial<LoadReview> = {}): LoadReview => ({
  token: "t1",
  sourceHash: "a3f9c21e07b4".padEnd(64, "0"),
  title: "Hymns of Fellowship",
  language: "en",
  script: "Latn",
  origin: "hof",
  songCount: 275,
  violations: [],
  verdict: { kind: "new" },
  held: { count: 0, books: [] },
  ...over,
});

interface Setup {
  rows?: BookRow[];
  review?: LoadReview | Error;
  commit?: CommitResult;
  openBook?: ContentStatus;
  /** Where the books are held; the default is OPFS. */
  mode?: StorageMode;
  /** The names of the picked files whose content is a backup. */
  backups?: string[];
  /** The sample files this build offers; the default is the build's (none in tests). */
  sample?: readonly string[];
}

function setup(options: Setup = {}) {
  let rows = options.rows ?? [row()];
  const admin = {
    listBooks: vi.fn(async () => rows),
    review: vi.fn(async (_file: File, _target?: string, _onProgress?: OnLoadProgress) => {
      const r = options.review ?? review();
      if (r instanceof Error) throw r;
      return r;
    }),
    commit: vi.fn(
      async (
        _token: string,
        _choice?: Choice,
        _onProgress?: OnLoadProgress,
      ): Promise<CommitResult> => options.commit ?? { ok: true, action: "loaded", key: "k1" },
    ),
    cancel: vi.fn(async () => true),
    removeBook: vi.fn(async (key: string) => {
      rows = rows.filter((b) => b.key !== key);
      return true;
    }),
    openBook: vi.fn(async (): Promise<ContentStatus> => options.openBook ?? { state: "ready" }),
    storageMode: vi.fn(async (): Promise<StorageMode> => options.mode ?? "opfs"),
    isBackup: vi.fn(async (file: File) => (options.backups ?? []).includes(file.name)),
  } satisfies LibraryAdmin;
  const store = {
    ensureInstalled: vi.fn(async (): Promise<ContentStatus> => ({ state: "ready" })),
  };
  const userState = {
    getRecents: vi.fn(async () => [
      { hymnbookId: "k1", hymnNumber: 1, viewedAt: 3 },
      { hymnbookId: "k1", hymnNumber: 2, viewedAt: 2 },
      { hymnbookId: "mal", hymnNumber: 9, viewedAt: 1 },
    ]),
    dropRecents: vi.fn(async () => {}),
  };
  const onChoose = vi.fn();
  const onOpen = vi.fn();
  const onStorageRefused = vi.fn();
  const onNotice = vi.fn();
  const persist = vi.fn(async () => "refused" as const);
  const onRestore = vi.fn();
  const view = (
    props: {
      currentKey?: string;
      presentedKey?: string;
      outputLive?: boolean;
      onEndLive?: () => void;
      booksAdmin?: Pick<LibraryAdmin, "listBooks">;
    } = {},
  ) =>
    render(() => {
      const books = createBooks(props.booksAdmin ?? admin, store, ["mal"]);
      return (
        <Library
          books={books}
          currentKey={props.currentKey}
          presentedKey={props.presentedKey}
          outputLive={props.outputLive}
          onEndLive={props.onEndLive}
          onChoose={onChoose}
          onOpen={onOpen}
          onStorageRefused={onStorageRefused}
          onNotice={onNotice}
          onRestore={onRestore}
          admin={admin}
          userState={userState}
          persist={persist}
          sample={options.sample}
        />
      );
    });
  return {
    admin,
    store,
    userState,
    onChoose,
    onOpen,
    onStorageRefused,
    onNotice,
    onRestore,
    persist,
    view,
    setRows: (r: BookRow[]) => (rows = r),
  };
}

const pickFiles = (...names: string[]) => {
  const input = screen.getByTestId("book-file");
  fireEvent.change(input, { target: { files: names.map((name) => new File(["x"], name)) } });
};

const pickFile = (name = "hof.hymnbook.json.gz") => {
  const input = screen.getByTestId("book-file");
  fireEvent.change(input, { target: { files: [new File(["x"], name)] } });
};

describe("Library: loading the list", () => {
  it("shows nothing for a fast load, then a skeleton of its list (DESIGN.md § Structure)", async () => {
    const s = setup();
    s.admin.listBooks.mockImplementation(() => new Promise(() => {}));
    s.view();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("Loading…");
  });

  it("shows a first install's progress, in megabytes, then the book", async () => {
    const s = setup({ rows: [] });
    s.store.ensureInstalled.mockImplementation((async (
      _id: string,
      onProgress?: (p: { loaded: number; total?: number }) => void,
    ) => {
      onProgress?.({ loaded: 2_900_000, total: 5_800_000 });
      return new Promise(() => {});
    }) as never);
    s.view();
    const bar = await screen.findByRole("progressbar", { name: "Installing the songbook" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("2.9 of 5.8 MB")).toBeInTheDocument();
  });

  it("sweeps when the download's size is unknown", async () => {
    const s = setup({ rows: [] });
    s.store.ensureInstalled.mockImplementation((async (
      _id: string,
      onProgress?: (p: { loaded: number; total?: number }) => void,
    ) => {
      onProgress?.({ loaded: 1_000_000 });
      return new Promise(() => {});
    }) as never);
    s.view();
    const bar = await screen.findByRole("progressbar");
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("1.0 MB")).toBeInTheDocument();
  });

  it("installs a shipped book that is not held, then lists it", async () => {
    const s = setup({ rows: [] });
    s.store.ensureInstalled.mockImplementation(async () => {
      s.setRows([row()]);
      return { state: "ready" };
    });
    s.view();
    expect(await screen.findByText("Athmeeya Geethangal")).toBeInTheDocument();
    expect(s.store.ensureInstalled).toHaveBeenCalledWith("mal", expect.any(Function));
  });

  it.each([
    [{ state: "missing-asset" }, "The hymnbook file is missing. Try reloading."],
    [{ state: "corrupt" }, "The hymnbook file is damaged. Try reinstalling."],
    [
      { state: "schema-mismatch", found: 1, expected: 2 },
      "This songbook needs an app update (found schema 1, need 2).",
    ],
  ] satisfies [ContentStatus, string][])(
    "reports a failed install, %j, with Retry",
    async (status, message) => {
      const s = setup({ rows: [] });
      let attempt = 0;
      s.store.ensureInstalled.mockImplementation(async () => {
        if (++attempt === 1) return status;
        s.setRows([row()]);
        return { state: "ready" };
      });
      s.view();
      expect(await screen.findByText(message)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByText("Athmeeya Geethangal")).toBeInTheDocument();
    },
  );
});

describe("Library: nothing held, the first run (ADR-0026)", () => {
  it("explains that books load from a file, and offers the picker; no demo, no download", async () => {
    const s = setup({ rows: [] });
    s.store.ensureInstalled.mockImplementation(async () => ({ state: "ready" }));
    s.view();
    expect(await screen.findByRole("heading", { name: "Bring a songbook" })).toBeInTheDocument();
    expect(screen.getByText(/It stays on this device/)).toBeInTheDocument();
    expect(screen.queryByText(/importer/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "From Text" })).toBeInTheDocument();
    const click = vi.spyOn(screen.getByTestId("book-file") as HTMLInputElement, "click");
    fireEvent.click(screen.getByRole("button", { name: "Load Books" }));
    expect(click).toHaveBeenCalled();
    expect(screen.getByTestId("book-file")).toHaveAttribute(
      "accept",
      expect.stringContaining(".gz"),
    );
  });

  it("shows a progress line in the card while the first file is read, and Cancel throws it away", async () => {
    const s = setup({ rows: [] });
    s.store.ensureInstalled.mockImplementation(async () => ({ state: "ready" }));
    let finish: (r: LoadReview) => void = () => {};
    s.admin.review.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    s.view();
    await screen.findByRole("heading", { name: "Bring a songbook" });
    pickFile();
    expect(await screen.findByRole("progressbar", { name: "Reading…" })).toBeInTheDocument();
    expect(screen.getByText("Reading hof.hymnbook.json.gz")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    finish(review());
    await waitFor(() => expect(s.admin.cancel).toHaveBeenCalledWith("t1"));
  });
});

describe("Library: the books held (SDD-0004 §9)", () => {
  it("lists every book with its language, song count and what it is; the current one is marked", async () => {
    const s = setup({ rows: [row(), loaded()] });
    s.view({ currentKey: "mal" });
    const list = within(await screen.findByRole("list", { name: "Books" }));
    const mal = list.getByRole("button", { name: /^Athmeeya Geethangal/ });
    expect(mal).toHaveAttribute("aria-current", "true");
    expect(mal).toHaveTextContent("Current");
    expect(mal).toHaveTextContent("Malayalam");
    expect(mal).toHaveTextContent("Shipped");
    expect(mal).toHaveTextContent("1,631");
    const hof = list.getByRole("button", { name: /^Hymns of Fellowship/ });
    expect(hof).not.toHaveAttribute("aria-current");
    expect(hof).toHaveTextContent("English");
    expect(hof).toHaveTextContent("275 songs");
    expect(hof).toHaveTextContent("Loaded");
    expect(screen.getByText("2 books on this device")).toBeInTheDocument();
  });

  it("cancelling with one book left says nothing either", async () => {
    setup().view({ currentKey: "mal" });
    expect(await screen.findByText("1 book on this device")).toBeInTheDocument();
  });

  it("choosing a book opens it, then makes it current", async () => {
    const s = setup({ rows: [row(), loaded()] });
    s.view({ currentKey: "mal" });
    fireEvent.click(await screen.findByRole("button", { name: /^Hymns of Fellowship/ }));
    await waitFor(() => expect(s.onChoose).toHaveBeenCalledWith("k1"));
    expect(s.admin.openBook).toHaveBeenCalledWith("k1");
  });

  it("tapping a book makes it current and opens the Finder on it, as does tapping the current one", async () => {
    const s = setup({ rows: [row(), loaded()] });
    s.view({ currentKey: "mal" });
    fireEvent.click(await screen.findByRole("button", { name: /^Hymns of Fellowship/ }));
    await waitFor(() => expect(s.onOpen).toHaveBeenCalledWith("k1"));
    // The scope is set first, so the Finder that opens is aimed at the book.
    expect(s.onChoose.mock.invocationCallOrder[0]).toBeLessThan(
      s.onOpen.mock.invocationCallOrder[0] as number,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Athmeeya Geethangal/ }));
    await waitFor(() => expect(s.onOpen).toHaveBeenCalledWith("mal"));
  });

  it("a book that cannot be chosen does not go to Present", async () => {
    const s = setup({ rows: [row(), loaded()], openBook: { state: "missing-asset" } });
    s.view({ currentKey: "mal" });
    fireEvent.click(await screen.findByRole("button", { name: /^Hymns of Fellowship/ }));
    await screen.findByText("File missing");
    expect(s.onOpen).not.toHaveBeenCalled();
  });

  it("a book whose file is gone says so, with Load Again, and is not chosen", async () => {
    const s = setup({ rows: [row(), loaded()], openBook: { state: "missing-asset" } });
    s.view({ currentKey: "mal" });
    fireEvent.click(await screen.findByRole("button", { name: /^Hymns of Fellowship/ }));
    expect(await screen.findByText("File missing")).toBeInTheDocument();
    expect(s.onChoose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Load Again" })).toBeInTheDocument();
  });

  it("lists a book that cannot be opened with its reason and what to do, not choosable", async () => {
    const s = setup({
      rows: [
        row(),
        loaded({ key: "a", title: "Hymns of Praise", state: "needs-reloading" }),
        loaded({ key: "b", title: "Voices", state: "needs-newer-app" }),
        loaded({ key: "c", title: "c", state: "unreadable" }),
      ],
    });
    s.view({ currentKey: "mal" });
    await screen.findByText("Needs reloading");
    expect(screen.getByText("Needs a newer app")).toBeInTheDocument();
    expect(screen.getByText("Can’t be read")).toBeInTheDocument();
    // Load Again where a file can fix it: not for a book that needs a newer app.
    expect(screen.getAllByRole("button", { name: "Load Again" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /^Hymns of Praise/ })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Hymns of Praise" })).toBeInTheDocument();
    // A book with no title shows its key.
    expect(
      within(screen.getByRole("list", { name: "Books" })).getAllByText("c").length,
    ).toBeGreaterThan(0);
  });
});

describe("Library: Load Again aims the review at the book (decided with SDD-0004 §9)", () => {
  it("passes the book's key as the target, and says what it restores", async () => {
    const s = setup({
      rows: [row(), loaded({ key: "a", title: "Hymns of Praise", state: "needs-reloading" })],
      review: review({
        verdict: undefined,
        restore: {
          key: "a",
          title: "Hymns of Praise",
          state: "needs-reloading",
          titleMatches: true,
        },
      }),
      commit: { ok: true, action: "restored", key: "a" },
    });
    s.view({ currentKey: "mal" });
    fireEvent.click(await screen.findByRole("button", { name: "Load Again" }));
    pickFile();
    const dialog = await screen.findByRole("dialog", { name: "Load Again" });
    expect(s.admin.review).toHaveBeenCalledWith(expect.any(File), "a", expect.any(Function));
    expect(within(dialog).getByText("Brings a book back")).toBeInTheDocument();
    expect(within(dialog).queryByText("Not the same title")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore Book" }));
    await waitFor(() =>
      expect(s.admin.commit).toHaveBeenCalledWith("t1", "keep-both", expect.any(Function)),
    );
    // A load never moves the current book; this one was not asked to.
    expect(s.onChoose).not.toHaveBeenCalled();
  });

  it("warns when the file's title is not the book's", async () => {
    const s = setup({
      rows: [row(), loaded({ key: "a", title: "Hymns of Praise", state: "unreadable" })],
      review: review({
        verdict: undefined,
        restore: { key: "a", title: "Hymns of Praise", state: "unreadable", titleMatches: false },
      }),
    });
    s.view({ currentKey: "mal" });
    fireEvent.click(await screen.findByRole("button", { name: "Load Again" }));
    pickFile();
    const dialog = within(await screen.findByRole("dialog", { name: "Load Again" }));
    expect(dialog.getByText("Not the same title")).toBeInTheDocument();
    expect(dialog.getByText(/Check that it is the right file/)).toBeInTheDocument();
  });
});

describe("Library: a missing file is no longer missing once the book is back", () => {
  it("drops the row's File missing state when Load Again restores it", async () => {
    const s = setup({
      rows: [row(), loaded()],
      openBook: { state: "missing-asset" },
      review: review({
        verdict: undefined,
        restore: { key: "k1", title: "Hymns of Fellowship", state: "ok", titleMatches: true },
      }),
      commit: { ok: true, action: "replaced", key: "k1" },
    });
    s.view({ currentKey: "mal" });
    fireEvent.click(await screen.findByRole("button", { name: /^Hymns of Fellowship/ }));
    expect(await screen.findByText("File missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load Again" }));
    pickFile();
    const dialog = within(await screen.findByRole("dialog", { name: "Load Again" }));
    fireEvent.click(dialog.getByRole("button", { name: "Restore Book" }));
    await waitFor(() => expect(screen.queryByText("File missing")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^Hymns of Fellowship/ })).toBeInTheDocument();
  });

  it("drops it when Open Book opens the book", async () => {
    const s = setup({
      rows: [row(), loaded()],
      openBook: { state: "missing-asset" },
      review: review({
        verdict: { kind: "same-file", book: { key: "k1", title: "Hymns of Fellowship" } },
      }),
      commit: { ok: true, action: "opened", key: "k1" },
    });
    s.view({ currentKey: "mal" });
    fireEvent.click(await screen.findByRole("button", { name: /^Hymns of Fellowship/ }));
    await screen.findByText("File missing");
    pickFile();
    const dialog = within(await screen.findByRole("dialog", { name: "Load Books" }));
    fireEvent.click(dialog.getByRole("button", { name: "Open Book" }));
    await waitFor(() => expect(screen.queryByText("File missing")).not.toBeInTheDocument());
  });
});

describe("Library: removing the book on screen (SDD-0004 §10)", () => {
  async function askRemove(title = "Hymns of Fellowship") {
    fireEvent.click(await screen.findByRole("button", { name: `More for ${title}` }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove/ }));
    return within(await screen.findByRole("dialog", { name: "Remove Book" }));
  }

  it("is refused while that book is on the Output, and says to End Live first", async () => {
    const s = setup({ rows: [row(), loaded()] });
    s.view({ currentKey: "k1", presentedKey: "k1", outputLive: true });
    const dialog = await askRemove();
    expect(dialog.getByRole("alert")).toHaveTextContent(
      /on the Output now.*End Live first, then remove it/,
    );
    const button = dialog.getByRole("button", { name: "Remove Book" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(s.admin.removeBook).not.toHaveBeenCalled();
  });

  it("offers End Live where it refuses, and does not remove the book itself", async () => {
    const onEndLive = vi.fn();
    const s = setup({ rows: [row(), loaded()] });
    s.view({ currentKey: "k1", presentedKey: "k1", outputLive: true, onEndLive });
    const dialog = await askRemove();
    fireEvent.click(dialog.getByRole("button", { name: "End Live" }));
    expect(onEndLive).toHaveBeenCalledTimes(1);
    expect(s.admin.removeBook).not.toHaveBeenCalled();
  });

  it("is allowed when the Output is not live, and says the song on screen goes", async () => {
    const s = setup({ rows: [row(), loaded()] });
    s.view({ currentKey: "k1", presentedKey: "k1", outputLive: false });
    const dialog = await askRemove();
    expect(dialog.getByText(/The song on screen is from this book/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Remove Book" }));
    await waitFor(() => expect(s.admin.removeBook).toHaveBeenCalledWith("k1"));
  });

  it("a book that is not the one on screen can be removed while live", async () => {
    const s = setup({ rows: [row(), loaded()] });
    s.view({ currentKey: "mal", presentedKey: "mal", outputLive: true });
    const dialog = await askRemove();
    expect(dialog.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Remove Book" }));
    await waitFor(() => expect(s.admin.removeBook).toHaveBeenCalledWith("k1"));
  });
});

describe("Library: remove (SDD-0004 §9)", () => {
  it("cannot remove a shipped book, and says why", async () => {
    setup().view({ currentKey: "mal" });
    fireEvent.click(await screen.findByRole("button", { name: "More for Athmeeya Geethangal" }));
    const item = screen.getByRole("menuitem", { name: /Remove/ });
    expect(item).toBeDisabled();
    expect(item).toHaveTextContent("Shipped with the app");
  });

  it("names what it drops, and removes the book and its recents on confirmation", async () => {
    const s = setup({ rows: [row(), loaded()] });
    s.view({ currentKey: "k1" });
    fireEvent.click(await screen.findByRole("button", { name: "More for Hymns of Fellowship" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Remove Book" }));
    expect(dialog.getByText("Hymns of Fellowship")).toBeInTheDocument();
    expect(dialog.getByText(/its 275 songs leave this device/)).toBeInTheDocument();
    expect(dialog.getByText("Its Recents: 2 songs you opened.")).toBeInTheDocument();
    expect(dialog.getByText(/Your file isn’t touched/)).toBeInTheDocument();
    // It is the current book: the next held one takes over.
    expect(dialog.getByText("Athmeeya Geethangal")).toBeInTheDocument();
    expect(s.admin.removeBook).not.toHaveBeenCalled();

    fireEvent.click(dialog.getByRole("button", { name: "Remove Book" }));
    await waitFor(() => expect(s.admin.removeBook).toHaveBeenCalledWith("k1"));
    expect(s.userState.dropRecents).toHaveBeenCalledWith("k1");
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /^Hymns of Fellowship/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it("Cancel removes nothing", async () => {
    const s = setup({ rows: [row(), loaded()] });
    s.view({ currentKey: "mal" });
    fireEvent.click(await screen.findByRole("button", { name: "More for Hymns of Fellowship" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Remove Book" }));
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(s.admin.removeBook).not.toHaveBeenCalled();
    expect(s.userState.dropRecents).not.toHaveBeenCalled();
  });

  it("says when there will be nothing to search afterwards", async () => {
    const s = setup({ rows: [loaded()] });
    s.view({ currentKey: "k1" });
    fireEvent.click(await screen.findByRole("button", { name: "More for Hymns of Fellowship" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove/ }));
    expect(
      await screen.findByText(/there is nothing to search until you load another book/),
    ).toBeInTheDocument();
  });
});

describe("Library: the review sheet (ADR-0027)", () => {
  async function open(options: Setup, currentKey: string | null = "mal") {
    const s = setup({ rows: [row()], ...options });
    s.view({ currentKey: currentKey ?? undefined });
    await screen.findByRole("list", { name: "Books" });
    pickFile();
    const dialog = await screen.findByRole("dialog", { name: "Load Books" });
    return { s, dialog: within(dialog) };
  }

  it("shows the title, language, songs, origin and a short hash, read-only, before anything is written", async () => {
    const { s, dialog } = await open({});
    expect(dialog.getAllByText("Hymns of Fellowship").length).toBeGreaterThan(0);
    expect(dialog.getByText("English")).toBeInTheDocument();
    expect(dialog.getByText("hof")).toBeInTheDocument();
    expect(dialog.getByText("sha-256 · a3f9 c21e 07b4")).toBeInTheDocument();
    expect(dialog.getByText("A new book")).toBeInTheDocument();
    expect(dialog.queryByRole("textbox")).not.toBeInTheDocument();
    expect(s.admin.commit).not.toHaveBeenCalled();
  });

  it("shows a progress line in the list while the file is read", async () => {
    const s = setup({ rows: [row()] });
    let finish: (r: LoadReview) => void = () => {};
    s.admin.review.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    s.view({ currentKey: "mal" });
    await screen.findByRole("list", { name: "Books" });
    pickFile();
    expect(await screen.findByRole("progressbar", { name: "Reading…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load Books" })).toBeDisabled();
    finish(review());
    expect(await screen.findByRole("dialog", { name: "Load Books" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows the worker's phase and count on a determinate bar, only after the wait is long enough to notice", async () => {
    const s = setup({ rows: [row()] });
    let report: OnLoadProgress = () => {};
    s.admin.review.mockImplementation((_file, _target, onProgress) => {
      report = onProgress ?? report;
      return new Promise(() => {});
    });
    s.view({ currentKey: "mal" });
    await screen.findByRole("list", { name: "Books" });
    pickFile();
    await waitFor(() => expect(s.admin.review).toHaveBeenCalled());
    report({ phase: "checking", done: 812, total: 1631 });
    // A fast read shows nothing at all.
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    const bar = await screen.findByRole("progressbar", { name: "Checking 812 of 1,631 songs" });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("Checking 812 of 1,631 songs")).toBeInTheDocument();
    report({ phase: "hashing", done: 100, total: 1631 });
    expect(await screen.findByText("Comparing 100 of 1,631 songs")).toBeInTheDocument();
  });

  it("shows no bar at all for a read that finishes at once", async () => {
    const { dialog } = await open({});
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Load Book" })).toBeEnabled();
  });

  describe("writing the book (SDD-0004 §14)", () => {
    const write = async () => {
      const { s, dialog } = await open({});
      let report: OnLoadProgress = () => {};
      let finish: (r: CommitResult) => void = () => {};
      s.admin.commit.mockImplementation((_token, _choice, onProgress) => {
        report = onProgress ?? report;
        return new Promise((resolve) => (finish = resolve));
      });
      fireEvent.click(dialog.getByRole("button", { name: "Load Book" }));
      await waitFor(() => expect(s.admin.commit).toHaveBeenCalled());
      return { s, dialog, report: (p: Parameters<OnLoadProgress>[0]) => report(p), finish };
    };

    it("the button gives way to the bar, with no Cancel, only Close", async () => {
      const { dialog, report } = await write();
      // At first, a button that is off, and nothing else to see.
      expect(dialog.getByRole("button", { name: "Load Book" })).toBeDisabled();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      report({ phase: "saving", done: 1200, total: 1631 });
      const bar = await screen.findByRole("progressbar", { name: "Saving 1,200 of 1,631 songs" });
      expect(bar).toHaveAttribute("aria-valuenow", "74");
      expect(dialog.queryByRole("button", { name: "Load Book" })).not.toBeInTheDocument();
      expect(dialog.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
      expect(dialog.getByRole("button", { name: "Close" })).toBeInTheDocument();
      report({ phase: "indexing", done: 0, total: 0 });
      const sweep = await screen.findByRole("progressbar", { name: "Indexing for search…" });
      expect(sweep).not.toHaveAttribute("aria-valuenow");
    });

    it("a write that lands quickly shows no bar", async () => {
      const { s, dialog } = await open({});
      fireEvent.click(dialog.getByRole("button", { name: "Load Book" }));
      await waitFor(() => expect(s.admin.listBooks.mock.calls.length).toBeGreaterThan(1));
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("closing the sheet lets the save finish; the Library's row shows the same bar", async () => {
      const { s, dialog, report, finish } = await write();
      fireEvent.click(dialog.getByRole("button", { name: "Close" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Load Books" })).not.toBeInTheDocument(),
      );
      // A save is not taken back: nothing is cancelled.
      expect(s.admin.cancel).not.toHaveBeenCalled();
      report({ phase: "saving", done: 10, total: 275 });
      expect(await screen.findByText("Saving Hymns of Fellowship")).toBeInTheDocument();
      expect(screen.getByRole("progressbar", { name: "Saving 10 of 275 songs" })).toHaveAttribute(
        "aria-valuenow",
        "4",
      );
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
      // Nothing new can begin under it.
      expect(screen.getByRole("button", { name: "Load Books" })).toBeDisabled();
      finish({ ok: true, action: "loaded", key: "k1" });
      await waitFor(() => expect(screen.queryByText(/^Saving /)).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Load Books" })).toBeEnabled();
      expect(s.onNotice).not.toHaveBeenCalled();
    });

    it("a save that fails after the sheet was closed says so in the snackbar", async () => {
      const { s, dialog, finish } = await write();
      fireEvent.click(dialog.getByRole("button", { name: "Close" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Load Books" })).not.toBeInTheDocument(),
      );
      finish({ ok: false, reason: "failed", message: "storage is full" });
      await waitFor(() =>
        expect(s.onNotice).toHaveBeenCalledWith(
          "Hymns of Fellowship: Couldn’t load the book: storage is full",
        ),
      );
      expect(screen.getByRole("button", { name: "Load Books" })).toBeEnabled();
    });

    it("a save that fails with the sheet open says so there, and the button returns", async () => {
      const { dialog, finish } = await write();
      finish({ ok: false, reason: "failed", message: "storage is full" });
      expect(await dialog.findByRole("alert")).toHaveTextContent("storage is full");
      expect(dialog.getByRole("button", { name: "Load Book" })).toBeEnabled();
    });
  });

  it("new: Load Book writes it; the current book stays when there is one", async () => {
    const { s, dialog } = await open({});
    fireEvent.click(dialog.getByRole("button", { name: "Load Book" }));
    await waitFor(() =>
      expect(s.admin.commit).toHaveBeenCalledWith("t1", "keep-both", expect.any(Function)),
    );
    await waitFor(() => expect(s.admin.listBooks.mock.calls.length).toBeGreaterThan(1));
    expect(s.onChoose).not.toHaveBeenCalled();
  });

  it("new: the first load makes the book current, and asks for storage; a refusal says to keep the file", async () => {
    const { s, dialog } = await open(
      { commit: { ok: true, action: "loaded", key: "k1", firstLoad: true } },
      null,
    );
    fireEvent.click(dialog.getByRole("button", { name: "Load Book" }));
    await waitFor(() => expect(s.onChoose).toHaveBeenCalledWith("k1"));
    expect(s.persist).toHaveBeenCalled();
    await waitFor(() => expect(s.onStorageRefused).toHaveBeenCalled());
  });

  it("new: no note when storage was granted", async () => {
    const { s, dialog } = await open(
      { commit: { ok: true, action: "loaded", key: "k1", firstLoad: true } },
      null,
    );
    s.persist.mockResolvedValue("granted" as never);
    fireEvent.click(dialog.getByRole("button", { name: "Load Book" }));
    await waitFor(() => expect(s.onChoose).toHaveBeenCalledWith("k1"));
    expect(s.onStorageRefused).not.toHaveBeenCalled();
  });

  it("new: an unanswered storage prompt does not hold the load; the note comes when it is refused", async () => {
    const { s, dialog } = await open(
      { commit: { ok: true, action: "loaded", key: "k1", firstLoad: true } },
      null,
    );
    let answer: (r: "refused") => void = () => {};
    s.persist.mockImplementation(() => new Promise((resolve) => (answer = resolve)) as never);
    fireEvent.click(dialog.getByRole("button", { name: "Load Book" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Load Books" })).not.toBeInTheDocument(),
    );
    expect(s.onChoose).toHaveBeenCalledWith("k1");
    expect(screen.getByRole("button", { name: "Load Books" })).toBeEnabled();
    expect(s.persist).toHaveBeenCalled();
    expect(s.onStorageRefused).not.toHaveBeenCalled();
    answer("refused");
    await waitFor(() => expect(s.onStorageRefused).toHaveBeenCalled());
  });

  it("new: a storage request that throws is not an unhandled rejection, and says nothing", async () => {
    const { s, dialog } = await open(
      { commit: { ok: true, action: "loaded", key: "k1", firstLoad: true } },
      null,
    );
    s.persist.mockRejectedValue(new Error("no"));
    fireEvent.click(dialog.getByRole("button", { name: "Load Book" }));
    await waitFor(() => expect(s.onChoose).toHaveBeenCalledWith("k1"));
    await waitFor(() => expect(s.persist).toHaveBeenCalled());
    await Promise.resolve();
    expect(s.onStorageRefused).not.toHaveBeenCalled();
  });

  it("flags songs held in other books, by book, and still loads", async () => {
    const { dialog } = await open({
      review: review({
        held: {
          count: 212,
          books: [
            { key: "x", title: "Songs of Zion", count: 200 },
            { key: "y", title: "Big", count: 12 },
          ],
        },
      }),
    });
    expect(dialog.getByText(/212 of these songs are also in/)).toBeInTheDocument();
    expect(dialog.getByText("Songs of Zion")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Load Book" })).toBeEnabled();
  });

  it("rejected: lists every violation, repairs none, and offers no load", async () => {
    const { s, dialog } = await open({
      review: review({
        token: "",
        title: "",
        verdict: undefined,
        violations: [
          { rule: "I4", where: "hymn 14", message: "a part has no lines" },
          { rule: "I6", where: "hymn 48", message: "a line is blank" },
        ],
      }),
    });
    expect(dialog.getByText("This book can’t be loaded")).toBeInTheDocument();
    expect(dialog.getByText(/breaks 2 rules/)).toBeInTheDocument();
    const list = within(dialog.getByRole("list", { name: "Violations" }));
    expect(list.getAllByRole("listitem")).toHaveLength(2);
    expect(list.getByText("hymn 14")).toBeInTheDocument();
    expect(list.getByText("I4")).toBeInTheDocument();
    expect(
      dialog.queryByRole("button", { name: /Load Book|Open Book|Keep Both/ }),
    ).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Choose Another File" })).toBeInTheDocument();
    expect(s.admin.commit).not.toHaveBeenCalled();
  });

  it("rejected for a newer format: says so, naming both versions", async () => {
    const { dialog } = await open({
      review: review({
        token: "",
        title: "",
        verdict: undefined,
        violations: [
          {
            rule: "format",
            where: "hymnbook",
            message: "this book needs a newer app: it is format 2; this app reads format 1",
          },
        ],
      }),
    });
    expect(dialog.getByText("This book needs a newer app")).toBeInTheDocument();
    expect(dialog.getByText(/it is format 2; this app reads format 1/)).toBeInTheDocument();
  });

  it("rejected as not a hymnbook container", async () => {
    const { dialog } = await open({
      review: review({
        token: "",
        title: "",
        verdict: undefined,
        violations: [{ rule: "container", where: "file", message: "not a hymnbook container" }],
      }),
    });
    expect(dialog.getByText("This isn’t a hymnbook file")).toBeInTheDocument();
    expect(dialog.getByText("hof.hymnbook.json.gz")).toBeInTheDocument();
  });

  it("same file: Open Book, which chooses that book", async () => {
    const { s, dialog } = await open({
      review: review({
        verdict: { kind: "same-file", book: { key: "k1", title: "Hymns of Fellowship" } },
      }),
      commit: { ok: true, action: "opened", key: "k1" },
    });
    expect(dialog.getByText("You already have this file")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Close" })).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Open Book" }));
    await waitFor(() => expect(s.onChoose).toHaveBeenCalledWith("k1"));
  });

  it("same songs: Open Book records the file; Cancel writes nothing", async () => {
    const { s, dialog } = await open({
      review: review({
        verdict: { kind: "same-songs", book: { key: "k1", title: "Hymns of Fellowship" } },
      }),
      commit: { ok: true, action: "recorded", key: "k1" },
    });
    expect(dialog.getByText("You already hold these songs")).toBeInTheDocument();
    expect(dialog.getByText(/Opening records this file/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(s.admin.commit).not.toHaveBeenCalled();
    await waitFor(() => expect(s.admin.cancel).toHaveBeenCalledWith("t1"));
  });

  const sameOrigin = (books: { key: string; title: string; replaceable: boolean }[]) =>
    review({ verdict: { kind: "same-origin", books } });

  it("same origin: Keep both is the default; Replace is a choice, and says what it keeps", async () => {
    const { s, dialog } = await open({
      review: sameOrigin([{ key: "k1", title: "Hymns of Fellowship", replaceable: true }]),
    });
    expect(dialog.getByRole("radio", { name: /Keep both/ })).toBeChecked();
    expect(dialog.getByText(/its Recents and position still point at it/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Keep Both" })).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Keep Both" }));
    await waitFor(() =>
      expect(s.admin.commit).toHaveBeenCalledWith("t1", "keep-both", expect.any(Function)),
    );
  });

  it("same origin: choosing Replace changes the button, warns it cannot be undone, and replaces that book", async () => {
    const { s, dialog } = await open({
      review: sameOrigin([
        { key: "k1", title: "Hymns of Fellowship", replaceable: true },
        { key: "mal", title: "Athmeeya Geethangal", replaceable: false },
      ]),
      commit: { ok: true, action: "replaced", key: "k1" },
    });
    // A shipped book's Replace is shown, and not offered.
    expect(
      dialog.getByRole("radio", { name: /Replace Athmeeya Geethangal \(shipped\)/ }),
    ).toBeDisabled();
    fireEvent.click(dialog.getByRole("radio", { name: /Replace Hymns of Fellowship/ }));
    expect(dialog.getByText(/Replace can’t be undone/)).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Replace" }));
    await waitFor(() =>
      expect(s.admin.commit).toHaveBeenCalledWith("t1", { replace: "k1" }, expect.any(Function)),
    );
  });

  it("says why a commit was refused, and keeps the sheet", async () => {
    const { dialog } = await open({
      commit: {
        ok: false,
        reason: "stale",
        message: "the books held changed; read the file again",
      },
    });
    fireEvent.click(dialog.getByRole("button", { name: "Load Book" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent(/books on this device changed/);
    expect(dialog.getByRole("button", { name: "Load Book" })).toBeEnabled();
  });

  it("Cancel throws the parsed book away and writes nothing", async () => {
    const { s, dialog } = await open({});
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(s.admin.cancel).toHaveBeenCalledWith("t1"));
    expect(s.admin.commit).not.toHaveBeenCalled();
  });

  it("a file that cannot be read says so in the list", async () => {
    const s = setup({ rows: [row()], review: new Error("boom") });
    s.view({ currentKey: "mal" });
    await screen.findByRole("list", { name: "Books" });
    pickFile();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn’t read hof.hymnbook.json.gz: boom",
    );
  });
});

describe("Library: a window that does not keep books (SDD-0004 §15)", () => {
  const LINE = "This window doesn’t keep books. They go when it closes, so keep the file.";

  it("says so under the list, and not that the books stay", async () => {
    const s = setup({ mode: "memory" });
    s.view();
    expect(await screen.findByText(LINE)).toBeInTheDocument();
    expect(screen.queryByText(/Books stay on this device/)).not.toBeInTheDocument();
  });

  it("counts the books in this window, not on this device", async () => {
    const s = setup({ mode: "memory" });
    s.view();
    expect(await screen.findByText("1 book in this window")).toBeInTheDocument();
    expect(screen.queryByText(/on this device/)).not.toBeInTheDocument();
  });

  it("says nothing of keeping, either way, until the mode is known", async () => {
    const s = setup();
    let answer: (mode: StorageMode) => void = () => {};
    s.admin.storageMode.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    s.view();
    await screen.findByRole("list", { name: "Books" });
    expect(screen.getByText("1 book")).toBeInTheDocument();
    expect(screen.queryByText(/Books stay on this device/)).not.toBeInTheDocument();
    expect(screen.queryByText(LINE)).not.toBeInTheDocument();
    answer("memory");
    expect(await screen.findByText(LINE)).toBeInTheDocument();
  });

  it("says so in the first-run card, in place of the books staying", async () => {
    const s = setup({ rows: [], mode: "memory" });
    s.view();
    await screen.findByRole("heading", { name: "Bring a songbook" });
    expect(await screen.findByText(new RegExp(LINE))).toBeInTheDocument();
    expect(screen.queryByText(/It stays on this device/)).not.toBeInTheDocument();
  });

  it("says nothing of it where books are kept", async () => {
    const s = setup();
    s.view();
    expect(await screen.findByText(/Books stay on this device/)).toBeInTheDocument();
    expect(screen.queryByText(LINE)).not.toBeInTheDocument();
  });

  it("does not ask for persistent storage at the first load, nor say the request was refused", async () => {
    const s = setup({
      mode: "memory",
      commit: { ok: true, action: "loaded", key: "k1", firstLoad: true },
    });
    s.view();
    await screen.findByText(LINE);
    pickFile();
    const dialog = within(await screen.findByRole("dialog", { name: "Load Books" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Load Book" }));
    await waitFor(() => expect(s.onChoose).toHaveBeenCalledWith("k1"));
    expect(s.persist).not.toHaveBeenCalled();
    expect(s.onStorageRefused).not.toHaveBeenCalled();
  });
});

describe("Library: several books at once, reviewed as a queue (SDD-0004 §9)", () => {
  /** A review per file, named after it; the token is the file's number, and a later review of the
   * same file has a token of its own ("t-1#2"), as the session would give it. */
  const queueSetup = () => {
    const s = setup({ rows: [row()] });
    const reads = new Map<string, number>();
    s.admin.review.mockImplementation(async (file: File) => {
      if (file.name.startsWith("bad")) throw new Error("not readable");
      const n = file.name.slice(0, 1);
      const times = (reads.get(n) ?? 0) + 1;
      reads.set(n, times);
      return review({ token: times === 1 ? `t-${n}` : `t-${n}#${times}`, title: `Book ${n}` });
    });
    s.admin.commit.mockImplementation(async (token: string) => ({
      ok: true as const,
      action: "loaded" as const,
      key: token,
    }));
    s.view({ currentKey: "mal" });
    return s;
  };
  const sheet = () => screen.findByRole("dialog", { name: "Load Books" });
  const next = () => fireEvent.click(screen.getByRole("button", { name: "Next book" }));
  const back = () => fireEvent.click(screen.getByRole("button", { name: "Previous book" }));
  const load = () => fireEvent.click(screen.getByRole("button", { name: "Load Book" }));
  const three = ["1.hymnbook.json.gz", "2.hymnbook.json.gz", "3.hymnbook.json.gz"];

  it("accepts several files at once, but one for Load Again", async () => {
    queueSetup();
    await screen.findByRole("list", { name: "Books" });
    expect(screen.getByTestId("book-file")).toHaveAttribute("multiple");
  });

  it("reviews the first at once, and the next after Load Book", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles(...three);
    const first = within(await sheet());
    expect(await first.findByText("Book 1 of 3")).toBeInTheDocument();
    expect(first.getByRole("heading", { name: "Book 1" })).toBeInTheDocument();
    expect(s.admin.review).toHaveBeenCalledTimes(1);
    fireEvent.click(first.getByRole("button", { name: "Load Book" }));
    await waitFor(() =>
      expect(s.admin.commit).toHaveBeenCalledWith("t-1", "keep-both", expect.any(Function)),
    );
    expect(await screen.findByText("Book 2 of 3")).toBeInTheDocument();
    expect(s.admin.review.mock.calls.map(([file]) => file.name)).toEqual([
      "1.hymnbook.json.gz",
      "2.hymnbook.json.gz",
    ]);
  });

  it("Next looks at the next book without deciding this one; Back returns to it, read again", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles(...three);
    await screen.findByText("Book 1 of 3");
    next();
    expect(await screen.findByText("Book 2 of 3")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Book 2" })).toBeInTheDocument();
    expect(s.admin.commit).not.toHaveBeenCalled();
    back();
    expect(await screen.findByText("Book 1 of 3")).toBeInTheDocument();
    // The books held may have changed, so what is shown is read again; the commit takes its token.
    await waitFor(() => expect(s.admin.review).toHaveBeenCalledTimes(3));
    expect(s.admin.review.mock.calls.map(([file]) => file.name)).toEqual([
      "1.hymnbook.json.gz",
      "2.hymnbook.json.gz",
      "1.hymnbook.json.gz",
    ]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Load Book" })).toBeEnabled());
    load();
    await waitFor(() =>
      expect(s.admin.commit).toHaveBeenCalledWith("t-1#2", "keep-both", expect.any(Function)),
    );
  });

  it("Back is off on the first book and Next on the last", async () => {
    queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles(...three);
    await screen.findByText("Book 1 of 3");
    expect(screen.getByRole("button", { name: "Previous book" })).toBeDisabled();
    next();
    await screen.findByText("Book 2 of 3");
    expect(screen.getByRole("button", { name: "Previous book" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next book" })).toBeEnabled();
    next();
    await screen.findByText("Book 3 of 3");
    expect(screen.getByRole("button", { name: "Next book" })).toBeDisabled();
  });

  it("a book returned to shows at once, but cannot be loaded until it is read again", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles(...three);
    await screen.findByText("Book 1 of 3");
    next();
    await screen.findByText("Book 2 of 3");
    await waitFor(() => expect(s.admin.review).toHaveBeenCalledTimes(2));
    let land: (r: LoadReview) => void = () => {};
    s.admin.review.mockImplementationOnce(() => new Promise((resolve) => (land = resolve)));
    back();
    expect(await screen.findByText("Book 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Book 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load Book" })).toBeDisabled();
    land(review({ token: "fresh", title: "Book 1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Load Book" })).toBeEnabled());
    load();
    await waitFor(() =>
      expect(s.admin.commit).toHaveBeenCalledWith("fresh", "keep-both", expect.any(Function)),
    );
  });

  it("the arrow keys go Back and Next", async () => {
    queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles(...three);
    await screen.findByText("Book 1 of 3");
    const dialog = await sheet();
    fireEvent.keyDown(within(dialog).getByRole("button", { name: "Next book" }), {
      key: "ArrowRight",
    });
    expect(await screen.findByText("Book 2 of 3")).toBeInTheDocument();
    fireEvent.keyDown(within(dialog).getByRole("button", { name: "Next book" }), {
      key: "ArrowLeft",
    });
    expect(await screen.findByText("Book 1 of 3")).toBeInTheDocument();
  });

  it("books are decided out of order: each commits with the review in view, one at a time", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles(...three);
    await screen.findByText("Book 1 of 3");
    next();
    await screen.findByText("Book 2 of 3");
    next();
    await screen.findByText("Book 3 of 3");
    await waitFor(() => expect(screen.getByRole("button", { name: "Load Book" })).toBeEnabled());
    // Book 3 first. 1 and 2 are still open, so the sheet goes on to the first open one (1).
    load();
    await waitFor(() =>
      expect(s.admin.commit).toHaveBeenCalledWith("t-3", "keep-both", expect.any(Function)),
    );
    expect(await screen.findByText("Book 1 of 3")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Load Book" })).toBeEnabled());
    next();
    await screen.findByText("Book 2 of 3");
    // Book 3 is decided: it says so, with nothing to press.
    next();
    expect(await screen.findByText("Book 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Loaded", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Loaded" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Load Book" })).not.toBeInTheDocument();
    back();
    await screen.findByText("Book 2 of 3");
    await waitFor(() => expect(screen.getByRole("button", { name: "Load Book" })).toBeEnabled());
    load();
    await waitFor(() => expect(s.admin.commit).toHaveBeenCalledTimes(2));
    // Only book 1 is open now.
    expect(await screen.findByText("Book 1 of 3")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Load Book" })).toBeEnabled());
    load();
    await waitFor(() => expect(s.admin.commit).toHaveBeenCalledTimes(3));
    // Every book decided: the sheet is done, and has nothing to say about it.
    await waitFor(() => expect(screen.queryByText(/Book \d of 3/)).not.toBeInTheDocument());
    const tokens = s.admin.commit.mock.calls.map(([token]) => token);
    expect(tokens[0]).toBe("t-3");
    expect(tokens).toHaveLength(3);
    expect(new Set(tokens).size).toBe(3);
    expect(s.onNotice).not.toHaveBeenCalled();
  });

  it("a book read for the first time in the open sheet shows the worker's progress", async () => {
    const s = queueSetup();
    let report: OnLoadProgress = () => {};
    s.admin.review.mockImplementation((file: File, _target, onProgress) => {
      if (file.name.startsWith("1"))
        return Promise.resolve(review({ token: "t-1", title: "Book 1" }));
      report = onProgress ?? report;
      return new Promise(() => {});
    });
    await screen.findByRole("list", { name: "Books" });
    pickFiles("1.hymnbook.json.gz", "2.hymnbook.json.gz");
    await screen.findByText("Book 1 of 2");
    await waitFor(() => expect(screen.getByRole("button", { name: "Load Book" })).toBeEnabled());
    next();
    report({ phase: "checking", done: 40, total: 275 });
    expect(
      await screen.findByRole("progressbar", { name: "Checking 40 of 275 songs" }),
    ).toBeInTheDocument();
    // Reading can still be given up: the sheet closes, and the read is thrown away.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
  });

  it("Back and Next are off while a book is being written", async () => {
    const s = queueSetup();
    let finish: (r: CommitResult) => void = () => {};
    s.admin.commit.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await screen.findByRole("list", { name: "Books" });
    pickFiles(...three);
    await screen.findByText("Book 1 of 3");
    load();
    await waitFor(() => expect(s.admin.commit).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Next book" })).toBeDisabled();
    finish({ ok: true, action: "loaded", key: "k1" });
    expect(await screen.findByText("Book 2 of 3")).toBeInTheDocument();
  });

  it("a book read for the first time in the open sheet says so, and one overtaken by Back is thrown away", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles(...three);
    await screen.findByText("Book 1 of 3");
    let land: (r: LoadReview) => void = () => {};
    s.admin.review.mockImplementationOnce(() => new Promise((resolve) => (land = resolve)));
    next();
    // Book 2 is being read: the sheet says so, and nothing can be loaded from it.
    expect(
      await screen.findByText("Checking the file on this device. Nothing is sent anywhere."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load Book" })).not.toBeInTheDocument();
    back();
    expect(await screen.findByText("Book 1 of 3")).toBeInTheDocument();
    land(review({ token: "t-2", title: "Book 2" }));
    await waitFor(() => expect(s.admin.cancel).toHaveBeenCalledWith("t-2"));
    // Book 1 is still what is in view.
    expect(screen.getByRole("heading", { name: "Book 1" })).toBeInTheDocument();
  });

  it("closing the sheet leaves the undecided books unloaded, and says nothing", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles(...three);
    const first = within(await sheet());
    await first.findByText("Book 1 of 3");
    fireEvent.click(first.getByRole("button", { name: "Load Book" }));
    await screen.findByText("Book 2 of 3");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(s.onNotice).not.toHaveBeenCalled();
    expect(s.admin.review).toHaveBeenCalledTimes(2);
    expect(s.admin.commit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Book \d of 3/)).not.toBeInTheDocument();
  });

  it("cancelling with one book left says nothing either", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles("1.hymnbook.json.gz", "2.hymnbook.json.gz");
    const first = within(await sheet());
    await first.findByText("Book 1 of 2");
    fireEvent.click(first.getByRole("button", { name: "Load Book" }));
    await screen.findByText("Book 2 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText(/Book \d of 2/)).not.toBeInTheDocument());
    expect(s.onNotice).not.toHaveBeenCalled();
  });

  it("a reviewed book's sheet hugs its content: no minimum height held once it is read (#53)", async () => {
    queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles("1.hymnbook.json.gz");
    const load = await screen.findByRole("button", { name: "Load Book" });
    expect(load.closest("dialog")).not.toHaveClass("sheet-steady");
  });

  it("closing a single book's review says nothing", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles("1.hymnbook.json.gz");
    await screen.findByRole("button", { name: "Load Book" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(s.admin.cancel).toHaveBeenCalledWith("t-1"));
    expect(s.onNotice).not.toHaveBeenCalled();
  });

  it("a file that cannot be read is said, in the sheet too, and is not a notice when cancelled", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles("bad.hymnbook.json.gz", "2.hymnbook.json.gz");
    const dialog = within(await sheet());
    expect(await dialog.findByRole("heading", { name: "Book 2" })).toBeInTheDocument();
    expect(s.admin.review).toHaveBeenCalledTimes(2);
    // One readable book left: no queue to speak of, but the file that failed is said here.
    expect(dialog.queryByText(/Book \d of/)).not.toBeInTheDocument();
    expect(
      within(dialog.getByRole("list", { name: "Files not read" })).getByText(
        /Couldn’t read bad\.hymnbook\.json\.gz: not readable/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(
      await screen.findByText(/Couldn’t read bad\.hymnbook\.json\.gz: not readable/),
    ).toBeInTheDocument();
    expect(s.onNotice).not.toHaveBeenCalled();
  });

  it("the sheet stays open from one book to the next, and closes only after the last", async () => {
    queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles(...three);
    const dialog = (await sheet()) as HTMLDialogElement;
    await screen.findByText("Book 1 of 3");
    const closings: boolean[] = [];
    const watch = new MutationObserver(() => closings.push(dialog.open));
    watch.observe(dialog, { attributes: true, attributeFilter: ["open"] });
    for (const n of [2, 3]) {
      await waitFor(() => expect(screen.getByRole("button", { name: "Load Book" })).toBeEnabled());
      load();
      await screen.findByText(`Book ${n} of 3`);
      expect(dialog.open).toBe(true);
    }
    await waitFor(() => expect(screen.getByRole("button", { name: "Load Book" })).toBeEnabled());
    load();
    await waitFor(() => expect(dialog.open).toBe(false));
    watch.disconnect();
    // Closed once, at the end: never closed and reopened between books.
    expect(closings).toEqual([false]);
  });

  it("while a book is written and the list read, a new pick is not taken, and the buttons are off", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles(...three);
    await screen.findByText("Book 1 of 3");
    let release: () => void = () => {};
    s.admin.listBooks.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve([row()]))),
    );
    const reads = s.admin.listBooks.mock.calls.length;
    load();
    await waitFor(() => expect(s.admin.commit).toHaveBeenCalled());
    // The write is done and the list is being read: that read is the one held back.
    await waitFor(() => expect(s.admin.listBooks.mock.calls.length).toBeGreaterThan(reads));
    // A file picked now (the hidden input needs no button) begins nothing.
    pickFiles("9.hymnbook.json.gz");
    expect(s.admin.review).toHaveBeenCalledTimes(1);
    release();
    // The queue goes on where it was: book 2 of the first three.
    expect(await screen.findByText("Book 2 of 3")).toBeInTheDocument();
    expect(s.admin.review.mock.calls.map(([file]) => file.name)).toEqual([
      "1.hymnbook.json.gz",
      "2.hymnbook.json.gz",
    ]);
  });

  it("when Next goes off under the focus, the focus moves to Back and the arrows keep working", async () => {
    queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles(...three);
    await screen.findByText("Book 1 of 3");
    const nextButton = screen.getByRole("button", { name: "Next book" });
    nextButton.focus();
    next();
    await screen.findByText("Book 2 of 3");
    screen.getByRole("button", { name: "Next book" }).focus();
    next();
    await screen.findByText("Book 3 of 3");
    expect(screen.getByRole("button", { name: "Next book" })).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Previous book" })).toHaveFocus(),
    );
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(await screen.findByText("Book 2 of 3")).toBeInTheDocument();
  });

  it("one file is not a queue: no position, no Back or Next", async () => {
    queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles("1.hymnbook.json.gz");
    const only = within(await sheet());
    await only.findByRole("button", { name: "Load Book" });
    expect(only.queryByText(/Book 1 of 1/)).not.toBeInTheDocument();
    expect(only.queryByRole("button", { name: "Next book" })).not.toBeInTheDocument();
    expect(only.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
  });
});

describe("Library: a backup picked in Load Books (SDD-0006 §5)", () => {
  it("accepts .hymnal files in the picker", async () => {
    const s = setup();
    s.view();
    await screen.findByRole("list", { name: "Books" });
    expect(screen.getByTestId("book-file")).toHaveAttribute(
      "accept",
      expect.stringContaining(".hymnal"),
    );
  });

  it("opens the restore sheet for one file that is a backup, whatever it is called", async () => {
    const s = setup({ backups: ["notes.gz"] });
    s.view({ currentKey: "mal" });
    await screen.findByRole("list", { name: "Books" });
    pickFile("notes.gz");
    await waitFor(() => expect(s.onRestore).toHaveBeenCalledTimes(1));
    expect(s.onRestore.mock.calls[0]?.[0]).toMatchObject({ name: "notes.gz" });
    expect(s.admin.review).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Load Books" })).not.toBeInTheDocument();
  });

  it("reviews a file called .hymnal as a book when its content is not a backup", async () => {
    const s = setup();
    s.view({ currentKey: "mal" });
    await screen.findByRole("list", { name: "Books" });
    pickFile("odd.hymnal");
    expect(await screen.findByRole("dialog", { name: "Load Books" })).toBeInTheDocument();
    expect(s.onRestore).not.toHaveBeenCalled();
  });

  it("refuses a backup picked with books, and goes on with the books", async () => {
    const s = setup({ backups: ["all.hymnal"] });
    s.view({ currentKey: "mal" });
    await screen.findByRole("list", { name: "Books" });
    pickFiles("all.hymnal", "1.hymnbook.json.gz");
    const sheet = await screen.findByRole("dialog", { name: "Load Books" });
    expect(within(sheet).getByText("Restore a backup on its own.")).toBeInTheDocument();
    expect(s.onRestore).not.toHaveBeenCalled();
    expect(s.admin.review).toHaveBeenCalledTimes(1);
    expect(s.admin.review.mock.calls[0]?.[0]).toMatchObject({ name: "1.hymnbook.json.gz" });
  });

  it("does not route a backup picked for Load Again; it says where to restore it", async () => {
    const s = setup({
      rows: [row(), loaded({ key: "a", title: "Hymns of Praise", state: "needs-reloading" })],
      backups: ["all.hymnal"],
    });
    s.view({ currentKey: "mal" });
    fireEvent.click(await screen.findByRole("button", { name: "Load Again" }));
    pickFile("all.hymnal");
    expect(
      await screen.findByText("That’s a backup. Restore it from Settings or Load Books."),
    ).toBeInTheDocument();
    expect(s.onRestore).not.toHaveBeenCalled();
    expect(s.admin.review).not.toHaveBeenCalled();
  });

  it("ignores a second pick while the first is being looked at", async () => {
    const s = setup({ backups: ["a.hymnal"] });
    let answer: (is: boolean) => void = () => {};
    s.admin.isBackup.mockImplementationOnce(() => new Promise<boolean>((r) => (answer = r)));
    s.view({ currentKey: "mal" });
    await screen.findByRole("list", { name: "Books" });
    pickFile("a.hymnal");
    pickFile("1.hymnbook.json.gz");
    answer(true);
    await waitFor(() => expect(s.onRestore).toHaveBeenCalledTimes(1));
    expect(s.admin.isBackup).toHaveBeenCalledTimes(1);
    expect(s.admin.review).not.toHaveBeenCalled();
  });

  it("says only that line when every file picked is a backup", async () => {
    const s = setup({ backups: ["a.hymnal", "b.hymnal"] });
    s.view({ currentKey: "mal" });
    await screen.findByRole("list", { name: "Books" });
    pickFiles("a.hymnal", "b.hymnal");
    expect(await screen.findByText("Restore a backup on its own.")).toBeInTheDocument();
    expect(s.onRestore).not.toHaveBeenCalled();
    expect(s.admin.review).not.toHaveBeenCalled();
  });
});

describe("Library: the sample (Board #43)", () => {
  const SAMPLE = "otterbein-hymnal-sample.hymnbook.json.gz";

  it("offers no sample where the build has none", async () => {
    setup({ rows: [] }).view();
    await screen.findByRole("heading", { name: "Bring a songbook" });
    expect(screen.queryByRole("button", { name: "Try the Sample" })).not.toBeInTheDocument();
  });

  it("fetches the sample from this site and loads it like a picked file", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([0x1f, 0x8b, 8, 0])));
    vi.stubGlobal("fetch", fetch);
    try {
      const s = setup({ rows: [], sample: [SAMPLE] });
      s.view();
      fireEvent.click(await screen.findByRole("button", { name: "Try the Sample" }));
      await waitFor(() => expect(s.admin.review).toHaveBeenCalled());
      expect(fetch).toHaveBeenCalledWith(`/sample/${SAMPLE}`);
      expect(s.admin.review.mock.calls[0]?.[0].name).toBe(SAMPLE);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hands on a gzip file where the server already undid the gzip (Content-Encoding)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"format":1}')),
    );
    try {
      const s = setup({ rows: [], sample: [SAMPLE] });
      s.view();
      fireEvent.click(await screen.findByRole("button", { name: "Try the Sample" }));
      await waitFor(() => expect(s.admin.review).toHaveBeenCalled());
      const file = s.admin.review.mock.calls[0]?.[0] as File;
      const head = new Uint8Array(await file.arrayBuffer()).slice(0, 2);
      expect([...head]).toEqual([0x1f, 0x8b]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("offers the rest of the sample under a Library's list, fetching only what is missing", async () => {
    const other = "malayalam-public-domain-sample.hymnbook.json.gz";
    const fetch = vi.fn(async () => new Response(new Uint8Array([0x1f, 0x8b, 8, 0])));
    vi.stubGlobal("fetch", fetch);
    try {
      const s = setup({
        rows: [loaded({ origin: "otterbein-hymnal-sample", title: "The Otterbein Hymnal" })],
        sample: [SAMPLE, other],
      });
      s.view();
      await screen.findByRole("list", { name: "Books" });
      fireEvent.click(await screen.findByRole("button", { name: "Try the Sample" }));
      await waitFor(() => expect(s.admin.review).toHaveBeenCalled());
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(`/sample/${other}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("offers no sample once every sample book is loaded", async () => {
    setup({
      rows: [loaded({ origin: "otterbein-hymnal-sample" })],
      sample: [SAMPLE],
    }).view();
    await screen.findByRole("list", { name: "Books" });
    expect(screen.queryByRole("button", { name: "Try the Sample" })).not.toBeInTheDocument();
  });

  it("says so when the sample cannot be fetched, and loads nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    try {
      const s = setup({ rows: [], sample: [SAMPLE] });
      s.view();
      fireEvent.click(await screen.findByRole("button", { name: "Try the Sample" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/couldn’t be fetched/);
      expect(s.admin.review).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
