import { createResource, For, Show } from "solid-js";
import type { HymnbookId, HymnNumber } from "../domain/types.ts";
import { type ContentStore, getContentStore } from "../persistence/content-store.ts";
import { userState as defaultUserState, type UserState } from "../persistence/user-state.ts";

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

/** Recents (SDD-0001 §16.4): this book's recent hymns, newest first, as
 * number, title and when. One list wherever recents show — the Operator's
 * tab, the Finder, the song picker — so they never drift apart. */
export function RecentsList(props: RecentsListProps) {
  const store = () => props.store ?? getContentStore();
  const [titles] = createResource(
    () => props.hymnbookId,
    async (id) => new Map((await store().listHymns(id)).map((hymn) => [hymn.number, hymn.title])),
  );
  const [recents] = createResource(
    () => ({ id: props.hymnbookId, current: props.current }),
    async ({ id }) =>
      (await (props.userState ?? defaultUserState).getRecents()).filter(
        (entry) => entry.hymnbookId === id,
      ),
  );

  return (
    <Show
      when={recents()?.length}
      fallback={<p class="body-large on-surface-variant recents-empty">No recent songs yet.</p>}
    >
      <ul class="list recents">
        <For each={recents()}>
          {(entry) => (
            <li>
              <button
                type="button"
                class="list-row recents-row"
                aria-current={entry.hymnNumber === props.current ? "true" : undefined}
                onClick={() => props.onSelect(entry.hymnNumber)}
              >
                <span class="recents-number">#{entry.hymnNumber}</span>
                <span class="recents-title">{titles()?.get(entry.hymnNumber) ?? ""}</span>
                <span class="recents-when">{viewedLabel(entry.viewedAt)}</span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
