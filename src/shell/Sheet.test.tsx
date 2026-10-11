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

  it("stays open when a file picker inside it is dismissed (its input's cancel bubbles)", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <Sheet open onClose={onClose} title="Settings">
        <input type="file" data-testid="picker" />
      </Sheet>
    ));
    const input = container.querySelector("input") as HTMLInputElement;
    const event = new Event("cancel", { bubbles: true, cancelable: true });
    fireEvent(input, event);
    expect(onClose).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
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

  describe("one sheet replacing another", () => {
    // jsdom has no dialog modality or animations: stand in for both, with an
    // exit animation that never ends, as a slow one would be mid-way.
    function stub() {
      HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      };
      HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
        this.removeAttribute("open");
      };
      Object.defineProperty(HTMLElement.prototype, "getAnimations", {
        configurable: true,
        value: () => [{ finished: new Promise(() => {}) }],
      });
    }
    afterEach(() => {
      // biome-ignore lint/performance/noDelete: restoring jsdom's lack of the method
      delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
    });

    function pair() {
      stub();
      const [a, setA] = createSignal(false);
      const [b, setB] = createSignal(false);
      const view = render(() => (
        <>
          <Sheet open={a()} onClose={() => setA(false)} title="Settings">
            <p>Settings body</p>
          </Sheet>
          <Sheet open={b()} onClose={() => setB(false)} title="Search">
            <p>Search body</p>
          </Sheet>
        </>
      ));
      const [first, second] = Array.from(view.container.querySelectorAll("dialog"));
      return { setA, setB, first: first as HTMLDialogElement, second: second as HTMLDialogElement };
    }

    it("opens from nothing and closes to nothing with the usual motion", () => {
      const { setA, first } = pair();
      setA(true);
      expect(first.hasAttribute("data-swap")).toBe(false);
      setA(false);
      expect(first.hasAttribute("data-closing")).toBe(true);
    });

    it("closes the outgoing sheet at once and opens the incoming one as a swap, so no backdrop fades", () => {
      const { setA, setB, first, second } = pair();
      setA(true);
      // What the app does: close the open sheet, then open the next.
      setA(false);
      setB(true);
      expect(first.hasAttribute("open")).toBe(false);
      expect(first.hasAttribute("data-closing")).toBe(false);
      expect(screen.queryByText("Settings body")).not.toBeInTheDocument();
      expect(second.hasAttribute("open")).toBe(true);
      expect(second.hasAttribute("data-swap")).toBe(true);
    });

    it("a sheet closed after a swap sinks away as usual", () => {
      const { setA, setB, second } = pair();
      setA(true);
      setA(false);
      setB(true);
      setB(false);
      expect(second.hasAttribute("data-swap")).toBe(false);
      expect(second.hasAttribute("data-closing")).toBe(true);
    });
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
