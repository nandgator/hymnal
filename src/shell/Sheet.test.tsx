import { fireEvent, render, screen } from "@solidjs/testing-library";
import { batch, createEffect, createSignal, For } from "solid-js";
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

  describe("sheets stacked and swapped", () => {
    // Same stand-ins as above; the cards have sizes so a swap can morph.
    const sizes: Record<string, [number, number]> = { Settings: [576, 400], Search: [576, 200] };
    const saved = Object.getOwnPropertyDescriptors(HTMLElement.prototype);
    const animate = vi.fn();
    // The height a card has right now while an animation holds it, by label.
    const midway: Record<string, number> = {};
    function stub(reduced = false) {
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
      const size = (el: HTMLElement): [number, number] => {
        const label = el.getAttribute("aria-label") ?? "";
        const [w, h] = sizes[label] ?? [0, 0];
        // A card mid-morph is as tall as its animation says, not as its content is.
        return [w, midway[label] ?? h];
      };
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get(this: HTMLElement) {
          return size(this)[0];
        },
      });
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get(this: HTMLElement) {
          return size(this)[1];
        },
      });
      Object.defineProperty(HTMLElement.prototype, "animate", {
        configurable: true,
        value: animate,
      });
      vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
    }
    afterEach(() => {
      animate.mockReset();
      sizes.Settings = [576, 400];
      sizes.Search = [576, 200];
      for (const key of Object.keys(midway)) delete midway[key];
      vi.unstubAllGlobals();
      delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
      delete (HTMLElement.prototype as { animate?: unknown }).animate;
      for (const key of ["offsetWidth", "offsetHeight"]) {
        Object.defineProperty(
          HTMLElement.prototype,
          key,
          saved[key] ?? { configurable: true, value: undefined },
        );
      }
    });

    function pair(reduced = false) {
      stub(reduced);
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
    const settled = () => Promise.resolve();

    it("gives the scrim to the lowest of two stacked sheets only, so the dim and blur never double", async () => {
      const { setA, setB, first, second } = pair();
      setA(true);
      setB(true);
      await settled();
      expect(first.hasAttribute("data-stacked")).toBe(false);
      expect(second.hasAttribute("data-stacked")).toBe(true);
      // Stacking is not a swap: the upper sheet makes its full entrance.
      expect(second.hasAttribute("data-swap")).toBe(false);
      expect(first.hasAttribute("open")).toBe(true);
      expect(first.hasAttribute("data-closing")).toBe(false);
    });

    it("keeps the lower scrim when the upper sheet closes, and the lower one then closes with its usual motion", async () => {
      const { setA, setB, first, second } = pair();
      setA(true);
      setB(true);
      await settled();
      setB(false);
      expect(second.hasAttribute("data-closing")).toBe(true);
      expect(first.hasAttribute("data-stacked")).toBe(false);
      setA(false);
      expect(first.hasAttribute("open")).toBe(true);
      expect(first.hasAttribute("data-closing")).toBe(true);
    });

    it("hands the scrim to the upper sheet when the lower one closes and the upper stays", async () => {
      const { setA, setB, first, second } = pair();
      setA(true);
      setB(true);
      await settled();
      setA(false);
      await settled();
      expect(first.hasAttribute("data-closing")).toBe(true);
      expect(first.hasAttribute("data-stacked")).toBe(true);
      expect(second.hasAttribute("data-stacked")).toBe(false);
      expect(second.hasAttribute("data-swap")).toBe(false);
    });

    it("still reads a batch that opens before it closes as a swap, the old one gone at once", async () => {
      const { setA, setB, first, second } = pair();
      setA(true);
      batch(() => {
        setB(true);
        setA(false);
      });
      await settled();
      expect(first.hasAttribute("open")).toBe(false);
      expect(second.hasAttribute("data-swap")).toBe(true);
      expect(second.hasAttribute("data-stacked")).toBe(false);
    });

    it("grows the incoming card out of the outgoing card's box, its surface never faded", () => {
      const { setA, setB, second } = pair();
      setA(true);
      setA(false);
      setB(true);
      expect(second.hasAttribute("data-swap")).toBe(true);
      expect(animate).toHaveBeenCalledTimes(1);
      const [keyframes] = animate.mock.calls[0] as [Record<string, string>[]];
      expect(animate.mock.contexts[0]).toBe(second);
      expect(keyframes[0]).toMatchObject({ width: "576px", height: "400px" });
      expect(keyframes[1]).toMatchObject({ width: "576px", height: "200px" });
      // Only height and position move; nothing on the dialog fades.
      for (const frame of keyframes) expect(frame).not.toHaveProperty("opacity");
    });

    it("morphs a batched swap too", async () => {
      const first = pair();
      first.setA(true);
      batch(() => {
        first.setB(true);
        first.setA(false);
      });
      await settled();
      expect(animate).toHaveBeenCalledTimes(1);
    });

    it("does not morph a swap under reduced motion", () => {
      const { setA, setB, second } = pair(true);
      setA(true);
      setA(false);
      setB(true);
      expect(second.hasAttribute("data-swap")).toBe(true);
      expect(animate).not.toHaveBeenCalled();
    });

    it("does not morph a stacked sheet", async () => {
      const { setA, setB } = pair();
      setA(true);
      setB(true);
      await settled();
      expect(animate).not.toHaveBeenCalled();
    });

    describe("a swap's content and its target", () => {
      // Search's rows arrive after the card is up (an effect, as the Finder's do), and the
      // card is 200 plus 40 for each.
      function growing() {
        stub();
        const callbacks: Array<() => void> = [];
        vi.stubGlobal(
          "ResizeObserver",
          class {
            constructor(callback: () => void) {
              callbacks.push(callback);
            }
            observe() {}
            unobserve() {}
            disconnect() {}
          },
        );
        const [a, setA] = createSignal(false);
        const [b, setB] = createSignal(false);
        const [rows, setRows] = createSignal<number[]>([]);
        const view = render(() => (
          <>
            <Sheet open={a()} onClose={() => setA(false)} title="Settings">
              <p>Settings body</p>
            </Sheet>
            <Sheet open={b()} onClose={() => setB(false)} title="Search">
              {(() => {
                createEffect(() => {
                  if (!b()) return;
                  setRows([1, 2, 3, 4, 5]);
                  sizes.Search = [576, 400];
                });
                return (
                  <ul>
                    <For each={rows()}>{(n) => <li>{n}</li>}</For>
                  </ul>
                );
              })()}
            </Sheet>
          </>
        ));
        const [first, second] = Array.from(view.container.querySelectorAll("dialog"));
        const resize = () => {
          for (const callback of callbacks) callback();
        };
        return { setA, setB, resize, first, second: second as HTMLDialogElement, view };
      }

      it("keeps the outgoing card's content over the incoming one while it fades, so no frame is blank", () => {
        const { setA, setB, second } = pair();
        setA(true);
        setA(false);
        setB(true);
        const ghost = second.querySelector(".sheet-ghost");
        expect(ghost).not.toBeNull();
        expect(ghost?.textContent).toContain("Settings body");
        // Only a picture: nothing in it is reachable or announced.
        expect(ghost?.getAttribute("aria-hidden")).toBe("true");
        expect(ghost?.hasAttribute("inert")).toBe(true);
        // The new content is not what fades in: it is there, whole, beneath.
        expect(second.querySelector(".sheet-frame")?.textContent).toContain("Search body");
        fireEvent.animationEnd(ghost as Element);
        expect(second.querySelector(".sheet-ghost")).toBeNull();
      });

      it("has no ghost for a swap under reduced motion", () => {
        const reduced = pair(true);
        reduced.setA(true);
        reduced.setA(false);
        reduced.setB(true);
        expect(reduced.second.querySelector(".sheet-ghost")).toBeNull();
      });

      it("morphs to the height the new content has once it is rendered, not the one it has as it mounts", async () => {
        const { setA, setB, resize } = growing();
        setA(true);
        setA(false);
        setB(true);
        await settled();
        resize();
        const last = animate.mock.calls[animate.mock.calls.length - 1] as [
          Record<string, string>[],
        ];
        expect(last[0][last[0].length - 1]).toMatchObject({ height: "400px" });
      });

      it("retargets from the box the card has now, not the old card's, when its content lands mid-morph", async () => {
        const { setA, setB, resize } = growing();
        const cancel = vi.fn();
        animate.mockImplementation(() => ({ cancel, finished: new Promise(() => {}) }));
        setA(true);
        setA(false);
        setB(true);
        await settled();
        // Mid-morph: the card is 300 tall while its animation runs.
        midway.Search = 300;
        cancel.mockImplementation(() => delete midway.Search);
        resize();
        expect(cancel).toHaveBeenCalled();
        const last = animate.mock.calls[animate.mock.calls.length - 1] as [
          Record<string, string>[],
        ];
        expect(last[0][0]).toMatchObject({ height: "300px" });
        expect(last[0][last[0].length - 1]).toMatchObject({ height: "400px" });
      });
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
