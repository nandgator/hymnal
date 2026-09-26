import { createEffect, createResource, For, Show } from "solid-js";
import {
  DEFAULT_OUTPUT_THEME,
  DEFAULT_PREFERENCES,
  userState as defaultUserState,
  type OutputCues,
  type OutputTheme,
  outputCuesOf,
  type Preferences,
  pinRefrainOf,
  type UserState,
} from "../persistence/user-state.ts";
import { isPaneShown, PANES, type PaneId } from "./panes.ts";
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
  { id: "number", name: "Hymn number", example: "312, top left, for songbooks" },
  { id: "title", name: "Hymn title", example: "Amazing Grace" },
  { id: "hymnbook", name: "Hymnbook", example: "the book's title" },
  { id: "part", name: "Part", example: "Verse 2, Refrain" },
  { id: "repeat", name: "Repeat count", example: "×2, on a repeat" },
];
const NAVIGATORS: { value: Preferences["navigator"]; label: string }[] = [
  { value: "parts", label: "Parts" },
  { value: "lyrics", label: "Lyrics" },
];

let nextId = 0;

export interface PreferencesController {
  preferences: () => Preferences;
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

  const update = (next: Preferences) => {
    mutate(next);
    void state.setPreferences(next);
  };
  return {
    preferences,
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

  // A segmented button on native radios, as the Operator's navigator switch.
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

  return (
    <div class="settings">
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
              title="Decrease text size (−)"
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
              title="Increase text size (+)"
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
                  {pane.key ? ` (${pane.key})` : ""}
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
          <span class="settings-label">On a phone, leads with</span>
          {segmented(
            "Leading navigator",
            "navigator",
            NAVIGATORS,
            () => preferences().navigator,
            (navigator) => update({ ...preferences(), navigator }),
          )}
        </div>
      </section>

      <section class="settings-section" aria-labelledby={`${id}-presentation`}>
        <h3 id={`${id}-presentation`} class="settings-heading">
          Presentation
        </h3>
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
        <label class="settings-row">
          <span class="settings-label">
            Pin the refrain (chorus)
            <span class="settings-supporting">
              Beside the verses on a wide screen, below on a tall one; a hymn flows if its type
              would get too small
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            class="switch"
            checked={pinRefrainOf(preferences())}
            aria-checked={pinRefrainOf(preferences())}
            onChange={(event) =>
              update({ ...preferences(), pinRefrain: event.currentTarget.checked })
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
              Keyboard shortcuts
              <kbd class="key-hint">?</kbd>
            </button>
          </section>
        )}
      </Show>
    </div>
  );
}
