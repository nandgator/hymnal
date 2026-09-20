# 0008 — SQLite as the on-device content store

- **Status:** Accepted
- **Date:** 2026-09-20

## Context and Problem Statement

Content is read-only at runtime, potentially large — 1,631 hymns in the first
book alone, with more books to come — and must be queryable both by exact
number and by free text within lyrics, entirely offline.

Two kinds of state exist, and they are not alike:

|            | Content              | User state         |
| ---------- | -------------------- | ------------------ |
| Size       | Large                | Small              |
| Mutability | Immutable at runtime | Frequently written |
| If lost    | Re-installable       | **Irreplaceable**  |

## Considered Options

- **JSON assets with an in-memory index**
- **IndexedDB for everything**
- **SQLite (WASM) for content, IndexedDB for user state**

## Decision Outcome

Chosen: **prebuilt SQLite per hymnbook, queried in the browser via `wa-sqlite`
with OPFS persistence; user state separately in IndexedDB.**

The decisive property is that **a hymnbook becomes a file.** It can be built
ahead of time, versioned, distributed, installed, removed and replaced as a
unit — which is precisely what makes multi-book support cheap, and what makes
"a new hymnbook is data, not code" achievable rather than aspirational.

FTS5 provides full-text search over lyrics without hand-rolling an index.
Loading JSON for every book into memory and indexing at startup would be slow
on the device floor and would scale badly past the first book. IndexedDB has no
full-text search at all, so the index would have to be built and maintained by
hand.

The two stores are kept deliberately separate. Their lifecycles differ, and
conflating them would put irreplaceable user state in the store most likely to
be evicted.

### Consequences

Good:

- A hymnbook is an installable, versionable artifact.
- FTS5 gives real lyric search with no bespoke index.
- Query logic is identical for bundled and downloaded books.
- Content is prepared at build time, where a human can act on validation
  failures.
- Carries unchanged into a native wrapper later — SQLite is available
  everywhere.

Bad:

- A WASM SQLite build adds to bundle size and startup cost.
- OPFS requires care: it is origin-scoped, and access patterns differ between
  worker and main thread.
- **Malayalam tokenisation is an open risk.** FTS5's default tokeniser may
  handle Malayalam poorly. Needs an experiment against the real corpus early,
  with a custom tokeniser as fallback. Tracked as risk R5.

Neutral:

- **Browsers may evict OPFS under storage pressure.** Persistent storage must
  be requested, loss detected, and re-install offered. Because user state lives
  in IndexedDB, eviction of content is an inconvenience rather than data loss —
  which is the entire reason for the split.
