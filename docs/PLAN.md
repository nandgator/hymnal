# Plan

Live control document. **Read first, update last.** Everything else in `docs/`
is reference; this is state. If the two disagree, this file is wrong — fix it.

## Workflow

The loop, for anything bigger than a typo: an idea from either side → hashed
out to shared understanding → the relevant ADR/SDD/PLAN updated first → built
in parts, user reviewing each → next Board item, repeat until the hymnal is
built.

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

**Phase 1, domain layer started.** Sequence Engine implemented and unit
tested; no UI, persistence or content pipeline yet.

**Next:** Board #3 — FTS5 tokenisation spike for Malayalam (risk R5).

## State

| Area    | Status                                                              |
| ------- | ------------------------------------------------------------------- |
| Docs    | arc42 + 13 ADRs + SDD-0001 complete                                 |
| Tooling | bun, biome, prettier, markdownlint — `bun run check` green          |
| App     | Vite + SolidJS + TS scaffolded; vitest chosen as test runner        |
| Domain  | Types + Sequence Engine (`src/domain/`) — pure, 15 unit tests green |
| Corpus  | 1,631 hymns, unmigrated; `archive/` removed from tree — see README  |

## Board

Ordered. Top unblocked item is next.

| #   | Task                                                             | Blocked by |
| --- | ---------------------------------------------------------------- | ---------- |
| 3   | Spike: FTS5 tokenisation for Malayalam (risk R5)                 | —          |
| 4   | Migration: archived corpus → new corpus source                   | —          |
| 5   | Content pipeline: corpus → SQLite package + invariant validation | 3, 4       |
| 6   | Persistence: OPFS content store, IndexedDB user state            | 5          |
| 7   | Library — hymnbook selector                                      | 6          |
| 8   | Finder — number and lyric search                                 | 6          |
| 9   | Presenter — renderer, focus, recurrence cue                      | 6          |
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

- 2026-09-21 — Added `Hymnbook.isbn` (natural id). Kept `HymnbookId` as a
  human slug rather than a synthetic id (uuid7 etc.) — deferred to Board
  #11 (CMS), the point at which multi-publisher coordination would matter.
  Documented the idea → discuss → document → build → review loop as
  **Workflow**, above.
- 2026-09-21 — Board #2 done: domain types + Sequence Engine in
  `src/domain/`, pure and framework-free (ADR-0005). 15 unit tests cover
  recurrence computation, ad-hoc jumps and the whole-part/line-index walk
  across occurrence boundaries (open question in SDD-0001 §5.4).
- 2026-09-21 — Board #1 done: Vite + SolidJS + TS scaffolded, vitest chosen,
  biome's solid domain wired in. `bun run check` green, dev server and build
  verified in a real browser.
- 2026-09-21 — Removed `archive/` from the tree (kept in git history at
  `155baea`); dropped its now-dead exclusions from every tool config. Added
  Board #11 — CMS for managing hymnal content.
- 2026-09-21 — Pushed 5 commits: archive move, tooling, docs. No code yet.
- 2026-09-20 — Requirements settled; arc42, 13 ADRs and SDD-0001 written;
  previous implementation archived.
