# Plan

Live control document. **Read first, update last.** Everything else in `docs/`
is reference; this is state. If the two disagree, this file is wrong — fix it.

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

**Phase 1, scaffold done.** App builds, lints and tests green; no domain code
yet.

**Next:** Board #2 — domain types + Sequence Engine.

## State

| Area    | Status                                                             |
| ------- | ------------------------------------------------------------------ |
| Docs    | arc42 + 13 ADRs + SDD-0001 complete                                |
| Tooling | bun, biome, prettier, markdownlint — `bun run check` green         |
| App     | Vite + SolidJS + TS scaffolded; vitest chosen as test runner       |
| Corpus  | 1,631 hymns, unmigrated; `archive/` removed from tree — see README |

## Board

Ordered. Top unblocked item is next.

| #   | Task                                                             | Blocked by |
| --- | ---------------------------------------------------------------- | ---------- |
| 2   | Domain types + Sequence Engine — pure, unit tested               | —          |
| 3   | Spike: FTS5 tokenisation for Malayalam (risk R5)                 | —          |
| 4   | Migration: archived corpus → new corpus source                   | 2          |
| 5   | Content pipeline: corpus → SQLite package + invariant validation | 3, 4       |
| 6   | Persistence: OPFS content store, IndexedDB user state            | 5          |
| 7   | Library — hymnbook selector                                      | 6          |
| 8   | Finder — number and lyric search                                 | 6          |
| 9   | Presenter — renderer, focus, recurrence cue                      | 2, 6       |
| 10  | PWA shell, offline, responsive phone → large display             | 7, 8, 9    |
| 11  | CMS for managing hymnal content (add/edit hymns, hymnbooks)      | 5          |

Do #3 early despite its position: it can change the schema in SDD-0001 §6.
Item 11 sits past the Phase 1 scope guard below — sequence it after Phase 1
unless scope is deliberately widened.

## Invariants

Breaking these breaks the design. Check before deviating.

- Domain layer imports no UI framework — [ADR-0005](decisions/0005-use-solidjs.md)
- Content validated at build time, never repaired at runtime — [arc42 §8.6](architecture/arc42.md)
- Migration output is committed source, never regenerated wholesale — [ADR-0009](decisions/0009-migrate-the-corpus-by-rule.md)
- Stored sequence is never mutated; live deviation appends — [SDD-0001 §5.1](design/0001-domain-model.md)
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

| Question                           | Blocks      |
| ---------------------------------- | ----------- |
| FTS5 tokenisation for Malayalam    | Board #5    |
| Visual language for repeated parts | Board #9    |
| Lyrics copyright / redistribution  | Any release |

## Log

- 2026-09-21 — Board #1 done: Vite + SolidJS + TS scaffolded, vitest chosen,
  biome's solid domain wired in. `bun run check` green, dev server and build
  verified in a real browser.
- 2026-09-21 — Removed `archive/` from the tree (kept in git history at
  `155baea`); dropped its now-dead exclusions from every tool config. Added
  Board #11 — CMS for managing hymnal content.
- 2026-09-21 — Pushed 5 commits: archive move, tooling, docs. No code yet.
- 2026-09-20 — Requirements settled; arc42, 13 ADRs and SDD-0001 written;
  previous implementation archived.
