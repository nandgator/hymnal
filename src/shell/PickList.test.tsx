import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal, Show } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { PickList } from "./PickList.tsx";

function setup(onDismiss = vi.fn()) {
  let box: HTMLDivElement | undefined;
  const [open, setOpen] = createSignal(false);
  const under = vi.fn();
  const view = render(() => (
    <dialog open>
      <div class="field">
        <div class="pick-box" ref={box}>
          <button type="button" onClick={under}>
            Field
          </button>
        </div>
        <Show when={open()}>
          <PickList id="l" label="Things" box={() => box} onDismiss={onDismiss}>
            <div class="pick-row">One</div>
          </PickList>
        </Show>
      </div>
    </dialog>
  ));
  return { ...view, setOpen, onDismiss, under };
}

describe("PickList's scrim", () => {
  it("appears in the card with the list, lifts the field above it, and goes with the list", () => {
    const s = setup();
    const card = s.container.querySelector("dialog") as HTMLDialogElement;
    expect(card.querySelector(".pick-scrim")).toBeNull();
    s.setOpen(true);
    expect(card.querySelector(".pick-scrim")).not.toBeNull();
    expect(card.querySelector(".field")).toHaveClass("pick-lifted");
    s.setOpen(false);
    expect(card.querySelector(".pick-scrim")).toBeNull();
    expect(card.querySelector(".field")).not.toHaveClass("pick-lifted");
  });

  it("closes the list on a click and lets the click go no further", () => {
    const s = setup();
    s.setOpen(true);
    const card = s.container.querySelector("dialog") as HTMLDialogElement;
    const onCard = vi.fn();
    card.addEventListener("click", onCard);
    const scrim = card.querySelector(".pick-scrim") as HTMLElement;
    // Pressing does not take focus away from the field.
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    scrim.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    fireEvent.click(scrim);
    expect(s.onDismiss).toHaveBeenCalledTimes(1);
    expect(onCard).not.toHaveBeenCalled();
    expect(s.under).not.toHaveBeenCalled();
  });
});

describe("PickList keeps to its trigger", () => {
  it("is placed again when the trigger moves without a row changing (a chip settling)", async () => {
    // A sibling chip's check slides out and the trigger shifts left by 26px after the list was
    // placed: no signal changes, the browser says only that a transition ended.
    let left = 202;
    const view = render(() => (
      <dialog open>
        <button type="button" id="b">
          Chip
        </button>
        <PickList id="l" label="Things" box={() => document.getElementById("b") ?? undefined}>
          <div class="pick-row">One</div>
        </PickList>
      </dialog>
    ));
    const chip = document.getElementById("b") as HTMLElement;
    chip.getBoundingClientRect = () =>
      ({ left, right: left + 100, top: 100, bottom: 140, width: 100, height: 40 }) as DOMRect;
    const list = view.container.querySelector(".pick-list") as HTMLElement;
    await Promise.resolve();
    fireEvent(chip, new Event("transitionend", { bubbles: true }));
    expect(list.style.left).toBe("202px");
    left = 176;
    fireEvent(chip, new Event("transitionend", { bubbles: true }));
    expect(list.style.left).toBe("176px");
  });
});

describe("PickList with a head", () => {
  it("frames a field above the rows: only the listbox holds them, and it is multiselectable on request", () => {
    const view = render(() => (
      <dialog open>
        <button type="button" id="b">
          Chip
        </button>
        <PickList
          id="l"
          label="Things"
          box={() => document.getElementById("b") ?? undefined}
          head={<input aria-label="Filter" />}
          multiselectable
          active="[data-active]"
        >
          <div class="pick-row" role="option" tabIndex={-1} aria-selected="true" data-active="">
            One
          </div>
        </PickList>
      </dialog>
    ));
    const frame = view.container.querySelector(".pick-list") as HTMLElement;
    expect(frame).toHaveClass("pick-list-framed");
    expect(frame).not.toHaveAttribute("role");
    const box = frame.querySelector('[role="listbox"]') as HTMLElement;
    expect(box).toHaveAttribute("id", "l");
    expect(box).toHaveAttribute("aria-multiselectable", "true");
    expect(box.querySelector("input")).toBeNull();
    expect(frame.querySelector(".pick-head input")).not.toBeNull();
  });
});
