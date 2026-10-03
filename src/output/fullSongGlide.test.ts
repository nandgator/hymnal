import { describe, expect, it } from "vitest";
import { CROSS_TRAVEL_EM, crossFrames, TURN_IN_START, TURN_OUT } from "./fullSongGlide.ts";

const from = { x: 100, y: 50, w: 400, h: 200 };
const to = { x: 700, y: 300, w: 300, h: 160 };

describe("crossFrames", () => {
  it("fades the old tint out in place, and the new one in, travelling from the left", () => {
    const { ghost, tint } = crossFrames(from, to, 10);
    expect(ghost[0]).toMatchObject({ opacity: 1, transform: "translate(100px, 50px)" });
    expect(ghost[1]).toMatchObject({ opacity: 0, transform: "translate(100px, 50px)" });
    expect(tint[0]).toMatchObject({
      opacity: 0,
      transform: `translate(${700 - CROSS_TRAVEL_EM * 10}px, 300px)`,
    });
    expect(tint[1]).toMatchObject({ opacity: 1, transform: "translate(700px, 300px)" });
  });

  it("for a page turn rises into place instead of travelling sideways", () => {
    const { ghost, tint } = crossFrames(from, to, 10, 0, 12);
    expect(tint[0]).toMatchObject({ opacity: 0, transform: "translate(700px, 312px)" });
    expect(tint[1]).toMatchObject({ opacity: 1, transform: "translate(700px, 300px)" });
    expect(ghost[1]).toMatchObject({ opacity: 0, transform: "translate(100px, 50px)" });
  });
});

describe("a page turn's timing", () => {
  it("fades the old tint out as the new one fades in, over one window: never blank, never both clear", () => {
    // Opacities that sum to one at every moment: the lesser is never above
    // half, the greater never below it.
    expect(TURN_IN_START).toBe(0);
    expect(TURN_OUT).toBe(1);
  });
});
