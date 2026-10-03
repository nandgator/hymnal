import { DEFAULT_ROWS, glideRows, type RowGlide } from "./hoverGlide.ts";
import { type SelectGlide, type SelectGlideOptions, selectGlide } from "./selectGlide.ts";

export interface GlideListOptions {
  /** The rows the hover highlight follows (default: enabled buttons and links). */
  rows?: string;
  /** What marks the selected row. Omit for a list with no selection. */
  current?: string;
  /** The element whose box the selected pill takes (default: the row itself). */
  target?: SelectGlideOptions["target"];
  /** The pill's class, for its look (default `select-pill`). */
  pill?: string;
}

export interface GlideList {
  /** The hover layer, for a highlight something besides the pointer drives. */
  hover: RowGlide;
  /** The selection pill, for a selection the DOM doesn't announce. */
  select: SelectGlide | undefined;
  stop(): void;
}

/**
 * The app's list motion in one call: a hover highlight that glides between
 * rows (hoverGlide.ts) and, if the list has a selection, the tonal pill that
 * glides to the chosen row (selectGlide.ts). `list` must be positioned and
 * isolated (`.glide-list`, or its own rule). In a Solid component:
 * `ref={(el) => onCleanup(glideList(el, { current: "..." }).stop)}`.
 */
export function glideList(list: HTMLElement, options: GlideListOptions = {}): GlideList {
  const hover = glideRows(list, options.rows ?? DEFAULT_ROWS);
  const select = options.current
    ? selectGlide(list, {
        current: options.current,
        target: options.target,
        className: options.pill,
      })
    : undefined;
  return {
    hover,
    select,
    stop: () => {
      select?.stop();
      hover.stop();
    },
  };
}
