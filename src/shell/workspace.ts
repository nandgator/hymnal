import type { Preferences } from "../persistence/user-state.ts";

/**
 * The Operator's tabs, in at most two groups (SDD-0001 §16.4, Board #26).
 * What they see (Live, Parts) and the dock aren't tabs: they never move.
 */
export type TabId = "hymn" | "recents";

export interface Tab {
  id: TabId;
  name: string;
}

/** Every tab, in the order a merged group lists them when nothing says otherwise. */
export const TABS: Tab[] = [
  { id: "hymn", name: "This hymn" },
  { id: "recents", name: "Recents" },
];

export type GroupIndex = 0 | 1;

export interface Workspace {
  /** A tab is in exactly one group; a group may be empty, and then closes. */
  groups: [TabId[], TabId[]];
  /** Each group's showing tab; null only for an empty group. */
  active: [TabId | null, TabId | null];
  /** The group that takes the room. */
  main: GroupIndex;
  /** Side by side, or merged into one tabbed area. */
  split: boolean;
}

export const DEFAULT_WORKSPACE: Workspace = {
  groups: [["recents"], ["hymn"]],
  active: ["recents", "hymn"],
  main: 1,
  split: true,
};

/** One group as it renders: two when split and there's room, else one merged. */
export interface VisibleGroup {
  /** The stored group it stands for; a merged group stands for the main one. */
  index: GroupIndex;
  tabs: TabId[];
  active: TabId;
  main: boolean;
}

const KNOWN = new Set<string>(TABS.map((tab) => tab.id));
const other = (group: GroupIndex): GroupIndex => (group === 0 ? 1 : 0);

/**
 * A stored layout, made whole: unknown tabs dropped, a tab in both groups
 * kept in the first, a missing one added to the main group, each group's
 * active tab one it holds, and main never an empty group. Anything else
 * falls back to the default, so a stored value never needs migrating.
 */
export function normalizeWorkspace(value: unknown): Workspace {
  if (typeof value !== "object" || value === null) return DEFAULT_WORKSPACE;
  const stored = value as Partial<Record<keyof Workspace, unknown>>;
  if (!Array.isArray(stored.groups) || stored.groups.length !== 2) return DEFAULT_WORKSPACE;

  const seen = new Set<TabId>();
  const groups = stored.groups.map((group) =>
    (Array.isArray(group) ? group : []).filter((id): id is TabId => {
      if (typeof id !== "string" || !KNOWN.has(id) || seen.has(id as TabId)) return false;
      seen.add(id as TabId);
      return true;
    }),
  ) as [TabId[], TabId[]];

  let main: GroupIndex =
    stored.main === 0 || stored.main === 1 ? stored.main : DEFAULT_WORKSPACE.main;
  for (const tab of TABS) if (!seen.has(tab.id)) groups[main].push(tab.id);
  if (groups[main].length === 0) main = other(main);

  const storedActive = Array.isArray(stored.active) ? stored.active : [];
  const active = groups.map((group, i) =>
    group.includes(storedActive[i]) ? (storedActive[i] as TabId) : (group[0] ?? null),
  ) as Workspace["active"];

  const split = typeof stored.split === "boolean" ? stored.split : DEFAULT_WORKSPACE.split;
  return { groups, active, main, split };
}

export const workspaceOf = (preferences: Preferences): Workspace =>
  normalizeWorkspace(preferences.workspace);

const groupOf = (workspace: Workspace, tab: TabId): GroupIndex =>
  workspace.groups[0].includes(tab) ? 0 : 1;

/**
 * What renders. Two groups only when split, there's room and neither is
 * empty; otherwise one, the main group's tabs first, showing the main
 * group's active tab.
 */
export function visibleGroups(workspace: Workspace, canSplit: boolean): VisibleGroup[] {
  const { groups, active, main } = workspace;
  if (workspace.split && canSplit && groups[0].length > 0 && groups[1].length > 0) {
    return ([0, 1] as const).map((index) => ({
      index,
      tabs: groups[index],
      active: active[index] ?? groups[index][0],
      main: index === main,
    }));
  }
  const tabs = [...groups[main], ...groups[other(main)]];
  return [{ index: main, tabs, active: active[main] ?? tabs[0], main: true }];
}

/**
 * Shows a tab. Merged, the tab's group also becomes main, so the one
 * showing stays in front when the groups split again.
 */
export function selectTab(workspace: Workspace, tab: TabId, merged: boolean): Workspace {
  const group = groupOf(workspace, tab);
  const active = [...workspace.active] as Workspace["active"];
  active[group] = tab;
  return { ...workspace, active, main: merged ? group : workspace.main };
}

/** The next tab of the main visible group, wrapping — the N key. */
export function nextTab(workspace: Workspace, canSplit: boolean): Workspace {
  const group = visibleGroups(workspace, canSplit).find((g) => g.main);
  if (!group || group.tabs.length < 2) return workspace;
  const next = group.tabs[(group.tabs.indexOf(group.active) + 1) % group.tabs.length];
  const merged = visibleGroups(workspace, canSplit).length === 1;
  return selectTab(workspace, next, merged);
}

/**
 * Moves a tab to the other group, showing it there. A group left empty
 * closes; if it was main, main passes to the group the tab went to.
 */
export function moveTab(workspace: Workspace, tab: TabId): Workspace {
  const from = groupOf(workspace, tab);
  const to = other(from);
  const groups = [[...workspace.groups[0]], [...workspace.groups[1]]] as Workspace["groups"];
  groups[from] = groups[from].filter((id) => id !== tab);
  groups[to].push(tab);
  const active = [...workspace.active] as Workspace["active"];
  active[to] = tab;
  if (active[from] === tab) active[from] = groups[from][0] ?? null;
  const main = groups[workspace.main].length === 0 ? to : workspace.main;
  return { ...workspace, groups, active, main };
}

export const makeMain = (workspace: Workspace, group: GroupIndex): Workspace => ({
  ...workspace,
  main: group,
});

export const setSplit = (workspace: Workspace, split: boolean): Workspace => ({
  ...workspace,
  split,
});
