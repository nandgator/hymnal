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
2. Load the text in the app (Library) and read the review: every song, every
   part, the sung order. Fix the text, never the review, and load again.
3. Keep your source text next to the result, so the source check can compare
   them.

Nothing here uploads anything. Books are built and loaded on your own device,
and there is no public catalogue
([ADR-0026](../decisions/0026-songs-leave-the-repository.md)).

## How to check it

**Today.** The text parser is not in the app yet (Board #34). What exists is the
check on format 1 itself. If you have written the format 1 files (a directory of
`hymnbook.json` and `NNNN.json`, as in `sample.md`), pack them and load the
result in the app:

```sh
bun run pack path/to/my-book
```

`pack` validates the book first. A broken book is listed violation by violation
and nothing is written; a good one becomes `<id>.hymnbook.json.gz` in
`imports/`. In the app, open the Library and load that file. The review shows
what will be stored before anything is.

**After Board #34.** Paste or load the song text in the Library. The app parses
it, lists every error with its line number, and, when there are none, shows the
same review. The same parser runs in the command line.

**The source check (coming, Board #34).** A local check, with no model, that
compares the text you started from with the result and lists two things:

- lines of the result that are not in the source (**added or altered**), such as
  a modernised word or an invented chorus;
- lines of the source that are not in the result (**dropped**), such as a
  missing stanza.

It is optional. A book loaded without a source is marked "not checked against a
source" in the review. It reports and you decide: it cannot tell a dropped
stanza from a deliberate cut. Until it exists, read the review against your
source by eye, and be most careful with a book that went through an AI.

## What is not here

- Sharing. There is no upload and no catalogue; the rights to most songbooks are
  not the project's to give.
- Bulk and whole-book imports from a PDF or a deck. That is the profile
  pipeline, `bun run import`, for technical contributors
  ([SDD-0003](../design/0003-song-import.md)).
- Chords, timings, translations. Format 1 has no place for them.
