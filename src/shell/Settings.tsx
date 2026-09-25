import { createEffect, createResource } from "solid-js";
import {
  DEFAULT_PREFERENCES,
  userState as defaultUserState,
  type Preferences,
  type UserState,
} from "../persistence/user-state.ts";

const MIN_SCALE = 0.75;
const MAX_SCALE = 2;
const SCALE_STEP = 0.125;
const THEME_CYCLE: Preferences["theme"][] = ["system", "light", "dark"];

export interface PreferencesController {
  preferences: () => Preferences;
  update: (next: Preferences) => void;
  /** Steps the Operator's text scale within its bounds — Settings' A− A+
   * and the + − keys (SDD-0001 §16.5). */
  adjustScale: (direction: 1 | -1) => void;
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
  };
}

export interface SettingsProps {
  /** Defaults to the {@link defaultUserState} singleton; overridable for tests. */
  userState?: UserState;
  /** The shell's shared controller; without one, Settings makes its own. */
  controller?: PreferencesController;
}

/**
 * Board #10 — the "user-controlled text scale and contrast" arc42 §8.7
 * requires, applied globally as `--font-scale` and `data-theme` on the root
 * element (styles.css) rather than per-view, since legibility matters in
 * Library and Finder too, not only Presenter.
 */
export function Settings(props: SettingsProps) {
  const { preferences, update, adjustScale } =
    props.controller ?? createPreferences(props.userState ?? defaultUserState);

  const cycleTheme = () => {
    const current = preferences();
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current.theme) + 1) % THEME_CYCLE.length];
    update({ ...current, theme: next });
  };

  return (
    <fieldset class="settings" aria-label="Display settings">
      <button
        type="button"
        class="btn-text"
        onClick={() => adjustScale(-1)}
        disabled={!canAdjustScale(preferences(), -1)}
        aria-label="Decrease text size"
      >
        A−
      </button>
      <button
        type="button"
        class="btn-text"
        onClick={() => adjustScale(1)}
        disabled={!canAdjustScale(preferences(), 1)}
        aria-label="Increase text size"
      >
        A+
      </button>
      <button type="button" class="btn-text" onClick={cycleTheme}>
        Theme: {preferences().theme}
      </button>
    </fieldset>
  );
}
