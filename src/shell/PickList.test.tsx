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
