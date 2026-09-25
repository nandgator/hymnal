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

**Board #13 (the refrain, pinned) is in progress.** Board #12 is done.
Spec: SDD-0001 §16.1 (The refrain, pinned), DESIGN.md § Layout. Parts,
each reviewed before the next:

1. ~~The refrain on a tonal band, flowing; the message names the refrain~~ — done
2. Pinned band: layout, fit with the 80% floor, "Pin the refrain" setting

## State

| Area    | Status                                                                   |
| ------- | ------------------------------------------------------------------------ |
| Docs    | arc42 + 14 ADRs + SDD-0001 complete                                      |
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

| #   | Task                                                               | Blocked by |
| --- | ------------------------------------------------------------------ | ---------- |
| 13  | The refrain, pinned in a band (SDD §16.1); Mode 3 dropped          | —          |
| 14  | CMS for managing hymnal content (add/edit hymns, hymnbooks)        | —          |
| 15  | Transliteration: search and display across scripts (ADR-0014)      | —          |
| 16  | Feedback and corrections from users — where collected: TBD         | —          |
| 17  | About: acknowledgements, copyright, credits                        | —          |
| 18  | Over-the-air update notices (as Supabase announces changes)        | —          |
| 19  | Picker hymnbook scope: swap book + hymn in one step (SDD §16.4)    | 2nd book   |
| 20  | Keymap review (§16.5): band size, Repeat/Undo/Reset, Show cues now | near done  |
| 21  | Hold: freeze the Output on what's showing, navigate, release       | —          |
| 22  | Service queue: line up hymns for a service (a supporting pane)     | —          |
| 23  | Arrangements: mix parts of hymns into a saved mashup               | 22         |
| 24  | Lyrics interchange (OpenLyrics, LRC); timing per recording         | Phase 2    |
| 25  | Stage outputs for musicians: lyrics + chords, score, notation      | content    |
| 26  | Rethink the Operator layout: Parts, Live preview and Lyrics        | —          |

13 is Phase 1. 14–15 sit past the scope guard below. 16–26 are notes,
not scheduled: the shell reserves room for them (DESIGN.md § Structure).

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

- 2026-09-25 — #13 designed: refrain pinned, Mode 3 dropped; part 1: refrain band
- 2026-09-25 — Phone switcher row: hymnbook icon + hymn number, titles as names
- 2026-09-25 — #12 done. Part 4c: cues (number badge, lower third), fade on change
- 2026-09-25 — #12 part 4b: Repeat, Undo, Reset; a repeat stays in place on the Output
- 2026-09-25 — #12 part 4a: Output on tokens; Output-only presets, Warm default
- 2026-09-25 — #12 part 3e: Output scroll seeks via a reading band; keys forwarded
- 2026-09-25 — #12 part 3d: Live, sidebar hideable (remembered); Settings grouped
- 2026-09-25 — #12 part 3c: keymap, `?` sheet, Ctrl/⌘+K menu; B blanks, held — §16.5
- 2026-09-24 — Output fits per hymn, eyeline 42%; Live = scaled Output; repeat explicit
- 2026-09-24 — Finder searches as you type (combobox); shortcuts off while typing
- 2026-09-24 — Relicensed AGPL-3.0-only → Apache-2.0; resolves arc42 R3 — ADR-0016
- 2026-09-24 — #12 part 3b: Live + navigator workspace; MD3 height classes
