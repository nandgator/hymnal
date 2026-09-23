import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
import { BUNDLED_HYMNBOOK_ID } from "../config.ts";
import { createSequenceEngine, type SequenceEngine } from "../domain/sequence-engine.ts";
import type { Hymn, HymnbookId, HymnNumber, Part } from "../domain/types.ts";
import { type ContentStore, getContentStore } from "../persistence/content-store.ts";
import { userState as defaultUserState, type UserState } from "../persistence/user-state.ts";

// Most parts carry no label — it's printed only for numbered stanzas
// (SDD-0001 §2.1). Refrains, bridges and tags fall back to their kind.
function partLabel(part: Part): string {
  if (part.label) return part.label;
  return part.kind[0].toUpperCase() + part.kind.slice(1);
}

export interface PresenterProps {
  hymnNumber: HymnNumber;
  /** Defaults to {@link BUNDLED_HYMNBOOK_ID}; overridable for tests. */
  hymnbookId?: HymnbookId;
  /** Defaults to {@link getContentStore}; overridable for tests. */
  store?: ContentStore;
  /** Defaults to the {@link defaultUserState} singleton; overridable for tests. */
  userState?: UserState;
  /** Called when the presenter wants to search for a different hymn. */
  onBack?: () => void;
}

/**
 * Board #9 — walks a hymn's sequence, resolving occurrences to parts and
 * holding focus (arc42 §5.2). A hymn counts as "opened" once it loads here,
 * which is when it's recorded as recent — not when it was merely picked in
 * Finder (SDD-0001 §14).
 */
export function Presenter(props: PresenterProps) {
  const load = async (): Promise<Hymn> => {
    const hymnbookId = props.hymnbookId ?? BUNDLED_HYMNBOOK_ID;
    const store = props.store ?? getContentStore();
    const source = await store.getHymn(hymnbookId, props.hymnNumber);
    await (props.userState ?? defaultUserState).addRecent(hymnbookId, props.hymnNumber);
    return { hymnbookId, ...source };
  };
  const [hymn] = createResource(load);

  const [engine, setEngine] = createSignal<SequenceEngine>();
  createEffect(() => {
    // hymn.state, not hymn() — reading the resource itself rethrows once
    // it's errored, and that state is handled by the Switch/Match below.
    if (hymn.state === "ready") setEngine(createSequenceEngine(hymn()));
  });

  // Bumped after every engine mutation, so memos reading it re-derive —
  // SequenceEngine is a plain, non-reactive class (domain layer imports no
  // framework — ADR-0005).
  const [version, setVersion] = createSignal(0);
  const mutate = (run: (engine: SequenceEngine) => void) => {
    const current = engine();
    if (!current) return;
    run(current);
    setVersion((v) => v + 1);
  };

  const cursor = createMemo(() => {
    version();
    return engine()?.cursor;
  });
  const occurrence = createMemo(() => {
    version();
    return engine()?.current();
  });
  const canPrevious = createMemo(() => (cursor()?.occurrenceIndex ?? 0) > 0);
  const canNext = createMemo(() => {
    const e = engine();
    const at = cursor()?.occurrenceIndex;
    return e !== undefined && at !== undefined && at < e.length - 1;
  });

  const [showCues, setShowCues] = createSignal(true);

  // Full keyboard navigation (arc42 §8.8) — arrow keys for fine control,
  // Page Up/Down since that's what most presentation remotes/clickers send.
  const onKeyDown = (event: KeyboardEvent) => {
    const action: ((e: SequenceEngine) => void) | undefined = {
      ArrowRight: (e: SequenceEngine) => e.next(),
      PageDown: (e: SequenceEngine) => e.next(),
      ArrowLeft: (e: SequenceEngine) => e.previous(),
      PageUp: (e: SequenceEngine) => e.previous(),
      ArrowDown: (e: SequenceEngine) => e.nextLine(),
      ArrowUp: (e: SequenceEngine) => e.previousLine(),
    }[event.key];
    if (!action) return;
    event.preventDefault();
    mutate(action);
  };
  onMount(() => window.addEventListener("keydown", onKeyDown));
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  return (
    <Switch fallback={<p>Loading…</p>}>
      <Match when={hymn.error}>
        <div>
          <p>No hymn numbered {props.hymnNumber}.</p>
          <Show when={props.onBack}>
            <button type="button" onClick={() => props.onBack?.()}>
              Back to search
            </button>
          </Show>
        </div>
      </Match>
      <Match when={hymn()}>
        {(loaded) => (
          <article>
            <h2>
              {loaded().title} <small>#{loaded().number}</small>
            </h2>

            <Show when={occurrence()}>
              {(occ) => (
                <section aria-label="Current part">
                  <h3>
                    {partLabel(occ().part)}
                    <Show when={showCues() && occ().recurrenceIndex > 0}>
                      {" "}
                      <span>
                        {occ().recurrenceIndex + 1 === occ().totalRecurrences
                          ? "(final repeat)"
                          : "(repeat)"}
                      </span>
                    </Show>
                  </h3>
                  <ol class="hymn-text">
                    <For each={occ().part.lines}>
                      {(line, i) => (
                        <li aria-current={cursor()?.lineIndex === i() ? "true" : undefined}>
                          {line}
                        </li>
                      )}
                    </For>
                  </ol>
                </section>
              )}
            </Show>

            <nav aria-label="Navigate">
              <button
                type="button"
                onClick={() => mutate((e) => e.previous())}
                disabled={!canPrevious()}
              >
                Previous part
              </button>
              <button type="button" onClick={() => mutate((e) => e.previousLine())}>
                Previous line
              </button>
              <button type="button" onClick={() => mutate((e) => e.nextLine())}>
                Next line
              </button>
              <button type="button" onClick={() => mutate((e) => e.next())} disabled={!canNext()}>
                Next part
              </button>
            </nav>

            <label>
              <input
                type="checkbox"
                checked={showCues()}
                onChange={(event) => setShowCues(event.currentTarget.checked)}
              />
              Show repeat cues
            </label>

            <section aria-label="Jump to part">
              <h3>Parts</h3>
              <ul>
                <For each={loaded().parts}>
                  {(part) => (
                    <li>
                      <button type="button" onClick={() => mutate((e) => e.jumpToPart(part.id))}>
                        {partLabel(part)}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </section>

            <Show when={props.onBack}>
              <button type="button" onClick={() => props.onBack?.()}>
                Back to search
              </button>
            </Show>
          </article>
        )}
      </Match>
    </Switch>
  );
}
