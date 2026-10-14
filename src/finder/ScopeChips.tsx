import { batch, createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { HymnbookId } from "../domain/types.ts";
import { placeMenu } from "../shell/menuPlacement.ts";
import type { ScopeMode } from "./sources.ts";

/** Where the Popover API is missing, the checklist is fixed in place, not in the top layer. */
const topLayer = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;

export interface ScopeChipsProps {
  /** The books held, in the Library's order. */
  books: readonly { key: HymnbookId; title: string }[];
  /** What is pressed, and the books it covers (`undefined`: every book). */
  mode: ScopeMode;
  keys: readonly HymnbookId[] | undefined;
  /** Whether there is a current book to search alone. */
  canThis: boolean;
  onAll: () => void;
  onThis: () => void;
  onBooks: (keys: HymnbookId[]) => void;
}

/** What a chip of chosen books says: a count, never a title (a title can fill a phone's line). */
export const booksLabel = (count: number) => `${count} ${count === 1 ? "Book" : "Books"}`;

/**
 * The Finder's scope chips (SDD-0001 §13.4): All Books, This Book and Books…, one pressed at
 * a time. Books… opens a checklist; Done applies it, and none checked cannot be applied.
 * Tab reaches the row at the pressed chip, the arrow keys move along it.
 */
export function ScopeChips(props: ScopeChipsProps) {
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal<ReadonlySet<HymnbookId>>(new Set());
  const [above, setAbove] = createSignal(false);
  let group: HTMLFieldSetElement | undefined;
  let booksChip: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;

  const chips = () => [...(group?.querySelectorAll<HTMLButtonElement>(".scope-chip") ?? [])];
  const onRowKey = (event: KeyboardEvent) => {
    const all = chips();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const target =
      event.key === "ArrowRight"
        ? all[(at + 1) % all.length]
        : event.key === "ArrowLeft"
          ? all[(at - 1 + all.length) % all.length]
          : event.key === "Home"
            ? all[0]
            : event.key === "End"
              ? all[all.length - 1]
              : undefined;
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) booksChip?.focus();
  };
  const apply = () => {
    const keys = props.books.map((book) => book.key).filter((key) => draft().has(key));
    if (keys.length === 0) return;
    batch(() => {
      setOpen(false);
      props.onBooks(keys);
    });
    booksChip?.focus();
  };
  const toggle = () => {
    if (open()) return close(true);
    // The draft starts from the chosen books, or from none.
    setDraft(new Set(props.mode === "books" ? (props.keys ?? []) : []));
    setOpen(true);
  };

  createEffect(() => {
    if (!open()) return;
    queueMicrotask(() => {
      if (!panel || !booksChip) return;
      if (typeof panel.showPopover === "function") panel.showPopover();
      const place = placeMenu({
        trigger: booksChip.getBoundingClientRect(),
        // The layout size, not the drawn one: it opens with a scale, which a rect would carry.
        menu: {
          w: panel.offsetWidth,
          h: panel.scrollHeight + (panel.offsetHeight - panel.clientHeight),
        },
        viewport: { w: window.innerWidth, h: window.innerHeight },
        align: "start",
      });
      panel.style.top = `${place.top}px`;
      panel.style.left = `${place.left}px`;
      panel.style.maxHeight = place.maxHeight === undefined ? "" : `${place.maxHeight}px`;
      setAbove(place.above);
      panel.querySelector<HTMLElement>("input, button")?.focus();
    });
    // Fixed in the top layer, it would stay behind if its container scrolled.
    const onScroll = (event: Event) => {
      if (!panel?.contains(event.target as Node)) close(false);
    };
    const onResize = () => close(false);
    const onPointerDown = (event: PointerEvent) => {
      const at = event.target as Node;
      if (!panel?.contains(at) && !booksChip?.contains(at)) close(false);
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("pointerdown", onPointerDown);
    });
  });

  const onPanelKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      // Not the sheet's Escape: this closes the checklist alone.
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab" && panel) {
      // Focus stays in the checklist until it closes.
      const inside = [...panel.querySelectorAll<HTMLElement>("input, button:enabled")];
      const first = inside[0];
      const last = inside[inside.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };

  // Pointer presses keep focus in the field, as choosing a row does.
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  const tab = (pressed: boolean) => (pressed ? 0 : -1);

  return (
    <fieldset class="scope-chips" ref={group} onKeyDown={onRowKey} data-keep-motion="">
      <legend class="visually-hidden">Search in</legend>
      <button
        type="button"
        class="chip-filter scope-chip"
        aria-pressed={props.mode === "all"}
        tabindex={tab(props.mode === "all")}
        onMouseDown={keepFocus}
        onClick={() => props.onAll()}
      >
        <span class="scope-chip-check icon icon-check" aria-hidden="true" />
        All Books
      </button>
      <Show when={props.canThis}>
        <button
          type="button"
          class="chip-filter scope-chip"
          aria-pressed={props.mode === "this"}
          tabindex={tab(props.mode === "this")}
          onMouseDown={keepFocus}
          onClick={() => props.onThis()}
        >
          <span class="scope-chip-check icon icon-check" aria-hidden="true" />
          This Book
        </button>
      </Show>
      <button
        type="button"
        class="chip-filter scope-chip"
        aria-pressed={props.mode === "books"}
        aria-haspopup="dialog"
        aria-expanded={open()}
        tabindex={tab(props.mode === "books")}
        ref={booksChip}
        onClick={toggle}
      >
        <span class="scope-chip-check icon icon-check" aria-hidden="true" />
        {props.mode === "books" ? booksLabel(props.keys?.length ?? 0) : "Books…"}
      </button>
      <Show when={open()}>
        <div
          class="menu-popover scope-checklist"
          classList={{ "menu-popover-above": above() }}
          popover={topLayer ? "manual" : undefined}
          role="dialog"
          aria-label="Search these books"
          ref={panel}
          onKeyDown={onPanelKey}
        >
          <div class="scope-checklist-books">
            <For each={props.books}>
              {(book) => (
                <label class="scope-check">
                  <input
                    type="checkbox"
                    checked={draft().has(book.key)}
                    onChange={(event) =>
                      setDraft((was) => {
                        const next = new Set(was);
                        if (event.currentTarget.checked) next.add(book.key);
                        else next.delete(book.key);
                        return next;
                      })
                    }
                  />
                  <span class="scope-check-title">{book.title}</span>
                </label>
              )}
            </For>
          </div>
          <div class="scope-checklist-actions">
            <button type="button" class="btn-text" disabled={draft().size === 0} onClick={apply}>
              Done
            </button>
          </div>
        </div>
      </Show>
    </fieldset>
  );
}
