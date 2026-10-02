import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import {
  describeScreen,
  keyOf,
  rememberedScreenOf,
  type ScreenKey,
  sameKey,
} from "../output/screens.ts";
import {
  type BandSize,
  bandSizeOf,
  DEFAULT_OUTPUT_THEME,
  DEFAULT_PREFERENCES,
  userState as defaultUserState,
  type Highlight,
  highlightOf,
  type OutputCues,
  type OutputTheme,
  outputCuesOf,
  type Preferences,
  pinChorusOf,
  type UserState,
  wholeSongOf,
} from "../persistence/user-state.ts";
import { ariaKeys, keyHint, withKey } from "./keymap.ts";
import { Menu } from "./Menu.tsx";
import { createMediaQuery, EXPANDED_QUERY } from "./media.ts";
import { createOutputScreens, type OutputScreens } from "./outputScreens.ts";
import { isPaneShown, PANES, type PaneId } from "./panes.ts";
import { easeThemeChange, revealWithin, shownTheme } from "./theme.ts";
import { setSplit, workspaceOf } from "./workspace.ts";

const MIN_SCALE = 0.75;
const MAX_SCALE = 2;
const SCALE_STEP = 0.125;
const THEMES: { value: Preferences["theme"]; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const OUTPUT_THEMES: { value: OutputTheme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "contrast", label: "Contrast" },
  { value: "warm", label: "Warm" },
];
/** The Output's cues, each its own switch, defaulting to
 * DEFAULT_OUTPUT_CUES (DESIGN.md § Typography); the command menu reads the
 * same list. */
export const OUTPUT_CUES: {
  id: Exclude<keyof OutputCues, "fade">;
  name: string;
  example: string;
}[] = [
  { id: "number", name: "Song number", example: "312, top left, for songbooks" },
  { id: "title", name: "Song title", example: "Amazing Grace" },
  { id: "hymnbook", name: "Hymnbook", example: "the book's title" },
  { id: "part", name: "Part", example: "Verse 2, Chorus" },
  { id: "repeat", name: "Repeat count", example: "×2, on a repeat" },
];

const HIGHLIGHTS: { value: Highlight; label: string }[] = [
  { value: "part", label: "Current part" },
  { value: "song", label: "Whole song" },
];

const BAND_SIZES: { value: BandSize; label: string }[] = [
  { value: "part", label: "Part" },
  { value: "line", label: "Line" },
];

let nextId = 0;

export interface PreferencesController {
  preferences: () => Preferences;
  /** Whether the stored preferences have been read; until then
   * {@link preferences} is the defaults, which a once-only note must not trust. */
  loaded: () => boolean;
  update: (next: Preferences) => void;
  /** Steps the Operator's text scale within its bounds — Settings' A− A+
   * and the + − keys (SDD-0001 §16.5). */
  adjustScale: (direction: 1 | -1) => void;
  /** Shows or hides a supporting pane (SDD-0001 §16.4). */
  setPane: (id: PaneId, shown: boolean) => void;
  /** Turns one of the Output's cues on or off (SDD-0001 §16.1). */
  setCue: (id: keyof OutputCues, on: boolean) => void;
}

export const canAdjustScale = (preferences: Preferences, direction: 1 | -1) =>
  direction > 0 ? preferences.fontScale < MAX_SCALE : preferences.fontScale > MIN_SCALE;

/** The Operator's Live preview, or the phone's collapsed Live strip. */
const LIVE_SELECTOR = ".operator .output-view-mini, .operator .live-strip-toggle";

/**
 * Loads the user's preferences and applies them globally as `--font-scale`
 * and `data-theme` on the root element. The shell creates one at startup, so
 * preferences apply even while no Settings UI is mounted (it lives in sheets
 * now, DESIGN.md § Structure).
 */
export function createPreferences(state: UserState = defaultUserState): PreferencesController {
  const [loaded, { mutate }] = createResource(() => state.getPreferences());
  const preferences = () => loaded() ?? DEFAULT_PREFERENCES;

  createEffect(() => {
    const prefs = preferences();
    const root = document.documentElement;
    if (prefs.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prefs.theme);
    root.style.setProperty("--font-scale", String(prefs.fontScale));
    // Live and the Live strip are the Output scaled: same preset.
    root.setAttribute("data-output-theme", prefs.outputTheme ?? DEFAULT_OUTPUT_THEME);
  });

  // The system's theme changing is revealed too, while the Operator follows
  // it: the listener runs as the frame begins, before it's painted, with the
  // page already in the new theme, so the copy is told the one it left.
  const system = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onSystemTheme = (event: MediaQueryListEvent) => {
    if (preferences().theme !== "system") return;
    easeThemeChange(() => {}, ["data-theme-copy", event.matches ? "light" : "dark"], "middle");
  };
  system?.addEventListener?.("change", onSystemTheme);
  onCleanup(() => system?.removeEventListener?.("change", onSystemTheme));

  const update = (next: Preferences) => {
    const current = preferences();
    // A theme eases: revealed over the old (theme.ts).
    if (next.theme !== current.theme)
      easeThemeChange(() => mutate(next), ["data-theme-copy", shownTheme()]);
    else if (next.outputTheme !== current.outputTheme) {
      // Only Live shows the presentation's theme; the reveal plays there.
      const lives = [...document.querySelectorAll<HTMLElement>(LIVE_SELECTOR)].filter(
        (el) => el.getBoundingClientRect().width > 0,
      );
      revealWithin(lives, () => mutate(next));
    } else mutate(next);
    void state.setPreferences(next);
  };
  return {
    preferences,
    loaded: () => loaded.state === "ready",
    update,
    adjustScale: (direction) => {
      const current = preferences();
      const scaled = current.fontScale + direction * SCALE_STEP;
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scaled));
      update({ ...current, fontScale: Math.round(clamped * 1000) / 1000 });
    },
    setPane: (id, shown) => {
      const current = preferences();
      update({ ...current, panes: { ...current.panes, [id]: shown } });
    },
    setCue: (id, on) => {
      const current = preferences();
      update({ ...current, outputCues: { ...outputCuesOf(current), [id]: on } });
    },
  };
}

export interface SettingsProps {
  /** Defaults to the {@link defaultUserState} singleton; overridable for tests. */
  userState?: UserState;
  /** The shell's shared controller; without one, Settings makes its own. */
  controller?: PreferencesController;
  /** The shell's shared screens (ADR-0028); without one, Settings makes its own. */
  screens?: OutputScreens;
  /** Opens the shortcut sheet; without it, the Keyboard section is left out. */
  onShowShortcuts?: () => void;
}

/**
 * Board #10's "user-controlled text scale and contrast" (arc42 §8.7), applied
 * globally as `--font-scale` and `data-theme` on the root element, grouped
 * since Board #12 part 3d (DESIGN.md § Structure): Display, Workspace,
 * Presentation, Keyboard.
 */
export function Settings(props: SettingsProps) {
  const { preferences, update, adjustScale, setPane, setCue } =
    props.controller ?? createPreferences(props.userState ?? defaultUserState);
  const id = `settings-${++nextId}`;
  // Tooltips carry key hints only where there's a keyboard (SDD-0001 §16.5).
  const keyboard = createMediaQuery(EXPANDED_QUERY);

  // A segmented button on native radios (MD3).
  const segmented = <T extends string>(
    legend: string,
    name: string,
    options: { value: T; label: string }[],
    current: () => T,
    choose: (value: T) => void,
  ) => (
    <fieldset class="segmented">
      <legend class="visually-hidden">{legend}</legend>
      <For each={options}>
        {(option) => (
          <label class="segment">
            <input
              type="radio"
              name={`${id}-${name}`}
              class="segment-input"
              checked={current() === option.value}
              onChange={() => choose(option.value)}
            />
            <span class="segment-check icon icon-check" aria-hidden="true" />
            {option.label}
          </label>
        )}
      </For>
    </fieldset>
  );

  // The Output screen (ADR-0028): Automatic, or one of the detected screens;
  // a remembered one that is not attached stays listed, marked.
  const screens = props.screens ?? createOutputScreens();
  const remembered = () => rememberedScreenOf(preferences().outputScreen);
  const screenList = createMemo<{ key: ScreenKey; text: string }[]>(() => {
    const detected = screens.screens().map((screen, index) => ({
      key: keyOf(screen),
      text: describeScreen(screen, index),
    }));
    const wanted = remembered();
    if (wanted && !detected.some((entry) => sameKey(entry.key, wanted)))
      detected.push({ key: wanted, text: `${describeScreen(wanted)} (not connected)` });
    return detected;
  });
  const chosenScreen = () => {
    const wanted = remembered();
    return wanted ? String(screenList().findIndex((entry) => sameKey(entry.key, wanted))) : "auto";
  };
  const chosenText = () => {
    const at = chosenScreen();
    return at === "auto" ? "Automatic" : (screenList()[Number(at)]?.text ?? "Automatic");
  };
  // One screen attached: nothing to choose, so no list is offered.
  const oneScreen = () => screens.screens().length === 1 && screenList().length <= 1;
  const chooseScreenAt = (value: string) => {
    const { outputScreen: _previous, ...rest } = preferences();
    const entry = value === "auto" ? undefined : screenList()[Number(value)];
    update(entry ? { ...rest, outputScreen: entry.key } : rest);
  };
  const screenNote = () => {
    if (screens.status() === "denied")
      return "The browser blocked screen access. Allow window management for this site in its settings, then detect again";
    if (screens.status() === "error") return "Could not list the screens. Detect to try again";
    if (screens.screens().length === 0)
      return "Automatic picks the projector once the screens are known; Detect screens asks the browser";
    if (screens.screens().length === 1)
      return "Connect a projector or second screen, then detect again";
    return "Automatic picks an external screen that is not your main one";
  };

  // Search (a Settings sheet grows): rows whose text holds every word typed
  // stay, the rest hide, and a section left empty hides its heading too.
  // It reads what's on screen, so a new row is searchable with no list to
  // keep in step.
  const [query, setQuery] = createSignal("");
  const [noMatch, setNoMatch] = createSignal(false);
  let settingsRef: HTMLDivElement | undefined;
  createEffect(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean);
    const root = settingsRef;
    if (!root) return;
    let any = false;
    for (const section of root.querySelectorAll<HTMLElement>(".settings-section")) {
      let shown = false;
      for (const row of section.querySelectorAll<HTMLElement>(".settings-row, .settings-link")) {
        const text = row.textContent?.toLowerCase() ?? "";
        const match = words.every((word) => text.includes(word));
        row.hidden = !match;
        shown ||= match;
      }
      section.hidden = !shown;
      any ||= shown;
    }
    setNoMatch(!any);
  });

  return (
    <div class="settings" ref={settingsRef}>
      <label class="text-field settings-search">
        <input
          type="search"
          placeholder="Search settings"
          aria-label="Search settings"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <Show when={noMatch()}>
        <p class="body-large on-surface-variant">No settings match “{query().trim()}”.</p>
      </Show>
      <section class="settings-section" aria-labelledby={`${id}-display`}>
        <h3 id={`${id}-display`} class="settings-heading">
          Display
        </h3>
        <div class="settings-row">
          <span class="settings-label">Theme</span>
          {segmented(
            "Theme",
            "theme",
            THEMES,
            () => preferences().theme,
            (theme) => update({ ...preferences(), theme }),
          )}
        </div>
        <div class="settings-row">
          <span class="settings-label">Text size</span>
          <div class="settings-stepper">
            <button
              type="button"
              class="btn-text"
              onClick={() => adjustScale(-1)}
              disabled={!canAdjustScale(preferences(), -1)}
              aria-label="Decrease text size"
              aria-keyshortcuts={ariaKeys("text-size", 1)}
              title={withKey("Decrease text size", "text-size", keyboard(), 1)}
            >
              A−
            </button>
            <output class="settings-value" aria-live="polite">
              {Math.round(preferences().fontScale * 100)}%
            </output>
            <button
              type="button"
              class="btn-text"
              onClick={() => adjustScale(1)}
              disabled={!canAdjustScale(preferences(), 1)}
              aria-label="Increase text size"
              aria-keyshortcuts={ariaKeys("text-size", 0)}
              title={withKey("Increase text size", "text-size", keyboard())}
            >
              A+
            </button>
          </div>
        </div>
      </section>

      <section class="settings-section" aria-labelledby={`${id}-workspace`}>
        <h3 id={`${id}-workspace`} class="settings-heading">
          Workspace
        </h3>
        <For each={PANES}>
          {(pane) => (
            <label class="settings-row">
              <span class="settings-label">
                Show {pane.name}
                <span class="settings-supporting">
                  {pane.description}
                  {pane.shortcut ? ` (${keyHint(pane.shortcut)})` : ""}
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                class="switch"
                checked={isPaneShown(preferences(), pane.id)}
                aria-checked={isPaneShown(preferences(), pane.id)}
                onChange={(event) => setPane(pane.id, event.currentTarget.checked)}
              />
            </label>
          )}
        </For>
        <label class="settings-row">
          <span class="settings-label">
            Split the tabs
            <span class="settings-supporting">
              Two groups side by side from 1400px wide; off, one tabbed area
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            checked={workspaceOf(preferences()).split}
            aria-checked={workspaceOf(preferences()).split}
            onChange={(event) =>
              update({
                ...preferences(),
                workspace: setSplit(workspaceOf(preferences()), event.currentTarget.checked),
              })
            }
          />
        </label>
        <label class="settings-row">
          <span class="settings-label">
            Scrolling the Output moves the Operator
            <span class="settings-supporting">
              Off, the Output drifts back to what's live after a hand scroll
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            checked={preferences().scrollSync ?? true}
            aria-checked={preferences().scrollSync ?? true}
            onChange={(event) =>
              update({ ...preferences(), scrollSync: event.currentTarget.checked })
            }
          />
        </label>
        <div class="settings-row">
          <span class="settings-label">
            Reading band on the Output
            <span class="settings-supporting">
              While someone scrolls it by hand, what stays lit: a part, or one line
            </span>
          </span>
          {segmented(
            "Reading band on the Output",
            "band-size",
            BAND_SIZES,
            () => bandSizeOf(preferences()),
            (bandSize) => update({ ...preferences(), bandSize }),
          )}
        </div>
      </section>

      <section class="settings-section" aria-labelledby={`${id}-presentation`}>
        <h3 id={`${id}-presentation`} class="settings-heading">
          Presentation
        </h3>
        <Show when={screens.supported}>
          <div class="settings-row">
            <span class="settings-label">
              Output screen
              <span class="settings-supporting">{screenNote()}</span>
            </span>
            <div class="settings-screen-control">
              <Show
                when={!oneScreen()}
                fallback={<span class="settings-screen-text">One screen attached</span>}
              >
                <Menu
                  id={`${id}-output-screen`}
                  label="Output screen"
                  choice={chosenText()}
                  items={[
                    {
                      label: "Automatic",
                      current: chosenScreen() === "auto",
                      run: () => chooseScreenAt("auto"),
                    },
                    ...screenList().map((entry, index) => ({
                      label: entry.text,
                      current: chosenScreen() === String(index),
                      run: () => chooseScreenAt(String(index)),
                    })),
                  ]}
                />
              </Show>
              <button type="button" class="btn-text" onClick={() => void screens.detect()}>
                Detect screens
              </button>
            </div>
          </div>
        </Show>
        <div class="settings-row">
          <span class="settings-label">
            Output theme
            <span class="settings-supporting">The audience screen, apart from this one</span>
          </span>
          {/* Swatches, not a segmented button: a theme is chosen by sight,
              and four fit a phone only as tiles that wrap. */}
          <fieldset class="theme-swatches">
            <legend class="visually-hidden">Output theme</legend>
            <For each={OUTPUT_THEMES}>
              {(theme) => (
                <label class="theme-swatch">
                  <input
                    type="radio"
                    name={`${id}-output-theme`}
                    class="visually-hidden"
                    checked={(preferences().outputTheme ?? DEFAULT_OUTPUT_THEME) === theme.value}
                    onChange={() => update({ ...preferences(), outputTheme: theme.value })}
                  />
                  <span
                    class="theme-swatch-sample"
                    data-output-theme={theme.value}
                    aria-hidden="true"
                  >
                    Aa
                  </span>
                  {theme.label}
                </label>
              )}
            </For>
          </fieldset>
        </div>
        <div class="settings-row">
          <span class="settings-label">
            Highlight on the Output
            <span class="settings-supporting">
              What is lit: the part being sung, or the whole song with nothing dimmed, for singing
              straight through ({keyHint("highlight")} switches)
            </span>
          </span>
          {segmented(
            "Highlight on the Output",
            "highlight",
            HIGHLIGHTS,
            () => highlightOf(preferences()),
            (highlight) => update({ ...preferences(), highlight }),
          )}
        </div>
        <label class="settings-row">
          <span class="settings-label">
            Whole song on screen
            <span class="settings-supporting">
              On a wide screen the whole song at once in columns, nothing scrolling; a long song
              takes pages. A tall screen scrolls as ever
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            checked={wholeSongOf(preferences())}
            aria-checked={wholeSongOf(preferences())}
            onChange={(event) =>
              update({ ...preferences(), wholeSong: event.currentTarget.checked })
            }
          />
        </label>
        <label class="settings-row">
          <span class="settings-label">
            Pin the chorus
            <span class="settings-supporting">
              Beside the verses on a wide screen, below on a tall one; a hymn flows if its type
              would get too small. Not used while the whole song is on screen
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            checked={pinChorusOf(preferences())}
            aria-checked={pinChorusOf(preferences())}
            onChange={(event) =>
              update({ ...preferences(), pinChorus: event.currentTarget.checked })
            }
          />
        </label>
        <For each={OUTPUT_CUES}>
          {(cue) => (
            <label class="settings-row">
              <span class="settings-label">
                Show {cue.name.toLowerCase()}
                <span class="settings-supporting">On the Output, e.g. {cue.example}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                class="switch"
                checked={!!outputCuesOf(preferences())[cue.id]}
                aria-checked={!!outputCuesOf(preferences())[cue.id]}
                onChange={(event) => setCue(cue.id, event.currentTarget.checked)}
              />
            </label>
          )}
        </For>
        <label class="settings-row">
          <span class="settings-label">
            Fade cues after a few seconds
            <span class="settings-supporting">Each shows when it changes, then fades</span>
          </span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            checked={!!outputCuesOf(preferences()).fade}
            aria-checked={!!outputCuesOf(preferences()).fade}
            onChange={(event) => setCue("fade", event.currentTarget.checked)}
          />
        </label>
      </section>

      <Show when={props.onShowShortcuts}>
        {(show) => (
          <section class="settings-section" aria-labelledby={`${id}-keyboard`}>
            <h3 id={`${id}-keyboard`} class="settings-heading">
              Keyboard
            </h3>
            <button type="button" class="list-row settings-link" onClick={() => show()()}>
              Keyboard Shortcuts
              <kbd class="key-hint">{keyHint("shortcuts")}</kbd>
            </button>
          </section>
        )}
      </Show>
    </div>
  );
}
