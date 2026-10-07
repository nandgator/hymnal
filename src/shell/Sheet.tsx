import { createEffect, createSignal, type JSX, on, onCleanup, Show, untrack } from "solid-js";
import { hoverButton } from "./hoverGlide.ts";

/**
 * A page pushed inside a sheet (nested navigation, e.g. Settings → Keyboard
 * Shortcuts): the one dialog stays open and its content slides.
 */
export interface SheetPage {
  /** Identity: the page changes when the id does. */
  id: string;
  title: string;
  content: () => JSX.Element;
  /** The sheet was opened on this page (no root beneath it to go back to):
   * the header says Close, and Escape and Close close the sheet. */
  direct?: boolean;
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** "bottom": an MD3 modal bottom sheet (phones, pane sheets). "center": a
   * dialog for pickers on a wide screen. */
  placement?: "bottom" | "center";
  /** The header button's label when closing leaves for good ("Cancel" in the
   * Library's sheets). Defaults to "Close". */
  closeLabel?: string;
  /** The header button is dimmed and does nothing: a write that cannot be taken back is under way. */
  closeDisabled?: boolean;
  /** Room for a long review: up to 88% of the height, not 75% (the Library's sheets). */
  tall?: boolean;
  /** Hold the height the card last settled at while this is true (a file being read), so it
   * does not jump when the content lands; once false the card hugs its content again. */
  steady?: boolean;
  /** The page showing over the root, if any. The caller owns the state. */
  page?: SheetPage | undefined;
  /** Back from a pushed page: its header button, and Escape. */
  onBack?: () => void;
  children: JSX.Element;
}

/**
 * A modal sheet on a native <dialog>: focus trap, Escape and a backdrop for
 * free. Controlled — `open` drives showModal/close, and every way of
 * dismissing it (Escape, the scrim, Close) reports through `onClose`.
 *
 * Nested navigation (one level): `page` pushes a page over the root without
 * ever closing the dialog. The new page slides in from the inline-end, the
 * root a little toward inline-start, and the sheet's height follows; Back is
 * the mirror (styles.css, "Sheet pages"). Escape goes back, then closes.
 */
export function Sheet(props: SheetProps) {
  let dialog: HTMLDialogElement | undefined;
  // The height the card last settled at, held while `steady`.
  const [settled, setSettled] = createSignal<number>();
  // The content stays until the exit has played, not just while `open`.
  const [shown, setShown] = createSignal(false);
  let closing = 0;

  // `rendered` is the page mounted: it outlasts `props.page` on the way back,
  // until the slide ends. The root stays mounted underneath, hidden once a
  // page has settled, so its scroll position and focus target survive.
  let pagesEl: HTMLDivElement | undefined;
  let rootEl: HTMLDivElement | undefined;
  let pageEl: HTMLDivElement | undefined;
  let titleEl: HTMLHeadingElement | undefined;
  let rootOff = false;
  let opener: Element | null = null;
  let settle: (() => void) | undefined;
  const [rendered, setRendered] = createSignal<SheetPage>();
  const setRootOff = (off: boolean) => {
    rootOff = off;
    rootEl?.classList.toggle("sheet-page-off", off);
  };
  const nested = () => !!props.page && !props.page.direct;
  const back = () => (nested() ? props.onBack?.() : props.onClose());

  const showPage = (page: SheetPage | undefined) => {
    settle?.();
    setRendered(page);
    setRootOff(!!page);
  };

  // The slide: `next` pushes, undefined pops. The leaving page goes out of
  // flow at its height while the other takes its place, and the pages' box
  // animates its height between the two (CSS, keyed on data-sliding).
  const slide = (next: SheetPage | undefined) => {
    settle?.();
    const push = !!next;
    const box = pagesEl;
    if (!box || !rootEl) return showPage(next);
    const from = box.offsetHeight;
    if (push) opener = document.activeElement;
    const run = () => {
      const out = push ? rootEl : pageEl;
      const incoming = push ? pageEl : rootEl;
      if (!out || !incoming) return showPage(next);
      if (!push) setRootOff(false);
      out.style.height = `${from}px`;
      out.classList.add("sheet-page-leaving");
      box.style.setProperty("--sheet-from", `${from}px`);
      box.style.setProperty("--sheet-to", `${box.offsetHeight}px`);
      box.dataset.sliding = push ? "push" : "pop";
      const end = () => {
        if (settle !== end) return;
        settle = undefined;
        delete box.dataset.sliding;
        out.classList.remove("sheet-page-leaving");
        out.style.height = "";
        if (push) setRootOff(true);
        else setRendered(undefined);
      };
      settle = end;
      // Only the slide's own animations: the scrollbar's fade runs on these too.
      const running =
        typeof box.getAnimations === "function"
          ? box
              .getAnimations({ subtree: true })
              .filter(
                (a) => "animationName" in a && String(a.animationName).startsWith("sheet-page"),
              )
          : [];
      if (running.length === 0) end();
      else void Promise.allSettled(running.map((a) => a.finished)).then(end);
      if (push) titleEl?.focus({ preventScroll: true });
      else if (opener?.isConnected) (opener as HTMLElement).focus({ preventScroll: true });
    };
    if (push) {
      // The signal mounts the new page; measure once it is in place.
      setRendered(next);
      queueMicrotask(run);
    } else run();
  };

  createEffect(
    on(
      () => props.page?.id,
      () => {
        if (!untrack(() => props.open)) return;
        const next = untrack(() => props.page);
        const live = dialog?.open && dialog.dataset.closing === undefined;
        // Opening on a page, or a direct page: nothing to slide from.
        if (!live || next?.direct || rendered()?.direct) showPage(next);
        else slide(next);
      },
      { defer: true },
    ),
  );

  createEffect(() => {
    const open = props.open;
    if (!dialog) return;
    if (open) {
      closing++;
      delete dialog.dataset.closing;
      showPage(untrack(() => props.page));
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

  createEffect(() => {
    if (props.steady || !dialog || typeof ResizeObserver === "undefined") return;
    const el = dialog;
    const watch = new ResizeObserver(() => {
      if (el.open && el.dataset.closing === undefined && el.offsetHeight > 0) {
        setSettled(el.offsetHeight);
      }
    });
    watch.observe(el);
    onCleanup(() => watch.disconnect());
  });

  // The dialog's own onClick is the scrim; its keyboard equivalent is
  // Escape, which <dialog> handles natively.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: scrim click; Escape is native
    <dialog
      ref={dialog}
      class={`sheet sheet-${props.placement ?? "bottom"}${props.tall ? " sheet-tall" : ""}${props.steady ? " sheet-steady" : ""}`}
      style={props.steady && settled() ? { "--sheet-hold": `${settled()}px` } : undefined}
      aria-label={props.page?.title ?? props.title}
      onClose={() => props.onClose()}
      onCancel={(event) => {
        event.preventDefault();
        back();
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
            <div class="sheet-titles" classList={{ "sheet-titles-nested": !!props.page }}>
              {/* biome-ignore lint/a11y/useHeadingContent: hidden only while its page covers it; it has text */}
              <h2 class="title-medium sheet-title" aria-hidden={props.page ? "true" : undefined}>
                {props.title}
              </h2>
              <Show when={rendered()}>
                {/* biome-ignore lint/a11y/useHeadingContent: hidden only while it leaves; it has text */}
                <h2
                  class="title-medium sheet-title sheet-title-page"
                  ref={titleEl}
                  tabindex="-1"
                  aria-hidden={props.page ? undefined : "true"}
                >
                  {rendered()?.title}
                </h2>
              </Show>
            </div>
            <button
              type="button"
              class="btn-text"
              ref={(el) => onCleanup(hoverButton(el))}
              disabled={props.closeDisabled}
              onClick={back}
            >
              {nested() ? "Back" : (props.closeLabel ?? "Close")}
            </button>
          </div>
          <div class="sheet-pages" ref={pagesEl}>
            <div
              class="sheet-content sheet-root"
              ref={(el) => {
                rootEl = el;
                el.classList.toggle("sheet-page-off", rootOff);
              }}
            >
              {props.children}
            </div>
            <Show when={rendered()}>
              {(page) => (
                <div class="sheet-content sheet-page" ref={pageEl}>
                  {page().content()}
                </div>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </dialog>
  );
}
