import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import type { TextError } from "../import/songtext.ts";
import { commitAndPersist, removeBookAndRecents } from "../persistence/books.ts";
import {
  type BookRow,
  type Choice,
  forgetBook,
  getContentAdmin,
  type LoadReview,
} from "../persistence/content-store.ts";
import { userState as defaultUserState, type UserState } from "../persistence/user-state.ts";
import { AfterDelay, ProgressBar } from "../shell/Loading.tsx";
import { Menu } from "../shell/Menu.tsx";
import { createMediaQuery, EXPANDED_QUERY } from "../shell/media.ts";
import {
  type Books,
  count,
  type LibraryAdmin,
  languageName,
  problemOf,
  type RowState,
  songs,
} from "./books.ts";
import { RemoveSheet, type RemoveTarget } from "./RemoveSheet.tsx";
import { ReviewSheet } from "./ReviewSheet.tsx";
import { createTextDraft, TextSheet } from "./TextSheet.tsx";
import { buildTextBook, type FieldProblems, type SourceState } from "./textbook.ts";

const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1);

export interface LibraryProps {
  books: Books;
  /** The current book's key, if one is. */
  currentKey?: string;
  /** Choosing a book makes it the current one (SDD-0004 §9). */
  onChoose: (key: string) => void;
  /** A tap on a book's row: it is the current book, and the Finder, aimed at it, is where
   * to go (SDD-0004 §9). Called after {@link onChoose}. */
  onOpen?: (key: string) => void;
  /** The book the hymn on screen is from, and whether the Output is live: that book
   * cannot be removed while it is on the Output (SDD-0004 §10). */
  presentedKey?: string;
  outputLive?: boolean;
  /** The first load's request to keep storage was refused: say to keep the file. */
  onStorageRefused?: () => void;
  /** A word for the snackbar: books left unloaded when the review is closed. */
  onNotice?: (message: string) => void;
  /** Defaults to {@link getContentAdmin}; overridable for tests. */
  admin?: LibraryAdmin;
  /** Defaults to the {@link defaultUserState} singleton; overridable for tests. */
  userState?: Pick<UserState, "getRecents" | "dropRecents">;
  /** Asks for persistent storage at the first load; overridable for tests. */
  persist?: Parameters<typeof commitAndPersist>[3];
}

/** What the picker started, until its review is shown or thrown away. */
interface Reading {
  id: number;
  fileName: string;
  target?: string;
}

/** One picked file in the queue, and what became of it. */
interface QueueEntry {
  file: File;
  /** `open`: not decided; `loaded`: written, or opened; `failed`: could not be read. */
  state: "open" | "loaded" | "failed";
  /** The last review read for it: shown at once on a return, while a fresh one is read
   * (the books held may have changed since, and so may its verdict). */
  review?: LoadReview;
}

/** Files picked together: reviewed in any order, each decided where the operator is (SDD-0004 §9). */
interface Queue {
  entries: QueueEntry[];
  /** The entry in view. */
  at: number;
  target?: string;
}

/** Where the review in view is in its queue: "Book 2 of 5", and where Back and Next lead. */
export interface QueuePosition {
  index: number;
  total: number;
  canBack: boolean;
  canNext: boolean;
  /** This book is loaded already: its decision is made. */
  loaded: boolean;
}

/** The queue's entries that can be looked at: a file that could not be read is passed over. */
const readable = (queue: Queue) => queue.entries.filter((entry) => entry.state !== "failed");

/** What closing leaves unloaded: the books not decided, and the files that could not be read. */
const unloaded = (queue: Queue) => queue.entries.filter((entry) => entry.state !== "loaded").length;

const positionOf = (queue: Queue): QueuePosition => {
  const shown = readable(queue);
  const here = shown.indexOf(queue.entries[queue.at] as QueueEntry);
  return {
    index: here + 1,
    total: shown.length,
    canBack: here > 0,
    canNext: here >= 0 && here < shown.length - 1,
    loaded: queue.entries[queue.at]?.state === "loaded",
  };
};

/** The nearest readable entry from `from` (not itself) going `step`, if there is one. */
const nearest = (queue: Queue, from: number, step: 1 | -1): number | undefined => {
  for (let i = from + step; i >= 0 && i < queue.entries.length; i += step) {
    if (queue.entries[i]?.state !== "failed") return i;
  }
  return undefined;
};

const rowTitle = (book: BookRow) => book.title || book.key;

/** The list's shape while it loads: a header and two rows, where they will be. */
const librarySkeleton = () => (
  <div class="lib" role="status" aria-busy="true">
    <span class="visually-hidden">Loading…</span>
    <div class="lib-head">
      <div class="lib-head-text">
        <span class="skeleton skeleton-title-sm" aria-hidden="true" />
      </div>
      <span class="skeleton skeleton-button" aria-hidden="true" />
    </div>
    <div class="book-list" aria-hidden="true">
      <span class="skeleton skeleton-row" />
      <span class="skeleton skeleton-row" />
    </div>
  </div>
);

/**
 * The Library (SDD-0004 §9): every book held, loading a book from a file with
 * the review before anything is written, and removing one after a
 * confirmation. How it is drawn is DESIGN.md's § The Library.
 */
export function Library(props: LibraryProps) {
  const expanded = createMediaQuery(EXPANDED_QUERY);
  const admin = () => props.admin ?? getContentAdmin();
  const user = () => props.userState ?? defaultUserState;
  const placement = () => (expanded() ? "center" : "bottom");

  let input: HTMLInputElement | undefined;
  let pickTarget: string | undefined;
  let nextId = 0;
  // The files picked together. Closing the review sheet drops it; nothing is written for what
  // was not loaded.
  let queue: Queue | undefined;

  const [reading, setReading] = createSignal<Reading>();
  // The review sheet keeps its last review while it sinks away.
  const [review, setReview] = createSignal<LoadReview>();
  const [reviewFile, setReviewFile] = createSignal("");
  const [reviewOpen, setReviewOpen] = createSignal(false);
  const [reviewError, setReviewError] = createSignal<string>();
  const [busy, setBusy] = createSignal(false);
  // A book from song text (ADR-0029): the sheet's draft, what its last Review found wrong,
  // and, while its review is open, the source check that goes with it.
  const draft = createTextDraft();
  const [textOpen, setTextOpen] = createSignal(false);
  const [textBusy, setTextBusy] = createSignal(false);
  const [textErrors, setTextErrors] = createSignal<TextError[]>([]);
  const [textProblems, setTextProblems] = createSignal<FieldProblems>({});
  const [reviewSource, setReviewSource] = createSignal<SourceState>();
  const [removing, setRemoving] = createSignal<RemoveTarget>();
  const [removeOpen, setRemoveOpen] = createSignal(false);
  const [removeRecents, setRemoveRecents] = createSignal(0);
  const [removeError, setRemoveError] = createSignal<string>();
  const [position, setPosition] = createSignal<QueuePosition>();
  // A book is being read again (to its fresh verdict) or for the first time, in the open sheet.
  const [refreshing, setRefreshing] = createSignal(false);
  const [sheetReading, setSheetReading] = createSignal<string>();
  // Files that could not be read, each said in words.
  const [readErrors, setReadErrors] = createSignal<string[]>([]);
  // Books whose file turned out to be gone when they were chosen (evicted).
  const [missing, setMissing] = createSignal<ReadonlySet<string>>(new Set());
  const [justAdded, setJustAdded] = createSignal<string>();

  const rows = () => props.books.rows() ?? [];
  const stateOf = (book: BookRow): RowState =>
    book.state === "ok" && missing().has(book.key) ? "missing" : book.state;

  const pick = (target?: string) => {
    // Not while a book is being written: a new queue must not begin under it.
    if (busy()) return;
    pickTarget = target;
    if (input) {
      // Several at once, except to bring one book back.
      input.multiple = target === undefined;
      input.value = "";
      input.click();
    }
  };

  const endQueue = () => {
    queue = undefined;
    setPosition(undefined);
    setRefreshing(false);
    setSheetReading(undefined);
  };

  /** Closes the review sheet. Of several books, those not decided stay unloaded, and it says so. */
  const closeReview = (quiet = false) => {
    // A commit in flight is not taken back by closing the sheet.
    if (busy()) return;
    const token = review()?.token;
    if (token) void admin().cancel(token);
    // A read still going is thrown away when it lands.
    nextId++;
    setReading(undefined);
    setReviewOpen(false);
    setReviewError(undefined);
    setBusy(false);
    const left = queue && queue.entries.length > 1 ? unloaded(queue) : 0;
    endQueue();
    if (left > 0 && !quiet) props.onNotice?.(`${left} ${left === 1 ? "book" : "books"} not loaded`);
    // A review of song text goes back to the text, which is kept to fix.
    if (reviewSource()) setTextOpen(true);
  };

  const openText = () => {
    setTextErrors([]);
    setTextProblems({});
    setTextOpen(true);
  };

  /** Parse the text and, when it is clean, review the book as if its container had been read. */
  const reviewText = async () => {
    if (textBusy()) return;
    const built = buildTextBook(draft.fields(), draft.songText(), draft.sourceText());
    if (!built.ok) {
      setTextProblems(built.fields);
      setTextErrors(built.errors);
      return;
    }
    setTextProblems({});
    setTextErrors([]);
    endQueue();
    setTextBusy(true);
    const name = `${built.id}.hymnbook.json.gz`;
    try {
      const result = await admin().review(new File([built.bytes as BlobPart], name));
      setReview(result);
      setReviewFile(name);
      setReviewSource(built.source);
      setReviewError(undefined);
      setTextOpen(false);
      setReviewOpen(true);
    } catch (error) {
      setTextErrors([
        {
          line: 0,
          message: `Couldn’t review the book${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
        },
      ]);
    }
    setTextBusy(false);
  };

  /** Puts a review in the sheet. */
  const present = (result: LoadReview, file: File) => {
    setReview(result);
    setReviewFile(file.name);
    setReviewError(undefined);
    setReviewOpen(true);
  };

  const closeQueue = () => {
    if (reviewOpen()) closeReview(true);
    else endQueue();
  };

  /**
   * Brings the queue's entry `i` into view, in either direction. A book already looked at shows
   * at once and is read again for its verdict as the books are now; one not yet looked at is
   * read. Whatever was being read before is thrown away when it lands. Where nothing readable is
   * left, the queue ends.
   */
  const show = async (now: Queue, i: number, step: 1 | -1 = 1): Promise<void> => {
    const id = ++nextId;
    const entry = now.entries[i];
    if (!entry) return closeQueue();
    now.at = i;
    setPosition(positionOf(now));
    if (entry.state === "loaded" && entry.review) {
      setReading(undefined);
      setRefreshing(false);
      setSheetReading(undefined);
      present(entry.review, entry.file);
      return;
    }
    if (reviewOpen()) {
      setRefreshing(true);
      if (entry.review) {
        setSheetReading(undefined);
        present(entry.review, entry.file);
      } else setSheetReading(entry.file.name);
    } else {
      setReviewSource(undefined);
      setReading({ id, fileName: entry.file.name, target: now.target });
    }
    try {
      const result = await admin().review(entry.file, now.target);
      // Cancelled, or another book brought into view, while it read: this one is thrown away.
      if (id !== nextId) {
        if (result.token) void admin().cancel(result.token);
        return;
      }
      entry.review = result;
      setReading(undefined);
      setRefreshing(false);
      setSheetReading(undefined);
      present(result, entry.file);
    } catch (error) {
      if (id !== nextId) return;
      setReading(undefined);
      setRefreshing(false);
      setSheetReading(undefined);
      entry.state = "failed";
      const said = `Couldn’t read ${entry.file.name}${error instanceof Error && error.message ? `: ${error.message}` : "."}`;
      setReadErrors((was) => [...was, said]);
      // Said and passed over: on to the next in the direction of travel, else the other way.
      const to = nearest(now, i, step) ?? nearest(now, i, step === 1 ? -1 : 1);
      if (to === undefined) return closeQueue();
      await show(now, to, step);
    }
  };

  /** Back or Next: another book, whatever was decided here left as it is. */
  const move = (step: 1 | -1) => {
    const now = queue;
    if (!now || busy()) return;
    const to = nearest(now, now.at, step);
    if (to !== undefined) void show(now, to, step);
  };

  const onPicked = (files: File[]) => {
    if (files.length === 0 || busy()) return;
    setReadErrors([]);
    const now: Queue = {
      entries: files.map((file): QueueEntry => ({ file, state: "open" })),
      at: 0,
      target: pickTarget,
    };
    queue = now;
    void show(now, 0, 1);
  };

  const cancelReading = () => {
    nextId++;
    endQueue();
    setReading(undefined);
  };

  const scrollTo = (key: string) => {
    setJustAdded(key);
    queueMicrotask(() =>
      document
        .querySelector(`[data-book="${CSS.escape(key)}"]`)
        ?.scrollIntoView?.({ block: "nearest" }),
    );
  };

  const commit = async (choice: Choice) => {
    const current = review();
    if (!current?.token || busy()) return;
    // The queue and its entry as they are now: what is awaited below must not decide
    // for a queue begun meanwhile.
    const now = queue;
    const here = now?.entries[now.at];
    setBusy(true);
    setReviewError(undefined);
    const result = await commitAndPersist(admin(), current.token, choice, props.persist).catch(
      (error: unknown) => ({
        ok: false as const,
        reason: "failed" as const,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    if (!result.ok) {
      setBusy(false);
      setReviewError(
        result.reason === "stale"
          ? "The books on this device changed since the file was read. Cancel, then pick the file again."
          : `Couldn’t load the book: ${result.message}`,
      );
      return;
    }
    if (reviewSource()) {
      draft.reset();
      setReviewSource(undefined);
    }
    forgetBook(result.key);
    // A book that was written, restored or opened has its file: no longer missing.
    setMissing((was) => {
      const next = new Set(was);
      next.delete(result.key);
      return next;
    });
    // Busy until the list is read too, so no new pick can begin in the meantime.
    await props.books.refresh();
    setBusy(false);
    const opened = result.action === "opened" || result.action === "recorded";
    // A load never switches the current book under the operator, unless
    // there is none (the first load); Open Book is the user choosing it.
    if (opened || props.currentKey === undefined) props.onChoose(result.key);
    if (!opened) scrollTo(result.key);
    if (result.persist === "refused") props.onStorageRefused?.();
    if (now && here) decided(now, here, current);
    else setReviewOpen(false);
  };

  /**
   * The book in view is loaded: its decision is kept, and the next one still open comes into
   * view, in the sheet that stays open. The sheet closes only when none is left.
   */
  const decided = (now: Queue, here: QueueEntry, done: LoadReview) => {
    here.state = "loaded";
    here.review = { ...done, token: "" };
    // A queue begun or ended meanwhile is not this one's to move.
    if (queue !== now) return;
    const at = now.entries.indexOf(here);
    const after = now.entries.findIndex((entry, i) => i > at && entry.state === "open");
    const to = after >= 0 ? after : now.entries.findIndex((entry) => entry.state === "open");
    if (to >= 0) {
      void show(now, to, 1);
    } else {
      // All decided: nothing left to say.
      setReviewOpen(false);
      endQueue();
    }
  };

  const chooseAnother = () => {
    const target = review()?.restore?.key;
    const fromText = !!reviewSource();
    closeReview(true);
    // A refused book from text goes back to the text; closeReview has reopened it.
    if (!fromText) pick(target);
  };

  const choose = async (book: BookRow) => {
    if (book.key === props.currentKey) {
      props.onOpen?.(book.key);
      return;
    }
    const status = await admin().openBook(book.key);
    if (status.state === "ready") {
      setMissing((now) => {
        const next = new Set(now);
        next.delete(book.key);
        return next;
      });
      props.onChoose(book.key);
      props.onOpen?.(book.key);
    } else if (status.state === "missing-asset") {
      setMissing((now) => new Set(now).add(book.key));
    } else {
      await props.books.refresh();
    }
  };

  const askRemove = async (book: BookRow) => {
    const recents = (await user().getRecents()).filter((r) => r.hymnbookId === book.key).length;
    setRemoveRecents(recents);
    setRemoveError(undefined);
    setRemoving({
      key: book.key,
      title: rowTitle(book),
      language: book.language,
      songs: book.songs,
      state: stateOf(book),
    });
    setRemoveOpen(true);
  };

  const nextTitle = () => {
    const gone = removing()?.key;
    const next = rows().find((b) => b.key !== gone && b.state === "ok");
    return next ? rowTitle(next) : undefined;
  };

  const onOutput = () =>
    !!removing() && removing()?.key === props.presentedKey && !!props.outputLive;
  const confirmRemove = async () => {
    const target = removing();
    // Refused while that book is on the Output, whatever the button says (§10).
    if (!target || busy() || onOutput()) return;
    setBusy(true);
    try {
      await removeBookAndRecents(admin(), user(), target.key);
    } catch (error) {
      setBusy(false);
      setRemoveError(
        `Couldn’t remove the book: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    setBusy(false);
    setRemoveOpen(false);
    forgetBook(target.key);
    // The app chooses another current book when this one is no longer held.
    await props.books.refresh();
  };

  // The note that says a book was added fades from the list after a moment.
  createEffect(() => {
    if (!justAdded()) return;
    const timer = setTimeout(() => setJustAdded(undefined), 4000);
    onCleanup(() => clearTimeout(timer));
  });

  /* ------------------------------ pieces ------------------------------ */

  const loadButton = (variant: "btn-tonal" | "btn-filled") => (
    <button type="button" class={variant} disabled={!!reading() || busy()} onClick={() => pick()}>
      <span class="icon icon-file-open" aria-hidden="true" />
      Load Books
    </button>
  );

  const textButton = (variant: "btn-text" | "btn-tonal") => (
    <button type="button" class={variant} disabled={!!reading() || busy()} onClick={openText}>
      <span class="icon icon-edit-note" aria-hidden="true" />
      From Text
    </button>
  );

  const readingRow = (now: Reading) => (
    <li class="book reading">
      <span class="book-tile">
        <span class="icon icon-file-open" aria-hidden="true" />
      </span>
      <div class="reading-body">
        <div>
          <div class="title-medium reading-name">
            Reading {now.fileName}
            <Show when={position() && (position()?.total ?? 0) > 1}>
              {" "}
              <span class="reading-count">
                ({position()?.index} of {position()?.total})
              </span>
            </Show>
          </div>
          <div class="book-meta">Checking the file on this device. Nothing is sent anywhere.</div>
        </div>
        <ProgressBar label="Reading the book" />
      </div>
      <button type="button" class="btn-text" onClick={cancelReading}>
        Cancel
      </button>
    </li>
  );

  const bookRow = (book: BookRow) => {
    const state = () => stateOf(book);
    const bad = () => state() !== "ok";
    const current = () => book.key === props.currentKey && !bad();
    const shipped = book.kind === "shipped";
    const menu = () => (
      <Menu
        label={`More for ${rowTitle(book)}`}
        fold={false}
        items={[
          {
            label: "Remove…",
            disabled: shipped,
            supporting: shipped ? "Shipped with the app" : "Drops the book and its Recents",
            run: () => void askRemove(book),
          },
        ]}
      />
    );
    return (
      <li
        class="book"
        classList={{ "book-bad": bad(), "book-new": justAdded() === book.key }}
        data-book={book.key}
        data-state={state()}
      >
        <Show
          when={!bad()}
          fallback={
            <fieldset class="book-main" aria-label={rowTitle(book)}>
              <span class="book-tile">
                <span
                  class={`icon ${state() === "needs-newer-app" ? "icon-update" : "icon-warning"}`}
                  aria-hidden="true"
                />
              </span>
              <div class="book-text">
                <Show
                  when={book.title !== book.key}
                  fallback={<div class="book-key">{book.key}</div>}
                >
                  <div class="book-title">{book.title}</div>
                </Show>
                <div class="book-status">{problemOf(state()).status}</div>
                <div class="book-note">{problemOf(state()).note}</div>
                <Show when={problemOf(state()).loadAgain}>
                  <div class="book-actions">
                    <button type="button" class="btn-text" onClick={() => pick(book.key)}>
                      Load Again
                    </button>
                  </div>
                </Show>
              </div>
            </fieldset>
          }
        >
          <button
            type="button"
            class="book-main"
            aria-current={current() ? "true" : undefined}
            onClick={() => void choose(book)}
          >
            <span class="book-tile">
              <span class="icon icon-library" aria-hidden="true" />
            </span>
            <span class="book-text">
              <span class="book-title">{book.title}</span>
              <span class="book-meta">
                <span class="book-meta-inner">
                  <Show when={current()}>
                    <span class="seg">
                      <b>Current</b>
                    </span>
                  </Show>
                  <span class="seg">{languageName(book.language)}</span>
                  <span class="seg book-songs-inline num">{songs(book.songs)}</span>
                  <span class="seg">{shipped ? "Shipped" : "Loaded"}</span>
                  <Show when={justAdded() === book.key}>
                    <span class="seg">
                      <b>Added</b>
                    </span>
                  </Show>
                </span>
              </span>
            </span>
            <span class="book-count">
              <b>{count(book.songs)}</b>
              <span>songs</span>
            </span>
          </button>
        </Show>
        {menu()}
      </li>
    );
  };

  const list = (): JSX.Element => (
    <div class="lib">
      <div class="lib-head">
        <div class="lib-head-text">
          <h1 class="title-large">Library</h1>
          <p>
            {rows().length} {rows().length === 1 ? "book" : "books"} on this device
          </p>
        </div>
        <div class="lib-head-actions">
          {textButton("btn-text")}
          {loadButton("btn-tonal")}
        </div>
      </div>
      <Show when={props.books.problem()}>
        {(message) => (
          <div class="callout callout-bad" role="alert">
            <span class="icon icon-error" aria-hidden="true" />
            <div>
              <p>{message()}</p>
              <button
                type="button"
                class="btn-text lib-retry"
                onClick={() => void props.books.retry()}
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </Show>
      <Show when={readErrors().length > 0}>
        <div class="callout callout-bad" role="alert">
          <span class="icon icon-error" aria-hidden="true" />
          <div>
            <For each={readErrors()}>{(message) => <p>{message}</p>}</For>
          </div>
        </div>
      </Show>
      <ul class="book-list" aria-label="Books">
        <Show when={reading()}>{(now) => readingRow(now())}</Show>
        <For each={rows()}>{bookRow}</For>
      </ul>
      <p class="lib-foot">
        Books stay on this device. A loaded book has no copy anywhere else, so keep its file.
      </p>
    </div>
  );

  const empty = (): JSX.Element => (
    <div class="card-elevated library lib-empty">
      <Show
        when={reading()}
        fallback={
          <>
            <h1 class="display-small">Bring your first songbook</h1>
            <p class="body-large on-surface-variant">
              Load a songbook file, or type one in. It stays on this device.
            </p>
            <For each={readErrors()}>
              {(message) => (
                <p class="review-error" role="alert">
                  {message}
                </p>
              )}
            </For>
            <div class="lib-empty-actions">
              {loadButton("btn-filled")}
              {textButton("btn-tonal")}
            </div>
          </>
        }
      >
        {(now) => (
          <>
            <h1 class="title-large reading-name">Reading {now().fileName}</h1>
            <p class="body-large on-surface-variant">
              Checking the file on this device. Nothing is sent anywhere.
            </p>
            <ProgressBar label="Reading the book" />
            <button type="button" class="btn-text lib-retry" onClick={cancelReading}>
              Cancel
            </button>
          </>
        )}
      </Show>
    </div>
  );

  /** A first install: the songbook copied to this device, once. The title is
   * in the file still arriving, so the words can't name it. */
  const installing = (progress: Accessor<{ loaded: number; total?: number }>) => (
    <div class="card-elevated library" aria-busy="true">
      <p class="body-large">Installing the songbook for offline use…</p>
      <ProgressBar
        label="Installing the songbook"
        value={progress().total ? progress().loaded / (progress().total ?? 1) : undefined}
      />
      <p class="body-medium on-surface-variant library-progress-text">
        {progress().total
          ? `${megabytes(progress().loaded)} of ${megabytes(progress().total ?? 0)} MB`
          : `${megabytes(progress().loaded)} MB`}
      </p>
    </div>
  );

  return (
    <>
      <input
        ref={input}
        type="file"
        class="visually-hidden"
        accept=".gz,application/gzip,application/x-gzip"
        tabIndex={-1}
        aria-hidden="true"
        multiple
        data-testid="book-file"
        onChange={(event) => onPicked([...(event.currentTarget.files ?? [])])}
      />
      <Switch
        fallback={
          <AfterDelay>
            <Show when={props.books.installing()} fallback={librarySkeleton()}>
              {(now) => installing(now)}
            </Show>
          </AfterDelay>
        }
      >
        <Match when={props.books.problem() && rows().length === 0}>
          <div class="card-elevated library">
            <p class="body-large" role="alert">
              {props.books.problem()}
            </p>
            <button type="button" class="btn-filled" onClick={() => void props.books.retry()}>
              Retry
            </button>
          </div>
        </Match>
        <Match when={props.books.rows() && rows().length === 0}>{empty()}</Match>
        <Match when={props.books.rows()}>{list()}</Match>
      </Switch>

      <ReviewSheet
        open={reviewOpen()}
        review={review()}
        fileName={reviewFile()}
        error={reviewError()}
        busy={busy()}
        refreshing={refreshing()}
        reading={sheetReading()}
        problems={reviewSource() ? [] : readErrors()}
        source={reviewSource()}
        position={position()}
        placement={placement()}
        onCancel={() => closeReview()}
        onBack={() => move(-1)}
        onNext={() => move(1)}
        onCommit={(choice) => void commit(choice)}
        onChooseAnother={chooseAnother}
      />
      <TextSheet
        open={textOpen()}
        draft={draft}
        errors={textErrors()}
        problems={textProblems()}
        busy={textBusy()}
        placement={placement()}
        onCancel={() => setTextOpen(false)}
        onReview={() => void reviewText()}
      />
      <RemoveSheet
        open={removeOpen()}
        book={removing()}
        recents={removeRecents()}
        current={removing()?.key === props.currentKey}
        presented={removing()?.key === props.presentedKey}
        onOutput={onOutput()}
        nextTitle={nextTitle()}
        busy={busy()}
        error={removeError()}
        placement={placement()}
        onCancel={() => !busy() && setRemoveOpen(false)}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
}
