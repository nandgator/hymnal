import { createEffect, createUniqueId, For, onCleanup } from "solid-js";
import { glideList } from "./glideList.ts";

export interface SegmentedProps<T extends string> {
  /** The group's name for assistive technology; not shown. */
  legend: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  /** Long labels on a phone: the checkmark's slot goes (styles.css). */
  tight?: boolean;
}

/**
 * An MD3 segmented button on native radios, as Settings draws them: its hover
 * highlight and its selected pill each glide from segment to segment.
 */
export function Segmented<T extends string>(props: SegmentedProps<T>) {
  const name = createUniqueId();
  return (
    <fieldset
      class="segmented"
      data-keep-motion=""
      classList={{ "segmented-tight": props.tight }}
      ref={(el) => {
        const glide = glideList(el, {
          rows: ".segment",
          current: ".segment-input:checked",
          target: (input) => input.closest<HTMLElement>(".segment"),
        });
        onCleanup(glide.stop);
        // A radio's checked state is a property: tell the pill when it changes.
        createEffect(() => {
          void props.value;
          queueMicrotask(() => glide.select?.sync());
        });
      }}
    >
      <legend class="visually-hidden">{props.legend}</legend>
      <For each={props.options}>
        {(option) => (
          <label class="segment" data-label={option.label}>
            <input
              type="radio"
              name={name}
              class="segment-input"
              checked={props.value === option.value}
              onChange={() => props.onChange(option.value)}
            />
            <span class="segment-face">
              <span class="segment-check icon icon-check" aria-hidden="true" />
              {option.label}
            </span>
          </label>
        )}
      </For>
    </fieldset>
  );
}
