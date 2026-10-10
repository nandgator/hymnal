import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
} from "solid-js";
import type { HymnbookId, HymnNumber } from "../domain/types.ts";
import { type ContentStore, getContentStore } from "../persistence/content-store.ts";
import type { UserState } from "../persistence/user-state.ts";
import { titleCase } from "../shell/case.ts";
import { type GlideList, glideList } from "../shell/glideList.ts";
import { hoverButton } from "../shell/hoverGlide.ts";
import { KeyCombo } from "../shell/KeyCombo.tsx";
import { RecentsList } from "../shell/RecentsList.tsx";
import {
  type FinderGroup,
  type FinderItem,
  type FinderSource,
  SOURCES,
  searchSources,
} from "./sources.ts";

/** How long typing must pause before a lyric search runs. */
const LYRIC_DEBOUNCE_MS = 200;
/** Number suggestions shown at most. */
const NUMBER_SUGGESTIONS = 8;
/** How many of the book's first songs show while nothing is typed. */
export const OPENING_SONGS = 20;
/** Matches the quick switcher lists at most, from one book. */
const COMPACT_ROWS = 5;
/** Matches the quick switcher lists from each book, when there are several. */
const COMPACT_GROUP_ROWS = 3;
/** Songs shown from a book that is not the current one, before More in. */
const GROUP_ROWS = 5;
/** A row leaving the switcher is gone by now, motion or none (its own
 * transition normally ends it first). */
const LEAVE_BACKSTOP_MS = 600;
/** The highlight follows moving rows for at most this long. */
const FOLLOW_MS = 800;

export interface FinderProps {
  /** The book searched: its key (SDD-0004 §10). */
  hymnbookId: HymnbookId;
  /** The book's title, said under the field so it is plain which book is searched. */
  bookTitle?: string;
  /** Defaults to {@link getContentStore}; overridable for tests. */
  store?: ContentStore;
  /** Defaults to the {@link defaultUserState} singleton; overridable for tests. */
  userState?: UserState;
  /** How many books are held: with several, a lyric search covers them all and
   * the results are grouped by book (SDD-0001 §13.1). */
  bookCount?: number;
  /** What is searched besides the commands. Defaults to {@link SOURCES}. */
  sources?: readonly FinderSource[];
  /** Called with the chosen hymn number and the book it is in — number lookup, a
   * search result, or a recent. */
  onSelect: (number: HymnNumber, book: HymnbookId) => void;
  /** The hymn up now, marked in Recents. */
  current?: HymnNumber;
  /** Changes when the stored recents were restored from a backup: Recents is read again. */
  recentsVersion?: number;
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

/** The group a row belongs to: the actions, or a source's group. */
interface GroupRef {
  id: string;
  title: string;
}

const COMMANDS_GROUP: GroupRef = { id: "commands", title: "Actions" };

/** One row in the listbox: an action, a hymn, or More in a book. */
type Row =
  | { kind: "command"; command: Command; group: GroupRef }
  | { kind: "hymn"; item: FinderItem; group: GroupRef }
  | { kind: "more"; group: GroupRef };

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
  // The list is in the order the book gives (`listHymns`): by number, except Assorted Hymns,
  // which lists its songs by language and title (SDD-0004 §17). The Finder keeps that order.
  const opening = createMemo(() => (hymns() ?? []).slice(0, OPENING_SONGS));
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

  // A lyric query goes to every source (ADR-0032): the books, each its own group.
  const [lyricResults] = createResource(
    lyricQuery,
    (text): Promise<FinderGroup[]> =>
      text
        ? searchSources(props.sources ?? SOURCES, text, { store: store(), currentKey: id() })
        : Promise.resolve([]),
  );

  // Several books held: the lyric results are grouped under their books' titles.
  const grouped = () => (props.bookCount ?? 1) > 1 && !isNumber();

  // While the next lyric search is pending (the pause before it, or its read)
  // the last results stay: only a result set that is empty empties the list.
  // A number is a suggestion in the current book alone: numbers are per book.
  const groups = createMemo((prev: FinderGroup[]): FinderGroup[] => {
    if (isNumber()) {
      const typed = trimmed();
      const all = hymns() ?? [];
      const exact = all.filter((hymn) => String(hymn.number) === typed);
      const prefixed = all.filter(
        (hymn) => String(hymn.number).startsWith(typed) && String(hymn.number) !== typed,
      );
      const items = [...exact, ...prefixed]
        .slice(0, props.compact ? COMPACT_ROWS : NUMBER_SUGGESTIONS)
        .map((hymn) => ({ number: hymn.number, title: hymn.title, book: id() }));
      return items.length ? [{ id: id(), title: "", current: true, items }] : [];
    }
    if (!trimmed()) return [];
    if (!lyricQuery() || lyricResults.loading) return prev;
    const found = lyricResults.latest ?? [];
    const cap = !props.compact ? undefined : grouped() ? COMPACT_GROUP_ROWS : COMPACT_ROWS;
    return found.map((group) => ({ ...group, items: group.items.slice(0, cap) }));
  }, []);

  // Which other books' groups More in has opened; a new search closes them.
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  createEffect(
    on(
      () => lyricResults.latest,
      () => setExpanded(new Set<string>()),
      { defer: true },
    ),
  );

  const commandRows = createMemo((): Row[] =>
    (props.commands ?? [])
      .filter((command) => !isNumber() && matchesCommand(command.label, trimmed()))
      .map((command) => ({ kind: "command" as const, command, group: COMMANDS_GROUP })),
  );

  // The actions, then each group's songs. A book that is not the current one shows its
  // first few and a More in row, until opened (SDD-0001 §13.1).
  const rows = createMemo((): Row[] => [
    ...commandRows(),
    ...groups().flatMap((group): Row[] => {
      const ref = { id: group.id, title: group.title };
      const short =
        grouped() &&
        !props.compact &&
        !group.current &&
        !expanded().has(group.id) &&
        group.items.length > GROUP_ROWS;
      const items = short ? group.items.slice(0, GROUP_ROWS) : group.items;
      return [
        ...items.map((item) => ({ kind: "hymn" as const, item, group: ref })),
        ...(short ? [{ kind: "more" as const, group: ref }] : []),
      ];
    }),
  ]);

  // The highlight is Enter's target: the top match as you type, a row the
  // arrows reach, or the row under a moving pointer. A pointer leaving
  // takes its highlight with it, rather than it staying behind or jumping
  // elsewhere; Enter then takes the top match (DESIGN.md § States).
  const [active, setActiveIndex] = createSignal<number>();
  const setActive = (step: (index: number) => number) => setActiveIndex(step(active() ?? -1));
  // Opening a group (More in) changes the rows, not the matches: the highlight stays
  // where it is, now on the first song that was hidden.
  createEffect(() => {
    groups();
    commandRows();
    setActiveIndex(trimmed() ? 0 : undefined);
  });

  // The switcher's rows come and go with a motion (DESIGN.md § Output view): a
  // row that is no longer a result stays, collapsing, until its motion ends,
  // and a row that is new expands in. Each row is kept by what it is (its
  // number, or its label), so a row that stays is the same element.
  const rowKey = (row: Row) =>
    row.kind === "command"
      ? `c:${row.command.label}`
      : row.kind === "more"
        ? `m:${row.group.id}`
        : `h:${row.group.id}:${row.item.number}`;
  const lastRows = new Map<string, Row>();
  const [shown, setShown] = createSignal<string[]>([]);
  const [leaving, setLeaving] = createSignal<ReadonlySet<string>>(new Set());
  let settled = false;
  const dropRow = (key: string) => {
    if (!untrack(leaving).has(key)) return;
    setLeaving((set) => new Set([...set].filter((k) => k !== key)));
    setShown((all) => all.filter((k) => k !== key));
    lastRows.delete(key);
  };
  createEffect(() => {
    const live = rows();
    const keys = live.map(rowKey);
    for (const row of live) lastRows.set(rowKey(row), row);
    if (!props.compact) {
      setShown(keys);
      return;
    }
    const before = untrack(shown);
    const next = [...keys];
    const going = new Set<string>();
    before.forEach((key, at) => {
      if (keys.includes(key)) return;
      going.add(key);
      next.splice(Math.min(at, next.length), 0, key);
    });
    setLeaving(going);
    setShown(next);
    // Its own transition ends it; this is the backstop (no layout, no motion).
    for (const key of going) setTimeout(() => dropRow(key), LEAVE_BACKSTOP_MS);
  });
  const liveIndex = (key: string) => rows().findIndex((row) => rowKey(row) === key);
  onMount(() => {
    settled = true;
  });

  const pick = (row: Row) => {
    if (row.kind === "command") row.command.run();
    else if (row.kind === "more") setExpanded((open) => new Set([...open, row.group.id]));
    else props.onSelect(row.item.number, row.item.book);
  };

  const noMatch = () =>
    !isNumber() && !!lyricQuery() && lyricResults.state === "ready" && lyricResults().length === 0;

  // The groups on screen, in order, each row in its group. A leaving row (the switcher)
  // keeps its group until it is gone.
  const rowOf = (key: string) => rows().find((r) => rowKey(r) === key) ?? lastRows.get(key);
  const groupIds = createMemo((): string[] => [
    ...new Set(shown().map((key) => rowOf(key)?.group.id ?? "")),
  ]);
  const keysIn = (group: string) => shown().filter((key) => rowOf(key)?.group.id === group);
  const groupTitle = (group: string) =>
    shown()
      .map((key) => rowOf(key)?.group)
      .find((ref) => ref?.id === group)?.title ?? "";
  // By position, so ids cannot collide whatever the book keys hold.
  const headingId = (group: string) => `${listId}-g-${groupIds().indexOf(group)}`;
  // A group with no title (a number's suggestions, still up for a moment as words are
  // typed) gets neither a heading nor a group of its own.
  const titled = (group: string) => group === COMMANDS_GROUP.id || groupTitle(group) !== "";
  const groupAria = (group: string) =>
    !grouped() || !titled(group)
      ? { role: "presentation" as const }
      : group === COMMANDS_GROUP.id
        ? { role: "group" as const, "aria-label": COMMANDS_GROUP.title }
        : { role: "group" as const, "aria-labelledby": headingId(group) };
  /** The scope line: all books while words are typed; the current book while a number is
   * (numbers are per book) or nothing is, since its songs and recents are what is listed. */
  const scope = () =>
    (props.bookCount ?? 1) > 1 && !props.compact && trimmed() && !isNumber()
      ? "all books"
      : props.bookTitle;

  const choose = () => {
    // The highlight may point past a list that has just shrunk: the last row is taken.
    const list = rows();
    const row = list[Math.min(active() ?? 0, list.length - 1)];
    if (row) return pick(row);
    // A number with no suggestion still opens — Presenter reports it if no
    // such hymn exists.
    if (isNumber() && !props.compact) return props.onSelect(Number(trimmed()), id());
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
    queueMicrotask(() => {
      glide?.hover.show(results?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null);
      // The rows may be moving (the switcher's come and go with a motion): the
      // highlight stays on its row, frame by frame, until they are still.
      const until = performance.now() + FOLLOW_MS;
      const frame = () => {
        glide?.hover.follow();
        const moving = results?.querySelector(".finder-row:is([data-entering], [data-leaving])");
        if (moving && performance.now() < until && results?.isConnected)
          requestAnimationFrame(frame);
      };
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(frame);
    });
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
          Back to Hymnbooks
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
            aria-describedby={scope() ? `${listId}-scope` : undefined}
          />
        </div>
        <Show when={scope()}>
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
        <For each={groupIds()}>
          {(group) => (
            // With several books, each source is a group under its heading; with one, the
            // wrapper is no more than a wrapper.
            <div class="finder-group" {...groupAria(group)}>
              <Show when={grouped() && titled(group) && group !== COMMANDS_GROUP.id}>
                <div
                  class="finder-group-heading label-large on-surface-variant"
                  id={headingId(group)}
                >
                  {groupTitle(group)}
                </div>
              </Show>
              <For each={keysIn(group)}>
                {(key) => {
                  const row = () => rowOf(key);
                  const going = () => leaving().has(key);
                  const index = () => liveIndex(key);
                  return (
                    <div
                      role="presentation"
                      class="finder-row"
                      data-entering={props.compact && settled ? "" : undefined}
                      data-leaving={going() ? "" : undefined}
                      onAnimationEnd={(event) => {
                        if (event.target === event.currentTarget)
                          event.currentTarget.removeAttribute("data-entering");
                      }}
                      onTransitionEnd={(event) => {
                        if (event.target === event.currentTarget) dropRow(key);
                      }}
                    >
                      <div class="finder-row-clip">
                        <Show when={row()}>
                          {(current) => {
                            const command = () => {
                              const it = current();
                              return it.kind === "command" ? it.command : undefined;
                            };
                            const option = () => {
                              const it = current();
                              return it.kind === "hymn" ? it.item : undefined;
                            };
                            const more = () => {
                              const it = current();
                              return it.kind === "more" ? it.group : undefined;
                            };
                            return (
                              <div
                                id={going() ? `${listId}-out-${key}` : optionId(index())}
                                role="option"
                                tabIndex={-1}
                                class="list-row finder-option"
                                aria-hidden={going() ? "true" : undefined}
                                aria-selected={!going() && active() === index()}
                                // mousemove, not mouseenter: a list appearing under a resting
                                // pointer fires mouseenter without the pointer moving, and must
                                // not steal the highlight from the top match — typing "121" then
                                // Enter must open 121, not the row that landed under the mouse.
                                onMouseMove={() => !going() && setActiveIndex(index())}
                                // mousedown, not click: keeps focus in the box while choosing.
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  if (!going()) pick(current());
                                }}
                              >
                                <Show
                                  when={option()}
                                  fallback={
                                    <Show
                                      when={more()}
                                      fallback={
                                        <>
                                          <span class="finder-title">{command()?.label}</span>
                                          <Show when={command()?.hint}>
                                            {(hint) => <KeyCombo keys={hint()} />}
                                          </Show>
                                        </>
                                      }
                                    >
                                      {(book) => (
                                        <span class="finder-title finder-more">
                                          More in {book().title}
                                        </span>
                                      )}
                                    </Show>
                                  }
                                >
                                  {(hymn) => (
                                    <>
                                      <span class="finder-number">#{hymn().number}</span>
                                      <span class="finder-text">
                                        <span class="finder-title">{titleCase(hymn().title)}</span>
                                        <Show when={hymn().snippet}>
                                          {(snippet) => (
                                            <span class="finder-snippet-box">
                                              <span class="finder-snippet list-row-supporting">
                                                — {snippet()}
                                              </span>
                                            </span>
                                          )}
                                        </Show>
                                      </span>
                                    </>
                                  )}
                                </Show>
                              </div>
                            );
                          }}
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
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
            refresh={props.recentsVersion}
            store={props.store}
            userState={props.userState}
            onSelect={(number) => props.onSelect(number, id())}
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
                        onClick={() => props.onSelect(hymn.number, id())}
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
