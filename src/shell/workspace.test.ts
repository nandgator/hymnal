import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES } from "../persistence/user-state.ts";
import {
  DEFAULT_WORKSPACE,
  makeMain,
  moveTab,
  nextTab,
  normalizeWorkspace,
  selectTab,
  setSplit,
  visibleGroups,
  type Workspace,
  workspaceOf,
} from "./workspace.ts";

describe("normalizeWorkspace", () => {
  it("defaults when nothing is stored, or something unreadable is", () => {
    expect(workspaceOf(DEFAULT_PREFERENCES)).toEqual(DEFAULT_WORKSPACE);
    expect(normalizeWorkspace("split")).toEqual(DEFAULT_WORKSPACE);
    expect(normalizeWorkspace({ groups: [["hymn"]] })).toEqual(DEFAULT_WORKSPACE);
  });

  it("keeps a whole layout as stored", () => {
    const stored: Workspace = {
      groups: [["hymn", "recents"], []],
      active: ["recents", null],
      main: 0,
      split: false,
    };
    expect(normalizeWorkspace(stored)).toEqual(stored);
  });

  it("drops unknown tabs and a tab stored twice", () => {
    const ws = normalizeWorkspace({
      groups: [
        ["queue", "recents"],
        ["recents", "hymn"],
      ],
      active: ["queue", "hymn"],
      main: 1,
      split: true,
    });
    expect(ws.groups).toEqual([["recents"], ["hymn"]]);
    expect(ws.active).toEqual(["recents", "hymn"]);
  });

  it("adds a missing tab to the main group, so This hymn is always there", () => {
    const ws = normalizeWorkspace({ groups: [["recents"], []], active: [], main: 1, split: true });
    expect(ws.groups).toEqual([["recents"], ["hymn"]]);
    expect(ws.active).toEqual(["recents", "hymn"]);
  });

  it("never leaves main on an empty group", () => {
    const ws = normalizeWorkspace({
      groups: [["hymn", "recents"], []],
      active: ["hymn", null],
      main: 1,
      split: true,
    });
    expect(ws.main).toBe(0);
  });
});

describe("visibleGroups", () => {
  it("shows two groups side by side when split and there's room", () => {
    expect(visibleGroups(DEFAULT_WORKSPACE, true)).toEqual([
      { index: 0, tabs: ["recents"], active: "recents", main: false },
      { index: 1, tabs: ["hymn"], active: "hymn", main: true },
    ]);
  });

  it("merges when too narrow, in a fixed order, showing the main group's tab", () => {
    expect(visibleGroups(DEFAULT_WORKSPACE, false)).toEqual([
      { index: 1, tabs: ["hymn", "recents"], active: "hymn", main: true },
    ]);
  });

  it("merges when not split, and when a group is empty", () => {
    expect(visibleGroups(setSplit(DEFAULT_WORKSPACE, false), true)).toHaveLength(1);
    expect(visibleGroups(moveTab(DEFAULT_WORKSPACE, "recents"), true)).toHaveLength(1);
  });
});

describe("tab actions", () => {
  it("selecting a tab in a merged group makes its group main", () => {
    const ws = selectTab(DEFAULT_WORKSPACE, "recents", true);
    expect(ws.main).toBe(0);
    expect(visibleGroups(ws, false)[0]).toMatchObject({
      active: "recents",
      tabs: ["hymn", "recents"],
    });
  });

  it("selecting a tab side by side leaves main alone", () => {
    expect(selectTab(DEFAULT_WORKSPACE, "recents", false).main).toBe(1);
  });

  it("N steps through the main group's tabs, wrapping", () => {
    const once = nextTab(DEFAULT_WORKSPACE, false);
    expect(visibleGroups(once, false)[0].active).toBe("recents");
    expect(visibleGroups(nextTab(once, false), false)[0].active).toBe("hymn");
    // Split, the main group holds one tab: nothing to step to.
    expect(nextTab(DEFAULT_WORKSPACE, true)).toBe(DEFAULT_WORKSPACE);
  });

  it("moving a tab shows it in its new group; an emptied main passes on", () => {
    const ws = moveTab(DEFAULT_WORKSPACE, "hymn");
    expect(ws.groups).toEqual([["recents", "hymn"], []]);
    expect(ws.active).toEqual(["hymn", null]);
    expect(ws.main).toBe(0);
  });

  it("moving back restores two groups", () => {
    const back = moveTab(moveTab(DEFAULT_WORKSPACE, "recents"), "recents");
    expect(visibleGroups(back, true)).toHaveLength(2);
  });

  it("makes either group main", () => {
    expect(makeMain(DEFAULT_WORKSPACE, 0).main).toBe(0);
  });
});
