import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FullSong, type FullSongProps, signature } from "./FullSong.tsx";

const PARTS = [
  { id: "s1", lines: ["One a", "One b"] },
  { id: "c", lines: ["Chorus a", "Chorus b"] },
  { id: "s2", lines: ["Two a", "Two b"] },
];

const props = (over: Partial<FullSongProps> = {}): FullSongProps => ({
  parts: PARTS,
  current: "c",
  lit: null,
  safeTop: 0.1,
  safeBottom: 0.1,
  songKey: "book:1",
  ...over,
});

const lit = (container: HTMLElement) =>
  [...container.querySelectorAll(".full-line-lit")].map((el) => el.textContent);

describe("FullSong", () => {
  it("shows every part once, in printed order", () => {
    const { container } = render(() => <FullSong {...props()} />);
    const text = [...container.querySelectorAll(".full-part")].map((p) =>
      [...p.querySelectorAll(".full-line")].map((l) => l.textContent).join("|"),
    );
    expect(text).toEqual(["One a|One b", "Chorus a|Chorus b", "Two a|Two b"]);
  });

  it("lights the current part only, and marks it", () => {
    const { container } = render(() => <FullSong {...props()} />);
    expect(lit(container)).toEqual(["Chorus a", "Chorus b"]);
    const current = container.querySelectorAll(".full-part-current");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("Chorus a");
    expect(container.querySelector(".full-tint")).toBeInTheDocument();
  });

  it("under line focus lights the one line, the part still marked", () => {
    const { container } = render(() => <FullSong {...props({ lit: { start: 1, end: 2 } })} />);
    expect(lit(container)).toEqual(["Chorus b"]);
    expect(container.querySelector(".full-part-current")).toHaveTextContent("Chorus a");
  });

  it("lights every line, and shows no tint, for the whole-song highlight", () => {
    const { container } = render(() => <FullSong {...props({ all: true })} />);
    expect(lit(container)).toHaveLength(6);
    expect(container.querySelector(".full-song")).toHaveAttribute("data-lit", "all");
  });

  it("lights nothing for a part it does not hold", () => {
    const { container } = render(() => <FullSong {...props({ current: "zz" })} />);
    expect(lit(container)).toEqual([]);
  });

  describe("laying out", () => {
    // A layout builds hidden probe columns, one per measure: counting them
    // counts the layouts (each makes several).
    const probes = (container: HTMLElement) => {
      const count = { n: 0 };
      new MutationObserver((records) => {
        for (const r of records)
          for (const node of r.addedNodes)
            if ((node as HTMLElement).classList?.contains("full-probe")) count.n++;
      }).observe(container, { childList: true, subtree: true });
      return count;
    };
    const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
    afterEach(() => {
      vi.restoreAllMocks();
      // biome-ignore lint/suspicious/noExplicitAny: the test's stub of document.fonts
      delete (document as any).fonts;
    });

    it("does not lay out again for a step, but does for an edit and for a font arriving", async () => {
      const fonts = new EventTarget() as EventTarget & { ready: Promise<void> };
      fonts.ready = Promise.resolve();
      Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
      const [current, setCurrent] = createSignal("s1");
      const [parts, setParts] = createSignal(PARTS);
      const { container } = render(() => (
        <FullSong {...props({ current: current(), parts: parts() })} />
      ));
      const count = probes(container);
      await settle();
      const first = count.n;

      setCurrent("c");
      await settle();
      expect(count.n).toBe(first); // a step moves the tint, nothing more

      setParts(PARTS.map((p, i) => (i === 0 ? { ...p, lines: ["One a", "Changed"] } : p)));
      await settle();
      const edited = count.n;
      expect(edited).toBeGreaterThan(first); // same key, new text: laid out again

      fonts.dispatchEvent(new Event("loadingdone"));
      await settle();
      expect(count.n).toBeGreaterThan(edited); // a font arrived: measured again
    });
  });
});

describe("signature", () => {
  it("is the same for the same parts and differs for any change of text, order or count", () => {
    const a = signature(PARTS);
    expect(signature(PARTS.map((p) => ({ ...p, lines: [...p.lines] })))).toBe(a);
    expect(signature([PARTS[1], PARTS[0], PARTS[2]])).not.toBe(a);
    expect(signature(PARTS.slice(0, 2))).not.toBe(a);
    expect(signature([{ ...PARTS[0], lines: ["One a", "One c"] }, ...PARTS.slice(1)])).not.toBe(a);
    // A line moved between parts changes it though the lines are the same.
    expect(
      signature([
        { id: "s1", lines: ["One a"] },
        { id: "c", lines: ["One b", "Chorus a", "Chorus b"] },
        PARTS[2],
      ]),
    ).not.toBe(a);
  });
});
