import { createSignal, For } from "solid-js";
import { PickList } from "./PickList.tsx";

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
 * A single choice from a short list, in the language picker's list (PickList):
 * a field that shows the choice, with a chevron, and opens the list under it.
 * A click on the field toggles the list, Enter, Space or the down arrow opens
 * it, arrows move, Enter or Space picks, Escape closes the list (not the
 * sheet it is in), Tab or a tap outside closes it.
 */
export function Select(props: SelectProps) {
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  let field: HTMLButtonElement | undefined;
  let box: HTMLDivElement | undefined;
  let list: HTMLDivElement | undefined;

  const listId = `${props.id}-list`;
  const optionId = (value: string) => `${props.id}-opt-${value}`;
  const shown = () => props.options.find((o) => o.value === props.value)?.label ?? "";
  const activeId = () => {
    const at = props.options[active()];
    return at ? optionId(at.value) : undefined;
  };

  const close = () => setOpen(false);
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
    setActive(Math.max(0, Math.min(props.options.length - 1, to)));
    queueMicrotask(() =>
      list?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }),
    );
  };

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
            if (!list?.contains(e.relatedTarget as Node)) close();
          }}
          onKeyUp={(e) => {
            // Space would click on release (Firefox); the keydown already acted.
            if (e.key === " ") e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (open()) move(active() + 1);
              else openList();
            } else if (e.key === "ArrowUp" && open()) {
              e.preventDefault();
              move(active() - 1);
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              const at = props.options[active()];
              if (open() && at) pick(at.value);
              else openList();
            } else if (e.key === "Escape" && open()) {
              // Closes the list, not the sheet.
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          }}
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
          track={() => active()}
          listRef={(el) => {
            list = el;
          }}
        >
          <For each={props.options}>
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
                {option.label}
              </div>
            )}
          </For>
        </PickList>
      )}
    </>
  );
}
