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

export interface SettingsProps {
  /** Defaults to the {@link defaultUserState} singleton; overridable for tests. */
  userState?: UserState;
}

/**
 * Board #10 — the "user-controlled text scale and contrast" arc42 §8.7
 * requires, applied globally as `--font-scale` and `data-theme` on the root
 * element (styles.css) rather than per-view, since legibility matters in
 * Library and Finder too, not only Presenter.
 */
export function Settings(props: SettingsProps) {
  const state = () => props.userState ?? defaultUserState;
  const [preferences, { mutate }] = createResource(() => state().getPreferences());

  createEffect(() => {
    const prefs = preferences() ?? DEFAULT_PREFERENCES;
    const root = document.documentElement;
    if (prefs.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prefs.theme);
    root.style.setProperty("--font-scale", String(prefs.fontScale));
  });

  const update = (next: Preferences) => {
    mutate(next);
    void state().setPreferences(next);
  };

  const cycleTheme = () => {
    const current = preferences() ?? DEFAULT_PREFERENCES;
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current.theme) + 1) % THEME_CYCLE.length];
    update({ ...current, theme: next });
  };

  const adjustScale = (delta: number) => {
    const current = preferences() ?? DEFAULT_PREFERENCES;
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.fontScale + delta));
    update({ ...current, fontScale: Math.round(clamped * 1000) / 1000 });
  };

  return (
    <fieldset class="settings" aria-label="Display settings">
      <button
        type="button"
        onClick={() => adjustScale(-SCALE_STEP)}
        disabled={(preferences() ?? DEFAULT_PREFERENCES).fontScale <= MIN_SCALE}
        aria-label="Decrease text size"
      >
        A−
      </button>
      <button
        type="button"
        onClick={() => adjustScale(SCALE_STEP)}
        disabled={(preferences() ?? DEFAULT_PREFERENCES).fontScale >= MAX_SCALE}
        aria-label="Increase text size"
      >
        A+
      </button>
      <button type="button" onClick={cycleTheme}>
        Theme: {(preferences() ?? DEFAULT_PREFERENCES).theme}
      </button>
    </fieldset>
  );
}
