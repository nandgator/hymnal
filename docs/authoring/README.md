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
2. Run it through `bun run text` (or the Library's From Text) and read the
   review: every song, every part, the sung order. Fix the text, never the
   result, and run it again.
3. Keep your source text next to the result, and read the result against it
   before you load it.

Nothing here uploads anything. Books are built and loaded on your own device,
and there is no public catalogue
([ADR-0026](../decisions/0026-songs-leave-the-repository.md)).

## How to check it

**In the command line.** `bun run text` runs the parser (the same code the app
runs). Give it your song text and the book's own fields, which are never guessed
from the text:

```sh
bun run text my-songs.txt --id my-book --title "My book" \
  --language en --script Latn
```

If the text has errors, each is listed with its line number and nothing is
written. Otherwise it writes `imports/my-book/` (`hymnbook.json` and the
`NNNN.json` files; `--out` changes `imports`) and prints any note about a sung
order it had to take as printed. A single song whose first line has no number
takes `--number`. The id is letters, digits, `-` and `_`. A directory that
already holds an import draft (a `report.md`) is refused unless you add
`--force`; a re-run replaces only `hymnbook.json` and the `NNNN.json` files.
Then pack the directory and load the result in the app:

```sh
bun run pack imports/my-book
```

`pack` validates the book first. A broken book is listed violation by violation
and nothing is written; a good one becomes `<id>.hymnbook.json.gz` in
`imports/`. In the app, open the Library and load that file. The review shows
what will be stored before anything is. If you wrote the format 1 files by hand,
skip the first step and pack their directory.

**In the app.** In the Library, **From Text** opens a sheet. Fill in the book's
title, language and script (they are never guessed; the language is picked by
name, and the id, made from the title, is under Advanced where you can change
it), then paste the song text or open one or more `.txt` files (several are
joined with `---`). **Review the Book** parses the text: every error is listed
with its line number and nothing is stored. When there are none you get the same
review a loaded file gets, and the same buttons. Nothing is stored until you
press one, and nothing leaves your device.

**Read it against your original.** Hymnal has no check of the result against the
text you started from. Whoever used an AI must read the result against their
original before loading it: look for a modernised word, a smoothed line, an
invented chorus and a missing stanza, song by song. The review shows what will
be stored, and that is what to read. Be most careful with a book that went
through an AI. (An earlier version had a source check, `--source`; the
maintainer withdrew it on 2026-10-07 because it reassured falsely and raised
false alarms,
[ADR-0029](../decisions/0029-others-build-their-books-the-format-is-the-contract.md).)

## What is not here

- Sharing. There is no upload and no catalogue; the rights to most songbooks are
  not the project's to give.
- Bulk and whole-book imports from a PDF or a deck. That is the profile
  pipeline, `bun run import`, for technical contributors
  ([SDD-0003](../design/0003-song-import.md)).
- Chords, timings, translations. Format 1 has no place for them.
