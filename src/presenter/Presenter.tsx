import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Index,
  type JSX,
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
import type { Hymn, HymnbookId, HymnNumber, Occurrence, Part } from "../domain/types.ts";
import { type OutputMessage, publishOutput } from "../output/channel.ts";
import { type ContentStore, getContentStore } from "../persistence/content-store.ts";
import { userState as defaultUserState, type UserState } from "../persistence/user-state.ts";
import { createMediaQuery, EXPANDED_QUERY } from "../shell/media.ts";
import { Sheet } from "../shell/Sheet.tsx";

// Most parts carry no label — it's printed only for numbered stanzas
// (SDD-0001 §2.1). Refrains, bridges and tags fall back to their kind.
function partLabel(part: Part): string {
  if (part.label) return part.label;
  return part.kind[0].toUpperCase() + part.kind.slice(1);
}

const DOCK_COLLAPSE_MAX = 3;
const MIN_CHIP_COLUMNS = 3;
const FAB_GAP_PX = 16;
/** A supporting pane: data, not layout code (SDD-0001 §16.4). */
interface Pane {
  id: string;
  title: string;
  icon: string;
  render: () => JSX.Element;
}

export interface PresenterProps {
  hymnNumber: HymnNumber;
  /** Defaults to {@link BUNDLED_HYMNBOOK_ID}; overridable for tests. */
  hymnbookId?: HymnbookId;
  /** Defaults to {@link getContentStore}; overridable for tests. */
  store?: ContentStore;
  /** Defaults to the {@link defaultUserState} singleton; overridable for tests. */
  userState?: UserState;
  /** Called when a hymn fails to load and the operator wants to pick another. */
  onBack?: () => void;
  /** Called with each hymn once loaded — the shell's switcher row shows it. */
  onLoaded?: (hymn: Hymn) => void;
}

/**
 * Board #9 — walks a hymn's sequence, resolving occurrences to parts and
 * holding focus (arc42 §5.2). A hymn counts as "opened" once it loads here,
 * which is when it's recorded as recent — not when it was merely picked in
 * Finder (SDD-0001 §14).
 */
export function Presenter(props: PresenterProps) {
  // Keyed on the hymn, so choosing another in the switcher row hot-swaps
  // in place (SDD-0001 §16.4): a new engine, the cursor at its start,
  // recents updated, the Output snapping to it — while this screen, the
  // Output window and the pane choices all stay.
  const load = async (key: { hymnbookId: HymnbookId; number: HymnNumber }): Promise<Hymn> => {
    const store = props.store ?? getContentStore();
    const source = await store.getHymn(key.hymnbookId, key.number);
    await (props.userState ?? defaultUserState).addRecent(key.hymnbookId, key.number);
    return { hymnbookId: key.hymnbookId, ...source };
  };
  const [hymn] = createResource(
    () => ({ hymnbookId: props.hymnbookId ?? BUNDLED_HYMNBOOK_ID, number: props.hymnNumber }),
    load,
  );

  const [engine, setEngine] = createSignal<SequenceEngine>();
  createEffect(() => {
    // hymn.state, not hymn() — reading the resource itself rethrows once
    // it's errored, and that state is handled by the Switch/Match below.
    if (hymn.state === "ready") {
      const loaded = hymn();
      setEngine(createSequenceEngine(loaded));
      props.onLoaded?.(loaded);
    }
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

  // What the Output shows — published to the Output window on every
  // navigation (SDD-0001 §16.1), and the Live pane renders the very same
  // message, so the preview can't disagree with the audience screen
  // (§16.4). Unmounting blanks the Output rather than leaving the last
  // hymn frozen on the audience's screen.
  const outputMessage = createMemo((): Extract<OutputMessage, { type: "content" }> | undefined => {
    version();
    const e = engine();
    if (!e) return undefined;
    return {
      type: "content",
      hymnbookId: e.hymn.hymnbookId,
      number: e.hymn.number,
      title: e.hymn.title,
      ...flattenLines(e),
    };
  });
  createEffect(() => {
    const message = outputMessage();
    if (message) publishOutput(message);
  });
  onCleanup(() => publishOutput({ type: "idle" }));

  // The whole effective path, for the Sequence pane.
  const occurrences = createMemo((): Occurrence[] => {
    version();
    const e = engine();
    if (!e) return [];
    return Array.from({ length: e.length }, (_, i) => e.occurrenceAt(i)).filter(
      (occ): occ is Occurrence => occ !== undefined,
    );
  });

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

  // Keep the current block centred in the Sequence pane, like the Output:
  // the focused line under line focus, the whole block otherwise — or its
  // top, when the block is taller than the pane. The pane scrolls, never
  // the page (DESIGN.md § Stability).
  let sequenceRef: HTMLElement | undefined;
  createEffect(() => {
    version();
    const lineIndex = cursor()?.lineIndex;
    document
      .querySelector<HTMLElement>('.chip-filter[aria-pressed="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
    const block = sequenceRef?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!block || !sequenceRef) return;
    const line =
      lineIndex == null ? null : block.querySelector<HTMLElement>('.seq-line[aria-current="true"]');
    const fits = block.offsetHeight <= sequenceRef.clientHeight;
    (line ?? block).scrollIntoView?.({
      block: line || fits ? "center" : "start",
      behavior: "smooth",
    });
  });

  const expanded = createMediaQuery(EXPANDED_QUERY);
  const [openSheet, setOpenSheet] = createSignal<string>();
  const showSheet = (id: string) => setOpenSheet(id);
  const closeSheet = () => setOpenSheet(undefined);

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

  const livePane = () => (
    <Show when={outputMessage()}>
      {(message) => (
        <div class="live-preview" role="img" aria-label="Live output preview">
          <For
            each={message().lines.slice(
              Math.max(0, message().focus.start - 1),
              message().focus.end + 1,
            )}
          >
            {(line, i) => {
              const index = () => Math.max(0, message().focus.start - 1) + i();
              return (
                <p
                  class="live-line"
                  classList={{
                    "live-line-current":
                      index() >= message().focus.start && index() < message().focus.end,
                  }}
                >
                  {line.text}
                </p>
              );
            }}
          </For>
        </div>
      )}
    </Show>
  );

  const partsPane = (loaded: Hymn) => (
    <>
      <section aria-label="Jump to part">
        <ul
          class="chip-set"
          style={{
            "--stanza-count": String(
              Math.max(MIN_CHIP_COLUMNS, loaded.parts.filter((p) => p.label).length),
            ),
          }}
        >
          <For each={loaded.parts}>
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
    </>
  );

  // Supporting panes, in display order (SDD-0001 §16.4). A new pane is one
  // more entry here.
  const panes = (loaded: Hymn): Pane[] => [
    { id: "live", title: "Live", icon: "icon-present", render: livePane },
    { id: "parts", title: "Parts", icon: "icon-grid", render: () => partsPane(loaded) },
  ];

  const sequencePane = () => (
    <section class="sequence" aria-label="Sequence" ref={sequenceRef}>
      <ol class="seq-list">
        <Index each={occurrences()}>
          {(occ, i) => {
            const isCurrent = () => cursor()?.occurrenceIndex === i;
            return (
              <li
                class="seq-block"
                classList={{ "seq-line-focus": isCurrent() && cursor()?.lineIndex != null }}
                aria-current={isCurrent() ? "step" : undefined}
              >
                <h3 class="seq-heading">
                  <button
                    type="button"
                    class="seq-head title-medium"
                    onClick={() => mutate((e) => e.goTo(i))}
                  >
                    {partLabel(occ().part)}
                  </button>
                  <Show when={showCues() && occ().repeatOrdinal > 1}>
                    <span class="chip-assist">(Repeat {occ().repeatOrdinal})</span>
                  </Show>
                </h3>
                <ol class="hymn-text seq-lines">
                  <Index each={occ().part.lines}>
                    {(line, lineIndex) => (
                      <li>
                        <button
                          type="button"
                          class="seq-line"
                          aria-current={
                            isCurrent() && cursor()?.lineIndex === lineIndex ? "true" : undefined
                          }
                          onClick={() => mutate((e) => e.goTo(i, lineIndex))}
                        >
                          {line()}
                        </button>
                      </li>
                    )}
                  </Index>
                </ol>
              </li>
            );
          }}
        </Index>
      </ol>
    </section>
  );

  return (
    <Switch fallback={<p class="body-large on-surface-variant">Loading…</p>}>
      <Match when={hymn.error}>
        <div class="card-elevated library">
          <p class="body-large">No hymn numbered {props.hymnNumber}.</p>
          {backButton()}
        </div>
      </Match>
      {/* hymn.latest, not hymn(): during a hot-swap the previous hymn stays up
          until the next has loaded, so the screen never flashes to Loading. */}
      <Match when={hymn.latest}>
        {(loaded) => (
          <article class="operator">
            {/* The title shows in the shell's switcher row; this heading
                keeps the page's structure for screen readers. */}
            <h2 class="visually-hidden">
              {loaded().title} <span>#{loaded().number}</span>
            </h2>
            {/* Narrow: supporting panes open from here as bottom sheets. Not
                the dock — it can't fit them beside the FAB on a phone
                (DESIGN.md § Structure). */}
            <Show when={!expanded()}>
              <div class="header-actions">
                <For each={panes(loaded())}>
                  {(pane) => (
                    <button
                      type="button"
                      class="btn-text icon-button"
                      aria-haspopup="dialog"
                      onClick={() => showSheet(pane.id)}
                    >
                      <span class={`icon ${pane.icon}`} aria-hidden="true" />
                      <span class="visually-hidden">{pane.title}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <div class="operator-body">
              {sequencePane()}
              {/* Wide: supporting panes in a fixed column. Narrow: each is a
                  dock button opening it as a bottom sheet — nothing dropped
                  on mobile (DESIGN.md § Structure). */}
              <Show when={expanded()}>
                <aside class="support-column" aria-label="Supporting panes">
                  <For each={panes(loaded())}>
                    {(pane) => (
                      <section class="support-pane" aria-label={pane.title}>
                        <h3 class="title-medium on-surface-variant">{pane.title}</h3>
                        {pane.render()}
                      </section>
                    )}
                  </For>
                </aside>
              </Show>
            </div>

            <Show when={!expanded()}>
              <Sheet
                open={openSheet() !== undefined}
                onClose={closeSheet}
                title={panes(loaded()).find((p) => p.id === openSheet())?.title ?? ""}
              >
                <For each={panes(loaded()).filter((p) => p.id === openSheet())}>
                  {(pane) => pane.render()}
                </For>
              </Sheet>
            </Show>

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
