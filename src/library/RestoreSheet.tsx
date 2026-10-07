import { createEffect, createSignal, For, type JSX, on, onCleanup, Show } from "solid-js";
import type { LoadProgress } from "../domain/progress.ts";
import { recencyGroupOf, whenLabel } from "../domain/recency.ts";
import { askPersist, type PersistResult } from "../persistence/books.ts";
import {
  type BackupCommit,
  type BackupReview,
  type BackupReviewBook,
  type ContentAdmin,
  forgetBook,
  getContentAdmin,
} from "../persistence/content-store.ts";
import { userState as defaultUserState, type UserStateHandle } from "../persistence/user-state.ts";
import { AfterDelay, createDelayed, LoadStatus } from "../shell/Loading.tsx";
import { Sheet } from "../shell/Sheet.tsx";
import { count } from "./books.ts";

/** A backup picked, to be reviewed: a new `id` for each pick, even of the same file. */
export interface RestoreRequest {
  id: number;
  file: File;
}

export interface RestoreSheetProps {
  /** The pick to review; the sheet opens on it, and closes through {@link onClose}. */
  request?: RestoreRequest;
  placement: "bottom" | "center";
  /** The sheet was closed (the review is thrown away if it was not committed). */
  onClose: () => void;
  /** Books or settings were written: the Library reads its list again, the settings apply. */
  onRestored: () => void | Promise<void>;
  /** The first load's request to keep storage was refused: say to keep the file. */
  onStorageRefused?: () => void;
  /** Defaults to {@link getContentAdmin}; overridable for tests. */
  admin?: Pick<ContentAdmin, "reviewBackup" | "commitBackup" | "cancelBackup" | "storageMode">;
  /** Defaults to the {@link defaultUserState} singleton; overridable for tests. */
  userState?: Pick<UserStateHandle, "restore">;
  /** Asks for persistent storage at the first load; overridable for tests. */
  persist?: () => Promise<PersistResult>;
}

type Good = Extract<BackupReview, { ok: true }>;
type Done = Extract<BackupCommit, { ok: true }> & { stateError?: string; refreshError?: string };
type Choice = "keep" | "replace";

/** "Backup from Sun, Sep 27"; today's and yesterday's by the time, as Recents does. */
export function madeLabel(created: string, now = Date.now()): string {
  const at = Date.parse(created);
  if (Number.isNaN(at)) return "Backup";
  const group = recencyGroupOf(at, now);
  if (group === "before") {
    // Recents leaves the year off for this one; a backup is often older, so it says it.
    const year = new Date(at).getFullYear();
    const label = whenLabel(at, now);
    return `Backup from ${label}${year === new Date(now).getFullYear() ? "" : `, ${year}`}`;
  }
  // Recents says "Just now" for a minute-old entry; a file is dated by its time.
  const time = new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Backup from ${group === "today" ? "today" : "yesterday"}, ${time}`;
}

/** A message from the engine, written as a sentence. */
const sentence = (message: string) => {
  const text = message.trim();
  if (!text) return text;
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;
};

/** What restoring does to this book, in the words of its row (SDD-0006 §4). */
export function whatItDoes(book: BackupReviewBook): string {
  const verdict = book.verdict;
  switch (verdict.kind) {
    case "already-here":
      return "Already here";
    case "already-here-as":
      return `Already here as ${verdict.book.title}`;
    case "restore":
      return verdict.over ? "Can’t be opened here. Restoring replaces it." : "Will be restored";
    case "conflict":
      return "A different edition is here";
  }
}

const Callout = (props: {
  icon: string;
  tone?: "new" | "bad";
  /** Takes focus when the sheet moves on to it. */
  ref?: (el: HTMLDivElement) => void;
  children: JSX.Element;
}) => (
  <div
    class="callout"
    classList={{ [`callout-${props.tone}`]: !!props.tone }}
    ref={props.ref}
    tabIndex={props.ref ? -1 : undefined}
  >
    <span class={`icon ${props.icon}`} aria-hidden="true" />
    <div>{props.children}</div>
  </div>
);

/**
 * Restore (SDD-0006 §4): the backup's date and build, each book with what restoring will do, and
 * one button. Nothing is written until it is pressed; closing before then throws the review away.
 */
export function RestoreSheet(props: RestoreSheetProps) {
  const admin = () => props.admin ?? getContentAdmin();
  const user = () => props.userState ?? defaultUserState;

  const [open, setOpen] = createSignal(false);
  const [fileName, setFileName] = createSignal("");
  // The review, a refusal, or neither while it is read; both are kept while the sheet sinks away.
  const [review, setReview] = createSignal<BackupReview>();
  const [error, setError] = createSignal<string>();
  const [choices, setChoices] = createSignal<Record<string, Choice>>({});
  const [committing, setCommitting] = createSignal(false);
  const [progress, setProgress] = createSignal<LoadProgress>();
  const [done, setDone] = createSignal<Done>();
  // The commit consumed the review's token and failed: nothing is left to press.
  const [spent, setSpent] = createSignal(false);
  const saving = createDelayed(committing);
  let run = 0;
  let doneEl: HTMLDivElement | undefined;

  const good = (): Good | undefined => {
    const now = review();
    return now?.ok ? now : undefined;
  };
  const refusal = () => {
    const now = review();
    return now && !now.ok ? now.refusal : undefined;
  };

  /** Throws a review away that was not committed. */
  const drop = (token: string | undefined) => {
    if (token) void admin().cancelBackup(token);
  };

  createEffect(
    on(
      () => props.request,
      (request) => {
        if (!request) return;
        // A write under way is not interrupted: the new pick is ignored (the person picks again).
        if (committing()) return;
        // The review being shown is thrown away for this one.
        drop(good() && !done() ? good()?.token : undefined);
        const id = ++run;
        setFileName(request.file.name);
        setReview(undefined);
        setError(undefined);
        setChoices({});
        setDone(undefined);
        setSpent(false);
        setProgress(undefined);
        setOpen(true);
        void admin()
          .reviewBackup(request.file, (next) => {
            if (id === run) setProgress(next);
          })
          .catch(
            (e: unknown): BackupReview => ({
              ok: false,
              refusal: {
                reason: "unavailable",
                message: `couldn’t read the file${e instanceof Error && e.message ? `: ${e.message}` : ""}`,
              },
            }),
          )
          .then((result) => {
            // Closed, or another pick made, while it read: this one is thrown away.
            if (id !== run) {
              if (result.ok) drop(result.token);
              return;
            }
            setProgress(undefined);
            setChoices(
              Object.fromEntries(
                result.ok
                  ? result.books
                      .filter((b) => b.verdict.kind === "conflict")
                      .map((b) => [b.key, "keep"])
                  : [],
              ),
            );
            setReview(result);
          });
      },
    ),
  );

  // Unmounted with a review still pending: it is thrown away.
  onCleanup(() => {
    run++;
    if (!committing() && !done()) drop(good()?.token);
  });

  // The result takes focus when it appears: the button that was pressed is gone.
  createEffect(
    on(done, (now) => {
      if (now) queueMicrotask(() => doneEl?.focus({ preventScroll: true }));
    }),
  );

  const close = () => {
    // A write is not taken back: the sheet stays until it is done.
    if (committing()) return;
    run++;
    drop(good()?.token && !done() ? good()?.token : undefined);
    setOpen(false);
    props.onClose();
  };

  /** Whether pressing Restore would change anything: a book to add or replace, or the user state. */
  const changes = (now: Good) =>
    now.hasUserState ||
    now.books.some(
      (book) =>
        book.verdict.kind === "restore" ||
        (book.verdict.kind === "conflict" &&
          book.verdict.replaceable &&
          choices()[book.key] === "replace"),
    );

  const commit = async (now: Good) => {
    if (committing()) return;
    const id = run;
    setCommitting(true);
    setError(undefined);
    setProgress(undefined);
    const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
    try {
      const chosen: Record<string, Choice> = {};
      for (const book of now.books) {
        if (book.verdict.kind === "conflict") {
          chosen[book.key] = book.verdict.replaceable ? (choices()[book.key] ?? "keep") : "keep";
        }
      }
      let result: BackupCommit;
      try {
        result = await admin().commitBackup(now.token, chosen, (next) => {
          if (id === run) setProgress(next);
        });
      } catch (e) {
        result = { ok: false, reason: "failed", message: message(e) };
      }
      if (!result.ok) {
        // The token is used up whatever went wrong: there is no pressing Restore again.
        if (id === run) {
          setError(`Couldn’t restore the backup: ${result.message}`);
          setSpent(true);
        }
        return;
      }
      // From here the books are written, whatever else fails: each step is told apart, and the
      // Library is refreshed at the end of them all.
      const finished: Done = { ...result };
      if (result.userState !== undefined) {
        try {
          await user().restore(result.userState, new Set(result.held));
        } catch (e) {
          finished.stateError = message(e);
        }
      }
      for (const book of result.books) forgetBook(book.key);
      // Asking is a courtesy, and not waited for: Firefox holds the answer until the user
      // gives it, and the books are written.
      void (async () => {
        // A window that keeps nothing is not asked to keep storage.
        if (!result.firstLoad) return;
        if (
          (await admin()
            .storageMode()
            .catch(() => "opfs")) === "memory"
        )
          return;
        if ((await (props.persist ?? askPersist)()) === "refused") props.onStorageRefused?.();
      })().catch(() => {});
      try {
        await props.onRestored();
      } catch (e) {
        finished.refreshError = message(e);
      }
      if (id === run) setDone(finished);
    } finally {
      setCommitting(false);
      setProgress(undefined);
    }
  };

  const restoredCount = (now: Done) =>
    now.books.filter((b) => b.outcome === "restored" || b.outcome === "replaced").length;
  const failed = (now: Done) => now.books.filter((b) => b.outcome === "failed");

  const refusedBody = (now: NonNullable<ReturnType<typeof refusal>>) => {
    switch (now.reason) {
      case "not-a-backup":
        return (
          <Callout icon="icon-error" tone="bad">
            <h4>This isn’t a Hymnal backup.</h4>
          </Callout>
        );
      case "needs-newer-app":
        return (
          <Callout icon="icon-update" tone="bad">
            <h4>This backup needs a newer app</h4>
            <p>
              It is version {now.found}; this app reads version {now.expected}.
            </p>
            <p>Update Hymnal, then restore the file again.</p>
          </Callout>
        );
      default:
        return (
          <Callout icon="icon-error" tone="bad">
            <h4>{sentence(now.message)}</h4>
          </Callout>
        );
    }
  };

  return (
    <Sheet
      open={open()}
      onClose={close}
      title="Restore"
      closeLabel={
        committing()
          ? "Restoring…"
          : (review() && !good()) || done() || spent()
            ? "Close"
            : "Cancel"
      }
      closeDisabled={committing()}
      placement={props.placement}
      tall
      // Held only while the file is read, so the card does not jump when the
      // review lands; a settled review hugs its content (#53).
      steady={!review() && !error()}
    >
      <div class="review restore">
        <Show
          when={review()}
          fallback={
            <div class="review-book">
              <h3 class="review-file">{fileName()}</h3>
              <p>Checking the file on this device. Nothing is sent anywhere.</p>
              <AfterDelay>
                <LoadStatus progress={progress()} idle="Reading…" />
              </AfterDelay>
            </div>
          }
        >
          <Show when={refusal()}>
            {(now) => (
              <>
                {refusedBody(now())}
                <div class="review-actions">
                  <button type="button" class="btn-tonal" onClick={close}>
                    Close
                  </button>
                </div>
              </>
            )}
          </Show>
          <Show when={good()}>
            {(now) => (
              <>
                <div class="review-book">
                  <h3>{madeLabel(now().created)}</h3>
                  <p class="restore-build">Build {now().build}</p>
                </div>
                <Show
                  when={done()}
                  fallback={
                    <>
                      <ul class="restore-books" aria-label="Books in the backup">
                        <For each={now().books}>
                          {(book) => (
                            <BookRow
                              book={book}
                              choice={choices()[book.key]}
                              onChoose={(c) => setChoices((was) => ({ ...was, [book.key]: c }))}
                              disabled={committing()}
                            />
                          )}
                        </For>
                      </ul>
                      <Show when={now().books.length === 0}>
                        <p class="restore-quiet">This backup holds no books.</p>
                      </Show>
                      <Show when={now().problems.length > 0}>
                        <h4 class="restore-head">Not restored</h4>
                        <ul class="review-problems" aria-label="Not restored">
                          <For each={now().problems}>
                            {(problem) => (
                              <li>
                                <b>{problem.title ?? problem.name}</b>: {problem.message}
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                      <Show when={now().hasUserState}>
                        <p class="restore-quiet">Settings and recent hymns come back too.</p>
                      </Show>
                      <Show when={error()}>
                        <p class="review-error" role="alert">
                          {error()}
                        </p>
                      </Show>
                      <div class="review-actions">
                        <Show
                          when={!saving()}
                          fallback={<LoadStatus progress={progress()} idle="Restoring…" />}
                        >
                          <Show when={!spent()}>
                            <button
                              type="button"
                              class="btn-filled"
                              disabled={committing() || !changes(now())}
                              onClick={() => void commit(now())}
                            >
                              Restore
                            </button>
                          </Show>
                        </Show>
                      </div>
                    </>
                  }
                >
                  {(result) => (
                    <>
                      <Callout
                        icon="icon-check-circle"
                        tone="new"
                        ref={(el) => {
                          doneEl = el;
                        }}
                      >
                        <h4>
                          {restoredCount(result()) > 0
                            ? `Restored ${count(restoredCount(result()))} ${restoredCount(result()) === 1 ? "book" : "books"}.`
                            : "No books needed restoring."}
                        </h4>
                        <Show when={now().hasUserState && !result().stateError}>
                          <p>Settings and recent hymns are back.</p>
                        </Show>
                      </Callout>
                      <Show when={failed(result()).length > 0}>
                        <h4 class="restore-head">Not restored</h4>
                        <ul class="review-problems" aria-label="Not restored">
                          <For each={failed(result())}>
                            {(book) => (
                              <li>
                                <b>{book.title}</b>: {book.message ?? "it could not be restored"}
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                      <Show when={result().refreshError}>
                        <p class="review-error" role="alert">
                          The Library couldn’t refresh: {result().refreshError}. Reload the page to
                          see the books.
                        </p>
                      </Show>
                      <Show when={result().stateError}>
                        <p class="review-error" role="alert">
                          Settings and recent hymns couldn’t be restored: {result().stateError}
                        </p>
                      </Show>
                    </>
                  )}
                </Show>
              </>
            )}
          </Show>
        </Show>
      </div>
    </Sheet>
  );
}

/** One book of the backup: its title and songs, and what restoring does; a conflict asks. */
function BookRow(props: {
  book: BackupReviewBook;
  choice?: Choice;
  disabled: boolean;
  onChoose: (choice: Choice) => void;
}) {
  const verdict = () => props.book.verdict;
  const replaceable = () => {
    const now = verdict();
    return now.kind === "conflict" && now.replaceable;
  };
  return (
    <li class="restore-book" data-verdict={verdict().kind}>
      <div class="restore-book-head">
        <span class="restore-title">{props.book.title}</span>
        <span class="restore-songs num">
          {count(props.book.songs)} {props.book.songs === 1 ? "song" : "songs"}
        </span>
      </div>
      <p class="restore-what">{whatItDoes(props.book)}</p>
      <Show when={verdict().kind === "conflict"}>
        <fieldset class="options restore-choice">
          <legend class="visually-hidden">What to do with {props.book.title}</legend>
          <label class="option">
            <input
              type="radio"
              name={`restore-${props.book.key}`}
              checked={props.choice !== "replace" || !replaceable()}
              disabled={props.disabled}
              onChange={() => props.onChoose("keep")}
            />
            <span>
              <strong>Keep this device’s</strong>
            </span>
          </label>
          <Show when={replaceable()}>
            <label class="option">
              <input
                type="radio"
                name={`restore-${props.book.key}`}
                checked={props.choice === "replace"}
                disabled={props.disabled}
                onChange={() => props.onChoose("replace")}
              />
              <span>
                <strong>Replace</strong>
              </span>
            </label>
          </Show>
        </fieldset>
      </Show>
    </li>
  );
}
