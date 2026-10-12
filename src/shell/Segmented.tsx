import { createEffect, For, onCleanup } from "solid-js";
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

/** The radio names in use now: a name is freed when its control goes. */
const taken = new Set<string>();

/**
 * A radio group name that is the same on every mount of a use-site (its
 * legend) and never shared by two controls mounted together. A fresh unique
 * name per mount leaves the browser a new radio group each time, which it keeps
 * for the document's lifetime.
 */
function claimName(legend: string): string {
  const base = `segmented-${legend.replace(/\W+/g, "-").toLowerCase()}`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  taken.add(name);
  const claimed = name;
  onCleanup(() => taken.delete(claimed));
  return name;
}

/**
 * An MD3 segmented button on native radios, as Settings draws them: its hover
 * highlight and its selected pill each glide from segment to segment.
 */
export function Segmented<T extends string>(props: SegmentedProps<T>) {
  const name = claimName(props.legend);
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
