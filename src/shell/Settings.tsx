import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
import { mirroredNote } from "../output/displayChange.ts";
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
  type GoLive,
  goLiveOf,
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
import { glideList } from "./glideList.ts";
import { hoverGroup } from "./hoverGlide.ts";
import { KeyCombo } from "./KeyCombo.tsx";
import { ariaKeys, keyHint, withKey } from "./keymap.ts";
import { Menu } from "./Menu.tsx";
import { createMediaQuery, EXPANDED_QUERY } from "./media.ts";
import { createOutputScreens, type OutputScreens } from "./outputScreens.ts";
import { isPaneShown, PANES, type PaneId } from "./panes.ts";
import { selectGlide } from "./selectGlide.ts";
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
 * same list. `hint` is the row's one short line: what you will see. */
export const OUTPUT_CUES: {
  id: Exclude<keyof OutputCues, "fade">;
  name: string;
  hint: string;
}[] = [
  { id: "number", name: "Song number", hint: "The number in the top corner, e.g. 312." },
  { id: "title", name: "Song title", hint: "The title at the bottom, e.g. Amazing Grace." },
  { id: "hymnbook", name: "Hymnbook", hint: "The book's name at the bottom." },
  {
    id: "part",
    name: "Parts",
    hint: "Which part is sung, e.g. Verse 2 or Chorus.",
  },
  { id: "repeat", name: "Repeat count", hint: "×2 at the bottom when a part is sung again." },
];

/** Every other Presentation and Output setting's words, in one place: a short
 * sentence a volunteer at the projector understands at a glance. */
export const SETTING_COPY = {
  goLive: {
    title: "Go Live opens",
    hint: "Where Go Live shows the song: a projector window when one is found, or this screen.",
  },
  outputTheme: {
    title: "Output theme",
    hint: "The colours on the projector screen. This screen keeps its own.",
  },
  highlight: {
    title: "Highlight on the Output",
    hint: "Light only the part being sung, or the whole song at once.",
  },
  layout: {
    title: "Layout",
    hint: "One part at a time, or every verse at once in columns.",
  },
  onOutput: "On the Output",
  pinChorus: {
    title: "Pin the chorus",
    hint: "Keep the chorus in view beside or below the verses.",
  },
  fade: {
    title: "Fade the details",
    hint: "The number, title and the rest fade after a few seconds and return when the song changes.",
  },
  scrollSync: {
    title: "Scrolling the Output moves this screen",
    hint: "Off: after someone scrolls the Output, it slides back to what is live.",
  },
  bandSize: {
    title: "Highlight while scrolling",
    hint: "When someone scrolls the Output by hand, light a whole part or one line.",
  },
  screen: {
    denied:
      "The browser blocked screen access. Allow it in this site's settings, then detect again.",
    error: "Could not list the screens. Press Detect Screens to try again.",
    none: "Press Detect Screens so Automatic can find the projector.",
    several: "Automatic picks an external screen, not your own.",
  },
} as const;

const GO_LIVES: { value: GoLive; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "here", label: "This Screen" },
  { value: "window", label: "Output Window" },
];

const HIGHLIGHTS: { value: Highlight; label: string }[] = [
  { value: "part", label: "Current part" },
  { value: "song", label: "Whole song" },
];

const LAYOUTS: { value: "part" | "whole"; label: string }[] = [
  { value: "part", label: "Part by part" },
  { value: "whole", label: "Whole song" },
];

const BAND_SIZES: { value: BandSize; label: string }[] = [
  { value: "part", label: "Part" },
  { value: "line", label: "Line" },
];

let nextId = 0;

/** Whether any of the Output's cues is on: what a setting that only applies
 * while one shows (fading) waits for. */
export const anyCueOn = (cues: OutputCues) => OUTPUT_CUES.some((cue) => cues[cue.id]);

/** A setting that applies only under another, nested beneath it and shown only
 * then: it opens and closes smoothly (reduced motion fades only), and while
 * closed is out of reach (`inert`) yet keeps its stored value. */
function Disclosure(props: { open: boolean; children: JSX.Element }) {
  return (
    <div
      class="settings-disclosure"
      data-open={props.open ? "true" : "false"}
      aria-hidden={props.open ? undefined : "true"}
      ref={(el) => createEffect(() => el.toggleAttribute("inert", !props.open))}
    >
      <div class="settings-disclosure-inner">{props.children}</div>
    </div>
  );
}

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
      easeThemeChange(
        () => mutate(next),
        ["data-theme-copy", shownTheme()],
        "control",
        (layer) =>
          radioAsWas(
            layer,
            THEMES.findIndex((theme) => theme.value === current.theme),
          ),
      );
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

/** The radio group last used (the focused radio's), in a still copy of the
 * page, set back to its `index`-th choice: what was chosen before. */
function radioAsWas(layer: HTMLElement, index: number) {
  const used = document.activeElement;
  if (!(used instanceof HTMLInputElement) || used.type !== "radio" || index < 0) return;
  const group = [...layer.querySelectorAll<HTMLInputElement>("input[data-group]")].filter(
    (radio) => radio.dataset.group === used.name,
  );
  group.forEach((radio, i) => {
    radio.checked = i === index;
  });
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
  const anyCue = () => anyCueOn(outputCuesOf(preferences()));
  // Tooltips carry key hints only where there's a keyboard (SDD-0001 §16.5).
  const keyboard = createMediaQuery(EXPANDED_QUERY);

  // The rows of a section that act on a press (a switch's row, a link) show
  // the app's one hover highlight, which glides between them.
  const glideSection = (el: HTMLElement) =>
    onCleanup(glideList(el, { rows: "label.settings-row, button.settings-link" }).stop);

  // A segmented button on native radios (MD3). Its hover highlight and its
  // selected pill each glide from segment to segment.
  const glideSegments = (el: HTMLElement, current: () => string) => {
    const glide = glideList(el, {
      rows: ".segment",
      current: ".segment-input:checked",
      target: (input) => input.closest<HTMLElement>(".segment"),
    });
    onCleanup(glide.stop);
    // A radio's checked state is a property: tell the pill when it changes.
    createEffect(() => {
      current();
      queueMicrotask(() => glide.select?.sync());
    });
  };
  const segmented = <T extends string>(
    legend: string,
    name: string,
    options: { value: T; label: string }[],
    current: () => T,
    choose: (value: T) => void,
    tight = false,
  ) => (
    <fieldset
      class="segmented"
      data-keep-motion=""
      classList={{ "segmented-tight": tight }}
      ref={(el) => glideSegments(el, current)}
    >
      <legend class="visually-hidden">{legend}</legend>
      <For each={options}>
        {(option) => (
          <label class="segment" data-label={option.label}>
            <input
              type="radio"
              name={`${id}-${name}`}
              class="segment-input"
              checked={current() === option.value}
              onChange={() => choose(option.value)}
            />
            <span class="segment-face">
              <span class="segment-check icon icon-check" aria-hidden="true" />
              {option.label}
            </span>
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
    if (screens.status() === "denied") return SETTING_COPY.screen.denied;
    if (screens.status() === "error") return SETTING_COPY.screen.error;
    if (screens.screens().length === 0) return SETTING_COPY.screen.none;
    if (screens.screens().length === 1) return mirroredNote();
    return SETTING_COPY.screen.several;
  };

  // Search (a Settings sheet grows): rows whose text holds every word typed
  // stay, the rest hide, and a section left empty hides its heading too.
  // It reads what's on screen, so a new row is searchable with no list to
  // keep in step. A row inside a closed disclosure is hidden from a search
  // (it is out of reach, and a match there would show nothing to act on); the
  // effect reads the preferences so it re-runs when a disclosure opens or
  // closes, after the disclosure has set `data-open`.
  const [query, setQuery] = createSignal("");
  const [noMatch, setNoMatch] = createSignal(false);
  let settingsRef: HTMLDivElement | undefined;
  createEffect(() => {
    const words = query().toLowerCase().split(/\s+/).filter(Boolean);
    preferences();
    const root = settingsRef;
    if (!root) return;
    let any = false;
    for (const section of root.querySelectorAll<HTMLElement>(".settings-section")) {
      let shown = false;
      for (const row of section.querySelectorAll<HTMLElement>(".settings-row, .settings-link")) {
        const text = row.textContent?.toLowerCase() ?? "";
        const closed =
          words.length > 0 && row.closest('.settings-disclosure[data-open="false"]') !== null;
        const match = !closed && words.every((word) => text.includes(word));
        row.hidden = !match;
        shown ||= match;
      }
      for (const group of section.querySelectorAll<HTMLElement>(".settings-group"))
        group.hidden = !group.querySelector(".settings-row:not([hidden])");
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
      <section class="settings-section" ref={glideSection} aria-labelledby={`${id}-display`}>
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
          <div
            class="settings-stepper"
            ref={(el) => onCleanup(hoverGroup(el, ".btn-text:enabled"))}
          >
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

      <section class="settings-section" ref={glideSection} aria-labelledby={`${id}-workspace`}>
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
      </section>

      <section class="settings-section" ref={glideSection} aria-labelledby={`${id}-presentation`}>
        <h3 id={`${id}-presentation`} class="settings-heading">
          Presentation
        </h3>
        <div class="settings-row">
          <span class="settings-label">
            {SETTING_COPY.goLive.title}
            <span class="settings-supporting">{SETTING_COPY.goLive.hint}</span>
          </span>
          {segmented(
            SETTING_COPY.goLive.title,
            "go-live",
            GO_LIVES,
            () => goLiveOf(preferences()),
            (goLive) => update({ ...preferences(), goLive }),
            true,
          )}
        </div>
        {/* The screen is chosen only for a window: This Screen has none. */}
        <Show when={screens.supported}>
          <Disclosure open={goLiveOf(preferences()) !== "here"}>
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
                  Detect Screens
                </button>
              </div>
            </div>
          </Disclosure>
        </Show>
        <div class="settings-row">
          <span class="settings-label">
            {SETTING_COPY.outputTheme.title}
            <span class="settings-supporting">{SETTING_COPY.outputTheme.hint}</span>
          </span>
          {/* Swatches, not a segmented button: a theme is chosen by sight,
              and four fit a phone only as tiles that wrap. */}
          <fieldset
            class="theme-swatches"
            ref={(el) => {
              // The chosen theme's ring is one layer that glides to the next.
              const ring = selectGlide(el, {
                current: ".theme-swatch input:checked",
                target: (input) =>
                  input
                    .closest(".theme-swatch")
                    ?.querySelector<HTMLElement>(".theme-swatch-sample") ?? null,
                className: "select-pill select-ring",
              });
              onCleanup(ring.stop);
              createEffect(() => {
                void preferences().outputTheme;
                queueMicrotask(ring.sync);
              });
            }}
          >
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
            {SETTING_COPY.highlight.title}
            <span class="settings-supporting">
              {SETTING_COPY.highlight.hint} ({keyHint("highlight")} switches)
            </span>
          </span>
          {segmented(
            SETTING_COPY.highlight.title,
            "highlight",
            HIGHLIGHTS,
            () => highlightOf(preferences()),
            (highlight) => update({ ...preferences(), highlight }),
          )}
        </div>
        {/* The layout is a choice, so each layout's own settings sit under
            it: only the chosen one's shows, and one with none shows nothing.
            Whole song draws everything at once and does not scroll by hand,
            so it has none; Part by part pins and scrolls. */}
        <div class="settings-row">
          <span class="settings-label">
            {SETTING_COPY.layout.title}
            <span class="settings-supporting">{SETTING_COPY.layout.hint}</span>
          </span>
          {segmented(
            SETTING_COPY.layout.title,
            "layout",
            LAYOUTS,
            () => (wholeSongOf(preferences()) ? "whole" : "part"),
            (layout) => update({ ...preferences(), wholeSong: layout === "whole" }),
          )}
        </div>
        <Disclosure open={!wholeSongOf(preferences())}>
          <label class="settings-row">
            <span class="settings-label">
              {SETTING_COPY.pinChorus.title}
              <span class="settings-supporting">{SETTING_COPY.pinChorus.hint}</span>
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
          <label class="settings-row">
            <span class="settings-label">
              {SETTING_COPY.scrollSync.title}
              <span class="settings-supporting">{SETTING_COPY.scrollSync.hint}</span>
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
              {SETTING_COPY.bandSize.title}
              <span class="settings-supporting">{SETTING_COPY.bandSize.hint}</span>
            </span>
            {segmented(
              SETTING_COPY.bandSize.title,
              "band-size",
              BAND_SIZES,
              () => bandSizeOf(preferences()),
              (bandSize) => update({ ...preferences(), bandSize }),
            )}
          </div>
        </Disclosure>
        <div class="settings-group">
          <h4 class="settings-subheading">{SETTING_COPY.onOutput}</h4>
          <For each={OUTPUT_CUES}>
            {(cue) => (
              <label class="settings-row">
                <span class="settings-label">
                  Show {cue.name.toLowerCase()}
                  <span class="settings-supporting">{cue.hint}</span>
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
          {/* Fading is about the cues: shown only while one is on. */}
          <Disclosure open={anyCue()}>
            <label class="settings-row">
              <span class="settings-label">
                {SETTING_COPY.fade.title}
                <span class="settings-supporting">{SETTING_COPY.fade.hint}</span>
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
          </Disclosure>
        </div>
      </section>

      <Show when={props.onShowShortcuts}>
        {(show) => (
          <section class="settings-section" ref={glideSection} aria-labelledby={`${id}-keyboard`}>
            <h3 id={`${id}-keyboard`} class="settings-heading">
              Keyboard
            </h3>
            <button type="button" class="list-row settings-link" onClick={() => show()()}>
              Keyboard Shortcuts
              <KeyCombo keys={keyHint("shortcuts")} />
            </button>
          </section>
        )}
      </Show>
    </div>
  );
}
