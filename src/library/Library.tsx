import {
  type Accessor,
  createEffect,
  createResource,
  createSignal,
  Match,
  Show,
  Switch,
} from "solid-js";
import { BUNDLED_HYMNBOOK_ID } from "../config.ts";
import type { Hymnbook, HymnbookId } from "../domain/types.ts";
import {
  type ContentStatus,
  type ContentStore,
  getContentStore,
  type InstallProgress,
} from "../persistence/content-store.ts";
import { AfterDelay, ProgressBar } from "../shell/Loading.tsx";

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
        return `This songbook needs an app update (found schema ${error.status.found}, need ${error.status.expected}).`;
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
  /** Called with the hymnbook once provisioned — the shell's switcher row
   * shows it, and Present becomes available. */
  onLoaded?: (hymnbook: Hymnbook) => void;
}

const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1);

/** The card to come, in its place: title, count line, button. */
const librarySkeleton = () => (
  <div class="card-elevated library" role="status" aria-busy="true">
    <span class="visually-hidden">Loading…</span>
    <span class="skeleton skeleton-title" aria-hidden="true" />
    <span class="skeleton skeleton-line" aria-hidden="true" />
    <span class="skeleton skeleton-button" aria-hidden="true" />
  </div>
);

/** A first install: the songbook copied to this device, once. The title is
 * in the file still arriving, so the words can't name it. */
const installing = (progress: Accessor<InstallProgress>) => (
  <div class="card-elevated library" aria-busy="true">
    <p class="body-large">Installing the songbook for offline use…</p>
    <ProgressBar
      label="Installing the songbook"
      value={progress().total ? progress().loaded / (progress().total ?? 1) : undefined}
    />
    <p class="body-medium on-surface-variant library-progress-text">
      {progress().total
        ? `${megabytes(progress().loaded)} of ${megabytes(progress().total ?? 0)} MB`
        : `${megabytes(progress().loaded)} MB`}
    </p>
  </div>
);

/**
 * Board #7 — the first-run provisioning gate, and arc42's "know which are
 * available offline" home for as long as there's exactly one hymnbook to
 * know about.
 */
export function Library(props: LibraryProps) {
  // Set once the first install's download reports: a real wait, so real
  // progress rather than a skeleton (DESIGN.md § Structure).
  const [progress, setProgress] = createSignal<InstallProgress>();
  const load = async (): Promise<Hymnbook> => {
    const id = props.hymnbookId ?? BUNDLED_HYMNBOOK_ID;
    const store = props.store ?? getContentStore();
    setProgress(undefined);
    const status = await store.ensureInstalled(id, (next) => setProgress(next));
    if (status.state !== "ready") throw new ContentUnavailable(status);
    return store.getHymnbook(id);
  };
  const [hymnbook, { refetch }] = createResource(load);
  createEffect(() => {
    if (hymnbook.state === "ready") props.onLoaded?.(hymnbook());
  });

  return (
    <Switch
      fallback={
        <AfterDelay>
          <Show when={progress()} fallback={librarySkeleton()}>
            {(now) => installing(now)}
          </Show>
        </AfterDelay>
      }
    >
      <Match when={hymnbook.error}>
        <div class="card-elevated library">
          <p class="body-large">{describeError(hymnbook.error)}</p>
          <button type="button" class="btn-filled" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      </Match>
      <Match when={hymnbook()}>
        {(book: Accessor<Hymnbook>) => (
          <div class="card-elevated library">
            <h1 class="display-small">{book().title}</h1>
            <p class="body-large on-surface-variant">
              {book().hymnCount} songs
              {book().edition ? ` · ${book().edition}` : ""}
            </p>
            <Show when={props.onReady}>
              <button type="button" class="btn-filled" onClick={() => props.onReady?.()}>
                Find a Song
              </button>
            </Show>
          </div>
        )}
      </Match>
    </Switch>
  );
}
