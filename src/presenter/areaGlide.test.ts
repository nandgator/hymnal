import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { glideAreas } from "./areaGlide.ts";

type Frame = Record<string, string | number>;
type Run = { el: Element; frames: Frame[]; finish: () => void };

let runs: Run[];
let widths: Map<Element, number>;

const section = (id: string, main: boolean) => {
  const el = document.createElement("section");
  el.className = main ? "area area-main" : "area";
  el.id = id;
  el.innerHTML = `<div class="area-header"><h3 id="${id}-title">T</h3></div><div class="area-body"><div class="area-tab-content">x</div></div>`;
  return el;
};

const makeRow = (...areas: HTMLElement[]) => {
  const row = document.createElement("div");
  const stage = document.createElement("aside");
  stage.className = "area stage";
  row.append(...areas, stage);
  document.body.append(row);
  return row;
};

beforeEach(() => {
  runs = [];
  widths = new Map();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const width = widths.get(this) ?? 0;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0 } as DOMRect;
  };
  Element.prototype.animate = function (
    this: Element,
    frames: Keyframe[] | PropertyIndexedKeyframes,
  ) {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    runs.push({ el: this, frames: frames as Frame[], finish });
    return { finished, cancel: () => {} } as unknown as Animation;
  };
  Element.prototype.getAnimations = () => [];
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const runWhere = (test: (el: Element) => boolean): Run => {
  const run = runs.find((r) => test(r.el));
  if (!run) throw new Error("no such animation");
  return run;
};

const basis = (frame: Frame) => parseFloat(String(frame.flexBasis));

describe("glideAreas closing a group", () => {
  it("collapses the closed group in its own slot, so the row is never short", async () => {
    const side = section("side", false);
    const main = section("main", true);
    const row = makeRow(side, main);
    widths.set(side, 360);
    widths.set(main, 600);
    glideAreas(row, () => {
      side.remove();
      widths.set(main, 960);
    });
    // The survivor grows from the main group's width.
    const grow = runWhere((el) => el === main);
    expect(basis(grow.frames[0])).toBe(600);
    expect(basis(grow.frames[1])).toBe(960);
    // A ghost of the closed group sits where it was and shrinks to nothing.
    const ghostRun = runWhere(
      (el) => el.getAttribute("aria-hidden") === "true" && el.tagName === "SECTION",
    );
    const ghost = ghostRun.el as HTMLElement;
    expect(row.firstElementChild).toBe(ghost);
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect(ghost.hasAttribute("inert")).toBe(true);
    expect(ghost.querySelector("[id]")).toBeNull();
    expect(basis(ghostRun.frames[0])).toBe(360);
    expect(basis(ghostRun.frames[1])).toBe(0);
    ghostRun.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(ghost.isConnected).toBe(false);
  });

  it("puts a ghost that was after the survivor after it", () => {
    const main = section("main", true);
    const side = section("side", false);
    const row = makeRow(main, side);
    widths.set(main, 600);
    widths.set(side, 360);
    glideAreas(row, () => {
      side.remove();
      widths.set(main, 960);
    });
    const ghost = runWhere(
      (el) => el.getAttribute("aria-hidden") === "true" && el.tagName === "SECTION",
    ).el;
    expect(ghost.previousElementSibling).toBe(main);
  });

  it("does not replay a tab's zoom-in on content that only changed slots", () => {
    const side = section("side", false);
    const main = section("main", true);
    const row = makeRow(side, main);
    widths.set(side, 360);
    widths.set(main, 600);
    const zoom = { animationName: "tab-in", cancel: vi.fn() };
    let applied = false;
    // The zoom starts on the content the state change mounts, not before.
    Element.prototype.getAnimations = (() =>
      applied ? [zoom] : []) as unknown as Element["getAnimations"];
    glideAreas(row, () => {
      applied = true;
      side.remove();
    });
    expect(zoom.cancel).toHaveBeenCalled();
  });
});
