import { type Accessor, createEffect, createSignal, type JSX, onCleanup, Show } from "solid-js";
import { fraction, type LoadProgress, phaseLine } from "../domain/progress.ts";

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

/**
 * True once `when` has held for {@link LOADING_DELAY_MS}, and false again as
 * soon as it stops: the same delay as {@link AfterDelay}, for a wait whose
 * start is a signal, not a mounting.
 */
export function createDelayed(when: Accessor<boolean>, ms = LOADING_DELAY_MS): Accessor<boolean> {
  const [shown, setShown] = createSignal(false);
  createEffect(() => {
    if (!when()) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), ms);
    onCleanup(() => clearTimeout(timer));
  });
  return shown;
}

/**
 * A book load's bar and its phase line (SDD-0004 §14): determinate where the
 * phase is counted ("Saving 1,200 of 1,631 songs"), else indeterminate
 * ("Indexing for search…"). `idle` says what it is before the worker has
 * reported a phase.
 */
export function LoadStatus(props: { progress?: LoadProgress; idle: string }) {
  const line = () => (props.progress ? phaseLine(props.progress) : props.idle);
  return (
    <div class="load-status">
      <ProgressBar value={props.progress && fraction(props.progress)} label={line()} />
      <p class="body-medium on-surface-variant library-progress-text">{line()}</p>
    </div>
  );
}
