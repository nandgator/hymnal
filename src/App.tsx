import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
import type { Hymn, HymnbookId, HymnNumber } from "./domain/types.ts";
import { type Command, Finder } from "./finder/Finder.tsx";
import { createBooks } from "./library/books.ts";
import { Library } from "./library/Library.tsx";
import {
  closeOutput,
  type HeldView,
  type OutputMessage,
  revealCues,
  setOutputBlanked,
  setOutputHeld,
  setOutputPresentation,
  subscribeHold,
  subscribeKeys,
  subscribeLocalOutput,
  subscribeOutputShape,
  subscribeOutputState,
  subscribePlacement,
} from "./output/channel.ts";
import { mirroredNote, reviewScreens, type ScreensSnapshot } from "./output/displayChange.ts";
import { Output } from "./output/Output.tsx";
import { PresentHere } from "./output/PresentHere.tsx";
import {
  moveGuidance,
  moveShortcutHint,
  placementWasRefused,
  rememberPlacementRefused,
} from "./output/placement.ts";
import {
  chooseScreen,
  describeScreen,
  keyOf,
  rememberedScreenOf,
  type ScreenInfo,
  type ScreenKey,
  sameKey,
  screenAt,
} from "./output/screens.ts";
import { getContentAdmin, getContentStore } from "./persistence/content-store.ts";
import {
  bandSizeOf,
  DEFAULT_OUTPUT_THEME,
  goLiveOf,
  highlightOf,
  outputCuesOf,
  pinChorusOf,
  userState,
  wholeSongOf,
} from "./persistence/user-state.ts";
import { Presenter, type PresenterActions } from "./presenter/Presenter.tsx";
import { autoHover } from "./shell/autoHover.ts";
import { titleCase } from "./shell/case.ts";
import { glideList } from "./shell/glideList.ts";
import { hoverButton, hoverGroup } from "./shell/hoverGlide.ts";
import { KeyCombo } from "./shell/KeyCombo.tsx";
import {
  ariaKeys,
  ignoresShortcuts,
  keyHint,
  replayForwardedKey,
  SHORTCUTS,
  withKey,
} from "./shell/keymap.ts";
import { createMediaQuery, EXPANDED_QUERY } from "./shell/media.ts";
import { moveOutputTo, openOutputWindow } from "./shell/openOutput.ts";
import { createOutputScreens, mayHaveSecondScreen } from "./shell/outputScreens.ts";
import { isPaneShown, PANES, type PaneId } from "./shell/panes.ts";
import { canAdjustScale, createPreferences, OUTPUT_CUES, Settings } from "./shell/Settings.tsx";
import { Sheet, type SheetPage } from "./shell/Sheet.tsx";
import { SnackbarHost, type SnackbarProps } from "./shell/Snackbar.tsx";
import { SwapLabel } from "./shell/SwapLabel.tsx";
import { installScrollReveal } from "./shell/scrollReveal.ts";
import { type Shared, TabGate } from "./shell/TabGate.tsx";
import {
  homeScreenHintHere,
  isScreenNotice,
  pickNotice,
  restartIfAllowed,
  type ScreenNoticeId,
} from "./shell/updates.ts";
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

/** How long a placed Output may go fullscreen on its own before the hint says how. */
const FULLSCREEN_GRACE_MS = 1200;
/** Monitors send several events for one change: wait for them to stop. */
const SCREENS_SETTLE_MS = 300;
/** How often the Output's real screen is read while it is open. */
const TRACK_MS = 2000;

/** Notices about where the Output window is (DESIGN.md § Snackbar). */
const SCREEN_NOTICES: Record<
  Exclude<
    ScreenNoticeId,
    "activate" | "move" | "unconfirmed" | "connected" | "disconnected" | "extend"
  >,
  string
> = {
  drag: "Drag the Output to the projector, then press F11 for fullscreen.",
  // Said only once the Output has verified it (ADR-0028, Wayland).
  fullscreen: "The Output is on the projector screen.",
  blocked:
    "The browser blocked the Output window. Allow pop-ups for this site, then Go Live again.",
  back: "That screen is back. Move the Output to it?",
  stuck: "The Output could not move. Drag it to the screen yourself.",
};

/** The text of a screen notice; `activate` names the screen, which only the Operator knows. */
function screenNoticeText(id: ScreenNoticeId, screenLabel: string | undefined): string {
  const named = screenLabel ?? "the projector";
  if (id === "activate") return `Click the Output window (or press F there) to put it on ${named}.`;
  // The system cannot place the window: the person moves it (ADR-0028).
  if (id === "unconfirmed")
    return `The Output is fullscreen. If it isn't on ${named}, press Esc there, move it, and press F again.`;
  if (id === "connected") return `A projector is connected: ${screenLabel ?? "a second screen"}`;
  if (id === "disconnected")
    return `The projector was disconnected; the Output is on ${screenLabel ?? "this screen"}.`;
  if (id === "extend") return mirroredNote();
  if (id === "move") return [moveGuidance(named), moveShortcutHint()].filter(Boolean).join(" ");
  return SCREEN_NOTICES[id];
}

function isOutputWindow(): boolean {
  return new URLSearchParams(window.location.search).has("output");
}

/** Signal-based view state, not a router — SDD-0001 §12. */
function App() {
  // The Output is not an app tab: it never opens the store, so never takes the lock.
  return isOutputWindow() ? <Output /> : <TabGate>{(shared) => <Operator {...shared} />}</TabGate>;
}

/**
 * The layered shell, after Supabase Studio (DESIGN.md § Structure): sections
 * (a rail when wide, a menu on a phone), the switcher row — hymnbook ▾ /
 * hymn ▾, each a picker that hot-swaps in place — then the workspace, whose
 * width follows its content, and the dock/FAB.
 */
function Operator(props: Shared) {
  const expanded = createMediaQuery(EXPANDED_QUERY);
  // Applied at startup, whether or not a Settings sheet is open.
  const preferences = createPreferences();
  // Scrollbars fade in while a pane scrolls (DESIGN.md § Register).
  installScrollReveal();
  const [section, setSection] = createSignal<Section>("library");
  // The books held (SDD-0004 §9, §10). The current book is the Finder's scope:
  // the book a search looks in. The presented book is the one the hymn on
  // screen is from, which stays until a hymn is chosen from another (§16.4); the
  // crumb, This Song and Recents name that one, never the scope.
  const books = createBooks(getContentAdmin(), getContentStore());
  const [currentKey, setCurrentKey] = createSignal<HymnbookId>();
  const [presentedKey, setPresentedKey] = createSignal<HymnbookId>();
  const readable = () => (books.rows() ?? []).filter((book) => book.state === "ok");
  const hymnbook = () => readable().find((book) => book.key === currentKey());
  const presentedBook = () => readable().find((book) => book.key === presentedKey());
  // The crumb's book: with a song up, the song's own (its hymn knows where it
  // is from; the presented key is ahead of it by one load), else the scope.
  const crumbBook = () => {
    const song = section() === "present" ? hymn() : undefined;
    if (!song) return hymnbook();
    const key = song.hymnbookId ?? presentedKey();
    return readable().find((book) => book.key === key) ?? hymnbook();
  };
  // Every standalone button wears the hover layer (autoHover.ts).
  onMount(() => onCleanup(autoHover()));

  // The current book starts as the book of the newest recent still held,
  // else the first held book, and is chosen again if it stops being held
  // (a removal), SDD-0004 §9. Nothing held: none.
  createEffect(() => {
    const rows = books.rows();
    if (!rows) return;
    const held = rows.filter((book) => book.state === "ok").map((book) => book.key);
    // The book the hymn on screen is from is gone: so is the hymn, whatever
    // the current book is (the Library refuses this while the Output is live).
    if (presentedKey() !== undefined && !held.includes(presentedKey() as string)) {
      setPresentedKey(undefined);
      setHymnNumber(undefined);
      setHymn(undefined);
    }
    if (currentKey() !== undefined && held.includes(currentKey() as string)) return;
    void userState.getRecents().then((recents) => {
      const now = books.rows()?.filter((book) => book.state === "ok") ?? [];
      const alive = (key: string | undefined) => now.some((book) => book.key === key);
      if (alive(currentKey())) return;
      setCurrentKey(recents.find((entry) => alive(entry.hymnbookId))?.hymnbookId ?? now[0]?.key);
    });
  });
  // Present needs a book: with none, the Library is where to be.
  createEffect(() => {
    if (books.rows() && !hymnbook() && section() === "present") setSection("library");
  });
  // The first load's request to keep storage was refused (SDD-0004 §9).
  const [keepFile, setKeepFile] = createSignal(false);
  const [hymnNumber, setHymnNumber] = createSignal<HymnNumber>();
  const [hymn, setHymn] = createSignal<Hymn>();

  const [menuOpen, setMenuOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [bookPickerOpen, setBookPickerOpen] = createSignal(false);
  const [hymnPickerOpen, setHymnPickerOpen] = createSignal(false);
  const [commandMenuOpen, setCommandMenuOpen] = createSignal(false);
  // Keyboard Shortcuts is a page inside the Settings or Menu sheet, not a
  // sheet of its own: pushed from its row (Back returns), or `direct` when
  // the sheet was opened on it (? and the command), where it says Close.
  const [shortcuts, setShortcuts] = createSignal<{ host: "settings" | "menu"; direct: boolean }>();

  // H: light the whole song, or only the current part, live.
  const toggleHighlight = () => {
    const prefs = preferences.preferences();
    preferences.update({ ...prefs, highlight: highlightOf(prefs) === "song" ? "part" : "song" });
  };

  // The Output follows Presentation settings live, and a late Output gets
  // them replayed (SDD-0001 §16.1).
  createEffect(() =>
    setOutputPresentation({
      theme: preferences.preferences().outputTheme ?? DEFAULT_OUTPUT_THEME,
      cues: outputCuesOf(preferences.preferences()),
      pinChorus: pinChorusOf(preferences.preferences()),
      wholeSong: wholeSongOf(preferences.preferences()),
      highlight: highlightOf(preferences.preferences()),
      bandSize: bandSizeOf(preferences.preferences()),
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
  const presence = props.presence;
  const presentingOutput = presence.open;
  // One-screen presenting (Board #41, SDD-0001 §16.7): this tab is the
  // Output, fullscreen. The Operator's state stays the one source of truth;
  // presenting here only shows the Presenter's published message in the tab.
  const presentingHere = presence.here;
  const [hereMessage, setHereMessage] =
    createSignal<Extract<OutputMessage, { type: "content" | "idle" }>>();
  onMount(() => onCleanup(subscribeLocalOutput(setHereMessage)));
  // Whether fullscreen was ever entered here: leaving it ends presenting, but
  // a browser that refused it keeps the view until F or Esc.
  let hereWasFullscreen = false;
  // Where keyboard lock is supported, Esc reaches the page, so it can close
  // the switcher before it leaves; elsewhere the browser's own Esc leaves.
  type KeyboardLock = { lock?: (keys: string[]) => Promise<void>; unlock?: () => void };
  const keyboardLock = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
  const onHereFullscreen = () => {
    if (!presentingHere()) return;
    if (document.fullscreenElement) hereWasFullscreen = true;
    else if (hereWasFullscreen) leavePresentingHere();
  };
  const leavePresentingHere = () => {
    if (!presentingHere()) return;
    presence.setHere(false);
    hereWasFullscreen = false;
    document.removeEventListener("fullscreenchange", onHereFullscreen);
    keyboardLock()?.unlock?.();
    if (document.fullscreenElement)
      void Promise.resolve(document.exitFullscreen?.()).catch(() => {});
  };
  onCleanup(() => document.removeEventListener("fullscreenchange", onHereFullscreen));
  // An Output window that opens (or answers late) takes over the audience.
  createEffect(() => {
    if (presentingOutput() && presentingHere()) leavePresentingHere();
  });
  // Hold (SDD-0001 §16.6): the channel owns it (and what it froze on), the
  // Output being the truth; here is only its view. Nothing to hold without
  // an Output, so it can't start then, and it ends with the window.
  const [held, setHeld] = createSignal<HeldView>();
  onMount(() => onCleanup(subscribeHold(setHeld)));
  const toggleHold = () => {
    if (held()) setOutputHeld(false);
    else if (presentingOutput()) setOutputHeld(true);
  };
  createEffect(
    on(
      presentingOutput,
      (open) => {
        if (!open && held()) setOutputHeld(false);
      },
      { defer: true },
    ),
  );
  // End Live (SDD-0001 §16.4): the Output window closes; Go Live opens it
  // again. The window's own bye is what turns the header back to Go Live.
  const endLive = () => {
    if (!presentingOutput()) return;
    // The window closes itself on the word; the opener's own handle closes it
    // too, where a browser would refuse the window closing itself.
    closeOutput();
    if (outputWin && !outputWin.closed) outputWin.close?.();
  };
  // A reloaded Operator adopts the blank the Output window holds.
  onMount(() => onCleanup(subscribeOutputState((state) => setBlanked(state.blanked))));
  // Live matches the Output window's shape; unknown, it is landscape.
  const [outputLandscape, setOutputLandscape] = createSignal<boolean | undefined>();
  onMount(() => onCleanup(subscribeOutputShape(setOutputLandscape)));
  // The screens the Output can be placed on (ADR-0028), shared with Settings.
  const screens = createOutputScreens();
  const remembered = () => rememberedScreenOf(preferences.preferences().outputScreen);
  // The window the Operator opened, and the screen it is really on (polled:
  // the operator may drag it), which a vanished or returning screen is
  // measured against.
  let outputWin: Window | null = null;
  const [placedOn, setPlacedOn] = createSignal<ScreenKey>();
  // Whether the Output has said it is verifiably on the chosen screen, and
  // which screen that is. A window position proves nothing on Wayland, so
  // only the Output's own word counts (ADR-0028).
  const [verified, setVerified] = createSignal(false);
  const [placeLabel, setPlaceLabel] = createSignal<string>();
  // The Output has said the system cannot place windows: the hint is then to move it.
  const [placementRefused, setPlacementRefused] = createSignal(placementWasRefused());
  let outputReports = false;
  onMount(() =>
    onCleanup(
      subscribePlacement((report) => {
        outputReports = true;
        setVerified(report.onTarget);
        if (report.refused) {
          setPlacementRefused(true);
          rememberPlacementRefused();
        }
        const shown = screenNotice();
        if (report.unconfirmed) {
          if (shown === "activate" || shown === "move") setScreenNotice("unconfirmed");
        } else if (report.onTarget) {
          if (shown === "activate" || shown === "move") setScreenNotice("fullscreen");
        } else if (report.refused) setScreenNotice("move");
      }),
    ),
  );
  const [screenNotice, setScreenNotice] = createSignal<ScreenNoticeId>();
  // A screen the Output was on has gone; offered back when it returns.
  const [goneFrom, setGoneFrom] = createSignal<ScreenKey>();
  // Hints put themselves away, so one never holds back the update notice.
  const HINT_MS = 8000;
  createEffect(() => {
    const shown = screenNotice();
    // Nothing is on screen while presenting here, so nothing is timed.
    if (presentingHere()) return;
    if (
      shown !== "drag" &&
      shown !== "fullscreen" &&
      shown !== "activate" &&
      shown !== "unconfirmed" &&
      shown !== "blocked" &&
      shown !== "stuck"
    )
      return;
    const timer = setTimeout(() => setScreenNotice(undefined), HINT_MS);
    onCleanup(() => clearTimeout(timer));
  });
  // Closing the Output ends all of it (not merely not being open yet).
  createEffect(
    on(presentingOutput, (open, was) => {
      if (open || !was) return;
      setPlacedOn(undefined);
      setGoneFrom(undefined);
      setOffered(undefined);
      setVerified(false);
      setPlaceLabel(undefined);
      outputReports = false;
      outputWin = null;
      setScreenNotice(undefined);
    }),
  );
  // A word from the Library (books left unloaded), put away by itself or by Got It.
  const [libraryNote, setLibraryNote] = createSignal<string>();
  createEffect(() => {
    if (!libraryNote() || presentingHere()) return;
    const timer = setTimeout(() => setLibraryNote(undefined), HINT_MS);
    onCleanup(() => clearTimeout(timer));
  });
  // Each hint is shown once, ever: marked when it first appears.
  const showHintOnce = (id: "drag") => {
    const prefs = preferences.preferences();
    if (!preferences.loaded() || prefs.dragHintDismissed) return;
    preferences.update({ ...prefs, dragHintDismissed: true });
    setScreenNotice(id);
  };
  // Nothing to show with no book loaded: Go Live waits for one (any book
  // will do; no song need be chosen yet). The button, the O key and the
  // command menu all honour it.
  const canGoLive = () => readable().length > 0;
  // Opening once, then bringing it forward: an empty URL targets the named
  // window without reloading it. Opening is never blocked on the screens:
  // anything unavailable is today's plain popup, with a hint (ADR-0028).
  const openOutput = async () => {
    if (!canGoLive() || presentingHere()) return;
    if (presentingOutput()) {
      window.open("", OUTPUT_WINDOW_NAME)?.focus();
      return;
    }
    setScreenNotice(undefined);
    const outcome = await openOutputWindow({
      url: OUTPUT_URL,
      name: OUTPUT_WINDOW_NAME,
      screens,
      remembered: remembered(),
    });
    outputWin = outcome.win;
    if (!outcome.win) setScreenNotice("blocked");
    else if (outcome.kind === "placed") {
      setPlacedOn(keyOf(outcome.screen));
      setPlaceLabel(describeScreen(outcome.screen));
      setVerified(false);
      // Unless the Output has verified that it is there, say what to do. The
      // Operator cannot know: on Wayland the window may sit on this screen.
      const win = outcome.win;
      setTimeout(() => {
        // Closed in the meantime (the close effect above forgets the window):
        // a hint about a gone window would also hold back the update notice
        // for its whole stay.
        if (outputWin !== win) return;
        if (!verified() && screenNotice() !== "move" && screenNotice() !== "unconfirmed")
          setScreenNotice(placementRefused() ? "move" : "activate");
      }, FULLSCREEN_GRACE_MS);
    } else if (mayHaveSecondScreen()) showHintOnce("drag");
    else if (outcome.kind === "plain" && outcome.reason === "single" && !extendHintShown) {
      // One screen, with the API: a projector may be attached as a mirror
      // (the browser sees one screen), which only the OS can change.
      extendHintShown = true;
      setScreenNotice("extend");
    }
  };
  let extendHintShown = false;
  // The displays change under an open Output (ADR-0028): it stays where it is.
  // A burst of events is one change, judged once it settles; nothing is ever
  // moved while live without the person asking.
  const [offered, setOffered] = createSignal<ScreenInfo>();
  let reviewed: ScreensSnapshot = { screens: screens.screens(), extended: screens.extended() };
  const review = () => {
    const after: ScreensSnapshot = { screens: screens.screens(), extended: screens.extended() };
    const before = reviewed;
    reviewed = after;
    const result = reviewScreens({
      before,
      after,
      live: presentingOutput(),
      placed: placedOn(),
      goneFrom: goneFrom(),
      current: screens.current(),
    });
    if (result.kind === "disconnected") {
      if (result.gone) {
        setGoneFrom(keyOf(result.gone));
        setPlacedOn(undefined);
      }
      setPlaceLabel(result.remaining ? describeScreen(result.remaining) : undefined);
      setScreenNotice("disconnected");
    } else if (result.kind === "back") setScreenNotice("back");
    else if (result.kind === "connected") {
      setOffered(result.screen);
      setPlaceLabel(result.screen ? describeScreen(result.screen) : undefined);
      setScreenNotice("connected");
    }
  };
  let reviewTimer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      [screens.screens, screens.extended],
      () => {
        // The screens becoming known (Detect Screens, a permission granted
        // before) is a baseline, not a change.
        if (reviewed.screens.length === 0 && screens.screens().length > 0)
          reviewed = { screens: screens.screens(), extended: screens.extended() };
        clearTimeout(reviewTimer);
        reviewTimer = setTimeout(review, SCREENS_SETTLE_MS);
      },
      { defer: true },
    ),
  );
  onCleanup(() => clearTimeout(reviewTimer));
  // Where the Output really is, from its own position: dragged to another
  // screen, that is where it is "placed" now.
  onMount(() => {
    const timer = setInterval(() => {
      const win = outputWin;
      const known = screens.screens();
      // Its own report is better than a window position, which is 0 on Wayland.
      if (outputReports) return;
      if (!win || win.closed || !presentingOutput() || known.length === 0) return;
      const at = screenAt(
        known,
        win.screenX + win.outerWidth / 2,
        win.screenY + win.outerHeight / 2,
      );
      if (at && !(placedOn() && sameKey(at, placedOn() as ScreenKey))) setPlacedOn(keyOf(at));
    }, TRACK_MS);
    onCleanup(() => clearInterval(timer));
  });
  const moveTo = async (screen: ScreenInfo) => {
    if (await moveOutputTo(screen, OUTPUT_WINDOW_NAME, outputWin)) setPlacedOn(keyOf(screen));
    else setScreenNotice("stuck");
  };
  const moveBack = () => {
    const gone = goneFrom();
    const screen = screens.screens().find((candidate) => gone && sameKey(candidate, gone));
    setGoneFrom(undefined);
    setScreenNotice(undefined);
    if (screen) void moveTo(screen);
  };
  // The offer to move to a projector that has just appeared: only on the
  // person's word. Where the system refuses to place windows (Wayland), the
  // move is theirs, so the notice says how.
  const moveToConnected = () => {
    const screen = offered();
    setOffered(undefined);
    if (screen && !placementRefused()) {
      setScreenNotice(undefined);
      void moveTo(screen);
    } else setScreenNotice("move");
  };
  // Choosing a screen in Settings moves an open Output there. A memo, so it
  // answers a change of the choice only: `on` alone re-runs on every
  // preference change, and moving the window leaves its fullscreen.
  const rememberedKey = createMemo(() => JSON.stringify(remembered() ?? null));
  createEffect(
    on(
      rememberedKey,
      () => {
        if (!presentingOutput()) return;
        const choice = chooseScreen({
          screens: screens.screens(),
          current: screens.current(),
          remembered: remembered(),
        });
        if (!choice.screen) return;
        setGoneFrom(undefined);
        void moveTo(choice.screen);
      },
      { defer: true },
    ),
  );

  // Notices (DESIGN.md § Snackbar): a waiting app update, and once the
  // Safari Home Screen note — one at a time, none while the Output is live.
  // Until an Output has had time to answer, presence counts as live.
  const appUpdates = props.appUpdates;
  const [updateDismissed, setUpdateDismissed] = createSignal(false);
  const homeScreen = homeScreenHintHere();
  const notice = () =>
    pickNotice({
      update: { ready: appUpdates.ready(), live: presence.live() },
      safariHint:
        !!homeScreen &&
        !!hymnbook() &&
        preferences.loaded() &&
        !preferences.preferences().homeScreenHintDismissed,
      updateDismissed: updateDismissed(),
      screen: screenNotice(),
      keepFile: keepFile(),
    });
  const restartApp = () =>
    restartIfAllowed({ ready: appUpdates.ready(), live: presence.live() }, appUpdates.restart);
  const dismissHomeScreenHint = () =>
    preferences.update({ ...preferences.preferences(), homeScreenHintDismissed: true });
  const dismissNotice = () => {
    const shown = notice();
    if (shown === "update") setUpdateDismissed(true);
    else if (shown === "keep-file") setKeepFile(false);
    else if (shown === "safari-hint") dismissHomeScreenHint();
    else if (isScreenNotice(shown)) {
      if (shown === "back") setGoneFrom(undefined);
      setScreenNotice(undefined);
    }
  };
  const noticeMessage = () => {
    const shown = notice();
    if (shown === "update") return "Update ready";
    if (isScreenNotice(shown)) return screenNoticeText(shown, placeLabel());
    if (shown === "keep-file")
      return "Your browser may clear stored books if space runs low. Keep the book file, so you can load it again.";
    if (shown === "safari-hint")
      return `Safari clears saved books after 7 days unused. Add Hymnal to your ${
        homeScreen === "home-screen" ? "Home Screen" : "Dock"
      } to keep them.`;
    return "";
  };
  // The one notice on screen: a screen notice (about the Output, shown even
  // live) wins; the rest are the picked one (DESIGN.md § Snackbar).
  const snackbar = (): SnackbarProps | undefined => {
    // The audience sees this tab: notices queue until it is left (§16.7).
    if (presentingHere()) return undefined;
    const shown = screenNotice();
    if (shown === "connected")
      return {
        message: screenNoticeText(shown, placeLabel()),
        action: "Move the Output There",
        onAction: moveToConnected,
        dismissLabel: "Not now",
        onDismiss: () => setScreenNotice(undefined),
      };
    if (shown === "disconnected")
      return {
        message: screenNoticeText(shown, placeLabel()),
        action: "Blank",
        onAction: () => {
          if (!blanked()) toggleBlank();
          setScreenNotice(undefined);
        },
        dismissLabel: "Dismiss",
        onDismiss: () => setScreenNotice(undefined),
      };
    if (shown)
      return {
        message: screenNoticeText(shown, placeLabel()),
        action: shown === "back" ? "Move It" : "Got It",
        onAction: shown === "back" ? moveBack : () => setScreenNotice(undefined),
        dismissLabel: shown === "back" ? "Stay" : undefined,
        onDismiss:
          shown === "back"
            ? () => {
                setGoneFrom(undefined);
                setScreenNotice(undefined);
              }
            : undefined,
      };
    const note = libraryNote();
    if (note) return { message: note, action: "Got It", onAction: () => setLibraryNote(undefined) };
    const picked = notice();
    if (picked === "update")
      return {
        message: noticeMessage(),
        action: "Restart",
        onAction: restartApp,
        dismissLabel: "Later",
        onDismiss: () => setUpdateDismissed(true),
      };
    if (picked === "keep-file")
      return { message: noticeMessage(), action: "Got It", onAction: () => setKeepFile(false) };
    if (picked === "safari-hint")
      return { message: noticeMessage(), action: "Got It", onAction: dismissHomeScreenHint };
    return undefined;
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
    setShortcuts(undefined);
  };
  const openSheet = (open: (value: boolean) => void) => {
    closeSheets();
    open(true);
  };

  const liveGlyph = () =>
    !presentingOutput()
      ? "icon-present"
      : blanked()
        ? "icon-blank"
        : held()
          ? "icon-hold"
          : "icon-sensors";
  const canPresentHere = () => canGoLive() && !presentingOutput() && !presentingHere();
  // Go Live decides for you (SDD-0001 §16.7): an external screen is known
  // when Window Management lists a second one, or the one the operator chose
  // is attached; the Output window then goes there. Otherwise this tab
  // presents. The permission prompt is not a reason to wait: a browser that
  // shows an extended desktop asks at the click, as before.
  const externalKnown = () => {
    if (!screens.supported) return false;
    if (screens.extended()) return true;
    const chosen = remembered();
    return (
      !!chosen && screens.screens().length > 1 && screens.screens().some((s) => sameKey(s, chosen))
    );
  };
  // The setting (Settings → Presentation, SDD-0001 §16.7) can fix the answer:
  // this screen, or the window even with one screen.
  const goLiveTarget = (): "window" | "here" => {
    const chosen = goLiveOf(preferences.preferences());
    if (chosen === "auto") return externalKnown() ? "window" : "here";
    return chosen === "window" ? "window" : "here";
  };
  const goLive = () => {
    if (!canGoLive() || presentingOutput() || presentingHere()) return;
    if (goLiveTarget() === "window") void openOutput();
    else presentHere();
  };
  // The click or key is the activation fullscreen needs, so the request is
  // made at once, before anything is awaited.
  const presentHere = () => {
    if (!canPresentHere()) return;
    closeSheets();
    setScreenNotice(undefined);
    presence.setHere(true);
    document.addEventListener("fullscreenchange", onHereFullscreen);
    const root = document.documentElement;
    if (root.requestFullscreen) void Promise.resolve(root.requestFullscreen()).catch(() => {});
    void keyboardLock()
      ?.lock?.(["Escape"])
      ?.catch?.(() => {});
  };

  // "Present on This Screen" from the live menu: the window ends first (it
  // would take the audience back), and this tab presents once its bye lands.
  const [switchingHere, setSwitchingHere] = createSignal(false);
  const switchToHere = () => {
    if (!presentingOutput()) return presentHere();
    setSwitchingHere(true);
    setTimeout(() => setSwitchingHere(false), 3000);
    endLive();
  };
  createEffect(() => {
    if (!switchingHere() || presentingOutput()) return;
    setSwitchingHere(false);
    presentHere();
  });

  const go = (next: Section) => {
    setSection(next);
    setMenuOpen(false);
  };

  // Hot-swap (SDD-0001 §16.4): choosing a hymn from anywhere loads it in the
  // Presenter already on screen. Nothing is reopened or repositioned.
  // The number and its book change together, or the Presenter would fetch the old
  // book's song under the new number and record it as a recent. A pick from the
  // Presenter's own lists is of the song's book, whatever the scope is.
  const chooseHymn = (number: HymnNumber, book: HymnbookId | undefined = currentKey()) =>
    batch(() => {
      setHymnNumber(number);
      setPresentedKey(book);
      setHymnPickerOpen(false);
      setSection("present");
    });

  // "Find a song", from anywhere: Present, plus the picker over the current
  // hymn if one is up. With none, Present already is the Finder, and a
  // picker on top would only duplicate it.
  const findHymn = () => {
    setSection("present");
    setMenuOpen(false);
    if (hymnNumber()) setHymnPickerOpen(true);
  };

  const installed = readable;
  // Choosing a book, from the header or the Library, aims the Finder at it and
  // opens the Finder (§16.4). The song up, the crumb and the Output stay as they
  // are until a song is picked, so the audience never sees an empty screen
  // mid-swap.
  const chooseHymnbook = (id: HymnbookId) => {
    setBookPickerOpen(false);
    if (id !== currentKey()) setCurrentKey(id);
    findHymn();
  };
  // The scope is the song's book unless a book was just chosen to search: a Finder
  // opened by the crumb, the keys or the search box starts there, and one closed
  // without a pick (by Escape, by another sheet opening, by leaving the section)
  // puts it back, in this one place.
  const scopeToSong = () => {
    const song = presentedKey();
    if (song !== undefined && song !== currentKey() && hymnNumber()) setCurrentKey(song);
  };
  createEffect(
    on(
      () => hymnPickerOpen() || commandMenuOpen(),
      (open, was) => {
        if (!open && was) scopeToSong();
      },
    ),
  );
  const openHymnPicker = () => {
    scopeToSong();
    setHymnPickerOpen(true);
  };
  const openCommandMenu = () => {
    scopeToSong();
    openSheet(setCommandMenuOpen);
  };

  const showShortcuts = (from?: "settings" | "menu") => {
    // From the row, or with Settings or the Menu already open: push the page.
    const host = from ?? (menuOpen() ? "menu" : settingsOpen() ? "settings" : undefined);
    if (host) return setShortcuts({ host, direct: false });
    batch(() => {
      openSheet(setSettingsOpen);
      setShortcuts({ host: "settings", direct: true });
    });
  };
  const shortcutsPage = (host: "settings" | "menu"): SheetPage | undefined => {
    const open = shortcuts();
    if (open?.host !== host) return undefined;
    return {
      id: "shortcuts",
      title: "Keyboard Shortcuts",
      direct: open.direct,
      content: () => (
        <table class="shortcut-table">
          <tbody>
            <For each={SHORTCUTS}>
              {(shortcut) => (
                <tr>
                  <th scope="row" class="shortcut-keys">
                    <For each={shortcut.keys}>{(key) => <KeyCombo keys={key} />}</For>
                  </th>
                  <td class="body-large">{shortcut.label}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      ),
    };
  };

  // The command menu's actions (SDD-0001 §16.5), each with its key.
  const commands = (): Command[] => {
    const prefs = preferences.preferences();
    const cues = outputCuesOf(prefs);
    const run = (action: () => void) => () => {
      setCommandMenuOpen(false);
      action();
    };
    const shownNotice = notice();
    return [
      ...(shownNotice === "update"
        ? [{ label: "Restart to update", run: run(restartApp) }]
        : shownNotice === "keep-file"
          ? [{ label: "Dismiss the storage note", run: run(() => setKeepFile(false)) }]
          : shownNotice === "safari-hint"
            ? [{ label: "Dismiss the Home Screen note", run: run(dismissHomeScreenHint) }]
            : []),
      {
        label: blanked() ? "Restore the Output" : "Blank the Output",
        hint: keyHint("blank"),
        run: run(toggleBlank),
      },
      ...(held() || presentingOutput()
        ? [
            {
              label: held() ? "Release the Output" : "Hold the Output",
              hint: keyHint("hold"),
              run: run(toggleHold),
            },
          ]
        : []),
      ...(!canGoLive()
        ? []
        : [
            {
              label: presentingOutput() ? "Bring the Output forward" : "Open the Output window",
              hint: keyHint("output"),
              run: run(openOutput),
            },
          ]),
      ...(presentingOutput()
        ? [{ label: "End Live", hint: keyHint("end-live"), run: run(endLive) }]
        : []),
      ...(canPresentHere()
        ? [
            {
              label: "Present on this screen",
              hint: keyHint("present-here"),
              run: run(presentHere),
            },
          ]
        : []),
      ...(presenting() && presenterActions()
        ? [
            {
              label: "Repeat this part",
              hint: keyHint("repeat"),
              run: run(() => presenterActions()?.repeat()),
            },
            ...(presenterActions()?.canUndoRepeat()
              ? [
                  {
                    label: "Undo repeat",
                    hint: keyHint("undo-repeat"),
                    run: run(() => presenterActions()?.undoRepeat()),
                  },
                ]
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
        hint: pane.shortcut && keyHint(pane.shortcut),
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
        ? [{ label: "Show the details now", run: run(showCues) }]
        : []),
      {
        label:
          bandSizeOf(prefs) === "line"
            ? "Make the Output's reading band a part"
            : "Make the Output's reading band a line",
        run: run(() =>
          preferences.update({
            ...prefs,
            bandSize: bandSizeOf(prefs) === "line" ? "part" : "line",
          }),
        ),
      },
      {
        label:
          highlightOf(prefs) === "song"
            ? "Light only the current part on the Output"
            : "Light the whole song on the Output",
        hint: keyHint("highlight"),
        run: run(toggleHighlight),
      },
      {
        label: wholeSongOf(prefs)
          ? "Scroll the song on the Output"
          : "Show the whole song on the Output",
        run: run(() => preferences.update({ ...prefs, wholeSong: !wholeSongOf(prefs) })),
      },
      {
        label: cues.fade ? "Keep the details on the Output" : "Fade the details on the Output",
        run: run(() => preferences.setCue("fade", !cues.fade)),
      },
      { label: "Switch hymnbook", run: run(() => openSheet(setBookPickerOpen)) },
      { label: "Library", run: run(() => go("library")) },
      { label: "Settings", hint: keyHint("settings"), run: run(() => openSheet(setSettingsOpen)) },
      ...(canAdjustScale(prefs, 1)
        ? [
            {
              label: "Text size up",
              hint: keyHint("text-size"),
              run: run(() => preferences.adjustScale(1)),
            },
          ]
        : []),
      ...(canAdjustScale(prefs, -1)
        ? [
            {
              label: "Text size down",
              hint: keyHint("text-size", 1),
              run: run(() => preferences.adjustScale(-1)),
            },
          ]
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
        else if (hymnbook()) openCommandMenu();
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
    // Escape puts a notice away (Later; the Safari note's Got It).
    if (event.key === "Escape" && notice()) {
      event.preventDefault();
      dismissNotice();
      return;
    }
    // Shift+P, Present on this screen: a chord, so a stray key cannot take over this one.
    if (event.key === "P" && event.shiftKey) {
      event.preventDefault();
      presentHere();
      return;
    }
    // Shift+E, a chord so a stray key cannot end the show.
    if (event.key === "E" && event.shiftKey) {
      event.preventDefault();
      endLive();
      return;
    }
    // Shift+H holds the Output; plain H is the highlight.
    if (event.key === "H" && event.shiftKey) {
      event.preventDefault();
      toggleHold();
      return;
    }
    const action = (
      {
        b: toggleBlank,
        ".": toggleBlank,
        o: openOutput,
        l: () => togglePane("live"),
        h: toggleHighlight,
        "/": () => hymnbook() && openCommandMenu(),
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
    const unsubscribe = subscribeKeys(({ key, shiftKey, repeat }) =>
      replayForwardedKey(key, shiftKey, repeat),
    );
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
    <>
      <div class="shell" inert={presentingHere()}>
        <Show when={expanded()}>
          <nav
            class="nav-rail"
            aria-label="Sections"
            ref={(el) =>
              onCleanup(
                glideList(el, {
                  rows: ".rail-item:enabled",
                  current: '.rail-item[aria-current="page"]',
                }).stop,
              )
            }
          >
            <For each={SECTIONS}>{(item) => sectionButton(item, "rail")}</For>
            <div class="rail-foot">
              <button
                type="button"
                class="rail-item"
                aria-haspopup="dialog"
                aria-keyshortcuts={ariaKeys("settings")}
                title={withKey("Settings", "settings", expanded())}
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
                ref={(el) => onCleanup(hoverButton(el))}
                aria-haspopup="dialog"
                onClick={() => setMenuOpen(true)}
              >
                <span class="icon icon-menu" aria-hidden="true" />
                <span class="visually-hidden">Menu</span>
              </button>
            </Show>
            <nav
              class="crumbs"
              aria-label="Hymnbook and song"
              ref={(el) => onCleanup(hoverGroup(el, ".crumb:enabled", { gap: 150 }))}
            >
              <Show when={crumbBook()} fallback={<span class="crumb-static">Hymnal</span>}>
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
                      onClick={openHymnPicker}
                    >
                      <span class="crumb-number">#{current().number}</span>
                      <span class="crumb-text">{titleCase(current().title)}</span>
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
                ref={(el) => onCleanup(hoverButton(el))}
                aria-haspopup="dialog"
                aria-keyshortcuts={ariaKeys("command-menu", 1)}
                onClick={openCommandMenu}
              >
                <span class="icon icon-search" aria-hidden="true" />
                <span class="switcher-find-text">Find a song or action</span>
                <KeyCombo class="switcher-find-key" keys={keyHint("command-menu", 1)} decorative />
              </button>
            </Show>
            {/* Go live (PRINCIPLES.md: emphasis follows the task): a one-off
              action, so it becomes a status once the Output is open — On
              air — and then brings that window forward. Top right on every
              screen, where Slides and Keynote put theirs. Blanked is the
              Output's other status, so it shows here too — on every
              screen, whether Live is on screen or not (SDD-0001 §16.5);
              B, Live's Restore or the command menu restore it. */}
            <div
              class="live-controls"
              ref={(el) => onCleanup(hoverGroup(el, ".present-button:enabled"))}
            >
              {/* One button, one width (DESIGN.md § Go Live): the label swaps
                in place, so nothing beside it ever moves. Not live, one click
                decides (an external screen known: the Output window; else
                this tab, SDD-0001 §16.7). Live, it brings the Output
                forward; End Live and Present Here are Live's toolbar's. */}
              <button
                type="button"
                class="present-button"
                classList={{
                  presenting: presentingOutput(),
                  "present-blanked": presentingOutput() && blanked(),
                  "present-held": presentingOutput() && !blanked() && !!held(),
                }}
                aria-keyshortcuts={ariaKeys("output")}
                disabled={!canGoLive()}
                aria-description={!canGoLive() ? "Load a songbook first" : undefined}
                title={
                  !canGoLive()
                    ? "Load a songbook first"
                    : !presentingOutput()
                      ? goLiveTarget() === "window"
                        ? withKey("Go Live: open the Output window", "output", expanded())
                        : withKey("Go Live: present on this screen", "present-here", expanded())
                      : blanked()
                        ? `The Output is blanked${expanded() ? `; ${keyHint("blank")} restores it` : ""}. ${withKey("Bring it forward", "output", expanded())}`
                        : held()
                          ? `The Output is held${expanded() ? `; ${keyHint("hold")} releases it` : ""}. ${withKey("Bring it forward", "output", expanded())}`
                          : withKey("Bring the Output forward", "output", expanded())
                }
                onClick={() => (presentingOutput() ? void openOutput() : goLive())}
              >
                {/* The state's glyph, turning over as it changes: Go Live's
                  screen, then broadcasting, a slashed circle (blanked) or pause in a circle
                  (held) in the live colour (DESIGN.md § Go Live). */}
                <Show when={liveGlyph()} keyed>
                  {(glyph) => (
                    <span class={`icon live-glyph ${glyph} icon-swap`} aria-hidden="true" />
                  )}
                </Show>
                <SwapLabel
                  labels={["Go Live", "On Air", "Blanked", "Held"]}
                  current={
                    !presentingOutput()
                      ? "Go Live"
                      : blanked()
                        ? "Blanked"
                        : held()
                          ? "Held"
                          : "On Air"
                  }
                />
              </button>
            </div>
          </header>

          <main
            class="workspace"
            classList={{ "workspace-full": section() === "present" && !!hymnNumber() }}
          >
            <Switch>
              <Match when={section() === "library"}>
                <Library
                  books={books}
                  currentKey={currentKey()}
                  presentedKey={presentedKey()}
                  outputLive={presence.live()}
                  onEndLive={endLive}
                  onChoose={setCurrentKey}
                  onOpen={chooseHymnbook}
                  onStorageRefused={() => setKeepFile(true)}
                  onNotice={setLibraryNote}
                />
              </Match>
              <Match when={section() === "present" && !hymnNumber()}>
                {hymnbook() && (
                  <Finder
                    hymnbookId={currentKey() as string}
                    bookTitle={hymnbook()?.title}
                    onSelect={chooseHymn}
                  />
                )}
              </Match>
              <Match when={section() === "present" && hymnNumber() && presentedKey()}>
                <Presenter
                  hymnNumber={hymnNumber() as HymnNumber}
                  hymnbookId={presentedKey() as string}
                  onLoaded={setHymn}
                  onBack={openHymnPicker}
                  blanked={blanked()}
                  onToggleBlank={toggleBlank}
                  held={held()}
                  onToggleHold={toggleHold}
                  onEndLive={endLive}
                  onPresentHere={switchToHere}
                  outputWindow={presentingOutput()}
                  presenting={presentingOutput() || presentingHere()}
                  panes={preferences.preferences().panes}
                  workspace={preferences.preferences().workspace}
                  onWorkspaceChange={(workspace) =>
                    preferences.update({ ...preferences.preferences(), workspace })
                  }
                  onSelectHymn={(number) => chooseHymn(number, presentedKey())}
                  scrollSync={preferences.preferences().scrollSync ?? true}
                  onActions={(actions) => setPresenterActions(() => actions)}
                  hymnbookTitle={presentedBook()?.title}
                  cues={outputCuesOf(preferences.preferences())}
                  revealCues={cuesRevealed()}
                  pinChorus={pinChorusOf(preferences.preferences())}
                  wholeSong={wholeSongOf(preferences.preferences())}
                  liveLandscape={outputLandscape()}
                  highlight={highlightOf(preferences.preferences())}
                />
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
          <Show when={hymnbook()}>
            <Finder
              hymnbookId={currentKey() as string}
              bookTitle={hymnbook()?.title}
              current={hymnNumber()}
              onSelect={chooseHymn}
            />
          </Show>
        </Sheet>

        <Sheet
          open={commandMenuOpen()}
          onClose={() => setCommandMenuOpen(false)}
          title="Search"
          placement={expanded() ? "center" : "bottom"}
        >
          <Finder
            hymnbookId={currentKey() as string}
            bookTitle={hymnbook()?.title}
            current={hymnNumber()}
            onSelect={(number) => {
              // Closing it and choosing are one step: the scope must not be put back first.
              batch(() => {
                setCommandMenuOpen(false);
                chooseHymn(number);
              });
            }}
            commands={commands().map((command) => ({
              ...command,
              label: titleCase(command.label),
            }))}
          />
        </Sheet>

        <Sheet
          open={bookPickerOpen()}
          onClose={() => setBookPickerOpen(false)}
          title="Hymnbooks"
          placement={expanded() ? "center" : "bottom"}
        >
          <ul
            class="list glide-list"
            ref={(el) =>
              onCleanup(
                glideList(el, {
                  rows: ".list-row:enabled",
                  current: '.list-row[aria-current="true"]',
                }).stop,
              )
            }
          >
            <For each={installed()}>
              {(book) => (
                <li>
                  <button
                    type="button"
                    class="list-row"
                    aria-current={book.key === currentKey() ? "true" : undefined}
                    onClick={() => chooseHymnbook(book.key)}
                  >
                    <span class="finder-text">
                      <span class="finder-title">{book.title}</span>
                      <span class="list-row-supporting finder-count">
                        — {book.songs.toLocaleString("en-US")} songs
                      </span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Sheet>

        {/* A persistent live region, filled when a notice appears: a region
          inserted already full is not reliably announced. */}
        <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
          {presentingHere()
            ? ""
            : !screenNotice() && libraryNote()
              ? libraryNote()
              : noticeMessage()}
        </div>
        <SnackbarHost notice={snackbar()} />

        <Sheet
          open={menuOpen()}
          onClose={() => setMenuOpen(false)}
          title="Menu"
          page={shortcutsPage("menu")}
          onBack={() => setShortcuts(undefined)}
        >
          <nav aria-label="Sections">
            <ul
              class="list glide-list"
              ref={(el) =>
                onCleanup(
                  glideList(el, {
                    rows: ".list-row:enabled",
                    current: '.list-row[aria-current="page"]',
                  }).stop,
                )
              }
            >
              <For each={SECTIONS}>{(item) => <li>{sectionButton(item, "menu")}</li>}</For>
            </ul>
          </nav>
          <Settings
            controller={preferences}
            screens={screens}
            onShowShortcuts={() => showShortcuts("menu")}
          />
        </Sheet>

        <Sheet
          open={settingsOpen()}
          onClose={() => setSettingsOpen(false)}
          title="Settings"
          placement={expanded() ? "center" : "bottom"}
          page={shortcutsPage("settings")}
          onBack={() => setShortcuts(undefined)}
        >
          <Settings
            controller={preferences}
            screens={screens}
            onShowShortcuts={() => showShortcuts("settings")}
          />
        </Sheet>
      </div>
      <Show when={presentingHere()}>
        <PresentHere
          message={hereMessage() ?? { type: "idle" }}
          blanked={blanked()}
          theme={preferences.preferences().outputTheme ?? DEFAULT_OUTPUT_THEME}
          cues={outputCuesOf(preferences.preferences())}
          reveal={cuesRevealed()}
          pinChorus={pinChorusOf(preferences.preferences())}
          wholeSong={wholeSongOf(preferences.preferences())}
          highlight={highlightOf(preferences.preferences())}
          bandSize={bandSizeOf(preferences.preferences())}
          hymnbookId={(presentedKey() ?? currentKey()) as string}
          onSelect={(number) => chooseHymn(number, presentedKey() ?? currentKey())}
          onLeave={leavePresentingHere}
          startWithSwitcher={!hymnNumber()}
        />
      </Show>
    </>
  );
}

export default App;
