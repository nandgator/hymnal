export interface Size {
  w: number;
  h: number;
}
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MenuPlacement {
  top: number;
  left: number;
  /** Set when the menu is taller than the room on its side: it scrolls. */
  maxHeight?: number;
  /** Opens above the trigger (transform-origin at the bottom). */
  above: boolean;
}

/**
 * Where a menu in the top layer goes, from the trigger's rect: under it, or
 * above it when there isn't room below and there is more above. Aligned to
 * the trigger's start or end edge, kept `margin` inside the viewport. Pure.
 */
export function placeMenu(input: {
  trigger: Rect;
  menu: Size;
  viewport: Size;
  align: "start" | "end";
  gap?: number;
  margin?: number;
}): MenuPlacement {
  const { trigger, menu, viewport, align, gap = 4, margin = 8 } = input;
  const below = viewport.h - trigger.bottom - gap - margin;
  const aboveRoom = trigger.top - gap - margin;
  const above = menu.h > below && aboveRoom > below;
  const room = above ? aboveRoom : below;
  const height = Math.min(menu.h, Math.max(room, 0));
  const top = above ? trigger.top - gap - height : trigger.bottom + gap;
  const wanted = align === "end" ? trigger.right - menu.w : trigger.left;
  const left = Math.max(margin, Math.min(wanted, viewport.w - margin - menu.w));
  return { top, left, above, ...(menu.h > room ? { maxHeight: Math.max(room, 0) } : {}) };
}
