import { For, Show } from "solid-js";
import { keyCaps } from "./keymap.ts";

/**
 * A shortcut as keycaps: one cap for a lone key, caps joined by a quiet "+"
 * for a chord ("Ctrl+K", "Shift+Space"). Every place that draws a shortcut
 * uses this, so a chord reads the same everywhere (DESIGN.md § Key caps).
 * `decorative` hides it from assistive tech where `aria-keyshortcuts` or a
 * label already says it.
 */
export function KeyCombo(props: { keys: string; class?: string; decorative?: boolean }) {
  return (
    <span
      class={props.class ? `key-combo ${props.class}` : "key-combo"}
      aria-hidden={props.decorative ? "true" : undefined}
    >
      <For each={keyCaps(props.keys)}>
        {(cap, index) => (
          <>
            <Show when={index() > 0}>
              <span class="key-plus" aria-hidden="true">
                +
              </span>
            </Show>
            <kbd class="key-hint">{cap}</kbd>
          </>
        )}
      </For>
    </span>
  );
}
