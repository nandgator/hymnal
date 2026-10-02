# Authoring kit

For anyone who wants a book of their own in Hymnal and is not the maintainer
([ADR-0029](../decisions/0029-others-build-their-books-the-format-is-the-contract.md)).
Hymnal does not convert songbooks for you. It loads a file in **format 1**
([SDD-0002](../design/0002-content-format.md)), checks it, and shows it to you
read-only before anything is stored. This kit is the easy way to make that file:
write your songs as plain text, and a deterministic parser turns the text into
format 1.

The kit is versioned with the format. This is **text format 1**, which maps to
content format 1. A change to either is a new version.

| Document                           | What it is                                      |
| ---------------------------------- | ----------------------------------------------- |
| [`text-format.md`](text-format.md) | The song text format: the exact rules           |
| [`ai-prompt.md`](ai-prompt.md)     | A prompt for your own AI, and a privacy note    |
| [`sample.md`](sample.md)           | Three public-domain hymns, as text and as JSON  |
| this page                          | How to check the result, and what is not yet in |

## The short version

1. Get your songs into the text format: type or paste them by hand, or use an AI
   of your own choosing with the prompt in `ai-prompt.md`.
2. Run it through `bun run text` (the Library will take it too) and read the
   review: every song, every part, the sung order. Fix the text, never the
   result, and run it again.
3. Keep your source text next to the result, so the source check can compare
   them.

Nothing here uploads anything. Books are built and loaded on your own device,
and there is no public catalogue
([ADR-0026](../decisions/0026-songs-leave-the-repository.md)).

## How to check it

**In the command line.** `bun run text` runs the parser and the source check
(the same code the app will run). Give it your song text and the book's own
fields, which are never guessed from the text:

```sh
bun run text my-songs.txt --id my-book --title "My book" \
  --language en --script Latn --source my-source.txt
```

If the text has errors, each is listed with its line number and nothing is
written. Otherwise it writes `imports/my-book/` (`hymnbook.json` and the
`NNNN.json` files; `--out` changes `imports`), prints any note about a sung
order it had to take as printed, and, with `--source`, the source check below. A
single song whose first line has no number takes `--number`. Then pack the
directory and load the result in the app:

```sh
bun run pack imports/my-book
```

`pack` validates the book first. A broken book is listed violation by violation
and nothing is written; a good one becomes `<id>.hymnbook.json.gz` in
`imports/`. In the app, open the Library and load that file. The review shows
what will be stored before anything is. If you wrote the format 1 files by hand,
skip the first step and pack their directory.

**In the app (coming, Board #34).** Paste or load the song text in the Library.
The app parses it, lists every error with its line number, and, when there are
none, shows the same review.

**The source check.** A local check, with no model, that compares the text you
started from with the result and lists two things:

- lines of the result that are not in the source (**added or altered**), such as
  a modernised word or an invented chorus, with the song, part and line;
- lines of the source that are not in the result (**dropped**), such as a
  missing stanza, with their line numbers in the source.

Lines are compared after Unicode NFC, whitespace and the quote and dash forms
are normalised, and nothing else: a changed word is reported. Each source line
explains at most one result line, so a chorus the result holds twice but the
source printed once is listed; and a chorus the source prints in full each time,
which the result holds once, is listed as dropped. Labels, details, `Sequence:`
and comment lines of the source are not lyrics and are not listed. In a book of
several songs, locations are approximate, because lines are matched across the
whole source. Page numbers and headings are, and that is fine: it is a list for
a person to read.

It is optional (`--source`; a book loaded without one is marked "not checked
against a source" in the review). It reports and you decide: it cannot tell a
dropped stanza from a deliberate cut, and it exits 1 when it finds differences,
so fix the text and run it again. Be most careful with a book that went through
an AI.

## What is not here

- Sharing. There is no upload and no catalogue; the rights to most songbooks are
  not the project's to give.
- Bulk and whole-book imports from a PDF or a deck. That is the profile
  pipeline, `bun run import`, for technical contributors
  ([SDD-0003](../design/0003-song-import.md)).
- Chords, timings, translations. Format 1 has no place for them.
