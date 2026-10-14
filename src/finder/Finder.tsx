import {
  batch,
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
import { languageName } from "../library/books.ts";
import { type ContentStore, getContentStore } from "../persistence/content-store.ts";
import type { SearchScope, UserState } from "../persistence/user-state.ts";
import { ClearSearch } from "../shell/ClearSearch.tsx";
import { titleCase } from "../shell/case.ts";
import { EmptyCard } from "../shell/EmptyCard.tsx";
import { type GlideList, glideList } from "../shell/glideList.ts";
import { hoverButton } from "../shell/hoverGlide.ts";
import { KeyCombo } from "../shell/KeyCombo.tsx";
import { clampText, clipEcho, SEARCH_MAX } from "../shell/limits.ts";
import { RecentsList } from "../shell/RecentsList.tsx";
import { riseIn } from "../shell/riseIn.ts";
import { type Layout, layoutOf, type Range, type Windowed, windowed } from "../shell/windowing.ts";
import { booksLabel, ScopeChips } from "./ScopeChips.tsx";
import {
  type FinderGroup,
  type FinderItem,
  type FinderSource,
  SOURCES,
  scopeOf,
  searchSources,
  searchSourcesByNumber,
  searchSourcesMore,
} from "./sources.ts";

/** How long typing must pause before a lyric search runs. */
const LYRIC_DEBOUNCE_MS = 200;
/** Number suggestions shown at most. */
const NUMBER_SUGGESTIONS = 8;
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
/** The windowed list's rows in rem, fixed in the stylesheet (`.finder-windowed`): nothing is
 * measured per row (SDD-0001 §13.2). */
const OPTION_REM = 3.5;
const HEADING_REM = 2.75;
const STATUS_REM = 3;
/** Rows kept either side of the view. */
const OVERSCAN_ROWS = 6;
/** Slots rendered before the list has been placed: enough to fill a tall sheet. */
const FIRST_SLOTS = 18;
/** The group a browsed book's songs are in when the book has no languages. */
const ALL_SONGS = "All songs";

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
  /** The books held, in the Library's order: with several, the scope chips are shown
   * (SDD-0001 §13.4). */
  books?: readonly { key: HymnbookId; title: string }[];
  /** The remembered scope; the Finder reads it, and reports a new choice to `onScope`. */
  scope?: SearchScope;
  onScope?: (scope: SearchScope) => void;
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
  /** The commands a `>` first in the box lists, instead of songs — this gives the Finder its
   * command mode (SDD-0001 §13.3, §16.5). Without them the Finder is songs only. */
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
  /** It changes what the Output shows, so Touch Lock asks a held press of it (SDD-0001 §16.11). */
  guard?: boolean;
}

/** The group a row belongs to: the actions, or a source's group. */
interface GroupRef {
  id: string;
  title: string;
}

const COMMANDS_GROUP: GroupRef = { id: "commands", title: "Commands" };

/** The content of a book's "More in" row: a quiet line in the songs' columns, a chevron after it. */
function MoreIn(props: { title: string }) {
  return (
    <>
      <span class="finder-number" aria-hidden="true" />
      <span class="finder-title finder-more">More in {props.title}</span>
      <span class="icon icon-chevron-right finder-more-icon" aria-hidden="true" />
    </>
  );
}

/** One row in the listbox: an action, a hymn, or More in a book. */
type Row =
  | { kind: "command"; command: Command; group: GroupRef }
  | { kind: "hymn"; item: FinderItem; group: GroupRef }
  | { kind: "more"; group: GroupRef };

/** What fills a windowed listbox, top to bottom: a group's heading, its options, and the line
 * that ends a group which pages (loading, a failure) or a search that has (the end). */
type Slot =
  | { kind: "heading"; group: GroupRef }
  | { kind: "row"; row: Row; index: number }
  | { kind: "status"; group: GroupRef; state: "loading" | "failed" | "end" };

/** A group's stretch of slots: `first` is its heading (when it has one), `from` to `to` the rest. */
interface Section {
  group: GroupRef;
  heading: Slot | undefined;
  first: number;
  from: number;
  to: number;
}

/** The windowed list's plan: every slot, where it sits, and the option each belongs to. */
interface Plan {
  slots: Slot[];
  sections: Section[];
  layout: Layout;
  /** The slot of each option, by option index. */
  slotOfOption: number[];
  /** The slots that ask for the next page of their group when they come into reach. */
  pagers: { slot: number; group: string }[];
}

/** One rem in px: read when a plan is made, not while scrolling. */
const remPx = () => {
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
};

/** A group's pages fetched past its first, and how far into the book's matches they reached. */
interface Paged {
  items: FinderItem[];
  more: boolean;
  fetched: number;
}

let nextId = 0;

const itemOf = (hymn: { number: HymnNumber; title: string }, book: HymnbookId): FinderItem => ({
  number: hymn.number,
  title: hymn.title,
  book,
});

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
  // How many recents there are, once known; the list reports it.
  const [recentCount, setRecentCount] = createSignal<number>();
  // Another book: its recents are not known yet, and nothing of the last one's shows.
  createEffect(on(id, () => setRecentCount(undefined), { defer: true }));
  // The songs are in the list's place until it is known that there are none, and both lists
  // appear together once both are read, so neither moves the other.
  const songsExpected = () => read.loading || (hymns()?.length ?? 0) > 0;

  const [query, setQuery] = createSignal(clampText(props.initialQuery ?? "", SEARCH_MAX));
  // Command mode (SDD-0001 §13.3): a `>` first in the box, with commands to list. The songs'
  // side sees an empty box then, so songs and commands never mix.
  const commandMode = () => !props.compact && !!props.commands && query().startsWith(">");
  const commandText = () => (commandMode() ? query().slice(1).trim() : "");
  const trimmed = () => (commandMode() ? "" : query().trim());
  const isNumber = () => /^\d+$/.test(trimmed());

  // The scope chips (SDD-0001 §13.4): the remembered choice, or the one just made, read
  // against the books held now. The switcher is never scoped.
  const [picked, setPicked] = createSignal<SearchScope>();
  createEffect(
    on(
      () => props.scope,
      () => setPicked(undefined),
      { defer: true },
    ),
  );
  const heldKeys = () => (props.books ?? []).map((book) => book.key);
  // Equal by value: a new array of the same books must not read as a new scope (a search
  // would run again).
  const scope = createMemo(
    () => scopeOf(picked() ?? props.scope, heldKeys(), props.hymnbookId),
    undefined,
    { equals: (a, b) => a.mode === b.mode && a.keys?.join(",") === b.keys?.join(",") },
  );
  const scoped = () => (props.compact ? undefined : scope().keys);
  const scopeSig = () => scoped()?.join("\n") ?? "*";
  /** Whether the current book is among those searched. */
  const currentIn = () => scoped() === undefined || scoped()?.includes(id()) === true;
  /** The chips are there: songs mode, with several books to choose from. */
  const chipsShown = () => !props.compact && !commandMode() && (props.books?.length ?? 0) > 1;
  const chooseScope = (next: SearchScope) => {
    setPicked(next);
    props.onScope?.(next);
  };
  /** What the scope is called in a sentence, for the no-match card. */
  const scopeName = () =>
    scope().mode === "this" ? "This Book" : booksLabel(scope().keys?.length ?? 0);

  // The whole book while nothing is typed (SDD-0001 §13.2), in the order the book gives
  // (`listHymns`): by number, except Assorted Hymns, which lists its songs by language and
  // title (SDD-0004 §17). The Finder keeps that order, a group to a language where the book
  // has several; the list is windowed, so a book of any length costs the same to show.
  const browsing = () => !props.compact && !trimmed() && !commandMode();
  const browseGroups = createMemo((): FinderGroup[] => {
    const all = hymns() ?? [];
    if (!browsing() || all.length === 0 || recentCount() === undefined) return [];
    const book = id();
    const languages = new Set(all.map((hymn) => hymn.language ?? ""));
    if (languages.size < 2 || languages.has("")) {
      return [
        { id: book, title: ALL_SONGS, current: true, items: all.map((h) => itemOf(h, book)) },
      ];
    }
    const groups: FinderGroup[] = [];
    for (const hymn of all) {
      const last = groups.at(-1);
      const code = hymn.language ?? "";
      if (last && last.id === `${book}#${code}`) last.items.push(itemOf(hymn, book));
      else
        groups.push({
          id: `${book}#${code}`,
          title: languageName(code) || code,
          current: true,
          items: [itemOf(hymn, book)],
        });
    }
    return groups;
  });

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
  // Each result set says which query it answers, so whether it is the latest asked is not a
  // matter of when the resource starts loading.
  const [lyricResults] = createResource(
    () => ({ text: lyricQuery(), books: scoped(), sig: scopeSig() }),
    async ({
      text,
      books,
      sig,
    }): Promise<{ text: string; sig: string; groups: FinderGroup[] }> => ({
      text,
      sig,
      groups: text
        ? await searchSources(props.sources ?? SOURCES, text, {
            store: store(),
            currentKey: id(),
            books,
          })
        : [],
    }),
  );
  const lyricPending = () =>
    lyricResults.loading ||
    lyricResults.latest?.text !== lyricQuery() ||
    lyricResults.latest?.sig !== scopeSig();

  // Several books searched (and not the switcher, for a number): the results are grouped
  // under their books' titles.
  const manyBooks = () => (scoped()?.length ?? props.bookCount ?? 1) > 1;
  const grouped = () => manyBooks() && (!isNumber() || !props.compact);

  // A number is also looked up in the other books (ADR-0032, amended). The current book's
  // suggestions come from its own list at once; these join when they arrive, and never
  // hold the fast path up.
  const [numberResults] = createResource(
    () =>
      isNumber() && !props.compact && (manyBooks() || !currentIn())
        ? { typed: trimmed(), books: scoped() }
        : undefined,
    ({ typed, books }): Promise<FinderGroup[]> =>
      searchSourcesByNumber(props.sources ?? SOURCES, typed, {
        store: store(),
        currentKey: id(),
        books,
      }).catch(() => []),
  );
  const otherNumberGroups = (): FinderGroup[] =>
    numberResults.loading || !isNumber()
      ? []
      : (numberResults() ?? [])
          .filter((group) => group.id !== id())
          .map((group) => ({ ...group, current: false }));

  // While the next lyric search is pending (the pause before it, or its read)
  // the last results stay: only a result set that is empty empties the list.
  // A number is suggested from the current book first, then the other books.
  let browsed = false;
  const groups = createMemo((prev: FinderGroup[]): FinderGroup[] => {
    if (isNumber()) {
      browsed = false;
      const typed = trimmed();
      const all = hymns() ?? [];
      const exact = all.filter((hymn) => String(hymn.number) === typed);
      const prefixed = all.filter(
        (hymn) => String(hymn.number).startsWith(typed) && String(hymn.number) !== typed,
      );
      const items = [...exact, ...prefixed]
        .slice(0, props.compact ? COMPACT_ROWS : NUMBER_SUGGESTIONS)
        .map((hymn) => ({ number: hymn.number, title: hymn.title, book: id() }));
      return [
        ...(items.length && currentIn()
          ? [{ id: id(), title: props.bookTitle ?? "", current: true, items }]
          : []),
        ...otherNumberGroups(),
      ];
    }
    if (!trimmed()) {
      browsed = true;
      return browseGroups();
    }
    // The whole book is not a result: words typed after it wait with an empty list.
    if (!lyricQuery() || lyricPending()) return browsed ? [] : prev;
    browsed = false;
    const found = lyricResults.latest?.groups ?? [];
    const cap = !props.compact ? undefined : grouped() ? COMPACT_GROUP_ROWS : COMPACT_ROWS;
    return found.map((group) => ({ ...group, items: group.items.slice(0, cap) }));
  }, []);

  // Which other books' groups More in has opened; a new search closes them.
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  // The pages fetched past a search's first, by group; those on their way; those that failed.
  // A new result set throws them all away, and a page still on its way is let go (SDD-0001 §13.2).
  const [paged, setPaged] = createSignal<ReadonlyMap<string, Paged>>(new Map());
  const [fetching, setFetching] = createSignal<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = createSignal<ReadonlySet<string>>(new Set());
  let generation = 0;
  createEffect(
    on(
      () => lyricResults.latest,
      () => {
        generation++;
        setExpanded(new Set<string>());
        setPaged(new Map());
        setFetching(new Set<string>());
        setFailed(new Set<string>());
      },
      { defer: true },
    ),
  );

  // The groups with their later pages appended, each song once. The highlight and the
  // scroll belong to `groups`, so a page arriving moves neither.
  const shownGroups = createMemo((): FinderGroup[] => {
    const more = paged();
    if (more.size === 0) return groups();
    return groups().map((group) => {
      const extra = more.get(group.id);
      if (!extra) return group;
      const have = new Set(group.items.map((item) => item.number));
      const added = extra.items.filter((item) => !have.has(item.number));
      return { ...group, items: [...group.items, ...added], more: extra.more };
    });
  });

  /** Asks for the next page of a group, once, and appends it when it arrives. */
  const loadMore = (groupId: string) => {
    const base = groups().find((group) => group.id === groupId);
    const mine = paged().get(groupId);
    const more = mine ? mine.more : base?.more;
    if (!base || !more || fetching().has(groupId) || failed().has(groupId)) return;
    const turn = generation;
    const offset = base.items.length + (mine?.fetched ?? 0);
    const text = lyricQuery();
    const grow = (set: ReadonlySet<string>, add: boolean) =>
      new Set([...set].filter((g) => g !== groupId).concat(add ? [groupId] : []));
    setFetching((set) => grow(set, true));
    setFailed((set) => grow(set, false));
    searchSourcesMore(props.sources ?? SOURCES, groupId, text, offset, {
      store: store(),
      currentKey: id(),
      books: scoped(),
    })
      .then((page) => {
        if (turn !== generation) return;
        // One batch: when the page lands the group is no longer on its way, so the next
        // page can be asked for at once if the end is still in reach.
        batch(() => {
          setFetching((set) => grow(set, false));
          setPaged((all) => {
            const next = new Map(all);
            const before = all.get(groupId);
            next.set(groupId, {
              items: [...(before?.items ?? []), ...page.items],
              more: page.more,
              fetched: (before?.fetched ?? 0) + page.items.length,
            });
            return next;
          });
        });
      })
      .catch(() => {
        if (turn !== generation) return;
        batch(() => {
          setFetching((set) => grow(set, false));
          setFailed((set) => grow(set, true));
        });
      });
  };
  /** Whether a search has pages still to come: the arrows wait for them at the last row. */
  const morePending = () => !props.compact && shownGroups().some((group) => group.more);

  const commandRows = createMemo((): Row[] =>
    (commandMode() ? (props.commands ?? []) : [])
      .filter((command) => matchesCommand(command.label, commandText()))
      .map((command) => ({ kind: "command" as const, command, group: COMMANDS_GROUP })),
  );

  // The actions, then each group's songs. A book that is not the current one shows its
  // first few and a More in row, until opened (SDD-0001 §13.1).
  const shortOf = (group: FinderGroup) =>
    grouped() &&
    !props.compact &&
    !group.current &&
    !expanded().has(group.id) &&
    group.items.length > GROUP_ROWS;
  const rows = createMemo((): Row[] => [
    ...commandRows(),
    ...shownGroups().flatMap((group): Row[] => {
      const ref = { id: group.id, title: group.title };
      const short = shortOf(group);
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
  // Opening a group (More in) changes the rows, not the matches: the highlight stays
  // where it is, now on the first song that was hidden.
  createEffect(() => {
    groups();
    commandRows();
    setActiveIndex(
      (commandMode() ? !!commandText() : !!trimmed() && !numberNotHere()) ? 0 : undefined,
    );
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
    // Only the switcher's rows have a motion; a windowed list has its own plan.
    if (!props.compact) return;
    const live = rows();
    const keys = live.map(rowKey);
    for (const row of live) lastRows.set(rowKey(row), row);
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

  // A song, or a command that changes the Output, is a press Touch Lock asks to hold; the row
  // acts on mousedown, so that is the event it guards (SDD-0001 §16.11).
  const guardOf = (row: Row) =>
    row.kind === "hymn" || (row.kind === "command" && row.command.guard) ? "mousedown" : undefined;

  const pick = (row: Row) => {
    if (row.kind === "command") row.command.run();
    else if (row.kind === "more") setExpanded((open) => new Set([...open, row.group.id]));
    else props.onSelect(row.item.number, row.item.book);
  };

  // The query the no-match card is for. It holds while the next search is on its way: a card
  // that left and came back on every pause in typing shrank the strip it sits in (the
  // switcher's backdrop followed it, and the lyrics behind showed through for a frame).
  const emptyFor = createMemo(
    (held: { query: string; where?: string } | undefined) => {
      if (isNumber() || !trimmed()) return undefined;
      const answered =
        !!lyricQuery() &&
        lyricResults.state === "ready" &&
        lyricResults().text === lyricQuery() &&
        lyricResults().sig === scopeSig();
      if (!answered) return held;
      return lyricResults().groups.length === 0
        ? {
            query: lyricResults().text,
            // Where it looked, when that was not every book (SDD-0001 §13.4).
            where: scope().mode === "all" ? undefined : scopeName(),
          }
        : undefined;
    },
    undefined,
    { equals: (a, b) => a?.query === b?.query && a?.where === b?.where },
  );
  const noMatch = () =>
    commandMode() ? !!commandText() && commandRows().length === 0 : emptyFor() !== undefined;
  const emptyQuery = () => (commandMode() ? commandText() : emptyFor()?.query);

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
  // A number the current book has no song for: its top match would be another book's, and
  // Enter must not open that. With nothing highlighted, Enter opens the number here.
  const numberNotHere = () =>
    isNumber() &&
    !props.compact &&
    manyBooks() &&
    currentIn() &&
    !groups().some((group) => group.current && group.items.length > 0);

  const choose = () => {
    // The highlight may point past a list that has just shrunk: the last row is taken.
    const list = rows();
    // Nothing typed, the list is the whole book: only a row the arrows chose is opened.
    if (!trimmed() && !props.compact) {
      const chosen =
        active() === undefined ? undefined : list[Math.min(active() ?? 0, list.length - 1)];
      if (chosen) pick(chosen);
      return;
    }
    const row =
      active() === undefined && numberNotHere()
        ? undefined
        : list[Math.min(active() ?? 0, list.length - 1)];
    if (row) return pick(row);
    // A number with no suggestion still opens — Presenter reports it if no
    // such hymn exists.
    if (isNumber() && !props.compact) return props.onSelect(Number(trimmed()), id());
    if (trimmed() && !isNumber()) setLyricQuery(trimmed());
  };

  // The windowed list (SDD-0001 §13.2): every row of the plan has a fixed height, and only
  // the slots within the scroller's view, with some over, are in the DOM.
  const headed = () => grouped() || !trimmed();
  /** A search that went past its first page and has none left. */
  const pagedToEnd = () => paged().size > 0 && !shownGroups().some((group) => group.more);
  const plan = createMemo((): Plan => {
    const list = rows();
    const rem = remPx();
    const slots: Slot[] = [];
    const sections: Section[] = [];
    const slotOfOption: number[] = [];
    const pagers: Plan["pagers"] = [];
    const byId = new Map(shownGroups().map((group) => [group.id, group]));
    const finished = pagedToEnd();
    let open: Section | undefined;
    const close = (last: boolean) => {
      if (!open) return;
      const group = byId.get(open.group.id);
      if (group?.more && !shortOf(group)) {
        const state = failed().has(group.id) ? "failed" : "loading";
        pagers.push({ slot: slots.length, group: group.id });
        slots.push({ kind: "status", group: open.group, state });
      } else if (last && finished) {
        slots.push({ kind: "status", group: open.group, state: "end" });
      }
      open.to = slots.length;
      sections.push(open);
      open = undefined;
    };
    list.forEach((row, index) => {
      if (open?.group.id !== row.group.id) {
        close(false);
        const heading: Slot | undefined =
          headed() && row.group.title && row.group.id !== COMMANDS_GROUP.id
            ? { kind: "heading", group: row.group }
            : undefined;
        const first = slots.length;
        if (heading) slots.push(heading);
        open = { group: row.group, heading, first, from: slots.length, to: slots.length };
      }
      slotOfOption.push(slots.length);
      slots.push({ kind: "row", row, index });
    });
    close(true);
    const height = (i: number) => {
      const kind = slots[i]?.kind;
      return (kind === "heading" ? HEADING_REM : kind === "status" ? STATUS_REM : OPTION_REM) * rem;
    };
    return { slots, sections, layout: layoutOf(slots.length, height), slotOfOption, pagers };
  });
  const [range, setRange] = createSignal<Range>({ start: 0, end: FIRST_SLOTS });
  /** The sections with something in the window, by their place in the plan. */
  const sectionsInView = createMemo((): number[] => {
    const { start, end } = range();
    const out: number[] = [];
    plan().sections.forEach((section, at) => {
      if (section.first < end && section.to > start) out.push(at);
    });
    return out;
  });
  const bodyOf = (at: number): Slot[] => {
    const section = plan().sections[at];
    if (!section) return [];
    const { start, end } = range();
    return plan().slots.slice(Math.max(section.from, start), Math.min(section.to, end));
  };
  const heightAt = (index: number) => plan().layout.offsets[index] ?? 0;
  /** The height standing for the slots of a section above the window, inside the section. */
  const spaceAbove = (at: number) => {
    const section = plan().sections[at];
    return section
      ? heightAt(Math.max(section.from, Math.min(range().start, section.to))) -
          heightAt(section.from)
      : 0;
  };
  const spaceBelow = (at: number) => {
    const section = plan().sections[at];
    return section
      ? heightAt(section.to) - heightAt(Math.min(section.to, Math.max(section.from, range().end)))
      : 0;
  };
  /** The height of the sections before the first in the window, and after the last. */
  const spaceBefore = () => heightAt(plan().sections[sectionsInView()[0] ?? 0]?.first ?? 0);
  const spaceAfter = () => {
    const last = plan().sections[sectionsInView().at(-1) ?? 0];
    return last ? plan().layout.total - heightAt(last.to) : 0;
  };

  let win: Windowed | undefined;
  let formEl: HTMLFormElement | undefined;
  let inputEl: HTMLInputElement | undefined;
  let rootEl: HTMLDivElement | undefined;
  /** What the sticky field (and a group's heading) cover at the top of the view, in px. */
  const coveredAbove = () => {
    if (!formEl) return 0;
    const stick = Number.parseFloat(getComputedStyle(formEl).top);
    const heading = headed() && !commandMode() ? HEADING_REM * remPx() : 0;
    return (Number.isFinite(stick) ? stick : 0) + formEl.offsetHeight + heading;
  };
  const activeShown = () => {
    const at = active();
    if (at === undefined) return false;
    if (props.compact) return true;
    const slot = plan().slotOfOption[at];
    const { start, end } = range();
    return slot !== undefined && slot >= start && slot < end;
  };
  /** The highlight moves by key: to a row, scrolled into view at once. */
  const moveTo = (index: number) => {
    setActiveIndex(index);
    const slot = plan().slotOfOption[index];
    if (slot !== undefined) win?.reveal(slot);
  };

  onMount(() => {
    if (props.compact || !results || !results.isConnected) return;
    win = windowed({
      list: results,
      layout: () => plan().layout,
      overscan: OVERSCAN_ROWS * OPTION_REM * remPx(),
      insets: () => ({ top: coveredAbove(), bottom: 8 }),
      onRange: setRange,
    });
    onCleanup(() => win?.stop());
    win.update();
    // The groups' headings stick under the field, wherever its height has got to.
    if (formEl && rootEl && typeof ResizeObserver === "function") {
      const form = formEl;
      const root = rootEl;
      const watch = new ResizeObserver(() =>
        root.style.setProperty("--finder-form-h", `${form.offsetHeight}px`),
      );
      watch.observe(form);
      onCleanup(() => watch.disconnect());
    }
  });
  // A new plan changes the height: the window is read again. A new query starts at the top.
  createEffect(on(plan, () => win?.update(), { defer: true }));
  createEffect(on([trimmed, commandMode], () => win?.toStart(), { defer: true }));
  // The status line that ends a group which pages asks for the next page when it comes
  // within reach, a window's overscan from the view.
  createEffect(() => {
    if (props.compact) return;
    const { start, end } = range();
    for (const pager of plan().pagers) {
      if (pager.slot >= start && pager.slot < end) untrack(() => loadMore(pager.group));
    }
  });

  const retry = (group: string) => {
    setFailed((set) => new Set([...set].filter((g) => g !== group)));
    loadMore(group);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const count = rows().length;
    const at = active();
    const windowedList = !props.compact;
    const page = () =>
      Math.max(1, Math.floor((win?.viewport() ?? 600) / (OPTION_REM * remPx())) - 1);
    // Home and End are the box's own caret keys once something is typed (Ctrl takes them).
    const ends = windowedList && (!query().trim() || event.ctrlKey || event.metaKey);
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      // The last row of a search with pages to come waits for them, rather than wrapping.
      if (at === count - 1 && morePending()) return;
      moveTo(at === undefined ? 0 : (at + 1) % count);
    } else if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      moveTo(at === undefined ? count - 1 : (at - 1 + count) % count);
    } else if (event.key === "PageDown" && count && windowedList) {
      event.preventDefault();
      moveTo(Math.min(count - 1, (at ?? -1) + page()));
    } else if (event.key === "PageUp" && count && windowedList) {
      event.preventDefault();
      moveTo(Math.max(0, (at ?? 0) - page()));
    } else if (event.key === "Home" && count && ends) {
      event.preventDefault();
      moveTo(0);
    } else if (event.key === "End" && count && ends) {
      event.preventDefault();
      moveTo(count - 1);
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
  // A new set of matches glides up into place and fades in, in the list's own layer: the
  // dialog around it holds its size (Sheet `fixed`). Paging more in, or scrolling, is no new
  // set; the switcher has its own motion for its rows.
  const matchSet = createMemo(() =>
    [
      commandMode() ? "commands" : "songs",
      ...commandRows().map((row) => (row.kind === "command" ? row.command.label : "")),
      ...groups().map((g) => {
        const nums = g.items.map((item) => item.number);
        return `${g.id}:${nums.length}:${nums.slice(0, 3)}:${nums.slice(-2)}`;
      }),
    ].join("|"),
  );
  createEffect(
    on(
      matchSet,
      () => {
        if (!props.compact) riseIn(results);
      },
      { defer: true },
    ),
  );
  createEffect(() => {
    active();
    rows();
    // A windowed row that left the window and came back is a new element: marked again.
    if (!props.compact && active() !== undefined) range();
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

  /** What an option says: an action and its key, More in a book, or a song's number and title. */
  const optionContent = (row: Row) => {
    if (row.kind === "command") {
      return (
        <>
          <span class="finder-title">{row.command.label}</span>
          <Show when={row.command.hint}>{(hint) => <KeyCombo keys={hint()} />}</Show>
        </>
      );
    }
    if (row.kind === "more") {
      return <MoreIn title={row.group.title} />;
    }
    const hymn = row.item;
    return (
      <>
        <span class="finder-number">#{hymn.number}</span>
        <span class="finder-text">
          <span class="finder-title">{titleCase(hymn.title)}</span>
          <Show when={hymn.snippet}>
            {(snippet) => (
              <span class="finder-snippet-box">
                <span class="finder-snippet list-row-supporting">— {snippet()}</span>
              </span>
            )}
          </Show>
        </span>
      </>
    );
  };

  return (
    <div class="finder" ref={rootEl}>
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
        ref={formEl}
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
            aria-activedescendant={activeShown() ? optionId(active() ?? 0) : undefined}
            ref={(el) => {
              inputEl = el;
              // Opened over nothing (a book chosen in the Library), the next key typed is a
              // search, with a keyboard to type on. Not where a screen keyboard would cover
              // the songs: a touch screen taps the field. A sheet, or a control already
              // focused, keeps its own focus.
              queueMicrotask(() => {
                // Opened with something typed (a digit from an empty Present): the caret
                // follows it, so the next key adds to it.
                if (el.value) el.setSelectionRange(el.value.length, el.value.length);
                const at = document.activeElement;
                const keyboard = window.matchMedia?.("(pointer: fine)").matches ?? true;
                if (keyboard && el.isConnected && (!at || at === document.body))
                  el.focus({ preventScroll: true });
              });
            }}
            maxlength={SEARCH_MAX}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            // In a sheet (the hymn picker, the command menu) the box takes
            // focus on open, not the sheet's Close button.
            autofocus
            // No Find button: results show as you type, and Enter (or a
            // phone keyboard's Search key) submits (DESIGN.md § Structure).
            enterkeyhint="search"
            placeholder={
              !props.commands
                ? "Song number or lyrics"
                : commandMode()
                  ? "Find a command"
                  : "Find a song, or > for commands"
            }
            aria-label={props.commands ? "Find a song or command" : "Find a song"}
          />
          <ClearSearch visible={query() !== ""} onClear={() => setQuery("")} />
        </div>
        <Show when={chipsShown()}>
          <ScopeChips
            books={props.books ?? []}
            mode={scope().mode}
            keys={scope().keys}
            canThis={heldKeys().includes(id())}
            onAll={() => chooseScope({ mode: "all" })}
            onThis={() => chooseScope({ mode: "this" })}
            onBooks={(books) => chooseScope({ mode: "books", books })}
          />
        </Show>
      </form>

      {/* Which mode the list is in (SDD-0001 §13.3). The switcher has one mode, so no heading. */}
      <Show when={props.commands && !props.compact && (commandMode() || query() !== "")}>
        <h2 class="finder-mode label-large on-surface-variant">
          {commandMode() ? "Commands" : "Songs"}
        </h2>
      </Show>

      <Show when={noMatch()}>
        <EmptyCard
          kind="results"
          echo
          title={
            emptyFor()?.where && !commandMode()
              ? `No matches in ${clipEcho(emptyFor()?.where ?? "")}`
              : `No matches for “${clipEcho(emptyQuery() ?? "")}”`
          }
          action={
            emptyFor()?.where && !commandMode()
              ? {
                  label: "Search All Books",
                  onClick: () => {
                    chooseScope({ mode: "all" });
                    inputEl?.focus();
                  },
                }
              : undefined
          }
          ref={(el) => !props.compact && riseIn(el)}
        >
          {commandMode()
            ? "Try other words from a command’s name."
            : "Try a song number, or other words from the lyrics."}
        </EmptyCard>
      </Show>

      <Show when={!trimmed() && !props.compact && !commandMode()}>
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
      </Show>

      {/* Keyboard reaches the options through the input's
          aria-activedescendant (the ARIA combobox pattern), not focus. */}
      <div
        id={listId}
        class="list glide-list"
        classList={{ "finder-windowed": !props.compact }}
        role="listbox"
        aria-label={commandMode() ? "Matching commands" : "Matching songs"}
        onMouseLeave={() => setActiveIndex(undefined)}
        // A failed page is tried again by a tap on its line.
        onMouseDown={(event) => {
          const line = (event.target as Element).closest<HTMLElement>('[data-state="failed"]');
          if (!line?.dataset.group) return;
          event.preventDefault();
          retry(line.dataset.group);
        }}
        ref={(el) => {
          results = el;
          glide = glideList(el, { rows: ".finder-option" });
          onCleanup(glide.stop);
        }}
      >
        <Show
          when={props.compact}
          fallback={
            <>
              <div
                class="finder-spacer"
                aria-hidden="true"
                style={{ height: `${spaceBefore()}px` }}
              />
              <For each={sectionsInView()}>
                {(at) => {
                  const section = () => plan().sections[at];
                  return (
                    <div
                      class="finder-group"
                      {...(headed() && section()?.heading
                        ? { role: "group", "aria-labelledby": `${listId}-g-${at}` }
                        : section()?.group.id === COMMANDS_GROUP.id && headed()
                          ? { role: "group", "aria-label": COMMANDS_GROUP.title }
                          : { role: "presentation" })}
                    >
                      <Show when={section()?.heading}>
                        <div
                          class="finder-group-heading label-large on-surface-variant"
                          id={`${listId}-g-${at}`}
                        >
                          {section()?.group.title}
                        </div>
                      </Show>
                      <div
                        class="finder-spacer"
                        aria-hidden="true"
                        style={{ height: `${spaceAbove(at)}px` }}
                      />
                      <For each={bodyOf(at)}>
                        {(slot) =>
                          slot.kind === "row" ? (
                            <div
                              id={optionId(slot.index)}
                              role="option"
                              tabIndex={-1}
                              class="list-row finder-option"
                              aria-selected={active() === slot.index}
                              data-output-guard={guardOf(slot.row)}
                              aria-setsize={rows().length}
                              aria-posinset={slot.index + 1}
                              aria-current={
                                slot.row.kind === "hymn" &&
                                slot.row.item.number === props.current &&
                                slot.row.item.book === id()
                                  ? "true"
                                  : undefined
                              }
                              onMouseMove={() => setActiveIndex(slot.index)}
                              // mousedown, not click: keeps focus in the box while choosing.
                              onMouseDown={(event) => {
                                event.preventDefault();
                                if (slot.kind === "row") pick(slot.row);
                              }}
                            >
                              {optionContent(slot.row)}
                            </div>
                          ) : slot.kind === "status" ? (
                            <div
                              class="finder-status body-medium on-surface-variant"
                              data-state={slot.state}
                              data-group={slot.group.id}
                              role="presentation"
                            >
                              {slot.state === "loading"
                                ? "Loading more"
                                : slot.state === "failed"
                                  ? "Could not load more. Try again."
                                  : "End of results"}
                            </div>
                          ) : null
                        }
                      </For>
                      <div
                        class="finder-spacer"
                        aria-hidden="true"
                        style={{ height: `${spaceBelow(at)}px` }}
                      />
                    </div>
                  );
                }}
              </For>
              <div
                class="finder-spacer"
                aria-hidden="true"
                style={{ height: `${spaceAfter()}px` }}
              />
            </>
          }
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
                                  data-output-guard={guardOf(current())}
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
                                        {(book) => <MoreIn title={book().title} />}
                                      </Show>
                                    }
                                  >
                                    {(hymn) => (
                                      <>
                                        <span class="finder-number">#{hymn().number}</span>
                                        <span class="finder-text">
                                          <span class="finder-title">
                                            {titleCase(hymn().title)}
                                          </span>
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
        </Show>
      </div>
      {/* What the line that ends a paging list says, for a screen reader. */}
      <Show when={!props.compact}>
        <div class="visually-hidden" role="status">
          {fetching().size > 0 ? "Loading more results" : pagedToEnd() ? "No more results" : ""}
        </div>
      </Show>
    </div>
  );
}
