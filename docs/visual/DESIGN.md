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
  output-ground: "#1b140c"
  output-ink: "#f3dfb5"
  output-ink-muted: "#9c8661"
  output-ink-dimmed: "color-mix(in srgb, output-ink 30%, output-ground)"

output-themes:
  note: presets for the Output view only (Settings > Presentation); Warm is the default and matches colors.output-*
  light:
    output-ground: "#f6f1e6"
    output-ink: "#1a1712"
    output-ink-muted: "#8f8676"
  contrast:
    output-ground: "#000000"
    output-ink: "#ffffff"
    output-ink-muted: "#8c8c8c"
  dark:
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
    fontSize: "clamp(1.25rem, 1.0625rem + 0.75vw, 2.1875rem)"
    fontWeight: 400
    lineHeight: 1.7
    note: content, so it scales with the screen; its rem bounds follow --font-scale (ADR-0017)
  output-line:
    fontFamily: "Hymnal Sans, Noto Sans Malayalam, system-ui, sans-serif"
    fontSize: "calc(7.5cqmin * var(--fit))"
    fontWeight: 500
    lineHeight: 1.35
    color: "{colors.output-ink}"
    colorDimmed: "{colors.output-ink-dimmed}"
    note: one style for every line, lit or dimmed — focus changes color only, never size or weight, which would reflow the column mid-scroll. Sized by the screen itself (cqmin — vmin on the full Output, a true scale model in the Live pane), shrunk per hymn by --fit (§ Structure), with no rem cap — the Output is the screen that lands on a 4K/8K TV at 100% scaling, where a rem cap would stop the lyrics growing at a fraction of the size they should be. The Operator keeps rem plus the user's text scale: CSS px already map through the device pixel ratio, so OS scaling handles pixel density.

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
  it — one scrolling column of lyrics on its own ground, and nothing
  else unless the operator turns a cue on.
- Dark-first. Light exists (`colors-light`) and is fully supported, but
  the primary identity — and the Output view by default — is dark.
- One accent color does real work across three roles (primary, secondary,
  their containers), not one hue slapped on an otherwise neutral page —
  the exact "one saturated accent on near-black" AI-generic pattern this
  project fell into once already, avoided by actually using MD3's role
  system instead of inventing a single ad hoc accent.
- Elevation is tonal (a lighter `surface-container` step) plus a soft
  shadow, never a heavy drop shadow — MD3, not MD2.
- Content scales with the screen; the interface doesn't (ADR-0017). The
  lyrics and the Output are `clamp()`s on the viewport; controls, labels
  and icons are a fixed size times the user's text scale (A−/A+), as
  Material 3, Apple and Figma keep theirs. Window size changes the
  layout, never the interface's size.

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

### Output view (its own presets)

- **output-ground** (`#1b140c`) / **output-ink** (`#f3dfb5`) /
  **output-ink-muted** (`#9c8661`), Warm: deliberately outside the tonal system
  above. The Output view does not follow the Operator's light/dark
  setting — it's read from across a room, not chosen by the person
  reading it; a light Operator at the desk must not put a white screen on
  the wall.
- **Presets** (`output-themes`), chosen in Settings > Presentation, apart
  from the Operator's theme: **Warm** (default, the values above: parchment
  ink on a dark brown ground, gilt hymnal pages), **Dark**, **Light** and
  **Contrast** (high contrast). Each sets only these three
  tokens, so every preset keeps the same hierarchy. Chosen by sight:
  swatch tiles showing "Aa" in each preset, not a segmented button.
  Live and the Live strip use them too, being the Output scaled.
- **output-ink-dimmed**: lines outside the focus, 30% ink over the ground
  in every preset (derived, not set per preset), so the focus stands out
  as strongly as it always has. Muted stays for small labels (the Live
  strip's, the cue caption), which must stay readable.

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

| Token           | Size                                            | Weight | Line height | Use                                     |
| --------------- | ----------------------------------------------- | ------ | ----------- | --------------------------------------- |
| `display-small` | 36px                                            | 400    | 44px        | Library's hero hymnbook title           |
| `title-large`   | 22px                                            | 500    | 28px        | Screen headers (hymn title in Operator) |
| `title-medium`  | 16px                                            | 500    | 24px        | Section labels (part label, "Recent")   |
| `label-large`   | 14px                                            | 500    | 20px        | Buttons, chips                          |
| `label-small`   | 11px                                            | 500    | 16px        | Assist chip (recurrence cue)            |
| `body-large`    | 16px                                            | 400    | 24px        | Running UI text                         |
| `hymn-display`  | `clamp(1.25rem, 1.0625rem + 0.75vw, 2.1875rem)` | 400    | 1.7         | Lyric lines, Operator view              |
| `output-line`   | `clamp(2.2rem, 6.5vw, 5rem)`                    | 500    | 1.35        | Output view, every line (lit or dimmed) |

### Principles

- **No fixed px type scale for hymn content.** `hymn-display` and
  `output-line` are both `clamp()`s — phone and a large display sit on
  one continuous curve, never a jump between fixed layouts.
  `hymn-display` is layered under the user's own `--font-scale`
  multiplier (Board #10, `Settings`); `output-line` is not, since the
  Output fills a separate display the operator isn't reading.
- **The Output is a continuous scroll, teleprompter-style** (SDD-0001
  §16.1): the whole hymn in one column, the focus lit in `output-ink`
  and centred, every other line dimmed to `output-ink-dimmed`. The focus
  mirrors the Operator's exactly — a whole part under whole-part focus,
  one line under line focus. Hierarchy is carried by color alone, never
  by size, weight or chrome.
- **No labels in the Output view unless the operator asks.** Part name,
  verse number and recurrence are Operator aids. Cues are opt-in, each its
  own switch in Settings > Presentation (and the command menu, not on
  screen: set once per service): hymn number, hymn title, hymnbook, part,
  repeat ×N. By default the number and hymnbook show, fading after a few
  seconds: what a congregation holding songbooks needs, then out of the
  way. With every cue off, nothing but lyrics renders there. The rule
  for all of them: **cues sit on still ground.**
  Nothing may scroll behind them, since movement across a fixed frame
  draws the eye, and the top of a screen reads as a notification. A filled
  island, then an outlined one, at the top both outranked the lit lyrics.
  - **The caption, a lower third**: hymnbook · title · part · ×N (e.g.
    `Hymnbook · Amazing Grace · Verse 2 · ×2`) as plain `output-ink-dimmed`
    text centred in the bottom margin, no container. A stanza reads
    **Verse n**, other parts by kind (Chorus, Bridge, Tag); ×N shows only
    on a repeat.
  - **The number badge**, for those following in a printed songbook: the
    hymn's number in a FAB-like tonal tile (9% ink over the ground,
    `output-ink-muted`), top left, larger than the caption so it reads
    from the back, inset equally from top and left (in `cqmin`, so the
    corner gap stays even at any aspect ratio). It changes only with the
    hymn, so it's still ground too.
  - **Each takes its margin.** While a cue shows there, that safe margin
    grows from 10% to 16%. The fit and the eyeline respect it, so lit
    lines never enter it, and the lyrics fade out inside it: only lines
    not being sung are ever dimmed by it. Toggling a cue refits the hymn.
  - **Fade, one switch for all** ("Fade cues after a few seconds", off by
    default): the cues show together, at a new hymn, on the Output coming
    back from blank, or on Show cues now, and fade together 8s later. Part
    steps (keys, a hand scroll) don't bring them back: the caption's part
    changed every verse, so it kept returning alone. Fading as a
    broadcast lower third does, only opacity changes; margins stay
    reserved, so the lyrics never resize or move. Off, cues stay: someone arriving
    mid-hymn with a songbook still finds the number. **Show cues now**
    (command menu; its key waits for Board #20) brings them back for
    another 8s, from the Operator, since the operator is the one who
    knows they're wanted. Not hover or touch on the Output: a mouse there
    shows the cursor to the room, and projected screens rarely take touch.
    Per-cue delays were left out as complexity few would use.
  - Sized to the screen (`cqmin`), not the fit; they fade with the lyrics
    when blanked and show in Live like everything else. All inside the
    safe margin, never on the edge, which a TV's overscan crops.
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
     On a phone (MD3 compact, under 600dp) with a hymn up, the crumbs
     shrink to the hymnbook's icon and the hymn's number: a title
     clipped to a letter helps no one, and both stay the buttons'
     accessible names.
  3. **Workspace**, full width (Supabase's `full`, for dense tools):
     the Operator below. Library and Finder use the default width, and
     Settings and About the small one.
  4. **Dock**, the transport pinned to the bottom (below); **Go live**
     top right.
     A command menu (Ctrl/⌘+K or `/`) reaches everything from anywhere:
     one box that finds a hymn by number or lyrics, or an action by name,
     each action showing its key (SDD-0001 §16.5). A `?` sheet lists every
     shortcut.
- **Operator workspace (Board #26).** Fixed areas, each answering one
  question, so a new feature joins an area instead of adding a row of
  controls:
  - **What they see**, a rail on the right from 840px: **Live** (the
    anchor, a true miniature of the Output at its 16:9 shape, with the
    part before and after dimmed), its controls underneath (follow
    status, Blank, later Hold; the open outputs), then a divider and
    **Parts**: the Repeat row (Repeat · ×2 · Undo · Reset, holding its
    height) and the keypad (Chorus full width, verses in fixed-width
    cells).
  - **This hymn**: the lyrics in sung order, tap a part or a line to send
    it live (ProPresenter's click-a-slide-to-go-live).
  - **Coming up**: Recents now, the service queue later (Board #22).
  - This hymn, Recents and Queue are **tabs** in at most two **groups**:
    split side by side (the three-area look) or merged into one tabbed
    area. Each group's heading ends in a pane toolbar of icons, after
    VS Code's and Zed's: expand or collapse, move a tab (a ⋯ menu, only
    in a group of several tabs; the arrow points at the group it goes to),
    close the group (its tabs join the other); merged, split. Split and
    merge are also a Settings switch and command-menu entries. Expanding
    gives one group the room (the queue while planning, the lyrics while
    singing). Under 1400px wide they merge by themselves. What they
    see and the dock never move. No free docking or floating panes:
    mid-service, a pane dragged by mistake would move the controls.
    Popping Live out into its own window is noted for later.
  - **Areas are panels**: `surface-container-low` on the `surface`
    ground, 22px corners, 12px apart, no borders. Each has a quiet
    header, 52px tall: a small uppercase label (or its tabs) and at most
    one or two icon actions. (Headings on the ground above bodies as cards
    were tried on 2026-09-27 and dropped: the gaps between areas no longer
    read, and the toolbar icons floated apart from their panels.)
  - **One lead on screen**: the current part, in the tonal "selected"
    colour (softened for its size), its label in `primary`. Tonal always
    means selected — the current part, the selected key, the song that's
    up in Recents — and neutral always means an action at rest. Numbers
    are tabular, so nothing jitters as they change.
  - **One shape, one icon set.** Every control (buttons, keys, tabs,
    icon buttons, the search bar) is a rounded rectangle of
    `--button-shape`, never a pill beside a square; only MD3's switch
    stays a pill, being its own component. A chip inside a control nests
    concentrically. Icons are Material Symbols Rounded, all of them.
  - **Lyrics, every part in full.** A chorus's later showings show all
    their lines too. Folding them to a first line and "…" kept the list
    short, but made each step reshape the blocks (the leaving one folding,
    the arriving one opening), so the list jolted back and forth as it
    glided (§ Stability: nothing moves as state changes).
  - **Feedback without hover.** Touch has no hover, so the state that
    matters is **pressed**: a block or line darkens while a finger (or
    mouse button) is down, on every device, and the tap's result — the
    block becoming current — is the confirmation. Hover shading is extra,
    for pointer devices only, and faint on both blocks and lines.
  - **Lyrics, touch-first.** The whole block is the tap target (no
    hunting for a small "1" or "Chorus"); tapping a line sends that
    line live. **Scrolling only browses** and never changes what's live,
    so a stray swipe can't move the Output; only a tap does. Scrolled
    away from the current block, a "Back to Current" button floats up
    (chat apps' "jump to latest"): an action, so neutral, set apart by its
    shadow rather than by the tonal "selected" colour. The current block
    stays highlighted and, while you haven't scrolled away, centred. Only
    a step glides there; a list shown anew (a tab, a split, expand or
    collapse) lands on the current part at once.
  - **Height matters too.** WCAG's Reflow sets a width floor (320 CSS
    px) but no single height floor, so the practice is to degrade
    gracefully. The stage needs Live and at least a row of the keypad:
    under 640px of height (a laptop's short window, split screen) Live
    becomes the strip there, and above that Live shrinks before the
    keypad does. The stage never scrolls as a whole; the keypad and the
    tabs scroll inside themselves, and the page never does.
  - **Blanked**: while the Output is blanked (B), Live dims and its
    heading's **Blank** control is pressed, reading **Restore** (the phone
    strip carries the same control). The operator can keep navigating
    behind it (SDD-0001 §16.5). The On Air status reads **Blanked**, its
    dot emptied to a ring, so it shows on every screen, Live on screen or
    not.
  - **Phone** (and anything under 840px): Live collapses to a thin
    strip showing the current line, expanding on tap. Below it the tabs,
    merged, with **Parts** as a third tab: This Song | Recents | Parts. On
    a phone one thing is worked at a time, the lyrics or the parts, so the
    keypad gets a tab's room rather than a strip of it. Parts holds what
    the stage holds from 840px: the Repeat row (Repeat · ×2 · Undo ·
    Reset, holding its height) and the keypad (Chorus full width, verses
    in equal columns), scrolling inside like any tab. It opens on Parts.
    The transport is the dock. No snackbar: Undo stays in the Repeat row.
  - **Where a control lives follows how often it's used mid-service**:
    frequent ones (the tabs, expand and collapse, Repeat)
    stay on screen; occasional ones go into Settings.
    Nothing mid-service needs a trip into Settings: each pane toggle is
    also a key (L for Live) and a command-menu action. Letting the user
    move a control between screen and Settings is deferred, not dropped.
  - **Settings, grouped**: one sheet, MD3 list sections. **Display**:
    theme (System | Light | Dark) and text size (A− 100% A+).
    **Workspace**: Show Live, Split the tab groups, and Scrolling the
    Output moves the Operator (switches).
    **Keyboard**: opens the shortcut sheet, whose Close then reads Back
    and returns to Settings. **Presentation** (part 4): the Output theme
    (Dark | Light | Contrast | Warm) and one switch per cue.
  - **Show/hide**: Live, remembered, and the tab layout (SDD-0001
    §16.4). This hymn and the dock never hide.
- **One transport** (Board #26, PRINCIPLES.md). From 840px it sits at
  the stage's foot, under Parts, beside what it drives, on the keypad's
  edges: it never moves as the areas change (centred on the window, it
  lined up with nothing once the areas were unequal; following the main
  area, it slid). On a phone it is the dock, fixed at the bottom. Four
  equal buttons, **‹ Part · ∧ Line · ∨ Line · Part ›**, the arrows giving
  direction and the full names the accessible ones. All four are equal
  peers in one neutral fill, none filled: nothing competes with the
  current part's highlight, which is what should lead during a song; and
  never tonal, which is the keypad's "selected". As width runs out all
  four go icon-only together (the stage's own width, or the dock's).
- **Go live → On air.** Opening the Output is a one-off, so it sits top
  right on every screen (where Slides and Keynote put theirs) as a tonal
  **Go live**, and once an Output window is open becomes the **On air**
  status, which brings that window forward. Live's dot is the same on-air
  light: grey until then. On air is a custom colour, red harmonised to the
  amber seed (Material's method), with its own roles in both themes.
  Blanked is On Air's other state: **Blanked**, the dot a ring.
- **Rhythm and states.** One 12px gap above, between and below the areas.
  Disabled is the whole control at 38%, whatever its style. Only floating
  things cast a shadow (menus, sheets, the snackbar, Back to Current);
  cards and panels are flat and tonal. Keypad keys show selection by fill
  alone, no tick, and a short last row is centred. A selected control
  keeps its tone under hover and press: a state layer would grey it
  toward the neutral action colour and read as losing the selection.
  **Key caps** (shortcuts, the command menu, Ctrl K) share one height and
  a 6px corner nested in the 12px controls, a tone above what they sit
  on, with a lower edge that keeps them reading as keys; a combination
  is caps side by side. A control whose label changes (Blank and
  Restore; Go Live, On Air and Blanked) is as wide as its longest label,
  so the swap never resizes it. Repeat, Undo and Reset
  are text buttons: occasional, so quiet.
- **Motion** explains change, at Material's emphasised easing: areas glide
  to their places on expand, collapse, close and split (View Transitions);
  a tab change is not a layout change, so the tab bar's one pill glides to
  the selected tab and the new content softly zooms in, in the page itself
  (a View Transition there cross-faded snapshots of the tab labels, which
  flickered). A song chosen from Recents glides to the top, every row
  moving from where it was to where it lands. A menu grows from its
  button; a sheet rises over a blurred page and sinks away on close; every
  control's change of state eases.
  **Press**: a control gives a little under the finger (96%) at once and springs
  back with a slight overshoot, Material 3 Expressive's press kept small;
  an icon that changes meaning (Blank to Restore) turns in. The Repeat
  count is a rolling number (an odometer): the old count rolls out as the
  new one rolls in, up as it grows and down on Undo. It is in the text
  colour, not Repeat's primary: coloured text means a control. Each rail
  section eases in on arrival, the Library as the Operator. In the
  command menu the highlight follows a moving pointer and leaves with
  it; Enter then takes the top match. Reduced motion shows the end
  state.
- **Loading: the shape of what's coming, in its place** (Board #26 part 4).
  A screen still loading shows a skeleton of itself: the Library its card
  (title, count line, button), the Operator its panels, empty, where they
  will sit. Content then fills in and nothing moves (§ Stability). The
  skeleton appears only after about 300ms, so a fast load shows nothing;
  while shown it carries a soft shimmer, static under reduced motion. No
  spinner, and no bare "Loading…". A real wait gets real progress: the
  first install of a hymnbook is a bar with words ("Installing the
  songbook for offline use…", not its title: that is inside the file
  still arriving) and megabytes, determinate when the download's size is
  known, else indeterminate. Go Live holds the right edge from the first
  frame, loaded or not. A hot-swap needs none: the song on screen stays until
  the next has loaded (SDD-0001 §16.4).
- **Sheets** keep their title and Close pinned to the card's top. The
  command menu is called **Search**; Settings has its own search, which
  hides rows (and empty sections) that don't match.
- **Words**: "song" on screen (This Song, Find a Song, 1,632 songs); the
  code and domain keep "hymn". **Case, after Apple:** Title Case (Chicago:
  a, an, the, and, or, to, of, on, in stay lower unless first or after a
  colon) for what's pressed or navigated — buttons, tabs, menu and command
  names, sheet titles, statuses (Go Live, On Air, Bring the Output
  Forward); sentence case for what reads as a sentence — switch labels and
  their descriptions, field names, placeholders, tooltips, empty states
  (Find a song or action, No recent songs yet). `titleCase()` titles the
  command menu. Small-caps area titles stay uppercase.
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
  in a printed hymnal: where a verse ends and the chorus begins is
  visible without a label. Scrolled by hand, the highlight becomes a
  reading band fixed where the focus's part sat, one part tall, lighting
  whatever passes through it, until the scroll rests (SDD-0001 §16.1).
- **The chorus, pinned** (SDD-0001 §16.1, "Pin the chorus", off by
  default): in its own pane, dimmed until sung and lit in place when it is,
  while the verses scroll alone. **Side by side** on a landscape screen (verses
  left, chorus right, both on the eyeline), so the back rows see it over the
  heads in front; **a band at the foot** on portrait, or when side by side would
  shrink the type below 70% of full size (5.25% of the screen's shorter side). A
  hymn that neither layout can hold there flows. Only the chorus pins; a bridge
  or tag stays in the verse column. No part carries a mark (no box, glow, rule,
  label or italics): being sung, it's lit like any other, and the part gap sets
  it apart.
- **One hard breakpoint** (`~60rem`), not to change the type scale but to
  cap reading-column width on a large display — unconstrained lines on a
  big screen are exactly as illegible as too-small text on a phone.

### Stability: controls never move as content changes

Parts differ in line count and the selection moves every few seconds, so
anything positioned by content would drift under the operator's pointer
or thumb mid-service. Three rules follow:

- **The dock is fixed at the bottom** whatever the content's height, the
  transport centred in it. The page reserves the dock's height, so
  nothing hides under it and the gap above it is the areas' 12px.
- **Tapping the current part's chip restarts it**, never repeats it: a
  stray tap can't queue a verse the congregation would see twice.
  Deliberate repeats arrive in part 4 (Presentation) with what makes them
  legible. **Repeat** sits in the Parts pane above the chips, in the same
  place for every hymn; while the cursor is on a repeat, its count (×2)
  and **Undo repeat** (takes back one showing) appear after it, moving
  nothing, so a third Repeat is still one tap. From ×3, **Reset repeat**
  follows (back to a single showing at once); at ×2 it would only do
  what Undo does. Both are also in the command menu, and their keys
  wait for the keymap review (PLAN Board #20).
  A repeat stays on the same page with its count going up (×2, ×3 …):
  the Output doesn't scroll to a copy, Lyrics shows one block marked ×N
  instead of a stack, and the Output can show that ×N as a cue.
- **Special parts first, then the keypad.** Choruses, bridges and tags
  (unnumbered) come first as full-row chips; numbered stanzas follow as a
  keypad in number order, whatever order the hymn stores its parts in —
  a hymn that stores verse 1 before its chorus must not split the
  keypad around it.
- **Part chips sit in a grid of equal cells**, in the hymn's part order:
  numbered stanzas one cell each, so 1, 2, 3… always land in the same
  places; choruses, bridges and tags (unnumbered, longer labels) span a
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
- **The dock never wraps.** All four labels go icon-only together before
  the transport runs out of room, not after it has broken onto two lines.
  That's decided by measuring whether it fits, not by breakpoints: type
  follows the user's text size, so a button's width isn't a fixed number
  a breakpoint could be tuned to.

### Register: composed, not cozy

Default M3 is a consumer register: pill buttons, large radii, soft
bubbles. Supabase is the opposite, dense and technical, for developers.
A hymnal operator sits between them: calm, composed and legible, the tone
of a well-set printed hymnal rather than a chat app or a console. So:

- **Shapes step down one notch.** Every control uses M3 Expressive's
  square shape (12px, `--button-shape`), not the default pill: buttons,
  keys, tabs, icon buttons, the search bar. Panels use 22px. Only the
  switch stays round: that shape carries meaning.
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
  float (menus, sheets, the snackbar, Back to Current).

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
and pressed 10%**, except on a selected control, which keeps its tone
(its press shows as the squeeze in § Structure, Motion). Disabled is 38%
content on a 12% container for filled components, 38% content alone
otherwise. Keyboard focus also gets a 3px `secondary` ring, offset 2px,
visible only via `:focus-visible` — the Operator is keyboard- and
remote-driven (arc42 §8.8), so focus must always be findable.

`list-row` covers what the component list above otherwise lacks: a
Finder search result or recent hymn is one full-width, tappable row, the
title in `on-surface` and a snippet in `on-surface-variant`, never a
button styled as a button.

## Elevation & Depth

| Level             | Treatment                                    | Use                                      |
| ----------------- | -------------------------------------------- | ---------------------------------------- |
| Flat              | No shadow                                    | Top bar, keys, buttons at rest           |
| Tonal (level 0→1) | Shift to `surface-container-low`, no shadow  | Panels, cards                            |
| Floating          | Soft shadow (`0 1px 3px …, 0 4px 8px 3px …`) | Menus, sheets, snackbar, Back to Current |

**Shadow philosophy.** Only what floats above the page casts a shadow, one
level of it; resting surfaces are tonal and flat, and
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
