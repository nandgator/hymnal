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
    fontSize: "calc(7.5cqmin * var(--fit))"
    fontWeight: 500
    lineHeight: 1.35
    color: "{colors.output-ink}"
    colorDimmed: "{colors.output-ink-muted}"
    note: one style for every line, lit or dimmed — focus changes color only, never size or weight, which would reflow the column mid-scroll. Sized by the screen itself (cqmin — vmin on the full Output, a true scale model in the Live pane), shrunk per hymn by --fit (§ Structure), with no rem cap — the Output is the screen that lands on a 4K/8K TV at 100% scaling, where a rem cap would stop the lyrics growing at a fraction of the size they should be. The Operator keeps rem plus the user's text scale: CSS px already map through the device pixel ratio, so OS scaling handles pixel density. Built so far with hardcoded #000/#fff, 0.3 opacity for dimmed, weight 400, line-height 1.5; Board #12 part 4 moves it onto these tokens and settles weight and line-height

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
    rounded: "{rounded.md}"
    height: 40px
    padding: 0 24px
  button-tonal:
    backgroundColor: "{colors.secondary-container}"
    textColor: "{colors.on-secondary-container}"
    typography: "{typography.label-large}"
    rounded: "{rounded.md}"
    height: 40px
    padding: 0 24px
  button-outlined:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    borderColor: "{colors.outline}"
    typography: "{typography.label-large}"
    rounded: "{rounded.md}"
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
    rounded: "{rounded.sm}"
    height: 32px
  chip-filter-selected:
    backgroundColor: "{colors.secondary-container}"
    textColor: "{colors.on-secondary-container}"
    rounded: "{rounded.sm}"
    height: 32px
    leadingIcon: checkmark
  chip-assist:
    backgroundColor: transparent
    textColor: "{colors.on-surface-variant}"
    borderColor: "{colors.outline}"
    typography: "{typography.label-small}"
    rounded: "{rounded.sm}"
    height: 26px
  card-elevated:
    backgroundColor: "{colors.surface-container-low}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.md}"
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
  is not a repeat). In practice a cue only ever appears from an explicit
  live repeat — and the total isn't knowable in advance, so don't imply
  it is.

## Layout

### Spacing

Base unit 4px: `xxs` 4px, `xs` 8px, `sm` 12px, `md` 16px, `lg` 24px, `xl`
32px. The Output view uses `safe-area` (10% from any edge) instead of the
fixed scale — a broadcast-graphics convention, not an MD3 one, because
nothing in the Output view is close enough to the frame to need a smaller
unit.

### Structure

- **App shell: layers, after Supabase Studio.** Supabase handles a lot of
  function with a lot of breathing room by giving each concern its own
  layer and choosing width by content, not by page. Here:
  1. **Sections** (the app's top level): a navigation rail on the left
     from 840px, a menu on a phone. Now: Present and Library. Reserved,
     not built: Feedback and corrections, About (acknowledgements,
     copyright, credits), Updates (over-the-air, as Supabase announces
     them). Settings moves to the rail's foot.
  2. **Switcher row**, Supabase's org/project breadcrumb:
     **Hymnbook ▾ / #908 Title ▾**. Each crumb is a picker. The hymnbook
     picker lists installed books; the hymn picker is quick-find (number
     or lyrics). Choosing either **hot-swaps in place**: the Operator
     stays, the Output follows (snapping to the new hymn, never
     scrolling from the old one), and nothing is reopened or
     repositioned mid-service.
  3. **Workspace**, full width (Supabase's `full`, for dense tools):
     the Operator below. Library and Finder use the default width, and
     Settings and About the small one.
  4. **Dock and FAB**, pinned to the bottom (below).
     A command menu (Ctrl/⌘+K or `/`) reaches everything from anywhere:
     one box that finds a hymn by number or lyrics, or an action by name,
     each action showing its key (SDD-0001 §16.5). A `?` sheet lists every
     shortcut.
- **Operator workspace.** **Live** is the anchor: what the congregation
  sees now (a mirror of the Output message, SDD-0001 §16.4). Beside it,
  one **navigator**, switched with a segmented button **Parts | Lyrics**
  and remembered; **Parts** by default. Both control the Live: Parts by
  the hymn's structure (the keypad, skip or repeat, §5.1), Lyrics by the
  words (the whole sung order, ProPresenter's click-a-slide-to-go-live).
  The navigator not chosen stays one tap away: from 840px it also shows
  in a collapsible sidebar; on a phone the Parts | Lyrics switch itself
  is that tap (a sheet as well would be a second control for the same
  thing).
  - **Lyrics, compact repeats.** A part already seen earlier in the path
    (a refrain's second and later showings) shows compact: its label and
    first line, then "…". It's still a full tap target. The current block
    always shows in full, so the operator never loses the words being
    sung; the list stays short enough to scan.
  - **Feedback without hover.** Touch has no hover, so the state that
    matters is **pressed**: a block or line darkens while a finger (or
    mouse button) is down, on every device, and the tap's result — the
    block becoming current — is the confirmation. Hover shading is extra,
    for pointer devices only, and faint on both blocks and lines.
  - **Lyrics, touch-first.** The whole block is the tap target (no
    hunting for a small "1" or "Refrain"); tapping a line sends that
    line live. **Scrolling only browses** and never changes what's live,
    so a stray swipe can't move the Output; only a tap does. Scrolled
    away from the current block, a "Back to current" chip appears (chat
    apps' "jump to latest"). The current block stays highlighted and,
    while you haven't scrolled away, centred.
  - **Height matters too** (MD3/Android window height classes: compact
    < 480dp). WCAG's Reflow sets a width floor (320 CSS px) but no single
    height floor, so the practice is to degrade gracefully: at compact
    height (landscape phones, split screen, short windows) Live becomes
    the strip even on a wide screen, and the navigator gets the room.
    Below even that, the main column scrolls inside itself as the last
    resort; the page never does.
  - **Blanked**: while the Output is blanked (B), Live dims and carries a
    **Blanked** badge, which restores on a tap; the strip shows it too. The
    operator can keep navigating behind it (SDD-0001 §16.5). With no Live
    on screen, the badge sits at the switcher row's end instead.
  - **Phone**: Live collapses to a thin strip showing the current line,
    expanding on tap; the navigator fills the room below it; the dock as
    everywhere.
  - **Where a control lives follows how often it's used mid-service**:
    frequent ones (the navigator swap, the sidebar's Hide/Show, later the
    repeat-cue switch) stay on screen; occasional ones go into Settings.
    Nothing mid-service needs a trip into Settings: each pane toggle is
    also a key (L for Live) and a command-menu action. Letting the user
    move a control between screen and Settings is deferred, not dropped.
  - **Settings, grouped**: one sheet, MD3 list sections. **Display**:
    theme (System | Light | Dark) and text size (A− 100% A+).
    **Workspace**: Show Live, Show sidebar, Scrolling the Output moves
    the Operator (switches), and which navigator leads (Parts | Lyrics).
    **Keyboard**: opens the shortcut sheet, whose Close then reads Back
    and returns to Settings. Part 4 adds **Presentation** (themes, cues)
    as one more section.
  - **Show/hide**: Live and the sidebar, remembered (SDD-0001 §16.4).
    The leading navigator and the dock never hide. Panes remain a
    registry, so future ones slot in without another layout rework.
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
- **Output: nothing ever bleeds off the screen.** The type is sized
  **per hymn** so its longest part fits inside a 10% safe margin, then
  held for the whole hymn, so the text never changes size between parts.
  It's re-fitted on resize and font load, down to a floor; only a
  pathological part (20+ lines) goes past the floor, and then whole-part
  focus starts at the top margin, and line steps still work. The focus
  sits a little above centre (about 42% down, a teleprompter's eyeline),
  clamped inside the margin. Sizes are container units (`cqmin`), so the
  Operator's **Live pane is the same component scaled to its box**: a true
  miniature, identical line by line, not a separate rendering.
- **Output**: full-bleed, one centred column scrolling vertically, the
  focus held at the eyeline, the safe-area margin around it and nothing
  else on screen. Parts are separated by a gap of about half a line, as
  in a printed hymnal: where a verse ends and the refrain begins is
  visible without a label. Scrolled by hand, the highlight becomes a
  reading band fixed where the focus's part sat, one part tall, lighting
  whatever passes through it, until the scroll rests (SDD-0001 §16.1).
- **One hard breakpoint** (`~60rem`), not to change the type scale but to
  cap reading-column width on a large display — unconstrained lines on a
  big screen are exactly as illegible as too-small text on a phone.

### Stability: controls never move as content changes

Parts differ in line count and the selection moves every few seconds, so
anything positioned by content would drift under the operator's pointer
or thumb mid-service. Three rules follow:

- **The FAB floats.** The dock is as tall as its own buttons; the FAB
  rides about 20px above its top edge, a floating action button rather
  than a docked one.
- **The dock is a fixed bottom app bar** (MD3), full width, pinned to the
  viewport bottom whatever the content's height, with the FAB at its end.
  The page reserves the bar's height at the bottom so nothing hides
  under it.
- **Tapping the current part's chip restarts it**, never repeats it: a
  stray tap can't queue a verse the congregation would see twice.
  Deliberate repeats wait for part 4 (Presentation), where they arrive with
  what makes them legible. A repeat stays on the same page with its count
  going up (×2, ×3 …), Lyrics shows one block marked ×N instead of a
  stack, and the Output can show that ×N as a cue. Without the cue, a
  Repeat button looked like it did nothing, so it and the repeat-cue
  switch aren't in the Parts pane until then.
- **Special parts first, then the keypad.** Refrains, bridges and tags
  (unnumbered) come first as full-row chips; numbered stanzas follow as a
  keypad in number order, whatever order the hymn stores its parts in —
  a hymn that stores verse 1 before its refrain must not split the
  keypad around it.
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

### Register: composed, not cozy

Default M3 is a consumer register: pill buttons, large radii, soft
bubbles. Supabase is the opposite, dense and technical, for developers.
A hymnal operator sits between them: calm, composed and legible, the tone
of a well-set printed hymnal rather than a chat app or a console. So:

- **Shapes step down one notch.** Buttons use M3 Expressive's square
  shape (12px), not the default pill. Chips use 8px, which is M3's own
  chip shape (the earlier pills were a mistake). Cards and blocks use
  12px. The FAB keeps 16px and the switch stays round: those shapes carry
  meaning.
- **Room, not padding.** Breathing room comes from space between groups
  (Supabase's rhythm), not from inflating each control. Controls stay
  compact; gutters and section gaps stay generous.
- **Icons lead, padding follows M3.** A button with a leading icon uses
  16px before the icon and 24px after the label (M3's own rule), so the
  icon doesn't look inset. The rail's selection indicator takes the
  square register too (8px), not M3's default pill.
- **Pickers keep their bearings.** The switcher row and the search bar
  stay put; results and Recent scroll beneath them. The search field and
  its Find button share one height.
- **Scrollbars keep their own lane.** Every scrolling pane reserves a
  stable gutter, so a scrollbar never overlaps content, and pads its
  content inside on both sides. Scrollbars are thin and in the outline
  color, and **hidden until needed**: they fade in (about 150ms) while
  the pane is scrolling, hovered or holds focus, and fade out (about
  400ms) once it's still again, the way phones, macOS and Windows 11
  already behave, so nobody meets it for the first time here. The gutter
  stays reserved, so nothing shifts. Reduced-motion users get the change
  without the fade.
- **Flat before raised.** Hairline `outline-variant` borders separate
  layers (switcher row, rail, dock); shadow is reserved for things that
  float (FAB, sheets).

All of it lives in shape and spacing tokens, so the register can be
tuned without touching components.

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
- **Supabase Studio** — the model for the app shell: layered chrome, a
  breadcrumb switcher for the two things you work inside (org/project
  there, hymnbook/hymn here), width chosen by content, a Cmd+K command
  menu, and generous room around dense controls. Borrowed as structure,
  not as its green-on-black look.
- **E-reader reading settings (Kindle)** — the shape of a good
  text-scale/contrast/theme control: a few clear steps, applied
  instantly, no configuration maze.

None of these are copied wholesale — they're the right _category_ to
borrow instinct from when a new screen needs a decision this file doesn't
already answer.
