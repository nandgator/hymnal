import { createMemo, createSignal, For, Show } from "solid-js";
import { CODE_MAX, SEARCH_MAX } from "../shell/limits.ts";
import { PickList } from "../shell/PickList.tsx";
import {
  COMMON_CODES,
  filterLanguages,
  type LanguageOption,
  languageOption,
  languageOptions,
} from "./languages.ts";

export interface LanguagePickerProps {
  id: string;
  /** The chosen language's code, or "" for none. */
  value: string;
  invalid?: boolean;
  describedBy?: string;
  onPick: (code: string) => void;
}

const options = languageOptions();
const common = COMMON_CODES.map(languageOption);

/** A row of the list; `heading` starts a group. */
interface Entry {
  o: LanguageOption;
  group: "common" | "all" | "found";
  heading?: string;
}

/**
 * A searchable list of languages by name, each in its own name and in English
 * ("മലയാളം — Malayalam"), with "Other…" to type a code. The list is a popover
 * in the top layer, placed from the field's rect like the app's menus, so it
 * floats over the sheet (PickList). Arrow keys move, Enter picks, Escape closes.
 */
export function LanguagePicker(props: LanguagePickerProps) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [active, setActive] = createSignal(0);
  // Typing a code by hand, for a language the list does not hold.
  const [other, setOther] = createSignal(false);
  let field: HTMLInputElement | undefined;
  let returning = false;
  // A press on the field: whether the list was open when it began decides whether the click closes it
  // (the press's own focus would otherwise open it before the click is seen).
  let pressing = false;
  let openAtPress = false;
  let list: HTMLDivElement | undefined;
  let box: HTMLDivElement | undefined;

  // Nothing typed: Common first, then every language. Typed: the matches among all of them.
  const shown = createMemo((): Entry[] => {
    const q = query();
    if (q.trim()) return filterLanguages(options, q).map((o) => ({ o, group: "found" }));
    return [
      ...common.map(
        (o, i): Entry => ({ o, group: "common", heading: i === 0 ? "Common" : undefined }),
      ),
      ...options.map(
        (o, i): Entry => ({
          o,
          group: "all",
          heading: i === 0 ? "All languages" : undefined,
        }),
      ),
    ];
  });
  /** The rows: the entries, then "Other…" (as code ""). */
  const rows = () => [...shown().map((e) => e.o.code), ""];
  const listId = `${props.id}-list`;
  const optionId = (code: string, group = "") => `${props.id}-opt-${group}-${code || "other"}`;
  const activeId = () => {
    const at = active();
    const entry = shown()[at];
    return entry ? optionId(entry.o.code, entry.group) : optionId("");
  };
  const held = () => (props.value && !other() ? languageOption(props.value) : undefined);

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const pick = (code: string) => {
    if (code === "") {
      setOther(true);
      close();
      props.onPick("");
      queueMicrotask(() => field?.focus());
      return;
    }
    setOther(false);
    props.onPick(code);
    close();
    // Focus returns to the field without opening the list again.
    returning = true;
    field?.focus();
    returning = false;
  };
  const move = (to: number) => {
    const last = rows().length - 1;
    const next = Math.max(0, Math.min(last, to));
    setActive(next);
    queueMicrotask(() =>
      list?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" }),
    );
  };
  const openList = () => {
    if (open()) return;
    // No language yet: the top of the list, not "Other…" (the empty code).
    setActive(props.value ? Math.max(0, rows().indexOf(props.value)) : 0);
    setOpen(true);
  };

  return (
    <div class="lang">
      <Show
        when={!other()}
        fallback={
          <div class="lang-other">
            <input
              ref={field}
              id={props.id}
              class="field-input"
              type="text"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              placeholder="A language code, such as sd or yo"
              maxlength={CODE_MAX}
              value={props.value}
              aria-invalid={props.invalid}
              aria-describedby={props.describedBy}
              onInput={(e) => props.onPick(e.currentTarget.value.trim())}
            />
            <button type="button" class="btn-text" onClick={() => setOther(false)}>
              Choose from the List
            </button>
          </div>
        }
      >
        <div class="pick-box" ref={box}>
          <input
            ref={field}
            id={props.id}
            class="field-input pick-input"
            type="text"
            role="combobox"
            aria-expanded={open()}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open() ? activeId() : undefined}
            aria-invalid={props.invalid}
            aria-describedby={props.describedBy}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            maxlength={SEARCH_MAX}
            placeholder={open() && held() ? held()?.label : "Search languages"}
            value={open() ? query() : (held()?.label ?? "")}
            onPointerDown={() => {
              pressing = true;
              openAtPress = open();
            }}
            onFocus={() => !returning && !pressing && openList()}
            onClick={() => {
              // The field (or its chevron) is a toggle: a second click closes the list.
              const was = pressing ? openAtPress : false;
              pressing = false;
              if (was) close();
              else openList();
            }}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setActive(0);
              setOpen(true);
            }}
            onBlur={(e) => {
              // A tap on a row blurs the field first; the row's own handler still runs.
              if (!list?.contains(e.relatedTarget as Node)) close();
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (open()) move(active() + 1);
                else openList();
              } else if (e.key === "ArrowUp" && open()) {
                e.preventDefault();
                move(active() - 1);
              } else if (e.key === "Enter" && open()) {
                e.preventDefault();
                pick(rows()[active()] ?? "");
              } else if (e.key === "Escape" && open()) {
                // Closes the list, not the sheet.
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
          />
          <span class="icon icon-expand pick-chevron" aria-hidden="true" />
        </div>
        <Show when={open()}>
          <PickList
            id={listId}
            label="Languages"
            box={() => box}
            onDismiss={close}
            track={() => [active(), shown()]}
            listRef={(el) => {
              list = el;
            }}
          >
            <For each={shown()}>
              {(entry, i) => (
                <>
                  <Show when={entry.heading}>
                    <div class="lang-group" role="presentation">
                      {entry.heading}
                    </div>
                  </Show>
                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input carries the keys */}
                  <div
                    id={optionId(entry.o.code, entry.group)}
                    role="option"
                    tabIndex={-1}
                    class="pick-row"
                    aria-selected={active() === i()}
                    data-current={entry.o.code === props.value ? "" : undefined}
                    onPointerMove={() => setActive(i())}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(entry.o.code)}
                  >
                    <span class="lang-native">{entry.o.native}</span>{" "}
                    <Show when={entry.o.native !== entry.o.english}>
                      <span class="lang-english">— {entry.o.english}</span>
                    </Show>
                  </div>
                </>
              )}
            </For>
            <Show when={shown().length === 0}>
              <div class="lang-none" role="presentation">
                No language matches. Use Other… to type a code.
              </div>
            </Show>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input carries the keys */}
            <div
              id={optionId("")}
              role="option"
              tabIndex={-1}
              class="pick-row pick-row-other"
              aria-selected={active() === shown().length}
              onPointerMove={() => setActive(shown().length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick("")}
            >
              Other…
            </div>
          </PickList>
        </Show>
      </Show>
    </div>
  );
}
