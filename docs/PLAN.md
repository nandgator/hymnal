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

**Board #12 (MD3 visual redesign) is in progress.** Board #11 is done.
Spec: [`visual/DESIGN.md`](visual/DESIGN.md) and SDD-0001 §16.3.
Parts, each reviewed before the next:

1. ~~Foundation~~ — done
2. ~~Components~~ — done
3. Operator, layered app shell (DESIGN.md § Structure, SDD §16.4–16.5):
   - ~~3a. Shell: rail/menu, switcher row with hot-swap~~ — done
   - 3b. Workspace: Live anchor, Parts | Lyrics navigator, touch-first Lyrics
   - 3c. Keyboard shortcuts, `?` sheet, command menu (Ctrl/⌘+K)
   - 3d. Pane show/hide, persisted
   - 3e. Output → Operator scroll sync (SDD §16.1)
4. Output: tokens and a 10% margin from each edge

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
| UI      | Library → Finder → Presenter + Output window; MD3 redesign next — §12-16 |
| Deploy  | GitHub Actions → GitHub Pages, PWA shell, offline — SDD-0001 §15         |

## Board

Ordered. Top unblocked item is next.

| #   | Task                                                                | Blocked by |
| --- | ------------------------------------------------------------------- | ---------- |
| 12  | Visual redesign: Material Design 3 (SDD-0001 §16.3, `visual/`)      | —          |
| 13  | Output layout Modes 2 (parallel chorus) + 3 (paginated scroll-snap) | 12         |
| 14  | CMS for managing hymnal content (add/edit hymns, hymnbooks)         | —          |
| 15  | Transliteration: search and display across scripts (ADR-0014)       | —          |
| 16  | Feedback and corrections from users — where collected: TBD          | —          |
| 17  | About: acknowledgements, copyright, credits                         | —          |
| 18  | Over-the-air update notices (as Supabase announces changes)         | —          |
| 19  | Picker hymnbook scope: swap book + hymn in one step (SDD §16.4)     | 2nd book   |

12–13 are Phase 1. 14–15 sit past the scope guard below. 16–19 are notes,
not scheduled: the shell reserves room for them (DESIGN.md § Structure).

## Invariants

Breaking these breaks the design. Check before deviating.

- Domain layer imports no UI framework — [ADR-0005](decisions/0005-use-solidjs.md)
- Content validated at build time, never repaired at runtime — [arc42 §8.6](architecture/arc42.md)
- Migration output is committed source, never regenerated wholesale — [ADR-0009](decisions/0009-migrate-the-corpus-by-rule.md)
- Stored sequence never mutated; a jump rewrites only what lies ahead —
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
| One-key blank Output (B or .)     | 3c keymap   |

## Log

- 2026-09-24 — #12 part 3a: layered shell, hot-swap switcher; calmer M3 register
- 2026-09-24 — Jumps skip ahead or repeat in place; Next never dead-ends — §5.1
- 2026-09-24 — #12 part 3: Operator layout; controls never move with content
- 2026-09-24 — Output cursor hides after 2s idle, shows on mouse move
- 2026-09-24 — #12 part 2: MD3 components; Library and Finder restyled
- 2026-09-24 — #12 part 1: MD3 tokens; Google Sans bundled as "Hymnal Sans"
- 2026-09-24 — `DESIGN.md` → `docs/visual/`; its Output now matches §16.1
- 2026-09-23 — Board #11 done: Output window, scroll Mode 1 — SDD-0001 §16.1
- 2026-09-23 — Output focus mirrors Operator's: whole part lit, block centred
- 2026-09-23 — Output late join: `hello` replays last message — §16.1
- 2026-09-23 — `repeatOrdinal` (adjacent-only) replaces recurrence — §16.2
