import { createEffect, createSignal, type JSX, onCleanup, Show } from "solid-js";

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
    } else if (dialog.open) {
      // Motion explains the change (PRINCIPLES.md): the sheet sinks away and
      // the page comes back into focus, then the dialog closes. Reduced
      // motion, or no animation support, closes at once.
      const el = dialog;
      const token = ++closing;
      const finish = () => {
        if (token !== closing) return;
        delete el.dataset.closing;
        if (typeof el.close === "function") el.close();
        else el.removeAttribute("open");
        setShown(false);
      };
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduced || typeof el.getAnimations !== "function") {
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
      <Show when={shown()}>
        <div class="sheet-content">
          <div
            class="sheet-header"
            ref={(header) => {
              // Anything else pinned inside (the Finder's field) sticks just
              // under the header, whatever the text size makes its height.
              if (typeof ResizeObserver !== "function") return;
              const observer = new ResizeObserver(() =>
                dialog?.style.setProperty("--sheet-header-height", `${header.offsetHeight}px`),
              );
              observer.observe(header);
              onCleanup(() => observer.disconnect());
            }}
          >
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
