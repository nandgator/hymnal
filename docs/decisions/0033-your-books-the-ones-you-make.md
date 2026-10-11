# 0033 — Your books: the books you make grow, the books you receive do not

- **Status:** Accepted
- **Date:** 2026-10-11
- **Decided:** by the maintainer, in review of From Text and Assorted Hymns
- **Supersedes:** [ADR-0031](0031-assorted-hymns-the-persons-own-book.md)

## Context and Problem Statement

ADR-0031 made Assorted Hymns one special book per device, so that a single song
needs no book of its own with an invented id and title. From Text kept a second
mode beside it, A New Book, which makes a fixed book with its own id, title and
language. In use the two modes read as two products: a person can make a book
called Assorted Hymns from text and has two of them, cannot add a song to a book
they made last week, and cannot name their one growable book.

The line that matters is not one book against many. It is who made the book. A
book received from someone (a package, a `.hymnbook.json.gz`) is an edition: a
content hash, rights per book, and an export as that edition (Board #24). A book
the person made from text has none of that to keep.

## Considered Options

- **Keep ADR-0031**, and fix only the form
- **Every book takes songs**, received ones too
- **Your books**: the books you make grow; the books you receive do not

## Decision Outcome

Chosen: **your books.**

1. **Two kinds of book.** A book you **received** (kind `shipped` or `loaded`)
   is fixed, as now. A book you **made** (kind `own`) grows: songs are added and
   removed, it can be renamed, and you can make any number. Kind `own` replaces
   kind `assorted`.
2. **Mixed languages, always.** Every book you make is language `mul` and script
   `Zyyy`; each song keeps its own language and script (schema version 4, as
   ADR-0031 §2). A book you make has no id field: its key is its id.
3. **Assorted Hymns is the default, not a special case.** It is the book you
   make first, by adding a song with nothing chosen, under origin `assorted`;
   any other book you make has origin `own`. It can be renamed and removed like
   any of your books, and the next song with nothing chosen makes it again.
4. **One form.** From Text has no modes. It asks **Add to**, a picker of your
   books with **New book…** last, defaulting to the book last added to, else
   Assorted Hymns; then the songs' language and script, and the text. New book…
   adds one field, the name, filled with a suggestion. One song or many, they go
   to the book picked.
5. **Numbers.** A number written in the text is kept when the book has it free;
   a song with none takes the book's next number. A number already held or
   retired in that book is an error on its line. A number is never reused
   (ADR-0031 §3).
6. **Order, removal and restore as ADR-0031**, per book: the sorted view, a
   retired number per removal, the last song taking the book with it. A restored
   book you made merges into the device's book of the same key, and the backup's
   Assorted Hymns (origin `assorted`) into the device's; any other is restored
   beside them.
7. **Books already made from text stay as they are.** A book From Text made
   before this is kind `loaded` and fixed. Nothing is migrated: the person can
   re-add its text to a book of their own.

### Consequences

- Good: one form and one idea, "add songs to one of my books"; the book received
  from a publisher cannot drift from its source.
- Good: everything ADR-0031 built (schema version 4, the add and remove paths,
  the merge) is kept and widened from one book to several.
- Bad: the registry's `CHECK` and the restore merge change (registry version 3),
  and every `assorted` special case in the code becomes a per-book one.
- Bad: From Text no longer makes a fixed, shareable book with an id. That stays
  the CLI's job (`bun run text`, `bun run pack`, ADR-0029) until #24 exports a
  book you made.
