import { createEffect, type JSX, onCleanup } from "solid-js";
import { type GlideList, glideList } from "./glideList.ts";
import { placeMenu } from "./menuPlacement.ts";

export interface PickListProps {
  id: string;
  /** The listbox's accessible name. */
  label: string;
  /** The field's box, which the list is placed from and kept inside the card of. */
  box: () => HTMLElement | undefined;
  /** Read in an effect: whatever changes the rows or the active one (the highlight and place follow). */
  track?: () => unknown;
  /** The list element, for scrolling the active row into view. */
  listRef?: (el: HTMLDivElement) => void;
  children: JSX.Element;
}

/**
 * The list of a picker (the language list, Add to): a popover in the top
 * layer, placed from the field's rect like the app's menus, so it floats over
 * the sheet and never changes its size or adds a scrollbar. Kept 16px inside
 * the sheet's card, flipped above the field when there is no room below, with
 * a soft fade at an edge while more scrolls that way. The rows are
 * `.pick-row`; the active one is `aria-selected="true"` (the hover highlight
 * glides to it) and the current one carries `data-current` (the tonal pill).
 */
export function PickList(props: PickListProps) {
  let list: HTMLDivElement | undefined;
  let glide: GlideList | undefined;

  // The highlight is Enter's target, as well as the pointer's: the one layer
  // follows the active row, so the arrow keys and typing move it too.
  createEffect(() => {
    props.track?.();
    // After the rows have settled: a microtask on, the DOM is what to mark.
    queueMicrotask(() =>
      glide?.hover.show(
        list?.querySelector<HTMLElement>('.pick-row[aria-selected="true"]') ?? null,
      ),
    );
  });

  // Under the field, or above it when there is no room below; scrolls inside
  // its own max-height. Repositioned as the rows change and as the page moves.
  const place = () => {
    const box = props.box();
    if (!list || !box) return;
    list.style.maxHeight = "";
    const at = box.getBoundingClientRect();
    const own = list.getBoundingClientRect();
    // Floating in the top layer, but kept inside the sheet's card: its room ends a margin short of
    // the card's edges (the page's, where there is no card), so it never runs past the card.
    const card = box.closest("dialog")?.getBoundingClientRect();
    const top = card ? card.top : 0;
    const spot = placeMenu({
      trigger: { left: at.left, right: at.right, top: at.top - top, bottom: at.bottom - top },
      menu: { w: at.width, h: list.scrollHeight + (own.height - list.clientHeight) },
      viewport: { w: window.innerWidth, h: card ? card.height : window.innerHeight },
      align: "start",
      margin: card ? 16 : 8,
    });
    spot.top += top;
    list.style.width = `${at.width}px`;
    list.style.top = `${spot.top}px`;
    list.style.left = `${spot.left}px`;
    if (spot.maxHeight !== undefined) list.style.maxHeight = `${spot.maxHeight}px`;
    list.classList.toggle("pick-list-above", spot.above);
    fade();
  };
  // A soft fade at an edge only while there is more to scroll that way.
  const fade = () => {
    if (!list) return;
    const above = list.scrollTop > 1;
    const below = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
    list.dataset.fade = above && below ? "both" : above ? "top" : below ? "bottom" : "none";
  };
  createEffect(() => {
    props.track?.();
    queueMicrotask(place);
    const again = () => place();
    document.addEventListener("scroll", again, true);
    window.addEventListener("resize", again);
    onCleanup(() => {
      document.removeEventListener("scroll", again, true);
      window.removeEventListener("resize", again);
    });
  });

  return (
    <div
      class="pick-list"
      id={props.id}
      role="listbox"
      aria-label={props.label}
      popover={"showPopover" in HTMLElement.prototype ? "manual" : undefined}
      onScroll={fade}
      ref={(el) => {
        list = el;
        props.listRef?.(el);
        queueMicrotask(() => {
          if (typeof el.showPopover === "function" && el.isConnected) el.showPopover();
          place();
        });
        glide = glideList(el, { rows: ".pick-row", current: ".pick-row[data-current]" });
        onCleanup(glide.stop);
      }}
    >
      {props.children}
    </div>
  );
}
