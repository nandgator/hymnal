import { createEffect, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { BUNDLED_HYMNBOOK_ID } from "./config.ts";
import type { Hymn, Hymnbook, HymnbookId, HymnNumber } from "./domain/types.ts";
import { type Command, Finder } from "./finder/Finder.tsx";
import { Library } from "./library/Library.tsx";
import {
  revealCues,
  setOutputBlanked,
  setOutputPresentation,
  subscribeKeys,
  subscribePresence,
} from "./output/channel.ts";
import { Output } from "./output/Output.tsx";
import { DEFAULT_OUTPUT_THEME, outputCuesOf, pinChorusOf } from "./persistence/user-state.ts";
import { Presenter, type PresenterActions } from "./presenter/Presenter.tsx";
import { titleCase } from "./shell/case.ts";
import { ignoresShortcuts, keyHint, replayForwardedKey, SHORTCUTS } from "./shell/keymap.ts";
import { createMediaQuery, EXPANDED_QUERY } from "./shell/media.ts";
import { isPaneShown, PANES, type PaneId } from "./shell/panes.ts";
import { canAdjustScale, createPreferences, OUTPUT_CUES, Settings } from "./shell/Settings.tsx";
import { Sheet } from "./shell/Sheet.tsx";
import { SwapLabel } from "./shell/SwapLabel.tsx";
import { installScrollReveal } from "./shell/scrollReveal.ts";
import { workspaceOf } from "./shell/workspace.ts";

/** The app's top-level sections (DESIGN.md § Structure, layer 1). Feedback,
 * About and Updates are reserved here, not built (PLAN Board #16–18). */
type Section = "present" | "library";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "present", label: "Present", icon: "icon-queue-music" },
  { id: "library", label: "Library", icon: "icon-library" },
];

/** The same page, loaded in a second window, is the Output — SDD-0001 §16.1. */
const OUTPUT_URL = `${import.meta.env.BASE_URL}?output=1`;
// A named target: clicking again focuses the already-open Output window
// instead of stacking a second one the operator would have to reposition.
const OUTPUT_WINDOW_NAME = "hymnal-output";

function isOutputWindow(): boolean {
  return new URLSearchParams(window.location.search).has("output");
}

/** Signal-based view state, not a router — SDD-0001 §12. */
function App() {
  return isOutputWindow() ? <Output /> : <Operator />;
}

/**
 * The layered shell, after Supabase Studio (DESIGN.md § Structure): sections
 * (a rail when wide, a menu on a phone), the switcher row — hymnbook ▾ /
 * hymn ▾, each a picker that hot-swaps in place — then the workspace, whose
 * width follows its content, and the dock/FAB.
 */
function Operator() {
  const expanded = createMediaQuery(EXPANDED_QUERY);
  // Applied at startup, whether or not a Settings sheet is open.
  const preferences = createPreferences();
  // Scrollbars fade in while a pane scrolls (DESIGN.md § Register).
  installScrollReveal();
  const [section, setSection] = createSignal<Section>("library");
  const [hymnbook, setHymnbook] = createSignal<Hymnbook>();
  const [hymnbookId, setHymnbookId] = createSignal<HymnbookId>(BUNDLED_HYMNBOOK_ID);
  const [hymnNumber, setHymnNumber] = createSignal<HymnNumber>();
  const [hymn, setHymn] = createSignal<Hymn>();

  const [menuOpen, setMenuOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [bookPickerOpen, setBookPickerOpen] = createSignal(false);
  const [hymnPickerOpen, setHymnPickerOpen] = createSignal(false);
  const [commandMenuOpen, setCommandMenuOpen] = createSignal(false);
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false);
  // The sheet the shortcut sheet was opened from, if any: its Close then
  // reads Back and returns there.
  const [shortcutsReturn, setShortcutsReturn] = createSignal<(open: boolean) => void>();

  // The Output follows Presentation settings live, and a late Output gets
  // them replayed (SDD-0001 §16.1).
  createEffect(() =>
    setOutputPresentation({
      theme: preferences.preferences().outputTheme ?? DEFAULT_OUTPUT_THEME,
      cues: outputCuesOf(preferences.preferences()),
      pinChorus: pinChorusOf(preferences.preferences()),
    }),
  );

  // Blank holds until restored, across navigation and hymn swaps, so it
  // lives here rather than in the Presenter (SDD-0001 §16.5).
  const [blanked, setBlanked] = createSignal(false);
  // "Show cues now": faded cues return for their fade time, on the Output
  // and in Live alike.
  const [cuesRevealed, setCuesRevealed] = createSignal(0);
  const showCues = () => {
    setCuesRevealed((n) => n + 1);
    revealCues();
  };

  // The mounted Presenter's actions, for the command menu.
  const [presenterActions, setPresenterActions] = createSignal<PresenterActions>();
  const toggleBlank = () => {
    const next = !blanked();
    setBlanked(next);
    setOutputBlanked(next);
  };

  // Whether an Output window is open (SDD-0001 §16.4): Go live becomes the
  // On air status, and Live's dot the on-air light.
  const [presentingOutput, setPresentingOutput] = createSignal(false);
  onMount(() => onCleanup(subscribePresence(setPresentingOutput)));
  // Opening once, then bringing it forward: an empty URL targets the named
  // window without reloading it.
  const openOutput = () => {
    if (presentingOutput()) window.open("", OUTPUT_WINDOW_NAME)?.focus();
    else window.open(OUTPUT_URL, OUTPUT_WINDOW_NAME, "popup");
  };
  const presenting = () => section() === "present" && !!hymnNumber();
  const togglePane = (id: PaneId) =>
    preferences.setPane(id, !isPaneShown(preferences.preferences(), id));

  // Only one sheet at a time: a command opening another sheet, or Ctrl/⌘+K
  // from inside one, replaces it rather than stacking modals.
  const closeSheets = () => {
    setMenuOpen(false);
    setSettingsOpen(false);
    setBookPickerOpen(false);
    setHymnPickerOpen(false);
    setCommandMenuOpen(false);
    setShortcutsOpen(false);
  };
  const openSheet = (open: (value: boolean) => void) => {
    closeSheets();
    open(true);
  };

  const go = (next: Section) => {
    setSection(next);
    setMenuOpen(false);
  };

  // Hot-swap (SDD-0001 §16.4): choosing a hymn from anywhere loads it in the
  // Presenter already on screen. Nothing is reopened or repositioned.
  const chooseHymn = (number: HymnNumber) => {
    setHymnNumber(number);
    setHymnPickerOpen(false);
    setSection("present");
  };

  // "Find a song", from anywhere: Present, plus the picker over the current
  // hymn if one is up. With none, Present already is the Finder, and a
  // picker on top would only duplicate it.
  const findHymn = () => {
    setSection("present");
    setMenuOpen(false);
    if (hymnNumber()) setHymnPickerOpen(true);
  };

  // Phase 1 installs one bundled hymnbook; the picker lists what's installed,
  // so a second book is data, not a change here (arc42 §2.3).
  const installed = () => {
    const book = hymnbook();
    return book ? [book] : [];
  };
  const chooseHymnbook = (id: HymnbookId) => {
    setBookPickerOpen(false);
    // The current hymn stays up until one is chosen from the new book, so
    // the audience never sees an empty screen mid-swap (§16.4).
    if (id !== hymnbookId()) setHymnbookId(id);
    findHymn();
  };

  const showShortcuts = (from?: (open: boolean) => void) => {
    openSheet(setShortcutsOpen);
    setShortcutsReturn(() => from);
  };
  const closeShortcuts = () => {
    const back = shortcutsReturn();
    setShortcutsReturn(undefined);
    if (back) openSheet(back);
    else setShortcutsOpen(false);
  };

  // The command menu's actions (SDD-0001 §16.5), each with its key.
  const commands = (): Command[] => {
    const prefs = preferences.preferences();
    const cues = outputCuesOf(prefs);
    const run = (action: () => void) => () => {
      setCommandMenuOpen(false);
      action();
    };
    return [
      {
        label: blanked() ? "Restore the Output" : "Blank the Output",
        hint: keyHint("blank"),
        run: run(toggleBlank),
      },
      {
        label: presentingOutput() ? "Bring the Output forward" : "Go live: open the Output",
        hint: keyHint("output"),
        run: run(openOutput),
      },
      ...(presenting() && presenterActions()
        ? [
            { label: "Repeat this part", run: run(() => presenterActions()?.repeat()) },
            ...(presenterActions()?.canUndoRepeat()
              ? [{ label: "Undo repeat", run: run(() => presenterActions()?.undoRepeat()) }]
              : []),
            ...(presenterActions()?.canResetRepeats()
              ? [{ label: "Reset repeat", run: run(() => presenterActions()?.resetRepeats()) }]
              : []),
          ]
        : []),
      ...(presenting()
        ? [
            {
              label: "Next tab",
              hint: keyHint("tab"),
              run: run(() => presenterActions()?.nextTab()),
            },
          ]
        : []),
      // Only where two groups fit (1400px): narrower, the tabs are merged
      // by width, and these would change nothing on screen (SDD-0001 §16.5).
      ...(presenting() && presenterActions()?.canSplitTabs()
        ? [
            {
              label: workspaceOf(prefs).split ? "Merge the tabs" : "Split the tabs",
              run: run(() => presenterActions()?.toggleSplit()),
            },
            ...(workspaceOf(prefs).split
              ? [
                  {
                    label: "Make the other tab group main",
                    run: run(() => presenterActions()?.swapMain()),
                  },
                ]
              : []),
          ]
        : []),
      ...PANES.map((pane) => ({
        label: `${isPaneShown(prefs, pane.id) ? "Hide" : "Show"} ${pane.name}`,
        hint: pane.key,
        run: run(() => togglePane(pane.id)),
      })),
      ...OUTPUT_CUES.map((cue) => {
        const on = !!cues[cue.id];
        return {
          label: `${on ? "Hide" : "Show"} ${cue.name.toLowerCase()} on the Output`,
          run: run(() => preferences.setCue(cue.id, !on)),
        };
      }),
      ...(cues.fade && OUTPUT_CUES.some((cue) => cues[cue.id])
        ? [{ label: "Show cues now", run: run(showCues) }]
        : []),
      {
        label: cues.fade ? "Keep cues on the Output" : "Fade cues on the Output",
        run: run(() => preferences.setCue("fade", !cues.fade)),
      },
      { label: "Switch hymnbook", run: run(() => openSheet(setBookPickerOpen)) },
      { label: "Library", run: run(() => go("library")) },
      { label: "Settings", hint: keyHint("settings"), run: run(() => openSheet(setSettingsOpen)) },
      ...(canAdjustScale(prefs, 1)
        ? [{ label: "Text size up", hint: "+", run: run(() => preferences.adjustScale(1)) }]
        : []),
      ...(canAdjustScale(prefs, -1)
        ? [{ label: "Text size down", hint: "−", run: run(() => preferences.adjustScale(-1)) }]
        : []),
      {
        label: "Keyboard shortcuts",
        hint: keyHint("shortcuts"),
        run: run(() => showShortcuts()),
      },
    ];
  };

  // The shell's keys, which work on every screen (SDD-0001 §16.5); the
  // Presenter handles the ones that move its engine.
  const onKeyDown = (event: KeyboardEvent) => {
    // Ctrl/⌘+K and Ctrl/⌘+, work from anywhere, a text field or another
    // sheet included, and close what they opened.
    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const chord = event.key.toLowerCase();
      if (chord === "k") {
        event.preventDefault();
        if (commandMenuOpen()) setCommandMenuOpen(false);
        else if (hymnbook()) openSheet(setCommandMenuOpen);
        return;
      }
      if (chord === ",") {
        event.preventDefault();
        if (settingsOpen()) setSettingsOpen(false);
        else openSheet(setSettingsOpen);
        return;
      }
    }
    if (ignoresShortcuts(event)) return;
    const action = (
      {
        b: toggleBlank,
        ".": toggleBlank,
        o: openOutput,
        l: () => togglePane("live"),
        "/": () => hymnbook() && openSheet(setCommandMenuOpen),
        "+": () => preferences.adjustScale(1),
        // The + key's own character, unshifted, on most layouts.
        "=": () => preferences.adjustScale(1),
        "-": () => preferences.adjustScale(-1),
        "?": () => showShortcuts(),
      } as Record<string, () => unknown>
    )[event.key.toLowerCase()];
    if (!action) return;
    event.preventDefault();
    action();
  };
  onMount(() => window.addEventListener("keydown", onKeyDown));
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  // Keys pressed in the Output window, replayed here so they do exactly what
  // they do in the Operator — the shell's keys and the Presenter's alike
  // (SDD-0001 §16.1).
  onMount(() => {
    const unsubscribe = subscribeKeys(({ key, shiftKey }) => replayForwardedKey(key, shiftKey));
    onCleanup(unsubscribe);
  });

  const sectionButton = (item: (typeof SECTIONS)[number], variant: "rail" | "menu") => (
    <button
      type="button"
      class={variant === "rail" ? "rail-item" : "list-row menu-item"}
      aria-current={section() === item.id ? "page" : undefined}
      disabled={item.id === "present" && !hymnbook()}
      onClick={() => go(item.id)}
    >
      <span class={variant === "rail" ? "rail-indicator" : ""}>
        <span class={`icon ${item.icon}`} aria-hidden="true" />
      </span>
      <span class={variant === "rail" ? "rail-label" : ""}>{item.label}</span>
    </button>
  );

  return (
    <div class="shell">
      <Show when={expanded()}>
        <nav class="nav-rail" aria-label="Sections">
          <For each={SECTIONS}>{(item) => sectionButton(item, "rail")}</For>
          <div class="rail-foot">
            <button
              type="button"
              class="rail-item"
              aria-haspopup="dialog"
              onClick={() => setSettingsOpen(true)}
            >
              <span class="rail-indicator">
                <span class="icon icon-settings" aria-hidden="true" />
              </span>
              <span class="rail-label">Settings</span>
            </button>
          </div>
        </nav>
      </Show>

      <div class="shell-main">
        <header
          class="switcher-row"
          ref={(el) => {
            // A Finder's search bar sticks just under this row, whatever
            // height the text scale gives it.
            if (typeof ResizeObserver !== "function") return;
            const observer = new ResizeObserver(() =>
              el
                .closest<HTMLElement>(".shell")
                ?.style.setProperty("--switcher-height", `${el.offsetHeight}px`),
            );
            observer.observe(el);
            onCleanup(() => observer.disconnect());
          }}
        >
          <Show when={!expanded()}>
            <button
              type="button"
              class="btn-text icon-button"
              aria-haspopup="dialog"
              onClick={() => setMenuOpen(true)}
            >
              <span class="icon icon-menu" aria-hidden="true" />
              <span class="visually-hidden">Menu</span>
            </button>
          </Show>
          <nav class="crumbs" aria-label="Hymnbook and song">
            <Show when={hymnbook()} fallback={<span class="crumb-static">Hymnal</span>}>
              {(book) => (
                <button
                  type="button"
                  class="crumb crumb-book"
                  aria-haspopup="dialog"
                  onClick={() => setBookPickerOpen(true)}
                >
                  {/* On a phone, beside a hymn, the book is its icon; its
                      title stays the accessible name (styles.css). */}
                  <span class="icon icon-library crumb-book-icon" aria-hidden="true" />
                  <span class="crumb-text">{book().title}</span>
                  <span class="icon icon-expand" aria-hidden="true" />
                </button>
              )}
            </Show>
            <Show when={section() === "present" && hymn()}>
              {(current) => (
                <>
                  <span class="crumb-separator" aria-hidden="true">
                    /
                  </span>
                  <button
                    type="button"
                    class="crumb crumb-hymn"
                    aria-haspopup="dialog"
                    onClick={() => setHymnPickerOpen(true)}
                  >
                    <span class="crumb-number">#{current().number}</span>
                    <span class="crumb-text">{current().title}</span>
                    <span class="icon icon-expand" aria-hidden="true" />
                  </button>
                </>
              )}
            </Show>
          </nav>
          {/* The command menu, findable (the mockup): the same box as
              Ctrl/⌘+K and /. On a phone, its icon. */}
          <Show when={hymnbook()}>
            <button
              type="button"
              class="switcher-find"
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K"
              onClick={() => openSheet(setCommandMenuOpen)}
            >
              <span class="icon icon-search" aria-hidden="true" />
              <span class="switcher-find-text">Find a song or action</span>
              <span class="key-combo switcher-find-key" aria-hidden="true">
                <kbd class="key-hint">Ctrl</kbd>
                <kbd class="key-hint">K</kbd>
              </span>
            </button>
          </Show>
          {/* Go live (PRINCIPLES.md: emphasis follows the task): a one-off
              action, so it becomes a status once the Output is open — On
              air — and then brings that window forward. Top right on every
              screen, where Slides and Keynote put theirs. Blanked is the
              Output's other status, so it shows here too — on every
              screen, whether Live is on screen or not (SDD-0001 §16.5);
              B, Live's Restore or the command menu restore it. */}
          <button
            type="button"
            class="present-button"
            classList={{
              presenting: presentingOutput(),
              "present-blanked": presentingOutput() && blanked(),
            }}
            aria-keyshortcuts="O"
            title={
              !presentingOutput()
                ? "Open the Output (O)"
                : blanked()
                  ? "The Output is blanked; B restores it. Bring it forward (O)"
                  : "Bring the Output forward (O)"
            }
            onClick={openOutput}
          >
            <Show
              when={presentingOutput()}
              fallback={<span class="icon icon-present" aria-hidden="true" />}
            >
              <span class="on-air" aria-hidden="true" />
            </Show>
            <SwapLabel
              labels={["Go Live", "On Air", "Blanked"]}
              current={!presentingOutput() ? "Go Live" : blanked() ? "Blanked" : "On Air"}
            />
          </button>
        </header>

        <main
          class="workspace"
          classList={{ "workspace-full": section() === "present" && !!hymnNumber() }}
        >
          <Switch>
            <Match when={section() === "library"}>
              <Library onLoaded={setHymnbook} onReady={findHymn} />
            </Match>
            <Match when={section() === "present" && !hymnNumber()}>
              <Finder hymnbookId={hymnbookId()} onSelect={chooseHymn} />
            </Match>
            <Match when={section() === "present" && hymnNumber()}>
              {(number) => (
                <Presenter
                  hymnNumber={number()}
                  hymnbookId={hymnbookId()}
                  onLoaded={setHymn}
                  onBack={() => setHymnPickerOpen(true)}
                  blanked={blanked()}
                  onToggleBlank={toggleBlank}
                  presenting={presentingOutput()}
                  panes={preferences.preferences().panes}
                  workspace={preferences.preferences().workspace}
                  onWorkspaceChange={(workspace) =>
                    preferences.update({ ...preferences.preferences(), workspace })
                  }
                  onSelectHymn={chooseHymn}
                  scrollSync={preferences.preferences().scrollSync ?? true}
                  onActions={(actions) => setPresenterActions(() => actions)}
                  hymnbookTitle={hymnbook()?.title}
                  cues={outputCuesOf(preferences.preferences())}
                  revealCues={cuesRevealed()}
                  pinChorus={pinChorusOf(preferences.preferences())}
                />
              )}
            </Match>
          </Switch>
        </main>
      </div>

      <Sheet
        open={hymnPickerOpen()}
        onClose={() => setHymnPickerOpen(false)}
        title="Go to a Song"
        placement={expanded() ? "center" : "bottom"}
      >
        <Finder hymnbookId={hymnbookId()} current={hymnNumber()} onSelect={chooseHymn} />
      </Sheet>

      <Sheet
        open={commandMenuOpen()}
        onClose={() => setCommandMenuOpen(false)}
        title="Search"
        placement={expanded() ? "center" : "bottom"}
      >
        <Finder
          hymnbookId={hymnbookId()}
          current={hymnNumber()}
          onSelect={(number) => {
            setCommandMenuOpen(false);
            chooseHymn(number);
          }}
          commands={commands().map((command) => ({ ...command, label: titleCase(command.label) }))}
        />
      </Sheet>

      <Sheet
        open={shortcutsOpen()}
        onClose={closeShortcuts}
        closeLabel={shortcutsReturn() ? "Back" : undefined}
        title="Keyboard Shortcuts"
        placement={expanded() ? "center" : "bottom"}
      >
        <table class="shortcut-table">
          <tbody>
            <For each={SHORTCUTS}>
              {(shortcut) => (
                <tr>
                  <th scope="row" class="shortcut-keys">
                    <For each={shortcut.keys}>
                      {(key) => (
                        <span class="key-combo">
                          {/* "Ctrl+K" is two caps; a lone "+" stays one. */}
                          <For each={key.split(/\+(?=.)/)}>
                            {(cap) => <kbd class="key-hint">{cap}</kbd>}
                          </For>
                        </span>
                      )}
                    </For>
                  </th>
                  <td class="body-large">{shortcut.label}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Sheet>

      <Sheet
        open={bookPickerOpen()}
        onClose={() => setBookPickerOpen(false)}
        title="Hymnbooks"
        placement={expanded() ? "center" : "bottom"}
      >
        <ul class="list">
          <For each={installed()}>
            {(book) => (
              <li>
                <button
                  type="button"
                  class="list-row"
                  aria-current={book.id === hymnbookId() ? "true" : undefined}
                  onClick={() => chooseHymnbook(book.id)}
                >
                  {book.title}
                  <span class="list-row-supporting"> — {book.hymnCount} songs</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Sheet>

      <Sheet open={menuOpen()} onClose={() => setMenuOpen(false)} title="Menu">
        <nav aria-label="Sections">
          <ul class="list">
            <For each={SECTIONS}>{(item) => <li>{sectionButton(item, "menu")}</li>}</For>
          </ul>
        </nav>
        <Settings controller={preferences} onShowShortcuts={() => showShortcuts(setMenuOpen)} />
      </Sheet>

      <Sheet
        open={settingsOpen()}
        onClose={() => setSettingsOpen(false)}
        title="Settings"
        placement={expanded() ? "center" : "bottom"}
      >
        <Settings controller={preferences} onShowShortcuts={() => showShortcuts(setSettingsOpen)} />
      </Sheet>
    </div>
  );
}

export default App;
