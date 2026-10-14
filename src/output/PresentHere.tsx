import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { HymnbookId, HymnNumber } from "../domain/types.ts";
import { Finder } from "../finder/Finder.tsx";
import type { BandSize, Highlight, OutputCues, OutputTheme } from "../persistence/user-state.ts";
import { isPresentationKey, isTyping, replayForwardedKey } from "../shell/keymap.ts";
import type { OutputMessage } from "./channel.ts";
import { createIdleCursor } from "./idleCursor.ts";
import { OutputBoundary } from "./OutputBoundary.tsx";
import { OutputView } from "./OutputView.tsx";

/** What the audience screen is told, as the Operator's Presentation settings. */
export interface PresentHereProps {
  /** What the Output would show: the Presenter's own message, never a copy of its state. */
  message: Extract<OutputMessage, { type: "content" | "idle" }>;
  blanked: boolean;
  theme: OutputTheme;
  cues: OutputCues;
  reveal: number;
  pinChorus: boolean;
  wholeSong: boolean;
  highlight: Highlight;
  bandSize: BandSize;
  /** The book the quick switcher searches: the song's own. */
  hymnbookId: HymnbookId;
  /** The books held: with several, the switcher groups its matches by book. */
  bookCount?: number;
  /** Shows a song at once, in its book. */
  onSelect: (number: HymnNumber, book: HymnbookId) => void;
  /** Esc (with no switcher open) or F. */
  onLeave: () => void;
  /** The view threw and went blank (SDD-0001 §16.9). */
  onFailed: () => void;
  /** The switcher opens at once, e.g. with nothing yet to show. */
  startWithSwitcher?: boolean;
}

/** How far the backdrop's solid zone rises above the strip, in px (0.75rem). */
const BAND_RISE = 12;

/** How long the touch bar stays after the last touch (ms). */
export const BAR_HIDE_MS = 3000;
/** A tap lifts within this long (ms) and this far (px) of where it began. */
const TAP_MS = 600;
const TAP_SLOP = 10;
/** A swipe goes this far (px) across, and at least twice as far as down. */
const SWIPE_PX = 48;
const SWIPE_RATIO = 2;

/**
 * One-screen presenting (Board #41, SDD-0001 §16.7): the Output's own view,
 * full-bleed over the app, in the tab itself, as Slides' Slideshow does. It
 * renders the message the Presenter publishes and the Operator's Presentation
 * settings; the Operator stays the one source of truth, and the keys that
 * step the song are the ones the shell and the Presenter already handle. This
 * component owns only what the Output window forwards or leaves to the
 * browser: leaving, and the quick switcher (Ctrl+K or /): the search field at the
 * bottom centre, on a soft blur, so the audience sees as little of it as
 * possible. By touch (Board #72) a tap shows a quiet bar (Search, Previous,
 * Next, Leave) and a horizontal swipe steps.
 */
export function PresentHere(props: PresentHereProps) {
  // The Output window's cursor: there while the mouse moves, gone once still.
  const cursorVisible = createIdleCursor();
  const [switcher, setSwitcher] = createSignal<{ query: string } | undefined>(
    props.startWithSwitcher ? { query: "" } : undefined,
  );
  const openSwitcher = (query = "") => setSwitcher({ query });
  const closeSwitcher = () => setSwitcher(undefined);

  // By touch: a tap shows the bar for a few seconds; a swipe steps. Steps
  // are the keys' own, replayed through the keymap. The mouse has keys.
  const [bar, setBar] = createSignal(false);
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const hideBar = () => {
    clearTimeout(hideTimer);
    setBar(false);
  };
  const showBar = () => {
    clearTimeout(hideTimer);
    setBar(true);
    hideTimer = setTimeout(hideBar, BAR_HIDE_MS);
  };
  onCleanup(() => clearTimeout(hideTimer));
  createEffect(() => {
    if (switcher()) hideBar();
  });
  const step = (key: "ArrowLeft" | "ArrowRight") => {
    replayForwardedKey(key, false);
    if (bar()) showBar();
  };

  let press: { id: number; x: number; y: number; at: number } | undefined;
  const target = (event: Event) => (event.target instanceof Element ? event.target : null);
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    const el = target(event);
    if (el?.closest(".present-bar")) {
      press = undefined;
      if (bar()) showBar();
      return;
    }
    // A second finger is a pinch, not a tap; the switcher takes its own.
    press =
      event.isPrimary && !el?.closest(".present-switcher")
        ? { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp }
        : undefined;
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = press;
    press = undefined;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const tap = Math.hypot(dx, dy) <= TAP_SLOP && event.timeStamp - start.at <= TAP_MS;
    if (switcher()) {
      if (tap) closeSwitcher();
    } else if (tap) {
      if (bar()) hideBar();
      else showBar();
    } else if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) >= Math.abs(dy) * SWIPE_RATIO) {
      step(dx < 0 ? "ArrowRight" : "ArrowLeft");
    }
  };
  const onPointerCancel = () => {
    press = undefined;
  };

  // Capture phase, ahead of the shell's and the Presenter's own keys: what is
  // swallowed here is never theirs while presenting. The Operator's other
  // keys (steps, B, H, R...) pass through untouched.
  const onKeyDown = (event: KeyboardEvent) => {
    const chord = event.ctrlKey || event.metaKey;
    const swallow = () => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    if (chord && !event.altKey && event.key.toLowerCase() === "k") {
      swallow();
      if (switcher()) closeSwitcher();
      else openSwitcher();
      return;
    }
    // Sheets would open over the audience: Settings, the shortcut sheet.
    if ((chord && event.key === ",") || (!chord && !isTyping(event) && event.key === "?")) {
      swallow();
      return;
    }
    if (event.key === "Escape") {
      swallow();
      if (switcher()) closeSwitcher();
      else props.onLeave();
      return;
    }
    if (chord || event.altKey || isTyping(event)) return;
    const key = event.key.toLowerCase();
    if (key === "f") {
      swallow();
      props.onLeave();
    } else if (event.key === "/") {
      swallow();
      if (!switcher()) openSwitcher();
    } else if (key === "o" || (key === "e" && event.shiftKey) || (key === "p" && event.shiftKey)) {
      // Go Live, End Live and Present here mean nothing from here.
      swallow();
    } else if (event.key.length === 1 && !isPresentationKey(event.key, event.shiftKey)) {
      // The Operator's own keys (N, L, text size...) would change the screen
      // under the audience's view; only the presentation's keys pass.
      swallow();
    }
  };
  onMount(() => window.addEventListener("keydown", onKeyDown, true));
  onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));

  // The backdrop's solid zone is as tall as the strip plus a little, so it
  // covers the field and every row. The strip's height moves with the rows'
  // own motion; the zone follows it frame by frame, in the same motion.
  let band: HTMLElement | undefined;
  const followHeight = (strip: HTMLElement) => {
    if (typeof ResizeObserver === "undefined") return; // jsdom: no layout to follow
    const observer = new ResizeObserver(() => {
      if (!band) return;
      band.style.setProperty("--band-height", `${strip.offsetHeight + BAND_RISE}px`);
    });
    observer.observe(strip);
    onCleanup(() => observer.disconnect());
  };

  return (
    <section
      class="present-here"
      aria-label="Presenting on this screen"
      data-output-theme={props.theme}
      classList={{ "output-cursor": cursorVisible(), "present-here-switching": !!switcher() }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <OutputBoundary onFailed={props.onFailed} fallback={null}>
        <Show when={props.message.type === "content" && props.message}>
          {(message) => (
            <OutputView
              message={message() as Extract<OutputMessage, { type: "content" }>}
              variant="full"
              blanked={props.blanked}
              cues={props.cues}
              reveal={props.reveal}
              pinChorus={props.pinChorus}
              wholeSong={props.wholeSong}
              highlight={props.highlight}
              bandSize={props.bandSize}
              classList={{ "output-cursor": cursorVisible() }}
            />
          )}
        </Show>
      </OutputBoundary>
      <div
        class="present-bar"
        role="toolbar"
        aria-label="Presenting controls"
        data-shown={bar() ? "" : undefined}
        aria-hidden={bar() ? undefined : "true"}
        inert={!bar()}
        // Keep the keys on the view: a focused button would take Space twice.
        onMouseDown={(event) => event.preventDefault()}
      >
        <span class="present-bar-scrim" aria-hidden="true" />
        <button
          type="button"
          class="present-bar-button"
          aria-label="Search"
          title="Search for a song"
          onClick={() => {
            hideBar();
            openSwitcher();
          }}
        >
          <span class="icon icon-search" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="present-bar-button"
          aria-label="Previous"
          title="Previous"
          onClick={() => step("ArrowLeft")}
        >
          <span class="icon icon-chevron-left" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="present-bar-button"
          aria-label="Next"
          title="Next"
          onClick={() => step("ArrowRight")}
        >
          <span class="icon icon-chevron-right" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="present-bar-button"
          aria-label="Leave"
          title="Leave"
          onClick={() => props.onLeave()}
        >
          <span class="icon icon-close" aria-hidden="true" />
        </button>
      </div>
      <Show when={switcher()}>
        {(open) => (
          // biome-ignore lint/a11y/useSemanticElements: <search> is not in JSX typings or jsdom yet
          <div
            class="present-switcher"
            role="search"
            aria-label="Switch song"
            ref={(el) => {
              // The box is the Finder's own; it takes the keys from here on.
              setTimeout(() => {
                const input = el.querySelector("input");
                input?.focus();
                input?.setSelectionRange(input.value.length, input.value.length);
              });
              followHeight(el);
            }}
          >
            <div class="present-switcher-band" ref={(el) => (band = el)} aria-hidden="true">
              <div class="present-switcher-fade">
                <span class="present-switcher-blur" />
                <span class="present-switcher-blur" />
                <span class="present-switcher-blur" />
                <span class="present-switcher-blur" />
              </div>
            </div>
            <Finder
              compact
              hymnbookId={props.hymnbookId}
              bookCount={props.bookCount}
              initialQuery={open().query}
              onSelect={(number, book) => {
                closeSwitcher();
                props.onSelect(number, book);
              }}
            />
          </div>
        )}
      </Show>
    </section>
  );
}
