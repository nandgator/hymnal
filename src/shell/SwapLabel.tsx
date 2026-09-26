import { For } from "solid-js";

export interface SwapLabelProps {
  /** Every label the control can show, e.g. ["Blank", "Restore"]. */
  labels: string[];
  /** The one showing now; one of `labels`. */
  current: string;
}

/**
 * A label that can change without resizing its control (DESIGN.md §
 * Stability): every label shares one grid cell, so the control is as wide
 * as the longest, and only the current one is visible. The others are
 * hidden from assistive technology too, so the name stays the current one.
 */
export function SwapLabel(props: SwapLabelProps) {
  return (
    <span class="swap-label">
      <For each={props.labels}>
        {(label) => (
          <span
            class="swap-label-item"
            classList={{ "swap-label-current": label === props.current }}
            aria-hidden={label === props.current ? undefined : "true"}
          >
            {label}
          </span>
        )}
      </For>
    </span>
  );
}
