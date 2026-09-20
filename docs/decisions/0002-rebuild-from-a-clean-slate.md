# 0002 — Rebuild from a clean slate, archiving the existing implementation

- **Status:** Accepted
- **Date:** 2026-09-20

## Context and Problem Statement

The existing implementation is a Rust build-time generator plus a SvelteKit
site. At build time it clones reveal.js, concatenates 1,631 per-hymn JSON files
into one database file, and renders each hymn through one of four MiniJinja
templates into a standalone static HTML slide deck. The site is a single
prerendered page listing 1,631 numbers, filtered by substring match on the
number, each linking to a pre-baked file.

It works, and it proved the content is worth having. But the Phase 1
requirements are not extensions of it:

| Requirement             | Existing implementation                                         |
| ----------------------- | --------------------------------------------------------------- |
| Dynamic presentation    | Every hymn is a frozen HTML file generated at build time        |
| Multiple hymnbooks      | Hymnal name is a string literal in `transform.rs`               |
| Multiple languages      | Language is a hardcoded path segment, `data/lyrics/mal`         |
| Persistence             | No state of any kind survives a page load                       |
| Lyric search            | Search matches the hymn _number_ only                           |
| Sung order with repeats | Four templates chosen by a `match`; `panic!` on any other shape |

Nothing in the runtime survives contact with these. The parts worth keeping are
the corpus and the licence.

## Considered Options

- **Incrementally refactor the existing stack**
- **Rewrite in place, deleting the old code**
- **Archive the old implementation in-repo, build clean alongside**
- **Start a fresh repository**

## Decision Outcome

Chosen: **archive the existing implementation into `archive/`, and build the
new system from a clean slate in the same repository.**

Incremental refactoring would mean carrying a Rust generator, a SvelteKit app
and reveal.js while replacing the purpose of all three — there is no
intermediate state where the system is coherent. Deleting outright loses a
working reference for the corpus format and the presentation behaviour, both of
which are needed to write the migration. A fresh repository loses continuity
for no benefit.

`git mv` was used throughout, so file history follows into `archive/`.

### Consequences

Good:

- Clean slate with no compromise to stack or model.
- The old implementation stays readable as a reference for migration work.
- History is preserved; nothing is lost.

Bad:

- The GitHub Pages deployment stops — `.github/workflows/` moved with the rest,
  and the public URL in the old README goes stale.
- `archive/` is dead weight in the tree, and will invite "should we delete this
  yet?" for some time.

Neutral:

- `archive/` is excluded from all linting and formatting, and from the build.
- It should be deleted once the migration is complete and verified. Not before.
