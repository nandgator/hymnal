import { createEffect, type JSX, onCleanup } from "solid-js";
import { type GlideList, glideList } from "./glideList.ts";
import { placeMenu } from "./menuPlacement.ts";

/**
 * With more rows than this a picker has a filter field above them: six rows of 48px fill the
 * menu's 20rem without one, a seventh would scroll. One rule for every PickList.
 */
export const FILTER_FROM = 6;

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
  /** A field fixed above the rows (a filter): the list is then a frame, and only the rows scroll. */
  head?: JSX.Element;
  /** The least width of the list, in px, where the box is narrower (a chip). Kept inside the card. */
  minWidth?: number;
  /** What marks the active row, for the highlight (default `aria-selected="true"`). */
  active?: string;
  /** Makes the listbox itself focusable (no field drives it) and gives it its keys. */
  onKeyDown?: (event: KeyboardEvent) => void;
  /** The listbox accepts more than one chosen row. */
  multiselectable?: boolean;
  children: JSX.Element;
}

/**
 * The list of a picker (the language list, Add to, the Finder's books): an MD3 menu, a popover in
 * the top layer anchored to the field's rect like the app's menus, so it floats over the sheet
 * and never changes its size or adds a scrollbar. Nothing dims or blurs behind it. Kept 16px
 * inside the sheet's card, flipped above the field when there is no room below, with a fade at an
 * edge while more scrolls that way (scrollFade.ts). The rows are `.pick-row`, 48px; the active
 * one is `aria-selected="true"` (the hover highlight glides to it) and the current one carries
 * `data-current` (the tonal pill) and a check. The pickers close it when focus leaves; it keeps
 * to its field while the field settles (a chip's check sliding in).
 */
export function PickList(props: PickListProps) {
  // The popover; with a `head` it is a frame, and `rows` (the listbox) is the scroller inside it.
  let list: HTMLDivElement | undefined;
  let rows: HTMLDivElement | undefined;
  let glide: GlideList | undefined;

  // The highlight is Enter's target, as well as the pointer's: the one layer
  // follows the active row, so the arrow keys and typing move it too.
  createEffect(() => {
    props.track?.();
    // After the rows have settled: a microtask on, the DOM is what to mark.
    queueMicrotask(() =>
      glide?.hover.show(
        rows?.querySelector<HTMLElement>(props.active ?? '.pick-row[aria-selected="true"]') ?? null,
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
    const room = (card ? card.width : window.innerWidth) - (card ? 32 : 16);
    const width = Math.min(Math.max(at.width, props.minWidth ?? 0), Math.max(room, at.width));
    const spot = placeMenu({
      trigger: { left: at.left, right: at.right, top: at.top - top, bottom: at.bottom - top },
      menu: { w: width, h: list.scrollHeight + (own.height - list.clientHeight) },
      viewport: { w: window.innerWidth, h: card ? card.height : window.innerHeight },
      align: "start",
      margin: card ? 16 : 8,
    });
    spot.top += top;
    list.style.width = `${width}px`;
    list.style.top = `${spot.top}px`;
    list.style.left = `${spot.left}px`;
    if (spot.maxHeight !== undefined) list.style.maxHeight = `${spot.maxHeight}px`;
    list.classList.toggle("pick-list-above", spot.above);
  };
  createEffect(() => {
    props.track?.();
    queueMicrotask(place);
  });
  // The field can move after the list is placed with nothing here changing: a sibling chip's
  // check slides in or out (a transition) and shifts it, and the next row the pointer touched
  // placed the list again, 26px over. The list keeps to the field, frame by frame while a
  // transition runs elsewhere on the page, and once more when it ends.
  createEffect(() => {
    let frame = 0;
    const running = () =>
      typeof document.getAnimations === "function" &&
      typeof CSSTransition !== "undefined" &&
      document
        .getAnimations()
        .some(
          (a) =>
            a instanceof CSSTransition &&
            a.playState === "running" &&
            !list?.contains((a.effect as KeyframeEffect | null)?.target ?? null),
        );
    const follow = () => {
      frame = 0;
      place();
      if (running()) frame = requestAnimationFrame(follow);
    };
    const start = () => {
      if (frame === 0) frame = requestAnimationFrame(follow);
    };
    const again = () => place();
    document.addEventListener("scroll", again, true);
    window.addEventListener("resize", again);
    document.addEventListener("transitionrun", start, true);
    document.addEventListener("transitionend", again, true);
    document.addEventListener("transitioncancel", again, true);
    start();
    onCleanup(() => {
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", again, true);
      window.removeEventListener("resize", again);
      document.removeEventListener("transitionrun", start, true);
      document.removeEventListener("transitionend", again, true);
      document.removeEventListener("transitioncancel", again, true);
    });
  });

  const framed = props.head !== undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys belong to the listbox role when it is this element
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is set only when this element is the listbox
    <div
      class="pick-list"
      classList={{ "pick-list-framed": framed }}
      id={framed ? undefined : props.id}
      role={framed ? undefined : "listbox"}
      aria-label={framed ? undefined : props.label}
      aria-multiselectable={!framed && props.multiselectable ? "true" : undefined}
      tabindex={!framed && props.onKeyDown ? 0 : undefined}
      onKeyDown={framed ? undefined : props.onKeyDown}
      popover={"showPopover" in HTMLElement.prototype ? "manual" : undefined}
      ref={(el) => {
        list = el;
        rows = framed ? (el.querySelector<HTMLDivElement>(".pick-scroll") ?? el) : el;
        props.listRef?.(rows);
        queueMicrotask(() => {
          if (typeof el.showPopover === "function" && el.isConnected) el.showPopover();
          place();
        });
        glide = glideList(rows, { rows: ".pick-row", current: ".pick-row[data-current]" });
        onCleanup(glide.stop);
      }}
    >
      {framed ? (
        <>
          <div class="pick-head">{props.head}</div>
          <div
            class="pick-scroll"
            id={props.id}
            role="listbox"
            aria-label={props.label}
            aria-multiselectable={props.multiselectable ? "true" : undefined}
            tabindex={props.onKeyDown ? 0 : undefined}
            onKeyDown={props.onKeyDown}
          >
            {props.children}
          </div>
        </>
      ) : (
        props.children
      )}
    </div>
  );
}
