import { createEffect, createSignal, onCleanup, onMount, Show, untrack } from "solid-js";
import { hoverGroup } from "./hoverGlide.ts";
import { topSheet } from "./Sheet.tsx";

export interface SnackbarProps {
  message: string;
  /** The single action, text-weight — "Restart", "Got It". */
  action: string;
  onAction: () => void;
  /** Closes without acting; absent when the action itself closes. */
  dismissLabel?: string;
  onDismiss?: () => void;
}

/** The leave animation's length, plus a little: the fallback when none runs. */
const LEAVE_MS = 300;

/** How far the card rises in (styles.css notice-in): a measure taken early allows for it. */
const RISE_PX = 12;

/**
 * Hosts the one notice (DESIGN.md § Snackbar): shows `notice` while there is
 * one, and keeps the last one mounted while it slides away, so it leaves as
 * it came instead of vanishing. A different notice replaces it in place.
 */
export function SnackbarHost(props: { notice: SnackbarProps | undefined }) {
  const [shown, setShown] = createSignal<SnackbarProps>();
  const [leaving, setLeaving] = createSignal(false);
  let region: HTMLDivElement | undefined;
  let anchor: HTMLDivElement | undefined;

  // A modal dialog makes everything outside it inert, a popover in the top
  // layer included: drawn over the sheet, the notice would take no tap (the
  // browser hits the sheet's control under it) and no focus. So the notice
  // lives inside the sheet on top while one is open, and goes home when the
  // last closes. Moving it hides a popover, so it is shown again.
  //
  // The notice is fixed to the viewport, so it can lie over the foot of the
  // sheet and hide its actions (Load Book). The sheet therefore keeps the
  // card's height clear at the end of its content: `--notice-clearance`.
  let homeNode: ParentNode | null | undefined;
  const reserve = () => {
    const sheet = anchor?.parentNode;
    if (!(sheet instanceof HTMLElement) || sheet === homeNode) return;
    const card = region?.querySelector(".snackbar");
    const sheetBox = sheet.getBoundingClientRect();
    const cardBox = card?.getBoundingClientRect();
    let clearance = 0;
    if (cardBox && !leaving() && cardBox.right > sheetBox.left && cardBox.left < sheetBox.right)
      // The card is mid-rise when first measured: a little more than it is.
      clearance = Math.max(0, sheetBox.bottom - cardBox.top + RISE_PX);
    if (clearance > 0) sheet.style.setProperty("--notice-clearance", `${Math.round(clearance)}px`);
    else sheet.style.removeProperty("--notice-clearance");
  };

  onMount(() => {
    homeNode = anchor?.parentNode;
    const home = homeNode;
    if (!anchor || !home) return;
    const place = () => {
      const target = topSheet() ?? home;
      if (!anchor || anchor.parentNode === target) return;
      if (anchor.parentNode instanceof HTMLElement)
        anchor.parentNode.style.removeProperty("--notice-clearance");
      target.appendChild(anchor);
      queueMicrotask(() => {
        if (region?.isConnected && !region.matches(":popover-open")) region.showPopover?.();
        reserve();
      });
    };
    place();
    window.addEventListener("resize", reserve);
    onCleanup(() => window.removeEventListener("resize", reserve));
    const watch = new MutationObserver(place);
    watch.observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ["open", "data-closing"],
    });
    onCleanup(() => {
      watch.disconnect();
      if (anchor?.parentNode !== home) home.appendChild(anchor as Node);
    });
  });

  createEffect(() => {
    shown();
    leaving();
    queueMicrotask(reserve);
  });

  createEffect(() => {
    const next = props.notice;
    if (next) {
      const replaced = untrack(shown);
      setShown(next);
      setLeaving(false);
      // A different notice over one already up goes to the top of the top
      // layer again, or a sheet opened since would still cover it.
      if (replaced && replaced.message !== next.message)
        queueMicrotask(() => {
          if (typeof region?.hidePopover !== "function" || !region.matches(":popover-open")) return;
          region.hidePopover();
          region.showPopover();
        });
    } else if (untrack(shown)) {
      setLeaving(true);
      const timer = setTimeout(() => setShown(undefined), LEAVE_MS);
      onCleanup(() => clearTimeout(timer));
    }
  });
  return (
    <div class="snackbar-anchor" ref={anchor}>
      <Show when={shown()}>
        {(notice) => (
          <div
            class="snackbar-region"
            classList={{ "snackbar-leaving": leaving() }}
            aria-hidden={leaving() ? "true" : undefined}
            ref={(el) => {
              region = el;
              // In the top layer, so a notice shows over an open sheet too.
              if (typeof el.showPopover !== "function") return;
              el.setAttribute("popover", "manual");
              queueMicrotask(() => el.isConnected && el.showPopover());
            }}
            onAnimationEnd={(event) => {
              if (leaving() && event.target === event.currentTarget) setShown(undefined);
            }}
          >
            <Snackbar {...notice()} />
          </div>
        )}
      </Show>
    </div>
  );
}

/**
 * The notice card itself (DESIGN.md § Snackbar): a message, one
 * action, an optional close. It takes no focus, and carries no live-region
 * role of its own: the shell's persistent region announces its message.
 */
export function Snackbar(props: SnackbarProps) {
  return (
    <div class="snackbar" ref={(el) => onCleanup(hoverGroup(el, "button:enabled", { gap: 150 }))}>
      <span class="snackbar-message">{props.message}</span>
      <button type="button" class="btn-text snackbar-action" onClick={() => props.onAction()}>
        {props.action}
      </button>
      <Show when={props.onDismiss}>
        <button
          type="button"
          class="snackbar-close"
          aria-label={props.dismissLabel ?? "Dismiss"}
          onClick={() => props.onDismiss?.()}
        >
          <span class="icon icon-close" aria-hidden="true" />
        </button>
      </Show>
    </div>
  );
}
