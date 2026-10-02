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
**Next: Board #28**: ADR-0026/0027 are accepted; its parts are in SDD-0004.
Parts 1 (`bun run pack`), 2 (the reader, hashes, keys) and 3 (schema 3, the
registry) are done; part 4 next. It needs #27's parts 1–5, not the judge. #27
part 6, the Laya judge, runs last, on another machine or a Codespace (this one
is short of memory).

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
   275 songs, 1,017 notes (1,030 now)
5. ~~Review the Fellowship report by section~~ — done: titles, fonts, sequences,
   index, breaks; applied rules sampled clean; wraps by sample (an "I"/"&" line
   joins only at 4 words or fewer; sure joins counted, guesses listed). Hand
   fixes (#44, #81, #85, #197), applied once after the last re-import, are
   listed in the draft's `HAND-FIXES.md`, which a re-import leaves alone
6. **Last of all**, on another machine or a Codespace. Judge, swappable by
   manifest; Laya first (SDD-0003 §4.1). Found so far: the kind of a short
   unlabelled block (bridge, tag, a split stanza; 20 in Fellowship). Triage and
   inference were dropped: case by case (ADR-0024)

## State

| Area    | Status                                                                   |
| ------- | ------------------------------------------------------------------------ |
| Docs    | arc42 + 27 ADRs + SDD-0001–0004; design principles noted                 |
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

| #   | Task                                                                                            | Blocked by |
| --- | ----------------------------------------------------------------------------------------------- | ---------- |
| 27  | Song import, CLI: PDF first (ADR-0018, SDD-0003)                                                | —          |
| 28  | Library: load songs and books in format 1, local only; keys, duplicates (SDD-0004, ADR-0026/27) | —          |
| 30  | Full song, landscape: printed form in columns, the highlight glides; mockup                     | —          |
| 32  | App updates: prompt to restart when one is ready, never while live; Safari install hint         | —          |
| 31  | Output on the projector screen: pick and remember it, fullscreen (ADR-0028; Chromium)           | 30         |
| 14  | CMS for managing hymnal content (add/edit hymns, hymnbooks)                                     | —          |
| 15  | Transliteration: search and display across scripts (ADR-0014)                                   | —          |
| 16  | Feedback and corrections from users — where collected: TBD                                      | —          |
| 17  | About: acknowledgements, copyright, credits                                                     | —          |
| 18  | Over-the-air update notices (as Supabase announces changes)                                     | —          |
| 19  | Picker hymnbook scope: swap book + hymn in one step (SDD §16.4)                                 | 28         |
| 21  | Hold: freeze the Output on what's showing, navigate, release                                    | —          |
| 22  | Service queue: line up hymns for a service (a supporting pane)                                  | —          |
| 23  | Arrangements: resequence a song as the band sings it, or mix hymns; saved                       | 22         |
| 24  | Lyrics interchange (OpenLyrics, LRC); timing per recording                                      | Phase 2    |
| 25  | Stage outputs for musicians: lyrics + chords, score, notation                                   | content    |

Phase 1's app is done (#20 the last); 27 is a build-time tool beside it. Next
phase: the songs leave the repo, and every book, `content/`'s included, comes in
as an import (format 1 as it is, or a PDF and the like), reversing ADR-0009's
committed corpus (ADR-0026). 14–15 sit past the scope guard below. 16–25 are
notes, not scheduled: the shell reserves room for them (DESIGN.md § Structure).

## Invariants

Breaking these breaks the design. Check before deviating.

- Domain layer imports no UI framework —
  [ADR-0005](decisions/0005-use-solidjs.md)
- Content validated at build time, never repaired at runtime —
  [arc42 §8.6](architecture/arc42.md)
- A reviewed book's source is corrected in place, never regenerated wholesale —
  [ADR-0026](decisions/0026-songs-leave-the-repository.md)
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

- 2026-10-02 — Board #32, decided: an app update waits for a restart the
  operator chooses, never while the Output is live (today it takes over at once
  and deletes the old version's files); books and settings are untouched by
  updates, as before
- 2026-10-02 — #28 part 3: package schema 3 (origin, sources, part position),
  one `packageRows` builder, the registry in OPFS and its reconcile, `hymnalDev`
- 2026-10-02 — ADR-0028 accepted: the Output on the projector screen, in Chrome
  and Edge (Window Management API); elsewhere the window as today. Board #31.
  #30 decided: the tint in Full Song only, an overlapped fade between columns,
  pages below a 0.30 fit, a Presentation setting; and lighting the whole song
  instead, with a shortcut
- 2026-10-02 — #29 done: _Songs of Zion_'s deck matches its PDF on all 422
  slides (6,438 lines one PDF line, 23 two). #28 parts 1–2 checked by hand:
  Malayalam packs to 1,631 songs, 512.6 KB; _Hymns of Fellowship_ 275, 63.1 KB;
  _Songs of Zion_ 420, 139.3 KB; each reads back clean, its source hash the
  printed sha256
- 2026-10-02 — The parts pad's pill blurs a little mid-glide, crisp on landing
- 2026-10-02 — #28 part 2: a container read and checked on the device; song and
  source hashes; uuidv7 keys
- 2026-10-02 — #28 part 1: `bun run pack` writes a book's container, the same
  bytes on any machine (fflate, a pinned hash)
- 2026-10-02 — Recents: rows a glide crosses fade, so no glyph is cut mid-glide
- 2026-10-02 — #29 part 3: _Songs of Zion_ read from its deck (420 songs);
  publisher GLS, id `eng-gls-songs-of-zion`; a number repeated on the next slide
  continues its song; long deck lines kept as written
- 2026-10-02 — The parts pad's selected key is one pill that glides from key to
  key
- 2026-10-02 — #28 designed: ADR-0026/0027 accepted, SDD-0004. Chosen: songs
  leave the repo; no sample until one exists; Malayalam adopted in place, source
  kept ignored, history rewritten later; empty first run; remove drops recents;
  persist asked at first load
- 2026-10-02 — Laya (#27 part 6) moved last; hand fixes kept in the draft's
  `HAND-FIXES.md`; Recents' glide 300ms, as PRINCIPLES says
- 2026-10-01 — This Song's tint glides from part to part, with the scroll
- 2026-10-01 — #27 part 5 done. Decided while the user was away, by the
  recommendation: the 4-word limit, the wraps section summarised
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
