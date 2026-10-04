import { type Accessor, createEffect, createSignal, on, onCleanup, untrack } from "solid-js";
import { prefersReducedMotion } from "./glideGeometry.ts";

/** A reset's countdown runs this long (ms) however large the count was. */
export const COUNTDOWN_MS = 450;
/** At most this many numbers are shown on the way down: a large count skips. */
export const COUNTDOWN_STEPS = 8;
/** Each pause is this share of the one before: the countdown speeds up. */
const DECAY = 0.8;
/** The last number is let to roll in before the count fades (ms). */
const SETTLE_MS = 200;

export interface CountdownStep {
  /** The number to show. */
  value: number;
  /** How long (ms) after the previous number (or the start) it comes. */
  delay: number;
}

/**
 * The numbers a count passes on its way from `from` down to `to`, and when:
 * every one of them for a small count, an even sample for a large one (at
 * most `maxSteps`, ending on `to`), the first at once and each pause after it
 * shorter than the last, the whole run `total` ms. Nothing for a count that
 * doesn't go down.
 */
export function countdownPlan(
  from: number,
  to: number,
  total = COUNTDOWN_MS,
  maxSteps = COUNTDOWN_STEPS,
): CountdownStep[] {
  const span = from - to;
  if (!(span > 0)) return [];
  const steps = Math.min(span, maxSteps);
  // The first number comes at once; the pauses between the numbers shrink.
  const weights = Array.from({ length: steps - 1 }, (_, i) => DECAY ** i);
  const sum = weights.reduce((a, b) => a + b, 0);
  return Array.from({ length: steps }, (_, i) => ({
    value: Math.round(from - (span * (i + 1)) / steps),
    delay: i === 0 ? 0 : (total * (weights[i - 1] ?? 0)) / sum,
  }));
}

export interface RepeatDisplay {
  /** The number on show: it runs behind the real count while it counts down. */
  shown: Accessor<number>;
  /** Whether the ×N is on screen at all (it stays through its fade). */
  visible: Accessor<boolean>;
  /** The ×N is fading out. */
  fading: Accessor<boolean>;
  /** The number is in a countdown: its rolls are quicker. */
  rapid: Accessor<boolean>;
}

const fadeMs = () =>
  Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--motion-short"),
  ) || 150;

/**
 * What the Repeat row's ×N shows for the real `count` (1 = no repeat). Only
 * the display lags: a Reset counts down through the numbers in a quick,
 * accelerating run and then the ×N fades, the last Undo rolls to ×1 and
 * fades, and with reduced motion there is no countdown, only the fade. Where
 * nothing can be animated (jsdom) it changes at once. `place` names where in
 * the song the count is: moving to another part is no Undo or Reset, so the
 * display follows at once there.
 */
export function createRepeatDisplay(
  count: Accessor<number>,
  place: Accessor<unknown> = () => 0,
): RepeatDisplay {
  const [shown, setShown] = createSignal(Math.max(count(), 1));
  const [visible, setVisible] = createSignal(count() > 1);
  const [fading, setFading] = createSignal(false);
  const [rapid, setRapid] = createSignal(false);
  let timers: ReturnType<typeof setTimeout>[] = [];
  const clear = () => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  };
  const later = (ms: number, run: () => void) => timers.push(setTimeout(run, ms));
  onCleanup(clear);

  const fadeOut = () => {
    setFading(true);
    later(fadeMs(), () => {
      setVisible(false);
      setFading(false);
      setRapid(false);
    });
  };

  /** Runs the numbers down to `to`; returns when the last one is shown (ms). */
  const countDown = (from: number, to: number) => {
    const plan = countdownPlan(from, to);
    setRapid(from - to >= 2);
    let at = 0;
    for (const step of plan) {
      at += step.delay;
      later(at, () => setShown(step.value));
    }
    return at;
  };

  let last = untrack(place);
  createEffect(
    on(
      () => [count(), place()] as const,
      ([value, here]) => {
        clear();
        const moved = here !== last;
        last = here;
        const animated = !moved && typeof Element.prototype.animate === "function";
        const reduced = prefersReducedMotion();
        if (value > 1) {
          const from = untrack(shown);
          const was = untrack(visible);
          setFading(false);
          setVisible(true);
          if (was && animated && !reduced && from - value >= 2) countDown(from, value);
          else {
            setRapid(false);
            setShown(value);
          }
          return;
        }
        // The count has ended.
        if (!untrack(visible)) return;
        if (!animated) {
          setVisible(false);
          setFading(false);
          setShown(1);
          return;
        }
        // Reduced motion: no countdown, the number as it was just fades.
        if (reduced) {
          fadeOut();
          return;
        }
        const from = untrack(shown);
        const end = from > 1 ? countDown(from, 1) : 0;
        later(end + SETTLE_MS, fadeOut);
      },
      { defer: true },
    ),
  );

  return { shown, visible, fading, rapid };
}
