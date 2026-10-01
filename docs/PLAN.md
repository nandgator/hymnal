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

**Phase 1's app is done**: #20, the keymap, was its last item (SDD-0001 §16.5).
**Next: Board #27 part 5** (below), then part 6. In review: This Song's tint
glides from part to part with the scroll (DESIGN.md § Structure, Lyrics).

**Board #27 (song import, CLI)**: it touches no UI. Target: _Hymns of
Fellowship_ (`Song Book Final.pdf`; `Songs.pdf` differs only in its index), the
second hymnbook; its draft stays in `imports/` until its rights are known. Spec:
ADR-0018, ADR-0019, SDD-0002 (format v1), SDD-0003 (import). Parts:

1. ~~Format v1: `format: 1`, unknown fields rejected, other formats refused~~ —
   done
2. ~~PDF reader (pdf.js) → `SourcePage`, gutters found per page;
   `bun run import` prints lines and fonts~~ — done
3. ~~JSON Schema for format 1 (ADR-0022): `validate.ts` reads its fields from
   it; ajv test keeps them agreed~~ — done
4. ~~Flow, songs, parts, draft, report against a profile (SDD-0003 §3)~~ — done;
   275 songs, 1,017 notes (1,038 now)
5. **Next.** Review the Fellowship report by section, smallest first; wraps by
   sample. ~~Titles~~, ~~mixed fonts~~, ~~sequences~~, ~~index~~ (42 → 10, the
   book's own) done; ~~breaks~~ (a column's stub joins its rest; a lone chorus
   split by a break joins; a note flags a stanza twice the usual length, for the
   judge) done; next: a sample check of the notes for rules applied (directions,
   repeat marks, cues), then wraps by sample. Hand fixes, applied once after the
   last re-import: #85 (c3 is s3; c2 after every chorus), #197 (s1 is the
   chorus, s3 the outro: `c s1 c s1 c o`), #81 (index typo "descripton")
6. Judge, swappable by manifest; Laya first (SDD-0003 §4.1), after part 5. Found
   so far: the kind of a short unlabelled block (bridge, tag, a split stanza; 20
   in Fellowship). Triage and inference were dropped: case by case (ADR-0024)

## State

| Area    | Status                                                                   |
| ------- | ------------------------------------------------------------------------ |
| Docs    | arc42 + 25 ADRs + SDD-0001–0003; design principles noted                 |
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

| #   | Task                                                                                     | Blocked by   |
| --- | ---------------------------------------------------------------------------------------- | ------------ |
| 27  | Song import, CLI: PDF first (ADR-0018, SDD-0003)                                         | —            |
| 28  | Library: load songs and books in format 1, local only; keys, duplicates (ADR-0020/21/24) | 27, 2nd book |
| 29  | Import: PowerPoint reader; _Songs of Zion_ (.pptx, its PDF to cross-check)               | 27           |
| 30  | Full song, landscape: printed form in columns, the highlight glides; mockup              | —            |
| 14  | CMS for managing hymnal content (add/edit hymns, hymnbooks)                              | —            |
| 15  | Transliteration: search and display across scripts (ADR-0014)                            | —            |
| 16  | Feedback and corrections from users — where collected: TBD                               | —            |
| 17  | About: acknowledgements, copyright, credits                                              | —            |
| 18  | Over-the-air update notices (as Supabase announces changes)                              | —            |
| 19  | Picker hymnbook scope: swap book + hymn in one step (SDD §16.4)                          | 2nd book     |
| 21  | Hold: freeze the Output on what's showing, navigate, release                             | —            |
| 22  | Service queue: line up hymns for a service (a supporting pane)                           | —            |
| 23  | Arrangements: resequence a song as the band sings it, or mix hymns; saved                | 22           |
| 24  | Lyrics interchange (OpenLyrics, LRC); timing per recording                               | Phase 2      |
| 25  | Stage outputs for musicians: lyrics + chords, score, notation                            | content      |

Phase 1's app is done (#20 the last); 27 is a build-time tool beside it. 14–15
sit past the scope guard below. 16–25 are notes, not scheduled: the shell
reserves room for them (DESIGN.md § Structure).

## Invariants

Breaking these breaks the design. Check before deviating.

- Domain layer imports no UI framework —
  [ADR-0005](decisions/0005-use-solidjs.md)
- Content validated at build time, never repaired at runtime —
  [arc42 §8.6](architecture/arc42.md)
- Migration output is committed source, never regenerated wholesale —
  [ADR-0009](decisions/0009-migrate-the-corpus-by-rule.md)
- Stored sequence never mutated; a jump moves, only a repeat inserts —
  [SDD-0001 §5.1](design/0001-domain-model.md)
- A new hymnbook is data, not code — [arc42 §2.3](architecture/arc42.md)
- Audio, sync, projector, native wrapper deferred — ADR-0006, 0010, 0011

## Scope guard

Phase 1 is: hymnbook selector, dynamic presentable hymnal, reworked persistence.
Single-device. Nothing else.

If a task seems to need sync, audio, a projector or a native wrapper — it
doesn't. Re-read the deferral ADR before acting.

## Open questions

Full list in [`docs/decisions/README.md`](decisions/README.md). Blocking ones
only, here:

| Question                          | Blocks      |
| --------------------------------- | ----------- |
| Lyrics copyright / redistribution | Any release |

## Log

- 2026-10-01 — #20 done: R, U; key hints from one table; band size a setting
- 2026-10-01 — #27 part 5: breaks done; #152's chorus joins; long stanzas noted
  for the judge
- 2026-10-01 — #27 part 5: a stanza's stub at a column's foot joins its rest (4
  songs)
- 2026-10-01 — Recents: a clear gap between a title and its time
- 2026-10-01 — #33 done: Recents grouped Today, Yesterday, Before; relative
  times
- 2026-10-01 — #27 part 5: titles match the index across O/Oh, &/and, a
  subtitle, a cut-short title
- 2026-09-29 — #27 part 5: by rule the chorus follows a bridge; lone chorus cues
- 2026-09-29 — #27 part 5: kind by first font; directions out; "…Cho…", cues
  read
- 2026-09-28 — #27 part 5: repeat marks taken off lines; "(Repeat Chorus)" a
  label
- 2026-09-28 — #27 part 5: "Cho…" mid-block closes a stanza unless a chorus
  follows
- 2026-09-28 — #27 part 5: titles cased as the lyrics set them; shown in Title
  Case
- 2026-09-28 — Firefox: the sheet reveals too (no backdrop-filter in the copy)
- 2026-09-28 — #26 done. Live's theme reveal shows; every sheet follows the
  layout
- 2026-09-28 — The fold a fade-through; theme changes revealed in a circle
- 2026-09-27 — #26 part 4c: the fold; Split jitter; search one style, no Find
- 2026-09-27 — The refrain is the chorus: screen, key C, code, format (ADR-0025)
- 2026-09-27 — #26 part 4b: loading in place, install progress; Recents
- 2026-09-27 — #26 part 4a: phone layout, Parts a tab; one Recents list
