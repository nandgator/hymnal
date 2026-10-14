import type { JSX } from "solid-js";
import { Match, Show, Switch } from "solid-js";
import { KeyCombo } from "./KeyCombo.tsx";

/** The empty states that have a picture. */
export type EmptyKind = "song" | "books" | "recents" | "results" | "live";

/**
 * The picture for an empty state: flat line art, one stroke weight, `currentColor` for the
 * drawing and the theme's primary for the one detail that says what is missing, so it holds
 * in light and dark. Decorative: the text beside it carries the meaning.
 */
export function EmptyIllustration(props: { kind: EmptyKind }) {
  return (
    <svg
      class="empty-illustration"
      viewBox="0 0 96 96"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <Switch>
        {/* An open book, and the note that is not yet picked. */}
        <Match when={props.kind === "song"}>
          <path d="M48 36C40 30 28 30 16 33V74C28 71 40 71 48 77C56 71 68 71 80 74V33C68 30 56 30 48 36ZM48 36V77" />
          <g class="empty-accent">
            <ellipse cx="64" cy="20" rx="4.5" ry="3.5" />
            <path d="M68.5 20V8L76 11" />
          </g>
        </Match>
        {/* Hymnals on a shelf (a cross on each spine, one leaning), and the gap where one goes. */}
        <Match when={props.kind === "books"}>
          <path d="M10 78H90" />
          <rect x="14" y="36" width="13" height="42" rx="1.5" />
          <rect x="30" y="24" width="15" height="54" rx="1.5" />
          <g transform="rotate(8 61 78)">
            <rect x="48" y="32" width="13" height="46" rx="1.5" />
            <path d="M54.5 40V48M51 43.5H58" />
          </g>
          <path d="M20.5 42V50M17 45.5H24M37.5 31V39M33.5 34.5H41.5" />
          <g class="empty-accent" stroke-dasharray="1 5">
            <rect x="71" y="38" width="14" height="40" rx="3" />
          </g>
        </Match>
        {/* A clock, nothing on it yet. */}
        <Match when={props.kind === "recents"}>
          <circle cx="48" cy="48" r="28" />
          <path d="M48 12V16M48 80V84M12 48H16M80 48H84" />
          <path class="empty-accent" d="M48 32V48L58 54" />
        </Match>
        {/* A magnifier over nothing. */}
        <Match when={props.kind === "results"}>
          <circle cx="42" cy="42" r="22" />
          <path d="M58 58L80 80" />
          <path class="empty-accent" d="M34 34L50 50M50 34L34 50" />
        </Match>
        {/* A screen with a quiet dot. */}
        <Match when={props.kind === "live"}>
          <rect x="12" y="20" width="72" height="46" rx="6" />
          <path d="M34 78H62M48 66V78" />
          <circle class="empty-accent" cx="48" cy="43" r="5" />
        </Match>
      </Switch>
    </svg>
  );
}

/** A button on an empty card. */
export interface EmptyAction {
  label: string;
  onClick: () => void;
  /** The shortcut that does the same, as keycaps after the label (for a keyboard). */
  hint?: string;
}

/**
 * An empty state as a card: the picture, one short heading, one short helpful line and,
 * where something can be done, a button (and at most one quieter one beside it). The heading
 * is a real heading (the text, not the picture, is what a reader gets).
 */
export function EmptyCard(props: {
  kind: EmptyKind;
  title: string;
  /** The helpful line. */
  children?: JSX.Element;
  action?: EmptyAction;
  /** A quieter second button, a text button. */
  secondary?: EmptyAction;
  /** The card element, e.g. to settle it in when it appears. */
  ref?: (el: HTMLDivElement) => void;
}) {
  return (
    <div class="empty-card" ref={(el) => props.ref?.(el)}>
      <EmptyIllustration kind={props.kind} />
      <div class="empty-text">
        <h2 class="title-medium">{props.title}</h2>
        <Show when={props.children}>
          <p class="body-medium on-surface-variant">{props.children}</p>
        </Show>
        <Show when={props.action || props.secondary}>
          <div class="empty-actions">
            <Show when={props.action}>
              {(action) => (
                <button type="button" class="btn-tonal" onClick={() => action().onClick()}>
                  {action().label}
                  <Show when={action().hint}>
                    {(keys) => <KeyCombo class="empty-action-key" keys={keys()} decorative />}
                  </Show>
                </button>
              )}
            </Show>
            <Show when={props.secondary}>
              {(action) => (
                <button type="button" class="btn-text" onClick={() => action().onClick()}>
                  {action().label}
                </button>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
