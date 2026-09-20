# 0009 — Migrate the corpus by rule, refine in place

- **Status:** Accepted
- **Date:** 2026-09-20

## Context and Problem Statement

[ADR-0003](0003-model-hymns-as-parts-and-an-occurrence-sequence.md) requires
parts and a sequence. The existing corpus has neither, and is thinner than it
first appears. Measured across all 1,631 hymns:

| Observation                   | Count                    |
| ----------------------------- | ------------------------ |
| Hymns                         | 1,631                    |
| `bridge` populated            | **0**                    |
| No chorus                     | 345 (21%)                |
| No verses                     | 98                       |
| Empty author                  | 325                      |
| Titles                        | **none — no such field** |
| Repetition data               | **none**                 |
| Tune, meter, topic, scripture | **none**                 |

`starts` records only an entry point: `chorus` for 1,016 hymns and `verse-1`
for the remaining 615. Sung order is not recorded anywhere.

Perfect data is unreachable without a manual pass over the printed 16th
edition, hymn by hymn. That is a large effort with no automatable shortcut, and
it would block all other work.

## Considered Options

- **Hand-author everything against the printed book first**
- **Build an authoring tool, then curate through it**
- **Migrate by rule, refine over time**

## Decision Outcome

Chosen: **migrate by rule, and refine in place as errors are noticed in real
use.**

Rules applied:

- Each verse becomes a part of kind `stanza`; a non-empty chorus becomes a part
  of kind `refrain`.
- Sequence is derived from `starts`: refrain first, or stanza first, with the
  refrain interleaved after each stanza where one exists.
- Hymns with no chorus get a straight run of stanzas.
- The 98 hymns with no verses become a single `stanza` part with a one-entry
  sequence — they are not refrains, because nothing repeats.
- `bridge` is dropped as a field and becomes an available part _kind_. Empty in
  all 1,631 records, so nothing is lost.
- Title defaults to the first line, which is how these hymns are referred to in
  practice.
- Absent metadata stays absent. Fields are optional and backfilled
  pragmatically rather than invented.

Hand-authoring first would block everything else for a long time. An authoring
tool is the right long-term answer but is a substantial subsystem, and building
it before there is anything to author through it inverts the order of value.

### Consequences

Good:

- A usable corpus immediately; other work is unblocked.
- Rules are uniform, inspectable and re-runnable.
- The manual effort is spent on hymns actually found to be wrong, rather than
  uniformly across 1,631 of which most are probably fine.

Bad:

- **Some sequences will be wrong.** Any hymn not following "refrain after every
  stanza" will be misrepresented until corrected. This is a knowing compromise
  of the top quality goal, and the reason it is acceptable is that the error
  mode is visible and local — a presenter sees it immediately, and fixing it
  affects one hymn.
- Derived titles will read oddly for some hymns.

Neutral:

- **Migration output is source, not a build artifact.** It is committed, and
  corrections are made to it directly. Re-running the migration wholesale would
  discard accumulated corrections, so it must not be part of the build.
- Requires a correction workflow that does not depend on an authoring UI —
  editing source files by hand, initially.
- An authoring tool remains the eventual answer and is explicitly deferred, not
  rejected.
