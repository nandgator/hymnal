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
setting, the Layout choice's "Whole song" (against "Part by part"), off by
default, and a layout of its own: SDD-0001 §16.1's scroll stays the default and
is what portrait screens show.

## 1. What is shown

- **Printed order**: the song's parts in the order the song stores them, each
  once. A chorus the sequence repeats is printed once, where the book prints it,
  and the tint returns to it each time. The sequence moves the tint, never the
  page. (On a song that is split into pages, the chorus is printed once on each
  page that sings it: § 3.) A back-to-back repeat (×N) is already one run in the
  Output's lines, so it changes nothing here.
- **The tint** sits behind the current part: 9% ink over the ground, the tone of
  the number badge, corners 0.4em. The lit text is `output-ink`, the rest
  `output-ink-dimmed`: colour only, never size or weight. Under line focus the
  part is tinted and only the focused line is lit.
- **Part markers**: each part carries a small marker above its first line: a
  stanza's number ("2"), or its kind for the others ("Chorus", "Bridge"); a
  stanza with no number has none. A chorus the sequence repeats is printed once,
  so it has one marker, the same each time the tint returns to it. The marker is
  typography beside the lyrics, never among them: 0.55 of the lyrics' size, a
  lighter weight (400 against 500), letters spaced a little, and muted, the
  dimmed ink on a part not sung and a step lighter (70% ink over the ground) on
  the part that is, so it never competes with the lyrics. It is the same voice
  as the language picker's caption beside a name. Its row is a fixed box,
  0.825em of the lyrics' size, the text centred in it, so a script's tall glyphs
  (Malayalam) never move a line; it is aligned as the part is (centred in one
  column, at the start in more). The row is part of the part, so the tint hugs
  it and the layout counts it (§ 4, How it is measured). The marker is the
  part's own, sent in the content message (`parts[].marker`, from the Presenter,
  which knows the part's kind and label), and shown or hidden by the one
  setting, **Show parts**, on by default, which is the part cue (`cues.part`) of
  the part-by-part layout too: one idea, where you are in the song, drawn per
  layout. Part by part it is the cue beside the number and title ("Verse 2",
  "Chorus"); here it is these markers, and the caption leaves the part out,
  since the markers already say it. It reaches the Output in the presentation
  message's `cues`. Turning it off lays the song out again without the rows. (It
  replaces a separate "Part labels" switch; a stored `partLabels` is read once,
  the two merged: on if either was on.)
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
  the layout is on, "Pin the chorus" does nothing, and Settings shows it only
  under Part by part (SDD-0001 §16.1, its value kept). No layout is ever drawn
  with another: a chorus pinned before the layout came on is dropped as it does,
  and the pinned panes render only in the scroll.

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
a step reaches a part on the other page, the pages cross-dissolve over one
medium time (250ms, emphasised): the old page fades out as the new one rises
12px into place and fades in, in the same time and easing, so their opacities
sum to one at every moment. The Output is never blank (the greater of the two is
never under half) and never shows two clear pages (the lesser is never over
half); with the emphasised curve the two are level for a frame or so and the new
page is the clear one by 40ms. (A first version faded the old page out over the
first 110ms and the new one in from 90ms, to share almost nothing: it showed
nothing at all for about 100ms between, which is what a blink is.) The tint goes
with its page (§ 4). Under reduced motion it is at once. A step that comes while
a turn is running lands at once, so two turns never overlap. Nothing on screen
says there are pages.

**The chorus on every page.** On a paged song that sings a chorus more than
once, the chorus is not printed once for the Output to flip back to each time it
is sung; each page is its verses with the chorus after each verse that the
sequence follows with it, in sung order (before the first verse, if the song
opens on the chorus). Moving verse, chorus, next verse on one page needs no page
turn: only a step to a verse on another page turns it. The chorus after a page's
last verse stays on that page. The tint lands on the chorus copy that follows
the verse just sung. The repeated chorus is counted in the fit: the verses are
cut into pages by their height with their chorus, and a page's items are its
slots, so the pages still fit with part labels on or off. A page of verse and
chorus that cannot reach the floor, where the plain split (the chorus printed
once, the Output flipping to it) can reach it or goes less far below it, falls
back to the plain split for that song. A song that fits one page is unchanged:
the chorus is printed once. The layout's pages hold slots (a part's place on a
page) and the layout says which part each slot shows; the content message
carries the sung order (the lines it already holds) and the hymn's chorus.

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
- **A page turn**: the pages cross-dissolve (§ 3) and the tint goes with them,
  in the same time and easing: the old tint fades out in place as the new one
  rises 12px into place and fades in, neither travelling sideways. A tint whose
  box is the same on both pages is not touched, so it neither jumps nor
  vanishes. The old part's text dims as its page fades; the new part's is lit as
  its page arrives. The tint is placed once the new page is in the page, a
  moment after the step: it is looked for again then (a first version looked
  once, found nothing, and left the tint on the old page's box for good).
- **When it is laid out**: when the song, its parts' text (a signature, so an
  edit counts), the box, the margins or the fonts change, never for a step.
  Layouts are cached by those; a burst of resizes or font loads makes one
  layout, in the next frame. A font that loads when the text first needs it
  (Malayalam, on the first song) measures again once in (`loadingdone`).
- **How it is measured**: not by building the song in the page for every
  candidate. Each word is measured once, with the real font (canvas), as the
  song arrives, and a part's height at any column count and scale is arithmetic
  over those widths: greedy line breaking at spaces and after a joining hyphen,
  words never broken, `1.35em` a line, the part's padding, and the part's marker
  row (a fixed 0.825em, and its width, a word that never breaks, against the
  column's). The rule's search is then pure arithmetic: about 165 measures and
  3ms for the longest song. When the Output has a song, the layout for its
  current box is made ahead, when the browser is idle, so turning the setting on
  has nothing left to do. The layout chosen is checked once in the page, on the
  page shown: if a block is taller than the room or a word overflows, the layout
  is made again for a room 3% smaller, up to 8 times, and that is what is kept.
  On the sampled songs of both books the arithmetic agrees with the browser to
  the pixel in all but 1 of about 7,500 parts, and then errs smaller.
- **Forced colours**: the tint's fill and the dimmed ink are dropped, so the
  tint takes an outline in the system highlight: the current part stays marked.
- **Snapping**: a new song, a resize, a refit (a cue turning on, the setting, a
  font loading) land at once with the tint re-measured. Reduced motion shows the
  end state in every case, with no colour transition either.

## 4a. Changing between the layouts

Switching the Layout between Part by part and Whole song (or turning the window
from portrait to landscape) changes the Output between this layout and the
scroll. It takes the Operator cards' soft zoom (`tab-in`: from 98.5%, the medium
time at the emphasised easing): the new layout is whole under a still copy of
the old one from the first frame, settles in from 98.5% to full size, and the
copy fades out over it in the same time. The screen is never blank, since the
new layout is there at once, and the two are never both clear for long. Under
reduced motion the copy fades and nothing zooms. The first layout a view settles
into, when it learns its shape, and a step, do not do it. `layoutSwap.ts`.

## 5. Highlight: the part or the whole song

A second Presentation setting, **Highlight on the Output**: _Current part_ (the
default) or _Whole song_, and the **H** key, which toggles it live (it is in
`keymap.ts`, so in the `?` sheet and the command menu, "Light the whole song on
the Output"). _Whole song_ lights every part at full brightness, with no tint
and no dimming, for a congregation singing straight through.

It is not a feature of this layout: it applies to the **scroll layout too**
(every line lit; the scroll still follows the focus), so it is a general Output
option, kept apart from the Layout choice. Switching changes the colour of the
dimmed parts and fades the tint in or out in one medium duration (250ms) at the
emphasised easing; reduced motion changes at once. While the whole song is lit
the tint stays out and a step moves nothing but (in the scroll) the position.

## 6. Where it lives

| Piece           | Does                                                       | Lives in                      |
| --------------- | ---------------------------------------------------------- | ----------------------------- |
| `layoutSong`    | The rule of § 2 and § 3, pure                              | `src/output/fullSong.ts`      |
| Text metrics    | Word widths (canvas), wrapped heights by arithmetic        | `src/output/fullSongText.ts`  |
| `FullSong`      | Lays out, checks it, renders pages, columns, tint          | `src/output/FullSong.tsx`     |
| `glideFullTint` | The within-column slide, the cross-column fade             | `src/output/fullSongGlide.ts` |
| `OutputView`    | Chooses the layout (setting and landscape), keeps the cues | `src/output/OutputView.tsx`   |
| `swapLayouts`   | The zoom and fade between the two layouts (§ 4a)           | `src/output/layoutSwap.ts`    |
| The setting     | `wholeSong` preference, in the presentation message        | `user-state.ts`, `channel.ts` |

The content message carries the song's parts in printed order (`parts`, each an
id, its lines and its marker) besides the flattened sequence; the focus part is
the part of the focused line. A message without `parts` shows the scroll.

## 7. Tests

`fullSong.test.ts` pins the rule with a synthetic measure: balancing, ties, the
smaller column count, the floor and pages, one part, a part taller than a
column, and the chorus on every page (after each verse, in sung order, an
opening chorus, counted in the fit, the fall back, a chorus sung once).
`fullSongText.test.ts` pins the arithmetic: breaking, wrapping, heights, and
that the rule runs on it. `FullSong.test.tsx` checks the order, the tint's part,
the lit lines, the page shown, a turn with both pages mounted and the old one
gone at its end, the tint on the new part's box once its page is there, the
markers, the layout made again when the page disagrees, and a pass over a whole
sung order with a repeated chorus: the tint on the right copy and a page turning
only into a verse. `Output.test.tsx` checks the markers' setting (Show parts),
that no combination of settings, steps and turns draws a pinned chorus with the
columns, and the swap between layouts. The glide's geometry is the existing
one's, tested there; its page-turn timing (the two sum to one) is pinned in
`fullSongGlide.test.ts`.
