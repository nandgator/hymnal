import { createEffect, createSignal, For, on, Show } from "solid-js";
import type { HymnbookId, HymnNumber } from "../domain/types.ts";
import { type ContentStore, getContentStore } from "../persistence/content-store.ts";
import {
  userState as defaultUserState,
  type RecentEntry,
  type UserState,
} from "../persistence/user-state.ts";

export interface RecentsListProps {
  hymnbookId: HymnbookId;
  /** The hymn up now, if any, marked; its change also refreshes the list,
   * since opening a hymn records it as recent (SDD-0001 §14). */
  current?: HymnNumber;
  /** Defaults to {@link getContentStore}; overridable for tests. */
  store?: ContentStore;
  /** Defaults to the {@link defaultUserState} singleton; overridable for tests. */
  userState?: UserState;
  onSelect: (number: HymnNumber) => void;
}

/** When a hymn was opened: the time today, the weekday this week, else
 * the date — as the mockup's "9:41", "Sun". */
export function viewedLabel(viewedAt: number, now = Date.now()): string {
  const at = new Date(viewedAt);
  const today = new Date(now);
  if (at.toDateString() === today.toDateString()) {
    return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (now - viewedAt < 6 * 24 * 60 * 60 * 1000) {
    return at.toLocaleDateString([], { weekday: "short" });
  }
  return at.toLocaleDateString([], { day: "numeric", month: "short" });
}

type RecentRow = RecentEntry & { title: string };

/** Material's emphasised easing and a medium-long duration: a row can
 * travel the list's length. */
const EMPHASIZED = "cubic-bezier(0.2, 0, 0, 1)";
const GLIDE_MS = 400;

/** The last list read, per user state and book, shown at once on the next
 * mount and replaced by the read every mount makes, so it's never older
 * than one screen. Memory only: the user's own song numbers and titles,
 * already on this device. */
const lastReads = new WeakMap<UserState, Map<HymnbookId, RecentRow[]>>();

/** Recents (SDD-0001 §16.4): this book's recent hymns, newest first, as
 * number, title and when. One list wherever recents show — the Operator's
 * tab, the Finder, the song picker — so they never drift apart. */
export function RecentsList(props: RecentsListProps) {
  const store = () => props.store ?? getContentStore();
  const state = () => props.userState ?? defaultUserState;
  const lastRead = () => {
    const byBook = lastReads.get(state()) ?? new Map<HymnbookId, RecentRow[]>();
    lastReads.set(state(), byBook);
    return byBook;
  };
  // Entries and titles read together, so each row arrives whole. The list
  // mounts only once its screen has loaded, so a fresh read would always
  // land a frame after the rest: the last list read shows at once, and the
  // read that follows refreshes it.
  const [recents, setRecents] = createSignal<RecentRow[] | undefined>(
    lastRead().get(props.hymnbookId),
  );
  // A song chosen moves to the top: every row glides from where it was to
  // where it lands (FLIP), a new one fades in (DESIGN.md § Motion). Reduced
  // motion lands at once.
  let list: HTMLUListElement | undefined;
  const glide = (apply: () => void) => {
    const rows = () => [...(list?.querySelectorAll<HTMLElement>("[data-hymn]") ?? [])];
    const before = new Map(
      rows().map((row) => [row.dataset.hymn, row.getBoundingClientRect().top]),
    );
    apply();
    if (before.size === 0 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    for (const row of rows()) {
      const was = before.get(row.dataset.hymn);
      const timing = { duration: GLIDE_MS, easing: EMPHASIZED };
      if (was === undefined) row.animate?.([{ opacity: 0 }, { opacity: 1 }], timing);
      else {
        const dy = was - row.getBoundingClientRect().top;
        if (dy)
          row.animate?.([{ transform: `translateY(${dy}px)` }, { transform: "none" }], timing);
      }
    }
  };

  // Reads can overlap when songs change quickly; only the latest lands.
  let latest = 0;
  createEffect(
    on(
      () => ({ id: props.hymnbookId, current: props.current }),
      async ({ id }) => {
        const read = ++latest;
        const [entries, titles] = await Promise.all([state().getRecents(), store().listHymns(id)]);
        const rows = entries
          .filter((entry) => entry.hymnbookId === id)
          .map((entry) => ({
            ...entry,
            title: titles.find((hymn) => hymn.number === entry.hymnNumber)?.title ?? "",
          }));
        lastRead().set(id, rows);
        if (read === latest) glide(() => setRecents(rows));
      },
    ),
  );

  return (
    <Show
      when={recents()?.length}
      fallback={
        // Only once loaded: while loading, "No recent songs yet" would be
        // untrue for a moment.
        <Show when={recents()}>
          <p class="body-large on-surface-variant recents-empty">No recent songs yet.</p>
        </Show>
      }
    >
      <ul class="list recents" ref={list}>
        <For each={recents()}>
          {(entry) => (
            <li data-hymn={entry.hymnNumber}>
              <button
                type="button"
                class="list-row recents-row"
                aria-current={entry.hymnNumber === props.current ? "true" : undefined}
                onClick={() => props.onSelect(entry.hymnNumber)}
              >
                <span class="recents-number">#{entry.hymnNumber}</span>
                <span class="recents-title">{entry.title}</span>
                <span class="recents-when">{viewedLabel(entry.viewedAt)}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
