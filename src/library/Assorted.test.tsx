import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type {
  AssortedResult,
  BookRow,
  LoadReview,
  RemovedFromAssorted,
} from "../persistence/content-store.ts";
import { createBooks, type LibraryAdmin } from "./books.ts";
import { Library } from "./Library.tsx";

// Assorted Hymns in the Library (SDD-0004 §17, component level): the From Text
// choice and its hidden fields, Add Song and Open Song in the review, the
// Library's row and the sheet of its songs.

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
  kind: "assorted",
  file: "/as1.1.sqlite3",
  title: "Assorted Hymns",
  language: "mul",
  script: "Zyyy",
  songs: 3,
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

const reviewOf = (over: Partial<LoadReview> = {}): LoadReview => ({
  token: "t1",
  sourceHash: "a3f9c21e07b4".padEnd(64, "0"),
  title: "Amazing Grace",
  language: "en",
  script: "Latn",
  origin: "assorted-song",
  songCount: 1,
  violations: [],
  verdict: { kind: "new" },
  held: { count: 0, books: [] },
  assorted: { key: "as1", next: 8, has: null },
  ...over,
});

interface Setup {
  rows?: BookRow[];
  review?: LoadReview;
  add?: AssortedResult;
  removed?: (number: number) => RemovedFromAssorted;
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
    addToAssorted: vi.fn(async (): Promise<AssortedResult> => {
      await options.gate;
      return options.add ?? { ok: true, key: "as1", number: 8, created: false };
    }),
    removeAssortedSong: vi.fn(async (number: number): Promise<RemovedFromAssorted> => {
      if (options.removed) return options.removed(number);
      songs = songs.filter((song) => song.number !== number);
      if (songs.length === 0) {
        rows = rows.filter((b) => b.kind !== "assorted");
        return { removed: true, key: "as1", bookRemoved: true };
      }
      rows = rows.map((b) => (b.kind === "assorted" ? { ...b, songs: songs.length } : b));
      return { removed: true, key: "as1", bookRemoved: false };
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
  const persist = vi.fn(async () => "granted" as const);
  const view = (
    props: { presentedKey?: string; presentedNumber?: number; outputLive?: boolean } = {},
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
          admin={admin}
          store={hymnStore}
          userState={userState}
          persist={persist}
          sample={[]}
        />
      );
    });
  return { admin, hymnStore, userState, onChoose, onOpenSong, onSongRemoved, onNotice, view };
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
  fireEvent.click(dialog.getAllByRole("option")[0] as HTMLElement);
};
const typeText = (dialog: Dialog, value: string) =>
  fireEvent.input(dialog.getByLabelText("Song text"), { target: { value } });

/** From Text to the review of the one song. */
const toReview = async (s: ReturnType<typeof setup>, live: { outputLive?: boolean } = {}) => {
  s.view(live);
  const dialog = await openText();
  typeText(dialog, ONE_SONG);
  chooseLanguage(dialog);
  fireEvent.click(dialog.getByRole("button", { name: "Review the Song" }));
  const review = within(await screen.findByRole("dialog", { name: "Add Song" }));
  await review.findByRole("heading", { name: "Amazing Grace" });
  return review;
};

describe("From Text: where one song goes", () => {
  it("offers Assorted Hymns first, and hides the book's id, title and the song's number", async () => {
    setup().view();
    const dialog = await openText();
    typeText(dialog, ONE_SONG);
    expect(dialog.getByRole("radio", { name: "Assorted Hymns" })).toBeChecked();
    expect(dialog.getByRole("radio", { name: "A New Book" })).not.toBeChecked();
    expect(dialog.queryByLabelText("Title")).not.toBeInTheDocument();
    expect(dialog.queryByLabelText("Id")).not.toBeInTheDocument();
    expect(dialog.queryByLabelText("Song number")).not.toBeInTheDocument();
    // The song's language is asked, and its script follows it.
    expect(dialog.getByRole("combobox", { name: "Song’s language" })).toBeInTheDocument();
    chooseLanguage(dialog);
    expect(dialog.getByText(/^Script:/)).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Review the Song" })).toBeInTheDocument();
  });

  it("A New Book brings back the book's own fields", async () => {
    setup().view();
    const dialog = await openText();
    typeText(dialog, ONE_SONG);
    fireEvent.click(dialog.getByRole("radio", { name: "A New Book" }));
    expect(dialog.getByLabelText("Title")).toBeInTheDocument();
    expect(dialog.getByLabelText("Id")).toBeInTheDocument();
    expect(dialog.getByLabelText("Song number")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Review the Book" })).toBeInTheDocument();
  });

  it("offers only a new book for several songs", async () => {
    setup().view();
    const dialog = await openText();
    typeText(dialog, TWO_SONGS);
    expect(dialog.queryByRole("radio", { name: "Assorted Hymns" })).not.toBeInTheDocument();
    expect(dialog.getByLabelText("Title")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Review the Book" })).toBeInTheDocument();
    // The choice comes back when the text is one song again.
    typeText(dialog, ONE_SONG);
    expect(dialog.getByRole("radio", { name: "Assorted Hymns" })).toBeChecked();
  });

  it("asks only for the song's language, and says so when it is missing", async () => {
    const s = setup();
    s.view();
    const dialog = await openText();
    typeText(dialog, ONE_SONG);
    fireEvent.click(dialog.getByRole("button", { name: "Review the Song" }));
    expect(await dialog.findByText("Choose the song’s language.")).toBeInTheDocument();
    expect(dialog.queryByText("Give the book a title.")).not.toBeInTheDocument();
    expect(s.admin.review).not.toHaveBeenCalled();
  });
});

describe("Review: Add Song", () => {
  it("shows the number the song will get, and Add Song adds it and shows it in the Operator", async () => {
    const s = setup();
    const review = await toReview(s);
    // The one-song book is reviewed under the song's own title, with fixed internal values.
    const file = (s.admin.review.mock.calls[0] as unknown as [File])[0];
    expect(file.name).toBe("assorted-song.hymnbook.json.gz");
    expect(review.getByText(/Becomes song/)).toHaveTextContent("Becomes song 8 in Assorted Hymns");
    expect(review.queryByText("Origin")).not.toBeInTheDocument();
    expect(review.queryByRole("button", { name: "Load Book" })).not.toBeInTheDocument();
    expect(review.queryByRole("button", { name: "Open Song" })).not.toBeInTheDocument();

    fireEvent.click(review.getByRole("button", { name: "Add Song" }));
    await waitFor(() => expect(s.onOpenSong).toHaveBeenCalledWith("as1", 8));
    expect(s.admin.addToAssorted).toHaveBeenCalledWith("t1", "en", "Latn", expect.any(Function));
    expect(s.admin.commit).not.toHaveBeenCalled();
    expect(s.onChoose).toHaveBeenCalledWith("as1");
  });

  it("makes the book with its first song, and says so", async () => {
    const s = setup({
      rows: [shipped],
      review: reviewOf({ assorted: { key: null, next: 1, has: null } }),
    });
    const review = await toReview(s);
    expect(review.getByText(/Becomes song/)).toHaveTextContent("Becomes song 1");
    expect(review.getByText(/makes Assorted Hymns/)).toBeInTheDocument();
  });

  it("a song already there says so with its number and offers Open Song, not Add Song", async () => {
    const s = setup({ review: reviewOf({ assorted: { key: "as1", next: 8, has: 4 } }) });
    const review = await toReview(s);
    expect(review.getByText(/Already in Assorted Hymns as/)).toHaveTextContent(
      "Already in Assorted Hymns as 4",
    );
    expect(review.queryByRole("button", { name: "Add Song" })).not.toBeInTheDocument();
    fireEvent.click(review.getByRole("button", { name: "Open Song" }));
    expect(s.onOpenSong).toHaveBeenCalledWith("as1", 4);
    expect(s.admin.addToAssorted).not.toHaveBeenCalled();
    expect(s.admin.cancel).toHaveBeenCalledWith("t1");
  });

  it("an unreadable Assorted Hymns can't be added to: no Add Song, the text can be edited", async () => {
    const s = setup({ review: reviewOf({ assorted: { key: "as1", next: null, has: null } }) });
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

  it("a song that turns out to be there already becomes Open Song", async () => {
    const s = setup({
      add: { ok: false, reason: "already-here", message: "", key: "as1", number: 2 },
    });
    const review = await toReview(s);
    fireEvent.click(review.getByRole("button", { name: "Add Song" }));
    expect(await review.findByRole("button", { name: "Open Song" })).toBeInTheDocument();
    expect(review.getByText(/Already in Assorted Hymns as/)).toHaveTextContent("as 2");
    expect(s.onOpenSong).not.toHaveBeenCalled();
  });

  it("an Assorted Hymns that turns out unreadable stops Add Song", async () => {
    const s = setup({ add: { ok: false, reason: "unreadable", message: "", key: "as1" } });
    const review = await toReview(s);
    fireEvent.click(review.getByRole("button", { name: "Add Song" }));
    expect(await review.findByText("Assorted Hymns can’t be read")).toBeInTheDocument();
    expect(review.queryByRole("button", { name: "Add Song" })).not.toBeInTheDocument();
  });

  it.each([
    ["no-review", /no longer current/],
    ["not-one-song", /Only a single song/],
    ["invalid", /language or script wasn’t accepted \(xx is not a language tag\)/],
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

describe("Library: the Assorted Hymns row and its sheet", () => {
  it("sits first, above the other books, labelled by its song count and no language", async () => {
    setup().view();
    const list = await screen.findByRole("list", { name: "Books" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-book", "as1");
    expect(items[0]).toHaveTextContent("Assorted Hymns");
    expect(items[0]).toHaveTextContent("3 songs");
    expect(items[0]).not.toHaveTextContent(/Multiple|mul|Loaded|Shipped/);
    expect(items).toHaveLength(3);
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
    expect(s.admin.removeAssortedSong).not.toHaveBeenCalled();
    fireEvent.click(dialog.getByRole("button", { name: "Back" }));
    expect(s.admin.removeAssortedSong).not.toHaveBeenCalled();
    expect(s.userState.dropSong).not.toHaveBeenCalled();
  });

  it("confirming removes the song and its recents, and the list is read again", async () => {
    const s = setup();
    s.view();
    fireEvent.click(await screen.findByRole("button", { name: /^Assorted Hymns/ }));
    const dialog = within(await screen.findByRole("dialog", { name: "Assorted Hymns" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Remove Rock of Ages" }));
    fireEvent.click(await dialog.findByRole("button", { name: "Remove Song" }));
    await waitFor(() => expect(s.admin.removeAssortedSong).toHaveBeenCalledWith(2));
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
    expect(
      await dialog.findByText(/the last one: Assorted Hymns goes with it/),
    ).toBeInTheDocument();
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
    expect(s.admin.removeAssortedSong).not.toHaveBeenCalled();
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
    expect(s.admin.addToAssorted).toHaveBeenCalled();
    expect(s.onOpenSong).not.toHaveBeenCalled();
    // The review sheet is closed: nothing is left to press.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Add Song" })).not.toBeInTheDocument(),
    );
  });

  it("while live, Open Song in the review is a deliberate tap and shows the song as the Finder does", async () => {
    const s = setup({ review: reviewOf({ assorted: { key: "as1", next: 8, has: 4 } }) });
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
  it("says Assorted Hymns has no file once it exists, and not before", async () => {
    setup({ rows: [shipped, loadedRow] }).view();
    await screen.findByRole("list", { name: "Books" });
    expect(screen.queryByText(/Assorted Hymns has no file/)).not.toBeInTheDocument();
  });
  it("adds the sentence once Assorted Hymns is held", async () => {
    setup().view();
    expect(
      await screen.findByText(/Assorted Hymns has no file: Back Up keeps it\./),
    ).toBeInTheDocument();
  });
});
