import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FullSong, type FullSongProps, forgetLayouts, signature } from "./FullSong.tsx";
import * as rule from "./fullSong.ts";

// Counts the layouts: a layout is one run of the rule.
vi.mock("./fullSong.ts", async (original) => {
  const actual = await original<typeof import("./fullSong.ts")>();
  return { ...actual, layoutSong: vi.fn(actual.layoutSong) };
});

// Until what is scheduled has run, not for a fixed time: a layout waits for the
// next frame, and under CPU load 30ms might not reach one. Callbacks run in the
// order they were asked for, so a frame asked for now runs after any already
// waiting; the timeout then lets what they started finish.
const settle = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));

// jsdom has no layout: give the sheet a box (1080p by default).
const box = (name: "clientWidth" | "clientHeight" | "offsetHeight", value: number) =>
  Object.defineProperty(HTMLElement.prototype, name, { value, configurable: true });
const unbox = () => {
  for (const name of ["clientWidth", "clientHeight", "offsetHeight"] as const)
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
};
beforeEach(() => {
  forgetLayouts();
  box("clientWidth", 1728);
  box("clientHeight", 864);
});
afterEach(() => {
  unbox();
  vi.mocked(rule.layoutSong).mockClear();
});

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

  it("marks the parts that carry a marker, small above the lines, never among them", () => {
    const parts = [
      { id: "s1", lines: ["One a", "One b"], marker: "1" },
      { id: "c", lines: ["Chorus a", "Chorus b"], marker: "Chorus" },
      { id: "s2", lines: ["Two a", "Two b"] },
    ];
    const { container } = render(() => <FullSong {...props({ parts })} />);
    const marks = [...container.querySelectorAll(".full-marker")].map((m) => m.textContent);
    expect(marks).toEqual(["1", "Chorus"]);
    // Above the first line, and not one of the lit lines.
    const first = container.querySelector(".full-part") as HTMLElement;
    expect(first.firstElementChild).toHaveClass("full-marker");
    expect(lit(container)).toEqual(["Chorus a", "Chorus b"]);
    expect(container.querySelectorAll(".full-line")).toHaveLength(6);
  });

  it("lays out again for a marker, which takes room", async () => {
    const parts = PARTS.map((p) => ({ ...p, marker: "1" }));
    const [shown, setShown] = createSignal(PARTS as typeof parts);
    render(() => <FullSong {...props({ parts: shown() })} />);
    await settle();
    const before = vi.mocked(rule.layoutSong).mock.calls.length;
    setShown(parts);
    await settle();
    expect(vi.mocked(rule.layoutSong).mock.calls.length).toBeGreaterThan(before);
  });

  it("lights nothing for a part it does not hold", () => {
    const { container } = render(() => <FullSong {...props({ current: "zz" })} />);
    expect(lit(container)).toEqual([]);
  });

  describe("laying out", () => {
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
      void container;
      const count = {
        get n() {
          return vi.mocked(rule.layoutSong).mock.calls.length;
        },
      };
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

// A song too long for one page at the floor: six parts of twelve lines in a
// short box. Its parts, in printed order, are s1..s6.
const LONG = Array.from({ length: 6 }, (_, i) => ({
  id: `s${i + 1}`,
  lines: Array.from({ length: 12 }, (_, k) => `Verse ${i + 1} line ${k + 1} of the hymn`),
}));

describe("pages", () => {
  const pagesIn = (container: HTMLElement) =>
    [...container.querySelectorAll<HTMLElement>(".full-page")].map((p) => [
      p.dataset.page,
      p.dataset.turn,
    ]);

  it("turns a page with both pages mounted, never none, the old one gone at the end", async () => {
    box("clientHeight", 120);
    const [current, setCurrent] = createSignal("s1");
    const { container } = render(() => (
      <FullSong {...props({ parts: LONG, current: current() })} />
    ));
    await settle();
    expect(pagesIn(container)).toEqual([["0", undefined]]);
    const onFirst = [...container.querySelectorAll("[data-part-index]")].map((e) =>
      Number((e as HTMLElement).dataset.partIndex),
    );
    expect(onFirst.length).toBeLessThan(LONG.length); // it is paged

    setCurrent("s6");
    await Promise.resolve();
    // Both are there at once, and the tint is on the new part's page.
    expect(pagesIn(container)).toEqual([
      ["0", "out"],
      ["1", "in"],
    ]);
    expect(container.querySelectorAll(".full-page").length).toBe(2);
    const out = container.querySelector(".full-page[data-turn='in']") as HTMLElement;
    out.dispatchEvent(new Event("animationend", { bubbles: true }));
    await settle();
    expect(pagesIn(container)).toEqual([["1", undefined]]);
    expect(container.querySelector(".full-part-current")).toHaveTextContent("Verse 6 line 1");
  });

  it("puts the tint on the new part once its page is there", async () => {
    // jsdom has no layout: a part sits 10px down per index.
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.partIndex ? Number(this.dataset.partIndex) * 10 : 0;
      },
    });
    try {
      box("clientHeight", 120);
      const [current, setCurrent] = createSignal("s1");
      const { container } = render(() => (
        <FullSong {...props({ parts: LONG, current: current() })} />
      ));
      await settle();
      const tint = container.querySelector(".full-tint") as HTMLElement;
      expect(tint.style.transform).toBe("translate(0px, 0px)");
      setCurrent("s6");
      await settle();
      expect(tint.style.transform).toBe("translate(0px, 50px)");
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetTop;
    }
  });

  it("a step during a turn goes on from where the dissolve is, not as a cut: the pages still sum to one", async () => {
    const animate = vi.fn((..._args: unknown[]) => ({
      finished: new Promise(() => {}),
      cancel: vi.fn(),
      addEventListener: vi.fn(),
      playState: "running",
    }));
    HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
    vi.stubGlobal(
      "DOMMatrix",
      class {
        m41 = 0;
        m42 = 0;
      },
    );
    try {
      box("clientHeight", 120);
      const [current, setCurrent] = createSignal("s1");
      const { container } = render(() => (
        <FullSong {...props({ parts: LONG, current: current() })} />
      ));
      await settle();
      setCurrent("s6");
      await Promise.resolve();
      expect(pagesIn(container)).toEqual([
        ["0", "out"],
        ["1", "in"],
      ]);
      animate.mockClear();
      // Back again before the turn is done. Only microtasks pass here: the turn's
      // guard (a real 600ms timer) must not get a turn of its own, which a busy
      // machine can hand it between a step and a wait of any length.
      setCurrent("s1");
      await Promise.resolve();
      expect(pagesIn(container)).toEqual([
        ["0", "manual"],
        ["1", "manual"],
      ]);
      // The pages' own animations (the tint's move by translate, not translateY).
      const ends: number[] = [];
      for (const call of animate.mock.calls as unknown as [Keyframe[]][]) {
        const keys = call[0];
        if (String(keys[0].transform).startsWith("translateY")) ends.push(Number(keys[1].opacity));
      }
      // One page going to full, the other to none: nothing cut, nothing blank.
      expect(ends.sort()).toEqual([0, 1]);
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate;
      vi.unstubAllGlobals();
    }
  });

  it("steps within a page without a turn", async () => {
    box("clientHeight", 120);
    const [current, setCurrent] = createSignal("s1");
    const { container } = render(() => (
      <FullSong {...props({ parts: LONG, current: current() })} />
    ));
    await settle();
    setCurrent("s2");
    await settle();
    expect(pagesIn(container)).toEqual([["0", undefined]]);
  });

  it("ends a turn that never reports its end", async () => {
    vi.useFakeTimers();
    try {
      box("clientHeight", 120);
      const [current, setCurrent] = createSignal("s1");
      const { container } = render(() => (
        <FullSong {...props({ parts: LONG, current: current() })} />
      ));
      await vi.advanceTimersByTimeAsync(50);
      setCurrent("s6");
      await vi.advanceTimersByTimeAsync(10);
      expect(container.querySelectorAll(".full-page").length).toBe(2);
      await vi.advanceTimersByTimeAsync(700);
      expect(container.querySelectorAll(".full-page").length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("checking the layout in the page", () => {
  it("makes the layout again for a smaller room when the page overflows", async () => {
    // The browser says every block is far too tall, so each nudge is tried,
    // and the type goes down with them, to a stop.
    box("offsetHeight", 5000);
    const { container } = render(() => <FullSong {...props()} />);
    await settle();
    const calls = vi.mocked(rule.layoutSong).mock.calls;
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.length).toBeLessThanOrEqual(9);
    const rooms = calls.map((c) => c[2]);
    expect(rooms[1]).toBeLessThan(rooms[0]);
    expect(rooms.at(-1)).toBeLessThan(rooms[1]);
    expect(container.querySelectorAll(".full-part")).toHaveLength(PARTS.length);
  });

  it("leaves a layout that fits alone", async () => {
    box("offsetHeight", 100);
    render(() => <FullSong {...props()} />);
    await settle();
    expect(vi.mocked(rule.layoutSong).mock.calls).toHaveLength(1);
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
