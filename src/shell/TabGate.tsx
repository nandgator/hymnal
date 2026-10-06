import { createEffect, createSignal, type JSX, onCleanup, Show } from "solid-js";
import { subscribePresence } from "../output/channel.ts";
import { contentBusy, releaseContent } from "../persistence/content-store.ts";
import { choosePool, type OpfsProbe, probeOpfs } from "../persistence/pool-init.ts";
import { browserTabLock, type TabLock, type TabState } from "./tabLock.ts";
import { type AppUpdates, createAppUpdates, createPresence, type Presence } from "./updates.ts";

export interface Shared {
  presence: Presence;
  appUpdates: AppUpdates;
}

// With "Use Here" still offered after each: another try is always allowed.
const MESSAGES: Partial<Record<TabState, string>> = {
  other: "Only one tab can hold your books at a time. Use it here, and the other tab will let go.",
  presenting: "The other tab is presenting. Close its Output window first, then use Hymnal here.",
  saving: "The other tab is saving a book. Try again in a moment.",
  silent: "The other tab didn't answer. Close it, or try again.",
};

// A tab's books in memory live only in that tab, so Use Here would lose them (SDD-0004 §15).
const MEMORY_OTHER =
  "The other tab holds this window’s books, in memory. Use them here, and they go.";

// A page cannot see `createSyncAccessHandle` (workers only): the page asks of the root alone,
// and the worker's own probe has the last word.
const pageProbe = () =>
  probeOpfs({
    storage: typeof navigator === "undefined" ? undefined : navigator.storage,
    hasSyncHandle: true,
  });

const defaultLock = (isLive: () => boolean) =>
  browserTabLock(
    isLive,
    () => releaseContent(),
    () => contentBusy(),
  );

/**
 * The Operator's gate (SDD-0001 §10.4): only the tab that owns the content
 * store shows the app; another says so, with "Use Here". Presence and the
 * update takeover live here, not in the app, so a tab showing the note still
 * reloads onto a new version. Where the browser has no Web Locks, the app
 * shows as it always did.
 */
export function TabGate(props: {
  children: (shared: Shared) => JSX.Element;
  /** The lock, made from the live check; tests pass fakes. */
  makeLock?: (isLive: () => boolean) => TabLock | undefined;
  /** What this window's OPFS is, without starting a worker; tests pass fakes. */
  probe?: () => Promise<OpfsProbe>;
}) {
  const presence = createPresence(subscribePresence);
  const appUpdates = createAppUpdates(presence.live);
  const shared: Shared = { presence, appUpdates };
  const lock = (props.makeLock ?? defaultLock)(presence.live);
  // The dev hook opens the store, so only the tab that owns it installs it
  // (every tab, where there is no lock).
  const installDev = () =>
    void import("../dev/hymnal-dev.ts").then((module) => module.installHymnalDev());
  if (!lock) {
    if (import.meta.env.DEV) installDev();
    return <>{props.children(shared)}</>;
  }

  const [state, setState] = createSignal<TabState>(lock.state());
  const [inMemory, setInMemory] = createSignal(false);
  (props.probe ?? pageProbe)().then(
    (found) => setInMemory(choosePool(found).mode === "memory"),
    () => {},
  );
  lock.onChange(setState);
  lock.start();
  onCleanup(() => lock.dispose());

  createEffect(() => {
    if (import.meta.env.DEV && state() === "owner") installDev();
  });

  return (
    <Show
      when={state() === "owner"}
      fallback={
        <Show when={state() !== "checking"}>
          <main class="tab-note">
            <div class="card-elevated library lib-empty">
              <h1 class="display-small">Hymnal is open in another tab</h1>
              <p class="body-large on-surface-variant" role="status">
                {state() === "other" && inMemory()
                  ? MEMORY_OTHER
                  : (MESSAGES[state()] ?? MESSAGES.other)}
              </p>
              <button
                type="button"
                class="btn-filled"
                disabled={state() === "asking"}
                onClick={() => lock.useHere()}
              >
                Use Here
              </button>
            </div>
          </main>
        </Show>
      }
    >
      {props.children(shared)}
    </Show>
  );
}
