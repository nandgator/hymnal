# 0012 — Drop the bookmark helper

- **Status:** Accepted
- **Date:** 2026-09-20

## Context and Problem Statement

A "bookmark helper" was one of three named Phase 1 features. On examination the
intent was **browser bookmarks** — helping a user bookmark a hymn's URL so they
could return to it, which the archived implementation made awkward because
every hymn was a separate generated HTML file.

That is a workaround for a problem the new architecture does not have.

## Decision Outcome

Chosen: **drop it.**

The feature was shaped by the old delivery model. In an application with
persistent state, "return to what I was reading" is served by recents and
restored position — which fall out of user-state persistence — and "find a hymn
again" is served by search. Neither needs a bookmark concept.

Favourites and setlists were considered as reinterpretations. Both are real
features, but neither is what was asked for, and inventing a requirement to
justify a name already decided on is how scope grows.

### Consequences

Good:

- One fewer feature, one fewer data type, one fewer piece of UI.
- The underlying need is met by capabilities that exist anyway.

Bad:

- No explicit way to mark a hymn for later. If that need is real, it returns as
  favourites or setlists — as its own decision, on its own merits.

Neutral:

- Phase 1 is now: hymnbook selector, dynamic presentable hymnal, reworked
  persistence.
- User state therefore means preferences, recents, last position, and which
  hymnbooks are installed. Not favourites.
