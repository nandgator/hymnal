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
}

interface Selection {
  number: HymnNumber;
  title: string;
}

/**
 * Board #8 — retrieval by number and by lyric text, plus recents (arc42
 * §5.1). Selecting a hymn records it in user state and confirms the choice;
 * it does not render the hymn itself, which is Presenter's job (Board #9).
 */
export function Finder(props: FinderProps) {
  const id = () => props.hymnbookId ?? BUNDLED_HYMNBOOK_ID;
  const store = () => props.store ?? getContentStore();
  const state = () => props.userState ?? defaultUserState;

  const [hymns] = createResource(() => store().listHymns(id()));
  const titleFor = (number: HymnNumber) =>
    hymns()?.find((hymn) => hymn.number === number)?.title ?? `#${number}`;

  const [recents, { refetch: refetchRecents }] = createResource(() => state().getRecents());

  const [query, setQuery] = createSignal("");
  const [submitted, setSubmitted] = createSignal("");
  const [selection, setSelection] = createSignal<Selection>();
  const [error, setError] = createSignal<string>();

  const select = async (number: HymnNumber, title: string) => {
    await state().addRecent(id(), number);
    setSelection({ number, title });
    refetchRecents();
  };

  const [results] = createResource(submitted, async (submittedQuery): Promise<SearchResult[]> => {
    setSelection(undefined);
    setError(undefined);
    const trimmed = submittedQuery.trim();
    if (!trimmed) return [];

    if (/^\d+$/.test(trimmed)) {
      try {
        const hymn = await store().getHymn(id(), Number(trimmed));
        await select(hymn.number, hymn.title);
      } catch {
        setError(`No hymn numbered ${trimmed}.`);
      }
      return [];
    }

    const found = await store().searchLyrics(id(), trimmed);
    if (found.length === 0) setError(`No matches for "${trimmed}".`);
    return found;
  });

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(query());
        }}
      >
        <input
          type="text"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder="Hymn number or lyrics"
          aria-label="Find a hymn"
        />
        <button type="submit">Find</button>
      </form>

      <Show when={selection()}>
        {(selected) => (
          <p>
            Selected: {selected().title} (#{selected().number})
          </p>
        )}
      </Show>

      <Show when={error()}>{(message) => <p>{message()}</p>}</Show>

      <Show when={results()?.length}>
        <ul>
          <For each={results()}>
            {(result) => (
              <li>
                <button type="button" onClick={() => select(result.number, result.title)}>
                  {result.title}
                  {result.snippet ? ` — ${result.snippet}` : ""}
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>

      <Show when={!submitted()}>
        <section>
          <h2>Recent</h2>
          <Show when={recents()?.length} fallback={<p>No recent hymns yet.</p>}>
            <ul>
              <For each={recents()}>
                {(entry) => (
                  <li>
                    <button
                      type="button"
                      onClick={() => select(entry.hymnNumber, titleFor(entry.hymnNumber))}
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
