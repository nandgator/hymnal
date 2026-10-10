# 0031 — Assorted Hymns: the person's own book of single songs

- **Status:** Accepted
- **Date:** 2026-10-10
- **Decided:** by the maintainer, in the design talk for Board #58

## Context and Problem Statement

A church sings songs that are in none of its books: a chorus learnt at a camp, a
song from a sheet handed round. From Text (ADR-0029) turns pasted text into a
book, so a single song today becomes a book of one, with an id and a title to
invent, and the Library fills with them.
[ADR-0021](0021-identify-books-by-the-store-that-holds-them.md) foresaw this:
loose songs belong to the user's own collection, and the store numbers them.
SDD-0004 §13 left them open.

Favourites and a service queue are something else: lists of songs that already
live in books. They point; they hold no lyrics. They are Board #22's, not this
record's.

## Considered Options

- **A book of one per song**, as today
- **A separate song store** beside the books, outside any package
- **Assorted Hymns, a real book** the device holds and the person adds to

## Decision Outcome

Chosen: **Assorted Hymns is a real book.**

1. **One per device, a package like any other.** It has a UUIDv7 key, a fixed
   origin (`assorted`), the title Assorted Hymns, and the registry kind
   `assorted`. The Finder, the Operator, recents, search and backup take it as
   they take any book, with no second path. It is made by its first song and
   cannot be renamed.
2. **Mixed languages.** The book's language is `mul` and its script `Zyyy`
   (BCP-47 and ISO 15924 for "several" and "common"). Each song keeps its own
   language and script, in the package (schema version 4), not in format 1:
   nothing outside the device reads them yet. Format 2 comes only when something
   exports Assorted Hymns as a container (Board #24).
3. **Stable numbers, a sorted view.** A song is numbered when it is added: the
   next number, never reused, so a recent or a position never points at another
   song. Wherever its songs are listed, they are ordered by language tag, then
   by title in that language's collation. A number still finds its song.
4. **One way in: From Text, one song.** Pasting a single song offers Add to
   Assorted Hymns, with no book fields but its language and script. A file of
   several songs still makes a book of its own. Copying a song out of a loaded
   book is not offered: that is a favourite, a list entry (#22).
5. **A song can be removed.** Its number is retired with it. Editing is removing
   and adding again, until the CMS (#14). The last song removed takes the book
   with it, as removing the book does (its recents go).
6. **Restore merges.** A backup's Assorted Hymns is restored as the device's
   when the device has none, and otherwise merged into the device's: a song
   whose hash is there is skipped, any other is added under its backup number if
   that is free and the next number if not, and the backup's recents and
   position follow it.

Why: a real book costs one registry kind, one package column pair and one
counter, and every reader of books takes it for free. A separate store would
need a second path through the Finder, the Operator, recents and backup, for the
same songs.

### Consequences

- Good: the Library stops filling with books of one; a single song needs no id
  or title for a book.
- Good: format 1, its schema and the authoring kit are untouched.
- Bad: a package is rewritten when a song is added or removed. Assorted Hymns is
  small, so the cost is a whole-book write of a few songs (SDD-0004 §6).
- Bad: a merge can bring back a song removed on one device but not the other.
  Merge loses nothing, and the person removes it again.
