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
  error: "#ffb4ab"
  on-error: "#690005"
  error-container: "#93000a"
  on-error-container: "#ffdad6"
  output-ground: "#1b140c"
  output-ink: "#f3dfb5"
  output-ink-muted: "#9c8661"
  output-ink-dimmed: "color-mix(in srgb, output-ink 30%, output-ground)"
  output-ink-muted-dimmed: "color-mix(in srgb, output-ink-muted 55%, output-ground)"

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
  error: "#ba1a1a"
  on-error: "#ffffff"
  error-container: "#ffdad6"
  on-error-container: "#410002"

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
    fontSize: "calc(7.5cqmin * 0.85 * var(--fit))"
    fontWeight: 500
    lineHeight: 1.35
    color: "{colors.output-ink}"
    colorDimmed: "{colors.output-ink-dimmed}"
    note: one style for every line, lit or dimmed — focus changes color only, never size or weight, which would reflow the column mid-scroll. Its base is 6.4cqmin (0.85 of 7.5: the fixed 16% bands leave 68% of the height, not 80%, so the same lines show); Full Song's is 9cqmin. Sized by the screen itself (cqmin — vmin on the full Output, a true scale model in the Live pane), shrunk per hymn by --fit (§ Structure), with no rem cap — the Output is the screen that lands on a 4K/8K TV at 100% scaling, where a rem cap would stop the lyrics growing at a fraction of the size they should be. The Operator keeps rem plus the user's text scale: CSS px already map through the device pixel ratio, so OS scaling handles pixel density.

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
operator's hand up to whatever the venue's largest display is. Material Design
3's actual tokens (tonal color roles, type scale, shape, elevation),
hand-implemented in plain CSS rather than the `@material/web` package — its
component graph needs an import map several layers deep (`lit`, `tslib`,
`lit/decorators.js`, …), impractical to load from a CDN and would mean a real
bundler dependency for what should be a styling layer.

The system is seeded from amber/brass, not Google's default purple — Material
3's actual innovation over M2 is _dynamic color_: deriving the tonal system from
a seed representing the product's own content. Amber comes from the object this
app replaces: gilt hymnal page edges, brass fixtures, warm print on ivory paper.
Considered and rejected: IBM Carbon — `border-radius: 0` as a stated principle,
blue-primary enterprise palette, IBM Plex, built for data-dense dashboards that
need to "survive a security review." A well-executed system, solving a different
problem than a warm, devotional, legible-at-distance tool.

**Key characteristics:**

- Two screens, two grammars: the **Operator** carries full MD3 chrome (pills,
  chips, a FAB, tonal surfaces); the **Output** carries none of it — one
  scrolling column of lyrics on its own ground, and nothing else unless the
  operator turns a cue on.
- Dark-first. Light exists (`colors-light`) and is fully supported, but the
  primary identity — and the Output view by default — is dark.
- One accent color does real work across three roles (primary, secondary, their
  containers), not one hue slapped on an otherwise neutral page — the exact "one
  saturated accent on near-black" AI-generic pattern this project fell into once
  already, avoided by actually using MD3's role system instead of inventing a
  single ad hoc accent.
- Elevation is tonal (a lighter `surface-container` step) plus a soft shadow,
  never a heavy drop shadow — MD3, not MD2.
- Content scales with the screen; the interface doesn't (ADR-0017). The lyrics
  and the Output are `clamp()`s on the viewport; controls, labels and icons are
  a fixed size times the user's text scale (A−/A+), as Material 3, Apple and
  Figma keep theirs. Window size changes the layout, never the interface's size.

## Colors

> Two full schemes: `colors` (dark, primary identity) and `colors-light`. Same
> role names, same relationships, different values — apply via CSS custom
> properties following `src/styles.css`'s existing pattern (bare `:root` =
> light, redefined under `prefers-color-scheme: dark` and again under
> `[data-theme="dark"]`).

### Brand & Accent

- **primary** / **on-primary**: the one interactive color. Filled buttons, the
  FAB's container role, the active state of anything selectable.
- **primary-container** / **on-primary-container**: a quieter tint of the same
  hue — the FAB's actual fill (a FAB is prominent by size and elevation, not by
  shouting in full-strength primary).
- **secondary** / **secondary-container** / **on-secondary-container**: a muted
  warm brown-tan, one step down in intensity from primary. Carries tonal buttons
  and the _selected_ state of filter chips — a second role doing real work, not
  primary reused everywhere.

### Surface

- **surface** / **on-surface**: the base ground and its text.
- **surface-variant** / **on-surface-variant**: secondary text, chip borders,
  anything that should read as present but not primary content.
- **surface-container-low/…/-high**: the tonal-elevation ladder. A card sits on
  `-low`; nothing in this app currently needs `-high` beyond hover states.

### Error

- **error** / **on-error** / **error-container** / **on-error-container**: MD3's
  baseline roles, added for the Library (Board #28 part 5): a book that is
  refused or cannot be opened, and the one destructive button (Remove Book).
  Distinct from On Air's red, which means "live" and nothing else; an error is
  never drawn in it, and nothing live is drawn in an error's. Text on
  `error-container` is `on-error-container`; the destructive button is `error`
  with `on-error`. In forced colours the panels and the button gain a 1px
  `CanvasText` border, as the snackbar does.

### Hairlines & Borders

- **outline**: chip and outlined-button borders, the text field's resting
  border.
- **outline-variant**: quieter dividers (the top-bar hairline).

### Output view (its own presets)

- **output-ground** (`#1b140c`) / **output-ink** (`#f3dfb5`) /
  **output-ink-muted** (`#9c8661`), Warm: deliberately outside the tonal system
  above. The Output view does not follow the Operator's light/dark setting —
  it's read from across a room, not chosen by the person reading it; a light
  Operator at the desk must not put a white screen on the wall.
- **Presets** (`output-themes`), chosen in Settings > Presentation, apart from
  the Operator's theme: **Warm** (default, the values above: parchment ink on a
  dark brown ground, gilt hymnal pages), **Dark**, **Light** and **Contrast**
  (high contrast). Each sets only these three tokens, so every preset keeps the
  same hierarchy. Chosen by sight: swatch tiles showing "Aa" in each preset, not
  a segmented button. Live and the Live strip use them too, being the Output
  scaled.
- **output-ink-dimmed**: lines outside the focus, 30% ink over the ground in
  every preset (derived, not set per preset), so the focus stands out as
  strongly as it always has. Muted stays for small labels (the Live strip's, the
  cue caption, the part markers), which must stay readable.
- **output-ink-muted-dimmed**: a part marker on a part not sung, 55% muted over
  the ground in every preset (derived): under its own lines' lit state, as the
  lines are under theirs.

## Typography

### Font family

- **One family for everything: Google Sans.** Both UI chrome and hymn content
  (titles, lyrics, the Output view) — superseding Board #10's Noto Serif
  Malayalam and the earlier plan to pair Roboto (UI) with a separate Malayalam
  content face. Verified directly, not assumed: downloaded the actual font file
  and inspected its charset — full Malayalam Unicode block coverage
  (U+0D00–U+0D7F, gaps only at codepoints Unicode itself leaves unassigned),
  shipped under OFL 1.1, weights 400/500/600/700 all available. It's Google's
  own current product UI typeface (Android, Gmail, and newer products have been
  moving off Roboto to it), so it's a more authentic Material identity than
  Roboto now, not a departure from one — and one family end-to-end is a simpler
  type system than pairing two. Noto Sans Malayalam and Noto Serif Malayalam
  stay in the stack as fallbacks. A second hymnbook's script picks its own font
  the same way, per hymnbook data, when that board arrives (arc42 §8.3).
- **Bundled as "Hymnal Sans"** — Google Sans, subset and renamed. Google's
  `TRADEMARKS.md` forbids the "Google Sans" name on a modified version, and
  subsetting is a modification. The subset keeps Latin-1, general punctuation
  and the full Malayalam block with all shaping rules (conjuncts), weights
  400–700 as one variable axis: 82 KB as woff2, against 1.58 MB for the whole
  font. Copyright, designer and licence records inside the font are unchanged;
  `src/fonts/README.md` has the rebuild command. Noto Serif Malayalam is no
  longer bundled.

### Hierarchy

| Token           | Size                                            | Weight | Line height | Use                                               |
| --------------- | ----------------------------------------------- | ------ | ----------- | ------------------------------------------------- |
| `display-small` | 36px                                            | 400    | 44px        | The Library's empty first run: "Bring a songbook" |
| `title-large`   | 22px                                            | 500    | 28px        | Screen headers (hymn title in Operator)           |
| `title-medium`  | 16px                                            | 500    | 24px        | Section labels (part label, "Recent")             |
| `label-large`   | 14px                                            | 500    | 20px        | Buttons, chips                                    |
| `label-small`   | 11px                                            | 500    | 16px        | Assist chip (recurrence cue)                      |
| `body-large`    | 16px                                            | 400    | 24px        | Running UI text                                   |
| `hymn-display`  | `clamp(1.25rem, 1.0625rem + 0.75vw, 2.1875rem)` | 400    | 1.7         | Lyric lines, Operator view                        |
| `output-line`   | `clamp(2.2rem, 6.5vw, 5rem)`                    | 500    | 1.35        | Output view, every line (lit or dimmed)           |

### Principles

- **No fixed px type scale for hymn content.** `hymn-display` and `output-line`
  are both `clamp()`s — phone and a large display sit on one continuous curve,
  never a jump between fixed layouts. `hymn-display` is layered under the user's
  own `--font-scale` multiplier (Board #10, `Settings`); `output-line` is not,
  since the Output fills a separate display the operator isn't reading.
- **The Output is a continuous scroll, teleprompter-style** (SDD-0001 §16.1):
  the whole hymn in one column, the focus lit in `output-ink` and centred, every
  other line dimmed to `output-ink-dimmed`. The focus mirrors the Operator's
  exactly — a whole part under whole-part focus, one line under line focus.
  Hierarchy is carried by color alone, never by size, weight or chrome.
- **No labels in the Output view unless the operator asks.** Part name, verse
  number and recurrence are Operator aids. Cues are opt-in, each its own switch
  in Settings > Presentation (and the command menu, not on screen: set once per
  service): hymn number, hymn title, hymnbook, part, repeat ×N. By default the
  number and hymnbook show, fading after a few seconds: what a congregation
  holding songbooks needs, then out of the way. With every cue off, nothing but
  lyrics renders there. The rule for all of them: **cues sit on still ground.**
  Nothing may scroll behind them, since movement across a fixed frame draws the
  eye, and the top of a screen reads as a notification. A filled island, then an
  outlined one, at the top both outranked the lit lyrics.
  - **The caption, a lower third**: hymnbook · title · ×N (e.g.
    `Hymnbook · Amazing Grace · ×2`) as plain `output-ink-dimmed` text centred
    in the bottom margin, no container. ×N shows only on a repeat.
  - **The part marker, on its part**: as in the whole-song layout, a small
    marker above the part's first line, inside its box so it scrolls with it,
    aligned as the part's text is, read from its computed `text-align`: centred
    over a centred part, on the lines' axis; at the start (logical, so it goes
    right in a right-to-left script) over a start-aligned one, the glyph's ink
    edge, not the box, on the ink edge of its widest line (measured, under a
    pixel, Latin and Malayalam), in the whole-song markers' type. That type is
    the Library language picker's gloss to its endonym ("français — French"):
    0.55 of the lyrics' size, weight 400 (lyrics 500), no tracking, normal case,
    a fixed 0.825em row so Malayalam glyphs never collide, in `output-ink-muted`
    (a step under the lit ink, at least 3:1 on each preset's ground: Warm 5.2,
    Dark 7.4, Light 3.2, Contrast 6.3) when its part is lit, and
    `output-ink-muted-dimmed` (muted at 55% over the ground, derived in every
    preset) when it recedes with the lines around it. A stanza reads its number,
    other parts by kind (Chorus, Bridge, Tag). It is not a detail of the bands:
    the text, not the marker, centres, and "Show parts" off lays the scroll out
    again without it.
  - **The number badge**, for those following in a printed songbook: the hymn's
    number in a FAB-like tonal tile (9% ink over the ground,
    `output-ink-muted`), top left, larger than the caption so it reads from the
    back, inset equally from top and left (in `cqmin`, so the corner gap stays
    even at any aspect ratio). It changes only with the hymn, so it's still
    ground too.
  - **The margins are reserved.** In the scroll the top and bottom safe margins
    are always 16%, with their soft edge fades, whether or not a cue shows in
    them: toggling a cue only fades its text in or out, and no lyric moves. The
    fit and the eyeline respect them, so lit lines never enter them, and the
    lyrics fade out inside them: only lines not being sung are ever dimmed by
    them. The whole-song layout reserves the same bands.
  - **Fade, one switch for all** ("Fade the details", on by default): the cues
    show together, at a new hymn, on the Output coming back from blank, or on
    Show the details now, and fade together 8s later. Part steps (keys, a hand
    scroll) don't bring them back: the caption's part changed every verse, so it
    kept returning alone. Fading as a broadcast lower third does, only opacity
    changes; margins stay reserved, so the lyrics never resize or move. Off,
    cues stay: someone arriving mid-hymn with a songbook still finds the number.
    **Show the details now** (command menu only, no key) brings them back for
    another 8s, from the Operator, since the operator is the one who knows
    they're wanted. Not hover or touch on the Output: a mouse there shows the
    cursor to the room, and projected screens rarely take touch. Per-cue delays
    were left out as complexity few would use.
  - Sized to the screen (`cqmin`), not the fit; they fade with the lyrics when
    blanked and show in Live like everything else. All inside the safe margin,
    never on the edge, which a TV's overscan crops.
- **Recurrence cue is a plain running ordinal** ("Repeat 2", "Repeat 3"), never
  "final repeat": a repeat only fires on an _immediately adjacent_ recurrence of
  the same part (evidenced against the corpus — 0 of 1,631 hymns ever repeat a
  part back-to-back in their printed sequence; 1,186 have the normal
  non-adjacent verse-chorus-verse-chorus pattern, which is not a repeat). In
  practice a cue only ever appears from an explicit live repeat — and the total
  isn't knowable in advance, so don't imply it is.

## Layout

### Spacing

Base unit 4px: `xxs` 4px, `xs` 8px, `sm` 12px, `md` 16px, `lg` 24px, `xl` 32px.
The Output view uses `safe-area` (10% from any edge) instead of the fixed scale
— a broadcast-graphics convention, not an MD3 one, because nothing in the Output
view is close enough to the frame to need a smaller unit.

### Structure

- **App shell: layers, after Supabase Studio.** Supabase handles a lot of
  function with a lot of breathing room by giving each concern its own layer and
  choosing width by content, not by page. Here:
  1. **Sections** (the app's top level): a navigation rail on the left from
     840px, a menu on a phone. Now: Present and Library. Reserved, not built:
     Feedback and corrections, About (acknowledgements, copyright, credits),
     Updates (over-the-air, as Supabase announces them). Settings moves to the
     rail's foot.
  2. **Switcher row**, Supabase's org/project breadcrumb: **Hymnbook ▾ / #908
     Title ▾**. Each crumb is a picker. The hymnbook picker lists installed
     books; the hymn picker is quick-find (number or lyrics). Choosing either
     **hot-swaps in place**: the Operator stays, the Output follows (snapping to
     the new hymn, never scrolling from the old one), and nothing is reopened or
     repositioned mid-service. On a phone (MD3 compact, under 600dp) with a hymn
     up, the crumbs shrink to the hymnbook's icon and the hymn's number: a title
     clipped to a letter helps no one, and both stay the buttons' accessible
     names.
  3. **Workspace**, full width (Supabase's `full`, for dense tools): the
     Operator below. Library and Finder use the default width, and Settings and
     About the small one.
  4. **Dock**, the transport pinned to the bottom (below); **Go live** top
     right. A command menu (Ctrl/⌘+K or `/`) reaches everything from anywhere:
     one box that finds a hymn by number or lyrics, or an action by name, each
     action showing its key (SDD-0001 §16.5). A `?` sheet lists every shortcut.
- **Operator workspace (Board #26).** Fixed areas, each answering one question,
  so a new feature joins an area instead of adding a row of controls:
  - **What they see**, a rail on the right from 840px: **Live** (the anchor, a
    true miniature of the Output at its 16:9 shape, with the part before and
    after dimmed), its controls at the end of its heading (one toolbar: Blank,
    Hold, End Live; the follow status joins it), then a divider and **Parts**:
    the Repeat row (Repeat · ×2 · Undo · Reset, holding its height) and the
    keypad (Chorus full width, verses in fixed-width cells).
  - **This hymn**: the lyrics in sung order, tap a part or a line to send it
    live (ProPresenter's click-a-slide-to-go-live).
  - **Coming up**: Recents now, the service queue later (Board #22).
  - This hymn, Recents and Queue are **tabs** in at most two **groups**: split
    side by side (the three-area look) or merged into one tabbed area. Each
    group's heading ends in a pane toolbar of icons, after VS Code's and Zed's:
    expand or collapse, move a tab (a ⋯ menu, only in a group of several tabs;
    the arrow points at the group it goes to), close the group (its tabs join
    the other); merged, split. Split and merge are also a Settings switch and
    command-menu entries. Expanding gives one group the room (the queue while
    planning, the lyrics while singing). Under 1400px wide they merge by
    themselves. What they see and the dock never move. No free docking or
    floating panes: mid-service, a pane dragged by mistake would move the
    controls. Popping Live out into its own window is noted for later.
  - **Areas are panels**: `surface-container-low` on the `surface` ground, 22px
    corners, 12px apart, no borders. Each has a quiet header, 52px tall: a small
    uppercase label (or its tabs) and at most one or two icon actions. (Headings
    on the ground above bodies as cards were tried on 2026-09-27 and dropped:
    the gaps between areas no longer read, and the toolbar icons floated apart
    from their panels.)
  - **One lead on screen**: the current part, in the tonal "selected" colour
    (softened for its size), its label in `primary`. Tonal always means selected
    — the current part, the selected key, the song that's up in Recents — and
    neutral always means an action at rest. Numbers are tabular, so nothing
    jitters as they change.
  - **One shape, one icon set.** Every control (buttons, keys, tabs, icon
    buttons, the search bar) is a rounded rectangle of `--button-shape`, never a
    pill beside a square; only MD3's switch stays a pill, being its own
    component. A chip inside a control nests concentrically. Icons are Material
    Symbols Rounded, all of them.
  - **Lyrics, every part in full.** A chorus's later showings show all their
    lines too. Folding them to a first line and "…" kept the list short, but
    made each step reshape the blocks (the leaving one folding, the arriving one
    opening), so the list jolted back and forth as it glided (§ Stability:
    nothing moves as state changes).
  - **Feedback without hover.** Touch has no hover, so the state that matters is
    **pressed**: a block or line darkens while a finger (or mouse button) is
    down, on every device, and the tap's result — the block becoming current —
    is the confirmation. Hover shading is extra, for pointer devices only, and
    faint on both blocks and lines.
  - **Lyrics, touch-first.** The whole block is the tap target (no hunting for a
    small "1" or "Chorus"); tapping a line sends that line live. **Scrolling
    only browses** and never changes what's live, so a stray swipe can't move
    the Output; only a tap does. Scrolled away from the current block, a "Back
    to Current" button floats up (chat apps' "jump to latest"): an action, so
    neutral, set apart by its shadow rather than by the tonal "selected" colour.
    The current block stays highlighted and, while you haven't scrolled away,
    centred. Only a step glides there: one tint layer slides and resizes from
    the old part to the new as the list scrolls, one motion (a line step keeps
    the tint still and only brightens its line). A jump of more than a screen
    (End, a distant part) fades the tint and lands the scroll instead of
    travelling through the song; Back to Current is the exception: it always
    scrolls there, the tint staying put, taking longer the further it goes (the
    medium time to a screen away, up to 450ms more), and it is offered whenever
    the current part is out of view, including the one a song opens on. A list
    shown anew (a tab, a split, expand or collapse, another song) lands on the
    current part at once, and the tint re-measures, never glides, as type size
    or width changes.
  - **Height matters too.** WCAG's Reflow sets a width floor (320 CSS px) but no
    single height floor, so the practice is to degrade gracefully. The stage
    needs Live and at least a row of the keypad: under 640px of height (a
    laptop's short window, split screen) Live becomes the strip there, and above
    that Live shrinks before the keypad does. The stage never scrolls as a
    whole; the keypad and the tabs scroll inside themselves, and the page never
    does.
  - **Blanked**: while the Output is blanked (B), Live dims and its heading's
    **Blank** control is pressed, reading **Restore** (the phone strip carries
    the same control). The operator can keep navigating behind it (SDD-0001
    §16.5). The On Air status reads **Blanked**, its dot emptied to a ring, so
    it shows on every screen, Live on screen or not.
  - **The Live toolbar**: Blank, Hold and **End Live** are one group of three
    quiet buttons at the end of Live's heading (and the phone strip's end), the
    same height and gap (4px; 12px, 48px squares, on the strip), centred on the
    heading's own line so they share the "Live" label's baseline; none floats at
    the middle. Each carries an icon and its word (an icon alone on the strip).
    End Live closes the Output window and waits, disabled, for one, as Hold
    does; it is the third member, not the header's.
  - **Hold**: a quiet text control beside Blank, in Live's heading and on the
    phone strip (a square icon, like Blank's). Pressed (tonal) and reading
    **Release** while the Output is held; off while no Output is open. Live
    keeps showing what the audience sees, undimmed, with a small tonal **Held**
    tag at its corner (under the strip, on a phone), and the On Air status reads
    **Held**, its dot squared like a pause mark; **Blanked** wins if both are on
    (SDD-0001 §16.6).
  - **Phone** (and anything under 840px): Live collapses to a thin strip showing
    the current line, expanding on tap. Below it the tabs, merged, with
    **Parts** as a third tab: This Song | Recents | Parts. On a phone one thing
    is worked at a time, the lyrics or the parts, so the keypad gets a tab's
    room rather than a strip of it. Parts holds what the stage holds from 840px:
    the Repeat row (Repeat · ×2 · Undo · Reset, holding its height) and the
    keypad (Chorus full width, verses in equal columns), scrolling inside like
    any tab. It opens on Parts. The transport is the dock. No snackbar: Undo
    stays in the Repeat row.
  - **Where a control lives follows how often it's used mid-service**: frequent
    ones (the tabs, expand and collapse, Repeat) stay on screen; occasional ones
    go into Settings. Nothing mid-service needs a trip into Settings: each pane
    toggle is also a key (L for Live) and a command-menu action. Letting the
    user move a control between screen and Settings is deferred, not dropped.
  - **Settings, grouped**: one sheet, MD3 list sections. **Display**: theme
    (System | Light | Dark) and text size (A− 100% A+). **Workspace**: Show
    Live, Split the tab groups, and Scrolling the Output moves this screen
    (switches). **Keyboard**: Keyboard Shortcuts is a page pushed inside the
    Settings sheet (nested navigation, § Motion), not a second dialog: its
    header says Back and returns to Settings, Escape too. Opened by `?` or the
    command, the sheet opens straight on that page and says Close.
    **Presentation** (part 4): at the top, **Go Live opens**, a segmented choice
    of **Automatic | This Screen | Output Window** (Automatic by default), and
    under it, in a disclosure shown for Automatic and Output Window only (hidden
    values kept) the Output screen (on a phone its three long labels drop the
    checkmark's slot, the pill still marking the choice); then the Output theme
    (Dark | Light | Contrast | Warm) and one switch per cue. The disclosure's
    **Output screen**, in Chrome and Edge only, is a choice menu (the Menu
    component with its trigger a button showing the choice, a chevron after it,
    never a native select) of Automatic and the screens by label and size
    ("Built-in" for the laptop's panel, a remembered one not attached marked
    "not connected"; the chosen one is the tonal pill; arrows, Enter and Esc
    work, and ArrowDown opens it). With one screen attached there is no list:
    the text "One screen attached" instead. A text **Detect Screens** button
    asks the browser to list the screens; its supporting line says what
    Automatic picks, or that permission is blocked. Hidden where the browser
    cannot place a window.
  - **Show/hide**: Live, remembered, and the tab layout (SDD-0001 §16.4). This
    hymn and the dock never hide.
- **One transport** (Board #26, PRINCIPLES.md). From 840px it sits at the
  stage's foot, under Parts, beside what it drives, on the keypad's edges: it
  never moves as the areas change (centred on the window, it lined up with
  nothing once the areas were unequal; following the main area, it slid). On a
  phone it is the dock, fixed at the bottom. Four equal buttons, **‹ Part · ∧
  Line · ∨ Line · Part ›**, the arrows giving direction and the full names the
  accessible ones. All four are equal peers in one neutral fill, none filled:
  nothing competes with the current part's highlight, which is what should lead
  during a song; and never tonal, which is the keypad's "selected". As width
  runs out all four go icon-only together (the stage's own width, or the
  dock's).
- **Go live → On air.** Opening the Output is a one-off, so it sits top right on
  every screen (where Slides and Keynote put theirs) as a tonal **Go Live**, and
  once the Output is open becomes the **On Air** status, which brings that
  window forward. Live's dot is the same on-air light: grey until then. On air
  is a custom colour, red harmonised to the amber seed (Material's method), with
  its own roles in both themes. Blanked is On Air's other state: **Blanked**,
  the dot a ring; Held is the third, the dot a small square. To go dark and keep
  the window, Blank.
- **One live button, one width** The header holds a single live control, in a
  box of fixed width (`.live-split`, 9.75rem; 5rem on a phone), so the search
  beside it never moves, whatever the state: the box is the longest label's room
  (**Blanked**, SwapLabel keeps every label's room) plus the chevron's, kept
  whether the chevron shows or not. Not live, the button fills the box. Live, it
  becomes a **split button** (Material 3): the main part, the status, brings the
  Output forward; a small attached chevron (a 2px seam, outer corners round, the
  seam's square) opens a menu of **End Live** (stop icon, Shift+E) and **Present
  on This Screen** (fullscreen icon, Shift+P), each with its key. Ending is one
  click on the chevron and one on the row; the common actions are never two
  steps: Go Live is one click, Blank and Hold one click in Live. **Go Live
  decides for you**, by Settings' Go Live opens: Automatic, with an external
  screen known (Window Management lists a second screen, or the chosen screen is
  attached), opens the Output window there, otherwise **presents here**; This
  Screen always presents here; Output Window always opens the window. Its
  tooltip says which. The explicit choices stay in the command menu (Open the
  Output Window, O; Present on This Screen, Shift+P).
- **Present here** (Board #41; SDD-0001 §16.7) is no button of its own: Go Live
  starts it where no external screen is known, and the chevron's menu and
  Shift+P offer it otherwise. Presenting, the app tab is the Output's own view
  full-bleed on its ground, with nothing of the shell on it and no notice. The
  one thing laid over it is the **quick switcher**: no card, the search field
  itself at the bottom centre, at most 30rem, its list (five rows, small,
  single-line titles with an ellipsis) above it, in the Output's preset colours,
  never the Operator's theme. Behind it, a full-width backdrop in the Output's
  own edge-fade distribution (the same gradient: ground solid to 60%, then
  clear) dims and, as a progressive blur (stacked layers of increasing blur,
  each masked to a shorter band), softens, both rising from nothing at the top
  to the most at the foot, with no visible boundary. It extends 2rem above the
  strip, follows the list's height as results come and go (250ms, emphasised),
  so the list sits inside it, not on an edge. While it is open the Output's
  bottom caption (book, title, repeat count) fades out. Nothing else is ever
  laid over the audience's screen unasked: there is no hint where the switcher
  is. The cursor is the Output window's: shown while the mouse moves, gone after
  2s still. It opens and closes with no motion beyond the list changing.
- **Another tab** (Board #36; SDD-0001 §10.4). A tab that cannot hold the books
  (another tab has them) is a full page: the empty card's own shape centred on
  the page background, display-small **Hymnal is open in another tab**, one body
  line ("Only one tab can hold your books at a time. Use it here, and the other
  tab will let go.") and the filled **Use Here**. Calm, not an error: no error
  colour, no icon, no alert role. The tab that let go shows the same note at
  once. While the request waits the button is disabled; if the other tab is
  presenting (its Output is open) the line becomes "The other tab is presenting.
  Close its Output window first, then use Hymnal here." and Use Here stays for
  another try. Two more lines in the same place: "The other tab is saving a
  book. Try again in a moment." and, after 5 seconds without an answer, "The
  other tab didn't answer. Close it, or try again." The Output window is never
  such a tab.
- **Snackbar.** The shell's one notice, for what needs a word but not a stop:
  **Update ready** with **Restart** and a close (Later), the note about keeping
  the book file after a first load whose storage request was refused, with **Got
  It**, and the Safari note about keeping books, with **Got It**. One pattern at
  every width, for every notice: a **floating card** on the current theme's
  `surface-container-highest` (text `on-surface`, the action in `primary`),
  elevation 3, 12px corners, never wider than 36rem, **bottom-left of the
  workspace, 16px in from the rail and from the bottom, level with the rail's
  Settings item** (from 840px; it ends before the Presenter's stage, so the
  transport at the stage's foot is never covered; on a phone the full width less
  the 16px gutters, **above the dock** and the safe area). It is fixed, so it
  never moves the layout and covers only the foot of the lyrics briefly. It
  **enters** rising from below with a fade (250ms, emphasised easing) and
  **leaves** the same way reversed (150ms); with reduced motion it only fades.
  Its action and close wear the shared hover layer as a group (Interaction
  states). In forced colours it gains a 1px CanvasText border. One at a time,
  the update first, then the keep-your-file note, then Safari's, and **never
  while the Output is live** (On Air or Blanked). It takes no focus; a
  persistent live region announces its message. Keyboard: Esc puts it away
  (Later; the note's Got It), and the command menu has **Restart to update**,
  **Dismiss the storage note** and **Dismiss the Home Screen note**. Its buttons
  have a visible focus ring. Undo still stays in the Repeat row, not here.
  **Screen notices** are the exception to "never while live": they are about the
  Output window itself and caused by it, so they show at once, are dismissed
  (**Got It**) and never repeat once seen. They use the same card, in the same
  place, so the layout does not move live, and they come before the update. Six:
  "Drag the Output to the projector, then press F11" (a plain popup, once, and
  **only when a second screen may exist**: `screen.isExtended` is true, with or
  without the Window Management API; where the browser cannot say (Firefox,
  Safari) or says one screen, it is not shown, so a single-screen user is never
  nagged), "The Output is on the projector screen. If it isn't fullscreen, click
  it or press F" (once), "The browser blocked the Output window" (pop-ups), "The
  screen the Output was on is gone" (the window stays), and "That screen is
  back. Move the Output to it?" with **Move it** and a close (Stay).
- **The Library** (Board #28 part 5; SDD-0004 §9). A list of the books held, in
  the default width, the mockup's `Library` header sticking under the switcher
  row as the Finder's field does (title-large, "N books on this device", and a
  tonal **Load Books** with a file icon, always there). Never a card per book:
  **one panel** (`surface-container-low`, 22px, 8px inside), a row per book
  inside it (14px), no borders, in the order added, never reordered, so the
  current book is marked and not hoisted (§ Stability).
  - **A row** is a 40px tile (the book icon), the title in the hymn face (500,
    line-height 1.6 so Malayalam conjuncts are not clipped, two lines at most,
    then an ellipsis; the full title is in the review), and one meta line,
    `Current · Language · N songs · Shipped|Loaded`. Segments wrap whole and
    each brings its own dot, clipped when it starts a line, so **a line never
    starts with a dot**. From 600px the count is a right-aligned column, tabular
    (`1,631` over `SONGS`, 4.25rem at least), so counts line up, and leaves the
    meta line. The row is the button that chooses the book; ⋯ (the menu's icon,
    48px) is beside it, the same on every row.
  - **Current** is tonal and says so: `secondary-container` fill, a
    `primary-container` tile, and the word Current (fill alone is too faint in
    light). Neutral rows are actions at rest. A book just loaded is outlined in
    `primary` and tagged **Added** for a few seconds, and scrolled into view.
  - **A book that cannot be opened** is a row that does not choose: an
    `error-container` tile (a warning icon, or an update icon for a newer app),
    the title (or the key, if it has none), a status line in `error`, **Needs
    reloading**, **Can't be read**, **File missing** or **Needs a newer app**,
    one sentence, and **Load Again** (text button) where a file can fix it.
    Remove is in its menu.
  - **The menu** is the Menu component with its list kept for one item:
    **Remove…** with "Drops the book and its Recents". A shipped book's is
    disabled, "Shipped with the app".
  - **From Text** (Board #34; SDD-0004 §9) is a text button left of Load Books
    (its icon dropped under 600px), and a tonal button under the filled one in
    the empty card. It opens the **text sheet**, a tall sheet of the review's
    kind: filled fields (the search field's fill, a 2px `primary` ring on
    focus), the title; the **language**, a searchable picker of languages by
    name, each in its own name and in English ("മലയാളം — Malayalam"), in the
    menu's surface and rows, opening in the flow under its field (never over the
    keyboard), ending in **Other…** to type a code; under it a quiet line,
    "Script: Malayalam (Mlym) · Change", the script derived from the language
    and a field only after Change; then two text areas in the hymn face (the
    song text, with **Open .txt Files**, several at once, and the optional
    **Original text, to check against**, with **Open a .txt** and a hint line:
    paste the book as printed and Hymnal checks the songs against it). The id
    and the optional song number sit under an **Advanced** disclosure, which
    opens by itself when one of them is asked for. The areas scroll inside
    themselves (at most 40% of the height); one filled button, **Review the
    Book**, is pinned at the bottom as the review's is. **Every error is a field
    error**: the field gets the `error` outline and its helper text turns
    `error`, under the field. Parse errors are listed under the song text, one
    line each, "Line 12: message"; "There is no song text." is that field's
    error too. No callout, no table. The first field in error is scrolled into
    view. The review that follows is the same sheet, with a **Source check** row
    in its facts and, when lines differ, a neutral callout and two lists (Added
    or altered, Dropped), each scrolling inside itself.
  - **Several books**: Load Books takes several files at once (Load Again one),
    and **Open .txt Files** joins several `.txt` files into one song text with
    `---` between. The review of several is a queue: the sheet says **Book 2 of
    5** and the file's name between **Back** and **Next** chevrons (48px,
    disabled at the ends; the arrow keys too), so every book can be looked at
    before any is decided; the header reads Close. A book loaded says **Loaded**
    in place of its button; loading one shows the next open book. A file that
    cannot be read is said in the list and passed over. Closing the sheet asks
    nothing, leaves the open books unloaded and says "2 books not loaded" in a
    snackbar.
  - **Reading a file**: the picked file's row appears first in the list, a tile,
    "Reading <file>", the line "Checking the file on this device. Nothing is
    sent anywhere.", an indeterminate bar and Cancel, with Load Books disabled.
    No spinner. From an empty Library the empty card turns into the same lines
    in its own shape.
  - **Nothing held** (the first run): the card keeps the skeleton's shape,
    display-small "Bring a songbook", one body line (load a file or type one in;
    it stays on this device), the filled **Load Books** and a tonal **From
    Text**. Find and Go Live are disabled.
  - **The review** is a sheet, bottom under 840px and centred from it, taller
    than the others (88% of the height), its Cancel pinned, its content
    scrolling and its one action bar sticky. Read-only throughout: the book's
    title and `Language · N songs`, a facts list (language with its code and
    script, origin, the file as `sha-256` and twelve hex digits in groups of
    four), then the verdict's panel and its choices:
    - **A refusal** (`error-container`; the violations listed all, by song and
      rule, none repaired; or a newer format, naming both versions; or not a
      hymnbook file). The only action is **Choose Another File**; the header
      reads Close.
    - **Same file**: a neutral panel, nothing written, **Open Book**.
    - **Same songs**: a neutral panel naming the book, and that opening records
      the file; **Open Book**. Cancel records nothing.
    - **Same origin**: radios, **Keep both** first and chosen, then **Replace
      <book>** for each loaded book (a shipped one shown, disabled, with why);
      each says what it does, Replace that it swaps in the songs and keeps the
      book's place, its Recents and its position; choosing one adds "Replace
      can't be undone". One filled button whose label follows the choice (**Keep
      Both** or **Replace**, as wide as the longer).
    - **New**: a quiet primary-tinted panel and **Load Book**.
    - **Load Again** (a review aimed at a book that could not be opened):
      "Brings a book back", the held book named, and **Restore Book**; a file
      whose title is not the book's adds a warning panel naming both titles.
    - Songs held in other books: a quiet line under any loadable verdict, by
      book, "They load anyway."
    - _ADR-0029, later:_ "Not checked against a source" is the facts list's last
      row. Not drawn yet.
  - **Remove** is a sheet of the same shape: the book, "This removes" (its
    songs, its Recents with their count), a note that the file is not touched
    and the book has no other copy, and, for the current book, which book takes
    over (or that none will). One filled destructive **Remove Book** (`error`).
  - **Keep your file** is the snackbar's note (above), after a first load whose
    persistent-storage request was refused; a granted request says nothing.
  - **Choosing and loading**: a load never changes the current book, unless none
    is (the first load); Open Book and a tap on a row do, and a tap on a row
    goes on to Present, the Operator, as it used to. ⋯ stays in the row. The
    Finder follows the current book; the hymn on screen stays until one is
    chosen from the new book (SDD-0001 §16.4).
- **Rhythm and states.** One 12px gap above, between and below the areas.
  Disabled is the whole control at 38%, whatever its style. Only floating things
  cast a shadow (menus, sheets, the snackbar, Back to Current); cards and panels
  are flat and tonal. Keypad keys show selection by fill alone, no tick (the
  fill glides from key to key, § Motion), and a short last row is centred. A
  selected control keeps its tone under hover and press: a state layer would
  grey it toward the neutral action colour and read as losing the selection.
  **Key caps** (shortcuts, the command menu, Ctrl+K) share one height and a 6px
  corner nested in the 12px controls, a tone above what they sit on, with a
  lower edge that keeps them reading as keys. A combination is caps joined by a
  small, muted "+" that belongs to the key style (the `KeyCombo` component, the
  one place a shortcut is drawn: search box, command list, Settings, the
  shortcut sheet); a single key is one cap. A tooltip stays text and spells a
  chord "Ctrl+K". Keys read Ctrl on every platform, as the app handles Ctrl and
  ⌘ alike. A control whose label changes (Blank and Restore; Hold and Release;
  Go Live, On Air, Blanked and Held) is as wide as its longest label, so the
  swap never resizes it. Repeat, Undo and Reset are text buttons: occasional, so
  quiet.
- **Motion** explains change, at Material's emphasised easing: areas glide to
  their places on expand, collapse, close and split (View Transitions of the
  panels only, not the whole page, which halved the frame rate); a panel
  reshapes but what's in it keeps its size, clipped as the panel glides, never
  stretched (the Split jitter). **The fold**: crossing 840px is MD3's
  fade-through — the old screen fades out (90ms), the new one fades in and zooms
  in from 92% (210ms), each through a slight blur (4px); the switcher row stays
  (`fold.ts`: not a View Transition, which Chromium skips on a resize). **A
  theme change** is revealed: the new theme spreads over the old in a soft-edged
  circle (feathered by 2% of its reach, 24px on a 1080p Output, so Live, the
  Output's scale model, looks the same; 5% over the Operator's own theme,
  softer, as nothing there has to match; one width from start to end), 500ms at
  the standard easing (the emphasized one flipped the middle, where the current
  line is, almost at once), from the control chosen, or from the middle on the
  Output. The presentation's theme plays in the Operator's Live preview too,
  from its middle; in the Live strip, one line of text, it opens from the middle
  like a curtain, straight soft edges moving out, not a round blob crossing the
  letters. Never a crossfade, which halfway makes text and ground the same grey.
  A still copy of the window in the old theme lies over the page (sheets too)
  and a hole grows in it, so what shows through is the page itself; a View
  Transition's snapshot gave way to the page at the end with a visible flicker
  of the text. The copy holds still until frames come steadily (two in a row,
  600ms at most): the first paint is slow, and a system or browser theme change
  brings more as the browser repaints itself (150–367ms, measured), which the
  circle would jump through. Controls' own colour transitions end as they start,
  in Live too, where the lines' 200ms fade under the hole read as a crossfade
  (`theme.ts`). The system's theme changing, while the Operator follows it, is
  revealed from the middle: its media query's listener runs as the frame begins,
  before it's painted. Panels once glided into the other layout, but the two
  share too little and a window still being dragged stranded them mid-way. A tab
  change is not a layout change, so the tab bar's one pill glides to the
  selected tab and the new content softly zooms in, in the page itself (a View
  Transition there cross-faded snapshots of the tab labels, which flickered).
  **The parts pad's selected key** is one pill behind the keys, not a fill on
  the key: whatever changes the current part (a key, Part and Line, the
  keyboard, digits), the pill glides from the old key's box to the new one's,
  position and size together over 250ms (never a scale, so its corners keep
  their radius) and softening to a 2px blur at the middle of the move, crisp on
  landing (the pill alone; not under reduced motion or forced colours), as the
  label's colour changes over the same time. It travels the real way, as one
  object: where a plain move of the two boxes would send an edge against the
  travel (a key on the right floating left into the full-width Chorus bar would
  swell its right edge rightward; the bar narrowing to a key on the right would
  pull its right edge leftward) that edge holds while the rest sets off, starts
  30% of the way in (75ms) and arrives with the others, so the pill is seen
  moving, then stretching, never swelling out of its middle (`glidePath`,
  `glideGeometry.ts`: sampled in time, the emphasised curve applied there).
  Between keys, on a row or across rows, nothing goes against the travel and the
  glide is the plain one. Both label colours are dark on the pad's light fills
  (light on its dark ones), so the text reads whether the pill is under it or
  not. With no pill yet (the pad shown anew, a song just changed) it appears in
  place, and a pad that reflows, from a window resize, a phone or a desktop
  width, keeps it on its key without animating (`padGlide.ts`). A song chosen
  from Recents glides to the top, every row moving from where it was to where it
  lands, the group headings (Today, Yesterday, Before) with them; the rising row
  passes over the rows it crosses, not under; a heading whose group emptied
  fades out where it stood (150ms). A menu grows from its button and shrinks
  back to it, quicker (150ms, the exit easing); a sheet rises over a blurred
  page and sinks away on close; every control's change of state eases. **Sheet
  pages** (nested navigation inside one sheet, `Sheet`'s `page`): the one
  `<dialog>` stays open, so the scrim never blinks, and its content pushes and
  pops. It is the tab switch's timing (`tab-in`: 250ms, the emphasised easing, a
  fade) with the Repeat count's travel and 2px blur (`roll-in-*`): the new page
  comes from the inline-end (2.5rem), the old one steps 1.5rem toward the
  inline-start, both fading through the blur; Back is the mirror; the header's
  title cross-fades; the sheet's height eases between the two pages' heights
  (capped by the sheet's own maximum, so two tall pages hold still). Focus moves
  to the new page's heading, and Back returns it to the row it left. Reduced
  motion is a crossfade: no travel, blur or height glide. The root stays mounted
  underneath, so its scroll position survives. **Press**: a control gives a
  little under the finger (96%) at once and springs back with a slight
  overshoot, Material 3 Expressive's press kept small; an icon that changes
  meaning (Blank to Restore) turns in. The Repeat count is a rolling number (an
  odometer): the old count rolls out as the new one rolls in, up as it grows and
  down on Undo. **Reset** counts it down through the numbers (×9, ×8 … ×1), the
  first at once and each pause shorter, the whole run capped at about 450ms
  however large the count (a big count skips numbers), then the ×N fades; the
  last Undo rolls to ×1 and fades too. The state (and the Output) change at
  once, only the display counts; reduced motion has no countdown, the number
  just fades; the count's room stays, so Undo and Reset never move. Moving to
  another part follows the count at once. It is in the text colour, not Repeat's
  primary: coloured text means a control. Each rail section eases in on arrival,
  the Library as the Operator. In the command menu the highlight follows a
  moving pointer and leaves with it; Enter then takes the top match (§
  Interaction states). Reduced motion shows the end state, with what appears and
  goes keeping its fade: a menu, a sheet and its scrim, a tab's content and a
  notice fade and lose their zoom, rise and sink. **The Lyrics tint** slides and
  resizes with the scroll in 250ms (`lyricsGlide.ts`: one animation clocks both,
  so they land together; translate and height, never scaleY, which warps the
  corners). Its leading edge arrives first and the trailing edge follows, so it
  stretches over the new part, then lets go of the old; a jump of more than a
  screen fades it instead. The text changes colour in those same 250ms and
  easing, so the part the tint leaves dims and the one it reaches brightens as
  the tint passes, never ahead or behind it. **Full Song's tint** (SDD-0005, the
  Output) does the same within a column. Across columns it fades, overlapped so
  some part is always lit: the old tint fades out in place over the first 60%,
  the new one fades in over the last 80% travelling 1.6em from the left, the
  text following in step. A page turn is a handoff within 250ms: the old page
  fades out over the first 110ms, the new one rises 12px and fades in from 90ms
  (a 20ms overlap at low opacity, so text never doubles), the tint going out and
  coming in with its pages. Reduced motion shows the end state.
- **Motion tokens** (`src/styles.css`, `:root`): `--motion-emphasized`
  `cubic-bezier(0.2, 0, 0, 1)` for what moves (glides, enters, selection);
  `--motion-exit` `cubic-bezier(0.3, 0, 0.8, 0.15)` for what leaves;
  `--motion-standard` `cubic-bezier(0.4, 0, 0.2, 1)` for what only changes
  colour (hover, state layers, a track); `--motion-short` 150ms (a press, a
  corner, a notice leaving), `--motion-medium` 250ms (a glide, a pill, an
  entrance), `--motion-hover` 250ms (a state or hover easing in or out: keep
  within 200-300ms), `--motion-switch` 300ms with `--motion-switch-ease`
  `cubic-bezier(0.34, 1.3, 0.64, 1)` (the switch's thumb), `--motion-spring`
  `cubic-bezier(0.34, 1.4, 0.64, 1)` (a released press). Blur: 2px at the middle
  of a selection pill's glide (`PILL_BLUR`), 4px at the end of a hover layer's
  entrance and exit (`HOVER_BLUR`). Reduced motion keeps fades and drops glide,
  blur, zoom and spring.
- **Loading: the shape of what's coming, in its place** (Board #26 part 4). A
  screen still loading shows a skeleton of itself: the Library its header and
  two rows of its list, the Operator its panels, empty, where they will sit.
  Content then fills in and nothing moves (§ Stability). The skeleton appears
  only after about 300ms, so a fast load shows nothing; while shown it carries a
  soft shimmer, static under reduced motion. No spinner, and no bare "Loading…".
  A real wait gets real progress: the first install of a hymnbook is a bar with
  words ("Installing the songbook for offline use…", not its title: that is
  inside the file still arriving) and megabytes, determinate when the download's
  size is known, else indeterminate. Go Live holds the right edge from the first
  frame, loaded or not. A hot-swap needs none: the song on screen stays until
  the next has loaded (SDD-0001 §16.4).
- **Sheets** keep their title and Close pinned to the card's top: the header is
  a fixed row of the card and only the content below it scrolls (so nothing, not
  even a scroll into view, can move it away), and the card ends a space (16px,
  or the safe area) after the last control, with no empty slab. Every sheet is a
  centred card from 840px and a bottom sheet under it, following the window as
  it's resized (fading through with the page). The command menu is called
  **Search**; Settings has its own search, which hides rows (and empty sections)
  that don't match.
- **Words**: "song" on screen (This Song, Find a Song, 1,632 songs); the code
  and domain keep "hymn". **Case, after Apple:** Title Case (Chicago: a, an,
  the, and, or, to, of, on, in stay lower unless first or after a colon) for
  what's pressed or navigated — every button (also a notice's action), tab, menu
  and command name, sheet title, status (Go Live, On Air, Bring the Output
  Forward, Present Here); sentence case for what reads as a sentence — switch
  labels and their descriptions, field names, placeholders, tooltips, empty
  states (Find a song or action, No recent songs yet). `titleCase()` titles the
  command menu. Small-caps area titles stay uppercase. **Song titles** are Title
  Case wherever shown (I Serve a Risen Savior; a bracketed subtitle starts
  afresh); content keeps them in sentence case, which keeps which words are
  names, and a script without case is left as it is.
- **Output: nothing ever bleeds off the screen.** The type is sized **per hymn**
  so its longest part fits between the 16% bands, then held for the whole hymn,
  so the text never changes size between parts. It's re-fitted on resize and
  font load, down to a floor; only a pathological part (20+ lines) goes past the
  floor, and then whole-part focus starts at the top margin, and line steps
  still work. The focus sits a little above centre (about 42% down, a
  teleprompter's eyeline), clamped inside the margin. Sizes are container units
  (`cqmin`), so the Operator's **Live pane is the same component scaled to its
  box**: a true miniature, identical line by line, not a separate rendering.
- **Output**: full-bleed, one centred column scrolling vertically, the focus
  held at the eyeline, the safe-area margin around it and nothing else on
  screen. Parts are separated by a gap of about half a line, as in a printed
  hymnal: where a verse ends and the chorus begins is visible without a label.
  Scrolled by hand, the highlight becomes a reading band fixed where the focus's
  part sat, one part tall, lighting whatever passes through it, until the scroll
  rests (SDD-0001 §16.1).
- **The chorus, pinned** (SDD-0001 §16.1, "Pin the chorus", off by default): in
  its own pane, dimmed until sung and lit in place when it is, while the verses
  scroll alone. **Side by side** on a landscape screen (verses left, chorus
  right, both on the eyeline), so the back rows see it over the heads in front;
  **a band at the foot** on portrait, or when side by side would shrink the type
  below 70% of full size (5.25% of the screen's shorter side). A hymn that
  neither layout can hold there flows. Only the chorus pins; a bridge or tag
  stays in the verse column. In these scroll layouts no part carries a mark (no
  box, glow, rule, label or italics): being sung, it's lit like any other, and
  the part gap sets it apart. The one exception is Full Song, below.
- **Full Song** (SDD-0005, Presentation > Layout > "Whole song", off by default,
  landscape only, in place of the scroll and its pinned chorus): the whole song
  at once in its printed form, in columns, left-aligned (one column: centred).
  Nothing scrolls. Parts are whole, in printed order, balanced across as few
  columns as buy type size; the type, one size for the song, shrinks to fit,
  down to a fit of 0.275 of 9cqmin (26.7px on a 1080p screen). A song that would
  need less is split into pages of whole parts and the page turns with the tint;
  no page says so. A chorus the song sings after its verses is printed again on
  each page that sings it, after the verse it follows, so the tint moves from a
  verse to its chorus to the next verse of the page without a page turning; only
  a step to a verse on another page turns it. **The tint is a mark here**, the
  one exception to the rule above: with no eyeline to say where the song is, a
  box behind the current part (9% ink over the ground, the badge's tone, corners
  0.4em) does, and the lit part's text is lit, the rest dimmed, by colour alone.
  Margins, cues and the ground are the scroll's. **Highlight on the Output**
  (Presentation, and the H key) can be _Whole song_ in this layout and the
  scroll alike: every part at full brightness, no tint, no dimming, for singing
  straight through; the switch animates the colour and the tint in 250ms, at
  once under reduced motion.
- **One hard breakpoint** (`~60rem`), not to change the type scale but to cap
  reading-column width on a large display — unconstrained lines on a big screen
  are exactly as illegible as too-small text on a phone.

### Stability: controls never move as content changes

Parts differ in line count and the selection moves every few seconds, so
anything positioned by content would drift under the operator's pointer or thumb
mid-service. Three rules follow:

- **The dock is fixed at the bottom** whatever the content's height, the
  transport centred in it. The page reserves the dock's height, so nothing hides
  under it and the gap above it is the areas' 12px.
- **Tapping the current part's chip restarts it**, never repeats it: a stray tap
  can't queue a verse the congregation would see twice. Deliberate repeats
  arrive in part 4 (Presentation) with what makes them legible. **Repeat** sits
  in the Parts pane above the chips, in the same place for every hymn; while the
  cursor is on a repeat, its count (×2) and **Undo repeat** (takes back one
  showing) appear after it, moving nothing, so a third Repeat is still one tap.
  From ×3, **Reset repeat** follows (back to a single showing at once); at ×2 it
  would only do what Undo does. Repeat and Undo are also in the command menu,
  with keys: **R** repeats, **U** undoes the last repeat, as the buttons do
  (disabled or not applicable, the key does nothing). Reset has no key: a button
  from ×3 and a menu item. A repeat stays on the same page with its count going
  up (×2, ×3 …): the Output doesn't scroll to a copy, Lyrics shows one block
  marked ×N instead of a stack, and the Output can show that ×N as a cue.
- **Special parts first, then the keypad.** Choruses, bridges and tags
  (unnumbered) come first as full-row chips; numbered stanzas follow as a keypad
  in number order, whatever order the hymn stores its parts in — a hymn that
  stores verse 1 before its chorus must not split the keypad around it.
- **Part chips sit in a grid of equal cells**, in the hymn's part order:
  numbered stanzas one cell each, so 1, 2, 3… always land in the same places;
  choruses, bridges and tags (unnumbered, longer labels) span a full row. The
  rail reads as a keypad, not a word-wrapped sentence. Cells are a fixed size,
  never stretched, and the grid is at most as many cells wide as the hymn has
  stanzas (three minimum), so a full-row chip spans the stanzas beneath it, not
  the whole card.
- **Selecting a chip never changes its width.** Every filter chip reserves the
  checkmark's slot; selection only fills it. A wider selected chip would rewrap
  the rail and move everything below it.
- **The Operator screen fits the viewport and never scrolls as a page.** Each
  pane scrolls inside itself instead: the sequence (kept centred on the current
  block), and each supporting pane in its column or sheet. Across the corpus the
  longest part is 4 lines at the median and 12 at p99, but a few run to 21–29
  (#924, #1274, #890, #930), and #908 has 20 parts, so any layout that sized
  itself to content broke somewhere.
- **The dock never wraps.** All four labels go icon-only together before the
  transport runs out of room, not after it has broken onto two lines. That's
  decided by measuring whether it fits, not by breakpoints: type follows the
  user's text size, so a button's width isn't a fixed number a breakpoint could
  be tuned to.

### Buttons: icons, groups and names

One rule, for every button in the app, so a row never looks half-dressed:

- **A group carries icons all or none.** Text buttons side by side in one
  toolbar, row or button group (the Repeat row: Repeat, Undo, Reset; Live's
  toolbar: Blank, Hold, End Live; the transport) either all have an icon or none
  do. When the group is narrow, all of them go icon-only together, never one by
  one.
- **A lone text action has no icon**, unless the icon carries meaning the word
  does not: the one standalone button of a sheet, card or notice (Done, Cancel,
  Retry, Got It, Use Here) is its word. An icon that is part of what the button
  _is_ (Load Books, Open .txt Files: a file; Back to Search: an arrow) stays.
- **An icon-only button always has a name and a tooltip:** an `aria-label` (or
  visually hidden text) and a `title`, with its key in the tooltip when it has
  one. Where a text button drops its word to fit, the word stays as the name.
- **Icons are masks** in the existing style (`.icon-*` in `styles.css`: a
  Material Symbols path as `mask-image`, so the icon takes the text colour),
  never an image or a glyph. A new icon is added there, once.
- **Names are in Title Case** (§ Words): every button, tab, menu item and
  command, including a notice's action (Got It, Move the Output There) and a
  split menu's rows (Present on This Screen). Sentences stay in sentence case.

### Register: composed, not cozy

Default M3 is a consumer register: pill buttons, large radii, soft bubbles.
Supabase is the opposite, dense and technical, for developers. A hymnal operator
sits between them: calm, composed and legible, the tone of a well-set printed
hymnal rather than a chat app or a console. So:

- **Shapes step down one notch.** Every control uses M3 Expressive's square
  shape (12px, `--button-shape`), not the default pill: buttons, keys, tabs,
  icon buttons, the search bar. Panels use 22px. Only the switch stays round:
  that shape carries meaning.
- **Room, not padding.** Breathing room comes from space between groups
  (Supabase's rhythm), not from inflating each control. Controls stay compact;
  gutters and section gaps stay generous.
- **Icons lead, padding follows M3.** A button with a leading icon uses 16px
  before the icon and 24px after the label (M3's own rule), so the icon doesn't
  look inset. The rail's selection indicator takes the square register too
  (8px), not M3's default pill.
- **Pickers keep their bearings.** The switcher row and the search bar stay put;
  results and Recent scroll beneath them.
- **Search looks one way everywhere**: the switcher row's bar, filled tonal, no
  outline, a leading search icon, a 2px primary ring on focus. Only the switcher
  row's shows its key cap. No Find button: results come as you type, and Enter
  (a phone's Search key) opens the first.
- **Scrollbars keep their own lane.** Every scrolling pane reserves a stable
  gutter, so a scrollbar never overlaps content, and pads its content inside on
  both sides. Scrollbars are thin and in the outline color, and **hidden until
  needed**: they fade in (about 150ms) while the pane is scrolling, hovered or
  holds focus, and fade out (about 400ms) once it's still again, the way phones,
  macOS and Windows 11 already behave, so nobody meets it for the first time
  here. The gutter stays reserved, so nothing shifts. Reduced-motion users get
  the change without the fade.
- **Flat before raised.** Hairline `outline-variant` borders separate layers
  (switcher row, rail, dock); shadow is reserved for things that float (menus,
  sheets, the snackbar, Back to Current).

All of it lives in shape and spacing tokens, so the register can be tuned
without touching components.

### Whitespace philosophy

The sequence is the one surface in the Operator view that should feel unhurried
— generous padding (`lg`) around each block, nothing crowding the current one.
Everything else (dock, chips, top bar) is deliberately compact, since it's UI
the operator glances at, not reads.

## Interaction states

MD3's standard state layers, not invented here. A state is an overlay of the
element's own content color over its container: **hover 8%**, **focus and
pressed 10%**, except on a selected control, which keeps its tone (its press
shows as the squeeze in § Structure, Motion). Disabled is 38% content on a 12%
container for filled components, 38% content alone otherwise. Keyboard focus
also gets a 3px `secondary` ring, offset 2px, visible only via `:focus-visible`
— the Operator is keyboard- and remote-driven (arc42 §8.8), so focus must always
be findable.

**Hover and press ease** in and out over 250ms (`--motion-hover`; within the
200-300ms a hover should take) at the standard easing,
`cubic-bezier(0.4, 0, 0.2, 1)` (`--motion-standard`): the emphasised easing does
nearly all its work in the first tenth, and a hover with it reads as a snap. A
button's state layer is its own colour at a share (`--state-a`, a registered
number, so it can ease: a colour that mixes `currentColor` does not), 0.08 on
hover and 0.1 pressed. A press tint comes at once (80ms) and goes as a hover
does. Reduced motion keeps these fades.

**List highlight.** Wherever rows are hovered (a menu, a choice menu, the
language list, the hymnbooks sheet and the menu sheet, the rail, the Library's
books, Recents, the Finder's results and the command menu, a segmented button, a
section of settings, the tab bar) there is one highlight layer, the hover colour
above, that **glides** (translate and height, 250ms (the medium duration),
emphasised easing) to the row under the pointer or the keyboard's focus. It is
one primitive, `glideRows` (`hoverGlide.ts`; `glideList.ts` for a list with a
selection too), not a copy per list. **Entering**: the layer arrives from the
side the pointer crossed the list's edge by (a row's height above or below, half
its width, at most 96px, beside), fading up from 0 and out of a 4px blur.
**Leaving**: it drifts out toward the side the pointer left by, by as much,
fading to 0 into the same blur; moving back in while it fades carries on from
where it is. **Between rows** it only glides. Crossing a gap between rows does
not let go (it waits 60ms for the next row). **Keyboard focus** moves it by
glide and brings it up by fading in place, with no side: a stale pointer never
gives it one. A list whose highlight is something else's as well (the Finder's
and the language list's active row, Enter's target) shows that row with the same
layer (`show(row)`). The rows paint no hover of their own. Touch has no hover:
no layer there, and a tap leaves nothing behind.

**Buttons wear it too.** A group of adjacent buttons (a pane's toolbar: expand,
move, close; the text sizer's A− and A+; Repeat, Undo and Reset; the transport's
four; the hymnbook and hymn crumbs; Go Live and End Live; a notice's action and
close) is a list: one layer glides between them (`hoverGroup`, `.glide-group`;
Repeat's row waits 300ms over the count between its buttons before it lets go).
A pointer still moving within 28px of a row, over the space between two, keeps
the layer and restarts that wait, so a slow hand crossing the rail's gap glides
from item to item on either axis, never out and back in place. A lone button (a
sheet's Close or Back, Back to Search, Blank and Restore, the menu button, the
search box) has the layer inside it, entering from the side the pointer came by
and leaving by the side it went (`hoverButton`, `.glide-self`). Neither paints a
hover or focus fill of its own; a press still shows its state layer and squeeze.
A pressed control (Blanked) keeps its tone and shows no layer. The lyrics card
is a list too, of lines and blocks: one layer glides between them, wearing each
one's corner radius (a row says so with `--glide-row-radius`; it glides with the
move), over the current part's tint so a line of it is lit, though the current
block as a whole is not. The parts pad's keys are rows of the pad: the layer
sits over the keys' fills and **under the current key's pill**, which wins, so
the chosen key keeps its tone under the pointer (fill, hover, pill, key).
Reduced motion: no glide and no blur; the layer fades up and down where it is,
and between rows it moves at once.

**Selection is the tonal pill, everywhere**: `secondary-container` with
`on-secondary-container` text, with no check and no accent-coloured text. It is
the parts pad's pill, the rail's, the hymnbooks list's, the Library's current
book, the selected tab (the tab bar's own pill), the chosen option of a review
(Keep both, Replace), a choice menu's chosen item, the language list's, a
segmented button's, the current song in Recents. Where a list has a selection
that can change in place (the rail, the Library, the menu sheet, the hymnbooks
list, a segmented button, the output themes) the pill is one layer behind the
rows that **glides** from the old item to the new one (`selectGlide.ts`, the
pad's geometry and plan): 250ms, emphasised easing, position and size together
(never a scale), softening to a 2px blur at the middle and crisp on landing, the
label's colour changing over the same time. With no pill yet (the list shown
anew, the first book) it appears in place; a list that reflows keeps it on its
item without animating. The hover layer sits under the pill, so a chosen row
keeps its tone under the pointer. The output themes' pill is a ring (3px
`primary`, offset 2px) around the swatch, which glides the same way. Reduced
motion: the pill fades up where the selection now is. In forced colours the pill
is `Highlight` and its label `HighlightText`. Recents does not glide a pill: its
rows themselves travel when a song is chosen, and the current row wears the
fill.

**The switch** (MD3's motion): the thumb is 16px off, 24px on, 28px under the
finger. It is always drawn at 24px and scaled, so it moves on the compositor. It
travels 20px and scales in 300ms (`--motion-switch`) at
`cubic-bezier(0.34, 1.3, 0.64, 1)` (`--motion-switch-ease`), which overshoots
its travel by about 4%: a touch of spring, never a bounce. The track's colour
and the thumb's ease over the same 300ms at the standard easing. A 40px halo
follows the thumb, 10% for keyboard focus (`:focus-visible`) and pressed, fading
at the hover duration. Not on pointer hover: a switch sits in a settings row,
and the row is the target, so hover shows the row's highlight alone. Reduced
motion: the thumb is where it is at once; colours still fade.

`list-row` covers what the component list above otherwise lacks: a Finder search
result or recent hymn is one full-width, tappable row, the title in `on-surface`
and a snippet in `on-surface-variant`, never a button styled as a button.

## Elevation & Depth

| Level             | Treatment                                    | Use                                      |
| ----------------- | -------------------------------------------- | ---------------------------------------- |
| Flat              | No shadow                                    | Top bar, keys, buttons at rest           |
| Tonal (level 0→1) | Shift to `surface-container-low`, no shadow  | Panels, cards                            |
| Floating          | Soft shadow (`0 1px 3px …, 0 4px 8px 3px …`) | Menus, sheets, snackbar, Back to Current |

**Shadow philosophy.** Only what floats above the page casts a shadow, one level
of it; resting surfaces are tonal and flat, and nothing else gets one. A heavy
drop shadow anywhere reads as Material 2, not 3 — elevation here means "which
tonal step," with shadow only confirming it.

## Inspiration — and why these, not generic SaaS

Deliberately not drawing from typical tech-product design galleries (Stripe,
Linear, Notion) — the wrong reference class for presentation software used in a
devotional, live-event context, read at a distance.

- **Scripture/prayer apps (YouVersion, Hallow)** — closest brand category: same
  devotional register, same problem of serving lyric/ scripture text across many
  scripts and languages (YouVersion ships Bible content in 2,000+ languages),
  same emphasis on reader-controlled legibility over decoration. Their
  reading-settings pattern is close to `Settings`' own job here.
- **Teleprompters** — the direct model for the Output view: continuous scroll,
  reading position held at centre, surrounding text dimmed (see Typography
  Principles above). Broadcast lower-thirds shaped an earlier 2-line draft,
  superseded by SDD-0001 §16.1.
- **Physical hymnal and prayer-book print design** — the most literal reference,
  since it's the artifact this app replaces. Source of the amber/brass seed, not
  an arbitrary accent choice.
- **Supabase Studio** — the model for the app shell: layered chrome, a
  breadcrumb switcher for the two things you work inside (org/project there,
  hymnbook/hymn here), width chosen by content, a Cmd+K command menu, and
  generous room around dense controls. Borrowed as structure, not as its
  green-on-black look.
- **E-reader reading settings (Kindle)** — the shape of a good
  text-scale/contrast/theme control: a few clear steps, applied instantly, no
  configuration maze.

None of these are copied wholesale — they're the right _category_ to borrow
instinct from when a new screen needs a decision this file doesn't already
answer.
