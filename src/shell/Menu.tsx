import { batch, createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { glideList } from "./glideList.ts";
import { KeyCombo } from "./KeyCombo.tsx";
import { placeMenu } from "./menuPlacement.ts";

export interface MenuItem {
  label: string;
  run: () => void;
  disabled?: boolean;
  /** A second line, e.g. why an item is disabled. */
  supporting?: string;
  /** Icon classes, for when a lone item folds into its own button. */
  icon?: string;
  /** The item's key, e.g. "Shift+E", shown at the row's end. */
  hint?: string;
  /** The chosen one of a choice menu: marked with a check, and focused on open. */
  current?: boolean;
}

export interface MenuProps {
  /** The button's accessible name, e.g. "This song options". */
  label: string;
  items: MenuItem[];
  /** A lone item becomes its own button (the default). False keeps the list, so a
   * row's menu looks the same whether it holds one item or several. */
  fold?: boolean;
  /** A choice menu (a select, in the app's own dress): the trigger is a button
   * showing this, the chosen item's text, and the items are radio items. */
  choice?: string;
  /** The choice button's id, so a label can point at it. */
  id?: string;
}

/**
 * An MD3 menu from an icon button (DESIGN.md § Structure: an area's header
 * holds at most one or two icon actions). Arrow keys move between items,
 * Escape and a click outside close it, and focus returns to the button.
 * While it's open the Operator's shortcuts stand down (`ignoresShortcuts`),
 * so an arrow key never moves the Output. A menu of one item folds away:
 * the item is the button (as VS Code's and Zed's pane toolbars show a lone
 * action directly, keeping ⋯ for more).
 */
export function Menu(props: MenuProps) {
  return (
    <Show
      when={
        props.items.length === 1 && props.fold !== false && props.choice === undefined
          ? props.items[0]
          : undefined
      }
      fallback={<MenuList {...props} />}
    >
      {(item) => (
        <button
          type="button"
          class="icon-button menu-button"
          aria-label={item().label}
          title={item().label}
          disabled={item().disabled}
          onClick={() => item().run()}
        >
          <span class={`icon ${item().icon ?? "icon-more-horiz"}`} aria-hidden="true" />
        </button>
      )}
    </Show>
  );
}

/** Where the Popover API is missing, the menu is fixed in place, not in the top layer. */
const topLayer = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

function MenuList(props: MenuProps) {
  let list: HTMLDivElement | undefined;
  const [isOpen, setIsOpen] = createSignal(false);
  const open = isOpen;
  // The menu stays mounted through its exit (the entrance, played back) and
  // takes no clicks meanwhile; with no animation support it goes at once.
  // `closing` is set in the same batch as the close, so the Show below never
  // sees a moment with neither.
  const [closing, setClosing] = createSignal(false);
  const setOpen = (next: boolean | ((was: boolean) => boolean)) => {
    batch(() => {
      const to = typeof next === "function" ? next(isOpen()) : next;
      const el = list;
      if (to) setClosing(false);
      else if (isOpen() && el && typeof el.getAnimations === "function") setClosing(true);
      setIsOpen(to);
    });
    if (!isOpen() && closing()) {
      const el = list;
      queueMicrotask(() => {
        const running = el?.getAnimations() ?? [];
        if (running.length === 0) setClosing(false);
        else
          void Promise.allSettled(running.map((a) => a.finished)).then(() => {
            if (!isOpen()) setClosing(false);
          });
      });
    }
  };
  // The popover is in the top layer, placed from the trigger's rect (never
  // clipped by a scrolling ancestor): under it, or above when there is no
  // room below. A choice menu lines up with the trigger's start, the rest
  // with its end.
  const [above, setAbove] = createSignal(false);
  let wrapper: HTMLDivElement | undefined;
  let button: HTMLButtonElement | undefined;

  const items = () => [...(list?.querySelectorAll<HTMLButtonElement>("button:enabled") ?? [])];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button?.focus();
  };

  const onResize = () => close(false);

  createEffect(() => {
    if (!open()) return;
    queueMicrotask(() => {
      if (!list || !button) return;
      if (typeof list.showPopover === "function") list.showPopover();
      const box = list.getBoundingClientRect();
      const place = placeMenu({
        trigger: button.getBoundingClientRect(),
        menu: { w: box.width, h: list.scrollHeight + (box.height - list.clientHeight) },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        align: props.choice === undefined ? "end" : "start",
      });
      list.style.top = `${place.top}px`;
      list.style.left = `${place.left}px`;
      list.style.maxHeight = place.maxHeight === undefined ? "" : `${place.maxHeight}px`;
      setAbove(place.above);
      (items().find((el) => el.getAttribute("aria-checked") === "true") ?? items()[0])?.focus();
    });
    // Fixed in the top layer, it would stay behind if its container scrolled.
    const onScroll = (event: Event) => {
      if (!list?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    onCleanup(() => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    });
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown));
  });

  const onButtonKeyDown = (event: KeyboardEvent) => {
    if (open() || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      all[(at + step + all.length) % all.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      all[event.key === "Home" ? 0 : all.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <div class="menu-anchor" ref={wrapper}>
      <Show
        when={props.choice !== undefined}
        fallback={
          <button
            type="button"
            class="icon-button menu-button"
            aria-label={props.label}
            aria-haspopup="menu"
            aria-expanded={open()}
            ref={button}
            onClick={() => setOpen((was) => !was)}
          >
            <span class="icon icon-more-horiz" aria-hidden="true" />
          </button>
        }
      >
        <button
          type="button"
          id={props.id}
          class="menu-select"
          aria-label={`${props.label}: ${props.choice}`}
          aria-haspopup="menu"
          aria-expanded={open()}
          ref={button}
          onClick={() => setOpen((was) => !was)}
          onKeyDown={onButtonKeyDown}
        >
          <span class="menu-select-text">{props.choice}</span>
          <span class="icon icon-expand" aria-hidden="true" />
        </button>
      </Show>
      <Show when={open() || closing()}>
        <div
          class="menu-popover"
          data-closing={closing() && !open() ? "" : undefined}
          popover={topLayer ? "manual" : undefined}
          classList={{
            "menu-popover-above": above(),
            "menu-popover-choice": props.choice !== undefined,
          }}
          role="menu"
          aria-label={props.label}
          ref={(el) => {
            list = el;
            // The chosen item of a choice menu is the tonal pill; every menu
            // has the hover highlight.
            onCleanup(
              glideList(el, {
                current: props.choice === undefined ? undefined : '[aria-checked="true"]',
              }).stop,
            );
          }}
          onKeyDown={onKeyDown}
        >
          <For each={props.items}>
            {(item) => (
              <button
                type="button"
                {...(props.choice === undefined
                  ? { role: "menuitem" }
                  : { role: "menuitemradio", "aria-checked": !!item.current })}
                class="menu-popover-item"
                classList={{ "menu-popover-current": item.current }}
                disabled={item.disabled}
                onClick={() => {
                  close(true);
                  item.run();
                }}
              >
                <span class="menu-popover-label">
                  {item.label}
                  <Show when={item.supporting}>
                    <span class="menu-popover-supporting">{item.supporting}</span>
                  </Show>
                </span>
                <Show when={item.hint}>
                  <KeyCombo class="menu-popover-key" keys={item.hint ?? ""} decorative />
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
