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
      return {
        setA,
        setB,
        first: first as HTMLDialogElement,
        second: second as HTMLDialogElement,
      };
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
    const sizes: Record<string, [number, number]> = {
      Settings: [576, 400],
      Search: [576, 200],
    };
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
      return {
        setA,
        setB,
        first: first as HTMLDialogElement,
        second: second as HTMLDialogElement,
      };
    }
    const settled = () => Promise.resolve();
    // The card's morph: animate calls on a dialog (the content's settle runs on its frame).
    const morphs = () =>
      animate.mock.calls.filter((_, i) => animate.mock.contexts[i] instanceof HTMLDialogElement);
    const settles = () =>
      animate.mock.calls
        .map((call, i) => ({
          call: call as [Record<string, string>[], KeyframeAnimationOptions],
          el: animate.mock.contexts[i] as HTMLElement,
        }))
        .filter(({ el }) => el.classList.contains("sheet-frame"));

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
      expect(morphs()).toHaveLength(1);
      const [keyframes] = morphs()[0] as [Record<string, string>[]];
      expect(animate.mock.contexts[animate.mock.calls.indexOf(morphs()[0] as never)]).toBe(second);
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
      expect(morphs()).toHaveLength(1);
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
        return {
          setA,
          setB,
          resize,
          first,
          second: second as HTMLDialogElement,
          view,
        };
      }

      it("settles the new content in on the card: a short scale and fade on the frame, anchored at the top centre", () => {
        const { setA, setB, second } = pair();
        setA(true);
        setA(false);
        setB(true);
        const [settle] = settles();
        expect(settle?.el.parentElement).toBe(second);
        const [keyframes, options] = settle?.call ?? [[], {}];
        expect(keyframes[0]).toMatchObject({
          opacity: 0.4,
          transform: "scale(0.98)",
        });
        expect(keyframes[keyframes.length - 1]).toMatchObject({
          opacity: 1,
          transform: "scale(1)",
        });
        expect(options.duration).toBeGreaterThanOrEqual(150);
        expect(options.duration).toBeLessThanOrEqual(220);
        expect(options.easing).toBeTruthy();
        expect(settle?.el.style.transformOrigin).toBe("50% 0");
        // The card itself never fades.
        for (const [frames] of morphs() as [Record<string, string>[]][])
          for (const frame of frames) expect(frame).not.toHaveProperty("opacity");
      });

      it("never shows the old content over the new: nothing of it is left once the swap starts", () => {
        const { setA, setB, first, second } = pair();
        setA(true);
        setA(false);
        setB(true);
        expect(second.querySelector(".sheet-ghost")).toBeNull();
        expect(second.textContent).not.toContain("Settings body");
        expect(first.textContent).not.toContain("Settings body");
        expect(second.querySelector(".sheet-frame")?.textContent).toContain("Search body");
      });

      it("has no scale and no settle for a swap under reduced motion", () => {
        const reduced = pair(true);
        reduced.setA(true);
        reduced.setA(false);
        reduced.setB(true);
        expect(settles()).toHaveLength(0);
        expect(reduced.second.querySelector(".sheet-ghost")).toBeNull();
        expect(reduced.second.textContent).not.toContain("Settings body");
      });

      it("starts each settle afresh in a quick alternation, ending the one before", () => {
        const { setA, setB } = pair();
        const cancel = vi.fn();
        animate.mockImplementation(() => ({
          cancel,
          finished: new Promise(() => {}),
        }));
        setA(true);
        setA(false);
        setB(true);
        setB(false);
        setA(true);
        setA(false);
        setB(true);
        expect(settles()).toHaveLength(3);
        for (const { call } of settles()) expect(call[0][0]).toMatchObject({ opacity: 0.4 });
        // Each new swap ends the previous settle rather than stacking on it.
        expect(cancel.mock.calls.length).toBeGreaterThanOrEqual(2);
      });

      it("carries on from where the leaving content's settle had got to, so a swap mid-settle neither dips nor jumps", () => {
        const { setA, setB } = pair();
        animate.mockImplementation(() => ({
          cancel: vi.fn(),
          playState: "running",
          finished: new Promise(() => {}),
        }));
        const real = window.getComputedStyle.bind(window);
        vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
          const style = real(el, pseudo);
          if (!(el as HTMLElement).classList?.contains("sheet-frame")) return style;
          return new Proxy(style, {
            get: (target, key) =>
              key === "opacity"
                ? "0.8"
                : key === "transform"
                  ? "matrix(0.99, 0, 0, 0.99, 0, 0)"
                  : Reflect.get(target, key),
          });
        });
        setA(true);
        setA(false);
        setB(true);
        // B is mid-settle (0.8, scale 0.99) when A takes the card back.
        setB(false);
        setA(true);
        const mine = settles();
        expect(mine).toHaveLength(2);
        expect(mine[0]?.call[0][0]).toMatchObject({ opacity: 0.4, transform: "scale(0.98)" });
        expect(mine[1]?.call[0][0]).toMatchObject({ opacity: 0.8, transform: "scale(0.99)" });
        vi.restoreAllMocks();
      });

      it("morphs to the height the new content has once it is rendered, not the one it has as it mounts", async () => {
        const { setA, setB, resize } = growing();
        setA(true);
        setA(false);
        setB(true);
        await settled();
        resize();
        const last = morphs()[morphs().length - 1] as [Record<string, string>[]];
        expect(last[0][last[0].length - 1]).toMatchObject({ height: "400px" });
      });

      it("retargets from the box the card has now, not the old card's, when its content lands mid-morph", async () => {
        const { setA, setB, resize } = growing();
        const cancel = vi.fn();
        animate.mockImplementation(() => ({
          cancel,
          finished: new Promise(() => {}),
        }));
        setA(true);
        setA(false);
        setB(true);
        await settled();
        // Mid-morph: the card is 300 tall while its animation runs.
        midway.Search = 300;
        cancel.mockImplementation(() => delete midway.Search);
        resize();
        expect(cancel).toHaveBeenCalled();
        const last = morphs()[morphs().length - 1] as [Record<string, string>[]];
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
          ? {
              id: "keys",
              title: "Keyboard Shortcuts",
              content: () => <p>Keys</p>,
              direct: true,
            }
          : undefined,
      );
      const onClose = vi.fn(() => setOpen(false));
      const onBack = vi.fn(() => setPage(undefined));
      const view = render(() => (
        <Sheet open={open()} onClose={onClose} title="Settings" page={page()} onBack={onBack}>
          <button
            type="button"
            onClick={() =>
              setPage({
                id: "keys",
                title: "Keyboard Shortcuts",
                content: () => <p>Keys</p>,
              })
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
      const row = screen.getByRole("button", {
        name: "Keyboard Shortcuts row",
      });
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
