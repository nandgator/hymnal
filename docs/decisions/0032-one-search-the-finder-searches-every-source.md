# 0032 — One search: the Finder searches every source

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decided:** by the maintainer, in the design talk for Board #38

## Context and Problem Statement

The Finder searches one book: the current one. A church's songs now live in
several: its hymnbooks, and Assorted Hymns
([ADR-0031](0031-assorted-hymns-the-persons-own-book.md)) beside them. To find a
song the person must know which book holds it, or switch books and search again.

More will be searchable later: arrangements (Board #23), the service queue
(#22), annotations, favourites. They live in user state, not in the books'
packages, so no one index or ranking can hold them all. The Finder is already
the command menu (SDD-0001 §16.5): it shows commands and songs together.

## Considered Options

- **A toggle**, This Book or All Books, this book by default
- **A fallback**, other books only when this one finds nothing
- **A separate global search** beside a song picker
- **The Finder is the one search, its results grouped by source**

## Decision Outcome

Chosen: **the Finder is the one search.**

1. **Every book, always.** A lyric or title query searches every held book. A
   number still goes straight to that song in the current book: numbers are per
   book.
2. **Grouped by source.** Each source is a group under its own heading: the
   commands (in the command menu), then the current book, then the other books
   in Library order. Relevance scores come from separate indexes and are not
   comparable, so groups are never interleaved into one false order.
3. **Each copy under its own book.** A song held in two books shows in both: the
   copies are kept apart on purpose (SDD-0001 §11, rights per book), and the
   person picks the edition.
4. **Sources are a seam, not a framework.** The search takes a list of sources,
   each with its own matcher, so arrangements, queues and annotations join as
   new groups when they exist. Only books are built now.
5. **Settings later.** Settings keeps its own search; whether its rows join as a
   group is decided once this one is built.

### Consequences

- Good: one place to look, the one the person already uses; a song is found
  without knowing its book.
- Good: picking a result in another book swaps book and song in one step, which
  is most of Board #19.
- Bad: each query opens and searches every book. Books are few and each search
  is capped, and the worker keeps connections open, but it is measured, not
  assumed (SDD-0001 §13).
