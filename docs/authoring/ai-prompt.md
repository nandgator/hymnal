# A prompt for your own AI

Hymnal has no AI in it, and never calls one. No model sits between your text and
your device, and the app has no key, endpoint or setting for one
([ADR-0029](../decisions/0029-others-build-their-books-the-format-is-the-contract.md)).
If you choose to use an AI of your own to turn a songbook into the
[song text format](text-format.md), this prompt is one way to ask. What it
produces is only text; the app parses it, lists every error, and shows you the
result before storing anything.

## Read this first: privacy

**Pasting lyrics into a hosted AI sends them to that provider.** It is your
choice, and it may matter: a songbook that is under copyright is not yours to
hand to a third party, and many services keep or learn from what they are sent.
Check the provider's terms. A model that runs on your own machine keeps the text
on it. Hymnal makes no call on your behalf and cannot see what you do outside
the app.

## Check the result

An AI is a source of silent edits: a modernised word, a smoothed line, a stanza
that was never there. The prompt below asks it not to, and you should not rely
on that. Keep your source, load the result, and compare (see
[how to check it](README.md#how-to-check-it)). The source check, when it is in
the app, lists the lines that were added, altered or dropped.

## The prompt

Paste this, then your text after the last line.

```text
Convert the songs I paste below into the "song text format" described here. Your
whole reply must be the converted text and nothing else: no introduction, no
explanation, no code fence.

THE FORMAT
- One song, or several separated by a line of three hyphens (---).
- The first line of a song is its number and title as printed, for example:
  12. Amazing Grace
- Directly under it, optional lines (no blank line between), only when the
  source prints them: Author: ..., Tune: ..., Meter: ...
- Then blocks, each separated by one blank line. One block is one stanza, or
  one chorus. One printed line is one line of the block.
- A stanza is just its lines. Do not number it; the numbering is automatic.
- A chorus or refrain starts with a line that is only: Chorus:
  and then its lines. If the source calls it Refrain, write Refrain:
- When the source tells the singer to repeat the chorus (the word "Chorus" or
  "Refrain" alone, or "(Repeat chorus)"), write the label alone, as a block of
  one line: Chorus:
  Do not copy the chorus's words out again.
- Other labels you may use, only if the source has such a part: Bridge:,
  Pre-chorus:, Post-chorus:, Intro:, Outro:, Tag:
- If, and only if, the source states the order in which the parts are sung in
  a way the layout above does not show, add a line: Sequence: Verse 1 Chorus
  Verse 2 Chorus
- A line that begins with # is a comment for me. It is not part of the song.

THE RULES
1. Keep every word exactly as printed. Do not modernise, correct, normalise,
   translate or improve anything: not spelling, not punctuation, not
   capitalisation, not old forms such as "Thee" or "'Twas", not apparent
   typing errors.
2. Never invent a chorus, a stanza, a line, a title, an author or a tune. If
   the source does not print it, it is not there.
3. Never drop or merge anything: every stanza, every line, in the printed
   order. Keep the line breaks as printed; do not re-wrap lines.
4. Leave out only what is not lyrics: page numbers, running heads, and the
   like.
5. When you are unsure about anything (an unreadable word, a stanza that might
   be a chorus, a missing number, which stanza a chorus belongs to, whether a
   line is a heading), do not guess. Write what you can read, and on the line
   above it put a comment, for example:
   # CHECK: the word after "grace" is unclear in the source
6. If the source is not a song, or you cannot tell where a song starts, say so
   in a comment line and convert nothing.

Here is the text:
```

## After you get the reply

Read it against your source. Search the comments (`# CHECK`) first, and settle
each one by hand. Then load the text, as described in
[how to check it](README.md#how-to-check-it). If the app reports an error, it
gives the line number; fix the text, or ask the AI again with the error pasted
in, and load it again. A fix is always made in the text, never in the review.
