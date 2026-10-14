import { Show } from "solid-js";

/**
 * A search field's trailing clear button (MD3): an X in the field's end, there only while the
 * field has text, which it empties, putting focus back in the field. It sits over the field's
 * own end padding, so it appearing moves nothing. Put it inside the `.text-field` that holds
 * the input.
 */
export function ClearSearch(props: { visible: boolean; onClear: () => void }) {
  return (
    <Show when={props.visible}>
      <button
        type="button"
        class="btn-text text-field-clear"
        aria-label="Clear search"
        // The box keeps focus (and a phone its keyboard) while the button is pressed.
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          // Focus first: the button goes away with the text, and focus must not go with it.
          event.currentTarget.closest(".text-field")?.querySelector("input")?.focus();
          props.onClear();
        }}
      >
        <span class="icon icon-close" aria-hidden="true" />
      </button>
    </Show>
  );
}
