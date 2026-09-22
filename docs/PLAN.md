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

**Phase 1, first UI screen built.** Library (`src/library/`) provisions the
bundled hymnbook and shows loading/error/ready states; no Finder or Presenter
yet.

**Next:** Board #8 — Finder, number and lyric search.

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
| UI      | Library provisions + shows the bundled hymnbook (`src/library/`) — §12   |

## Board

Ordered. Top unblocked item is next.

| #   | Task                                                          | Blocked by |
| --- | ------------------------------------------------------------- | ---------- |
| 8   | Finder — number and lyric search                              | —          |
| 9   | Presenter — renderer, focus, recurrence cue                   | —          |
| 10  | PWA shell, offline, responsive phone → large display          | 7, 8, 9    |
| 11  | CMS for managing hymnal content (add/edit hymns, hymnbooks)   | —          |
| 12  | Transliteration: search and display across scripts (ADR-0014) | 10         |

Items 11 and 12 sit past the Phase 1 scope guard below — sequence them after
Phase 1 unless scope is deliberately widened.

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
| Visual language for repeated parts | Board #9    |
| Lyrics copyright / redistribution  | Any release |

## Log

- 2026-09-22 — Board #7 done: `src/library/Library.tsx` provisions the
  bundled hymnbook on mount and renders pending/error/ready states, with
  retry on failure (SDD-0001 §12). Narrowed from arc42's list/install/remove
  to just this, since Phase 1 has one bundled book and nothing to choose
  between. Navigation to Finder/Presenter deferred: signal-based view state
  agreed, not a router, but nothing to route to yet. Verified in a real
  browser against the bundled corpus.
- 2026-09-22 — Board #6 done: user state (`src/persistence/user-state.ts`) —
  one `idb` object store, one document, `getLastPosition`/`setLastPosition`
  (reuses domain `Position`) and `getRecents`/`addRecent` (dedup, cap 20).
  Unit tested via `fake-indexeddb` — unlike the content store, plain
  IndexedDB has a faithful polyfill. Also fixed a real bug found while
  reasoning about static hosting: the content store's fetch was
  root-absolute, which breaks on a GitHub Pages project page; now uses
  Vite's `BASE_URL`.
- 2026-09-22 — Board #6 part 1 done: content store worker
  (`src/persistence/content-store.worker.ts`) over `@sqlite.org/sqlite-wasm`'s
  `opfs-sahpool`, exposed via Comlink. Verified in a real browser against the
  bundled corpus: provisioning, `getHymnbook`/`listHymns`/`getHymn` and FTS5
  search (via a join, since `hymn_fts` is contentless) all correct. Also fixed
  Board #5's `build-content.ts` output directory — `dist/` is emptied by
  `vite build` and doesn't exist in dev; now writes to `public/content/`.
- 2026-09-22 — Board #6 design agreed (SDD-0001 §10): content store is a
  dedicated Worker over `@sqlite.org/sqlite-wasm`'s `opfs-sahpool` VFS,
  exposed via Comlink. Superseded ADR-0008's library choice — wa-sqlite's OPFS
  support turned out to be unmaintained example code — with ADR-0015. User
  state (idb) is part 2.
- 2026-09-22 — Board #5 done: `scripts/build-content.ts` loads `content/`,
  validates, builds `public/content/*.sqlite` (FTS5 + `content_hash`), per
  SDD-0001 §9. Runs clean against the real corpus.
- 2026-09-21 — Transliteration requested (search in any script; full-switch or
  interlaced display; any-to-any). Deferred: ADR-0014, Board #12. Board #5
  schema unchanged.
- 2026-09-21 — Board #5 part 1: `src/domain/validate.ts` (I1-I7, shape,
  file-name, hymn-count, unsupported-meta; collect-all), 21 tests; the real
  corpus validates clean.
- 2026-09-21 — Board #5 design agreed (SDD-0001 §9): Bun script, `bun:sqlite`,
  collect-all validation, `content_hash` beside `schema_version`.
- 2026-09-21 — Board #4 done: `content/mal-ymef-athmeeya-geethangal-16/`
  written (1,631 hymns + hymnbook.json), invariants I1-I7 checked clean.
  Rerun is refused by design. Hymns 156, 666, 753, 856, 864, 890, 895, 901,
  924, 930, 1066, 1335 need hand correction of their multi-paragraph choruses.
- 2026-09-21 — Board #3 done: default `unicode61` fragments Malayalam;
  `tokenchars` fix validated on the real corpus (SDD-0001 §6, R5 closed).
- 2026-09-21 — Added `Hymnbook.isbn`; kept `HymnbookId` a slug, uuid7
  deferred to Board #11. Documented the **Workflow** loop.
