import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
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
import { RecentsList } from "../shell/RecentsList.tsx";

/** How long typing must pause before a lyric search runs. */
const LYRIC_DEBOUNCE_MS = 200;
/** Number suggestions shown at most. */
const NUMBER_SUGGESTIONS = 8;

export interface FinderProps {
  /** The book searched: its key (SDD-0004 §10). */
  hymnbookId: HymnbookId;
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

  const [hymns] = createResource(() => store().listHymns(id()));

  const [query, setQuery] = createSignal("");
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
      return [...exact, ...prefixed].slice(0, NUMBER_SUGGESTIONS);
    }
    if (!lyricQuery()) return [];
    // `latest` keeps the previous results up while the next load.
    return (lyricResults.latest ?? []).map((result) => ({
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
    if (isNumber()) return props.onSelect(Number(trimmed()));
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
    } else if (event.key === "Escape" && query()) {
      // Clear first; a second Escape reaches the sheet and closes it.
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    }
  };

  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <div class="finder">
      <Show when={props.onBack}>
        <button type="button" class="btn-text back-button" onClick={() => props.onBack?.()}>
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
          />
        </div>
      </form>

      <Show when={noMatch()}>
        <p class="body-large">No matches for "{lyricQuery()}".</p>
      </Show>

      {/* Keyboard reaches the options through the input's
          aria-activedescendant (the ARIA combobox pattern), not focus. */}
      <div
        id={listId}
        class="list"
        role="listbox"
        aria-label={props.commands ? "Matching songs and actions" : "Matching songs"}
        onMouseLeave={() => setActiveIndex(undefined)}
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

      <Show when={!trimmed()}>
        <section>
          <h2 class="title-medium on-surface-variant">Recents</h2>
          <RecentsList
            hymnbookId={id()}
            current={props.current}
            store={props.store}
            userState={props.userState}
            onSelect={props.onSelect}
          />
        </section>
      </Show>
    </div>
  );
}
