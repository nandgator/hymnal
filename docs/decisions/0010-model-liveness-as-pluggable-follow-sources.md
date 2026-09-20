# 0010 — Model "what is live" as pluggable follow sources

- **Status:** Accepted
- **Date:** 2026-09-20

## Context and Problem Statement

Phase 1 has exactly one way the display advances: the user navigates. Phase 2
contemplates two more — detecting an announced hymn number from room audio, and
following sung lyrics to highlight the active line.

Phase 2 is a future possibility, not a commitment, and its second half is
genuinely hard. Unlike Metrolist, which _downloads_ pre-made LRC files for
studio recordings, this would mean forced alignment against live congregational
singing — many overlapping voices, reverb, accompaniment. That is research-grade
and may never ship.

The risk is building Phase 1 such that adding a second source later means
rewriting the presentation layer.

## Considered Options

- **Drive the presenter directly from user input**, refactor later if needed
- **Build the full source abstraction now**, with audio and network sources
  stubbed
- **A single observable with pluggable sources**, one implementation in Phase 1

## Decision Outcome

Chosen: **model liveness as one observable with pluggable sources, and ship
exactly one source in Phase 1.**

The presentation layer subscribes to an abstract "what is live now" stream — a
position in the address space `(hymnbook, hymn, occurrence, line)` — rather
than to user input events. In Phase 1 the only implementation is local user
navigation.

This is one interface and one indirection. It is the **only** concession Phase
1 makes to Phase 2, and it is made because it is nearly free now and expensive
later: retrofitting would mean touching every part of the renderer.

Stubbing unimplemented sources is worse than not having them. Stubs rot, imply
a design not validated against a working implementation, and invite building to
a guessed shape.

### Consequences

Good:

- A second source becomes an addition, not a rewrite.
- Presentation is decoupled from input, which also makes it testable by feeding
  a scripted position stream with no UI.
- Phase 2 can be abandoned entirely at no cost — one unused interface.

Bad:

- One indirection with no present justification. Phase 1 alone would be
  marginally simpler without it.
- Risk of designing the interface around imagined Phase 2 needs. Mitigated by
  keeping it minimal: a source emits positions, nothing more. No confidence
  scores, no source metadata, no arbitration — those are invented when a second
  source actually exists.

Neutral:

- If multiple sources ever run at once, arbitration is needed. Deliberately
  undesigned; there is nothing to arbitrate with one source.
- The address space is shared with position persistence, so it is being
  validated by Phase 1 use regardless.
