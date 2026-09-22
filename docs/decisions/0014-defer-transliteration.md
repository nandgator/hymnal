# 0014 — Defer transliteration (search and display across scripts)

- **Status:** Deferred
- **Date:** 2026-09-21

## Context and Problem Statement

A requirement surfaced after the Phase 1 design was settled: hymns in one
script should be usable in another. Concretely:

1. **Search** a hymn by typing its transliteration. A Malayalam hymn is found
   by typing Latin letters.
2. **Display** the transliteration. The presenter either switches fully to the
   transliterated text, or shows it interlaced with, or set apart from, the
   original.
3. **Any to any**, not just Malayalam to Latin. A hymnbook in any script should
   be readable in any other.

This widens scope. Phase 1 is one hymnbook, one script, single-device, and the
scope guard in [PLAN.md](../PLAN.md) does not include it.

The nearest existing code is [`mal2eng.rs`](https://github.com/nandgator/mal2eng.rs),
a Rust port of `ml2en`: Malayalam to Latin only, version 0.1.1, MIT or
Apache-2.0, published on crates.io, with no WASM support stated. It is a useful
starting point and not the any-to-any engine the requirement needs.

## Decision Outcome

Chosen: **defer. Nothing is built in Phase 1, and nothing in Phase 1 precludes
it.**

Why nothing is precluded:

- Each hymnbook already declares `language` (BCP-47) and `script` (ISO 15924)
  ([SDD-0001 §2.1](../design/0001-domain-model.md)). That is exactly what a
  transliterator needs to choose its source.
- Content packages are build artifacts
  ([ADR-0008](0008-sqlite-as-the-on-device-content-store.md)). A new search
  index is a `schema_version` bump and a rebuild, so it can be added without
  migrating anything.
- Display strategy is a view-layer choice over unchanged data, the same
  argument [ADR-0003](0003-model-hymns-as-parts-and-an-occurrence-sequence.md)
  makes for repeated parts. Transliteration preserves line boundaries, so
  interlacing is pairing line with line, and parts and the sequence are
  untouched.

### Constraints recorded for when this is revisited

Not decisions, but findings that should not have to be rediscovered:

- **Search is lossy in the reverse direction.** Latin to Malayalam is one to
  many: _vazhthuka_, _vaazhthuka_ and _valthuka_ can all mean one word. The
  expected approach is to index a normalised phonetic key at build time and match
  the transliterated query against it, rather than transliterating queries back
  into the script.
- **Any to any is several problems.** Indic scripts share a broadly parallel
  Unicode layout, so Indic to Indic is largely mechanical. Script to Latin needs
  a chosen scheme. Latin to script is the lossy direction above. A pivot
  representation is likely.
- **It must run offline in the browser** and also in the content pipeline
  ([ADR-0004](0004-build-a-responsive-web-application.md)). A Rust core built to
  WASM is plausible, and shipping it as a standalone library is the intended
  direction.
- **Derived text is not source.** Transliteration is machine output, and
  [lyrical correctness](../architecture/arc42.md) is the top quality goal.
  Transliterated text must never be hand-edited source, and how it is
  distinguished on screen needs deciding.

### Revisit when

- Phase 1 is in real use.
- A second hymnbook exists in another script, or Latin-typed search is
  demonstrably wanted.
- The library question is answerable: whether to extend `mal2eng.rs` or start
  from a general design.

### Consequences

Good:

- Phase 1 stays achievable for one person.
- The requirement is written down with its constraints, so it will not be
  re-derived.

Bad:

- Latin-typed search of Malayalam hymns is absent until then, and some users
  will expect it.
- If the phonetic index needs a different tokenisation than the one chosen in
  SDD-0001 §6, that index is a second one, not a change to the first.

Neutral:

- Adding it later means new packages, not migrated ones, so already-installed
  hymnbooks are unaffected until they update.
