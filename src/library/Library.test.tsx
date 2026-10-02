import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type {
  BookRow,
  Choice,
  CommitResult,
  ContentStatus,
  LoadReview,
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
}

function setup(options: Setup = {}) {
  let rows = options.rows ?? [row()];
  const admin = {
    listBooks: vi.fn(async () => rows),
    review: vi.fn(async (_file: File, _target?: string) => {
      const r = options.review ?? review();
      if (r instanceof Error) throw r;
      return r;
    }),
    commit: vi.fn(
      async (_token: string, _choice?: Choice): Promise<CommitResult> =>
        options.commit ?? { ok: true, action: "loaded", key: "k1" },
    ),
    cancel: vi.fn(async () => true),
    removeBook: vi.fn(async (key: string) => {
      rows = rows.filter((b) => b.key !== key);
      return true;
    }),
    openBook: vi.fn(async (): Promise<ContentStatus> => options.openBook ?? { state: "ready" }),
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
  const persist = vi.fn(async () => "refused" as const);
  const view = (
    props: {
      currentKey?: string;
      presentedKey?: string;
      outputLive?: boolean;
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
          onChoose={onChoose}
          onOpen={onOpen}
          onStorageRefused={onStorageRefused}
          admin={admin}
          userState={userState}
          persist={persist}
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
    expect(await screen.findByRole("heading", { name: "No book yet" })).toBeInTheDocument();
    expect(screen.getByText(/never sent anywhere/)).toBeInTheDocument();
    const click = vi.spyOn(screen.getByTestId("book-file") as HTMLInputElement, "click");
    fireEvent.click(screen.getByRole("button", { name: "Load a Book" }));
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
    await screen.findByRole("heading", { name: "No book yet" });
    pickFile();
    expect(
      await screen.findByRole("progressbar", { name: "Reading the book" }),
    ).toBeInTheDocument();
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

  it("says one book, singular", async () => {
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

  it("tapping a book makes it current and goes to Present, as does tapping the current one", async () => {
    const s = setup({ rows: [row(), loaded()] });
    s.view({ currentKey: "mal" });
    fireEvent.click(await screen.findByRole("button", { name: /^Hymns of Fellowship/ }));
    await waitFor(() => expect(s.onOpen).toHaveBeenCalledWith("k1"));
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
    expect(s.admin.review).toHaveBeenCalledWith(expect.any(File), "a");
    expect(within(dialog).getByText("Brings a book back")).toBeInTheDocument();
    expect(within(dialog).queryByText("Not the same title")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore Book" }));
    await waitFor(() => expect(s.admin.commit).toHaveBeenCalledWith("t1", "keep-both"));
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
    const dialog = within(await screen.findByRole("dialog", { name: "Load a Book" }));
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

  it("is refused while that book is on the Output, and says to close the Output first", async () => {
    const s = setup({ rows: [row(), loaded()] });
    s.view({ currentKey: "k1", presentedKey: "k1", outputLive: true });
    const dialog = await askRemove();
    expect(dialog.getByRole("alert")).toHaveTextContent(
      /on the Output now.*Close the Output first/,
    );
    const button = dialog.getByRole("button", { name: "Remove Book" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
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

  it("says when nothing will be current afterwards", async () => {
    const s = setup({ rows: [loaded()] });
    s.view({ currentKey: "k1" });
    fireEvent.click(await screen.findByRole("button", { name: "More for Hymns of Fellowship" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove/ }));
    expect(
      await screen.findByText(/No book will be current until you load another/),
    ).toBeInTheDocument();
  });
});

describe("Library: the review sheet (ADR-0027)", () => {
  async function open(options: Setup, currentKey: string | null = "mal") {
    const s = setup({ rows: [row()], ...options });
    s.view({ currentKey: currentKey ?? undefined });
    await screen.findByRole("list", { name: "Books" });
    pickFile();
    const dialog = await screen.findByRole("dialog", { name: "Load a Book" });
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
    expect(
      await screen.findByRole("progressbar", { name: "Reading the book" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load a Book" })).toBeDisabled();
    finish(review());
    expect(await screen.findByRole("dialog", { name: "Load a Book" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("new: Load Book writes it; the current book stays when there is one", async () => {
    const { s, dialog } = await open({});
    fireEvent.click(dialog.getByRole("button", { name: "Load Book" }));
    await waitFor(() => expect(s.admin.commit).toHaveBeenCalledWith("t1", "keep-both"));
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
    expect(s.onStorageRefused).toHaveBeenCalled();
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
    await waitFor(() => expect(s.admin.commit).toHaveBeenCalledWith("t1", "keep-both"));
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
    await waitFor(() => expect(s.admin.commit).toHaveBeenCalledWith("t1", { replace: "k1" }));
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

describe("Library: several books at once, reviewed as a queue (SDD-0004 §9)", () => {
  /** A review per file, named after it, with its own token. */
  const queueSetup = () => {
    const s = setup({ rows: [row()] });
    s.admin.review.mockImplementation(async (file: File) => {
      if (file.name.startsWith("bad")) throw new Error("not readable");
      const n = file.name.slice(0, 1);
      return review({ token: `t-${n}`, title: `Book ${n}` });
    });
    s.admin.commit.mockImplementation(async (token: string) => ({
      ok: true as const,
      action: "loaded" as const,
      key: token,
    }));
    s.view({ currentKey: "mal" });
    return s;
  };
  const sheet = () => screen.findByRole("dialog", { name: "Load a Book" });

  it("accepts several files at once, but one for Load Again", async () => {
    queueSetup();
    await screen.findByRole("list", { name: "Books" });
    expect(screen.getByTestId("book-file")).toHaveAttribute("multiple");
  });

  it("reviews them one after another: Book 1 of 3, then the next after Load Book", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles("1.hymnbook.json.gz", "2.hymnbook.json.gz", "3.hymnbook.json.gz");
    const first = within(await sheet());
    expect(await first.findByText("Book 1 of 3")).toBeInTheDocument();
    expect(first.getByRole("heading", { name: "Book 1" })).toBeInTheDocument();
    expect(s.admin.review).toHaveBeenCalledTimes(1);
    fireEvent.click(first.getByRole("button", { name: "Load Book" }));
    await waitFor(() => expect(s.admin.commit).toHaveBeenCalledWith("t-1", "keep-both"));
    expect(await screen.findByText("Book 2 of 3")).toBeInTheDocument();
    expect(s.admin.review.mock.calls.map(([file]) => file.name)).toEqual([
      "1.hymnbook.json.gz",
      "2.hymnbook.json.gz",
    ]);
  });

  it("Skip throws this one away, writes nothing for it, and moves on; the last has no Skip", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles("1.hymnbook.json.gz", "2.hymnbook.json.gz");
    const first = within(await sheet());
    await first.findByText("Book 1 of 2");
    fireEvent.click(first.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(s.admin.cancel).toHaveBeenCalledWith("t-1"));
    expect(await screen.findByText("Book 2 of 2")).toBeInTheDocument();
    expect(s.admin.commit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Load Book" }));
    await waitFor(() => expect(s.admin.commit).toHaveBeenCalledWith("t-2", "keep-both"));
    await waitFor(() => expect(screen.queryByText(/Book \d of 2/)).not.toBeInTheDocument());
    expect(s.admin.review).toHaveBeenCalledTimes(2);
  });

  it("closing the sheet asks nothing and drops the rest of the queue", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles("1.hymnbook.json.gz", "2.hymnbook.json.gz", "3.hymnbook.json.gz");
    const first = within(await sheet());
    await first.findByText("Book 1 of 3");
    fireEvent.click(first.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(s.admin.cancel).toHaveBeenCalledWith("t-1"));
    await new Promise((r) => setTimeout(r, 50));
    expect(s.admin.review).toHaveBeenCalledTimes(1);
    expect(s.admin.commit).not.toHaveBeenCalled();
    expect(screen.queryByText(/Book \d of 3/)).not.toBeInTheDocument();
  });

  it("a file that cannot be read is said, and the queue goes on", async () => {
    const s = queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles("bad.hymnbook.json.gz", "2.hymnbook.json.gz");
    expect(await screen.findByText("Book 2 of 2")).toBeInTheDocument();
    expect(s.admin.review).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(
      await screen.findByText(/Couldn’t read bad\.hymnbook\.json\.gz: not readable/),
    ).toBeInTheDocument();
  });

  it("one file is not a queue: no position, no Skip", async () => {
    queueSetup();
    await screen.findByRole("list", { name: "Books" });
    pickFiles("1.hymnbook.json.gz");
    const only = within(await sheet());
    await only.findByRole("button", { name: "Load Book" });
    expect(only.queryByText(/Book 1 of 1/)).not.toBeInTheDocument();
    expect(only.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
  });
});
