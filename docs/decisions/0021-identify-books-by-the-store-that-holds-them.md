# 0021 — Identify books by the store that holds them

- **Status:** Accepted
- **Date:** 2026-09-27

## Context and Problem Statement

A book file declares an `id`, a slug such as `mal-ymef-athmeeya-geethangal-16`
([SDD-0002](../design/0002-content-format.md)). One file can promise things
only about itself: unique part ids and unique hymn numbers. Uniqueness
across books is a property of whatever holds several of them.

In the repository, the build guarantees it: a book's `id` must match its
directory name, and directory names are unique. On a device, users import
their own books and songs ([ADR-0020](0020-present-songs-do-not-publish-them.md)).
Two drafts of one book, two editions, or two unrelated books can declare the
same slug, and the same file can be imported twice.
[SDD-0001 §8](../design/0001-domain-model.md#8-open-questions) left generated
ids open until books came from more than one source. They now do.

## Considered Options

- **The store assigns a key (UUIDv7)**; the declared `id` is kept as the
  book's origin
- **Keep slugs, rename on a clash** (`…-2`)
- **Keep slugs, refuse a clash**

## Decision Outcome

Chosen: **the store that holds a book assigns its key.**

- **Shipped books** keep their slug as key. The repository build keeps
  slugs unique.
- **Imported books** get a UUIDv7 when they are first stored. The file's
  `id` is kept as the book's **origin**, so a later import of the same book
  can be recognised.
- **Loose songs** belong to the user's own collection, and the store
  assigns each a number within it. A printed number doesn't exist to use.
- Keys stay opaque strings (`HymnbookId`, SDD-0001 §2.1): never parsed,
  whichever kind they are.

Renaming on a clash makes a key depend on import order, so the same book
has different keys on different devices. Refusing a clash blocks keeping
two editions side by side.

**Recognising what's already there.** Every import records the SHA-256 of
the source file, and every song a hash of its lines, normalised for Unicode
(NFC) and whitespace.

| Match                              | What happens                                               |
| ---------------------------------- | ---------------------------------------------------------- |
| The same file again                | Not imported again; the user is taken to the existing book |
| A different file, the same songs   | As the same file; the new file's hash is recorded too      |
| The same origin, different content | The user chooses: replace it, keep both, or reconcile      |
| A song already in the collection   | Flagged in review, never blocked                           |

"The same songs" means every song's hash matches, in the same numbers: a
re-exported PDF whose index was reflowed is the same book (the two _Hymns of
Fellowship_ files are). **Reconcile** compares the two editions song by song
(added, removed, changed) and lets the user pick per song. Replacing or
reconciling keeps the book's key, so recents and positions still point at
it. Its screen is designed with Board #28.

### Consequences

Good:

- No clash can happen on a device, and nothing is renamed behind the
  user's back.
- Duplicates are caught at the level they occur: file, book or song.

Bad:

- Two kinds of key: a slug for shipped books, a UUID for imported ones.
  Harmless while both are opaque, and the reason they must stay so.

Neutral:

- A song hash only spots exact matches. A near match (the same song typed
  differently) is a suggestion a person confirms, as SDD-0001 §8 intends for
  songs shared across books.
