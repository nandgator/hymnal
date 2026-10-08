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
`main` is pushed; the sample is released as `sample-2` (SDD-0004 §16). #50, the
real-device pass, waits on the maintainer's devices; the beta may go before it,
iOS marked untested. The maintainer's reviews of 2026-10-07 and 10-08 are done;
#58 waits on a design talk.

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
| Docs    | arc42 + 30 ADRs + SDD-0001–0006 + DESIGN.md; authoring kit                 |
| Tooling | bun, biome, prettier, markdownlint, vitest, Playwright on three engines    |
| Domain  | Types, Sequence Engine, validation (`src/domain/`): pure, tested           |
| Content | Books load as containers through the Library; the sample only (ADR-0026)   |
| Persist | Content store (SQLite/OPFS, worker), user state (idb), backup — SDD-0004/6 |
| UI      | Library, Finder, Operator, Output window, Present Here, MD3 — SDD-0001 §16 |
| Deploy  | Audit, check, e2e, sample by hash → GitHub Pages, PWA, offline — arc42 §7  |

## Board

Ordered. Top unblocked item is next.

| #   | Task                                                                                                                                                                                                      | Blocked by          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 58  | Assorted Hymns: a book the person owns for single songs; favourites and queues are lists of songs, not books (with #22). Shape when it starts                                                             | —                   |
| 27  | Song import, CLI: part 6, the Laya judge (SDD-0003 §4.1)                                                                                                                                                  | another machine     |
| 50  | Real-device pass: iOS Safari, Android Chrome, installed and tab, offline, eviction; the #31 and #41 hardware checks (two screens, GNOME Wayland)                                                          | maintainer: devices |
| 42  | Test suite speed (note): split App.test.tsx by area and use fake timers for its real waits; then isolate:false only for the DOM-free files, never globally (module-level state in channel.ts and friends) | —                   |
| 14  | CMS for managing hymnal content (add/edit hymns, hymnbooks)                                                                                                                                               | —                   |
| 15  | Transliteration: search and display across scripts (ADR-0014)                                                                                                                                             | —                   |
| 16  | Feedback and corrections from users — where collected: TBD                                                                                                                                                | —                   |
| 18  | Over-the-air update notices (as Supabase announces changes)                                                                                                                                               | —                   |
| 19  | Picker hymnbook scope: swap book + hymn in one step (SDD §16.4)                                                                                                                                           | —                   |
| 22  | Service queue: line up hymns for a service (a supporting pane)                                                                                                                                            | —                   |
| 23  | Arrangements: reorder parts, repeat a part, a line or a run of lines; saved per song (SDD-0001 §8 note)                                                                                                   | —                   |
| 24  | Lyrics interchange (OpenLyrics, LRC); timing per recording                                                                                                                                                | Phase 2             |
| 25  | Stage outputs for musicians: lyrics + chords, score, notation                                                                                                                                             | content             |
| 37  | Interface languages and right-to-left: UI strings translated, mirrored layout                                                                                                                             | —                   |
| 38  | Search across books: one query over every loaded book (SDD-0001 §16)                                                                                                                                      | —                   |
| 40  | Typo-tolerant search: near matches ranked after exact ones (FTS5 is prefix-only today)                                                                                                                    | —                   |

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

- 2026-10-08 — Docs brought up to date: README rewritten (the beta, features,
  commands); arc42, SDDs, DESIGN.md, CLAUDE.md and the agents' files audited
  against the code; this file trimmed to its rules
- 2026-10-08 — The maintainer's second pass: while live the song stays mounted
  in other sections, so the Output keeps it and its keys still drive it, and a
  book loads mid-service without touching it; a far jump sweeps the card (the
  maintainer's choice over #55's fade); the language list floats; a dismissed
  file picker no longer closes its sheet; the rest of the sample offered under
  the list
- 2026-10-07 — #53–57, the maintainer's review: sheets hug their content; About
  is Settings' last section; keymap scopes (the Output and Present Here act only
  on presentation keys); Copy Diagnostics answers in a snackbar; groups glide
  their width (no View Transitions); Recents rows stay in view
- 2026-10-07 — Withdrawn by the maintainer: the source check (ADR-0029 point 4),
  from the app and the CLI
- 2026-10-07 — #43 done: the sample (28 Otterbein hymns, 2 Malayalam songs),
  rights in `docs/sample/RIGHTS.md`, released as `sample-2`, fetched by the
  deploy against `sample/SHA256SUMS`, offered as Try the Sample (SDD-0004 §16)
- 2026-10-07 — Fixed: a Safari private window (`getDirectory()` UnknownError)
  holds books in memory; WebKit e2e runs locally in podman
- 2026-10-07 — #51 done: the flaky App tests wait on delivery, not the clock
- 2026-10-07 — The origin is hymnal.sagaveracity.com (ADR-0030); the fork is
  detached
- 2026-10-06 — #52 done: Playwright smoke suite on three engines; found and
  fixed Firefox's `persist()` prompt stalling the first load
- 2026-10-06 — #44–#49 done: the error screen and user-state checks; books in
  memory where storage is refused; Back Up and Restore (`.hymnal`); a CSP and
  defensive SQLite; About with diagnostics and Report a Problem
- 2026-10-06 — Decided by the maintainer: the app does not police what users
  load (ADR-0020); copyright gates only the sample it ships
- 2026-10-05 — Loading a large book is about three times faster, with a
  determinate bar (SDD-0004 §14)
