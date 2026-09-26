# 0017 — Fix the interface scale; only content scales with the screen

- **Status:** Accepted
- **Date:** 2026-09-26
- **Supersedes:** for the interface only, the continuous root scale of
  [SDD-0001 §15](../design/0001-domain-model.md) (Board #10).

## Context and Problem Statement

Board #10 made the whole app scale continuously with the window: the root
font size was `clamp(1rem, 0.85rem + 0.6vw, 1.75rem)`, so on a 1920px
window 1rem was about 25px and every rem-sized control ran at roughly 157%
of Material's size. Parts sized in px (the Live preview, some icons, the
dock's icon-only targets) did not grow, so the two sets drifted apart.
Reviewing the Operator redesign (Board #26), this read as out of
proportion: oversized list rows and buttons beside small icons, a label
threshold in rem hiding Repeat's label on a large screen, and no two
controls the same height. The premium feel the redesign is for depends on
proportion.

## Considered Options

- **Keep the continuous scale**, capped lower (about 18px).
- **Fix the interface; scale only content**, as Material 3, Apple, Figma
  and Notion do: window size changes the layout, never the size of the
  interface; text grows only by the user's own setting.

## Decision Outcome

Chosen: **fix the interface; scale only content.**

- The root font size is the browser's (16px by default) times the user's
  `--font-scale` (A−/A+ in Settings). The window's width changes the
  layout — size classes, panes, the tab groups — never the interface's
  size.
- Content keeps its screen-relative size: the Operator's lyrics
  (`hymn-display`, a `clamp()` with a `vw` term, its bounds in rem so A−/A+
  still moves them) and the Output (`output-line`, container units).
- Controls take one height per role: 40px (2.5rem) in the stage, 48px
  (3rem) in the dock, 56px (3.5rem) for Show Output.

### Consequences

- Good: controls and icons stay in proportion at any window size, as the
  platforms' own guidance intends; the user's text size remains the one
  scale control.
- Good: rem thresholds (Repeat's label) now mean the same everywhere.
- Bad: on a large display the interface is relatively smaller than
  before; the lyrics, which the operator reads, still grow.
- Revisit if an interface scale separate from text size is asked for
  (Figma's users asked for exactly that).
