import { createSignal, Show } from "solid-js";
import { Sheet } from "../shell/Sheet.tsx";

export interface RenameTarget {
  key: string;
  title: string;
}

export interface RenameSheetProps {
  open: boolean;
  /** The book to rename; kept while the sheet sinks away. */
  book?: RenameTarget;
  busy: boolean;
  /** Why the rename was refused, in words. */
  error?: string;
  placement: "bottom" | "center";
  onCancel: () => void;
  onRename: (title: string) => void;
}

/**
 * Rename, for a book of yours (ADR-0033): one field, in a small sheet like Remove's. An empty
 * or unchanged title does nothing; a refusal is said under the field.
 */
export function RenameSheet(props: RenameSheetProps) {
  return (
    <Sheet
      open={props.open}
      onClose={() => !props.busy && props.onCancel()}
      title="Rename Book"
      placement={props.placement}
      closeLabel="Cancel"
    >
      <Show when={props.book}>
        {(book) => {
          // Mounted afresh for each book: the title as it is now.
          const [draft, setDraft] = createSignal(book().title);
          const changed = () => draft().trim() !== "" && draft().trim() !== book().title;
          return (
            <form
              class="review"
              novalidate
              onSubmit={(event) => {
                event.preventDefault();
                if (changed() && !props.busy) props.onRename(draft().trim());
              }}
            >
              <div class="field">
                <label class="field-label" for="book-rename">
                  Title
                </label>
                <input
                  id="book-rename"
                  class="field-input"
                  type="text"
                  autocomplete="off"
                  value={draft()}
                  aria-invalid={!!props.error}
                  aria-describedby={props.error ? "book-rename-problem" : undefined}
                  onInput={(e) => setDraft(e.currentTarget.value)}
                  autofocus
                />
                <Show when={props.error}>
                  <span class="field-hint field-problem" id="book-rename-problem" role="alert">
                    {props.error}
                  </span>
                </Show>
              </div>
              <div class="review-actions">
                <button type="submit" class="btn-filled" disabled={props.busy || !changed()}>
                  Rename Book
                </button>
              </div>
            </form>
          );
        }}
      </Show>
    </Sheet>
  );
}
