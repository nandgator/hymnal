import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet.tsx";

afterEach(() => vi.restoreAllMocks());

describe("Sheet", () => {
  it("has its content in place when it opens, so the autofocus field takes focus (command menu typing)", () => {
    // A browser's showModal() focuses the first [autofocus] descendant *at
    // that moment*; content added afterwards leaves focus on the dialog and
    // typed text goes nowhere. jsdom has no showModal, so stand in for it.
    let focused: Element | null | undefined;
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
      focused = this.querySelector("[autofocus]");
      (focused as HTMLElement | null)?.focus();
    };
    const [open, setOpen] = createSignal(false);
    render(() => (
      <Sheet open={open()} onClose={() => {}} title="Search">
        <input autofocus aria-label="Find" />
      </Sheet>
    ));
    setOpen(true);
    expect(focused).not.toBeNull();
    expect(document.activeElement).toBe(focused);
  });
});
