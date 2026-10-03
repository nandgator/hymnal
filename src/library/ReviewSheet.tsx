import {
  createEffect,
  createSignal,
  For,
  type JSX,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import type { SourceCheck } from "../import/sourcecheck.ts";
import type { Choice, LoadReview } from "../persistence/content-store.ts";
import { ProgressBar } from "../shell/Loading.tsx";
import { Sheet } from "../shell/Sheet.tsx";
import { SwapLabel } from "../shell/SwapLabel.tsx";
import { selectGlide } from "../shell/selectGlide.ts";
import { count, languageName, shortHash } from "./books.ts";
import type { QueuePosition } from "./Library.tsx";
import type { SourceState } from "./textbook.ts";

export interface ReviewSheetProps {
  open: boolean;
  /** The review to show; kept while the sheet sinks away. */
  review?: LoadReview;
  /** The picked file's name, for what is refused before it can name itself. */
  fileName: string;
  /** What went wrong committing, in words; the review stays so the choice can be made again. */
  error?: string;
  busy: boolean;
  /** The review shown is being read again: it cannot be committed (its token is old) but can be left. */
  refreshing?: boolean;
  /** The book was made from song text (ADR-0029): its source check, and "back" means the text. */
  source?: SourceState;
  /** Several files were picked: which one this is, and where Back and Next lead. */
  position?: QueuePosition;
  /** A book's file is being read in the open sheet: its name, in place of the review. */
  reading?: string;
  /** Files of the queue that could not be read, each said in words. */
  problems?: string[];
  placement: "bottom" | "center";
  onCancel: () => void;
  /** The queue's previous and next book; what was decided here stays as it is. */
  onBack?: () => void;
  onNext?: () => void;
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

const differences = (check: SourceCheck) => check.added.length + check.dropped.length;

/** The facts row: not checked, no differences, or how many lines differ. */
const sourceSummary = (source: SourceState) => {
  if (source.kind === "none") return "Not checked against a source";
  const n = differences(source.check);
  return n === 0 ? "Checked against a source: no differences" : `Checked: ${count(n)} to look at`;
};

/** What the book added or dropped against its source: a list to read, never a verdict (ADR-0029). */
const SourceDiffs = (props: { check: SourceCheck }) => (
  <section class="diffs" aria-label="Source check">
    <Callout icon="icon-difference">
      <h4>The book differs from its source</h4>
      <p>
        The check only lists; it can’t tell a dropped stanza from a deliberate cut. Read each line,
        and if one is wrong, fix the text and review it again. In a book of several songs, locations
        are approximate.
      </p>
    </Callout>
    <Show when={props.check.added.length > 0}>
      <h4 class="diffs-head">
        Added or altered <span class="num">({count(props.check.added.length)})</span>
      </h4>
      <ul class="violations diff-list" aria-label="Lines not in the source">
        <For each={props.check.added}>
          {(a) => (
            <li class="violation violation-line">
              <span class="vwhere num">
                {a.part ? `Hymn ${a.hymn}, ${a.part}, line ${a.line}` : `Hymn ${a.hymn}, title`}
              </span>
              <span class="diff-text">{a.text}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
    <Show when={props.check.dropped.length > 0}>
      <h4 class="diffs-head">
        Dropped <span class="num">({count(props.check.dropped.length)})</span>
      </h4>
      <ul class="violations diff-list" aria-label="Lines not in the book">
        <For each={props.check.dropped}>
          {(d) => (
            <li class="violation violation-line">
              <span class="vwhere num">Source line {d.line}</span>
              <span class="diff-text">{d.text}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  </section>
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
  const sourceDiffs = () => {
    const source = props.source;
    return source?.kind === "checked" && differences(source.check) > 0 ? source.check : undefined;
  };
  const queued = () => {
    const at = props.position;
    return at && at.total > 1 ? at : undefined;
  };
  // Left and Right step through the queue, except where they already mean something
  // (the radios of a choice).
  const onKeyDown = (event: KeyboardEvent) => {
    if (!queued() || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey)
      return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    if (event.key === "ArrowLeft") props.onBack?.();
    else if (event.key === "ArrowRight") props.onNext?.();
    else return;
    event.preventDefault();
  };
  // A button that goes disabled under the focus (Next on the last book, Load Book while it
  // writes) drops it to the page, and the arrow keys with it: it goes to Back or Next, else
  // to the review itself.
  let root: HTMLDivElement | undefined;
  const rescueFocus = () => {
    if (!root?.isConnected || !props.open) return;
    const at = document.activeElement as HTMLButtonElement | null;
    if (at && at !== document.body && !at.disabled) return;
    const nav = [...root.querySelectorAll<HTMLButtonElement>(".review-queue button")];
    (nav.find((button) => !button.disabled) ?? root).focus({ preventScroll: true });
  };
  createEffect(() => {
    void [props.position, props.busy, props.refreshing, props.reading, props.review];
    queueMicrotask(rescueFocus);
    requestAnimationFrame(rescueFocus);
  });
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
      title={panel() === "restore" ? "Load Again" : "Load Books"}
      closeLabel={panel() === "same-file" || refused() || queued() ? "Close" : "Cancel"}
      placement={props.placement}
      tall
    >
      <Show when={props.review}>
        {(review) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: Left and Right bubble up from the controls inside
          <div class="review" ref={root} tabIndex={-1} onKeyDown={onKeyDown}>
            <Show when={queued()}>
              {(at) => (
                <div class="review-queue">
                  <button
                    type="button"
                    class="btn-text icon-button"
                    aria-label="Previous book"
                    disabled={!at().canBack || props.busy}
                    onClick={props.onBack}
                  >
                    <span class="icon icon-chevron-left" aria-hidden="true" />
                  </button>
                  <p class="review-position">
                    <b class="num">
                      Book {at().index} of {at().total}
                    </b>
                    <Show when={at().loaded}>
                      <span class="review-position-loaded">Loaded</span>
                    </Show>
                    <span class="review-position-file">{props.reading ?? props.fileName}</span>
                  </p>
                  <button
                    type="button"
                    class="btn-text icon-button"
                    aria-label="Next book"
                    disabled={!at().canNext || props.busy}
                    onClick={props.onNext}
                  >
                    <span class="icon icon-chevron-right" aria-hidden="true" />
                  </button>
                </div>
              )}
            </Show>
            <Show when={(props.problems?.length ?? 0) > 0}>
              <ul class="review-problems" aria-label="Files not read">
                <For each={props.problems}>{(message) => <li>{message}</li>}</For>
              </ul>
            </Show>
            <Show
              when={!props.reading}
              fallback={
                <div class="review-book">
                  <h3 class="review-file">{props.reading}</h3>
                  <p>Checking the file on this device. Nothing is sent anywhere.</p>
                  <ProgressBar label="Reading the book" />
                </div>
              }
            >
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
                  <Show when={props.source}>
                    {(source) => (
                      <>
                        <dt>Source check</dt>
                        <dd>{sourceSummary(source())}</dd>
                      </>
                    )}
                  </Show>
                </dl>
                <Show when={!refused() && sourceDiffs()}>
                  {(check) => <SourceDiffs check={check()} />}
                </Show>
              </Show>

              <Switch>
                <Match when={queued()?.loaded}>
                  <Callout icon="icon-check-circle" tone="new">
                    <h4>Loaded</h4>
                    <p>This book is in the Library now.</p>
                  </Callout>
                </Match>
                <Match when={panel() === "not-a-book"}>
                  <Callout icon="icon-error" tone="bad">
                    <h4>This isn’t a hymnbook file</h4>
                    <p>
                      Hymnal loads <b>.hymnbook.json.gz</b> files made by the importer. To turn
                      slides or a PDF into one, use the importer first.
                    </p>
                  </Callout>
                </Match>
                <Match when={panel() === "newer"}>
                  <Callout icon="icon-update" tone="bad">
                    <h4>This book needs a newer app</h4>
                    <p>
                      {review().violations[0]?.message.replace(
                        /^this book needs a newer app: /,
                        "",
                      )}
                      .
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
                              The file says it is the same book as{" "}
                              <b>{verdict().books[0]?.title}</b>, but its songs differ.
                            </>
                          ) : (
                            <>
                              {verdict().books.length} books on this device share this file’s
                              origin. Replace only ever touches one.
                            </>
                          )}
                        </p>
                      </Callout>
                      <fieldset
                        class="options"
                        ref={(el) => {
                          // The chosen option is one pill that glides to the next
                          // choice; the radios stay native.
                          const pill = selectGlide(el, {
                            current: ".option input:checked",
                            target: (input) => input.closest<HTMLElement>(".option"),
                          });
                          onCleanup(pill.stop);
                          createEffect(() => {
                            replace();
                            queueMicrotask(pill.sync);
                          });
                        }}
                      >
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
                  when={!queued()?.loaded}
                  fallback={
                    <button type="button" class="btn-tonal" disabled>
                      <span class="icon icon-check" aria-hidden="true" />
                      Loaded
                    </button>
                  }
                >
                  <Show
                    when={!refused()}
                    fallback={
                      <button type="button" class="btn-tonal" onClick={props.onChooseAnother}>
                        {props.source ? "Edit the Text" : "Choose Another File"}
                      </button>
                    }
                  >
                    <button
                      type="button"
                      class="btn-filled"
                      disabled={props.busy || props.refreshing}
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
                </Show>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </Sheet>
  );
}
