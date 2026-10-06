import { createSignal, ErrorBoundary, type JSX, onCleanup, onMount, Show } from "solid-js";
import { userState } from "../persistence/user-state.ts";

/** The first line, capped; a search failure's message quotes what was typed
 * (maybe lyrics), so it is replaced whole. */
function safeMessage(message: string): string {
  if (/fts5|near "/i.test(message)) return "(a search failed)";
  return (message.split("\n")[0] ?? "").slice(0, 200);
}

/** What "Copy error details" puts on the clipboard (SDD-0001 §16.9): the
 * message, the stack, the build and the user agent. Never lyrics or recents. */
export function errorDetails(error: unknown): string {
  const known = error instanceof Error;
  const message = safeMessage(known ? error.message : String(error));
  // A stack starts with the message: say the safe one there too.
  const stack =
    known && error.stack
      ? error.message
        ? error.stack.split(error.message).join(message)
        : error.stack
      : "(none)";
  return [
    `Message: ${message}`,
    `Build: ${__APP_BUILD__}`,
    `User agent: ${navigator.userAgent}`,
    `Stack:\n${stack}`,
  ].join("\n");
}

/**
 * The calm screen for a fault the Operator cannot recover from (SDD-0001
 * §16.9). It depends on no store and no context below it: only the user-state
 * singleton, for Reset.
 */
export function ErrorScreen(props: { error: unknown }) {
  const [confirming, setConfirming] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [copied, setCopied] = createSignal<"copied" | "failed">();
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copiedTimer));
  let primary: HTMLButtonElement | undefined;
  onMount(() => primary?.focus());

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(errorDetails(props.error));
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setCopied(undefined), 3000);
  };
  const reset = async () => {
    setBusy(true);
    try {
      await userState.reset();
    } catch (error) {
      console.error("[hymnal] reset failed", error);
    }
    // Reloaded either way: the app then opens on whatever the database is.
    window.location.reload();
  };

  return (
    <main class="tab-note">
      <div class="card-elevated library lib-empty">
        <Show
          when={confirming()}
          fallback={
            <>
              <h1 class="display-small">Something went wrong</h1>
              <p class="body-large on-surface-variant error-body" role="alert">
                The hymnal hit an error it couldn’t recover from. Your books are safe.
              </p>
              <div class="lib-empty-actions">
                <button
                  type="button"
                  class="btn-filled"
                  ref={(el) => {
                    primary = el;
                  }}
                  onClick={() => window.location.reload()}
                >
                  Reload
                </button>
                <button type="button" class="btn-tonal" onClick={() => void copy()}>
                  {copied() === "copied"
                    ? "Copied"
                    : copied() === "failed"
                      ? "Couldn’t copy"
                      : "Copy error details"}
                </button>
                <button type="button" class="btn-text" onClick={() => setConfirming(true)}>
                  Reset settings and history…
                </button>
              </div>
            </>
          }
        >
          <h1 class="display-small">Reset settings and history?</h1>
          <p class="body-large on-surface-variant error-body" role="alert">
            This clears your settings and recents on this device. Your books are not touched.
          </p>
          <div class="lib-empty-actions">
            <button
              type="button"
              class="btn-filled btn-danger"
              disabled={busy()}
              onClick={() => void reset()}
            >
              Reset
            </button>
            <button
              type="button"
              class="btn-text"
              disabled={busy()}
              ref={(el) => queueMicrotask(() => el.focus())}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </Show>
      </div>
    </main>
  );
}

/** The Operator's boundary, under TabGate (SDD-0001 §16.9). */
export function RootBoundary(props: { children: JSX.Element }) {
  return (
    <ErrorBoundary
      fallback={(error) => {
        console.error("[hymnal] the app failed", error);
        return <ErrorScreen error={error} />;
      }}
    >
      {props.children}
    </ErrorBoundary>
  );
}
