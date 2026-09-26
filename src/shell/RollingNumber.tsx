import { createEffect, createSignal, For } from "solid-js";

export interface RollingNumberProps {
  value: number;
}

interface Face {
  value: number;
  key: number;
  leaving?: boolean;
}

/**
 * A rolling number (an odometer; SwiftUI's numeric-text transition): on a
 * change the old value rolls out and the new one rolls in — up when it
 * grows, down when it shrinks — so the direction of the change is seen,
 * not only its result (DESIGN.md § Motion). At most two faces exist: the
 * one leaving and the one arriving. Reduced motion swaps it at once.
 */
export function RollingNumber(props: RollingNumberProps) {
  let key = 0;
  const [faces, setFaces] = createSignal<Face[]>([{ value: props.value, key }]);
  const [direction, setDirection] = createSignal<"up" | "down">("up");

  let last = props.value;
  createEffect(() => {
    const value = props.value;
    if (value === last) return;
    setDirection(value > last ? "up" : "down");
    last = value;
    key += 1;
    setFaces((all) => [
      ...all.filter((face) => !face.leaving).map((face) => ({ ...face, leaving: true })),
      { value, key },
    ]);
  });

  const drop = (gone: Face) => setFaces((all) => all.filter((face) => face.key !== gone.key));

  return (
    <span class="rolling-number" data-direction={direction()}>
      <For each={faces()}>
        {(face) => (
          <span
            class="rolling-face"
            classList={{ "rolling-face-leaving": !!face.leaving }}
            // The leaving face is drawn from its attribute, not as text, so
            // the number's text (and what a screen reader hears) is only
            // the current value, even mid-roll.
            data-value={face.leaving ? face.value : undefined}
            onAnimationEnd={() => face.leaving && drop(face)}
          >
            {face.leaving ? null : face.value}
          </span>
        )}
      </For>
    </span>
  );
}
