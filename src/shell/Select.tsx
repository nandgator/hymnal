import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { ClearSearch } from "./ClearSearch.tsx";
import { SEARCH_MAX } from "./limits.ts";
import { fold } from "./matchText.ts";
import { FILTER_FROM, PickList } from "./PickList.tsx";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  id: string;
  /** The listbox's accessible name. */
  label: string;
  options: readonly SelectOption[];
  /** The chosen option's value. */
  value: string;
  onChange: (value: string) => void;
}

/**
 * A single choice from a short list, in the language picker's menu (PickList):
 * a field that shows the choice, with a chevron, and opens the menu under it.
 * A click on the field toggles the menu, Enter, Space or the down arrow opens
 * it, arrows move, Enter or Space picks, Escape closes the menu (not the
 * sheet it is in), Tab or a tap outside closes it. With more options than
 * FILTER_FROM a filter field heads the menu and takes the keys (Space types).
 */
export function Select(props: SelectProps) {
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  let field: HTMLButtonElement | undefined;
  let box: HTMLDivElement | undefined;
  let list: HTMLDivElement | undefined;
  let filterField: HTMLInputElement | undefined;
  const [filter, setFilter] = createSignal("");
  const filtering = () => props.options.length > FILTER_FROM;
  /** The rows: every option, or those whose label has every word typed. */
  const rows = createMemo(() => {
    const words = fold(filter()).split(/\s+/).filter(Boolean);
    if (words.length === 0) return props.options;
    return props.options.filter((o) => words.every((w) => fold(o.label).includes(w)));
  });

  const listId = `${props.id}-list`;
  const optionId = (value: string) => `${props.id}-opt-${value}`;
  const shown = () => props.options.find((o) => o.value === props.value)?.label ?? "";
  const activeId = () => {
    const at = rows()[active()];
    return at ? optionId(at.value) : undefined;
  };

  const close = () => {
    setOpen(false);
    setFilter("");
  };
  const openList = () => {
    if (open()) return;
    setActive(
      Math.max(
        0,
        props.options.findIndex((o) => o.value === props.value),
      ),
    );
    setOpen(true);
  };
  const pick = (value: string) => {
    props.onChange(value);
    close();
    field?.focus();
  };
  const move = (to: number) => {
    setActive(Math.max(0, Math.min(rows().length - 1, to)));
    queueMicrotask(() =>
      list?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }),
    );
  };

  /** The keys of the field, or of the filter (`typing`: Space is a letter there). */
  const onKey = (e: KeyboardEvent, typing: boolean) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (open()) move(active() + 1);
      else openList();
    } else if (e.key === "ArrowUp" && open()) {
      e.preventDefault();
      move(active() - 1);
    } else if (e.key === "Enter" || (!typing && e.key === " ")) {
      e.preventDefault();
      const at = rows()[active()];
      if (open() && at) pick(at.value);
      else openList();
    } else if (e.key === "Escape" && open()) {
      // Closes the menu, not the sheet.
      e.preventDefault();
      e.stopPropagation();
      close();
      field?.focus();
    }
  };

  // With a filter, focus goes to it once the menu is shown.
  createEffect(() => {
    if (!open() || !filtering()) return;
    queueMicrotask(() => queueMicrotask(() => filterField?.focus({ preventScroll: true })));
  });

  return (
    <>
      <div class="pick-box" ref={box}>
        <button
          ref={field}
          id={props.id}
          type="button"
          class="field-input pick-input pick-trigger"
          role="combobox"
          aria-haspopup="listbox"
          data-value={props.value}
          aria-expanded={open()}
          aria-controls={listId}
          aria-activedescendant={open() ? activeId() : undefined}
          onClick={() => {
            // The field (or its chevron) is a toggle: a second click closes the list.
            if (open()) close();
            else {
              // Safari does not focus a button on click; a tap outside closes by its blur.
              field?.focus();
              openList();
            }
          }}
          onBlur={(e) => {
            const to = e.relatedTarget as Node | null;
            if (!(to && (list?.closest(".pick-list") ?? list)?.contains(to))) close();
          }}
          onKeyUp={(e) => {
            // Space would click on release (Firefox); the keydown already acted.
            if (e.key === " ") e.preventDefault();
          }}
          onKeyDown={(e) => onKey(e, false)}
        >
          <span class="pick-value">{shown()}</span>
        </button>
        <span class="icon icon-expand pick-chevron" aria-hidden="true" />
      </div>
      {open() && (
        <PickList
          id={listId}
          label={props.label}
          box={() => box}
          track={() => [active(), rows()]}
          listRef={(el) => {
            list = el;
            const popover = el.closest<HTMLElement>(".pick-list") ?? el;
            popover.addEventListener("focusout", (event) => {
              const to = event.relatedTarget as Node | null;
              if (to && !popover.contains(to) && !box?.contains(to)) close();
            });
          }}
          head={
            filtering() ? (
              <label class="text-field">
                <input
                  ref={filterField}
                  type="text"
                  role="combobox"
                  aria-label={`Filter ${props.label}`}
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={activeId()}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  enterkeyhint="done"
                  placeholder="Filter"
                  maxlength={SEARCH_MAX}
                  value={filter()}
                  onInput={(e) => {
                    setFilter(e.currentTarget.value);
                    setActive(0);
                  }}
                  onKeyDown={(e) => onKey(e, true)}
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
          <For each={rows()}>
            {(option, i) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox carries the keys
              <div
                id={optionId(option.value)}
                role="option"
                tabIndex={-1}
                class="pick-row"
                aria-selected={active() === i()}
                data-current={option.value === props.value ? "" : undefined}
                onPointerMove={() => setActive(i())}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(option.value)}
              >
                <span class="pick-row-text">{option.label}</span>
                <Show when={option.value === props.value}>
                  <span class="pick-row-check icon icon-check" aria-hidden="true" />
                </Show>
              </div>
            )}
          </For>
          <Show when={rows().length === 0}>
            <div class="lang-none" role="presentation">
              No match.
            </div>
          </Show>
        </PickList>
      )}
    </>
  );
}
