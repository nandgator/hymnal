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

/** A card's layout box: size and centre, untransformed (a leaving card is mid-sink). */
interface Box {
  width: number;
  height: number;
  x: number;
  y: number;
}

const boxOf = (el: HTMLElement): Box => ({
  width: el.offsetWidth,
  height: el.offsetHeight,
  x: el.offsetLeft + el.offsetWidth / 2,
  y: el.offsetTop + el.offsetHeight / 2,
});

/** What a sheet shows the others: its dialog and how to end its exit now. */
interface Peer {
  dialog: () => HTMLDialogElement | undefined;
  cut: () => void;
}

const sameBox = (a: Box, b: Box) =>
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5 &&
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5;

/** How long after a swap starts that content landing late still moves the morph's target. */
const SETTLE_MS = 600;
/** The shortest a retargeted morph runs: a card landing mid-way still glides the rest. */
const MIN_RETARGET_MS = 120;
/** How long the new content takes to settle in on the card. */
const SETTLE_IN_MS = 180;

/**
 * Every mounted sheet. A sheet opening while another is leaving is a swap (one
 * modal replacing another, Settings to Search): the old one must vanish in the
 * frame the new one appears, or two half-faded scrims make the blur dip. One
 * that is still fully open is only a swap if the caller closes it in the same
 * breath; otherwise the new sheet is stacked over it.
 */
const peers = new Set<Peer>();

/**
 * The open dialogs, lowest first. Only one has a scrim: a second one would
 * double the dim and the blur. It is the lowest that is not leaving, so when
 * the lower sheet goes while an upper stays the scrim passes up, unchanged.
 */
const stack: HTMLDialogElement[] = [];

const syncScrims = () => {
  for (let i = stack.length - 1; i >= 0; i--) if (!stack[i]?.open) stack.splice(i, 1);
  const owner = stack.find((d) => d.dataset.closing === undefined) ?? stack[0];
  for (const d of stack) d.toggleAttribute("data-stacked", d !== owner);
};

/** A time or easing the stylesheet defines, for animations run from script. */
const motion = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

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
  let finishNow: (() => void) | undefined;
  let frameEl: HTMLDivElement | undefined;
  // Ends the swap in progress: its morph, its settle, what watches the content.
  let endSwap: (() => void) | undefined;

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
    let swapFrom: Box | undefined;
    if (open) {
      closing++;
      delete dialog.dataset.closing;
      finishNow = undefined;
      endSwap?.();
      // A swap: another sheet is leaving, or is closed in the same breath.
      // It goes at once and this one appears over the same, constant scrim (no
      // fade-in): its surface opaque from the first frame, growing or
      // shrinking out of the old card's box while its content settles in. The
      // old content is gone at once, so the two never read over each other.
      // Nothing is arriving from anywhere, one card is just replacing another. Opening from nothing keeps the full
      // entrance, and so does opening over a sheet that stays (stacked).
      delete dialog.dataset.swap;
      if (!dialog.open) {
        const others = [...peers].filter((p) => p.dialog() !== dialog && p.dialog()?.open);
        const leaving = others.filter((p) => p.dialog()?.dataset.closing !== undefined);
        const staying = others.filter((p) => p.dialog()?.dataset.closing === undefined);
        const boxes = new Map(others.map((p) => [p, boxOf(p.dialog() as HTMLElement)]));
        const first = leaving[0];
        for (const p of leaving) p.cut();
        if (first) swapFrom = boxes.get(first);
        else if (staying.length > 0) {
          // The caller may open before it closes (one batch): decide once its
          // work has settled, before a frame is drawn.
          const token = closing;
          const el = dialog;
          queueMicrotask(() => {
            if (token !== closing || !el.open || el.dataset.closing !== undefined) return;
            const gone = staying.filter((p) => {
              const d = p.dialog();
              return !d?.open || d.dataset.closing !== undefined;
            });
            const goneFirst = gone[0];
            for (const p of gone) p.cut();
            const box = goneFirst && boxes.get(goneFirst);
            if (box) swapIn(box);
          });
        }
      }
      showPage(untrack(() => props.page));
      setShown(true);
      if (!dialog.open) {
        if (typeof dialog.showModal === "function") dialog.showModal();
        else dialog.setAttribute("open", "");
      }
      if (!stack.includes(dialog)) stack.push(dialog);
      syncScrims();
      if (swapFrom) swapIn(swapFrom);
      // Fallback where showModal's own autofocus pass misses the field.
      const field = dialog.querySelector<HTMLElement>("[autofocus]");
      if (field && document.activeElement !== field) field.focus();
    } else if (dialog.open) {
      delete dialog.dataset.swap;
      // Motion explains the change (PRINCIPLES.md): the sheet sinks away and
      // the page comes back into focus, then the dialog closes. Reduced
      // motion fades it instead of sinking it; no animation support closes
      // at once.
      const el = dialog;
      const token = ++closing;
      const finish = () => {
        if (token !== closing) return;
        endSwap?.();
        delete el.dataset.closing;
        if (typeof el.close === "function") el.close();
        else el.removeAttribute("open");
        setShown(false);
        syncScrims();
      };
      finishNow = finish;
      if (typeof el.getAnimations !== "function") {
        finish();
        return;
      }
      el.dataset.closing = "";
      syncScrims();
      const running = el.getAnimations({ subtree: true });
      if (running.length === 0) finish();
      else void Promise.allSettled(running.map((a) => a.finished)).then(finish);
    }
  });

  // A swap: this is the card replacing another. Its surface is opaque from the
  // first frame and the old content is already gone; the new content settles
  // in on it (a little scale and a fade, from the top centre) while the box
  // animates from the old card's to its own, position included for a different
  // placement. Its own is the one the content gives once rendered: content that
  // lands while the card moves (the Finder's songs) moves the target, from
  // where the card is now.
  const swapIn = (from: Box) => {
    const el = dialog;
    if (!el) return;
    endSwap?.();
    el.dataset.swap = "";
    if (typeof el.animate !== "function") return;
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const duration = Number.parseFloat(motion("--motion-medium", "250")) || 250;
    const easing = motion("--motion-emphasized", "ease");

    const settling = frameEl;
    let settleRun: Animation | undefined;
    if (settling) {
      settling.style.transformOrigin = "50% 0";
      settleRun = settling.animate(
        [
          { opacity: 0.4, transform: "scale(0.98)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: SETTLE_IN_MS, easing },
      );
    }
    const endSettle = () => {
      settleRun?.cancel();
      settleRun = undefined;
      if (settling) settling.style.transformOrigin = "";
    };

    const frame = (b: Box, dx: number, dy: number) => ({
      width: `${b.width}px`,
      height: `${b.height}px`,
      transform: `translate(${dx}px, ${dy}px)`,
    });
    let target = boxOf(el);
    let run: Animation | undefined;
    const launch = (a: Box, b: Box, ms: number, at?: number) => {
      target = b;
      if (sameBox(a, b)) {
        delete el.dataset.morphing;
        return;
      }
      el.dataset.morphing = "";
      const mine = el.animate([frame(a, a.x - b.x, a.y - b.y), frame(b, 0, 0)], {
        duration: ms,
        easing,
      });
      if (mine && at !== undefined) mine.currentTime = at;
      run = mine;
      const done = () => {
        if (run !== mine) return;
        run = undefined;
        delete el.dataset.morphing;
      };
      void mine?.finished.then(done, done);
    };
    launch(from, target, duration);

    // The content changed size: measure the card as it now naturally is (the
    // animation off for the reading) and carry on from the box it is in.
    const retarget = () => {
      const was = target;
      const going = run;
      const now = going ? boxOf(el) : was;
      const at = going ? Number(going.currentTime ?? 0) : 0;
      going?.cancel();
      run = undefined;
      const to = boxOf(el);
      if (sameBox(to, was)) {
        // Nothing moved: put the same animation back, where it was.
        if (going) launch(from, was, duration, at);
        return;
      }
      launch(now, to, going ? Math.max(MIN_RETARGET_MS, duration - at) : duration);
    };
    let unwatch: (() => void) | undefined;
    const content = el.querySelector(".sheet-pages > .sheet-content:not(.sheet-page-off)");
    if (content && typeof ResizeObserver !== "undefined") {
      // Its children, not the content itself: that is the card's size, which this animates.
      const sizes = new ResizeObserver(retarget);
      const seen = new Set<Element>();
      const observe = () => {
        for (const child of content.children)
          if (!seen.has(child)) {
            seen.add(child);
            sizes.observe(child);
          }
      };
      observe();
      const added =
        typeof MutationObserver === "function"
          ? new MutationObserver(() => {
              observe();
              retarget();
            })
          : undefined;
      added?.observe(content, { childList: true });
      const stop = setTimeout(() => unwatch?.(), SETTLE_MS);
      unwatch = () => {
        clearTimeout(stop);
        sizes.disconnect();
        added?.disconnect();
        unwatch = undefined;
      };
    }
    const end = () => {
      if (endSwap !== end) return;
      endSwap = undefined;
      unwatch?.();
      endSettle();
      run?.cancel();
      run = undefined;
      delete el.dataset.morphing;
    };
    endSwap = end;
  };

  // What a replacing sheet calls: end this one's exit now.
  const peer: Peer = {
    dialog: () => dialog,
    cut: () => {
      if (dialog?.open && finishNow && dialog.dataset.closing !== undefined) finishNow();
    },
  };
  peers.add(peer);
  onCleanup(() => {
    peers.delete(peer);
    if (dialog) {
      const i = stack.indexOf(dialog);
      if (i >= 0) stack.splice(i, 1);
      syncScrims();
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
      onClose={() => {
        syncScrims();
        props.onClose();
      }}
      onCancel={(event) => {
        // A file input's cancel (its picker dismissed) bubbles here: only the
        // dialog's own, which is Escape, closes or goes back.
        if (event.target !== event.currentTarget) return;
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
        <div class="sheet-frame" ref={frameEl}>
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
