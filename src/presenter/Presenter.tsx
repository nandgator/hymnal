import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Index,
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
  positionOfLine,
  repeatRuns,
  type SequenceEngine,
} from "../domain/sequence-engine.ts";
import type { Hymn, HymnbookId, HymnNumber, Part } from "../domain/types.ts";
import { type OutputMessage, publishOutput, subscribeSeek } from "../output/channel.ts";
import { OutputView } from "../output/OutputView.tsx";
import { type ContentStore, getContentStore } from "../persistence/content-store.ts";
import {
  userState as defaultUserState,
  type OutputCues,
  type UserState,
} from "../persistence/user-state.ts";
import { ignoresShortcuts } from "../shell/keymap.ts";
import { Menu, type MenuItem } from "../shell/Menu.tsx";
import { createMediaQuery, EXPANDED_QUERY, SPLIT_QUERY, STAGE_QUERY } from "../shell/media.ts";
import type { PaneId } from "../shell/panes.ts";
import {
  makeMain,
  moveTab,
  nextTab as nextTabOf,
  normalizeWorkspace,
  selectTab,
  setSplit,
  TABS,
  type TabId,
  type VisibleGroup,
  visibleGroups,
  type Workspace,
} from "../shell/workspace.ts";
import { RecentsTab } from "./RecentsTab.tsx";

// Most parts carry no label — it's printed only for numbered stanzas
// (SDD-0001 §2.1). Refrains, bridges and tags fall back to their kind.
function partLabel(part: Part): string {
  if (part.label) return part.label;
  return part.kind[0].toUpperCase() + part.kind.slice(1);
}

/** A part as the Output's cue names it for a congregation (DESIGN.md §
 * Typography): "Verse 2" for a stanza, else its kind — "Refrain". */
export function partCueLabel(part: Part): string {
  return part.label ? `Verse ${part.label}` : partLabel(part);
}

const DOCK_COLLAPSE_MAX = 3;
const MIN_CHIP_COLUMNS = 3;
const FAB_GAP_PX = 16;
const DOCK_PADDING_PX = 12;
const FAB_RISE_PX = 20;
/** How long a stanza digit waits for a second one (SDD-0001 §16.5). */
const STANZA_DIGIT_MS = 500;
/** What the shell's command menu can do to the hymn being presented. */
export interface PresenterActions {
  repeat(): void;
  undoRepeat(): void;
  canUndoRepeat(): boolean;
  resetRepeats(): void;
  canResetRepeats(): boolean;
  /** The next tab of the main group; on a phone, the other navigator. */
  nextTab(): void;
}

/** Which navigator leads the workspace (SDD-0001 §16.4). */
export type Navigator = "parts" | "lyrics";

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
  /** Which navigator leads under 840px, until Board #26 part 4 retires it;
   * the shell keeps it in preferences. */
  navigator?: Navigator;
  onNavigatorChange?: (navigator: Navigator) => void;
  /** The Output is blanked (SDD-0001 §16.5); the shell holds it. */
  blanked?: boolean;
  /** Restores a blanked Output — the Live pane's Blanked badge. */
  onRestore?: () => void;
  /** Blanks or restores the Output — the button under Live. */
  onToggleBlank?: () => void;
  /** Which supporting panes show, by id; absent means shown (SDD-0001
   * §16.4). The shell keeps it in preferences. */
  panes?: Record<string, boolean>;
  /** The tab groups from 840px, as stored (SDD-0001 §16.4); the shell keeps
   * them in preferences. */
  workspace?: unknown;
  onWorkspaceChange?: (workspace: Workspace) => void;
  /** Opens another hymn in place — the Recents tab. */
  onSelectHymn?: (number: HymnNumber) => void;
  /** Whether a scroll of the Output moves the focus (SDD-0001 §16.1);
   * defaults to on. */
  scrollSync?: boolean;
  /** Receives the Presenter's actions while mounted, `undefined` after —
   * the command menu's Repeat and Undo repeat. */
  onActions?: (actions: PresenterActions | undefined) => void;
  /** For the Output's hymnbook cue. */
  hymnbookTitle?: string;
  /** Which cues Live's caption shows, as the Output's (SDD-0001 §16.1). */
  cues?: OutputCues;
  /** Bumped when the operator shows faded cues again. */
  revealCues?: number;
  /** Live pins the refrain as the Output does (SDD-0001 §16.1). */
  pinRefrain?: boolean;
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
  // At either end, a part step still widens line focus to the whole part.
  const onLine = () => cursor()?.lineIndex != null;
  const canPrevious = createMemo(() => (cursor()?.occurrenceIndex ?? 0) > 0 || onLine());
  const canNext = createMemo(() => {
    const e = engine();
    const at = cursor()?.occurrenceIndex;
    return e !== undefined && at !== undefined && (at < e.length - 1 || onLine());
  });

  // The path as runs, a part and its back-to-back repeats as one.
  const runs = createMemo(() => {
    version();
    const e = engine();
    return e ? repeatRuns(e) : [];
  });
  // Lyrics' blocks, one per run, each carrying its own occurrence: derived
  // together from one engine, so a block can never pair one hymn's run
  // with another's occurrences mid-swap (which read past the end).
  const lyricBlocks = createMemo(() => {
    version();
    const e = engine();
    if (!e) return [];
    return repeatRuns(e).flatMap((run) => {
      const occ = e.occurrenceAt(run.first);
      if (!occ) return [];
      // A part already seen earlier in the path shows compact — label and
      // first line — unless it's the one being sung (DESIGN.md § Structure).
      const seenBefore = Array.from({ length: run.first }, (_, j) => e.occurrenceAt(j)).some(
        (earlier) => earlier?.part.id === occ.part.id,
      );
      return [{ ...run, occ, seenBefore }];
    });
  });

  // Repeat cues always show in Lyrics; the toggle arrives with the
  // on-screen cues (Board #12 part 4c).
  const showCues = () => true;

  // Repeat (SDD-0001 §5.1): sing the current part again. It stays in place
  // on the Output; the count says it happened (DESIGN.md § Stability).
  const repeatOrdinal = () => occurrence()?.repeatOrdinal ?? 1;
  const canUndoRepeat = createMemo(() => {
    version();
    return engine()?.canUndoRepeat() ?? false;
  });
  // Reset takes back every repeat at once; at ×2 it would only do what Undo
  // does, so it's offered from ×3 — a run of three or more showings.
  const canResetRepeats = createMemo(() => {
    const here = cursor()?.occurrenceIndex ?? -1;
    const run = runs().find((r) => here >= r.first && here <= r.last);
    return !!run && run.last - run.first >= 2;
  });
  const repeat = () => mutate((e) => e.repeatCurrent());
  const undoRepeat = () => mutate((e) => e.undoRepeat());
  const resetRepeats = () => mutate((e) => e.resetRepeats());
  onMount(() =>
    props.onActions?.({
      repeat,
      undoRepeat,
      canUndoRepeat,
      resetRepeats,
      canResetRepeats,
      nextTab: () => nextTab(),
    }),
  );
  onCleanup(() => props.onActions?.(undefined));

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
      hymnbookTitle: props.hymnbookTitle,
      part: partCueLabel(e.current().part),
      repeat: e.current().repeatOrdinal,
      // Only the refrain recurs, so only it pins; bridges and tags stay in
      // the verse column, boxed while sung like it (SDD-0001 §16.1).
      refrain: e.hymn.parts.find((part) => part.kind === "refrain")?.id,
    };
  });
  createEffect(() => {
    const message = outputMessage();
    if (message) publishOutput(message);
  });
  onCleanup(() => publishOutput({ type: "idle" }));

  // Scroll sync (SDD-0001 §16.1): the Output asks, the Operator decides. A
  // seek keeps the focus kind the scroll began with — a whole part lands on
  // the band's part, a line on that line — and the publish that follows
  // re-centres the Output on it. Declined (sync off, or another hymn), the
  // Output drifts back by itself.
  onMount(() => {
    const unsubscribe = subscribeSeek((seek) => {
      if (props.scrollSync === false) return;
      const e = engine();
      if (!e || seek.hymnbookId !== e.hymn.hymnbookId || seek.number !== e.hymn.number) return;
      const position = positionOfLine(e, seek.line);
      if (!position) return;
      mutate((current) =>
        seek.whole
          ? current.goTo(position.occurrenceIndex)
          : current.goTo(position.occurrenceIndex, position.lineIndex),
      );
    });
    onCleanup(unsubscribe);
  });

  // Stanza digits (SDD-0001 §16.5): a digit that can't start a longer
  // stanza label jumps at once; one that can waits briefly for the second,
  // so the audience never sees stanza 1 flash on the way to 12.
  let digits = "";
  let digitTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(digitTimer));
  const typeDigit = (digit: string) => {
    clearTimeout(digitTimer);
    const typed = digits + digit;
    digits = "";
    const stanzas = (engine()?.hymn.parts ?? []).filter((part) => part.kind === "stanza");
    const exact = stanzas.find((part) => part.label === typed);
    const jump = () => {
      if (exact) mutate((e) => e.jumpToPart(exact.id));
    };
    if (stanzas.some((part) => part.label !== typed && part.label?.startsWith(typed))) {
      digits = typed;
      digitTimer = setTimeout(() => {
        digits = "";
        jump();
      }, STANZA_DIGIT_MS);
    } else {
      jump();
    }
  };

  // Full keyboard navigation (arc42 §8.8, SDD-0001 §16.5) — arrow keys for
  // fine control, Page Up/Down since that's what most presentation
  // remotes/clickers send. Off while typing or while a sheet is open: the
  // hymn picker's arrow keys move its highlight, never the Output. The
  // shell handles the keys that work on every screen.
  const onKeyDown = (event: KeyboardEvent) => {
    if (ignoresShortcuts(event)) return;
    // Space is Next part even on a focused button, so a clicker never
    // re-presses the last chip tapped; radios and checkboxes keep it.
    if (event.key === " " && event.target instanceof HTMLInputElement) return;
    if (event.key.toLowerCase() === "n" && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      nextTab();
      return;
    }
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      typeDigit(event.key);
      return;
    }
    const action: ((e: SequenceEngine) => void) | undefined = {
      ArrowRight: (e: SequenceEngine) => e.next(),
      PageDown: (e: SequenceEngine) => e.next(),
      " ": (e: SequenceEngine) => (event.shiftKey ? e.previous() : e.next()),
      ArrowLeft: (e: SequenceEngine) => e.previous(),
      PageUp: (e: SequenceEngine) => e.previous(),
      ArrowDown: (e: SequenceEngine) => e.nextLine(),
      ArrowUp: (e: SequenceEngine) => e.previousLine(),
      Home: (e: SequenceEngine) => e.goTo(0),
      End: (e: SequenceEngine) => e.goTo(e.length - 1),
      r: (e: SequenceEngine) => {
        const refrain = e.hymn.parts.find((part) => part.kind === "refrain");
        if (refrain) e.jumpToPart(refrain.id);
      },
    }[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!action) return;
    event.preventDefault();
    mutate(action);
  };
  onMount(() => window.addEventListener("keydown", onKeyDown));
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  const expanded = createMediaQuery(EXPANDED_QUERY);
  // Room for two tab groups beside the stage; narrower, they merge.
  const canSplit = createMediaQuery(SPLIT_QUERY);
  // Height for the full Live preview above the keypad; shorter, the strip.
  const roomy = createMediaQuery(STAGE_QUERY);

  // From 840px: tabs in two groups beside What they see (SDD-0001 §16.4).
  // Kept by the shell in preferences; local too, so the Presenter works
  // on its own.
  const [workspace, setWorkspaceSignal] = createSignal<Workspace>(
    normalizeWorkspace(props.workspace),
  );
  createEffect(() => {
    if (props.workspace !== undefined) setWorkspaceSignal(normalizeWorkspace(props.workspace));
  });
  const setWorkspace = (next: Workspace) => {
    setWorkspaceSignal(next);
    props.onWorkspaceChange?.(next);
  };
  const groups = createMemo(() => visibleGroups(workspace(), canSplit()));
  const showTab = (tab: TabId) => setWorkspace(selectTab(workspace(), tab, groups().length === 1));
  const tabName = (tab: TabId) => TABS.find((t) => t.id === tab)?.name ?? tab;
  // A group's heading (SDD-0001 §16.4): side by side, a pane toolbar of
  // icons — expand or collapse, move (a ⋯ menu, for a group of several
  // tabs), close; merged, Split — disabled, with the reason, when the
  // window hasn't the room.
  const split = () => groups().length === 2;
  const swapMain = (group: VisibleGroup) =>
    setWorkspace(makeMain(workspace(), group.main ? (group.index === 0 ? 1 : 0) : group.index));
  // The arrow points at the group the tab goes to.
  const moveItems = (group: VisibleGroup): MenuItem[] =>
    group.tabs.map((tab) => ({
      label: `Move ${tabName(tab)} to the other group`,
      run: () => setWorkspace(moveTab(workspace(), tab)),
      icon: group.index === 0 ? "icon-move" : "icon-move icon-mirror",
    }));
  const canSplitTabs = () => canSplit() && TABS.length > 1;
  // "19 verses · refrain": the hymn's shape at a glance. Not a count of the
  // whole sung order, which reads as confusing next to the verse count.
  const hymnNote = (loaded: Hymn) => {
    const verses = loaded.parts.filter((part) => part.kind === "stanza").length;
    const refrain = loaded.parts.some((part) => part.kind === "refrain");
    return [`${verses} ${verses === 1 ? "verse" : "verses"}`, ...(refrain ? ["refrain"] : [])].join(
      " · ",
    );
  };

  // Under 840px, until part 4: one navigator leads, Parts or Lyrics, and
  // the switch is the one tap to the other. The shell keeps the choice.
  const [navigator, setNavigatorSignal] = createSignal<Navigator>(props.navigator ?? "parts");
  createEffect(() => {
    if (props.navigator) setNavigatorSignal(props.navigator);
  });
  const setNavigator = (next: Navigator) => {
    setNavigatorSignal(next);
    props.onNavigatorChange?.(next);
  };
  const other = (): Navigator => (navigator() === "parts" ? "lyrics" : "parts");
  const nextTab = () =>
    expanded() ? setWorkspace(nextTabOf(workspace(), canSplit())) : setNavigator(other());
  // Pane visibility, kept by the shell (SDD-0001 §16.4): Live, toggled by
  // L or the command menu there.
  const shown = (id: PaneId) => props.panes?.[id] ?? true;
  const [liveExpanded, setLiveExpanded] = createSignal(false);

  // Keep the current block centred in every Lyrics list on screen, like the
  // Output: the focused line under line focus, the whole block otherwise —
  // or its top, when the block is taller than the list. Each list scrolls
  // inside itself, never the page (DESIGN.md § Stability). Scrolling by
  // hand only browses; the next step re-centres.
  createEffect(() => {
    version();
    navigator();
    groups();
    const lineIndex = cursor()?.lineIndex;
    for (const chip of document.querySelectorAll<HTMLElement>(
      '.chip-filter[aria-pressed="true"]',
    )) {
      chip.scrollIntoView?.({ block: "nearest" });
    }
    for (const list of document.querySelectorAll<HTMLElement>(".sequence")) {
      const block = list.querySelector<HTMLElement>('[aria-current="step"]');
      if (!block) continue;
      const line =
        lineIndex == null
          ? null
          : block.querySelector<HTMLElement>('.seq-line[aria-current="true"]');
      const fits = block.offsetHeight <= list.clientHeight;
      (line ?? block).scrollIntoView?.({
        block: line || fits ? "center" : "start",
        behavior: "smooth",
      });
    }
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
      if (!last || last.right <= limit()) break;
    }
    // The dock is as tall as its buttons or the FAB, whichever is taller, and
    // the Operator reserves exactly that — not a rem guess, which would grow
    // with the text scale while icon-only targets don't. Published on the
    // shell: the root's style attribute is watched for text scale, and
    // writing there would re-trigger this.
    const shell = dock.closest<HTMLElement>(".shell") ?? dock.parentElement;
    if (!shell) return;
    shell.style.removeProperty("--dock-height");
    const fabHeight = fab?.offsetHeight ?? 0;
    // The dock is as tall as its own buttons; the FAB floats a steady
    // FAB_RISE_PX above its top edge (DESIGN.md § Stability).
    const height = dock.offsetHeight;
    const fabBottom = Math.max(DOCK_PADDING_PX, height - fabHeight + FAB_RISE_PX);
    shell.style.setProperty("--dock-height", `${height}px`);
    shell.style.setProperty("--fab-bottom", `${fabBottom}px`);
    shell.style.setProperty("--fab-top", `${fabBottom + fabHeight}px`);
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
    key: { aria: string; shown: string },
    icon: string,
    variant: "btn-filled" | "btn-tonal" | "btn-outlined",
    action: (e: SequenceEngine) => void,
    disabled?: () => boolean,
    // On screen when shorter than the name: the line buttons read "Line",
    // their arrows giving the direction (the mockup).
    shortLabel?: string,
  ) => (
    <button
      type="button"
      class={`${variant} dock-button ${variant === "btn-outlined" ? "dock-line" : "dock-part"}`}
      onClick={() => mutate(action)}
      disabled={disabled?.()}
      aria-label={shortLabel ? label : undefined}
      aria-keyshortcuts={key.aria}
      title={`${label} (${key.shown})`}
    >
      <span class={`icon ${icon}`} aria-hidden="true" />
      <span class="dock-label">{shortLabel ?? label}</span>
    </button>
  );

  // Live is the Output itself, scaled to its box — the same component, so
  // the preview can't disagree with the audience screen (DESIGN.md §
  // Structure).
  const livePreview = () => (
    <Show when={outputMessage()}>
      {(message) => (
        <OutputView
          message={message()}
          variant="mini"
          cues={props.cues}
          reveal={props.revealCues}
          pinRefrain={props.pinRefrain}
          classList={{ "live-blanked": !!props.blanked }}
        />
      )}
    </Show>
  );

  // Blanked (SDD-0001 §16.5): Live stays readable, dimmed, so the operator
  // can prepare behind it; the badge is the restore.
  const blankedBadge = () => (
    <Show when={props.blanked}>
      <button
        type="button"
        class="live-badge"
        aria-keyshortcuts="B"
        title="Restore the Output (B)"
        onClick={() => props.onRestore?.()}
      >
        Blanked
        <span class="visually-hidden"> — restore the Output</span>
      </button>
    </Show>
  );

  // Phone: Live collapses to a strip showing the current line; a tap
  // expands it (DESIGN.md § Structure).
  const liveStrip = () => (
    <div class="live-strip">
      <div class="live-strip-row">
        <button
          type="button"
          class="live-strip-toggle"
          classList={{ "live-blanked": !!props.blanked }}
          aria-expanded={liveExpanded()}
          onClick={() => setLiveExpanded((open) => !open)}
        >
          <span class="live-strip-label">Live</span>
          <span class="live-strip-text">
            {outputMessage()?.lines[outputMessage()?.focus.start ?? 0]?.text}
          </span>
          <span class="icon icon-expand" aria-hidden="true" />
        </button>
        {blankedBadge()}
      </div>
      <Show when={liveExpanded()}>{livePreview()}</Show>
    </div>
  );

  // Special parts (refrain, bridge, tag) first, then numbered stanzas as a
  // keypad in number order — whatever order the hymn stores them in, so a
  // hymn storing verse 1 before its refrain doesn't split the keypad
  // (DESIGN.md § Stability).
  const keypadOrder = (parts: Part[]) => [
    ...parts.filter((part) => !part.label),
    ...parts.filter((part) => part.label).sort((a, b) => Number(a.label) - Number(b.label) || 0),
  ];

  const partsNavigator = (loaded: Hymn) => (
    <div class="parts-navigator">
      {/* Above the chips, so it sits in the same place for every hymn; the
          count and Undo appear after it, moving nothing. */}
      <div class="repeat-row">
        {/* Outlined, not tonal: the tonal fill is the keypad's "selected",
            and Repeat is an action, never a state. */}
        <button
          type="button"
          class="btn-outlined repeat-button"
          aria-label="Repeat"
          title="Repeat this part"
          onClick={repeat}
        >
          <span class="icon icon-repeat" aria-hidden="true" />
          <span class="repeat-label">Repeat</span>
        </button>
        {/* Held in place before any repeat — the count unseen, Undo and
            Reset disabled — so nothing moves when they apply (SDD-0001
            §16.4). Short on screen; the full names are the accessible ones. */}
        <span class="repeat-count" aria-live="polite">
          <Show when={repeatOrdinal() > 1}>
            ×{repeatOrdinal()}
            <span class="visually-hidden"> — sung {repeatOrdinal()} times in a row</span>
          </Show>
        </span>
        <span class="repeat-actions">
          <button
            type="button"
            class="btn-text"
            aria-label="Undo repeat"
            disabled={!canUndoRepeat()}
            onClick={undoRepeat}
          >
            Undo
          </button>
          <button
            type="button"
            class="btn-text"
            aria-label="Reset repeat"
            disabled={!canResetRepeats()}
            onClick={resetRepeats}
          >
            Reset
          </button>
        </span>
      </div>
      <section aria-label="Jump to part">
        <ul
          class="chip-set"
          style={{
            "--stanza-count": String(
              Math.max(MIN_CHIP_COLUMNS, loaded.parts.filter((p) => p.label).length),
            ),
          }}
        >
          <For each={keypadOrder(loaded.parts)}>
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
    </div>
  );

  // Lyrics, touch-first (DESIGN.md § Structure): a tap anywhere in a block
  // goes there, a tap on a line sends that line live. Scrolling never calls
  // the engine. "Back to current" appears once the current block is
  // scrolled out of view.
  const lyricsNavigator = () => {
    let list: HTMLElement | undefined;
    const [awayFromCurrent, setAwayFromCurrent] = createSignal(false);
    let observer: IntersectionObserver | undefined;
    createEffect(() => {
      version();
      observer?.disconnect();
      const block = list?.querySelector('[aria-current="step"]');
      if (!list || !block || typeof IntersectionObserver !== "function") return;
      observer = new IntersectionObserver(([entry]) => setAwayFromCurrent(!entry.isIntersecting), {
        root: list,
      });
      observer.observe(block);
    });
    onCleanup(() => observer?.disconnect());

    return (
      <div class="lyrics-navigator">
        <section class="sequence" aria-label="Lyrics" ref={list}>
          <ol class="seq-list">
            {/* One block per run: a part and its back-to-back repeats show
                once, marked ×N, as on the Output (DESIGN.md § Stability). */}
            <Index each={lyricBlocks()}>
              {(run) => {
                const occ = () => run().occ;
                const here = () => cursor()?.occurrenceIndex ?? -1;
                const isCurrent = () => here() >= run().first && here() <= run().last;
                // Taps land on the showing being sung, else the run's last,
                // so Next carries on past the repeats.
                const i = () => (isCurrent() ? here() : run().last);
                const times = () => run().last - run().first + 1;
                // A part already seen earlier in the path shows compact —
                // label and first line — unless it's the one being sung
                // (DESIGN.md § Structure).
                const compact = () => run().seenBefore && !isCurrent();
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the block is a large touch target; keyboard users have its heading button and line buttons
                  <li
                    class="seq-block"
                    classList={{
                      "seq-line-focus": isCurrent() && cursor()?.lineIndex != null,
                      "seq-compact": compact(),
                    }}
                    aria-current={isCurrent() ? "step" : undefined}
                    onClick={() => mutate((e) => e.goTo(i()))}
                  >
                    <h3 class="seq-heading">
                      <button type="button" class="seq-head">
                        {partCueLabel(occ().part)}
                      </button>
                      <Show when={showCues() && times() > 1}>
                        <span class="chip-assist">×{times()}</span>
                      </Show>
                    </h3>
                    <ol class="hymn-text seq-lines">
                      <Index each={compact() ? occ().part.lines.slice(0, 1) : occ().part.lines}>
                        {(line, lineIndex) => (
                          <li>
                            <button
                              type="button"
                              class="seq-line"
                              aria-current={
                                isCurrent() && cursor()?.lineIndex === lineIndex
                                  ? "true"
                                  : undefined
                              }
                              onClick={(event) => {
                                event.stopPropagation();
                                mutate((e) => e.goTo(i(), lineIndex));
                              }}
                            >
                              {line()}
                            </button>
                          </li>
                        )}
                      </Index>
                      <Show when={compact() && occ().part.lines.length > 1}>
                        <li class="seq-more" aria-hidden="true">
                          …
                        </li>
                      </Show>
                    </ol>
                  </li>
                );
              }}
            </Index>
          </ol>
        </section>
        <Show when={awayFromCurrent()}>
          <button
            type="button"
            class="btn-tonal back-to-current"
            onClick={() =>
              list
                ?.querySelector<HTMLElement>('[aria-current="step"]')
                ?.scrollIntoView?.({ block: "center", behavior: "smooth" })
            }
          >
            Back to current
          </button>
        </Show>
      </div>
    );
  };

  const NAVIGATOR_TITLES: Record<Navigator, string> = { parts: "Parts", lyrics: "Lyrics" };
  const navigatorPane = (kind: Navigator, loaded: Hymn) =>
    kind === "parts" ? partsNavigator(loaded) : lyricsNavigator();

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

            <Show
              when={expanded()}
              fallback={
                <div class="operator-body">
                  <div class="main-column">
                    <Show when={shown("live")}>{liveStrip()}</Show>
                    <section class="navigator" aria-label="Navigator">
                      <div class="navigator-header">
                        {/* MD3 segmented button on native radios: arrow keys
                            move between the options for free. */}
                        <fieldset class="segmented">
                          <legend class="visually-hidden">Navigate by</legend>
                          <For each={["parts", "lyrics"] as Navigator[]}>
                            {(kind) => (
                              <label class="segment">
                                <input
                                  type="radio"
                                  name="navigator"
                                  class="segment-input"
                                  checked={navigator() === kind}
                                  onChange={() => setNavigator(kind)}
                                />
                                <span class="segment-check icon icon-check" aria-hidden="true" />
                                {NAVIGATOR_TITLES[kind]}
                              </label>
                            )}
                          </For>
                        </fieldset>
                      </div>
                      <div class="navigator-body">{navigatorPane(navigator(), loaded())}</div>
                    </section>
                  </div>
                </div>
              }
            >
              {/* From 840px (SDD-0001 §16.4): the tab groups, the main one
                  taking the room, then What they see — Live and Parts —
                  which never moves. */}
              <div class="operator-areas">
                <For each={groups()}>
                  {(group) => (
                    <section
                      class="area"
                      classList={{ "area-main": group.main }}
                      aria-label={tabName(group.active)}
                    >
                      <div class="area-header">
                        <Show
                          when={group.tabs.length > 1}
                          fallback={<h3 class="area-title">{tabName(group.active)}</h3>}
                        >
                          <div class="area-tabs" role="tablist">
                            <For each={group.tabs}>
                              {(tab) => (
                                <button
                                  type="button"
                                  role="tab"
                                  class="area-tab"
                                  aria-selected={tab === group.active}
                                  onClick={() => showTab(tab)}
                                >
                                  {tabName(tab)}
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                        <Show when={group.tabs.length === 1 && group.active === "hymn"}>
                          <span class="area-note">{hymnNote(loaded())}</span>
                        </Show>
                        <div class="area-actions">
                          <Show
                            when={split()}
                            fallback={
                              <button
                                type="button"
                                class="icon-button area-icon"
                                aria-label="Split into two groups"
                                title={
                                  canSplitTabs()
                                    ? "Split into two groups"
                                    : "Split into two groups (needs a window 1400px wide)"
                                }
                                disabled={!canSplitTabs()}
                                onClick={() => setWorkspace(setSplit(workspace(), true))}
                              >
                                <span class="icon icon-split" aria-hidden="true" />
                              </button>
                            }
                          >
                            {/* A pane toolbar, after VS Code's and Zed's:
                                expand or collapse, move, close. */}
                            <button
                              type="button"
                              class="icon-button area-icon"
                              aria-label={group.main ? "Collapse to the side" : "Expand to main"}
                              title={group.main ? "Collapse to the side" : "Expand to main"}
                              onClick={() => swapMain(group)}
                            >
                              <span
                                class={`icon ${group.main ? "icon-collapse" : "icon-expand-full"}`}
                                aria-hidden="true"
                              />
                            </button>
                            {/* A lone tab's move would empty its group — what
                                Close group already does — so Move shows only
                                for a group of several. */}
                            <Show when={group.tabs.length > 1}>
                              <Menu
                                label={`${tabName(group.active)} options`}
                                items={moveItems(group)}
                              />
                            </Show>
                            <button
                              type="button"
                              class="icon-button area-icon"
                              aria-label="Close group"
                              title="Close group — its tabs join the other"
                              onClick={() => setWorkspace(setSplit(workspace(), false))}
                            >
                              <span class="icon icon-close" aria-hidden="true" />
                            </button>
                          </Show>
                        </div>
                      </div>
                      <div class="area-body" role="tabpanel">
                        <Switch>
                          <Match when={group.active === "hymn"}>{lyricsNavigator()}</Match>
                          <Match when={group.active === "recents"}>
                            <RecentsTab
                              hymnbookId={loaded().hymnbookId}
                              current={loaded().number}
                              store={props.store}
                              userState={props.userState}
                              onSelect={(number) => props.onSelectHymn?.(number)}
                            />
                          </Match>
                        </Switch>
                      </div>
                    </section>
                  )}
                </For>
                <aside class="area stage" aria-label="What they see">
                  <Show when={shown("live")}>
                    {/* The strip names itself; only the full preview gets
                        the header. */}
                    <Show when={roomy()}>
                      <div class="area-header">
                        <h3 class="area-title area-title-live">Live</h3>
                        {/* What changes the audience screen sits in Live's
                            own heading; Hold and the follow status join it
                            later. */}
                        <button
                          type="button"
                          class="live-control"
                          aria-pressed={!!props.blanked}
                          aria-keyshortcuts="B"
                          title={props.blanked ? "Restore the Output (B)" : "Blank the Output (B)"}
                          onClick={() => props.onToggleBlank?.()}
                        >
                          <span class="icon icon-blank" aria-hidden="true" />
                          {props.blanked ? "Restore" : "Blank"}
                          <kbd class="live-control-key">B</kbd>
                        </button>
                      </div>
                    </Show>
                    <Show when={roomy()} fallback={<div class="stage-strip">{liveStrip()}</div>}>
                      <section class="live-pane" aria-label="Live">
                        {livePreview()}
                        {blankedBadge()}
                      </section>
                    </Show>
                    <div class="stage-divider" />
                  </Show>
                  <div class="area-header">
                    <h3 class="area-title">Parts</h3>
                    <span class="area-note">Jump to any part</span>
                  </div>
                  {partsNavigator(loaded())}
                </aside>
              </div>
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
                { aria: "ArrowLeft", shown: "←" },
                "icon-chevron-left",
                "btn-tonal",
                (e) => e.previous(),
                () => !canPrevious(),
              )}
              {dockButton(
                "Previous line",
                { aria: "ArrowUp", shown: "↑" },
                "icon-arrow-up",
                "btn-outlined",
                (e) => e.previousLine(),
                undefined,
                "Line",
              )}
              {dockButton(
                "Next line",
                { aria: "ArrowDown", shown: "↓" },
                "icon-arrow-down",
                "btn-outlined",
                (e) => e.nextLine(),
                undefined,
                "Line",
              )}
              {dockButton(
                "Next part",
                { aria: "ArrowRight", shown: "→" },
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
