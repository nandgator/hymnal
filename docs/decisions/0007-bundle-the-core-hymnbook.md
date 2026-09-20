# 0007 — Bundle the core hymnbook, download additional books

- **Status:** Accepted
- **Date:** 2026-09-20

## Context and Problem Statement

The application must support multiple hymnbooks across multiple languages, and
must work fully offline — venue networks are unreliable or absent, and the need
arises _during_ a service. Only one hymnbook exists today: Malayalam, YMEF 16th
edition, 1,631 hymns.

A hymnbook has to reach the device somehow, and the trade is between install
size and first-run usefulness.

## Considered Options

- **Bundle every hymnbook in the application**
- **Bundle none; download all on demand**
- **Bundle the core book; download additional ones**

## Decision Outcome

Chosen: **bundle the core hymnbook; download additional books on demand.**

Bundling everything makes install size grow without bound as books are added,
and — more seriously — ties every lyric correction to an application release.
Given the corpus is knowingly imperfect
([ADR-0009](0009-migrate-the-corpus-by-rule.md)), corrections will be frequent,
and coupling them to releases would make fixing a wrong word slow.

Downloading everything means a first run with no network produces an
application with no content. Against the offline reliability quality goal, that
is the worst available outcome.

Bundling the core book means the application is useful the moment it loads,
offline, with no setup — which is the realistic first-use condition.

### Consequences

Good:

- Useful immediately, offline, with zero setup.
- Install size stays bounded as the catalogue grows.
- Additional books ship independently of application releases.

Bad:

- Two content paths to implement and test — bundled and downloaded — where one
  would do.
- The bundled book still requires an application release to correct. This is
  accepted for now, and is worth revisiting if corrections prove frequent
  enough to be annoying.

Neutral:

- "Core" means the Malayalam YMEF 16th edition, as the only existing corpus.
  Not a permanent designation.
- Both paths converge on the same store, so there is one query path regardless
  of how a book arrived. See
  [ADR-0008](0008-sqlite-as-the-on-device-content-store.md).
