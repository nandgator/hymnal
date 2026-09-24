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
import {
  createSequenceEngine,
  flattenLines,
  type SequenceEngine,
} from "../domain/sequence-engine.ts";
import type { Hymn, HymnbookId, HymnNumber, Part } from "../domain/types.ts";
import { publishOutput } from "../output/channel.ts";
import { type ContentStore, getContentStore } from "../persistence/content-store.ts";
import { userState as defaultUserState, type UserState } from "../persistence/user-state.ts";

// Most parts carry no label — it's printed only for numbered stanzas
// (SDD-0001 §2.1). Refrains, bridges and tags fall back to their kind.
function partLabel(part: Part): string {
  if (part.label) return part.label;
  return part.kind[0].toUpperCase() + part.kind.slice(1);
}

const DOCK_COLLAPSE_MAX = 3;
const MIN_CHIP_COLUMNS = 3;
const FAB_GAP_PX = 16;

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

  // Publish to the Output window on every navigation (SDD-0001 §16.1).
  // Output owns no state of its own; unmounting blanks it rather than
  // leaving the last hymn frozen on the audience's screen.
  createEffect(() => {
    version();
    const e = engine();
    if (!e) return;
    publishOutput({
      type: "content",
      hymnbookId: e.hymn.hymnbookId,
      number: e.hymn.number,
      title: e.hymn.title,
      ...flattenLines(e),
    });
  });
  onCleanup(() => publishOutput({ type: "idle" }));

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

  // Keep the focus in view after each step. A part longer than the card's
  // cap scrolls inside the card (DESIGN.md § Stability): line focus
  // scrolls the focused line into view there, whole-part focus returns the
  // part to its top. The page itself isn't meant to scroll mid-service.
  let cardRef: HTMLElement | undefined;
  createEffect(() => {
    version();
    const lineIndex = cursor()?.lineIndex;
    // A compressed rail scrolls; keep the current part's chip in it.
    document
      .querySelector<HTMLElement>('.chip-filter[aria-pressed="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
    const part = cardRef?.querySelector<HTMLElement>(".lyrics:not(.lyrics-hidden)");
    if (!part) return;
    if (lineIndex == null) {
      part.scrollTop = 0;
      return;
    }
    part
      .querySelector<HTMLElement>('li[aria-current="true"]')
      ?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  });

  // Dock labels collapse to icon-only in reverse priority (lines, then the
  // FAB, then parts) only when the labelled row genuinely doesn't fit.
  // Measured, not breakpoints: type scales with the viewport and the user's
  // text size, so no breakpoint could track a button's width (DESIGN.md §
  // Stability). The level lives on the root element because the FAB is
  // App's, not Presenter's.
  let dockRef: HTMLElement | undefined;
  const fitDock = () => {
    const dock = dockRef;
    if (!dock) return;
    const root = document.documentElement;
    const fab = document.querySelector<HTMLElement>(".fab-fixed");
    // Geometry, not scrollWidth: an overflowing flex row's scrollWidth leaves
    // out its trailing padding, so it can't see the FAB's clearance.
    const limit = () =>
      fab ? fab.getBoundingClientRect().left - FAB_GAP_PX : dock.getBoundingClientRect().right;
    // Each pair (parts, lines) shares one width, the wider of the two at
    // this collapse level (DESIGN.md § Structure).
    const equalizePair = (selector: string, property: string) => {
      dock.style.removeProperty(property);
      const widths = [...dock.querySelectorAll<HTMLElement>(selector)].map(
        (button) => button.getBoundingClientRect().width,
      );
      dock.style.setProperty(property, `${Math.ceil(Math.max(0, ...widths))}px`);
    };
    for (let level = 0; level <= DOCK_COLLAPSE_MAX; level++) {
      root.dataset.dockCollapse = String(level);
      equalizePair(".dock-part", "--dock-part-width");
      equalizePair(".dock-line", "--dock-line-width");
      const clearance = fab ? fab.offsetWidth + 2 * FAB_GAP_PX : 0;
      dock.style.setProperty("--fab-clearance", `${clearance}px`);
      const last = dock.lastElementChild?.getBoundingClientRect();
      if (!last || last.right <= limit()) return;
    }
  };
  onMount(() => {
    window.addEventListener("resize", fitDock);
    // Settings changes --font-scale through the root's style attribute.
    const scaleObserver = new MutationObserver(fitDock);
    scaleObserver.observe(document.documentElement, { attributeFilter: ["style"] });
    void document.fonts?.ready.then(fitDock);
    onCleanup(() => {
      window.removeEventListener("resize", fitDock);
      scaleObserver.disconnect();
      delete document.documentElement.dataset.dockCollapse;
    });
  });

  const backButton = () => (
    <Show when={props.onBack}>
      <button type="button" class="btn-text" onClick={() => props.onBack?.()}>
        <span class="icon icon-arrow-back" aria-hidden="true" />
        Back to search
      </button>
    </Show>
  );

  // Icon matches the key that does the same thing (arc42 §8.8): chevrons
  // for parts (left/right), arrows for lines (up/down). Parts outrank lines
  // (DESIGN.md § Structure): emphasis follows, and line labels are the
  // first to collapse to icon-only. Labels stay the accessible name.
  const dockButton = (
    label: string,
    icon: string,
    variant: "btn-filled" | "btn-tonal" | "btn-outlined",
    action: (e: SequenceEngine) => void,
    disabled?: () => boolean,
  ) => (
    <button
      type="button"
      class={`${variant} dock-button ${variant === "btn-outlined" ? "dock-line" : "dock-part"}`}
      onClick={() => mutate(action)}
      disabled={disabled?.()}
    >
      <span class={`icon ${icon}`} aria-hidden="true" />
      <span class="dock-label">{label}</span>
    </button>
  );

  return (
    <Switch fallback={<p class="body-large on-surface-variant">Loading…</p>}>
      <Match when={hymn.error}>
        <div class="card-elevated library">
          <p class="body-large">No hymn numbered {props.hymnNumber}.</p>
          {backButton()}
        </div>
      </Match>
      <Match when={hymn()}>
        {(loaded) => (
          <article class="operator">
            <header class="operator-header">
              {backButton()}
              <h2 class="title-large">
                {loaded().title} <small class="on-surface-variant">#{loaded().number}</small>
              </h2>
            </header>

            <div class="operator-body">
              <Show when={occurrence()}>
                {(occ) => (
                  <section
                    ref={cardRef}
                    class="card-elevated lyrics-card"
                    aria-label="Current part"
                  >
                    <h3 class="title-medium lyrics-card-heading">
                      {partLabel(occ().part)}
                      <Show when={showCues() && occ().repeatOrdinal > 1}>
                        {" "}
                        <span class="chip-assist">(Repeat {occ().repeatOrdinal})</span>
                      </Show>
                    </h3>
                    {/* Every part shares one grid cell and only the current one
                        is visible, so the card is always as tall as the hymn's
                        longest part and nothing below it moves (DESIGN.md §
                        Stability). */}
                    <div class="lyrics-stack">
                      <For each={loaded().parts}>
                        {(part) => {
                          const isCurrent = () => part.id === occ().part.id;
                          return (
                            <ol
                              class="hymn-text lyrics"
                              classList={{
                                "lyrics-hidden": !isCurrent(),
                                "lyrics-line-focus": isCurrent() && cursor()?.lineIndex != null,
                              }}
                              aria-hidden={isCurrent() ? undefined : "true"}
                            >
                              <For each={part.lines}>
                                {(line, i) => (
                                  <li
                                    aria-current={
                                      isCurrent() && cursor()?.lineIndex === i()
                                        ? "true"
                                        : undefined
                                    }
                                  >
                                    {line}
                                  </li>
                                )}
                              </For>
                            </ol>
                          );
                        }}
                      </For>
                    </div>
                  </section>
                )}
              </Show>
              <aside class="parts-rail">
                <section aria-label="Jump to part">
                  <h3 class="title-medium on-surface-variant">Parts</h3>
                  <ul
                    class="chip-set"
                    style={{
                      "--stanza-count": String(
                        Math.max(MIN_CHIP_COLUMNS, loaded().parts.filter((p) => p.label).length),
                      ),
                    }}
                  >
                    <For each={loaded().parts}>
                      {(part) => (
                        <li>
                          <button
                            type="button"
                            class="chip-filter"
                            classList={{ "chip-wide": !part.label }}
                            aria-pressed={occurrence()?.part.id === part.id}
                            onClick={() => mutate((e) => e.jumpToPart(part.id))}
                          >
                            {partLabel(part)}
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
                <label class="switch-row body-large">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={showCues()}
                    class="switch"
                    checked={showCues()}
                    onChange={(event) => setShowCues(event.currentTarget.checked)}
                  />
                  Show repeat cues
                </label>
              </aside>
            </div>

            <nav
              class="dock"
              aria-label="Navigate"
              ref={(el) => {
                dockRef = el;
                queueMicrotask(fitDock);
              }}
            >
              {dockButton(
                "Previous part",
                "icon-chevron-left",
                "btn-tonal",
                (e) => e.previous(),
                () => !canPrevious(),
              )}
              {dockButton("Previous line", "icon-arrow-up", "btn-outlined", (e) =>
                e.previousLine(),
              )}
              {dockButton("Next line", "icon-arrow-down", "btn-outlined", (e) => e.nextLine())}
              {dockButton(
                "Next part",
                "icon-chevron-right",
                "btn-filled",
                (e) => e.next(),
                () => !canNext(),
              )}
            </nav>
          </article>
        )}
      </Match>
    </Switch>
  );
}
