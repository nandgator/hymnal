import { createEffect, createSignal, type JSX, Show } from "solid-js";

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
  /** Room for a long review: up to 88% of the height, not 75% (the Library's sheets). */
  tall?: boolean;
  children: JSX.Element;
}

/**
 * A modal sheet on a native <dialog>: focus trap, Escape and a backdrop for
 * free. Controlled — `open` drives showModal/close, and every way of
 * dismissing it (Escape, the scrim, Close) reports through `onClose`.
 */
export function Sheet(props: SheetProps) {
  let dialog: HTMLDialogElement | undefined;
  // The content stays until the exit has played, not just while `open`.
  const [shown, setShown] = createSignal(false);
  let closing = 0;

  createEffect(() => {
    const open = props.open;
    if (!dialog) return;
    if (open) {
      closing++;
      delete dialog.dataset.closing;
      setShown(true);
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
      // Fallback where showModal's own autofocus pass misses the field.
      const field = dialog.querySelector<HTMLElement>("[autofocus]");
      if (field && document.activeElement !== field) field.focus();
    } else if (dialog.open) {
      // Motion explains the change (PRINCIPLES.md): the sheet sinks away and
      // the page comes back into focus, then the dialog closes. Reduced
      // motion fades it instead of sinking it; no animation support closes
      // at once.
      const el = dialog;
      const token = ++closing;
      const finish = () => {
        if (token !== closing) return;
        delete el.dataset.closing;
        if (typeof el.close === "function") el.close();
        else el.removeAttribute("open");
        setShown(false);
      };
      if (typeof el.getAnimations !== "function") {
        finish();
        return;
      }
      el.dataset.closing = "";
      const running = el.getAnimations({ subtree: true });
      if (running.length === 0) finish();
      else void Promise.allSettled(running.map((a) => a.finished)).then(finish);
    }
  });

  // The dialog's own onClick is the scrim; its keyboard equivalent is
  // Escape, which <dialog> handles natively.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: scrim click; Escape is native
    <dialog
      ref={dialog}
      class={`sheet sheet-${props.placement ?? "bottom"}${props.tall ? " sheet-tall" : ""}`}
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
      {/* `props.open` too: the content must exist when showModal() runs, or the
          browser finds no [autofocus] field and focuses the dialog. */}
      <Show when={props.open || shown()}>
        <div class="sheet-frame">
          {/* The header is not part of what scrolls: it cannot be scrolled away,
              by a wheel or by scrollIntoView, and the card ends at the last control. */}
          <div class="sheet-header">
            <h2 class="title-medium">{props.title}</h2>
            <button type="button" class="btn-text" onClick={() => props.onClose()}>
              {props.closeLabel ?? "Close"}
            </button>
          </div>
          <div class="sheet-content">{props.children}</div>
        </div>
      </Show>
    </dialog>
  );
}
