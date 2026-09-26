import type { Preferences } from "../persistence/user-state.ts";

/** A supporting pane the operator may hide (SDD-0001 §16.4). */
export type PaneId = "live";

export interface Pane {
  id: PaneId;
  /** As it reads mid-sentence: "Show Live", "Hide sidebar". */
  name: string;
  /** What it is, for Settings. */
  description: string;
  /** Its show/hide key, if it has one. */
  key?: string;
}

/**
 * The registry: Settings, the command menu and the keymap read it, so a
 * future pane is one more entry plus where it renders. This song, the
 * part keypad and the dock aren't here: they're the controls, never hidden.
 */
export const PANES: Pane[] = [
  { id: "live", name: "Live", description: "What the Output shows now", key: "L" },
];

/** Absent means shown: an unknown id is ignored, a new one starts visible. */
export function isPaneShown(preferences: Preferences, id: PaneId): boolean {
  return preferences.panes?.[id] ?? true;
}
