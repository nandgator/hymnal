import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { HymnbookId, HymnNumber } from "../domain/types.ts";
import { Finder } from "../finder/Finder.tsx";
import type { BandSize, Highlight, OutputCues, OutputTheme } from "../persistence/user-state.ts";
import { isTyping } from "../shell/keymap.ts";
import type { OutputMessage } from "./channel.ts";
import { createIdleCursor } from "./idleCursor.ts";
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
  /** Shows a song at once. */
  onSelect: (number: HymnNumber) => void;
  /** Esc (with no switcher open) or F. */
  onLeave: () => void;
  /** The switcher opens at once, e.g. with nothing yet to show. */
  startWithSwitcher?: boolean;
}

/** How far the backdrop rises above the strip, in px (2rem). */
const BAND_RISE = 32;

/**
 * One-screen presenting (Board #41, SDD-0001 §16.7): the Output's own view,
 * full-bleed over the app, in the tab itself, as Slides' Slideshow does. It
 * renders the message the Presenter publishes and the Operator's Presentation
 * settings; the Operator stays the one source of truth, and the keys that
 * step the song are the ones the shell and the Presenter already handle. This
 * component owns only what the Output window forwards or leaves to the
 * browser: leaving, and the quick switcher (Ctrl+K or /): the search field at the
 * bottom centre, on a soft blur, so the audience sees as little of it as
 * possible.
 */
export function PresentHere(props: PresentHereProps) {
  // The Output window's cursor: there while the mouse moves, gone once still.
  const cursorVisible = createIdleCursor();
  const [switcher, setSwitcher] = createSignal<{ query: string } | undefined>(
    props.startWithSwitcher ? { query: "" } : undefined,
  );
  const openSwitcher = (query = "") => setSwitcher({ query });
  const closeSwitcher = () => setSwitcher(undefined);

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
    }
  };
  onMount(() => window.addEventListener("keydown", onKeyDown, true));
  onCleanup(() => window.removeEventListener("keydown", onKeyDown, true));

  // The backdrop's band is as tall as the strip plus a little: it follows the
  // list as results come and go, and animates once the first height is in.
  let band: HTMLElement | undefined;
  const followHeight = (strip: HTMLElement) => {
    if (typeof ResizeObserver === "undefined") return; // jsdom: no layout to follow
    const observer = new ResizeObserver(() => {
      if (!band) return;
      band.style.setProperty("--band-height", `${strip.offsetHeight + BAND_RISE}px`);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => band?.setAttribute("data-ready", "")),
      );
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
    >
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
              <span />
              <span />
              <span />
              <span />
            </div>
            <Finder
              compact
              hymnbookId={props.hymnbookId}
              initialQuery={open().query}
              onSelect={(number) => {
                closeSwitcher();
                props.onSelect(number);
              }}
            />
          </div>
        )}
      </Show>
    </section>
  );
}
