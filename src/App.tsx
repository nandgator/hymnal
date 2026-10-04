import {
  batch,
  createEffect,
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
  revealCues,
  setOutputBlanked,
  setOutputPresentation,
  subscribeKeys,
  subscribeOutputShape,
  subscribeOutputState,
  subscribePlacement,
} from "./output/channel.ts";
import { Output } from "./output/Output.tsx";
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
  highlightOf,
  outputCuesOf,
  pinChorusOf,
  userState,
  wholeSongOf,
} from "./persistence/user-state.ts";
import { Presenter, type PresenterActions } from "./presenter/Presenter.tsx";
import { titleCase } from "./shell/case.ts";
import { glideList } from "./shell/glideList.ts";
import { hoverButton } from "./shell/hoverGlide.ts";
import {
  ariaKeys,
  ignoresShortcuts,
  keyCaps,
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
import { Sheet } from "./shell/Sheet.tsx";
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
/** How often the Output's real screen is read while it is open. */
const TRACK_MS = 2000;

/** Notices about where the Output window is (DESIGN.md § Snackbar). */
const SCREEN_NOTICES: Record<Exclude<ScreenNoticeId, "activate">, string> = {
  drag: "Drag the Output to the projector, then press F11 for fullscreen.",
  // Said only once the Output has verified it (ADR-0028, Wayland).
  fullscreen: "The Output is on the projector screen.",
  blocked:
    "The browser blocked the Output window. Allow pop-ups for this site, then Go Live again.",
  gone: "The screen the Output was on is gone. The window stays where it is; drag it back.",
  back: "That screen is back. Move the Output to it?",
  stuck: "The Output could not move. Drag it to the screen yourself.",
};

/** The text of a screen notice; `activate` names the screen, which only the Operator knows. */
const screenNoticeText = (id: ScreenNoticeId, screenLabel: string | undefined): string =>
  id === "activate"
    ? `Click the Output window (or press F there) to put it on ${screenLabel ?? "the projector"}.`
    : SCREEN_NOTICES[id];

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
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false);
  // The sheet the shortcut sheet was opened from, if any: its Close then
  // reads Back and returns there.
  const [shortcutsReturn, setShortcutsReturn] = createSignal<(open: boolean) => void>();

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
  let outputReports = false;
  onMount(() =>
    onCleanup(
      subscribePlacement((report) => {
        outputReports = true;
        setVerified(report.onTarget);
        if (report.onTarget && screenNotice() === "activate") setScreenNotice("fullscreen");
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
    if (
      shown !== "drag" &&
      shown !== "fullscreen" &&
      shown !== "activate" &&
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
      setVerified(false);
      setPlaceLabel(undefined);
      outputReports = false;
      outputWin = null;
      setScreenNotice(undefined);
    }),
  );
  // A word from the Library (books left unloaded), put away by itself or by Got it.
  const [libraryNote, setLibraryNote] = createSignal<string>();
  createEffect(() => {
    if (!libraryNote()) return;
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
    if (!canGoLive()) return;
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
        if (!verified()) setScreenNotice("activate");
      }, FULLSCREEN_GRACE_MS);
    } else if (mayHaveSecondScreen()) showHintOnce("drag");
  };
  // The screens change under an open Output: it stays where it is. A screen it
  // was on going is a hint; its return is an offer, never a jump.
  const checkScreens = (now: readonly ScreenInfo[]) => {
    const placed = placedOn();
    if (placed && !now.some((screen) => sameKey(screen, placed))) {
      setGoneFrom(placed);
      setPlacedOn(undefined);
      setScreenNotice("gone");
      return;
    }
    const gone = goneFrom();
    if (gone && presentingOutput() && now.some((screen) => sameKey(screen, gone)))
      setScreenNotice("back");
  };
  createEffect(on(screens.screens, checkScreens));
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
  // Choosing a screen in Settings moves an open Output there.
  createEffect(
    on(
      () => JSON.stringify(remembered() ?? null),
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
    const shown = screenNotice();
    if (shown)
      return {
        message: screenNoticeText(shown, placeLabel()),
        action: shown === "back" ? "Move it" : "Got it",
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
    if (note) return { message: note, action: "Got it", onAction: () => setLibraryNote(undefined) };
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
      return { message: noticeMessage(), action: "Got it", onAction: () => setKeepFile(false) };
    if (picked === "safari-hint")
      return { message: noticeMessage(), action: "Got it", onAction: dismissHomeScreenHint };
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
      ...(!canGoLive()
        ? []
        : [
            {
              label: presentingOutput() ? "Bring the Output forward" : "Go live: open the Output",
              hint: keyHint("output"),
              run: run(openOutput),
            },
          ]),
      ...(presentingOutput()
        ? [{ label: "End Live", hint: keyHint("end-live"), run: run(endLive) }]
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
    // Escape puts a notice away (Later; the Safari note's Got it).
    if (event.key === "Escape" && notice()) {
      event.preventDefault();
      dismissNotice();
      return;
    }
    // Shift+E, a chord so a stray key cannot end the show.
    if (event.key === "E" && event.shiftKey) {
      event.preventDefault();
      endLive();
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
    <div class="shell">
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
          <nav class="crumbs" aria-label="Hymnbook and song">
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
              aria-haspopup="dialog"
              aria-keyshortcuts={ariaKeys("command-menu", 1)}
              onClick={openCommandMenu}
            >
              <span class="icon icon-search" aria-hidden="true" />
              <span class="switcher-find-text">Find a song or action</span>
              <span class="key-combo switcher-find-key" aria-hidden="true">
                <For each={keyCaps(keyHint("command-menu", 1))}>
                  {(cap) => <kbd class="key-hint">{cap}</kbd>}
                </For>
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
            aria-keyshortcuts={ariaKeys("output")}
            disabled={!canGoLive()}
            aria-description={!canGoLive() ? "Load a songbook first" : undefined}
            title={
              !canGoLive()
                ? "Load a songbook first"
                : !presentingOutput()
                  ? withKey("Open the Output", "output", expanded())
                  : blanked()
                    ? `The Output is blanked${expanded() ? `; ${keyHint("blank")} restores it` : ""}. ${withKey("Bring it forward", "output", expanded())}`
                    : withKey("Bring the Output forward", "output", expanded())
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
          {/* End Live: closes the Output window. Beside the
              status, not in it, so the status never doubles as the way out;
              an icon alone on a phone. */}
          <Show when={presentingOutput()}>
            <button
              type="button"
              class="btn-text end-live-button"
              aria-keyshortcuts={ariaKeys("end-live")}
              title={withKey("End Live: close the Output window", "end-live", expanded())}
              onClick={endLive}
            >
              <span class="icon icon-stop" aria-hidden="true" />
              <span class="end-live-label">End Live</span>
            </button>
          </Show>
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
                presenting={presentingOutput()}
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
                          <For each={keyCaps(key)}>
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
                  {book.title}
                  <span class="list-row-supporting">
                    {" "}
                    — {book.songs.toLocaleString("en-US")} songs
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
        {!screenNotice() && libraryNote() ? libraryNote() : noticeMessage()}
      </div>
      <SnackbarHost notice={snackbar()} />

      <Sheet open={menuOpen()} onClose={() => setMenuOpen(false)} title="Menu">
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
          onShowShortcuts={() => showShortcuts(setMenuOpen)}
        />
      </Sheet>

      <Sheet
        open={settingsOpen()}
        onClose={() => setSettingsOpen(false)}
        title="Settings"
        placement={expanded() ? "center" : "bottom"}
      >
        <Settings
          controller={preferences}
          screens={screens}
          onShowShortcuts={() => showShortcuts(setSettingsOpen)}
        />
      </Sheet>
    </div>
  );
}

export default App;
