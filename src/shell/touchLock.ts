/**
 * Touch Lock (SDD-0001 §16.11, Board #75): while the Output is live, a pointer
 * action that would change it needs a press held about half a second. One
 * mechanism, not a copy per control: a control that changes the Output carries
 * `data-output-guard`, and one controller, installed once by the shell, does
 * the rest at the document in the capture phase.
 *
 * A press on a guarded control starts a ring and a timer. At the end of the
 * timer the controller clicks the control itself (a click no pointer made,
 * `detail === 0`), so the control's own handler runs as ever. A tap that
 * lifts early has its click stopped before any handler sees it, and a hint
 * says what to do. Keys, and any click no pointer made (a screen reader's
 * activation, Enter or Space on a focused control), pass.
 */

/** How long a press is held before it counts. */
export const HOLD_MS = 500;
/** How far (px) a press may drift before it is a scroll, not a press. */
export const MOVE_PX = 10;
/** How long the hint stays. */
export const HINT_MS = 1600;
/** What the hint says: "Hold" alone is the freeze (SDD-0001 §16.6). */
export const HINT_TEXT = "Press and hold to show";

/** The mark of a control that changes the Output. Its value is empty for a
 * control that acts on `click`, or `mousedown` for one that acts on the press
 * itself (the Finder's rows, which keep the focus in the search box). */
export const GUARD_ATTRIBUTE = "data-output-guard";
const GUARD = `[${GUARD_ATTRIBUTE}]`;
/** The root's attribute while the lock is in force (styles.css). */
const ROOT_ATTRIBUTE = "data-touch-lock";
/** The hint's fade out, ms (matches styles.css). */
const HINT_FADE_MS = 160;
/** How long after a completed press the mouse events of its lift are still dropped. */
const DROP_MS = 700;

let active = false;

/** Whether the lock is in force: on, and the Output live. */
export const isTouchLocked = () => active;

/** Tells the controller whether the lock is in force. The shell calls it as
 * the preference and the Output's state change. */
export function setTouchLockActive(next: boolean): void {
  if (next === active) return;
  active = next;
  const root = document.documentElement;
  if (next) root.setAttribute(ROOT_ATTRIBUTE, "");
  else {
    root.removeAttribute(ROOT_ATTRIBUTE);
    controller?.cancel();
  }
}

interface Press {
  el: Element;
  pointerId: number;
  x: number;
  y: number;
  done: boolean;
  timer: ReturnType<typeof setTimeout>;
}

interface Controller {
  cancel: () => void;
}
let controller: Controller | undefined;

const guardOf = (target: EventTarget | null): Element | null =>
  target instanceof Element ? target.closest(GUARD) : null;

/** A click no pointer made: a screen reader's activation, Enter or Space on a
 * focused control, a script's. It has no press behind it (`detail === 0`), or
 * the browser says it came from no pointer (`pointerType` empty). */
export const isDeliberateClick = (event: MouseEvent): boolean =>
  event.detail === 0 || (event as Partial<PointerEvent>).pointerType === "";

const popover = (el: HTMLElement, open: boolean) => {
  if (open) {
    if (typeof el.showPopover === "function" && !el.matches(":popover-open")) {
      try {
        el.showPopover();
      } catch {
        // Not connected, or already open: the element is positioned anyway.
      }
    }
  } else if (typeof el.hidePopover === "function" && el.matches(":popover-open")) {
    try {
      el.hidePopover();
    } catch {
      // Already hidden.
    }
  }
};

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Installs the controller on the document; returns its cleanup. The ring and
 * the hint are in the top layer (popovers), so they show over a sheet and
 * Present Here alike.
 */
export function installTouchLock(): () => void {
  let press: Press | undefined;
  let lastMoved = false;
  let dropUntil = 0;
  let ring: HTMLElement | undefined;
  let hint: HTMLElement | undefined;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let hintFade: ReturnType<typeof setTimeout> | undefined;

  const makeRing = () => {
    const el = document.createElement("div");
    el.className = "touch-lock-ring";
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("popover", "manual");
    el.innerHTML =
      '<svg viewBox="0 0 48 48"><circle class="track" cx="24" cy="24" r="21"/>' +
      '<circle class="arc" cx="24" cy="24" r="21" pathLength="100"/></svg>';
    document.body.append(el);
    return el;
  };

  // A live region is announced when its text changes, so the hint's element
  // is made once, empty, and its text is set when a tap is swallowed.
  const makeHint = () => {
    const el = document.createElement("div");
    el.className = "touch-lock-hint";
    el.setAttribute("role", "status");
    el.setAttribute("popover", "manual");
    document.body.append(el);
    return el;
  };

  const hideRing = () => {
    if (ring) {
      ring.classList.remove("is-pressing", "is-done");
      popover(ring, false);
    }
  };

  const showRing = (x: number, y: number) => {
    ring ??= makeRing();
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    ring.style.setProperty("--touch-lock-ms", `${HOLD_MS}ms`);
    ring.classList.remove("is-done", "is-pressing");
    popover(ring, true);
    // Restart the fill from empty.
    void ring.getBoundingClientRect();
    ring.classList.add("is-pressing");
  };

  const hideHint = () => {
    clearTimeout(hintTimer);
    clearTimeout(hintFade);
    if (!hint) return;
    hint.classList.remove("is-shown");
    popover(hint, false);
    hint.textContent = "";
  };

  const showHint = (x: number, y: number) => {
    hint ??= makeHint();
    clearTimeout(hintTimer);
    clearTimeout(hintFade);
    hint.classList.remove("is-shown", "is-leaving");
    popover(hint, true);
    hint.textContent = HINT_TEXT;
    // Above the pointer, below it near the top edge, inside the window.
    const width = hint.offsetWidth || 160;
    const margin = 8;
    const left = Math.min(
      Math.max(x, margin + width / 2),
      Math.max(margin + width / 2, window.innerWidth - margin - width / 2),
    );
    const below = y < 96;
    hint.style.left = `${left}px`;
    hint.style.top = `${below ? y + 36 : y - 36}px`;
    hint.classList.toggle("is-below", below);
    hint.classList.add("is-shown");
    hintTimer = setTimeout(() => {
      hint?.classList.add("is-leaving");
      hintFade = setTimeout(hideHint, reducedMotion() ? 0 : HINT_FADE_MS);
    }, HINT_MS);
  };

  const cancel = () => {
    if (press) clearTimeout(press.timer);
    press = undefined;
    hideRing();
  };

  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const complete = () => {
    if (!press) return;
    const { el } = press;
    press.done = true;
    ring?.classList.add("is-done");
    hideHint();
    // An event no pointer made (detail 0): the control's own handler runs.
    if (el.getAttribute(GUARD_ATTRIBUTE) === "mousedown")
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 0 }));
    else (el as HTMLElement).click?.();
  };

  const onPointerDown = (event: PointerEvent) => {
    cancel();
    lastMoved = false;
    dropUntil = 0;
    if (!active || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const el = guardOf(event.target);
    if (!el || el.matches(":disabled, [aria-disabled='true']")) return;
    press = {
      el,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      done: false,
      timer: setTimeout(complete, HOLD_MS),
    };
    showRing(event.clientX, event.clientY);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!press || press.done || event.pointerId !== press.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_PX) {
      // Remembered, so a click that may follow is not hinted: it was a drag.
      cancel();
      lastMoved = true;
    }
  };

  const onPointerEnd = (event: PointerEvent) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const wasDone = press.done;
    cancel();
    // The lift's own mouse events would repeat the action: drop them, wherever
    // they land (the control may be gone by then).
    if (wasDone) dropUntil = Date.now() + DROP_MS;
  };

  // A control that acts on the press itself (`mousedown`): the mouse events a
  // touch or a click makes are stopped like the click is, and without a hint.
  const onMouseDown = (event: MouseEvent) => {
    if (event.detail === 0) return;
    if (Date.now() < dropUntil) return swallow(event);
    if (!active) return;
    if (guardOf(event.target)?.getAttribute(GUARD_ATTRIBUTE) === "mousedown") swallow(event);
  };

  const onClick = (event: MouseEvent) => {
    if (event.detail > 0 && Date.now() < dropUntil) return swallow(event);
    if (!active || !guardOf(event.target) || isDeliberateClick(event)) return;
    swallow(event);
    if (!lastMoved) showHint(event.clientX, event.clientY);
  };

  const onContextMenu = (event: Event) => {
    if (active && guardOf(event.target)) event.preventDefault();
  };

  const opts = { capture: true } as const;
  document.addEventListener("pointerdown", onPointerDown, opts);
  document.addEventListener("pointermove", onPointerMove, opts);
  document.addEventListener("pointerup", onPointerEnd, opts);
  document.addEventListener("pointercancel", onPointerEnd, opts);
  document.addEventListener("mousedown", onMouseDown, opts);
  document.addEventListener("click", onClick, opts);
  document.addEventListener("contextmenu", onContextMenu, opts);
  controller = { cancel };

  return () => {
    document.removeEventListener("pointerdown", onPointerDown, opts);
    document.removeEventListener("pointermove", onPointerMove, opts);
    document.removeEventListener("pointerup", onPointerEnd, opts);
    document.removeEventListener("pointercancel", onPointerEnd, opts);
    document.removeEventListener("mousedown", onMouseDown, opts);
    document.removeEventListener("click", onClick, opts);
    document.removeEventListener("contextmenu", onContextMenu, opts);
    cancel();
    hideHint();
    ring?.remove();
    hint?.remove();
    if (controller?.cancel === cancel) controller = undefined;
    active = false;
    document.documentElement.removeAttribute(ROOT_ATTRIBUTE);
  };
}
