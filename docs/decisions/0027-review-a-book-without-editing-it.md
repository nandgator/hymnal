# 0027 — Review a book without editing it

- **Status:** Accepted
- **Date:** 2026-10-02

## Context and Problem Statement

[ADR-0018](0018-import-songs-through-a-layout-aware-pipeline.md) and
[ADR-0020](0020-present-songs-do-not-publish-them.md) both say that loading a
book in the browser needs a review screen, which arc42 §3.3 still defers as
"in-app content editing", and that it will need its own ADR. Board #28 loads
books. A file picked by hand can be the wrong file, a book already held, or a
book that breaks the format's rules, and the user should see which before
anything is stored.

What a review must show is not in question: what the file is, whether it is
valid, and what loading it would do. What is open is whether it may also change
the book.

## Considered Options

- **No review:** load what is picked, and say afterwards
- **Review with editing:** the summary, plus fixing titles, lines and sequences
  before they are stored
- **Review without editing:** a read-only summary, then load or cancel

## Decision Outcome

Chosen, by the maintainer: **review without editing.** Before a file is stored,
the app shows a summary and changes nothing until the user confirms:

- the book's **title and language**, and how many songs it holds
- its **violations**, if any: a book that breaks any rule of format 1 is
  **rejected whole**, with every violation listed
  ([arc42 §8.6](../architecture/arc42.md#86-handling-imperfect-content),
  [SDD-0002 §4](../design/0002-content-format.md#4-rules)), and nothing is
  repaired
- the **duplicate verdict**
  ([ADR-0021](0021-identify-books-by-the-store-that-holds-them.md)): the file is
  held already, the songs are, the book is another edition of one held, or it is
  new; and how many of its songs are held in other books

It is read-only. A wrong word is corrected where the book is made, and the file
loaded again: the same origin with different content is what the Replace choice
is for. This amends arc42 §3.3 from "no in-app content editing" to **review
without edit**: the app reads and shows a book, never changes one.

Skipping the review loads a wrong file without a word, hides the duplicate
verdict until it is too late to choose, and puts the rejection after the write.
Editing is a different product: it needs undo, a draft state, a place to keep
the changes when a file is loaded again, and a way to say which edits survive.
The Board's authoring item (#14) is where that belongs, once hand-editing is the
bottleneck ([the open question](README.md#open-questions)).

### Consequences

Good:

- A bad file is stopped before it touches the store, with every reason shown.
- The user chooses on duplicates knowing what each choice does.
- The app still has one writer of lyrics, the tool that made the book.

Bad:

- A typo seen in review can't be fixed there. The file is fixed at its source
  and loaded again.
- A summary says nothing about quality. Whether the lyrics are right is judged
  by the person who made the book.

Neutral:

- Songs are not listed in the summary. A book that is loaded is browsed in the
  Finder, as any other.
