# 0024 — Import case by case

- **Status:** Accepted
- **Date:** 2026-09-27
- **Supersedes:**
  [ADR-0023](0023-recognise-the-document-and-infer-its-layout.md)

## Context and Problem Statement

[ADR-0023](0023-recognise-the-document-and-infer-its-layout.md) set out to
recognise what any document holds and infer its layout, so that a user could
import a book without a profile. Measured on a local collection of real
documents, the page measures it relied on did not separate songs from everything
else:

| Measure (median per page)          | Songbooks                                 | Rejects        |
| ---------------------------------- | ----------------------------------------- | -------------- |
| Line breaks the width didn't force | Watts 0.63; Malayalam scans 0.33          | Wikipedia 0.34 |
| Punctuation at line ends           | _Fellowship_ 0.35; _Kristhaathmeeya_ 0.18 | a paper 0.32   |
| Lines reaching the column's width  | _Fellowship_ 0.30                         | IRS form 0.31  |

Metrical verse breaks where the width runs out as often as prose does; OCR
reports type sizes that swing by half on one page; a Malayalam book is set
without punctuation. The numbering that runs through a songbook separates
better, but only after folios, running heads, reference lists and OCR's misread
digits are dealt with, each of them one more rule. Making this robust on every
document is open-ended, and every book so far has needed its own reading anyway.

## Considered Options

- **Keep ADR-0023:** structure first, page measures to break ties
- **Case by case:** a profile, or a script where a profile can't say it, per
  book; the app imports only our own format

## Decision Outcome

Chosen: **case by case.**

- **One book, one profile**, written from `bun run import`'s font table, as for
  _Hymns of Fellowship_. Where a book needs what a profile can't say, it gets a
  small script of its own beside the shared stages. Nothing is inferred, and
  nothing decides what kind of document it was given.
- **Readers are added when a real book needs one**, not to cover a list of
  formats. PDF exists; PowerPoint (#29) is next because _Songs of Zion_ needs
  it.
- **The app imports only format 1**
  ([SDD-0002](../design/0002-content-format.md)): a file made with the command
  line, or given by someone who made one. It never reads a PDF. What it imports
  stays on the device ([ADR-0020](0020-present-songs-do-not-publish-them.md)).
- **The judge** (SDD-0003 §4.1) is back where
  [ADR-0018](0018-import-songs-through-a-layout-aware-pipeline.md) left it:
  built only if a book's report shows questions its rules can't answer.

This narrows ADR-0018's browser path from running the import to loading its
result. The shared stages stay free of Node and DOM, which costs nothing.

### Consequences

Good:

- Each book is handled exactly, and the code only grows when a real book asks
  for it.
- No classifier to tune, measure and keep honest.

Bad:

- Importing a book needs a computer and the command line, or someone who has
  made the file. A user with only a PDF and a phone can't.
- Scanned books, handwritten sheets and words under music have no path, unless
  one of them is worth a script of its own.

Neutral:

- The collection gathered for ADR-0023 stays in `content-local/`, unused unless
  a book's script wants it.
