# SDD-0005 — Full song on the Output

- **Status:** Proposed; its decisions are the user's (Board #30)
- **Date:** 2026-10-02
- **Decisions:** the four questions of the #30 mockup, all taken as recommended:
  the tint in this layout only; an overlapped fade across columns; a soft floor
  with pages below it; a setting, off by default, landscape only. Looks:
  [DESIGN.md](../visual/DESIGN.md) (Output, Motion)

The Output can show the whole song at once, in its printed form, in columns.
Nothing scrolls: the type shrinks until everything fits, and a song that would
need type below the floor is split into pages of whole parts. The current part
is tinted, and the tint glides. It is for the Output, the projected screen; Live
is the same component scaled to its box and shows the same. It is a Presentation
setting, "Whole song on screen", off by default, and a layout of its own:
SDD-0001 §16.1's scroll stays the default and is what portrait screens show.

## 1. What is shown

- **Printed order**: the song's parts in the order the song stores them, each
  once. A chorus the sequence repeats is printed once, where the book prints it,
  and the tint returns to it each time. The sequence moves the tint, never the
  page. A back-to-back repeat (×N) is already one run in the Output's lines, so
  it changes nothing here.
- **The tint** sits behind the current part: 9% ink over the ground, the tone of
  the number badge, corners 0.4em. The lit text is `output-ink`, the rest
  `output-ink-dimmed`: colour only, never size or weight. Under line focus the
  part is tinted and only the focused line is lit.
- **Cues** (number badge, caption) are as in the scroll layout. The safe margins
  grow to 16% where a cue shows, as there, and the fit respects them.
- **Alignment**: one column, each part centred as the scroll shows it, its tint
  hugging its lines; two or more, lines left-aligned as printed.
- **Parts** are boxes with padding 0.3em by 0.6em, nothing between them, so the
  text of two parts is 0.6em apart: about the half-line gap of the scroll. Whole
  parts are never split across columns.
- **Margins**: 10% top and bottom, 5% left and right (the scroll's). Columns are
  top-aligned, the block centred in what is left, both ways, with a gap of 3% of
  the width between columns.
- **Landscape only**: a view wider than tall. A portrait Output keeps the scroll
  (and "Pin the chorus"); Live's box is always 16:9, so it takes its shape from
  the Output window, which reports it to the Operator on opening and when it
  turns; with no window open, or none that has said, Live is landscape. While
  the layout is on, "Pin the chorus" does nothing.

## 2. The layout rule

A pure function, `layoutSong` in `src/output/fullSong.ts`. It never touches the
DOM; it is given a way to measure.

**Input**: the number of parts; `measure(columns, fit)`, giving each part's
height in px at that column count and type scale (`fit`, the multiplier of
`7.5cqmin`) and whether its longest word fits the column's width (Malayalam
words do not break); the room, the safe height in px.

**Output**: the type scale `fit`, and the pages, each a list of columns, each a
list of part indices; also whether it is below the floor.

1. **Balance.** For a column count k and a scale, cut the printed order into k
   runs of whole parts. Minimise the tallest column; among ties, the sum of the
   squared column heights (the most even).
2. **Feasible**: the tallest column fits the room and every word fits.
3. **Fit per k**: the largest feasible scale, at most 1 (the scale model's full
   size), by bisection (14 steps) down to 0.15. Heights are not exactly
   monotonic in the scale, since wrapping changes; the bisection assumes they
   are, and the final layout is checked (§ 3).
4. **Columns**: k from 1 to 4, and the smallest k whose fit is within 10% of the
   best. A column is added only if it buys more than about 11% in type, so a
   short song stays one centred column.
5. **Floor and pages** (§ 3).

On the 1,907 songs of the two bundled books, at 1920x1080, with the floor at
0.30: the median fit is 0.55 (45px); 1,233 songs take two columns, 245 three, 17
four, 412 one. 7 songs fall below 0.30, the lowest 0.27. They are paged.

## 3. The floor, and pages

The floor is a **fit of 0.30**: 24px at 1080p, 2.2% of the screen's height. A
song whose best single-page fit is above it is one page. Below it the song is
split, never scrolled:

1. For 2 pages, 3, and so on up to one page per part, cut the printed order into
   runs of whole parts, balanced by the parts' heights at one column and the
   floor (the same rule as a column's, so the pages are even).
2. Each page takes its own best fit (§ 2). The song's fit is the **smallest** of
   them: one size for the whole song, as ever. The fewest pages that reach the
   floor win.
3. If no split reaches it (one part taller than a column at the floor, say), the
   split with the largest fit wins and the layout reports it is below the floor.
   The part stays whole, and the type goes down as far as it must, never past
   0.15.
4. Each page then takes its columns at the song's fit, with its own count: the
   page's own choice of k, or a larger k if wrapping made that infeasible.

**Page turn**: one page shows at a time, the one holding the current part. When
a step reaches a part on the other page, the page fades out (125ms), the other
fades in (175ms) with the tint already on its part. Under reduced motion it is
at once. Nothing on screen says there are pages.

## 4. The tint's motion

All durations are the app's medium (250ms) at the emphasised easing, through
`glideTiming`; the geometry is that of `lyricsGlide.ts`, through
`glideGeometry.ts`.

- **Within a column** (a step to a part in the same column): one layer slides
  and resizes, leading edge first, as This Song's tint does. The text colour
  changes in the same time, so the part the tint leaves dims and the one it
  reaches brightens as it passes.
- **Across columns**: a fade, overlapped, so some part is always lit. The old
  tint fades out over the first 60%, in place; the new one fades in over the
  last 80% (starting at 20%), travelling 1.6em from the left to its place. The
  text follows: the old part dims over the first 150ms, the new one brightens
  from 50ms over 200ms.
- **A page turn**: § 3. The tint does not travel.
- **When it is laid out**: when the song, its parts' text (a signature, so an
  edit counts), the box, the margins or the fonts change, never for a step.
  Layouts are cached by those; a burst of resizes or font loads makes one
  layout, in the next frame. A font that loads when the text first needs it
  (Malayalam, on the first song) measures again once in (`loadingdone`).
- **Forced colours**: the tint's fill and the dimmed ink are dropped, so the
  tint takes an outline in the system highlight: the current part stays marked.
- **Snapping**: a new song, a resize, a refit (a cue turning on, the setting, a
  font loading) land at once with the tint re-measured. Reduced motion shows the
  end state in every case, with no colour transition either.

## 5. Highlight: the part or the whole song

A second Presentation setting, **Highlight on the Output**: _Current part_ (the
default) or _Whole song_, and the **H** key, which toggles it live (it is in
`keymap.ts`, so in the `?` sheet and the command menu, "Light the whole song on
the Output"). _Whole song_ lights every part at full brightness, with no tint
and no dimming, for a congregation singing straight through.

It is not a feature of this layout: it applies to the **scroll layout too**
(every line lit; the scroll still follows the focus), so it is a general Output
option, kept apart from "Whole song on screen" (the layout). Switching changes
the colour of the dimmed parts and fades the tint in or out in one medium
duration (250ms) at the emphasised easing; reduced motion changes at once. While
the whole song is lit the tint stays out and a step moves nothing but (in the
scroll) the position.

## 6. Where it lives

| Piece           | Does                                                       | Lives in                      |
| --------------- | ---------------------------------------------------------- | ----------------------------- |
| `layoutSong`    | The rule of § 2 and § 3, pure                              | `src/output/fullSong.ts`      |
| `FullSong`      | Measures, lays out, renders pages, columns, tint           | `src/output/FullSong.tsx`     |
| `glideFullTint` | The within-column slide, the cross-column fade             | `src/output/fullSongGlide.ts` |
| `OutputView`    | Chooses the layout (setting and landscape), keeps the cues | `src/output/OutputView.tsx`   |
| The setting     | `wholeSong` preference, in the presentation message        | `user-state.ts`, `channel.ts` |

The content message carries the song's parts in printed order (`parts`, each an
id and its lines) besides the flattened sequence; the focus part is the part of
the focused line. A message without `parts` shows the scroll.

## 7. Tests

`fullSong.test.ts` pins the rule with a synthetic measure: balancing, ties, the
smaller column count, the floor and pages, one part, a part taller than a
column. `FullSong.test.tsx` checks the order, the tint's part, the lit lines and
the page shown. The glide's geometry is the existing one's, tested there.
