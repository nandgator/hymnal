import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";

export interface MenuItem {
  label: string;
  run: () => void;
  disabled?: boolean;
  /** A second line, e.g. why an item is disabled. */
  supporting?: string;
  /** Icon classes, for when a lone item folds into its own button. */
  icon?: string;
}

export interface MenuProps {
  /** The button's accessible name, e.g. "This hymn options". */
  label: string;
  items: MenuItem[];
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
      when={props.items.length === 1 ? props.items[0] : undefined}
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

function MenuList(props: MenuProps) {
  const [open, setOpen] = createSignal(false);
  // Opens under the button's end, leftwards; flips to open rightwards when
  // that would cross the scrolling pane's edge (the first area's menu).
  const [flip, setFlip] = createSignal(false);
  let wrapper: HTMLDivElement | undefined;
  let button: HTMLButtonElement | undefined;
  let list: HTMLDivElement | undefined;

  const items = () => [...(list?.querySelectorAll<HTMLButtonElement>("button:enabled") ?? [])];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button?.focus();
  };

  createEffect(() => {
    if (!open()) return;
    setFlip(false);
    queueMicrotask(() => {
      const edge = list?.closest(".shell-main")?.getBoundingClientRect().left ?? 0;
      if (list && list.getBoundingClientRect().left < edge + 8) setFlip(true);
      items()[0]?.focus();
    });
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => document.removeEventListener("pointerdown", onPointerDown));
  });

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
      <Show when={open()}>
        <div
          class="menu-popover"
          classList={{ "menu-popover-start": flip() }}
          role="menu"
          aria-label={props.label}
          ref={list}
          onKeyDown={onKeyDown}
        >
          <For each={props.items}>
            {(item) => (
              <button
                type="button"
                role="menuitem"
                class="menu-popover-item"
                disabled={item.disabled}
                onClick={() => {
                  close(true);
                  item.run();
                }}
              >
                {item.label}
                <Show when={item.supporting}>
                  <span class="menu-popover-supporting">{item.supporting}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
