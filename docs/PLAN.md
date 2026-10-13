# Plan

Live control document. **Read first, update last.** Everything else in `docs/`
is reference; this is state. If the two disagree, this file is wrong — fix it.

## Workflow

The loop, for anything bigger than a typo: an idea from either side → reasoned
through relentlessly, together, until we share understanding — not until either
side settles for less — → the relevant ADR/SDD/PLAN updated first → built in
parts, user reviewing each → next Board item, repeat until the hymnal is built.

## Session protocol

1. Read this file.
2. Read only the ADR/SDD sections named by the task you pick up. Do not
   re-derive settled decisions.
3. Do the work. Run `bun run check`.
4. Update **Now**, **Board** and **Log** before finishing.

### Rules for editing this file

- One line per entry. Needs a paragraph? It belongs in an ADR or SDD, not here.
- Never restate a decision. Link it.
- Delete finished Board items — the Log is the history.
- Log: newest first, one line each, trim below 12 entries.
- Target length: 120 lines. Over that, something is in the wrong place.

## Now

**Beta**: built and live at
[hymnal.sagaveracity.com](https://hymnal.sagaveracity.com) (ADR-0030) once
`main` is pushed; the sample is released as `sample-1` (SDD-0004 §16). #50, the
real-device pass, waits on the maintainer's devices; the beta may go before it,
iOS marked untested. The maintainer's reviews of 2026-10-07 and 10-08 are done.

**Board #27 (song import, CLI)**: touches no UI. Target: _Hymns of Fellowship_,
the second hymnbook; its draft stays in `imports/` until its rights are known
(ADR-0018, ADR-0019, SDD-0002, SDD-0003). Parts 1–5 done; hand fixes are in the
draft's `HAND-FIXES.md`. Part 6, the Laya judge (SDD-0003 §4.1), runs last, on
another machine or a Codespace (this one is short of memory). Rewriting history
to drop the songs from old commits is the maintainer's own later step
(ADR-0026).

## State

| Area    | Status                                                                     |
| ------- | -------------------------------------------------------------------------- |
| Docs    | arc42 + 33 ADRs + SDD-0001–0006 + DESIGN.md; authoring kit                 |
| Tooling | bun, biome, prettier, markdownlint, vitest, Playwright on three engines    |
| Domain  | Types, Sequence Engine, validation (`src/domain/`): pure, tested           |
| Content | Books load as containers through the Library; the sample only (ADR-0026)   |
| Persist | Content store (SQLite/OPFS, worker), user state (idb), backup — SDD-0004/6 |
| UI      | Library, Finder, Operator, Output window, Present Here, MD3 — SDD-0001 §16 |
| Deploy  | Audit, check, e2e, sample by hash → GitHub Pages, PWA, offline — arc42 §7  |

## Board

Ordered. Top unblocked item is next.

| #   | Task                                                                                                                                                                                  | Blocked by          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 27  | Song import, CLI: part 6, the Laya judge (SDD-0003 §4.1)                                                                                                                              | another machine     |
| 50  | Real-device pass: iOS Safari, Android Chrome, installed and tab, offline, eviction; the #31 and #41 hardware checks (two screens, GNOME Wayland)                                      | maintainer: devices |
| 67  | Sheet animation cost: sheet open has a ~90 ms long task (showModal + layout reads); a swap animates height and width on the main thread (performance watch, 2026-10-12). Low priority | —                   |
| 68  | Search filter chips under the box (This book, All books, chosen books); default All books. Replaces the "Searching ..." line, which goes now (maintainer, 2026-10-13)                 | -                   |
| 69  | Finder modes: songs by default, `>` or Ctrl+Shift+P switches to commands, each with a muted heading; songs and commands no longer mix (design chosen, 2026-10-13)                     | -                   |
| 71  | Scroll edge fades: every scroll region fades its top and bottom edge in proportion to how far it can scroll (2026-10-13)                                                              | -                   |
| 14  | CMS for managing hymnal content (add/edit hymns, hymnbooks); removing one song from your books (its UI left with OwnSheet, ADR-0033 §6)                                               | —                   |
| 15  | Transliteration: search and display across scripts (ADR-0014)                                                                                                                         | —                   |
| 16  | Feedback and corrections from users — where collected: TBD                                                                                                                            | —                   |
| 18  | Over-the-air update notices (as Supabase announces changes)                                                                                                                           | —                   |
| 22  | Service queue: line up hymns for a service (a supporting pane)                                                                                                                        | —                   |
| 23  | Arrangements: reorder parts, repeat a part, a line or a run of lines; saved per song (SDD-0001 §8 note)                                                                               | —                   |
| 24  | Lyrics interchange (OpenLyrics, LRC); timing per recording                                                                                                                            | Phase 2             |
| 25  | Stage outputs for musicians: lyrics + chords, score, notation                                                                                                                         | content             |
| 37  | Interface languages and right-to-left: UI strings translated, mirrored layout                                                                                                         | —                   |
| 40  | Typo-tolerant search: near matches ranked after exact ones (FTS5 is prefix-only today)                                                                                                | —                   |

14–15 sit past the scope guard below. 16–25 and 37–40 are notes, not scheduled:
the shell reserves room for them (DESIGN.md § Structure).

## Invariants

Breaking these breaks the design. Check before deviating.

- Domain layer imports no UI framework —
  [ADR-0005](decisions/0005-use-solidjs.md)
- Content validated when loaded, never repaired at runtime —
  [arc42 §8.6](architecture/arc42.md)
- A reviewed book's source is corrected in place, never regenerated wholesale —
  [ADR-0026](decisions/0026-songs-leave-the-repository.md)
- Stored sequence never mutated; a jump moves, only a repeat inserts —
  [SDD-0001 §5.1](design/0001-domain-model.md)
- A new hymnbook is data, not code — [arc42 §2.3](architecture/arc42.md)
- Nothing leaves the device unless the user sends it —
  [ADR-0030](decisions/0030-security-a-local-first-threat-model.md)
- While live, nothing the Operator does elsewhere changes the Output unasked —
  [SDD-0001 §16](design/0001-domain-model.md)
- Audio, sync and a native wrapper deferred — ADR-0006, 0010, 0011 (the
  projector Output came in by ADR-0028)

## Scope guard

Phase 1 is: hymnbook selector, dynamic presentable hymnal, reworked persistence,
and the Output on the projector screen. Single-device. Nothing else.

If a task seems to need sync, audio or a native wrapper — it doesn't. Re-read
the deferral ADR before acting.

## Open questions

Full list in [`docs/decisions/README.md`](decisions/README.md). Blocking ones
only, here:

| Question                          | Blocks                                         |
| --------------------------------- | ---------------------------------------------- |
| Lyrics copyright / redistribution | Any app store release (arc42 R2), not the beta |

## Log

- 2026-10-13 — #70 done: the "Go to a Song" sheet is gone (the crumb and Back
  open the Finder, the Search sheet); empty states are cards with line-art
  illustrations (`EmptyCard`).
- 2026-10-13 — the maintainer's review: the Finder's "Searching" line is gone
  (search is always all books); the quick switcher's field is held at the foot
  of its scroller, on the ground (it scrolled out of view when results
  overflowed); the repeat count fades after ×2, ×1 is never shown; copy rules
  for backup/back up and the ellipsis (DESIGN.md § Words); More in is a quiet
  row with a chevron; scroll regions fade their edges (scrollFade.ts; a
  scroll-driven animation, a rAF helper in Firefox). Board #68 chips not built
- 2026-10-13 — follow-ups: `shownBox` no longer hands a `NaNpx` to a glide when
  the layer has no computed size (the one source found; the warning did not
  reproduce in 40 sheet swaps, so unconfirmed); the 2 s Output-position poll and
  the 30 s Recents refresh pause while the page is hidden and catch up on return
  (`visibleInterval`); the Firefox-only browse e2e flake was the test's single
  9000px wheel (Firefox scrolls it 542 or 9296 px), not the window
- 2026-10-12 — #66 done: the Finder lists the whole book windowed (Recents on
  top, sticky headings, 24-28 rows in the DOM of a 1,000-song book); lyric
  search pages on past 30 (SDD-0001 §13.2). Quick switcher unchanged
- 2026-10-12 — CI e2e was red on 10aef1e (121 commits unrun): the search e2e now
  describes a number across books; a notice over a sheet leaves its actions in
  reach (clearance padding); the benign ResizeObserver loop notice is not logged
  as an error; Segmented radios keep one name per use-site (a Chromium
  radio-group creep of ~1 KB per swap). Performance watch (Chromium, 200 reps):
  heap 4-5 MB, nodes and listeners flat, no leak; idle 1.7% of a core; sheet
  open (~90 ms task) and swap cost are Board #67. Open: Chromium warns
  `Invalid keyframe value … NaNpx` in the sheet morph
- 2026-10-12 — fix: a notice over a sheet took no tap (Got It pressed the
  control under it; Chromium and Firefox reproduce, Safari reported): a modal
  dialog makes everything outside it inert, so the notice now lives inside the
  open sheet and goes home when it closes
- 2026-10-12 — the Finder suggests a typed number from every book, the current
  book's exact match first and Enter unchanged (ADR-0032, amended); the
  Hymnbooks sheet has a search field that filters by title
- 2026-10-12 — the maintainer's review of From Text: Add to picks from the
  language's list (one PickList); an open list dims and blurs the card behind
  it; the review after From Text says Back; your books open like any book, with
  Rename… in the book's menu (removing one song waits for #14)
- 2026-10-11 — #62–65, the maintainer's review of sheets and motion: a sheet
  replacing another morphs an opaque card out of the old one over one constant
  scrim; stacked sheets share the lowest one's scrim; a closing tab group
  collapses in its slot, no gap; one hover highlight glides across all of
  Settings, rows with controls too
- 2026-10-11 — #59–61 done: your books (ADR-0033, superseding ADR-0031) — books
  you make grow, can be renamed, any number of them; books you receive stay
  fixed. From Text is one form: Add to (your books, New book…), the songs'
  language, the text; pasted plain lyrics parse (the first line is the title and
  verse 1, numbers counted from the book's next); errors clear on edit, the
  script code is checked, the language list floats inside the card
- 2026-10-10 — #19 closed by the maintainer: #38 swaps book and song in one step
  for a lyric result; a number in another book goes through the header's picker
  (SDD-0001 §16.4)
- 2026-10-10 — #42 done: the unit suite runs in about 52 s, not 77 s.
  `App.test.tsx` is split by area over a shared testkit; the hint and notice
  waits use fake timers; 34 DOM-free files run in node without isolation (an
  allowlist in `vitest.config.ts`, new files isolated by default)
