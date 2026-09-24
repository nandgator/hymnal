---
version: alpha
name: hymnal-presenter-design
description: A devotional presentation tool built on Material Design 3's tonal color system, seeded from an amber/brass hue (gilt hymnal pages, brass fixtures) rather than Google's default purple. Split into two audiences on two screens — an Operator view carrying full MD3 chrome (filled/tonal/outlined buttons, filter chips, an outlined text field, an extended FAB), and a chrome-less Output view built on teleprompter conventions (one continuous scroll of the whole hymn, the sung part or line lit and centred, a safe-area margin, no labels, ever). Dark-first; read across a room, sometimes in low light, by people not thinking about software.

colors:
  primary: "#ffb951"
  on-primary: "#452b00"
  primary-container: "#653f00"
  on-primary-container: "#ffddb1"
  secondary: "#ddc2a1"
  on-secondary: "#3d2e17"
  secondary-container: "#56442b"
  on-secondary-container: "#fadebc"
  surface: "#17130d"
  on-surface: "#eae1d9"
  surface-variant: "#4f4539"
  on-surface-variant: "#d3c4b4"
  outline: "#9c8f80"
  outline-variant: "#4f4539"
  surface-container-lowest: "#120f0a"
  surface-container-low: "#201a12"
  surface-container: "#241e15"
  surface-container-high: "#2f2819"
  inverse-surface: "#eae1d9"
  inverse-on-surface: "#362f26"
  output-ground: "#0c0b10"
  output-ink: "#f6f1e6"
  output-ink-muted: "#a89e86"

colors-light:
  primary: "#8b5a00"
  on-primary: "#ffffff"
  primary-container: "#ffddb1"
  on-primary-container: "#2a1800"
  secondary: "#6f5b40"
  on-secondary: "#ffffff"
  secondary-container: "#fadebc"
  on-secondary-container: "#271904"
  surface: "#fff8f3"
  on-surface: "#201a12"
  surface-variant: "#efe0ce"
  on-surface-variant: "#4f4539"
  outline: "#817567"
  outline-variant: "#d3c4b4"
  surface-container-lowest: "#ffffff"
  surface-container-low: "#fbf1e6"
  surface-container: "#f5ecdf"
  surface-container-high: "#f0e6d9"
  inverse-surface: "#362f26"
  inverse-on-surface: "#fbeee1"

typography:
  display-small:
    fontFamily: "Hymnal Sans, Roboto, system-ui, sans-serif"
    fontSize: 36px
    fontWeight: 400
    lineHeight: 44px
    letterSpacing: 0
  title-large:
    fontFamily: "Hymnal Sans, Roboto, system-ui, sans-serif"
    fontSize: 22px
    fontWeight: 500
    lineHeight: 28px
    letterSpacing: 0
  title-medium:
    fontFamily: "Hymnal Sans, Roboto, system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: 0.15px
  label-large:
    fontFamily: "Hymnal Sans, Roboto, system-ui, sans-serif"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0.1px
  label-small:
    fontFamily: "Hymnal Sans, Roboto, system-ui, sans-serif"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.5px
    textTransform: uppercase
  body-large:
    fontFamily: "Hymnal Sans, Roboto, system-ui, sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  hymn-display:
    fontFamily: "Hymnal Sans, Noto Sans Malayalam, system-ui, sans-serif"
    fontSize: "clamp(1rem, 0.85rem + 0.6vw, 1.75rem)"
    fontWeight: 400
    lineHeight: 1.7
    note: multiplied by --font-scale (user setting), never a fixed px — see Layout
  output-line:
    fontFamily: "Hymnal Sans, Noto Sans Malayalam, system-ui, sans-serif"
    fontSize: "clamp(2.2rem, 6.5vw, 5rem)"
    fontWeight: 500
    lineHeight: 1.35
    color: "{colors.output-ink}"
    colorDimmed: "{colors.output-ink-muted}"
    note: one style for every line, lit or dimmed — focus changes color only, never size or weight, which would reflow the column mid-scroll. Values provisional until Board #12

rounded:
  none: 0px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  pill: 999px
  full: 999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  safe-area: 10%

components:
  button-filled:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-large}"
    rounded: "{rounded.pill}"
    height: 40px
    padding: 0 24px
  button-tonal:
    backgroundColor: "{colors.secondary-container}"
    textColor: "{colors.on-secondary-container}"
    typography: "{typography.label-large}"
    rounded: "{rounded.pill}"
    height: 40px
    padding: 0 24px
  button-outlined:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    borderColor: "{colors.outline}"
    typography: "{typography.label-large}"
    rounded: "{rounded.pill}"
    height: 40px
    padding: 0 24px
  button-text:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    typography: "{typography.label-large}"
    padding: 0 12px
  fab-extended:
    backgroundColor: "{colors.primary-container}"
    textColor: "{colors.on-primary-container}"
    typography: "{typography.label-large}"
    rounded: "{rounded.lg}"
    height: 56px
    padding: 0 24px 0 20px
    elevation: level-3
  text-field-outlined:
    backgroundColor: transparent
    textColor: "{colors.on-surface}"
    borderColor: "{colors.outline}"
    borderColorFocused: "{colors.primary}"
    rounded: "{rounded.sm}"
    padding: 17px 16px 8px 44px
  chip-filter:
    backgroundColor: transparent
    textColor: "{colors.on-surface-variant}"
    borderColor: "{colors.outline}"
    rounded: "{rounded.pill}"
    height: 32px
  chip-filter-selected:
    backgroundColor: "{colors.secondary-container}"
    textColor: "{colors.on-secondary-container}"
    rounded: "{rounded.pill}"
    height: 32px
    leadingIcon: checkmark
  chip-assist:
    backgroundColor: transparent
    textColor: "{colors.on-surface-variant}"
    borderColor: "{colors.outline}"
    typography: "{typography.label-small}"
    rounded: "{rounded.pill}"
    height: 26px
  card-elevated:
    backgroundColor: "{colors.surface-container-low}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 26px 24px
    elevation: level-1
  switch:
    trackColorOff: "{colors.surface-container-high}"
    trackColorOn: "{colors.primary}"
    thumbColorOff: "{colors.outline}"
    thumbColorOn: "{colors.on-primary}"
    rounded: "{rounded.pill}"
  list-row:
    backgroundColor: transparent
    textColor: "{colors.on-surface}"
    supportingTextColor: "{colors.on-surface-variant}"
    typography: "{typography.body-large}"
    rounded: "{rounded.md}"
    minHeight: 56px
    padding: 8px 16px
  output-line:
    backgroundColor: "{colors.output-ground}"
    textColor: "{colors.output-ink}"
    padding: "{spacing.safe-area}"
---

## Overview

A hymnal, presented live during a worship service — from a phone in an
operator's hand up to whatever the venue's largest display is. Material
Design 3's actual tokens (tonal color roles, type scale, shape, elevation),
hand-implemented in plain CSS rather than the `@material/web` package —
its component graph needs an import map several layers deep (`lit`,
`tslib`, `lit/decorators.js`, …), impractical to load from a CDN and would
mean a real bundler dependency for what should be a styling layer.

The system is seeded from amber/brass, not Google's default purple —
Material 3's actual innovation over M2 is _dynamic color_: deriving the
tonal system from a seed representing the product's own content. Amber
comes from the object this app replaces: gilt hymnal page edges, brass
fixtures, warm print on ivory paper. Considered and rejected: IBM Carbon —
`border-radius: 0` as a stated principle, blue-primary enterprise palette,
IBM Plex, built for data-dense dashboards that need to "survive a security
review." A well-executed system, solving a different problem than a warm,
devotional, legible-at-distance tool.

**Key characteristics:**

- Two screens, two grammars: the **Operator** carries full MD3 chrome
  (pills, chips, a FAB, tonal surfaces); the **Output** carries none of
  it — fixed near-black, one scrolling column of lyrics, nothing else,
  ever.
- Dark-first. Light exists (`colors-light`) and is fully supported, but
  the primary identity — and the Output view unconditionally — is dark.
- One accent color does real work across three roles (primary, secondary,
  their containers), not one hue slapped on an otherwise neutral page —
  the exact "one saturated accent on near-black" AI-generic pattern this
  project fell into once already, avoided by actually using MD3's role
  system instead of inventing a single ad hoc accent.
- Elevation is tonal (a lighter `surface-container` step) plus a soft
  shadow, never a heavy drop shadow — MD3, not MD2.
- Continuous responsive scaling (`clamp()`), not fixed breakpoints or
  fixed px type sizes — the one deliberate departure from a typical MD3
  token sheet, because this app runs from a phone to an arbitrary large
  display, not a fixed set of device classes.

## Colors

> Two full schemes: `colors` (dark, primary identity) and `colors-light`.
> Same role names, same relationships, different values — apply via CSS
> custom properties following `src/styles.css`'s existing pattern (bare
> `:root` = light, redefined under `prefers-color-scheme: dark` and again
> under `[data-theme="dark"]`).

### Brand & Accent

- **primary** / **on-primary**: the one interactive color. Filled
  buttons, the FAB's container role, the active state of anything
  selectable.
- **primary-container** / **on-primary-container**: a quieter tint of the
  same hue — the FAB's actual fill (a FAB is prominent by size and
  elevation, not by shouting in full-strength primary).
- **secondary** / **secondary-container** / **on-secondary-container**: a
  muted warm brown-tan, one step down in intensity from primary. Carries
  tonal buttons and the _selected_ state of filter chips — a second role
  doing real work, not primary reused everywhere.

### Surface

- **surface** / **on-surface**: the base ground and its text.
- **surface-variant** / **on-surface-variant**: secondary text, chip
  borders, anything that should read as present but not primary content.
- **surface-container-low/…/-high**: the tonal-elevation ladder. A card
  sits on `-low`; nothing in this app currently needs `-high` beyond hover
  states.

### Hairlines & Borders

- **outline**: chip and outlined-button borders, the text field's resting
  border.
- **outline-variant**: quieter dividers (the top-bar hairline).

### Output view (fixed, unthemed)

- **output-ground** (`#0c0b10`) / **output-ink** (`#f6f1e6`) /
  **output-ink-muted** (`#a89e86`): deliberately outside the tonal system
  above. The Output view does not follow the Operator's light/dark
  setting — it's read from across a room, not chosen by the person
  reading it.

## Typography

### Font family

- **One family for everything: Google Sans.** Both UI chrome and hymn
  content (titles, lyrics, the Output view) — superseding Board #10's
  Noto Serif Malayalam and the earlier plan to pair Roboto (UI) with a
  separate Malayalam content face. Verified directly, not assumed:
  downloaded the actual font file and inspected its charset — full
  Malayalam Unicode block coverage (U+0D00–U+0D7F, gaps only at
  codepoints Unicode itself leaves unassigned), shipped under OFL 1.1,
  weights 400/500/600/700 all available. It's Google's own current
  product UI typeface (Android, Gmail, and newer products have been
  moving off Roboto to it), so it's a more authentic Material identity
  than Roboto now, not a departure from one — and one family end-to-end
  is a simpler type system than pairing two. Noto Sans Malayalam and
  Noto Serif Malayalam stay in the stack as fallbacks. A second
  hymnbook's script picks its own font the same way, per hymnbook data,
  when that board arrives (arc42 §8.3).
- **Bundled as "Hymnal Sans"** — Google Sans, subset and renamed. Google's
  `TRADEMARKS.md` forbids the "Google Sans" name on a modified version,
  and subsetting is a modification. The subset keeps Latin-1, general
  punctuation and the full Malayalam block with all shaping rules
  (conjuncts), weights 400–700 as one variable axis: 82 KB as woff2,
  against 1.58 MB for the whole font. Copyright, designer and licence
  records inside the font are unchanged; `src/fonts/README.md` has the
  rebuild command. Noto Serif Malayalam is no longer bundled.

### Hierarchy

| Token           | Size                                    | Weight | Line height | Use                                     |
| --------------- | --------------------------------------- | ------ | ----------- | --------------------------------------- |
| `display-small` | 36px                                    | 400    | 44px        | Library's hero hymnbook title           |
| `title-large`   | 22px                                    | 500    | 28px        | Screen headers (hymn title in Operator) |
| `title-medium`  | 16px                                    | 500    | 24px        | Section labels (part label, "Recent")   |
| `label-large`   | 14px                                    | 500    | 20px        | Buttons, chips                          |
| `label-small`   | 11px                                    | 500    | 16px        | Assist chip (recurrence cue)            |
| `body-large`    | 16px                                    | 400    | 24px        | Running UI text                         |
| `hymn-display`  | `clamp(1rem, 0.85rem + 0.6vw, 1.75rem)` | 400    | 1.7         | Lyric lines, Operator view              |
| `output-line`   | `clamp(2.2rem, 6.5vw, 5rem)`            | 500    | 1.35        | Output view, every line (lit or dimmed) |

### Principles

- **No fixed px type scale for hymn content.** `hymn-display` and
  `output-line` are both `clamp()`s — phone and a large display sit on
  one continuous curve, never a jump between fixed layouts.
  `hymn-display` is layered under the user's own `--font-scale`
  multiplier (Board #10, `Settings`); `output-line` is not, since the
  Output fills a separate display the operator isn't reading.
- **The Output is a continuous scroll, teleprompter-style** (SDD-0001
  §16.1): the whole hymn in one column, the focus lit in `output-ink`
  and centred, every other line dimmed to `output-ink-muted`. The focus
  mirrors the Operator's exactly — a whole part under whole-part focus,
  one line under line focus. Hierarchy is carried by color alone, never
  by size, weight or chrome.
- **No labels in the Output view — ever.** No part name, no verse number,
  no recurrence cue. Those are Operator aids. If it isn't a lyric line,
  it doesn't render there.
- **Recurrence cue is a plain running ordinal** ("Repeat 2", "Repeat 3"),
  never "final repeat": a repeat only fires on an _immediately adjacent_
  recurrence of the same part (evidenced against the corpus — 0 of 1,631
  hymns ever repeat a part back-to-back in their printed sequence; 1,186
  have the normal non-adjacent verse-chorus-verse-chorus pattern, which
  is not a repeat). In practice a cue only ever appears from a live,
  ad-hoc jump back to a part already showing — and the total isn't
  knowable in advance for a live jump, so don't imply it is.

## Layout

### Spacing

Base unit 4px: `xxs` 4px, `xs` 8px, `sm` 12px, `md` 16px, `lg` 24px, `xl`
32px. The Output view uses `safe-area` (10% from any edge) instead of the
fixed scale — a broadcast-graphics convention, not an MD3 one, because
nothing in the Output view is close enough to the frame to need a smaller
unit.

### Structure

- **Operator: panes, modelled on real operator software.** ProPresenter
  shows the whole song as every slide in arrangement order, grouped and
  labelled, click to go live, with a live-output preview in a side panel;
  OpenLP's live controller is a vertical verse list, click to go. None
  splits a song into "one current card plus a separate part picker", and
  that split is what made long verses and many-part hymns fight the
  layout. The Operator is therefore:
  - **Sequence** (primary pane, always shown): the effective path as a
    column of blocks, one per occurrence, each headed by its label
    (`title-medium`) and, when shown, its repeat cue (assist chip). The
    current block is highlighted (`secondary-container` fill, `primary`
    edge) and kept centred with native smooth scroll, like the Output.
    Under line focus the focused line stays `on-surface` and the rest of
    the block drops to `on-surface-variant`. Tapping a block goes to that
    occurrence; tapping a line gives it line focus. Long verses and
    many-part hymns are just a longer list: scrolling here is the normal
    mode, not an overflow.
  - **Supporting panes**, each shown or hidden by the operator: **Live**
    (a small mirror of what the Output shows now) and **Parts** (the part
    keypad for R6 jumps, with the repeat-cue switch). A future pane, such
    as Finder and recents or a service list, registers the same way,
    without reworking the layout.
  - **Adaptive, MD3 window size classes.** Expanded (≥840px): a
    fixed-width supporting column (about 20rem) beside the sequence, its
    visible panes stacked, each scrolling inside itself. Compact and
    medium (<840px): the sequence full width; every visible supporting
    pane becomes a dock button opening it as a bottom sheet. Nothing is
    dropped on mobile, only moved behind a tap.
  - **Show/hide** lives in a Panels menu in the top bar, one toggle per
    supporting pane, persisted in the user's preferences. Defaults: Live
    and Parts both shown.
- **FAB and dock**: a fixed bottom dock for navigation plus the FAB. The
  FAB is **Show Output**: presenting is the operator's whole job, and it's
  the one action that must be easy to hit mid-service. It belongs to the
  whole Operator, not the Presenter screen alone: fixed bottom-right on
  every view, since the Output is opened once per service, often before
  the first hymn (SDD-0001 §16.1). The dock leaves room for it.
- **Operator detail**: the header carries a back (to search) text button,
  the hymn title (`title-large`) and its number (`on-surface-variant`).
  Lines carry no list numbering. The dock's four buttons carry an icon
  matching their key (left/right chevrons for parts, up/down arrows for
  lines, as the keyboard does). **Parts outrank lines**, and emphasis says
  so: Next part is the filled button (the most frequent action in a
  service), Previous part tonal, the two line buttons outlined. Each pair
  shares one width (both part buttons as wide as the wider, likewise the
  line buttons), so the row is symmetric and the part pair stays visibly
  the larger control. As width runs out, labels collapse to icon-only in
  reverse priority: lines first, then the FAB, then parts. Labels stay
  the accessible names throughout.
- **Output**: full-bleed, one centred column scrolling vertically, the
  focus held at the vertical centre, the safe-area margin around it and
  nothing else on screen.
- **One hard breakpoint** (`~60rem`), not to change the type scale but to
  cap reading-column width on a large display — unconstrained lines on a
  big screen are exactly as illegible as too-small text on a phone.

### Stability: controls never move as content changes

Parts differ in line count and the selection moves every few seconds, so
anything positioned by content would drift under the operator's pointer
or thumb mid-service. Three rules follow:

- **The dock is a fixed bottom app bar** (MD3), full width, pinned to the
  viewport bottom whatever the content's height, with the FAB at its end.
  The page reserves the bar's height at the bottom so nothing hides
  under it.
- **Part chips sit in a grid of equal cells**, in the hymn's part order:
  numbered stanzas one cell each, so 1, 2, 3… always land in the same
  places; refrains, bridges and tags (unnumbered, longer labels) span a
  full row. The rail reads as a keypad, not a word-wrapped sentence.
  Cells are a fixed size, never stretched, and the grid is at most as
  many cells wide as the hymn has stanzas (three minimum), so a full-row
  chip spans the stanzas beneath it, not the whole card.
- **Selecting a chip never changes its width.** Every filter chip
  reserves the checkmark's slot; selection only fills it. A wider
  selected chip would rewrap the rail and move everything below it.
- **The Operator screen fits the viewport and never scrolls as a page.**
  Each pane scrolls inside itself instead: the sequence (kept centred on
  the current block), and each supporting pane in its column or sheet.
  Across the corpus the longest part is 4 lines at the median and 12 at
  p99, but a few run to 21–29 (#924, #1274, #890, #930), and #908 has 20
  parts, so any layout that sized itself to content broke somewhere.
- **The dock aligns to the content column**, not the centre of the bar:
  centring it in the full width is what let it collide with the FAB.
- **The dock never wraps.** Its labels collapse to icon-only before the
  row runs out of room, not after it has broken onto two lines. That's
  decided by measuring whether the row fits, not by breakpoints: type
  scales with the viewport and with the user's text size, so a button's
  width isn't a fixed number a breakpoint could be tuned to.

### Whitespace philosophy

The sequence is the one surface in the Operator view that should feel
unhurried — generous padding (`lg`) around each block, nothing crowding
the current one. Everything else (dock, chips, top bar) is deliberately
compact, since it's UI the operator glances at, not reads.

## Interaction states

MD3's standard state layers, not invented here. A state is an overlay of
the element's own content color over its container: **hover 8%**, **focus
and pressed 10%**. Disabled is 38% content on a 12% container for filled
components, 38% content alone otherwise. Keyboard focus also gets a 3px
`secondary` ring, offset 2px, visible only via `:focus-visible` — the
Operator is keyboard- and remote-driven (arc42 §8.8), so focus must always
be findable.

`list-row` covers what the component list above otherwise lacks: a
Finder search result or recent hymn is one full-width, tappable row, the
title in `on-surface` and a snippet in `on-surface-variant`, never a
button styled as a button.

## Elevation & Depth

| Level             | Treatment                                                                       | Use                             |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------- |
| Flat              | No shadow                                                                       | Top bar, chips, buttons at rest |
| Tonal (level 0→1) | Shift to `surface-container-low` + soft shadow (`0 1px 2px …, 0 1px 3px 1px …`) | The lyrics card                 |
| Tonal (level 3)   | Stronger soft shadow (`0 1px 3px …, 0 4px 8px 3px …`)                           | The extended FAB only           |

**Shadow philosophy.** Two elevation levels exist in the whole system, and
nothing else gets one. A heavy drop shadow anywhere reads as Material 2,
not 3 — elevation here means "which tonal step," with shadow only
confirming it.

## Inspiration — and why these, not generic SaaS

Deliberately not drawing from typical tech-product design galleries
(Stripe, Linear, Notion) — the wrong reference class for presentation
software used in a devotional, live-event context, read at a distance.

- **Scripture/prayer apps (YouVersion, Hallow)** — closest brand
  category: same devotional register, same problem of serving lyric/
  scripture text across many scripts and languages (YouVersion ships
  Bible content in 2,000+ languages), same emphasis on reader-controlled
  legibility over decoration. Their reading-settings pattern is close to
  `Settings`' own job here.
- **Teleprompters** — the direct model for the Output view: continuous
  scroll, reading position held at centre, surrounding text dimmed (see
  Typography Principles above). Broadcast lower-thirds shaped an earlier
  2-line draft, superseded by SDD-0001 §16.1.
- **Physical hymnal and prayer-book print design** — the most literal
  reference, since it's the artifact this app replaces. Source of the
  amber/brass seed, not an arbitrary accent choice.
- **E-reader reading settings (Kindle)** — the shape of a good
  text-scale/contrast/theme control: a few clear steps, applied
  instantly, no configuration maze.

None of these are copied wholesale — they're the right _category_ to
borrow instinct from when a new screen needs a decision this file doesn't
already answer.
