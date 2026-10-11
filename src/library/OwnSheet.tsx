import { createSignal, For, onCleanup, Show } from "solid-js";
import { glideList } from "../shell/glideList.ts";
import { Sheet } from "../shell/Sheet.tsx";
import { count, languageName } from "./books.ts";

/** One song of a book of yours, as the Finder lists it (`listHymns`). */
export interface OwnSong {
  number: number;
  title: string;
  language?: string;
}

export interface OwnSheetProps {
  open: boolean;
  /** The book's title, which is the sheet's. */
  title: string;
  /** The title is being edited, on a second page. */
  renaming?: boolean;
  /** Why the rename was refused, in words. */
  renameError?: string;
  /** The songs in the order `listHymns` gives them; undefined while they are read. */
  songs?: OwnSong[];
  /** Why the songs could not be read, in words. */
  problem?: string;
  /** The song whose removal is being confirmed; kept while its page slides away. */
  removing?: OwnSong;
  /** How many of the removing song's entries are in Recents, which go with it. */
  recents: number;
  /** The removing song is the only one left, so the book goes with it. */
  last: boolean;
  /** The removing song is on screen. */
  presented: boolean;
  /** ...and the Output is live: removing it is refused until the Output is closed. */
  onOutput: boolean;
  onEndLive?: () => void;
  busy: boolean;
  error?: string;
  placement: "bottom" | "center";
  onClose: () => void;
  onAskRename: () => void;
  onRename: (title: string) => void;
  onOpenSong: (number: number) => void;
  onAskRemove: (song: OwnSong) => void;
  /** Back from the confirmation, to the list. */
  onBack: () => void;
  onConfirm: () => void;
}

/**
 * The songs of a book of yours, in the order it lists them (SDD-0004 §17), each
 * with Remove, and Rename for the book (ADR-0033). Remove asks first, on a page
 * inside the sheet, as removing a book does; Rename takes the new title on another.
 */
export function OwnSheet(props: OwnSheetProps) {
  const confirm = (song: OwnSong) => (
    <div class="review">
      <div class="review-book">
        <h3>{song.title}</h3>
        <p>
          <Show when={song.language}>{(code) => <>{languageName(code())} · </>}</Show>
          <span class="num">#{song.number}</span>
        </p>
      </div>
      <div>
        <div class="title-medium remove-heading">This removes</div>
        <ul class="drops">
          <li class="drop">
            <span class="icon icon-library" aria-hidden="true" />
            <span>
              {props.last
                ? "The song, which is the last one: the book goes with it."
                : "The song: its words leave this device."}
            </span>
          </li>
          <li class="drop">
            <span class="icon icon-history" aria-hidden="true" />
            <span>
              {props.recents === 0
                ? "Its Recents: none."
                : `Its Recents: ${count(props.recents)} ${props.recents === 1 ? "entry" : "entries"}.`}
            </span>
          </li>
        </ul>
      </div>
      <div class="callout">
        <span class="icon icon-info" aria-hidden="true" />
        <div>
          <p>
            Number {song.number} is retired with it and is never given to another song. To get it
            back, add the text again: it is a new song, with a new number.
          </p>
          <Show when={props.presented && !props.onOutput}>
            <p>This song is on screen. It goes, and the Operator returns to the Finder.</p>
          </Show>
        </div>
      </div>
      <Show when={props.onOutput}>
        <p class="review-error" role="alert">
          This song is on the Output now. End Live first, then remove it.
        </p>
        <Show when={props.onEndLive}>
          <div class="review-actions">
            <button type="button" class="btn-tonal" onClick={() => props.onEndLive?.()}>
              End Live
            </button>
          </div>
        </Show>
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
          Remove Song
        </button>
      </div>
    </div>
  );

  const rename = () => {
    const [draft, setDraft] = createSignal(props.title);
    // The page is mounted afresh each time it opens: the title as it is now.
    const changed = () => draft().trim() !== "" && draft().trim() !== props.title;
    return (
      <form
        class="review"
        novalidate
        onSubmit={(event) => {
          event.preventDefault();
          if (changed() && !props.busy) props.onRename(draft().trim());
        }}
      >
        <div class="field">
          <label class="field-label" for="own-title">
            Title
          </label>
          <input
            id="own-title"
            class="field-input"
            type="text"
            autocomplete="off"
            value={draft()}
            aria-invalid={!!props.renameError}
            aria-describedby={props.renameError ? "own-title-problem" : undefined}
            onInput={(e) => setDraft(e.currentTarget.value)}
            autofocus
          />
          <Show when={props.renameError}>
            <span class="field-hint field-problem" id="own-title-problem" role="alert">
              {props.renameError}
            </span>
          </Show>
        </div>
        <div class="review-actions">
          <button type="submit" class="btn-filled" disabled={props.busy || !changed()}>
            Rename Book
          </button>
        </div>
      </form>
    );
  };

  /** The page that asks, fixed to the song it was opened for: it outlasts `removing` while it slides away. */
  const confirmPageFor = (song: OwnSong) => () => confirm(song);

  return (
    <Sheet
      open={props.open}
      onClose={() => !props.busy && props.onClose()}
      title={props.title}
      closeLabel="Close"
      placement={props.placement}
      tall
      page={
        props.removing
          ? {
              id: "remove",
              title: "Remove Song",
              // The song as it is asked: the page outlasts `removing` while it slides away.
              content: confirmPageFor(props.removing),
            }
          : props.renaming
            ? { id: "rename", title: "Rename Book", content: rename }
            : undefined
      }
      onBack={() => !props.busy && props.onBack()}
    >
      <div class="review">
        <div class="review-actions">
          <button type="button" class="btn-tonal" disabled={props.busy} onClick={props.onAskRename}>
            Rename
          </button>
        </div>
        <Show when={props.problem}>
          <p class="review-error" role="alert">
            {props.problem}
          </p>
        </Show>
        <Show
          when={props.songs}
          fallback={
            <Show when={!props.problem}>
              <p class="body-medium on-surface-variant" role="status">
                Reading the songs…
              </p>
            </Show>
          }
        >
          {(songs) => (
            <ul
              class="book-list"
              aria-label="Songs"
              ref={(el) =>
                onCleanup(
                  glideList(el, {
                    rows: "li.book",
                  }).stop,
                )
              }
            >
              <For each={songs()}>
                {(song) => (
                  <li class="book" data-song={song.number}>
                    <button
                      type="button"
                      class="book-main"
                      aria-label={`Open ${song.title}`}
                      onClick={() => props.onOpenSong(song.number)}
                    >
                      <span class="book-tile num">{song.number}</span>
                      <span class="book-text">
                        <span class="book-title">{song.title}</span>
                        <Show when={song.language}>
                          {(code) => <span class="book-meta">{languageName(code())}</span>}
                        </Show>
                      </span>
                      <span />
                    </button>
                    <button
                      type="button"
                      class="btn-text"
                      aria-label={`Remove ${song.title}`}
                      disabled={props.busy}
                      onClick={() => props.onAskRemove(song)}
                    >
                      Remove
                    </button>
                  </li>
                )}
              </For>
            </ul>
          )}
        </Show>
      </div>
    </Sheet>
  );
}
