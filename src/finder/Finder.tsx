import { createResource, createSignal, For, Show } from "solid-js";
import { BUNDLED_HYMNBOOK_ID } from "../config.ts";
import type { HymnbookId, HymnNumber } from "../domain/types.ts";
import {
  type ContentStore,
  getContentStore,
  type SearchResult,
} from "../persistence/content-store.ts";
import { userState as defaultUserState, type UserState } from "../persistence/user-state.ts";

export interface FinderProps {
  /** Defaults to {@link BUNDLED_HYMNBOOK_ID}; overridable for tests. */
  hymnbookId?: HymnbookId;
  /** Defaults to {@link getContentStore}; overridable for tests. */
  store?: ContentStore;
  /** Defaults to the {@link defaultUserState} singleton; overridable for tests. */
  userState?: UserState;
  /** Called with the chosen hymn number — number lookup, a search result, or a recent. */
  onSelect: (number: HymnNumber) => void;
  /** Called when the user wants to go back to hymnbook selection. */
  onBack?: () => void;
}

/**
 * Board #8 — retrieval by number and by lyric text, plus recents (arc42
 * §5.1). Picking a hymn hands its number to `onSelect` and nothing else:
 * opening it, and recording it as recent, is Presenter's job (Board #9).
 */
export function Finder(props: FinderProps) {
  const id = () => props.hymnbookId ?? BUNDLED_HYMNBOOK_ID;
  const store = () => props.store ?? getContentStore();
  const state = () => props.userState ?? defaultUserState;

  const [hymns] = createResource(() => store().listHymns(id()));
  const titleFor = (number: HymnNumber) =>
    hymns()?.find((hymn) => hymn.number === number)?.title ?? `#${number}`;

  const [recents] = createResource(() => state().getRecents());

  const [query, setQuery] = createSignal("");
  const [submitted, setSubmitted] = createSignal("");
  const [error, setError] = createSignal<string>();

  const [results] = createResource(submitted, async (submittedQuery): Promise<SearchResult[]> => {
    setError(undefined);
    const trimmed = submittedQuery.trim();
    if (!trimmed) return [];

    if (/^\d+$/.test(trimmed)) {
      props.onSelect(Number(trimmed));
      return [];
    }

    const found = await store().searchLyrics(id(), trimmed);
    if (found.length === 0) setError(`No matches for "${trimmed}".`);
    return found;
  });

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
          setSubmitted(query());
        }}
      >
        <div class="text-field">
          <input
            type="text"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Hymn number or lyrics"
            aria-label="Find a hymn"
          />
        </div>
        <button type="submit" class="btn-filled">
          Find
        </button>
      </form>

      <Show when={error()}>{(message) => <p class="body-large">{message()}</p>}</Show>

      <Show when={results()?.length}>
        <ul class="list">
          <For each={results()}>
            {(result) => (
              <li>
                <button
                  type="button"
                  class="list-row"
                  onClick={() => props.onSelect(result.number)}
                >
                  {result.title}
                  {/* The matched line is often the first line, which is the title. */}
                  <Show when={result.snippet !== result.title && result.snippet}>
                    {(snippet) => <span class="list-row-supporting"> — {snippet()}</span>}
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={!submitted()}>
        <section>
          <h2 class="title-medium on-surface-variant">Recent</h2>
          <Show
            when={recents()?.length}
            fallback={<p class="body-large on-surface-variant">No recent hymns yet.</p>}
          >
            <ul class="list">
              <For each={recents()}>
                {(entry) => (
                  <li>
                    <button
                      type="button"
                      class="list-row"
                      onClick={() => props.onSelect(entry.hymnNumber)}
                    >
                      {titleFor(entry.hymnNumber)}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
      </Show>
    </div>
  );
}
