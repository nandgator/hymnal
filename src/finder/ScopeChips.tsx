import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { HymnbookId } from "../domain/types.ts";
import { ClearSearch } from "../shell/ClearSearch.tsx";
import { SEARCH_MAX } from "../shell/limits.ts";
import { fold } from "../shell/matchText.ts";
import { PickList } from "../shell/PickList.tsx";
import type { ScopeMode } from "./sources.ts";

/** With more books than this the list has a filter field above it. */
export const FILTER_FROM = 6;

export interface ScopeChipsProps {
  /** The books held, in the Library's order. */
  books: readonly { key: HymnbookId; title: string }[];
  /** What is pressed, and the books it covers (`undefined`: every book). */
  mode: ScopeMode;
  keys: readonly HymnbookId[] | undefined;
  /** Whether there is a current book to search alone. */
  canThis: boolean;
  /** The set the chip returns to when This Book is left: every book, or these. */
  restore: { mode: "all" } | { mode: "books"; keys: readonly HymnbookId[] };
  onAll: () => void;
  onThis: () => void;
  onBooks: (keys: HymnbookId[]) => void;
}

/** What a chip of chosen books says: a count, never a title (a title can fill a phone's line). */
export const booksLabel = (count: number) => `${count} ${count === 1 ? "Book" : "Books"}`;

let instances = 0;

/**
 * The Finder's scope chips (SDD-0001 §13.4): This Book, and one chip for the set of books
 * searched, "All Books" or "N Books" (a chevron after the label). The set chip opens a PickList of
 * the held books, a multi-select listbox (`aria-multiselectable`, `aria-selected` on the ticked
 * rows): every book is ticked in All Books; a tap toggles one and applies at once; ticking all again
 * is All Books; the last ticked row is `aria-disabled`, so none is never a state. One tap on the
 * chip while This Book is pressed returns to the set and opens the list too (one target, large
 * on a phone, rather than a label and a small chevron to aim at). Over six books a filter field
 * heads the list (a combobox, so Space types there); otherwise the listbox itself takes the keys,
 * Space included. Tab reaches the pressed chip, the arrow keys move along the row.
 */
export function ScopeChips(props: ScopeChipsProps) {
  const uid = `scope-books-${++instances}`;
  const [open, setOpen] = createSignal(false);
  const [filter, setFilter] = createSignal("");
  const [active, setActive] = createSignal(0);
  let group: HTMLFieldSetElement | undefined;
  let booksChip: HTMLButtonElement | undefined;
  const [listEl, setListEl] = createSignal<HTMLDivElement>();
  const list = listEl;
  let field: HTMLInputElement | undefined;

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

  /** The ticked books: every one in All Books, the chosen ones, or (This Book pressed) the set to return to. */
  const chosen = createMemo(() => {
    const all = props.books.map((book) => book.key);
    const keys =
      props.mode === "books"
        ? props.keys
        : props.mode === "this" && props.restore.mode === "books" && props.restore.keys.length > 0
          ? props.restore.keys
          : undefined;
    return new Set<HymnbookId>(keys ?? all);
  });
  const filtering = () => props.books.length > FILTER_FROM;
  /** The rows: every book, or those whose title has every word typed. */
  const shown = createMemo(() => {
    const words = fold(filter()).split(/\s+/).filter(Boolean);
    if (words.length === 0) return props.books;
    return props.books.filter((book) => {
      const title = fold(book.title);
      return words.every((word) => title.includes(word));
    });
  });
  const optionId = (key: HymnbookId) => `${uid}-opt-${key}`;
  const activeId = () => {
    const book = shown()[active()];
    return book ? optionId(book.key) : undefined;
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    setFilter("");
    if (refocus) booksChip?.focus();
  };
  const toggleOpen = () => {
    if (open()) return close(true);
    // Leaving This Book: the set it came from is searched again, then the list shows it.
    if (props.mode === "this") {
      if (props.restore.mode === "books" && props.restore.keys.length > 0)
        props.onBooks([...props.restore.keys]);
      else props.onAll();
    }
    const first = props.books.findIndex((book) => chosen().has(book.key));
    setActive(Math.max(0, first));
    setOpen(true);
  };
  /** The one ticked book cannot be unticked: there is no empty scope. */
  const locked = (key: HymnbookId) => chosen().size === 1 && chosen().has(key);
  /** A book ticked or unticked, applied at once; every book ticked is All Books. */
  const toggleBook = (key: HymnbookId) => {
    if (locked(key)) return;
    const next = new Set(chosen());
    if (!next.delete(key)) next.add(key);
    const keys = props.books.map((book) => book.key).filter((k) => next.has(k));
    if (keys.length === props.books.length) props.onAll();
    else props.onBooks(keys);
  };
  const move = (to: number) => {
    const last = shown().length - 1;
    if (last < 0) return;
    setActive(Math.max(0, Math.min(last, to)));
    queueMicrotask(() =>
      list()?.querySelector("[data-active]")?.scrollIntoView?.({ block: "nearest" }),
    );
  };
  const onListKey = (event: KeyboardEvent) => {
    const typing = event.currentTarget === field;
    if (event.key === "Escape") {
      // Not the sheet's Escape: this closes the list alone.
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(active() + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(active() - 1);
    } else if (!typing && event.key === "Home") {
      event.preventDefault();
      move(0);
    } else if (!typing && event.key === "End") {
      event.preventDefault();
      move(shown().length - 1);
    } else if (event.key === "Enter" || (!typing && event.key === " ")) {
      // Enter in the filter must not submit the Finder's form behind.
      event.preventDefault();
      const book = shown()[active()];
      if (book) toggleBook(book.key);
    }
  };

  // The list is up: focus goes to its filter, or to the list itself, once it is shown.
  createEffect(() => {
    if (!open()) return;
    queueMicrotask(() => queueMicrotask(() => (field ?? list())?.focus({ preventScroll: true })));
  });
  // Without a filter the listbox has the focus, and names its active row.
  createEffect(() => {
    const id = activeId();
    const el = list();
    if (!el || filtering()) return;
    if (id) el.setAttribute("aria-activedescendant", id);
    else el.removeAttribute("aria-activedescendant");
  });

  // Pointer presses keep focus in the field, as choosing a row does.
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  const tab = (pressed: boolean) => (pressed ? 0 : -1);

  return (
    <fieldset class="scope-chips" ref={group} onKeyDown={onRowKey} data-keep-motion="">
      <legend class="visually-hidden">Search in</legend>
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
        aria-pressed={props.mode !== "this"}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={open() ? `${uid}-list` : undefined}
        tabindex={tab(props.mode !== "this")}
        ref={booksChip}
        onClick={toggleOpen}
      >
        <span class="scope-chip-check icon icon-check" aria-hidden="true" />
        {chosen().size === props.books.length ? "All Books" : booksLabel(chosen().size)}
        <span class="scope-chip-more icon icon-expand" aria-hidden="true" />
      </button>
      <Show when={open()}>
        <PickList
          id={`${uid}-list`}
          label="Books to search"
          box={() => booksChip}
          minWidth={288}
          multiselectable
          active="[data-active]"
          onDismiss={() => close(true)}
          track={() => [active(), shown(), props.mode, props.keys]}
          listRef={(el) => {
            setListEl(el);
            const popover = el.closest<HTMLElement>(".pick-list") ?? el;
            popover.addEventListener("focusout", (event) => {
              const to = event.relatedTarget as Node | null;
              if (to && !popover.contains(to) && !booksChip?.contains(to)) close(false);
            });
          }}
          onKeyDown={filtering() ? undefined : onListKey}
          head={
            filtering() ? (
              <label class="text-field">
                <input
                  ref={field}
                  type="text"
                  role="combobox"
                  aria-label="Filter books"
                  aria-expanded="true"
                  aria-controls={`${uid}-list`}
                  aria-autocomplete="list"
                  aria-activedescendant={activeId()}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  enterkeyhint="done"
                  placeholder="Filter books"
                  maxlength={SEARCH_MAX}
                  value={filter()}
                  onInput={(event) => {
                    setFilter(event.currentTarget.value);
                    setActive(0);
                  }}
                  onKeyDown={onListKey}
                />
                <ClearSearch
                  visible={filter() !== ""}
                  onClear={() => {
                    setFilter("");
                    setActive(0);
                  }}
                />
              </label>
            ) : undefined
          }
        >
          <For each={shown()}>
            {(book, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox (or its filter) carries the keys
              <div
                id={optionId(book.key)}
                role="option"
                tabIndex={-1}
                class="pick-row scope-row"
                aria-selected={chosen().has(book.key)}
                aria-disabled={locked(book.key) ? "true" : undefined}
                data-active={active() === i() ? "" : undefined}
                title={book.title}
                onPointerMove={() => setActive(i())}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggleBook(book.key)}
              >
                <span class="scope-row-title">{book.title}</span>
                <Show when={chosen().has(book.key)}>
                  <span class="scope-row-check icon icon-check" aria-hidden="true" />
                </Show>
              </div>
            )}
          </For>
          <Show when={shown().length === 0}>
            <div class="lang-none" role="presentation">
              No book matches.
            </div>
          </Show>
        </PickList>
      </Show>
    </fieldset>
  );
}
