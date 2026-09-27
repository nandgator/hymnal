import { createSignal, type JSX, onCleanup, Show } from "solid-js";

/** How long a wait lasts before it's shown (DESIGN.md § Structure): a fast
 * load shows nothing at all, rather than a flash of skeleton. */
export const LOADING_DELAY_MS = 300;

/** Its children, once a wait has lasted {@link LOADING_DELAY_MS}. */
export function AfterDelay(props: { children: JSX.Element }) {
  const [shown, setShown] = createSignal(false);
  const timer = setTimeout(() => setShown(true), LOADING_DELAY_MS);
  onCleanup(() => clearTimeout(timer));
  return <Show when={shown()}>{props.children}</Show>;
}

/**
 * MD3's linear progress indicator: determinate with a `value` (0–1), else
 * indeterminate. The label is its accessible name.
 */
export function ProgressBar(props: { value?: number; label: string }) {
  return (
    <div
      class="progress"
      classList={{ "progress-indeterminate": props.value === undefined }}
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={props.value === undefined ? undefined : Math.round(props.value * 100)}
    >
      <span
        class="progress-indicator"
        style={props.value === undefined ? undefined : { transform: `scaleX(${props.value})` }}
      />
    </div>
  );
}
