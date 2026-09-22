import { type Accessor, createResource, Match, Show, Switch } from "solid-js";
import { BUNDLED_HYMNBOOK_ID } from "../config.ts";
import type { Hymnbook, HymnbookId } from "../domain/types.ts";
import {
  type ContentStatus,
  type ContentStore,
  getContentStore,
} from "../persistence/content-store.ts";

class ContentUnavailable extends Error {
  readonly status: Exclude<ContentStatus, { state: "ready" }>;

  constructor(status: Exclude<ContentStatus, { state: "ready" }>) {
    super(`content unavailable: ${status.state}`);
    this.status = status;
  }
}

function describeError(error: unknown): string {
  if (error instanceof ContentUnavailable) {
    switch (error.status.state) {
      case "missing-asset":
        return "The hymnbook file is missing. Try reloading.";
      case "corrupt":
        return "The hymnbook file is damaged. Try reinstalling.";
      case "schema-mismatch":
        return `This hymnbook needs an app update (found schema ${error.status.found}, need ${error.status.expected}).`;
    }
  }
  return "Something went wrong loading the hymnbook.";
}

export interface LibraryProps {
  /** Defaults to {@link BUNDLED_HYMNBOOK_ID}; overridable for tests. */
  hymnbookId?: HymnbookId;
  /** Defaults to {@link getContentStore}; overridable for tests. */
  store?: ContentStore;
  /** Called once content is ready. The app uses this to move on to Finder. */
  onReady?: () => void;
}

/**
 * Board #7 — the first-run provisioning gate, and arc42's "know which are
 * available offline" home for as long as there's exactly one hymnbook to
 * know about.
 */
export function Library(props: LibraryProps) {
  const load = async (): Promise<Hymnbook> => {
    const id = props.hymnbookId ?? BUNDLED_HYMNBOOK_ID;
    const store = props.store ?? getContentStore();
    const status = await store.ensureInstalled(id);
    if (status.state !== "ready") throw new ContentUnavailable(status);
    return store.getHymnbook(id);
  };
  const [hymnbook, { refetch }] = createResource(load);

  return (
    <Switch fallback={<p>Loading…</p>}>
      <Match when={hymnbook.error}>
        <div>
          <p>{describeError(hymnbook.error)}</p>
          <button type="button" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      </Match>
      <Match when={hymnbook()}>
        {(book: Accessor<Hymnbook>) => (
          <div>
            <h1>{book().title}</h1>
            <p>
              {book().hymnCount} hymns
              {book().edition ? ` · ${book().edition}` : ""}
            </p>
            <Show when={props.onReady}>
              <button type="button" onClick={() => props.onReady?.()}>
                Find a hymn
              </button>
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  );
}
