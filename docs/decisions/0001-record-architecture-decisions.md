# 0001 — Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-20

## Context and Problem Statement

This project is being rebuilt from scratch by a single maintainer, over an
indefinite period, in intermittent sessions. The decisions being made now —
data model, stack, delivery — will be acted on months from now by someone who
has forgotten the discussion that produced them.

Code records _what_ was built. Git history records _when_. Neither records
_why_, or which alternatives were weighed and rejected. That missing reasoning
is what causes a settled decision to be relitigated, or worse, silently
reversed by someone who assumed it was arbitrary.

## Considered Options

- **Architecture Decision Records (ADRs)**
- **A single running design document**
- **Long commit messages**
- **Nothing — rely on code and memory**

## Decision Outcome

Chosen: **ADRs, in [MADR](https://adr.github.io/madr/) format**, stored in
`docs/decisions/`, numbered sequentially, one decision per file.

A single running document loses history — it shows the current answer, never
the discarded ones, and the discarded ones are precisely what stop a decision
being remade badly. Commit messages are attached to changes rather than to
decisions, and decisions frequently precede any change at all. Several
decisions here (deferring the wrapper, deferring sync) produce no code, and so
would leave no trace under either alternative.

ADRs are immutable. A decision that stops being right is superseded by a new
ADR, never edited.

### Consequences

Good:

- Reasoning survives the session that produced it.
- Rejected options are recorded, so they are not silently retried.
- Deferral becomes recordable, with an explicit trigger for revisiting.

Bad:

- Discipline required: the record is worthless if it is not kept current.
- Some ceremony for a solo project.

Neutral:

- The numbering is a permanent, append-only sequence. Gaps are fine.
