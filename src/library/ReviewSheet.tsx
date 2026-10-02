import { createEffect, createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import type { Choice, LoadReview } from "../persistence/content-store.ts";
import { Sheet } from "../shell/Sheet.tsx";
import { SwapLabel } from "../shell/SwapLabel.tsx";
import { count, languageName, shortHash } from "./books.ts";

export interface ReviewSheetProps {
  open: boolean;
  /** The review to show; kept while the sheet sinks away. */
  review?: LoadReview;
  /** The picked file's name, for what is refused before it can name itself. */
  fileName: string;
  /** What went wrong committing, in words; the review stays so the choice can be made again. */
  error?: string;
  busy: boolean;
  placement: "bottom" | "center";
  onCancel: () => void;
  onCommit: (choice: Choice) => void;
  /** After a refusal: the picker again. */
  onChooseAnother: () => void;
}

/** What the sheet is, from the review: a refusal, a restore, or the verdict of §8. */
type Panel =
  | "not-a-book"
  | "newer"
  | "violations"
  | "restore"
  | "same-file"
  | "same-songs"
  | "same-origin"
  | "new";

export function panelOf(review: LoadReview): Panel {
  const [first] = review.violations;
  if (first) {
    if (first.rule === "container") return "not-a-book";
    if (first.rule === "format" && /needs a newer app/.test(first.message)) return "newer";
    return "violations";
  }
  if (review.restore) return "restore";
  return review.verdict?.kind ?? "new";
}

/** The held book a same-file or same-songs verdict names. */
const heldTitle = (review: LoadReview) => {
  const verdict = review.verdict;
  return verdict && "book" in verdict ? verdict.book.title : "";
};

const Callout = (props: {
  icon: string;
  tone?: "new" | "bad" | "quiet";
  children: JSX.Element;
}) => (
  <div class="callout" classList={{ [`callout-${props.tone}`]: !!props.tone }}>
    <span class={`icon ${props.icon}`} aria-hidden="true" />
    <div>{props.children}</div>
  </div>
);

/**
 * Review without edit (ADR-0027, SDD-0004 §9): what the file is, whether it is
 * valid, and what loading it would do, all read-only. Nothing is written until
 * the one button is pressed; Cancel throws the parsed book away.
 */
export function ReviewSheet(props: ReviewSheetProps) {
  const panel = () => (props.review ? panelOf(props.review) : undefined);
  const [replace, setReplace] = createSignal<string>();
  // Keep both is the default, every time a review opens.
  createEffect(() => {
    void props.review?.token;
    setReplace(undefined);
  });
  const origin = () => {
    const verdict = props.review?.verdict;
    return verdict?.kind === "same-origin" ? verdict : undefined;
  };
  const refused = () => ["not-a-book", "newer", "violations"].includes(panel() ?? "");
  const choice = (): Choice => {
    const key = replace();
    return key ? { replace: key } : "keep-both";
  };
  const heldNote = (review: LoadReview) => {
    if (review.held.count === 0) return undefined;
    const names = review.held.books.map((b) => (
      <>
        <b>{b.title}</b> ({count(b.count)})
      </>
    ));
    return (
      <Callout icon="icon-info" tone="quiet">
        {count(review.held.count)} of these songs are also in{" "}
        <For each={names}>
          {(name, i) => (
            <>
              {i() > 0 ? (i() === names.length - 1 ? " and " : ", ") : ""}
              {name}
            </>
          )}
        </For>
        . They load anyway.
      </Callout>
    );
  };

  return (
    <Sheet
      open={props.open}
      onClose={props.onCancel}
      title={panel() === "restore" ? "Load Again" : "Load a Book"}
      closeLabel={panel() === "same-file" || refused() ? "Close" : "Cancel"}
      placement={props.placement}
      tall
    >
      <Show when={props.review}>
        {(review) => (
          <div class="review">
            <Show
              when={review().title}
              fallback={
                <div class="review-book">
                  <h3 class="review-file">{props.fileName}</h3>
                  <p>Not read further</p>
                </div>
              }
            >
              <div class="review-book">
                <h3>{review().title}</h3>
                <p>
                  {languageName(review().language)} ·{" "}
                  <span class="num">{count(review().songCount)}</span>{" "}
                  {review().songCount === 1 ? "song" : "songs"}
                </p>
              </div>
              <dl class="facts">
                <dt>Language</dt>
                <dd>
                  {languageName(review().language)}{" "}
                  <span class="facts-code">
                    ({review().language} · {review().script})
                  </span>
                </dd>
                <dt>Origin</dt>
                <dd>{review().origin}</dd>
                <dt>File</dt>
                <dd>
                  <span class="hash">sha-256 · {shortHash(review().sourceHash)}</span>
                </dd>
                {/* ADR-0029, later: a last row, "Source check · Not checked against a
                    source", sits here when the book was loaded without one. */}
              </dl>
            </Show>

            <Switch>
              <Match when={panel() === "not-a-book"}>
                <Callout icon="icon-error" tone="bad">
                  <h4>This isn’t a hymnbook file</h4>
                  <p>
                    Hymnal loads <b>.hymnbook.json.gz</b> files made by the importer. To turn slides
                    or a PDF into one, use the importer first.
                  </p>
                </Callout>
              </Match>
              <Match when={panel() === "newer"}>
                <Callout icon="icon-update" tone="bad">
                  <h4>This book needs a newer app</h4>
                  <p>
                    {review().violations[0]?.message.replace(/^this book needs a newer app: /, "")}.
                  </p>
                  <p>Update Hymnal, then load the file again.</p>
                </Callout>
              </Match>
              <Match when={panel() === "violations"}>
                <Callout icon="icon-error" tone="bad">
                  <h4>This book can’t be loaded</h4>
                  <p>
                    It breaks {count(review().violations.length)}{" "}
                    {review().violations.length === 1 ? "rule" : "rules"} of the format, listed
                    below. Nothing is repaired or stored. Fix the book where it was made and load
                    the file again.
                  </p>
                </Callout>
                <ul class="violations" aria-label="Violations">
                  <For each={review().violations}>
                    {(v) => (
                      <li class="violation">
                        <span class="vwhere">{v.where}</span>
                        <span class="vrule">{v.rule}</span>
                        <span>{v.message}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Match>
              <Match when={panel() === "restore"}>
                <Callout icon="icon-history" tone="new">
                  <h4>Brings a book back</h4>
                  <p>
                    This file replaces <b>{review().restore?.title}</b>, which couldn’t be opened.
                    It keeps its place: its Recents and position still point at it.
                  </p>
                </Callout>
                <Show when={review().restore?.titleMatches === false}>
                  <Callout icon="icon-warning" tone="bad">
                    <h4>Not the same title</h4>
                    <p>
                      This file is called <b>{review().title}</b>; the book it replaces was called{" "}
                      <b>{review().restore?.title}</b>. Check that it is the right file.
                    </p>
                  </Callout>
                </Show>
                {heldNote(review())}
              </Match>
              <Match when={panel() === "same-file"}>
                <Callout icon="icon-content-copy">
                  <h4>You already have this file</h4>
                  <p>
                    It is already in the Library as <b>{heldTitle(review())}</b>. Nothing will be
                    written.
                  </p>
                </Callout>
              </Match>
              <Match when={panel() === "same-songs"}>
                <Callout icon="icon-content-copy">
                  <h4>You already hold these songs</h4>
                  <p>
                    Every song matches <b>{heldTitle(review())}</b>, loaded from a different file
                    (repacked, perhaps). No second copy is made.
                  </p>
                  <p>Opening records this file, so the next pick is recognised at once.</p>
                </Callout>
              </Match>
              <Match when={origin()}>
                {(verdict) => (
                  <>
                    <Callout icon="icon-difference">
                      <h4>
                        {verdict().books.length === 1
                          ? "Another edition of a book you hold"
                          : "Another edition of books you hold"}
                      </h4>
                      <p>
                        {verdict().books.length === 1 ? (
                          <>
                            The file says it is the same book as <b>{verdict().books[0]?.title}</b>,
                            but its songs differ.
                          </>
                        ) : (
                          <>
                            {verdict().books.length} books on this device share this file’s origin.
                            Replace only ever touches one.
                          </>
                        )}
                      </p>
                    </Callout>
                    <fieldset class="options">
                      <legend class="visually-hidden">What to do</legend>
                      <label class="option">
                        <input
                          type="radio"
                          name="choice"
                          checked={replace() === undefined}
                          onChange={() => setReplace(undefined)}
                        />
                        <span>
                          <strong>Keep both</strong>
                          <small>
                            Loads this as another book. Each has its own place in Recents, and
                            either can be removed later.
                          </small>
                        </span>
                      </label>
                      <For each={verdict().books}>
                        {(book) => (
                          <label class="option" classList={{ "option-off": !book.replaceable }}>
                            <input
                              type="radio"
                              name="choice"
                              disabled={!book.replaceable}
                              checked={replace() === book.key}
                              onChange={() => setReplace(book.key)}
                            />
                            <span>
                              <strong>
                                Replace {book.title}
                                {book.replaceable ? "" : " (shipped)"}
                              </strong>
                              <small>
                                {book.replaceable
                                  ? "Swaps in this file’s songs and keeps the book’s place: its Recents and position still point at it. The old file is no longer recognised as held, so loading it again is another edition."
                                  : "Shipped with the app, which would put its copy back. Not offered."}
                              </small>
                            </span>
                          </label>
                        )}
                      </For>
                    </fieldset>
                    <Show when={replace() !== undefined}>
                      <Callout icon="icon-info" tone="quiet">
                        Replace can’t be undone. Keep the old file if you may want it back.
                      </Callout>
                    </Show>
                    {heldNote(review())}
                  </>
                )}
              </Match>
              <Match when={panel() === "new"}>
                <Callout icon="icon-check-circle" tone="new">
                  <h4>A new book</h4>
                  <p>Nothing like it is on this device. Loading adds it to the Library.</p>
                </Callout>
                {heldNote(review())}
              </Match>
            </Switch>

            <Show when={props.error}>
              <p class="review-error" role="alert">
                {props.error}
              </p>
            </Show>

            <div class="review-actions">
              <Show
                when={!refused()}
                fallback={
                  <button type="button" class="btn-tonal" onClick={props.onChooseAnother}>
                    Choose Another File
                  </button>
                }
              >
                <button
                  type="button"
                  class="btn-filled"
                  disabled={props.busy}
                  onClick={() => props.onCommit(choice())}
                >
                  <Switch>
                    <Match when={panel() === "same-file" || panel() === "same-songs"}>
                      Open Book
                    </Match>
                    <Match when={panel() === "restore"}>Restore Book</Match>
                    <Match when={panel() === "same-origin"}>
                      <SwapLabel
                        labels={["Keep Both", "Replace"]}
                        current={replace() === undefined ? "Keep Both" : "Replace"}
                      />
                    </Match>
                    <Match when={true}>Load Book</Match>
                  </Switch>
                </button>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </Sheet>
  );
}
