import { Show } from "solid-js";
import { Sheet } from "../shell/Sheet.tsx";
import { count, languageName, type RowState } from "./books.ts";

export interface RemoveTarget {
  key: string;
  title: string;
  language: string;
  songs: number;
  state: RowState;
}

export interface RemoveSheetProps {
  open: boolean;
  /** The book to remove; kept while the sheet sinks away. */
  book?: RemoveTarget;
  /** How many songs of it are in Recents, which go with it. */
  recents: number;
  /** The book that becomes current if this one is, or none. */
  nextTitle?: string;
  current: boolean;
  /** The hymn on screen is from this book. */
  presented: boolean;
  /** ...and the Output is live: removing it is refused until the Output is closed. */
  onOutput: boolean;
  busy: boolean;
  error?: string;
  placement: "bottom" | "center";
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Remove, after a confirmation that names the book (SDD-0004 §9): what goes,
 * and what does not. A shipped book never gets here.
 */
export function RemoveSheet(props: RemoveSheetProps) {
  return (
    <Sheet
      open={props.open}
      onClose={props.onCancel}
      title="Remove Book"
      placement={props.placement}
      closeLabel="Cancel"
      tall
    >
      <Show when={props.book}>
        {(book) => (
          <div class="review">
            <div class="review-book">
              <h3>{book().title}</h3>
              <Show when={book().state === "ok"}>
                <p>
                  {languageName(book().language)} · <span class="num">{count(book().songs)}</span>{" "}
                  {book().songs === 1 ? "song" : "songs"}
                </p>
              </Show>
            </div>
            <div>
              <div class="title-medium remove-heading">This removes</div>
              <ul class="drops">
                <li class="drop">
                  <span class="icon icon-library" aria-hidden="true" />
                  <span>
                    {book().state === "ok"
                      ? `The book: its ${count(book().songs)} ${book().songs === 1 ? "song" : "songs"} leave this device.`
                      : "The book: its stored file leaves this device."}
                  </span>
                </li>
                <li class="drop">
                  <span class="icon icon-history" aria-hidden="true" />
                  <span>
                    {props.recents === 0
                      ? "Its Recents: none."
                      : `Its Recents: ${props.recents} ${props.recents === 1 ? "song" : "songs"} you opened.`}
                  </span>
                </li>
              </ul>
            </div>
            <div class="callout">
              <span class="icon icon-info" aria-hidden="true" />
              <div>
                <p>
                  Your file isn’t touched. Load it again and the book returns, but not its Recents.
                  A book has no other copy, so keep the file if you may want it.
                </p>
                <Show when={props.presented && !props.onOutput}>
                  <p>
                    The song on screen is from this book. It goes with the book, and the Operator
                    returns to the Finder.
                  </p>
                </Show>
                <Show when={props.current}>
                  <p>
                    Searches look in this book now.{" "}
                    {props.nextTitle ? (
                      <>
                        After it goes, they look in <b>{props.nextTitle}</b>.
                      </>
                    ) : (
                      "After it goes there is nothing to search until you load another book."
                    )}
                  </p>
                </Show>
              </div>
            </div>
            <Show when={props.onOutput}>
              <p class="review-error" role="alert">
                This book is on the Output now. Close the Output first, then remove it.
              </p>
            </Show>
            <Show when={props.error}>
              <p class="review-error" role="alert">
                {props.error}
              </p>
            </Show>
            <div class="review-actions">
              <button
                type="button"
                class="btn-filled btn-danger"
                disabled={props.busy || props.onOutput}
                onClick={props.onConfirm}
              >
                Remove Book
              </button>
            </div>
          </div>
        )}
      </Show>
    </Sheet>
  );
}
