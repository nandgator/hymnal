import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
  HINT_MS,
  HINT_TEXT,
  HOLD_MS,
  installTouchLock,
  isDeliberateClick,
  isTouchLocked,
  setTouchLockActive,
} from "./touchLock.ts";

const pointer = (type: string, x = 10, y = 10, pointerType = "touch", button = 0) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    isPrimary: { value: true },
    pointerType: { value: pointerType },
  });
  return event;
};

const click = (el: Element, detail = 1, pointerType: string | undefined = "touch") => {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    detail,
    clientX: 10,
    clientY: 10,
  });
  if (pointerType !== undefined)
    Object.defineProperty(event, "pointerType", { value: pointerType });
  el.dispatchEvent(event);
  return event;
};

const hintText = () => document.querySelector("[role=status]")?.textContent ?? "";

describe("Touch Lock (SDD-0001 §16.11)", () => {
  let uninstall: () => void;
  let button: HTMLButtonElement;
  let plain: HTMLButtonElement;
  let acted: Mock<() => void>;
  let plainActed: Mock<() => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    button = document.createElement("button");
    button.setAttribute("data-output-guard", "");
    acted = vi.fn();
    button.addEventListener("click", () => acted());
    plain = document.createElement("button");
    plainActed = vi.fn();
    plain.addEventListener("click", () => plainActed());
    document.body.append(button, plain);
    uninstall = installTouchLock();
    setTouchLockActive(true);
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
  });

  const tap = (el: Element, ms = 80) => {
    el.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(ms);
    el.dispatchEvent(pointer("pointerup"));
    return click(el);
  };

  it("swallows a plain tap and says what to do", () => {
    const event = tap(button);
    expect(acted).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(hintText()).toBe(HINT_TEXT);
  });

  it("takes a mouse click as a tap and a pen as touch", () => {
    for (const kind of ["mouse", "pen"]) {
      button.dispatchEvent(pointer("pointerdown", 10, 10, kind));
      button.dispatchEvent(pointer("pointerup", 10, 10, kind));
      click(button, 1, kind);
    }
    expect(acted).not.toHaveBeenCalled();
  });

  it("clicks the control once when a press is held, and drops the lift's own click", () => {
    button.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(acted).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(acted).toHaveBeenCalledTimes(1);
    button.dispatchEvent(pointer("pointerup"));
    click(button);
    expect(acted).toHaveBeenCalledTimes(1);
    expect(hintText()).toBe("");
  });

  it("does nothing on an early release, or when the press drifts past 10 px", () => {
    button.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(HOLD_MS - 50);
    button.dispatchEvent(pointer("pointerup"));
    vi.advanceTimersByTime(HOLD_MS);
    expect(acted).not.toHaveBeenCalled();

    button.dispatchEvent(pointer("pointerdown", 10, 10));
    button.dispatchEvent(pointer("pointermove", 10, 25));
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(acted).not.toHaveBeenCalled();
  });

  it("lets a small wobble keep the press", () => {
    button.dispatchEvent(pointer("pointerdown", 10, 10));
    button.dispatchEvent(pointer("pointermove", 14, 14));
    vi.advanceTimersByTime(HOLD_MS);
    expect(acted).toHaveBeenCalledTimes(1);
  });

  it("does not hint a drag", () => {
    button.dispatchEvent(pointer("pointerdown", 10, 10));
    button.dispatchEvent(pointer("pointermove", 10, 40));
    button.dispatchEvent(pointer("pointerup", 10, 40));
    const event = click(button);
    expect(event.defaultPrevented).toBe(true);
    expect(hintText()).toBe("");
  });

  it("passes a click no pointer made: a key, or a screen reader's activation", () => {
    click(button, 0, undefined);
    click(button, 0, "");
    click(button, 1, "");
    expect(acted).toHaveBeenCalledTimes(3);
    expect(isDeliberateClick(new MouseEvent("click", { detail: 1 }))).toBe(false);
  });

  it("guards a control that acts on mousedown the same way, and presses it with a mousedown", () => {
    const row = document.createElement("div");
    row.setAttribute("data-output-guard", "mousedown");
    const picked = vi.fn();
    row.addEventListener("mousedown", () => picked());
    document.body.append(row);
    const down = (detail: number) => {
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail });
      row.dispatchEvent(event);
      return event;
    };

    row.dispatchEvent(pointer("pointerdown"));
    expect(down(1).defaultPrevented).toBe(true);
    row.dispatchEvent(pointer("pointerup"));
    click(row);
    expect(picked).not.toHaveBeenCalled();

    row.dispatchEvent(pointer("pointerdown"));
    vi.advanceTimersByTime(HOLD_MS);
    expect(picked).toHaveBeenCalledTimes(1);
    row.dispatchEvent(pointer("pointerup"));
    // The lift's own mouse events are dropped.
    down(1);
    click(row);
    expect(picked).toHaveBeenCalledTimes(1);
    // A key never makes a mousedown with a press behind it: detail 0 passes.
    down(0);
    expect(picked).toHaveBeenCalledTimes(2);
  });

  it("leaves controls that do not change the Output alone", () => {
    tap(plain);
    expect(plainActed).toHaveBeenCalledTimes(1);
  });

  it("does nothing when not in force (not live, or off)", () => {
    setTouchLockActive(false);
    expect(isTouchLocked()).toBe(false);
    tap(button);
    expect(acted).toHaveBeenCalledTimes(1);
    expect(document.documentElement.hasAttribute("data-touch-lock")).toBe(false);
  });

  it("keeps the long press from opening a context menu, on guarded controls only", () => {
    const guarded = new Event("contextmenu", { bubbles: true, cancelable: true });
    button.dispatchEvent(guarded);
    const other = new Event("contextmenu", { bubbles: true, cancelable: true });
    plain.dispatchEvent(other);
    expect(guarded.defaultPrevented).toBe(true);
    expect(other.defaultPrevented).toBe(false);
  });

  it("puts its hint away after a moment", () => {
    tap(button);
    vi.advanceTimersByTime(HINT_MS + 400);
    expect(hintText()).toBe("");
  });

  it("stops a press in flight when the lock goes out of force", () => {
    button.dispatchEvent(pointer("pointerdown"));
    setTouchLockActive(false);
    vi.advanceTimersByTime(HOLD_MS * 2);
    expect(acted).not.toHaveBeenCalled();
  });
});
