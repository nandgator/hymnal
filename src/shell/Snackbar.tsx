import { createEffect, createSignal, onCleanup, Show, untrack } from "solid-js";

export interface SnackbarProps {
  message: string;
  /** The single action, text-weight — "Restart", "Got it". */
  action: string;
  onAction: () => void;
  /** Closes without acting; absent when the action itself closes. */
  dismissLabel?: string;
  onDismiss?: () => void;
}

/** The leave animation's length, plus a little: the fallback when none runs. */
const LEAVE_MS = 300;

/**
 * Hosts the one notice (DESIGN.md § Snackbar): shows `notice` while there is
 * one, and keeps the last one mounted while it slides away, so it leaves as
 * it came instead of vanishing. A different notice replaces it in place.
 */
export function SnackbarHost(props: { notice: SnackbarProps | undefined }) {
  const [shown, setShown] = createSignal<SnackbarProps>();
  const [leaving, setLeaving] = createSignal(false);
  createEffect(() => {
    const next = props.notice;
    if (next) {
      setShown(next);
      setLeaving(false);
    } else if (untrack(shown)) {
      setLeaving(true);
      const timer = setTimeout(() => setShown(undefined), LEAVE_MS);
      onCleanup(() => clearTimeout(timer));
    }
  });
  return (
    <Show when={shown()}>
      {(notice) => (
        <div
          class="snackbar-region"
          classList={{ "snackbar-leaving": leaving() }}
          aria-hidden={leaving() ? "true" : undefined}
          onAnimationEnd={(event) => {
            if (leaving() && event.target === event.currentTarget) setShown(undefined);
          }}
        >
          <Snackbar {...notice()} />
        </div>
      )}
    </Show>
  );
}

/**
 * The notice card itself (DESIGN.md § Snackbar): a message, one
 * action, an optional close. It takes no focus, and carries no live-region
 * role of its own: the shell's persistent region announces its message.
 */
export function Snackbar(props: SnackbarProps) {
  return (
    <div class="snackbar">
      <span class="snackbar-message">{props.message}</span>
      <button type="button" class="btn-text snackbar-action" onClick={() => props.onAction()}>
        {props.action}
      </button>
      <Show when={props.onDismiss}>
        <button
          type="button"
          class="snackbar-close"
          aria-label={props.dismissLabel ?? "Dismiss"}
          onClick={() => props.onDismiss?.()}
        >
          <span class="icon icon-close" aria-hidden="true" />
        </button>
      </Show>
    </div>
  );
}
