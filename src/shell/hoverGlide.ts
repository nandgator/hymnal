import {
  type Box,
  boxOf,
  frame,
  glideTiming,
  paint,
  prefersReducedMotion,
  shownBox,
} from "../presenter/glideGeometry.ts";

// jsdom has no Web Animations: there the layer jumps, as with no motion.
const noAnimations = () => typeof Element.prototype.animate !== "function";

type Side = "top" | "bottom" | "left" | "right";

/** The layer softens (px) as it arrives from, and drifts out toward, a side. */
export const HOVER_BLUR = 4;
/** A wide row's layer drifts in from the side by at most this (px). */
const SIDE_DRIFT = 96;
/** Reduced motion: the layer only fades, as quickly as a hover should. */
const FADE_MS = 150;
/** The pointer crossing a gap between rows is not leaving: the layer waits
 * this long (ms) for the next row before it lets go. */
const GAP_MS = 60;
/** ...and as long as the pointer keeps moving within this reach (px) of a row
 * it is still crossing: a slow hand takes far longer than GAP_MS to cross the
 * space between two rail items, and the layer must glide on, not go out and
 * fade back in place. */
const GAP_REACH = 28;
/** A pointer crossing that way pauses no longer than this (ms) before the
 * layer lets go: a hand is not as steady as a script. */
const CROSSING_MS = 150;

export const DEFAULT_ROWS = "button:enabled, a[href]";

export interface RowGlideOptions {
  /** The list is itself the one row: a lone button wearing the layer, which
   * enters from the side the pointer came by and leaves by the side it went. */
  whole?: boolean;
  /** How long (ms) the layer waits, over what is no row, for the next row
   * before it lets go. Wider for a group whose buttons have room between. */
  gap?: number;
}

/** A row that wants its own corner radius for the layer (a line inside a
 * block) sets this, in px; the layer's radius then glides with it. */
const ROW_RADIUS = "--glide-row-radius";

const radiusOf = (row: HTMLElement): number | null => {
  const value = getComputedStyle(row).getPropertyValue(ROW_RADIUS).trim();
  return /^[\d.]+px$/.test(value) ? Number.parseFloat(value) : null;
};

const blurOf = (layer: HTMLElement) => {
  const match = /blur\(([\d.]+)px\)/.exec(getComputedStyle(layer).filter);
  return match ? Number.parseFloat(match[1] ?? "0") : 0;
};

/** How far (px, in the list's own coordinates) a layer may reach on each side
 * before it would add scrollable overflow to the list or to whatever scrolls
 * around it. `Infinity` where nothing could scroll. */
export interface Room {
  right: number;
  bottom: number;
  left: number;
}

export const OPEN_ROOM: Room = {
  right: Number.POSITIVE_INFINITY,
  bottom: Number.POSITIVE_INFINITY,
  left: Number.NEGATIVE_INFINITY,
};

/** Where a layer sits just off its row, on the side the pointer came from or
 * went to: a row's height above or below, half its width (at most 96px) beside.
 * It never reaches past `room`: a layer drifting out of a full-width row would
 * otherwise widen the scrollable overflow of the list it sits in, and a
 * scrollbar would flash under the row while it slid. */
export function drift(box: Box, side: Side | null, room: Room = OPEN_ROOM): Box {
  const out = { ...box };
  if (side === "top") out.y -= box.h;
  else if (side === "bottom") out.y = Math.min(out.y + box.h, Math.max(box.y, room.bottom - box.h));
  else if (side === "left") {
    out.x = Math.max(out.x - Math.min(box.w / 2, SIDE_DRIFT), Math.min(box.x, room.left));
  } else if (side === "right") {
    out.x = Math.min(out.x + Math.min(box.w / 2, SIDE_DRIFT), Math.max(box.x, room.right - box.w));
  }
  return out;
}

/** The nearest ancestor (the list itself included) that clips or scrolls an
 * axis, else the page. */
function scrollerOf(list: HTMLElement, axis: "x" | "y"): HTMLElement {
  for (let n: HTMLElement | null = list; n && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if ((axis === "x" ? cs.overflowX : cs.overflowY) !== "visible") return n;
  }
  return document.documentElement;
}

/** The room a layer in `list` has before it adds scrollable overflow. Layout
 * is measured by offsets and sizes, rects only for where the scroller sits
 * against the list (a zoom-in scales the rects, so they are divided back). */
export function roomOf(list: HTMLElement): Room {
  const rect = list.getBoundingClientRect();
  const scale = list.offsetWidth > 0 && rect.width > 0 ? rect.width / list.offsetWidth : 1;
  const originX = rect.left + list.clientLeft * scale;
  const originY = rect.top + list.clientTop * scale;
  const room = { ...OPEN_ROOM };
  // No layout (jsdom, or a list not rendered): nothing to measure, nothing to limit.
  if (list.offsetWidth === 0 && list.offsetHeight === 0) return room;
  const sx = scrollerOf(list, "x");
  const sy = scrollerOf(list, "y");
  const root = document.documentElement;
  const rx = sx === root ? { left: 0, clientLeft: 0 } : sx.getBoundingClientRect();
  const ry = sy === root ? { top: 0, clientTop: 0 } : sy.getBoundingClientRect();
  const leftOf = sx === root ? 0 : rx.left + sx.clientLeft * scale;
  const topOf = sy === root ? 0 : ry.top + sy.clientTop * scale;
  // Scrollable width is the content's extent from the scroller's padding edge;
  // a scroll offset moves the whole of it.
  room.right =
    (leftOf - originX) / scale + Math.max(sx.scrollWidth, sx.clientWidth) - sx.scrollLeft;
  room.bottom =
    (topOf - originY) / scale + Math.max(sy.scrollHeight, sy.clientHeight) - sy.scrollTop;
  if (getComputedStyle(sx).direction === "rtl") {
    room.left =
      (leftOf - originX) / scale -
      (Math.max(sx.scrollWidth, sx.clientWidth) - sx.clientWidth) -
      sx.scrollLeft;
  }
  return room;
}

export interface RowGlide {
  /** Puts the highlight on a row (or takes it away: `null`), for a list whose
   * highlight is also driven by something besides the pointer and focus, as
   * the Finder's is by its arrow keys. A highlight that appears this way
   * fades up in place, with no side to come from. */
  show(row: HTMLElement | null): void;
  /** Keeps the layer on its row while the row moves or resizes (its list
   * animating): call it each frame. It repaints at the row's present box,
   * with no glide, and does nothing where the box has not changed. */
  follow(): void;
  /** Removes the layer and the listeners. */
  stop(): void;
}

/**
 * The one hover highlight of the app (DESIGN.md § Interaction states): one
 * layer under a list's rows that glides, by translate and height, to the row
 * under the pointer or the keyboard's focus. It comes in from the side the
 * pointer entered the list by, fading up out of a soft blur, and goes out
 * toward the side the pointer left by, fading into one; a highlight that
 * keyboard focus brings has no side and fades up in place. Reduced motion:
 * no glide and no blur, the layer only fades. `list` must be positioned (the
 * layer is placed by layout offsets) and isolated (`.glide-list`); give its
 * rows no hover fill of their own. Touch has no hover: no layer.
 */
export function glideRows(
  list: HTMLElement,
  rows = DEFAULT_ROWS,
  options: RowGlideOptions = {},
): RowGlide {
  const layer = document.createElement("div");
  layer.className = "hover-glide";
  layer.setAttribute("aria-hidden", "true");
  // A lone button's layer goes last: a framework writing the button's own
  // text into its first child must find the text, not the layer.
  const attach = () => {
    if (options.whole) list.append(layer);
    else list.prepend(layer);
  };
  attach();
  // The rows' own hover fill stands down while the layer is there.
  list.dataset.hoverGlide = "";

  let at: Box | null = null;
  let anim: Animation | null = null;
  let visible = false;
  let on: HTMLElement | null = null;
  let entry: Side | null = null;
  let gap: ReturnType<typeof setTimeout> | undefined;
  // The radius the layer wears where a row asks for its own (px), else null:
  // the stylesheet's.
  let radiusAt: number | null = null;

  const rowOf = (target: EventTarget | null) => {
    if (options.whole) return list.matches(":disabled") ? null : list;
    const row = (target as Element | null)?.closest?.(rows) as HTMLElement | null | undefined;
    return row && list.contains(row) ? row : null;
  };

  const place = (row: HTMLElement) => {
    clearTimeout(gap);
    // A framework writing a button's text (`textContent`) sweeps the layer
    // out with it: put it back.
    if (layer.parentNode !== list) attach();
    const to = boxOf(row, list);
    // Already there, or on its way: the pointer and an active-row signal
    // can both name the row, and the second must not restart the glide.
    if (
      visible &&
      row === on &&
      at &&
      to.x === at.x &&
      to.y === at.y &&
      to.w === at.w &&
      to.h === at.h
    )
      return;
    // A layer still fading out when the pointer comes back carries on from
    // where it is, rather than starting over from the side.
    const fading = !visible && anim?.playState === "running";
    const lit = visible || fading;
    const from = lit ? shownBox(layer, anim, at) : null;
    const opacity = lit ? Number.parseFloat(getComputedStyle(layer).opacity) : 0;
    const blur = lit ? blurOf(layer) : 0;
    anim?.cancel();
    anim = null;
    // The corner radius, if this row's differs from the last one's.
    const radius = radiusOf(row);
    let corners: [string, string] | null = null;
    if (radius !== radiusAt) {
      layer.style.borderRadius = "";
      const base = getComputedStyle(layer).borderTopLeftRadius;
      corners = [
        radiusAt === null ? base : `${radiusAt}px`,
        radius === null ? base : `${radius}px`,
      ];
    }
    radiusAt = radius;
    layer.style.borderRadius = radius === null ? "" : `${radius}px`;
    paint(layer, to);
    layer.style.opacity = "1";
    if (noAnimations()) {
      // jumps
    } else if (prefersReducedMotion()) {
      if (!lit || opacity < 1) {
        anim = layer.animate([{ opacity }, { opacity: 1 }], {
          duration: FADE_MS,
          easing: glideTiming(layer).easing,
        });
      }
    } else if (!lit || !from) {
      anim = layer.animate(
        [
          { ...frame(drift(to, entry, roomOf(list))), opacity: 0, filter: `blur(${HOVER_BLUR}px)` },
          { ...frame(to), opacity: 1, filter: "blur(0px)" },
        ],
        glideTiming(layer),
      );
    } else if (
      from.x !== to.x ||
      from.y !== to.y ||
      from.w !== to.w ||
      from.h !== to.h ||
      opacity < 1 ||
      blur > 0
    ) {
      anim = layer.animate(
        [
          {
            ...frame(from),
            opacity,
            filter: `blur(${blur}px)`,
            ...(corners && { borderRadius: corners[0] }),
          },
          {
            ...frame(to),
            opacity: 1,
            filter: "blur(0px)",
            ...(corners && { borderRadius: corners[1] }),
          },
        ],
        glideTiming(layer),
      );
    }
    at = to;
    on = row;
    visible = true;
    entry = null;
  };

  const hide = (side: Side | null = null) => {
    clearTimeout(gap);
    if (!visible) return;
    visible = false;
    on = null;
    const from = shownBox(layer, anim, at);
    const opacity = Number.parseFloat(getComputedStyle(layer).opacity);
    const blur = blurOf(layer);
    anim?.cancel();
    anim = null;
    layer.style.opacity = "0";
    if (noAnimations()) return;
    const timing = glideTiming(layer);
    if (prefersReducedMotion() || !from) {
      anim = layer.animate([{ opacity }, { opacity: 0 }], { ...timing, duration: FADE_MS });
      return;
    }
    anim = layer.animate(
      [
        { ...frame(from), opacity, filter: `blur(${blur}px)` },
        { ...frame(drift(from, side, roomOf(list))), opacity: 0, filter: `blur(${HOVER_BLUR}px)` },
      ],
      timing,
    );
  };

  // The side the pointer crossed the list's edge by, `entering` or leaving.
  // The event comes at its arrival, which after a quick move can be well
  // inside (or well outside) the edge, so the crossing is found by walking
  // the move back to where it began; with no move to go by, it is the
  // nearest side.
  const sideOf = (event: PointerEvent, entering: boolean): Side => {
    const r = list.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY;
    const dx = event.movementX || 0;
    const dy = event.movementY || 0;
    if (dx || dy) {
      const x0 = x - dx;
      const y0 = y - dy;
      // When each edge was crossed along the move (0 = began, 1 = arrived).
      const crossed: [Side, number][] = [];
      if (dx > 0 && x0 < r.left && x >= r.left) crossed.push(["left", (r.left - x0) / dx]);
      if (dx < 0 && x0 > r.right && x <= r.right) crossed.push(["right", (r.right - x0) / dx]);
      if (dy > 0 && y0 < r.top && y >= r.top) crossed.push(["top", (r.top - y0) / dy]);
      if (dy < 0 && y0 > r.bottom && y <= r.bottom) crossed.push(["bottom", (r.bottom - y0) / dy]);
      if (dx < 0 && x0 >= r.left && x < r.left) crossed.push(["left", (r.left - x0) / dx]);
      if (dx > 0 && x0 <= r.right && x > r.right) crossed.push(["right", (r.right - x0) / dx]);
      if (dy < 0 && y0 >= r.top && y < r.top) crossed.push(["top", (r.top - y0) / dy]);
      if (dy > 0 && y0 <= r.bottom && y > r.bottom) crossed.push(["bottom", (r.bottom - y0) / dy]);
      // Coming in, the last edge crossed is the one that let it inside;
      // going out, the first is the one that let it out.
      const found = crossed.sort((a, b) => (entering ? b[1] - a[1] : a[1] - b[1]))[0];
      if (found) return found[0];
    }
    const d: [Side, number][] = [
      ["top", y - r.top],
      ["bottom", r.bottom - y],
      ["left", x - r.left],
      ["right", r.right - x],
    ];
    // Outside the list the distance to the side it left by is the negative
    // one, so the nearest side is the side of exit.
    return d.reduce((a, b) => (b[1] < a[1] ? b : a))[0];
  };

  const focusedRow = () => {
    const focused = list.matches(":focus-visible")
      ? list
      : list.querySelector<HTMLElement>(":focus-visible");
    return focused && rowOf(focused) ? rowOf(focused) : null;
  };

  const onOver = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    // A pointerover from outside the list is the pointer coming in: the side
    // it came by, however far the first row is from it.
    if (!visible && !list.contains(event.relatedTarget as Node | null)) entry = sideOf(event, true);
    const row = rowOf(event.target);
    if (row) {
      place(row);
      return;
    }
    // Over the list but not a row (a gap, a heading, a control that is no
    // row's): the layer lets go, unless a row comes next, a moment later.
    if (visible && !focusedRow()) {
      clearTimeout(gap);
      gap = setTimeout(hide, options.gap ?? GAP_MS);
    }
  };
  // A pointer still moving through the space between rows keeps the layer
  // waiting for the next row (the wait restarts at every move), so it glides
  // from row to row however slowly the hand crosses the gap.
  const onMove = (event: PointerEvent) => {
    if (event.pointerType === "touch" || !visible || rowOf(event.target) || focusedRow()) return;
    const { clientX: x, clientY: y } = event;
    const candidates = options.whole ? [list] : [...list.querySelectorAll<HTMLElement>(rows)];
    const near = candidates.some((row) => {
      const r = row.getBoundingClientRect();
      const dx = Math.max(r.left - x, 0, x - r.right);
      const dy = Math.max(r.top - y, 0, y - r.bottom);
      return Math.hypot(dx, dy) <= GAP_REACH;
    });
    if (near) {
      clearTimeout(gap);
      gap = setTimeout(hide, Math.max(options.gap ?? GAP_MS, CROSSING_MS));
    }
  };
  const onLeave = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    entry = null;
    const focused = focusedRow();
    if (focused) place(focused);
    else hide(sideOf(event, false));
  };
  const onFocusIn = (event: FocusEvent) => {
    const row = rowOf(event.target);
    if (row?.matches(":focus-visible")) place(row);
  };
  const onFocusOut = (event: FocusEvent) => {
    if (!list.contains(event.relatedTarget as Node | null)) hide();
  };

  list.addEventListener("pointerover", onOver);
  list.addEventListener("pointermove", onMove);
  list.addEventListener("pointerleave", onLeave);
  list.addEventListener("focusin", onFocusIn);
  list.addEventListener("focusout", onFocusOut);
  return {
    show: (row) => (row ? place(row) : hide()),
    follow: () => {
      if (!visible || !on?.isConnected || !at) return;
      const to = boxOf(on, list);
      if (to.x === at.x && to.y === at.y && to.w === at.w && to.h === at.h) return;
      anim?.cancel();
      anim = null;
      paint(layer, to);
      layer.style.opacity = "1";
      at = to;
    },
    stop: () => {
      clearTimeout(gap);
      list.removeEventListener("pointerover", onOver);
      list.removeEventListener("pointermove", onMove);
      list.removeEventListener("pointerleave", onLeave);
      list.removeEventListener("focusin", onFocusIn);
      list.removeEventListener("focusout", onFocusOut);
      anim?.cancel();
      layer.remove();
      delete list.dataset.hoverGlide;
    },
  };
}

/** {@link glideRows}, for what only needs the pointer and focus: returns its
 * cleanup, so a Solid `ref` is `(el) => onCleanup(hoverGlide(el, rows))`. */
export function hoverGlide(list: HTMLElement, rows = DEFAULT_ROWS): () => void {
  return glideRows(list, rows).stop;
}

/** A group of adjacent buttons (a pane toolbar, a stepper): one layer glides
 * between them, and the buttons paint no hover of their own (`.glide-group`,
 * styles.css). Returns its cleanup. */
export function hoverGroup(
  group: HTMLElement,
  rows = DEFAULT_ROWS,
  options: RowGlideOptions = {},
): () => void {
  group.classList.add("glide-list", "glide-group");
  const glide = glideRows(group, rows, options);
  return () => {
    glide.stop();
    group.classList.remove("glide-list", "glide-group");
  };
}

/** A lone button's hover highlight: the layer sits in the button and enters
 * from the side the pointer came by (`.glide-self`, styles.css). Returns its
 * cleanup: `ref={(el) => onCleanup(hoverButton(el))}`. */
export function hoverButton(button: HTMLElement): () => void {
  button.classList.add("glide-self");
  const glide = glideRows(button, DEFAULT_ROWS, { whole: true });
  return () => {
    glide.stop();
    button.classList.remove("glide-self");
  };
}
