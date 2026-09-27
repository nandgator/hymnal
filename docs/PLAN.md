# Plan

Live control document. **Read first, update last.** Everything else in `docs/`
is reference; this is state. If the two disagree, this file is wrong — fix it.

## Workflow

The loop, for anything bigger than a typo: an idea from either side → reasoned
through relentlessly, together, until we share understanding — not until
either side settles for less — → the relevant ADR/SDD/PLAN updated first →
built in parts, user reviewing each → next Board item, repeat until the
hymnal is built.

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

**Board #26 (Operator layout rethink) is in progress**, then #20: keys
follow the layout. Spec: SDD-0001 §16.4, DESIGN.md § Structure; mockup in
the "Operator Layout" artifact. Parts, each reviewed before the next:

Parts 1–3b are done: workspace model, wide layout, pane toolbar, design pass.

- ~~Part 4a~~ — done. Under 840px: Live strip; tabs merged, Parts a
  third tab (Repeat row and keypad as the stage's). Retires the Parts |
  Lyrics switch and `preferences.navigator`. Fixes the blanked strip (dim
  to the Output's ground, as Live does) and the phone's off-centre icons.
  One Recents list everywhere: number, title, when; this book's only
- ~~Part 4b~~ — done. Loading states: skeletons in place after 300ms,
  install progress streamed from the worker; Go Live no longer jumps
  during load; key caps' fill token. Recents: arrives with the screen (the
  last list shown at once, then refreshed), glides a chosen song to the
  top, never claims "none" while loading
- **Part 4c, next.** Command menu and Settings entries; the switch between wide and
  phone layouts animated, components folding both ways. Not a View
  Transition: Chromium skips one on any resize (probed 2026-09-27), and
  crossing 840px is a resize. Then every animation checked per frame;
  Split is jittery (the user, by hand)

**Board #27 (song import, CLI) runs alongside**: it touches no UI. Target:
_Hymns of Fellowship_ (`Song Book Final.pdf`; `Songs.pdf` differs only in its
index), the second hymnbook; its draft stays in `imports/` until its rights
are known. Spec:
ADR-0018, ADR-0019, SDD-0002 (format v1), SDD-0003 (import). Parts:

1. ~~Format v1: `format: 1`, unknown fields rejected, other formats
   refused~~ — done
2. ~~PDF reader (pdf.js) → `SourcePage`, gutters found per page;
   `bun run import` prints lines and fonts~~ — done
3. ~~JSON Schema for format 1 (ADR-0022): `validate.ts` reads its fields
   from it; ajv test keeps them agreed~~ — done
4. ~~Flow, songs, parts, draft, report against a profile (SDD-0003 §3)~~ —
   done; 275 songs, 1,017 notes
5. **Next, after #26.** Review the Fellowship report by section, smallest
   first; wraps by sample. First fix: title recasing ("I serve A risen Savior")
6. Judge, swappable by manifest; Laya first (SDD-0003 §4.1). Only if part 5
   finds questions the rules can't answer. Triage and inference were
   dropped: case by case (ADR-0024)

## State

| Area    | Status                                                                   |
| ------- | ------------------------------------------------------------------------ |
| Docs    | arc42 + 24 ADRs + SDD-0001–0003; design principles noted                 |
| Tooling | bun, biome, prettier, markdownlint — `bun run check` green               |
| App     | Vite + SolidJS + TS scaffolded; vitest chosen as test runner             |
| Domain  | Types, Sequence Engine, validation (`src/domain/`) — pure, tested        |
| Corpus  | 1,631 hymns migrated to `content/`; 12 flagged for hand review           |
| Content | `bun run build:content` builds `public/content/*.sqlite`, FTS5 + hash    |
| Persist | Content store (SQLite/OPFS, worker) + user state (idb) — SDD-0001 §10-11 |
| UI      | Library → Finder → Operator + Output window, MD3 — SDD-0001 §12-16       |
| Deploy  | GitHub Actions → GitHub Pages, PWA shell, offline — SDD-0001 §15         |

## Board

Ordered. Top unblocked item is next.

| #   | Task                                                                                                           | Blocked by   |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------ |
| 26  | Rethink the Operator layout: Parts, Live preview and Lyrics                                                    | —            |
| 20  | Keymap review (§16.5): band size, Repeat/Undo/Reset, Show cues now                                             | 26           |
| 27  | Song import, CLI: PDF first (ADR-0018, SDD-0003)                                                               | —            |
| 28  | Library: load songs and books in format 1, local only; keys, duplicates (ADR-0020/21/24)                       | 27, 2nd book |
| 29  | Import: PowerPoint reader; _Songs of Zion_ (.pptx, its PDF to cross-check)                                     | 27           |
| 33  | Recents as a real recent list: "just now", "a few minutes ago", day and date; grouped Today, Yesterday, Before | 26           |
| 30  | Full song, landscape: printed form in columns, the highlight glides; mockup                                    | 26           |
| 14  | CMS for managing hymnal content (add/edit hymns, hymnbooks)                                                    | —            |
| 15  | Transliteration: search and display across scripts (ADR-0014)                                                  | —            |
| 16  | Feedback and corrections from users — where collected: TBD                                                     | —            |
| 17  | About: acknowledgements, copyright, credits                                                                    | —            |
| 18  | Over-the-air update notices (as Supabase announces changes)                                                    | —            |
| 19  | Picker hymnbook scope: swap book + hymn in one step (SDD §16.4)                                                | 2nd book     |
| 21  | Hold: freeze the Output on what's showing, navigate, release                                                   | —            |
| 22  | Service queue: line up hymns for a service (a supporting pane)                                                 | —            |
| 23  | Arrangements: resequence a song as the band sings it, or mix hymns; saved                                      | 22           |
| 24  | Lyrics interchange (OpenLyrics, LRC); timing per recording                                                     | Phase 2      |
| 25  | Stage outputs for musicians: lyrics + chords, score, notation                                                  | content      |

26 and 20 finish Phase 1; 27 is a build-time tool beside them. 14–15 sit
past the scope guard below. 16–25 are notes, not scheduled: the shell
reserves room for them (DESIGN.md § Structure).

## Invariants

Breaking these breaks the design. Check before deviating.

- Domain layer imports no UI framework — [ADR-0005](decisions/0005-use-solidjs.md)
- Content validated at build time, never repaired at runtime — [arc42 §8.6](architecture/arc42.md)
- Migration output is committed source, never regenerated wholesale — [ADR-0009](decisions/0009-migrate-the-corpus-by-rule.md)
- Stored sequence never mutated; a jump moves, only a repeat inserts —
  [SDD-0001 §5.1](design/0001-domain-model.md)
- A new hymnbook is data, not code — [arc42 §2.3](architecture/arc42.md)
- Audio, sync, projector, native wrapper deferred — ADR-0006, 0010, 0011

## Scope guard

Phase 1 is: hymnbook selector, dynamic presentable hymnal, reworked
persistence. Single-device. Nothing else.

If a task seems to need sync, audio, a projector or a native wrapper — it
doesn't. Re-read the deferral ADR before acting.

## Open questions

Full list in [`docs/decisions/README.md`](decisions/README.md). Blocking
ones only, here:

| Question                          | Blocks      |
| --------------------------------- | ----------- |
| Lyrics copyright / redistribution | Any release |

## Log

- 2026-09-27 — #26 part 4b: loading in place, install progress; Recents
- 2026-09-27 — #26 part 4a: phone layout, Parts a tab; one Recents list
- 2026-09-27 — Triage and inference dropped; import case by case (ADR-0024)
- 2026-09-27 — Triage and inferred layout (ADR-0023); a local shelf of PDFs
- 2026-09-27 — #27 part 4: Hymns of Fellowship drafted, 275 songs; report
- 2026-09-27 — Part kinds widened (intro … tag); same songs = same book (ADR-0021)
- 2026-09-27 — #27 part 3: JSON Schema for format 1; `$schema` allowed
- 2026-09-27 — Presents, not publishes (ADR-0020); store keys; JSON Schema
- 2026-09-27 — #27 part 2: PDF reader; columns split at gutters; `bun run import`
- 2026-09-27 — #27 part 1: format v1; unknown fields fail at every level
- 2026-09-27 — Song import designed: ADR-0018/0019; SDD-0002 format v1, SDD-0003
- 2026-09-26 — CI: deploy workflow actions moved to their Node 24 majors
