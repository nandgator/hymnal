# 0003 — Model hymns as parts plus an occurrence sequence

- **Status:** Accepted
- **Date:** 2026-09-20

## Context and Problem Statement

A hymn is not sung in the order it is printed. A refrain printed once is sung
after every stanza. The presentation requirement is precise about this: the
repeated part must be shown **separately, with delicate visual cues**, while
stanzas advance past it and focus moves from one to the next as the hymn
progresses.

The existing model cannot express any of that:

```jsonc
{ "id": 1, "starts": "chorus", "chorus": [...], "bridge": [], "verses": [[...]] }
```

`starts` records only the entry point. **Nothing encodes repetition.** The four
render templates infer a layout from the shape of the data, so "the chorus
repeats" exists only as an assumption baked into template control flow. Across
all 1,631 hymns, `bridge` is empty in every single record, 345 have no chorus,
and 98 have no verses — so the chorus/verse split is functioning as a _layout
switch_, not as a claim about what repeats.

The requirement needs the opposite: repetition as a first-class concept.

## Considered Options

- **Keep the flat model, infer repeats at render time**
- **Store the fully expanded sung order** (the refrain's text duplicated at
  each repeat)
- **Parts plus a sequence of references to parts**
- **A linked structure** where each part points to its successor

## Decision Outcome

Chosen: **parts plus a sequence of references.**

A hymn owns a set of **parts**, each with an id, a kind (stanza, refrain,
bridge, tag) and lines. It separately owns a **sequence**: an ordered list of
references to those parts. A part may be referenced any number of times.

The decisive consequence is that an **occurrence** — one position in the
sequence — becomes a distinct addressable thing from the **part** whose text it
shows. "The chorus, third time" is `part=refrain, occurrence=5`: identifiable,
distinguishable from occurrences 1 and 3, yet sharing their identity.

That is exactly what the visual-cue requirement needs. The renderer is told not
only _which text_ but _which showing of it_ — so it knows the text has been
seen before, how many times, and what preceded it.

Rejected alternatives, and why:

- **Inferring at render time** is what the current system does. The knowledge
  lives in template branches rather than data, so every new hymn shape needs
  new code. This is the failure being corrected.
- **Expanding the sung order** duplicates lyric text at every repeat. A
  correction must then be applied in several places, which directly threatens
  the top quality goal, and repetition becomes invisible — the renderer cannot
  tell a repeat from a new stanza.
- **A linked structure** makes the common operations awkward: random access,
  "what is occurrence 7", and counting prior showings all require traversal.
  It also permits cycles, which would be a non-terminating hymn.

### Consequences

Good:

- Repetition is explicit data, not inferred behaviour.
- Lyric text is stored exactly once per part — one place to correct.
- Free navigation (R6) is separable: the sequence is an _expectation_, never a
  constraint. The presenter may deviate without mutating stored data.
- **The display question becomes a view-layer decision.** Inline-with-cue,
  pinned refrain, and render-once-with-focus-jumping are all strategies over
  the same data, so the visual language can be settled later, or more than one
  offered. Nothing in storage has to change.
- A later audio follow source can report a position in the same address space.

Bad:

- Sequence data does not exist for any of the 1,631 hymns and must be derived.
  See [ADR-0009](0009-migrate-the-corpus-by-rule.md).
- More complex than the flat model — two concepts where there was one.
- Storing and rendering are one indirection apart; an occurrence must be
  resolved to a part before anything can be displayed.

Neutral:

- `bridge` disappears as a top-level field and becomes a part _kind_, which is
  what it always should have been. Nothing is lost: it is empty in all 1,631
  records.
- Single-part hymns — the 98 with no verses — stop being modelled as a chorus
  that never repeats, and become one stanza with a one-entry sequence.

## More Information

Specified in full in the [domain model SDD](../design/0001-domain-model.md).
