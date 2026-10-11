import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { OwnStatus } from "../domain/own.ts";
import type {
  BookRow,
  LoadReview,
  OwnResult,
  RemovedFromOwn,
  RenamedOwn,
} from "../persistence/content-store.ts";
import { createBooks, type LibraryAdmin } from "./books.ts";
import { Library } from "./Library.tsx";

// Your books in the Library (ADR-0033, SDD-0004 §17, component level): the From Text
// choice and its fields, Add Song and Open Song in the review, the Library's group of
// your books and the sheet of a book's songs, with Rename.

const ONE_SONG =
  "1. Amazing Grace\n\nAmazing grace! how sweet the sound,\nThat saved a wretch like me!\n";
const TWO_SONGS = `${ONE_SONG}\n---\n\n2. Rock of Ages\n\nRock of Ages, cleft for me,\nLet me hide myself in thee.\n`;

const shipped: BookRow = {
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
};

const assortedRow = (over: Partial<BookRow> = {}): BookRow => ({
  key: "as1",
  origin: "assorted",
  kind: "own",
  file: "/as1.1.sqlite3",
  title: "Assorted Hymns",
  language: "mul",
  script: "Zyyy",
  songs: 3,
  nextNumber: 8,
  addedAt: 5,
  state: "ok",
  ...over,
});

const loadedRow: BookRow = {
  ...shipped,
  key: "k1",
  origin: "hof",
  kind: "loaded",
  title: "Hymns of Fellowship",
  language: "en",
  script: "Latn",
  songs: 275,
  addedAt: 3,
};

/** The three songs of Assorted Hymns as `listHymns` gives them: English by title, then Malayalam. */
const SONGS = [
  { number: 4, title: "Amazing Grace", language: "en", script: "Latn" },
  { number: 2, title: "Rock of Ages", language: "en", script: "Latn" },
  { number: 7, title: "ദൈവത്തിനു സ്തോത്രം", language: "ml", script: "Mlym" },
];

/** The statuses a review lists: the device's Assorted Hymns (key as1), and a new book. */
const ownList = (over: Partial<OwnStatus> = {}): OwnStatus[] => [
  {
    key: "as1",
    origin: "assorted",
    title: "Assorted Hymns",
    next: 8,
    has: {},
    adding: [8],
    ...over,
  },
  { key: null, origin: "own", title: "", next: 1, has: {}, adding: [1] },
];

const reviewOf = (over: Partial<LoadReview> = {}): LoadReview => ({
  token: "t1",
  sourceHash: "a3f9c21e07b4".padEnd(64, "0"),
  title: "Amazing Grace",
  language: "en",
  script: "Latn",
  origin: "text-songs",
  songCount: 1,
  violations: [],
  verdict: { kind: "new" },
  held: { count: 0, books: [] },
  own: ownList(),
  ...over,
});

interface Setup {
  rows?: BookRow[];
  review?: LoadReview;
  add?: OwnResult;
  removed?: (number: number) => RemovedFromOwn;
  renamed?: RenamedOwn;
  songs?: typeof SONGS;
  /** Holds Add Song's answer until it is released: the sheet can be closed meanwhile. */
  gate?: Promise<void>;
}

function setup(options: Setup = {}) {
  let rows = options.rows ?? [shipped, loadedRow, assortedRow()];
  let songs = [...(options.songs ?? SONGS)];
  const admin = {
    listBooks: vi.fn(async () => rows),
    review: vi.fn(async (_file: File) => options.review ?? reviewOf()),
    commit: vi.fn(async () => ({ ok: true as const, action: "loaded" as const, key: "k9" })),
    cancel: vi.fn(async () => true),
    removeBook: vi.fn(async (key: string) => {
      rows = rows.filter((b) => b.key !== key);
      return true;
    }),
    openBook: vi.fn(async () => ({ state: "ready" as const })),
    storageMode: vi.fn(async () => "opfs" as const),
    addToOwn: vi.fn(async (): Promise<OwnResult> => {
      await options.gate;
      return options.add ?? { ok: true, key: "as1", numbers: [8], already: 0, created: false };
    }),
    removeOwnSong: vi.fn(async (_key: string, number: number): Promise<RemovedFromOwn> => {
      if (options.removed) return options.removed(number);
      songs = songs.filter((song) => song.number !== number);
      if (songs.length === 0) {
        rows = rows.filter((b) => b.key !== "as1");
        return { removed: true, key: "as1", bookRemoved: true };
      }
      rows = rows.map((b) => (b.key === "as1" ? { ...b, songs: songs.length } : b));
      return { removed: true, key: "as1", bookRemoved: false };
    }),
    renameOwn: vi.fn(async (key: string, title: string): Promise<RenamedOwn> => {
      if (options.renamed) return options.renamed;
      rows = rows.map((b) => (b.key === key ? { ...b, title } : b));
      return { ok: true, key, title };
    }),
  } satisfies LibraryAdmin;
  const store = { ensureInstalled: vi.fn(async () => ({ state: "ready" as const })) };
  const hymnStore = { listHymns: vi.fn(async () => songs) };
  const userState = {
    getRecents: vi.fn(async () => [
      { hymnbookId: "as1", hymnNumber: 4, viewedAt: 3 },
      { hymnbookId: "as1", hymnNumber: 2, viewedAt: 2 },
    ]),
    dropRecents: vi.fn(async () => {}),
    dropSong: vi.fn(async () => {}),
  };
  const onChoose = vi.fn();
  const onOpenSong = vi.fn();
  const onSongRemoved = vi.fn();
  const onNotice = vi.fn();
  const onTextBook = vi.fn();
  const persist = vi.fn(async () => "granted" as const);
  const view = (
    props: {
      presentedKey?: string;
      presentedNumber?: number;
      outputLive?: boolean;
      textBook?: string;
    } = {},
  ) =>
    render(() => {
      const books = createBooks(admin, store, ["mal"]);
      return (
        <Library
          books={books}
          currentKey="mal"
          presentedKey={props.presentedKey}
          presentedNumber={props.presentedNumber}
          outputLive={props.outputLive}
          onChoose={onChoose}
          onOpenSong={onOpenSong}
          onSongRemoved={onSongRemoved}
          onNotice={onNotice}
          textBook={props.textBook}
          onTextBook={onTextBook}
          admin={admin}
          store={hymnStore}
          userState={userState}
          persist={persist}
          sample={[]}
        />
      );
    });
  return {
    admin,
    hymnStore,
    userState,
    onChoose,
    onOpenSong,
    onSongRemoved,
    onNotice,
    onTextBook,
    view,
  };
}

const openText = async () => {
  await screen.findByRole("list", { name: "Books" });
  fireEvent.click(screen.getByRole("button", { name: "From Text" }));
  return within(await screen.findByRole("dialog", { name: "From Text" }));
};
type Dialog = Awaited<ReturnType<typeof openText>>;

const chooseLanguage = (dialog: Dialog, search = "English") => {
  const box = dialog.getByRole("combobox", { name: /language/i });
  fireEvent.focus(box);
  fireEvent.input(box, { target: { value: search } });
  fireEvent.click(within(dialog.getByRole("listbox")).getAllByRole("option")[0] as HTMLElement);
};
const typeText = (dialog: Dialog, value: string) =>
  fireEvent.input(dialog.getByLabelText("Song text"), { target: { value } });

/** From Text to the review of the one song. */
const toReview = async (s: ReturnType<typeof setup>, live: { outputLive?: boolean } = {}) => {
  s.view(live);
  const dialog = await openText();
  typeText(dialog, ONE_SONG);
  chooseLanguage(dialog);
  fireEvent.click(dialog.getByRole("button", { name: "Review Song" }));
  const review = within(await screen.findByRole("dialog", { name: "Add Song" }));
  await review.findByRole("heading", { name: "Amazing Grace" });
  return review;
};

describe("From Text: one form (ADR-0033 §4)", () => {
  const options = (dialog: Dialog) =>
    within(dialog.getByRole("combobox", { name: "Add to" })).getAllByRole("option");

  it("is one form: Add to a book, language, text and Advanced; no modes, no id", async () => {
    setup().view();
    const dialog = await openText();
    typeText(dialog, ONE_SONG);
    expect(dialog.queryByRole("radio")).not.toBeInTheDocument();
    expect(dialog.getByRole("combobox", { name: "Add to" })).toHaveValue("as1");
    expect(dialog.queryByLabelText("Book name")).not.toBeInTheDocument();
    expect(dialog.queryByLabelText("Id")).not.toBeInTheDocument();
    expect(dialog.getByText("Advanced")).toBeInTheDocument();
    expect(dialog.getByLabelText("Song number")).toBeInTheDocument();
    expect(dialog.getByRole("combobox", { name: "Song’s language" })).toBeInTheDocument();
    chooseLanguage(dialog);
    expect(dialog.getByText(/^Script:/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Review Song" })).toBeInTheDocument();
  });

  it("offers the person's own books in the Library's order, New book… last", async () => {
    setup({
      rows: [
        shipped,
        assortedRow(),
        assortedRow({ key: "c1", origin: "own", title: "Camp Songs" }),
      ],
    }).view();
    const dialog = await openText();
    expect(options(dialog).map((o) => o.textContent)).toEqual([
      "Assorted Hymns",
      "Camp Songs",
      "New book…",
    ]);
  });

  it("offers Assorted Hymns, to be made, when the person has no books", async () => {
    setup({ rows: [shipped] }).view();
    const dialog = await openText();
    expect(options(dialog).map((o) => o.textContent)).toEqual(["Assorted Hymns", "New book…"]);
    expect(dialog.getByRole("combobox", { name: "Add to" })).toHaveValue("default");
  });

  it("defaults to the book last added to on this device", async () => {
    setup({
      rows: [
        shipped,
        assortedRow(),
        assortedRow({ key: "c1", origin: "own", title: "Camp Songs", addedAt: 6 }),
      ],
    }).view({ textBook: "c1" });
    const dialog = await openText();
    expect(dialog.getByRole("combobox", { name: "Add to" })).toHaveValue("c1");
  });

  it("falls back to Assorted Hymns when the remembered book is gone", async () => {
    setup().view({ textBook: "gone" });
    const dialog = await openText();
    expect(dialog.getByRole("combobox", { name: "Add to" })).toHaveValue("as1");
  });

  it("New book… shows one more field, the name, filled with a suggestion", async () => {
    setup().view();
    const dialog = await openText();
    fireEvent.change(dialog.getByRole("combobox", { name: "Add to" }), {
      target: { value: "new" },
    });
    expect(dialog.getByLabelText("Book name")).toHaveValue("My Songs");
    expect(dialog.queryByLabelText("Id")).not.toBeInTheDocument();
  });

  it("suggests My Songs 2 when My Songs is taken", async () => {
    setup({
      rows: [shipped, assortedRow(), assortedRow({ key: "c1", origin: "own", title: "My Songs" })],
    }).view();
    const dialog = await openText();
    fireEvent.change(dialog.getByRole("combobox", { name: "Add to" }), {
      target: { value: "new" },
    });
    expect(dialog.getByLabelText("Book name")).toHaveValue("My Songs 2");
  });

  it("reviews several songs with the button saying how many", async () => {
    setup().view();
    const dialog = await openText();
    typeText(dialog, TWO_SONGS);
    expect(dialog.getByRole("combobox", { name: "Songs’ language" })).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Review 2 Songs" })).toBeInTheDocument();
    expect(dialog.getByText(/2 songs/)).toBeInTheDocument();
  });

  it("says the language is missing, and asks for nothing else", async () => {
    const s = setup();
    s.view();
    const dialog = await openText();
    typeText(dialog, ONE_SONG);
    fireEvent.click(dialog.getByRole("button", { name: "Review Song" }));
    expect(await dialog.findByText("Choose the song’s language.")).toBeInTheDocument();
    expect(dialog.queryByText("Give the book a name.")).not.toBeInTheDocument();
    expect(s.admin.review).not.toHaveBeenCalled();
  });

  it("an error goes the moment its field is edited, and only that one", async () => {
    setup().view();
    const dialog = await openText();
    fireEvent.change(dialog.getByRole("combobox", { name: "Add to" }), {
      target: { value: "new" },
    });
    fireEvent.input(dialog.getByLabelText("Book name"), { target: { value: "" } });
    fireEvent.click(dialog.getByRole("button", { name: "Review" }));
    expect(await dialog.findByText("Give the book a name.")).toBeInTheDocument();
    expect(dialog.getByText("Choose the song’s language.")).toBeInTheDocument();
    expect(
      dialog.getByText("There are no songs to add. Paste them or open a .txt file."),
    ).toBeInTheDocument();
    chooseLanguage(dialog);
    expect(dialog.queryByText("Choose the song’s language.")).not.toBeInTheDocument();
    expect(dialog.getByText("Give the book a name.")).toBeInTheDocument();
    typeText(dialog, ONE_SONG);
    expect(dialog.queryByText(/There are no songs/)).not.toBeInTheDocument();
    fireEvent.input(dialog.getByLabelText("Book name"), { target: { value: "Camp" } });
    expect(dialog.queryByText("Give the book a name.")).not.toBeInTheDocument();
    // The next Review shows what it finds again.
    fireEvent.input(dialog.getByLabelText("Book name"), { target: { value: " " } });
    fireEvent.click(dialog.getByRole("button", { name: "Review Song" }));
    expect(await dialog.findByText("Give the book a name.")).toBeInTheDocument();
  });

  it("checks a script typed by hand as it is typed: four letters, a script the device knows", async () => {
    setup().view();
    const dialog = await openText();
    chooseLanguage(dialog);
    fireEvent.click(dialog.getByRole("button", { name: "Change" }));
    const code = dialog.getByLabelText("Script code");
    fireEvent.input(code, { target: { value: "Abcd" } });
    expect(dialog.getByRole("alert")).toHaveTextContent(/“Abcd” is not a script/);
    fireEvent.input(code, { target: { value: "Abcde" } });
    expect(dialog.getByRole("alert")).toHaveTextContent("A script code is four letters");
    fireEvent.input(code, { target: { value: "mlym" } });
    expect(dialog.queryByText(/is not a script|four letters/)).not.toBeInTheDocument();
    fireEvent.blur(code);
    expect(code).toHaveValue("Mlym");
    fireEvent.click(dialog.getByRole("button", { name: "Done" }));
    expect(dialog.getByText(/^Script:/)).toHaveTextContent("Malayalam");
  });

  it("numbers songs with none from the chosen book's next number, one or several", async () => {
    const s = setup();
    s.view();
    const dialog = await openText();
    typeText(
      dialog,
      "Amazing Grace\n\nAmazing grace!\n\n---\n\nRock of Ages\n\nRock of Ages, cleft for me\n",
    );
    chooseLanguage(dialog);
    fireEvent.click(dialog.getByRole("button", { name: "Review 2 Songs" }));
    await screen.findByRole("dialog", { name: /Add Song/ });
    const file = (s.admin.review.mock.calls[0] as unknown as [File])[0];
    const { gunzipSync } = await import("fflate");
    const made = JSON.parse(
      new TextDecoder().decode(gunzipSync(new Uint8Array(await file.arrayBuffer()))),
    );
    expect(made.hymns.map((h: { number: number }) => h.number)).toEqual([8, 9]);
  });

  it("numbers from 1 in a new book", async () => {
    const s = setup();
    s.view();
    const dialog = await openText();
    fireEvent.change(dialog.getByRole("combobox", { name: "Add to" }), {
      target: { value: "new" },
    });
    typeText(dialog, "Amazing Grace\n\nAmazing grace!\n");
    chooseLanguage(dialog);
    fireEvent.click(dialog.getByRole("button", { name: "Review Song" }));
    await screen.findByRole("dialog", { name: "Add Song" });
    const file = (s.admin.review.mock.calls[0] as unknown as [File])[0];
    const { gunzipSync } = await import("fflate");
    const made = JSON.parse(
      new TextDecoder().decode(gunzipSync(new Uint8Array(await file.arrayBuffer()))),
    );
    expect(made.hymns[0].number).toBe(1);
  });

  it("a new book is added to as a new book of that name", async () => {
    const s = setup({
      review: reviewOf({ title: "Camp Songs", own: ownList({ adding: [1] }) }),
      add: { ok: true, key: "n1", numbers: [1], already: 0, created: true },
    });
    s.view();
    const dialog = await openText();
    typeText(dialog, ONE_SONG);
    fireEvent.change(dialog.getByRole("combobox", { name: "Add to" }), {
      target: { value: "new" },
    });
    fireEvent.input(dialog.getByLabelText("Book name"), { target: { value: "Camp Songs" } });
    chooseLanguage(dialog);
    fireEvent.click(dialog.getByRole("button", { name: "Review Song" }));
    const review = within(await screen.findByRole("dialog", { name: "Add Song" }));
    expect(await review.findByText(/Becomes song/)).toHaveTextContent(
      "Becomes song 1 in Camp Songs",
    );
    expect(review.getByText(/makes a new book of yours/)).toBeInTheDocument();
    fireEvent.click(review.getByRole("button", { name: "Add Song" }));
    await waitFor(() =>
      expect(s.admin.addToOwn).toHaveBeenCalledWith(
        "t1",
        { kind: "new", title: "Camp Songs" },
        "en",
        "Latn",
        expect.any(Function),
      ),
    );
    await waitFor(() => expect(s.onOpenSong).toHaveBeenCalledWith("n1", 1));
    // The book added to is the one offered next time.
    expect(s.onTextBook).toHaveBeenCalledWith("n1");
  });
});

describe("Review: Add Song", () => {
  it("shows the number the song will get, and Add Song adds it and shows it in the Operator", async () => {
    const s = setup();
    const review = await toReview(s);
    // The one-song book is reviewed under the song's own title, with fixed internal values.
    const file = (s.admin.review.mock.calls[0] as unknown as [File])[0];
    expect(file.name).toBe("text-songs.hymnbook.json.gz");
    expect(review.getByText(/Becomes song/)).toHaveTextContent("Becomes song 8 in Assorted Hymns");
    expect(review.queryByText("Origin")).not.toBeInTheDocument();
    expect(review.queryByRole("button", { name: "Load Book" })).not.toBeInTheDocument();
    expect(review.queryByRole("button", { name: "Open Song" })).not.toBeInTheDocument();

    fireEvent.click(review.getByRole("button", { name: "Add Song" }));
    await waitFor(() => expect(s.onOpenSong).toHaveBeenCalledWith("as1", 8));
    expect(s.admin.addToOwn).toHaveBeenCalledWith(
      "t1",
      { kind: "book", key: "as1" },
      "en",
      "Latn",
      expect.any(Function),
    );
    expect(s.admin.commit).not.toHaveBeenCalled();
    expect(s.onChoose).toHaveBeenCalledWith("as1");
  });

  it("makes the book with its first song, and says so", async () => {
    const s = setup({
      rows: [shipped],
      review: reviewOf({
        own: [
          { key: null, origin: "assorted", title: "Assorted Hymns", next: 1, has: {}, adding: [1] },
          ...ownList().slice(1),
        ],
      }),
    });
    const review = await toReview(s);
    expect(review.getByText(/Becomes song/)).toHaveTextContent("Becomes song 1");
    expect(review.getByText(/makes Assorted Hymns/)).toBeInTheDocument();
  });

  it("a song already there says so with its number and offers Open Song, not Add Song", async () => {
    const s = setup({ review: reviewOf({ own: ownList({ has: { 1: 4 }, adding: [] }) }) });
    const review = await toReview(s);
    expect(review.getByText(/Already in Assorted Hymns as/)).toHaveTextContent(
      "Already in Assorted Hymns as 4",
    );
    expect(review.queryByRole("button", { name: "Add Song" })).not.toBeInTheDocument();
    fireEvent.click(review.getByRole("button", { name: "Open Song" }));
    expect(s.onOpenSong).toHaveBeenCalledWith("as1", 4);
    expect(s.admin.addToOwn).not.toHaveBeenCalled();
    expect(s.admin.cancel).toHaveBeenCalledWith("t1");
  });

  it("an unreadable Assorted Hymns can't be added to: no Add Song, the text can be edited", async () => {
    const s = setup({ review: reviewOf({ own: ownList({ next: null, adding: [] }) }) });
    const review = await toReview(s);
    expect(review.getByText("Assorted Hymns can’t be read")).toBeInTheDocument();
    expect(review.queryByRole("button", { name: "Add Song" })).not.toBeInTheDocument();
    fireEvent.click(review.getByRole("button", { name: "Edit the Text" }));
    const dialog = within(await screen.findByRole("dialog", { name: "From Text" }));
    expect(dialog.getByLabelText("Song text")).toHaveValue(ONE_SONG);
  });

  it("the song held in another book is flagged, not blocked", async () => {
    const s = setup({
      review: reviewOf({
        held: { count: 1, books: [{ key: "k1", title: "Hymns of Fellowship", count: 1 }] },
      }),
    });
    const review = await toReview(s);
    expect(review.getByText(/This song is also in/)).toHaveTextContent(
      "This song is also in Hymns of Fellowship (1). It is added anyway.",
    );
    expect(review.getByRole("button", { name: "Add Song" })).toBeEnabled();
  });

  it("a song that turns out to be there already is said, and nothing is added", async () => {
    const s = setup({
      add: { ok: false, reason: "already-here", message: "", key: "as1", number: 2 },
    });
    const review = await toReview(s);
    fireEvent.click(review.getByRole("button", { name: "Add Song" }));
    expect(await review.findByRole("alert")).toHaveTextContent(/in the book already/);
    expect(s.onOpenSong).not.toHaveBeenCalled();
  });

  it("a number held in the book stops Add Song, and the text can be edited", async () => {
    const s = setup({
      review: reviewOf({
        own: ownList({
          problem:
            "Song 1 “Amazing Grace” is numbered 1, which this book already holds or has retired. Its next free number is 8.",
        }),
      }),
    });
    const review = await toReview(s);
    expect(review.getByText("A number is taken")).toBeInTheDocument();
    expect(review.getByText(/Song 1 “Amazing Grace” is numbered 1/)).toBeInTheDocument();
    expect(review.queryByRole("button", { name: "Add Song" })).not.toBeInTheDocument();
    expect(review.getByRole("button", { name: "Edit the Text" })).toBeInTheDocument();
  });

  it("a book that turns out unreadable is said, and nothing is added", async () => {
    const s = setup({ add: { ok: false, reason: "unreadable", message: "", key: "as1" } });
    const review = await toReview(s);
    fireEvent.click(review.getByRole("button", { name: "Add Song" }));
    expect(await review.findByRole("alert")).toHaveTextContent(/can’t be opened/);
    expect(s.onOpenSong).not.toHaveBeenCalled();
  });

  it.each([
    ["no-review", /no longer current/],
    ["invalid", /xx is not a language tag Edit the text/],
    ["failed", /Couldn’t add the song: disk full/],
  ] as const)("says in words why a song was not added: %s", async (reason, words) => {
    const message = reason === "invalid" ? "xx is not a language tag" : "disk full";
    const s = setup({ add: { ok: false, reason, message } });
    const review = await toReview(s);
    fireEvent.click(review.getByRole("button", { name: "Add Song" }));
    expect(await review.findByRole("alert")).toHaveTextContent(words);
    // The review stays, so it can be tried again or cancelled.
    expect(review.getByRole("button", { name: "Add Song" })).toBeEnabled();
    expect(s.onOpenSong).not.toHaveBeenCalled();
  });
});

describe("Review: several songs", () => {
  const manyReview = (over: Partial<OwnStatus> = {}) =>
    reviewOf({ songCount: 2, title: "Assorted Hymns", own: ownList({ adding: [8, 9], ...over }) });

  /** From Text to the review of the two songs. */
  const toManyReview = async (s: ReturnType<typeof setup>) => {
    s.view();
    const dialog = await openText();
    typeText(dialog, TWO_SONGS);
    chooseLanguage(dialog);
    fireEvent.click(dialog.getByRole("button", { name: "Review 2 Songs" }));
    return within(await screen.findByRole("dialog", { name: "Add Songs" }));
  };

  it("says how many songs are added to the book, and Add Songs adds them and shows the first", async () => {
    const s = setup({
      review: manyReview(),
      add: { ok: true, key: "as1", numbers: [8, 9], already: 0, created: false },
    });
    const review = await toManyReview(s);
    expect(await review.findByText(/Adds/)).toHaveTextContent("Adds 2 songs to Assorted Hymns");
    fireEvent.click(review.getByRole("button", { name: "Add Songs" }));
    await waitFor(() => expect(s.onOpenSong).toHaveBeenCalledWith("as1", 8));
  });

  it("says the songs already there are not added again", async () => {
    const s = setup({ review: manyReview({ has: { 2: 3 }, adding: [8] }) });
    const review = await toManyReview(s);
    expect(await review.findByText(/there already and not added again/)).toBeInTheDocument();
  });

  it("when every song is there, offers Open Song at the first", async () => {
    const s = setup({ review: manyReview({ has: { 1: 3, 2: 4 }, adding: [] }) });
    const review = await toManyReview(s);
    expect(await review.findByText(/These songs are/)).toBeInTheDocument();
    fireEvent.click(review.getByRole("button", { name: "Open Song" }));
    expect(s.onOpenSong).toHaveBeenCalledWith("as1", 3);
  });

  it("while live, says the count and the numbers instead of showing a song", async () => {
    const s = setup({
      review: manyReview(),
      add: { ok: true, key: "as1", numbers: [8, 9], already: 0, created: false },
    });
    s.view({ outputLive: true });
    const dialog = await openText();
    typeText(dialog, TWO_SONGS);
    chooseLanguage(dialog);
    fireEvent.click(dialog.getByRole("button", { name: "Review 2 Songs" }));
    const review = within(await screen.findByRole("dialog", { name: "Add Songs" }));
    fireEvent.click(await review.findByRole("button", { name: "Add Songs" }));
    await waitFor(() =>
      expect(s.onNotice).toHaveBeenCalledWith("2 songs were added to Assorted Hymns as 8 to 9."),
    );
    expect(s.onOpenSong).not.toHaveBeenCalled();
  });
});

describe("Library: your books, their row and sheet", () => {
  it("sits first, under Your books, labelled by its song count and no language", async () => {
    setup().view();
    const list = await screen.findByRole("list", { name: "Books" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-book", "as1");
    expect(items[0]).toHaveTextContent("Assorted Hymns");
    expect(items[0]).toHaveTextContent("3 songs");
    expect(items[0]).not.toHaveTextContent(/Multiple|mul|Loaded|Shipped/);
    expect(items).toHaveLength(3);
    expect(within(list).getByText("Your books")).toBeInTheDocument();
    expect(within(list).getByText("Books")).toBeInTheDocument();
  });

  it("lists every book of yours first, then the rest, each opening its own songs", async () => {
    const camp = assortedRow({
      key: "c1",
      origin: "own",
      title: "Camp Songs",
      songs: 2,
      addedAt: 9,
    });
    const s = setup({ rows: [shipped, camp, loadedRow, assortedRow()] });
    s.view();
    const list = await screen.findByRole("list", { name: "Books" });
    const keys = within(list)
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("data-book"));
    expect(keys).toEqual(["c1", "as1", "mal", "k1"]);
    fireEvent.click(screen.getByRole("button", { name: /^Camp Songs/ }));
    await screen.findByRole("dialog", { name: "Camp Songs" });
    expect(s.hymnStore.listHymns).toHaveBeenCalledWith("c1");
  });

  it("shows no group heading when there are no books of yours", async () => {
    setup({ rows: [shipped, loadedRow] }).view();
    const list = await screen.findByRole("list", { name: "Books" });
    expect(within(list).queryByText("Your books")).not.toBeInTheDocument();
  });

  it("opens a sheet of its songs in the order listHymns gives, each with Remove", async () => {
    const s = setup();
    s.view();
    fireEvent.click(await screen.findByRole("button", { name: /^Assorted Hymns/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Assorted Hymns" }));
    const list = await dialog.findByRole("list", { name: "Songs" });
    const titles = within(list)
      .getAllByRole("listitem")
      .map((li) => li.querySelector(".book-title")?.textContent);
    expect(titles).toEqual(["Amazing Grace", "Rock of Ages", "ദൈവത്തിനു സ്തോത്രം"]);
    expect(within(list).getAllByRole("button", { name: /^Remove / })).toHaveLength(3);
    expect(s.hymnStore.listHymns).toHaveBeenCalledWith("as1");
  });

  it("a song's title opens it in the Operator", async () => {
    const s = setup();
    s.view();
    fireEvent.click(await screen.findByRole("button", { name: /^Assorted Hymns/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Rock of Ages" }));
    expect(s.onOpenSong).toHaveBeenCalledWith("as1", 2);
    expect(s.onChoose).toHaveBeenCalledWith("as1");
  });

  it("Remove asks first, naming the song and what goes; Back removes nothing", async () => {
    const s = setup();
    s.view();
    fireEvent.click(await screen.findByRole("button", { name: /^Assorted Hymns/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Assorted Hymns" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Remove Rock of Ages" }));
    expect(await dialog.findByText("Its Recents: 1 entry.")).toBeInTheDocument();
    expect(dialog.getByText(/Number 2 is retired/)).toBeInTheDocument();
    expect(s.admin.removeOwnSong).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Back" }));
    expect(s.admin.removeOwnSong).not.toHaveBeenCalled();
    expect(s.userState.dropSong).not.toHaveBeenCalled();
  });

  it("confirming removes the song and its recents, and the list is read again", async () => {
    const s = setup();
    s.view();
    fireEvent.click(await screen.findByRole("button", { name: /^Assorted Hymns/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Assorted Hymns" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Remove Rock of Ages" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Remove Song" }));
    await waitFor(() => expect(s.admin.removeOwnSong).toHaveBeenCalledWith("as1", 2));
    expect(s.userState.dropSong).toHaveBeenCalledWith("as1", 2);
    expect(s.userState.dropRecents).not.toHaveBeenCalled();
    await waitFor(() => expect(s.onSongRemoved).toHaveBeenCalledWith("as1", 2));
    await waitFor(() =>
      expect(dialog.queryByRole("button", { name: "Remove Rock of Ages" })).not.toBeInTheDocument(),
    );
    expect(dialog.getByRole("button", { name: "Remove Amazing Grace" })).toBeInTheDocument();
  });

  it("the last song removed takes the book, and the sheet closes", async () => {
    const s = setup({
      rows: [shipped, assortedRow({ songs: 1 })],
      songs: [SONGS[0] as (typeof SONGS)[number]],
    });
    s.view();
    fireEvent.click(await screen.findByRole("button", { name: /^Assorted Hymns/ }));
    const sheet = await screen.findByRole("dialog", { name: "Assorted Hymns" });
    const dialog = within(sheet);
    fireEvent.click(await dialog.findByRole("button", { name: "Remove Amazing Grace" }));
    expect(await dialog.findByText(/the last one: the book goes with it/)).toBeInTheDocument();
    fireEvent.click(await dialog.findByRole("button", { name: "Remove Song" }));
    await waitFor(() => expect(s.userState.dropRecents).toHaveBeenCalledWith("as1"));
    await waitFor(() => expect(sheet).not.toHaveAttribute("open"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Assorted Hymns/ })).not.toBeInTheDocument(),
    );
  });

  it("a song on the Output is not removed until End Live", async () => {
    const s = setup();
    s.view({ presentedKey: "as1", presentedNumber: 2, outputLive: true });
    fireEvent.click(await screen.findByRole("button", { name: /^Assorted Hymns/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Assorted Hymns" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Remove Rock of Ages" }));
    expect(await dialog.findByText(/on the Output now/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Remove Song" })).toBeDisabled();
    expect(s.admin.removeOwnSong).not.toHaveBeenCalled();
  });

  it("Rename takes a new title on a second page, and the book is renamed in the Library", async () => {
    const s = setup();
    s.view();
    fireEvent.click(await screen.findByRole("button", { name: /^Assorted Hymns/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Assorted Hymns" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Rename" }));
    const title = await dialog.findByLabelText("Title");
    expect(title).toHaveValue("Assorted Hymns");
    // Unchanged, there is nothing to rename.
    expect(dialog.getByRole("button", { name: "Rename Book" })).toBeDisabled();
    fireEvent.input(title, { target: { value: "  Sunday Songs " } });
    fireEvent.click(dialog.getByRole("button", { name: "Rename Book" }));
    await waitFor(() => expect(s.admin.renameOwn).toHaveBeenCalledWith("as1", "Sunday Songs"));
    expect(await screen.findByRole("dialog", { name: "Sunday Songs" })).toBeInTheDocument();
    expect(screen.getAllByText("Sunday Songs").length).toBeGreaterThan(0);
  });

  it("says why a rename was refused and keeps the page", async () => {
    const s = setup({
      renamed: { ok: false, reason: "invalid", message: "Give the book a title." },
    });
    s.view();
    fireEvent.click(await screen.findByRole("button", { name: /^Assorted Hymns/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Assorted Hymns" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Rename" }));
    fireEvent.input(await dialog.findByLabelText("Title"), { target: { value: "X" } });
    fireEvent.click(dialog.getByRole("button", { name: "Rename Book" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Give the book a title.");
    expect(dialog.getByLabelText("Title")).toBeInTheDocument();
  });

  it("the whole book is removed from its menu like any book", async () => {
    const s = setup();
    s.view();
    fireEvent.click(await screen.findByRole("button", { name: "More for Assorted Hymns" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Remove/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Remove Book" }));
    // No language is named for it.
    expect(dialog.queryByText(/Multiple/)).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Remove Book" }));
    await waitFor(() => expect(s.admin.removeBook).toHaveBeenCalledWith("as1"));
    expect(s.userState.dropRecents).toHaveBeenCalledWith("as1");
  });
});

describe("Assorted Hymns while the Output is live, and a review closed mid-add", () => {
  it("while live, Add Song adds the song but does not present it: the notice says so", async () => {
    const s = setup();
    const review = await toReview(s, { outputLive: true });
    fireEvent.click(review.getByRole("button", { name: "Add Song" }));
    await waitFor(() =>
      expect(s.onNotice).toHaveBeenCalledWith("Amazing Grace was added to Assorted Hymns as 8."),
    );
    expect(s.admin.addToOwn).toHaveBeenCalled();
    expect(s.onOpenSong).not.toHaveBeenCalled();
    // The review sheet is closed: nothing is left to press.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Add Song" })).not.toBeInTheDocument(),
    );
  });

  it("while live, Open Song in the review is a deliberate tap and shows the song as the Finder does", async () => {
    const s = setup({ review: reviewOf({ own: ownList({ has: { 1: 4 }, adding: [] }) }) });
    const review = await toReview(s, { outputLive: true });
    fireEvent.click(review.getByRole("button", { name: "Open Song" }));
    expect(s.onOpenSong).toHaveBeenCalledWith("as1", 4);
    expect(s.onNotice).not.toHaveBeenCalled();
  });

  it("while live, a song opened from the sheet is shown the same way", async () => {
    const s = setup();
    s.view({ outputLive: true });
    fireEvent.click(await screen.findByRole("button", { name: /^Assorted Hymns/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Open Rock of Ages" }));
    expect(s.onOpenSong).toHaveBeenCalledWith("as1", 2);
  });

  it("a review closed while the song is written says it was added, and does not present it", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const s = setup({ gate });
    const review = await toReview(s);
    fireEvent.click(review.getByRole("button", { name: "Add Song" }));
    fireEvent.click(await review.findByRole("button", { name: "Close" }));
    release();
    await waitFor(() =>
      expect(s.onNotice).toHaveBeenCalledWith("Amazing Grace was added to Assorted Hymns as 8."),
    );
    expect(s.onOpenSong).not.toHaveBeenCalled();
  });

  it("a review closed while the song is written says why it was not added, when it fails", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const s = setup({ gate, add: { ok: false, reason: "failed", message: "disk full" } });
    const review = await toReview(s);
    fireEvent.click(review.getByRole("button", { name: "Add Song" }));
    fireEvent.click(await review.findByRole("button", { name: "Close" }));
    release();
    await waitFor(() =>
      expect(s.onNotice).toHaveBeenCalledWith("Amazing Grace: Couldn’t add the song: disk full"),
    );
    expect(s.onOpenSong).not.toHaveBeenCalled();
  });
});

describe("Library footer", () => {
  it("says your books have no file once one exists, and not before", async () => {
    setup({ rows: [shipped, loadedRow] }).view();
    await screen.findByRole("list", { name: "Books" });
    expect(screen.queryByText(/Your books have no file/)).not.toBeInTheDocument();
  });
  it("with only your books held, does not tell the person to keep a file", async () => {
    setup({ rows: [assortedRow()] }).view();
    expect(await screen.findByText(/Books stay on this device\./)).toBeInTheDocument();
    expect(screen.queryByText(/keep its file/)).not.toBeInTheDocument();
    expect(screen.getByText(/Your books have no file: Back Up keeps them\./)).toBeInTheDocument();
  });
  it("with only a loaded book held, says to keep its file and nothing of your books", async () => {
    setup({ rows: [loadedRow] }).view();
    expect(await screen.findByText(/A loaded book has no copy anywhere else/)).toBeInTheDocument();
    expect(screen.queryByText(/Your books have no file/)).not.toBeInTheDocument();
  });
  it("with both held, says both", async () => {
    setup({ rows: [loadedRow, assortedRow()] }).view();
    const foot = await screen.findByText(/Books stay on this device\./);
    expect(foot).toHaveTextContent(/keep its file\./);
    expect(foot).toHaveTextContent(/Your books have no file: Back Up keeps them\./);
  });
});
