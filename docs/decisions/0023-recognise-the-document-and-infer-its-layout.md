# 0023 — Recognise what a document holds, and infer its layout

- **Status:** Accepted
- **Date:** 2026-09-27

## Context and Problem Statement

The first importer ([ADR-0018](0018-import-songs-through-a-layout-aware-pipeline.md))
reads a book through a profile written by hand from its fonts. On _Hymns of
Fellowship_ that drafted all 275 songs. But users of the browser import
(#28) can't write a profile, and the second book shows how far layouts
differ: _Songs of Zion_ is one song per landscape slide, headed by a bare
number, with no titles, type from 22 to 26 pt, and its own line wraps.

Users will also bring documents that aren't songbooks at all: a bank
statement, a child's drawing, an article about hymns. And songbooks reach us
in forms the first importer can't read. A local collection of real PDFs
(below) found four:

- **Typeset text**, like both books so far.
- **Scans carrying someone else's OCR**: a page image with invisible text
  laid over it (archive.org's books; the font is Tesseract's
  `GlyphLessFont`). The text has errors ("seventli dav"), and one font
  throughout, so a refrain can't be told by its italics.
- **Images only**: scans without text, photos, handwritten sheets.
- **Words set under music**, split into syllables, the verses interleaved
  line by line beneath the staves.

No importer is accurate on every PDF. What it can be is never confidently
wrong, and it can refuse what it can't read.

## Considered Options

- **Profiles by hand**, per book, as now
- **Infer the layout; a profile only overrides**
- **A model reads every page** (Laya first, rules checking it)

## Decision Outcome

Chosen: **recognise what each page holds, infer the layout, and flag what
isn't certain.**

**Triage, per page, before anything is imported:**

| The page holds                    | What happens                                           |
| --------------------------------- | ------------------------------------------------------ |
| Typeset lyrics                    | Imported                                               |
| Lyrics in someone else's OCR text | Imported; every song flagged "from unchecked OCR"      |
| Only images                       | Routed to the image stage; refused until it exists     |
| Words under music                 | Refused, saying why (a Board item of its own)          |
| Anything else                     | Skipped, listed in the report                          |
| No song page in the document      | The document is refused, saying what was found instead |

A book with a preface, an index or a sermon appendix imports its song pages.

**Rules first, then a judge.** Rules settle the clear pages: no text, a
table of amounts and dates, prose paragraphs, or blocks of short lines with
the rhythm of verse. A local judge (Laya first, SDD-0003 §4.1), when
installed, answers only the pages the rules leave open, given the text and
the layout facts. Without one, those pages are flagged, never guessed. Jev,
being hosted, is excluded (ADR-0018).

**The layout is inferred.** Columns, line pitch and measure per page; the
heading style, found as the one whose numbers run in order; whether songs
have titles; the refrain's font; and the words that label parts, from a
built-in list per language. The review shows what was inferred. A profile
file is optional, and only overrides what inference got wrong.

**Accuracy is measured**, on a local shelf of real documents, songbooks and
rejects both (SDD-0003 §6): every rule change runs against all of it, and
the scores are recorded. The documents stay in `content-local/`, never
committed; they come only from sources that allow downloading, fetched
politely, and never by getting around a block.

A model on every page was rejected: it is blind to images, costs a model run
per page (a minute or more for a 400-page book on a laptop CPU), makes the
model a requirement of detection, and settles no clear case better than a
rule.

### Consequences

Good:

- The command line and the browser share one path; a profile is a
  correction, not a precondition.
- Refusals name the reason: "these pages are images", "this looks like a
  statement".
- What the importer is unsure of is visible, song by song.

Bad:

- Inference is more code, and more ways to be wrong, than a profile. The
  shelf is what keeps it honest, and it is only as good as its variety.
- Scanned books without text, handwritten sheets and music books wait for
  stages of their own. Handwriting in particular will be assisted typing,
  the photo beside the text, more than recognition.

Neutral:

- Profiles written so far stay valid, as overrides.
