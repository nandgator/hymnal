import { Show } from "solid-js";

export interface SnackbarProps {
  message: string;
  /** The single action, text-weight — "Restart", "Got it". */
  action: string;
  onAction: () => void;
  /** Closes without acting; absent when the action itself closes. */
  dismissLabel?: string;
  onDismiss?: () => void;
}

/**
 * The shell's one floating notice (DESIGN.md § Snackbar): a message, one
 * action, an optional close. It takes no focus, and carries no live-region
 * role of its own: the shell's persistent region announces its message.
 */
export function Snackbar(props: SnackbarProps) {
  return (
    <div class="snackbar-region">
      <div class="snackbar">
        <span class="snackbar-message">{props.message}</span>
        <button type="button" class="btn-text snackbar-action" onClick={props.onAction}>
          {props.action}
        </button>
        <Show when={props.onDismiss}>
          <button
            type="button"
            class="snackbar-close"
            aria-label={props.dismissLabel ?? "Dismiss"}
            onClick={props.onDismiss}
          >
            <span class="icon icon-close" aria-hidden="true" />
          </button>
        </Show>
      </div>
    </div>
  );
}
