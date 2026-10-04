import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet, type SheetPage } from "./Sheet.tsx";

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

  it("keeps the title and Close outside what scrolls, so no sheet can scroll them away", () => {
    const { container } = render(() => (
      <Sheet open onClose={() => {}} title="Settings">
        <p>Body</p>
      </Sheet>
    ));
    const header = container.querySelector(".sheet-header");
    const scroller = container.querySelector(".sheet-content");
    expect(header).not.toBeNull();
    expect(scroller?.contains(header)).toBe(false);
    expect(scroller).toHaveTextContent("Body");
  });

  describe("nested pages", () => {
    // A sheet whose root has a row that pushes a page, like Settings.
    function nested(direct = false) {
      const [open, setOpen] = createSignal(true);
      const [page, setPage] = createSignal<SheetPage | undefined>(
        direct
          ? { id: "keys", title: "Keyboard Shortcuts", content: () => <p>Keys</p>, direct: true }
          : undefined,
      );
      const onClose = vi.fn(() => setOpen(false));
      const onBack = vi.fn(() => setPage(undefined));
      const view = render(() => (
        <Sheet open={open()} onClose={onClose} title="Settings" page={page()} onBack={onBack}>
          <button
            type="button"
            onClick={() =>
              setPage({ id: "keys", title: "Keyboard Shortcuts", content: () => <p>Keys</p> })
            }
          >
            Keyboard Shortcuts row
          </button>
        </Sheet>
      ));
      const dialog = view.container.querySelector("dialog") as HTMLDialogElement;
      return { dialog, onClose, onBack, page };
    }
    const cancel = (dialog: HTMLDialogElement) =>
      fireEvent(dialog, new Event("cancel", { cancelable: true }));

    it("keeps one dialog open from the push to the pop, the backdrop never gone", () => {
      const { dialog, onClose } = nested();
      const states: boolean[] = [];
      new MutationObserver(() => states.push(dialog.hasAttribute("open"))).observe(dialog, {
        attributes: true,
        attributeFilter: ["open"],
      });
      fireEvent.click(screen.getByRole("button", { name: "Keyboard Shortcuts row" }));
      expect(screen.getByText("Keys")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(dialog.hasAttribute("open")).toBe(true);
      expect(document.querySelectorAll("dialog")).toHaveLength(1);
      expect(onClose).not.toHaveBeenCalled();
      return Promise.resolve().then(() => {
        expect(states).not.toContain(false);
      });
    });

    it("names the dialog for the page it shows, and Escape goes back one level", () => {
      const { dialog, onClose, onBack } = nested();
      expect(dialog).toHaveAttribute("aria-label", "Settings");
      fireEvent.click(screen.getByRole("button", { name: "Keyboard Shortcuts row" }));
      expect(dialog).toHaveAttribute("aria-label", "Keyboard Shortcuts");
      cancel(dialog);
      expect(onBack).toHaveBeenCalledTimes(1);
      expect(onClose).not.toHaveBeenCalled();
      expect(dialog).toHaveAttribute("aria-label", "Settings");
      // On the root, Escape closes the sheet.
      cancel(dialog);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("moves focus to the page's heading, and Back returns it to the row", () => {
      nested();
      const row = screen.getByRole("button", { name: "Keyboard Shortcuts row" });
      row.focus();
      fireEvent.click(row);
      return Promise.resolve()
        .then(() => {
          expect(document.activeElement).toBe(
            screen.getByRole("heading", { name: "Keyboard Shortcuts" }),
          );
          fireEvent.click(screen.getByRole("button", { name: "Back" }));
        })
        .then(() => {
          expect(document.activeElement).toBe(row);
        });
    });

    it("opened straight on a page it shows Close, and Close and Escape close the sheet", () => {
      const { dialog, onClose, onBack } = nested(true);
      expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
      expect(screen.getByText("Keys")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledTimes(1);
      cancel(dialog);
      expect(onClose).toHaveBeenCalledTimes(2);
      expect(onBack).not.toHaveBeenCalled();
    });
  });
});
