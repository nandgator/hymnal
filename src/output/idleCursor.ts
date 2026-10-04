import { type Accessor, createSignal, onCleanup, onMount } from "solid-js";

/** How long the mouse rests before its cursor goes (ms). */
export const CURSOR_IDLE_MS = 2000;

/**
 * Whether the cursor shows over the Output: while the mouse moves, so the
 * operator can position and fullscreen the window, and not once it is still,
 * so it never sits parked over the projected lyrics. The Output window and
 * Present here share it. Call it in a component: it listens until cleanup.
 */
export function createIdleCursor(idleMs = CURSOR_IDLE_MS): Accessor<boolean> {
  const [visible, setVisible] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onMouseMove = () => {
    setVisible(true);
    clearTimeout(timer);
    timer = setTimeout(() => setVisible(false), idleMs);
  };
  onMount(() => window.addEventListener("mousemove", onMouseMove));
  onCleanup(() => {
    window.removeEventListener("mousemove", onMouseMove);
    clearTimeout(timer);
  });
  return visible;
}
