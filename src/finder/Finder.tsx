import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from "solid-js";
import type { HymnbookId, HymnNumber } from "../domain/types.ts";
import {
  type ContentStore,
  getContentStore,
  type SearchResult,
} from "../persistence/content-store.ts";
import type { UserState } from "../persistence/user-state.ts";
import { titleCase } from "../shell/case.ts";
import { type GlideList, glideList } from "../shell/glideList.ts";
import { hoverButton } from "../shell/hoverGlide.ts";
import { RecentsList } from "../shell/RecentsList.tsx";

/** How long typing must pause before a lyric search runs. */
const LYRIC_DEBOUNCE_MS = 200;
/** Number suggestions shown at most. */
const NUMBER_SUGGESTIONS = 8;
/** How many of the book's first songs show while nothing is typed. */
export const OPENING_SONGS = 20;
/** Matches the quick switcher lists at most. */
const COMPACT_ROWS = 5;

export interface FinderProps {
  /** The book searched: its key (SDD-0004 §10). */
  hymnbookId: HymnbookId;
  /** The book's title, said under the field so it is plain which book is searched. */
  bookTitle?: string;
  /** Defaults to {@link getContentStore}; overridable for tests. */
  store?: ContentStore;
  /** Defaults to the {@link defaultUserState} singleton; overridable for tests. */
  userState?: UserState;
  /** Called with the chosen hymn number — number lookup, a search result, or a recent. */
  onSelect: (number: HymnNumber) => void;
  /** The hymn up now, marked in Recents. */
  current?: HymnNumber;
  /** Called when the user wants to go back to hymnbook selection. */
  onBack?: () => void;
  /** Actions listed ahead of the hymns — this makes the Finder the command
   * menu (SDD-0001 §16.5). */
  commands?: Command[];
  /** The quick switcher over a presenting screen (SDD-0001 §16.7): a few
   * matches for a number or words, nothing else — no recents, no opening
   * songs — and only a song that exists is opened. */
  compact?: boolean;
  /** What the box starts with, e.g. the digit that opened the switcher. */
  initialQuery?: string;
}

/** An action in the command menu. */
export interface Command {
  label: string;
  /** Its keyboard shortcut, shown at the row's end. */
  hint?: string;
  run: () => void;
}

/** One row in the live results list. */
interface Option {
  number: HymnNumber;
  title: string;
  /** The matched lyric line, when it adds something beyond the title. */
  snippet?: string;
}

/** One row in the listbox: an action, or a hymn. */
type Row = { kind: "command"; command: Command } | { kind: "hymn"; option: Option };

let nextId = 0;

/** Whether every word typed starts a word of the label: "bl" and "blank
 * out" both find "Blank the Output". A number never matches, so the fast
 * path — a number, Enter — still opens a hymn. */
function matchesCommand(label: string, query: string): boolean {
  const words = label.toLowerCase().split(/\s+/);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((typed) => words.some((word) => word.startsWith(typed)));
}

/**
 * Board #8 — retrieval by number and by lyric text, plus recents (arc42
 * §5.1). Board #12 made it search as you type (SDD-0001 §13): an ARIA
 * combobox over a live results list, with the fast path intact — type a
 * number, Enter, done. Picking a hymn hands its number to `onSelect` and
 * nothing else: opening it, and recording it as recent, is Presenter's job.
 */
export function Finder(props: FinderProps) {
  const id = () => props.hymnbookId;
  const store = () => props.store ?? getContentStore();
  const listId = `finder-options-${++nextId}`;

  // Keyed by the book, so another book is read again; until it is, nothing of
  // the last book's shows.
  const [read] = createResource(id, (book) => store().listHymns(book));
  const hymns = () => (read.loading ? undefined : read());
  // The book from its start, by number, while nothing is typed: there is
  // always something to open (SDD-0001 §13).
  const opening = createMemo(() =>
    [...(hymns() ?? [])].sort((a, b) => a.number - b.number).slice(0, OPENING_SONGS),
  );
  // How many recents there are, once known; the list reports it.
  const [recentCount, setRecentCount] = createSignal<number>();
  // Another book: its recents are not known yet, and nothing of the last one's shows.
  createEffect(on(id, () => setRecentCount(undefined), { defer: true }));
  // The songs are in the list's place until it is known that there are none, and both lists
  // appear together once both are read, so neither moves the other.
  const songsExpected = () => read.loading || opening().length > 0;
  const songsShown = () =>
    !props.compact && !trimmed() && opening().length > 0 && recentCount() !== undefined;

  const [query, setQuery] = createSignal(props.initialQuery ?? "");
  const trimmed = () => query().trim();
  const isNumber = () => /^\d+$/.test(trimmed());

  // Lyric search runs once typing pauses — or at once, on Enter.
  const [lyricQuery, setLyricQuery] = createSignal("");
  let debounce: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const text = trimmed();
    clearTimeout(debounce);
    if (!text || isNumber()) {
      setLyricQuery("");
      return;
    }
    debounce = setTimeout(() => setLyricQuery(text), LYRIC_DEBOUNCE_MS);
  });
  onCleanup(() => clearTimeout(debounce));

  const [lyricResults] = createResource(
    lyricQuery,
    (text): Promise<SearchResult[]> =>
      text ? store().searchLyrics(id(), text) : Promise.resolve([]),
  );

  const options = createMemo((): Option[] => {
    if (isNumber()) {
      const typed = trimmed();
      const all = hymns() ?? [];
      const exact = all.filter((hymn) => String(hymn.number) === typed);
      const prefixed = all.filter(
        (hymn) => String(hymn.number).startsWith(typed) && String(hymn.number) !== typed,
      );
      return [...exact, ...prefixed].slice(0, props.compact ? COMPACT_ROWS : NUMBER_SUGGESTIONS);
    }
    if (!lyricQuery()) return [];
    // `latest` keeps the previous results up while the next load.
    return (lyricResults.latest ?? [])
      .slice(0, props.compact ? COMPACT_ROWS : undefined)
      .map((result) => ({
        number: result.number,
        title: result.title,
        // The matched line is often the first line, which is the title.
        snippet: result.snippet !== result.title ? result.snippet : undefined,
      }));
  });

  const rows = createMemo((): Row[] => [
    ...(props.commands ?? [])
      .filter((command) => !isNumber() && matchesCommand(command.label, trimmed()))
      .map((command) => ({ kind: "command" as const, command })),
    ...options().map((option) => ({ kind: "hymn" as const, option })),
  ]);

  // The highlight is Enter's target: the top match as you type, a row the
  // arrows reach, or the row under a moving pointer. A pointer leaving
  // takes its highlight with it, rather than it staying behind or jumping
  // elsewhere; Enter then takes the top match (DESIGN.md § States).
  const [active, setActiveIndex] = createSignal<number>();
  const setActive = (step: (index: number) => number) => setActiveIndex(step(active() ?? -1));
  createEffect(() => {
    rows();
    setActiveIndex(trimmed() ? 0 : undefined);
  });

  const pick = (row: Row) =>
    row.kind === "command" ? row.command.run() : props.onSelect(row.option.number);

  const noMatch = () =>
    !isNumber() && !!lyricQuery() && lyricResults.state === "ready" && lyricResults().length === 0;

  const choose = () => {
    const row = rows()[active() ?? 0];
    if (row) return pick(row);
    // A number with no suggestion still opens — Presenter reports it if no
    // such hymn exists.
    if (isNumber() && !props.compact) return props.onSelect(Number(trimmed()));
    if (trimmed() && !isNumber()) setLyricQuery(trimmed());
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const count = rows().length;
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      setActive((i) => (i + 1) % count);
    } else if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      setActive((i) => (i < 0 ? count - 1 : (i - 1 + count) % count));
    } else if (event.key === "Escape" && query() && !props.compact) {
      // Clear first; a second Escape reaches the sheet and closes it.
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    }
  };

  const optionId = (index: number) => `${listId}-${index}`;

  // The highlight is Enter's target: the one layer follows the active
  // option, so the arrow keys and the top match move it as the pointer does.
  let glide: GlideList | undefined;
  let results: HTMLDivElement | undefined;
  createEffect(() => {
    active();
    rows();
    // After the rows have settled: a microtask on, the DOM is what to mark.
    queueMicrotask(() =>
      glide?.hover.show(results?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null),
    );
  });

  return (
    <div class="finder">
      <Show when={props.onBack}>
        <button
          type="button"
          class="btn-text back-button"
          ref={(el) => onCleanup(hoverButton(el))}
          onClick={() => props.onBack?.()}
        >
          <span class="icon icon-arrow-back" aria-hidden="true" />
          Back to hymnbooks
        </button>
      </Show>
      <form
        class="finder-form"
        onSubmit={(event) => {
          event.preventDefault();
          choose();
        }}
      >
        <div class="text-field">
          <input
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={rows().length > 0}
            aria-controls={listId}
            aria-activedescendant={active() == null ? undefined : optionId(active() ?? 0)}
            ref={(el) =>
              // Opened over nothing (a book chosen in the Library), the next key typed is a
              // search, with a keyboard to type on. Not where a screen keyboard would cover
              // the songs: a touch screen taps the field. A sheet, or a control already
              // focused, keeps its own focus.
              queueMicrotask(() => {
                const at = document.activeElement;
                const keyboard = window.matchMedia?.("(pointer: fine)").matches ?? true;
                if (keyboard && el.isConnected && (!at || at === document.body))
                  el.focus({ preventScroll: true });
              })
            }
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            // In a sheet (the hymn picker, the command menu) the box takes
            // focus on open, not the sheet's Close button.
            autofocus
            // No Find button: results show as you type, and Enter (or a
            // phone keyboard's Search key) submits (DESIGN.md § Structure).
            enterkeyhint="search"
            placeholder={props.commands ? "Song number, lyrics or action" : "Song number or lyrics"}
            aria-label={props.commands ? "Find a song or action" : "Find a song"}
            aria-describedby={props.bookTitle ? `${listId}-scope` : undefined}
          />
        </div>
        <Show when={props.bookTitle}>
          {(title) => (
            <p class="finder-scope body-medium on-surface-variant" id={`${listId}-scope`}>
              Searching <b>{title()}</b>
            </p>
          )}
        </Show>
      </form>

      <Show when={noMatch()}>
        <p class="body-large">No matches for "{lyricQuery()}".</p>
      </Show>

      {/* Keyboard reaches the options through the input's
          aria-activedescendant (the ARIA combobox pattern), not focus. */}
      <div
        id={listId}
        class="list glide-list"
        role="listbox"
        aria-label={props.commands ? "Matching songs and actions" : "Matching songs"}
        onMouseLeave={() => setActiveIndex(undefined)}
        ref={(el) => {
          results = el;
          glide = glideList(el, { rows: ".finder-option" });
          onCleanup(glide.stop);
        }}
      >
        <For each={rows()}>
          {(row, index) => (
            <div
              id={optionId(index())}
              role="option"
              tabIndex={-1}
              class="list-row finder-option"
              aria-selected={active() === index()}
              // mousemove, not mouseenter: a list appearing under a resting
              // pointer fires mouseenter without the pointer moving, and must
              // not steal the highlight from the top match — typing "121" then
              // Enter must open 121, not the row that landed under the mouse.
              onMouseMove={() => setActiveIndex(index())}
              // mousedown, not click: keeps focus in the box while choosing.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(row);
              }}
            >
              {row.kind === "command" ? (
                <>
                  <span class="finder-title">{row.command.label}</span>
                  <Show when={row.command.hint}>
                    {(hint) => <kbd class="key-hint">{hint()}</kbd>}
                  </Show>
                </>
              ) : (
                <>
                  <span class="finder-number">#{row.option.number}</span>
                  <span class="finder-title">
                    {titleCase(row.option.title)}
                    <Show when={row.option.snippet}>
                      {(snippet) => <span class="list-row-supporting"> — {snippet()}</span>}
                    </Show>
                  </span>
                </>
              )}
            </div>
          )}
        </For>
      </div>

      <Show when={!trimmed() && !props.compact}>
        {/* Recents is there while it has entries (or while there are no songs
            to show instead); its own count says which. */}
        <section hidden={recentCount() === undefined || (recentCount() === 0 && songsExpected())}>
          <h2 class="title-medium on-surface-variant">Recents</h2>
          <RecentsList
            hymnbookId={id()}
            current={props.current}
            store={props.store}
            userState={props.userState}
            onSelect={props.onSelect}
            quietWhenEmpty={songsExpected()}
            onCount={setRecentCount}
          />
        </section>
        <Show when={songsShown()}>
          <section aria-label="Songs">
            <h2 class="title-medium on-surface-variant">
              {(hymns()?.length ?? 0) > OPENING_SONGS ? "From the start" : "Songs"}
            </h2>
            <div
              class="recents"
              ref={(el) => onCleanup(glideList(el, { rows: ".recents-row" }).stop)}
            >
              <ul class="list finder-songs">
                <For each={opening()}>
                  {(hymn) => (
                    <li>
                      <button
                        type="button"
                        class="list-row recents-row"
                        aria-current={hymn.number === props.current ? "true" : undefined}
                        onClick={() => props.onSelect(hymn.number)}
                      >
                        <span class="recents-number">#{hymn.number}</span>
                        <span class="recents-title">{titleCase(hymn.title)}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </section>
        </Show>
      </Show>
    </div>
  );
}
