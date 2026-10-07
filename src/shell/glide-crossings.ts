/** Material's emphasised easing, at the top of the 200–300ms range: a row
 * can travel the list's length. */
export const EMPHASIZED_BEZIER = [0.2, 0, 0, 1] as const;
export const GLIDE_MS = 300;

/** A fade runs this long in wall time, or the time there is before the
 * glide starts, ends, or meets the next fade. */
const FADE_MS = 60;
/** The text is taken as a row less this share of its height at top and
 * bottom: its box's padding holds no glyph. */
const TEXT_MARGIN = 0.25;

export interface GlideItem {
  key: string;
  /** Where it lands (viewport px), and its height. */
  top: number;
  height: number;
  /** How far above its landing place it starts: `was.top - top`. */
  dy: number;
  /** New on the page: it has no place to glide from, and fades in. */
  fresh?: boolean;
  /** It has a fill of its own (the song that's up wears the tonal one), so
   * it hides what it passes over: those rows need not fade. */
  opaque?: boolean;
}

export interface CrossingPlan {
  /** Covers a row while it glides, so it is raised above it. */
  lift: boolean;
  /** Opacity over the glide, linear in time; offsets within [0, 1], in
   * order. Absent when nothing covers the row's text. A new item's always
   * is: it comes in once the rows sliding away have cleared its text. */
  fade?: { offset: number; opacity: number }[];
}

const bezier = (s: number, a: number, b: number) =>
  3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s ** 2 * b + s ** 3;

/** The share of the glide's time at which the easing reaches progress `p`
 * (the cubic-bezier inverted by bisection). */
export function timeAtProgress(p: number, curve = EMPHASIZED_BEZIER): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const [x1, y1, x2, y2] = curve;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(mid, y1, y2) < p) lo = mid;
    else hi = mid;
  }
  return bezier((lo + hi) / 2, x1, x2);
}

/** Which rows cover which as they glide, and when. Every item sits at
 * `top + dy * (1 - p)` at progress `p`, so a pair that moves relative to
 * each other closes or opens its gap linearly in `p`. An item that moves up
 * relative to another covers it for a while: it is raised, and the other is
 * out of sight from just before it reaches the other's text to just after
 * it has left, so no glyph is ever half covered. Items that keep their
 * distance (a new song on top, the rest all sliding down) never cross. A
 * riser with a fill of its own (`opaque`) covers the rows it passes, which
 * stay in view. */
export function planCrossings(items: GlideItem[], glideMs = GLIDE_MS): Map<string, CrossingPlan> {
  const plans = new Map<string, CrossingPlan>(items.map((item) => [item.key, { lift: false }]));
  const windows = new Map<string, [number, number][]>();
  for (const over of items) {
    for (const under of items) {
      if (over.fresh || under.fresh) continue;
      const closing = over.dy - under.dy;
      if (closing <= 0) continue;
      const margin = under.height * TEXT_MARGIN;
      const gap = over.top - under.top;
      // Covering the text: from the top of `over` reaching the bottom of
      // the text, to its bottom passing the top of the text.
      const from = 1 - (under.height - margin - gap) / closing;
      const to = 1 - (margin - over.height - gap) / closing;
      if (to <= 0 || from >= 1) continue;
      const span: [number, number] = [
        timeAtProgress(Math.max(from, 0)) * glideMs,
        timeAtProgress(Math.min(to, 1)) * glideMs,
      ];
      const plan = plans.get(over.key);
      if (plan) plan.lift = true;
      // Covered cleanly by a fill: no glyph is half hidden, so no fade.
      if (over.opaque) continue;
      windows.set(under.key, [...(windows.get(under.key) ?? []), span]);
    }
  }
  for (const item of items) {
    const plan = plans.get(item.key);
    if (item.fresh && plan) plan.fade = comeIn(item, items, glideMs);
  }
  for (const [key, spans] of windows) {
    const plan = plans.get(key);
    if (plan) plan.fade = fadeAround(merge(spans), glideMs);
  }
  return plans;
}

/** A new item: out of sight while another item overlaps its text, then in
 * over two fades. */
function comeIn(fresh: GlideItem, items: GlideItem[], glideMs: number) {
  const margin = fresh.height * TEXT_MARGIN;
  const low = fresh.top + margin; // the text's top
  const high = fresh.top + fresh.height - margin; // and bottom
  let clear = 0;
  for (const other of items) {
    if (other.fresh || other.dy === 0) continue;
    // `other` is at `top + dy * (1 - p)`: over the text while its top is
    // above `high` and its bottom below `low`.
    const at = (y: number) => 1 - (y - other.top) / other.dy;
    const ends = [at(high), at(low - other.height)];
    const [start, end] = [Math.min(...ends), Math.max(...ends)];
    if (end > 0 && start < 1) clear = Math.max(clear, timeAtProgress(Math.min(end, 1)) * glideMs);
  }
  const points = [
    { time: 0, opacity: 0 },
    { time: clear, opacity: 0 },
    { time: Math.min(glideMs, clear + 2 * FADE_MS), opacity: 1 },
  ];
  return points.map(({ time, opacity }) => ({ offset: time / glideMs, opacity }));
}

/** Spans that are closer than two fades are one. */
function merge(spans: [number, number][]): [number, number][] {
  const merged: [number, number][] = [];
  for (const span of spans.toSorted((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && span[0] - last[1] < 2 * FADE_MS) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

function fadeAround(spans: [number, number][], glideMs: number) {
  const points: { time: number; opacity: number }[] = [{ time: 0, opacity: 1 }];
  let free = 0;
  for (const [start, end] of spans) {
    const out = Math.min(FADE_MS, Math.max(0, start - free));
    points.push(
      { time: start - out, opacity: 1 },
      { time: start, opacity: 0 },
      { time: end, opacity: 0 },
    );
    free = Math.min(glideMs, end + FADE_MS);
    points.push({ time: free, opacity: 1 });
  }
  let last = 0;
  return points.map(({ time, opacity }) => {
    last = Math.min(1, Math.max(last, time / glideMs));
    return { offset: last, opacity };
  });
}
