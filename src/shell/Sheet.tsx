import { createEffect, type JSX, Show } from "solid-js";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "bottom": an MD3 modal bottom sheet (phones, pane sheets). "center": a
   * dialog for pickers on a wide screen. */
  placement?: "bottom" | "center";
  /** The header button's label: "Back" when the sheet was opened from
   * another, and closing returns there. Defaults to "Close". */
  closeLabel?: string;
  children: JSX.Element;
}

/**
 * A modal sheet on a native <dialog>: focus trap, Escape and a backdrop for
 * free. Controlled — `open` drives showModal/close, and every way of
 * dismissing it (Escape, the scrim, Close) reports through `onClose`.
 */
export function Sheet(props: SheetProps) {
  let dialog: HTMLDialogElement | undefined;

  createEffect(() => {
    if (!dialog) return;
    if (props.open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!props.open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  });

  // The dialog's own onClick is the scrim; its keyboard equivalent is
  // Escape, which <dialog> handles natively.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: scrim click; Escape is native
    <dialog
      ref={dialog}
      class={`sheet sheet-${props.placement ?? "bottom"}`}
      aria-label={props.title}
      onClose={() => props.onClose()}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <Show when={props.open}>
        <div class="sheet-content">
          <div class="sheet-header">
            <h2 class="title-medium">{props.title}</h2>
            <button type="button" class="btn-text" onClick={() => props.onClose()}>
              {props.closeLabel ?? "Close"}
            </button>
          </div>
          {props.children}
        </div>
      </Show>
    </dialog>
  );
}
