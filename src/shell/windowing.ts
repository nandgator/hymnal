/**
 * Windowing: a long list that keeps only the rows in view (and a few either side) in the
 * DOM (SDD-0001 §13.2, Board #66). Two parts. The maths is pure: a {@link Layout} of
 * cumulative heights and a binary search over it. The {@link windowed} controller finds the
 * nearest scrolling ancestor of a list, follows its scroll once per frame and reports the
 * range of rows to render; it reads no layout while scrolling (the list's offset in its
 * scroller is measured when the scroller or the list resizes, not per frame).
 *
 * Heights are given, never measured per row: a row's height is fixed by its stylesheet, so
 * opening a list of a thousand rows costs one pass of arithmetic.
 */

/** Where each of `count` rows starts, and where the last one ends. */
export interface Layout {
  /** `offsets[i]` is the top of row `i`; `offsets[count]` is the total height. */
  offsets: Float64Array;
  count: number;
  total: number;
}

/** The rows to render: `start` up to, not including, `end`. */
export interface Range {
  start: number;
  end: number;
}

/** What covers the edges of the view (a sticky field above, a notice below). */
export interface Insets {
  top: number;
  bottom: number;
}

export function layoutOf(count: number, heightOf: (index: number) => number): Layout {
  const offsets = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) offsets[i + 1] = (offsets[i] ?? 0) + heightOf(i);
  return { offsets, count, total: offsets[count] ?? 0 };
}

/** The row holding position `y`, clamped to the list. */
export function indexAt(layout: Layout, y: number): number {
  if (layout.count === 0) return 0;
  let low = 0;
  let high = layout.count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((layout.offsets[mid] ?? 0) <= y) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * The rows to render for a view starting `top` px into the list and `viewport` px tall,
 * `overscan` px more either side.
 */
export function windowOf(layout: Layout, top: number, viewport: number, overscan: number): Range {
  if (layout.count === 0) return { start: 0, end: 0 };
  const from = Math.max(0, top - overscan);
  const to = Math.min(layout.total, top + viewport + overscan);
  const start = indexAt(layout, from);
  // The row holding `to` is rendered too, unless `to` is exactly where one starts.
  let end = indexAt(layout, to) + 1;
  if (to < layout.total && (layout.offsets[end - 1] ?? 0) >= to && end - 1 > start) end -= 1;
  return { start, end: Math.min(layout.count, Math.max(end, start + 1)) };
}

/**
 * The scroll position (px into the list) that brings row `index` into a view at `top` and
 * `viewport` tall, moving the least; `undefined` when it is in view already. `inset` keeps it
 * clear of what covers the view's edges.
 */
export function revealOffset(
  layout: Layout,
  index: number,
  top: number,
  viewport: number,
  inset: Insets,
): number | undefined {
  const from = layout.offsets[index] ?? 0;
  const to = layout.offsets[index + 1] ?? from;
  if (from < top + inset.top) return Math.max(0, from - inset.top);
  if (to > top + viewport - inset.bottom) return Math.max(0, to - viewport + inset.bottom);
  return undefined;
}

export interface WindowedOptions {
  /** The element the rows are laid in: its offset in the scroller is the list's start. */
  list: HTMLElement;
  /** The rows' layout now; read on every update. */
  layout: () => Layout;
  /** How far past the view (px) rows are kept, each way. */
  overscan: number;
  /** What covers the view's edges (px); read when a row is revealed. */
  insets: () => Insets;
  /** Called with the rows to render, only when they change. */
  onRange: (range: Range) => void;
}

export interface Windowed {
  /** Reads the scroller and reports the window now (after the layout changed). */
  update(): void;
  /** Scrolls row `index` into view, if it is not, and reports the window at once. */
  reveal(index: number): void;
  /** Scrolls the list's start into view: a new list begins at its top. */
  toStart(): void;
  /** How many px tall the view is. */
  viewport(): number;
  stop(): void;
}

/** The nearest ancestor that scrolls vertically, else the page (`null`). */
function scrollerOf(list: HTMLElement): HTMLElement | null {
  for (let n = list.parentElement; n && n !== document.documentElement; n = n.parentElement) {
    const overflow = getComputedStyle(n).overflowY;
    if (overflow === "auto" || overflow === "scroll" || overflow === "overlay") return n;
  }
  return null;
}

/** While scrolling, where the list starts is read again at most this often (ms). */
const REMEASURE_MS = 250;

export function windowed(options: WindowedOptions): Windowed {
  const { list } = options;
  const scroller = scrollerOf(list);
  const frame: (cb: () => void) => unknown =
    typeof requestAnimationFrame === "function"
      ? (cb) => requestAnimationFrame(cb)
      : (cb) => setTimeout(cb, 16);
  const eventTarget: EventTarget = scroller ?? window;

  // Where the list starts in the scroller's content, in px: read when something resizes.
  let listTop = 0;
  let measuredAt = Number.NEGATIVE_INFINITY;
  const now = () => (typeof performance === "object" ? performance.now() : Date.now());
  let stopped = false;
  let pending = false;
  let last: Range | undefined;

  const scrollTop = () => (scroller ? scroller.scrollTop : window.scrollY);
  const viewport = () => {
    // No layout at all (a test, or a hidden list): the window's height stands in.
    const height = scroller ? scroller.clientHeight : window.innerHeight;
    return height > 0 ? height : window.innerHeight;
  };

  const measure = () => {
    const rect = list.getBoundingClientRect();
    // Not laid out (a test, or a list not shown): there is nothing to read.
    if (rect.width === 0 && rect.height === 0) return;
    measuredAt = now();
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      listTop = rect.top - box.top - scroller.clientTop + scroller.scrollTop;
    } else {
      listTop = rect.top + window.scrollY;
    }
  };

  const report = (top: number) => {
    const range = windowOf(options.layout(), top - listTop, viewport(), options.overscan);
    if (last && last.start === range.start && last.end === range.end) return;
    last = range;
    options.onRange(range);
  };

  const update = () => report(scrollTop());

  const onScroll = () => {
    if (pending || stopped) return;
    pending = true;
    frame(() => {
      pending = false;
      if (stopped) return;
      // The list may have moved without a resize (a page sliding in, content loading above):
      // read where it is again now and then, never on every frame.
      if (now() - measuredAt > REMEASURE_MS) measure();
      update();
    });
  };

  const remeasure = () => {
    if (stopped) return;
    measure();
    update();
  };

  eventTarget.addEventListener("scroll", onScroll, { passive: true });
  let observer: ResizeObserver | undefined;
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(remeasure);
    if (scroller) observer.observe(scroller);
    if (list.parentElement) observer.observe(list.parentElement);
  }
  window.addEventListener("resize", remeasure);
  // Where the list starts is read once now (the layout of a list just mounted).
  measure();

  const scrollTo = (top: number) => {
    if (scroller) scroller.scrollTop = top;
    else window.scrollTo({ top, behavior: "instant" });
  };

  return {
    update,
    viewport,
    reveal(index) {
      measure();
      const top = scrollTop();
      const target = revealOffset(
        options.layout(),
        index,
        top - listTop,
        viewport(),
        options.insets(),
      );
      if (target === undefined) return report(top);
      scrollTo(target + listTop);
      // The window follows the position just set, without waiting for the scroll event.
      report(target + listTop);
    },
    toStart() {
      if (scrollTop() > 0) scrollTo(0);
      report(0);
    },
    stop() {
      stopped = true;
      eventTarget.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", remeasure);
      observer?.disconnect();
    },
  };
}
