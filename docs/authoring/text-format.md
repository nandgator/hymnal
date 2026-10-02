# Song text format, version 1

**Text format 1** writes songs as a person would type them. A deterministic
parser turns it into content format 1
([SDD-0002](../design/0002-content-format.md)) with no judgement: a line it
cannot place is an error with its line number, never a guess, and nothing is
repaired. Decision:
[ADR-0029](../decisions/0029-others-build-their-books-the-format-is-the-contract.md).
The parser itself (`src/import/songtext.ts`, run by `bun run text`) follows this
document; where they differ, this document is the bug report.

A worked file is in [`sample.md`](sample.md).

## 1. The file

- Plain UTF-8 text. A leading byte-order mark is ignored. `\r\n` and `\r` are
  read as `\n`.
- Whitespace at both ends of a line is ignored; inside a line it is kept as
  written. Blank lines at the ends of a song are ignored.
- A **comment line** is a line whose first non-blank character is `#`. It is
  ignored everywhere (it is not a blank line, and does not end a block), and is
  there for notes to yourself, such as `# CHECK: second line unclear in scan`. A
  lyric line that begins with `#` cannot be written.
- A file holds one song, or a book of them, with a line of three or more hyphens
  (`---`) alone between songs. A `---` with nothing after it at the end of the
  file is ignored.
- Line numbers in errors count lines of the file as given, comments and blank
  lines included, from 1.

## 2. A song

A song is, in order: the title line, optional details, then blocks.

### 2.1 The title line

The first line of a song (comments aside) is its number and title:

```text
12. Amazing Grace
12) Amazing Grace
12 Amazing Grace
```

The number is the hymn's number as printed: digits, a value of 1 or more.
Numbers are unique in the file. The title is the rest of the line, as written;
it must not be empty. There is no first-line fallback: the author writes the
title.

When the file holds one song and its first line has no number, the number is
asked for at the call (the app's field, the command line's `--number`). In a
book, every song must carry a number. A title that starts with digits and a
space, such as `1 2 3 Jesus Loves Me`, is read as number 1; write the number
explicitly.

### 2.2 Details

Directly after the title, with no blank line between, lines of the form

```text
Author: John Newton
Tune: New Britain
Meter: 8.6.8.6
```

set `meta.author`, `meta.tune` and `meta.meter`. The key is matched without
regard to case; the value is the rest of the line, trimmed, and must not be
empty. Each key appears at most once. All are optional. The details end at the
first blank line. A line in this position that is not one of these keys, or
`Sequence:` (section 2.5), is an error: **no other key is accepted.**

### 2.3 Blocks and labels

The rest of the song is blocks, separated by one or more blank lines. Each line
in a block is one displayed line (one `lines` entry). The parser never joins or
splits lines: if a source is hard-wrapped differently from how it is sung, the
author fixes the line breaks.

A block whose first line is a **label** (a line that ends in a colon, with
nothing after it) is that kind of part; the remaining lines are its text. The
label's first word is matched without regard to case:

| Label word              | Kind          |
| ----------------------- | ------------- |
| `Chorus`, `Refrain`     | `chorus`      |
| `Verse`, `Stanza`       | `stanza`      |
| `Pre-chorus`            | `pre-chorus`  |
| `Post-chorus`           | `post-chorus` |
| `Bridge`                | `bridge`      |
| `Intro`, `Outro`, `Tag` | the same kind |

Anything after the word, up to the colon, is the part's `label`, trimmed:
`Verse 3:` is a stanza labelled `3`; `Chorus 2:` is a chorus labelled `2`;
`Bridge:` is a bridge with no label. These are the kinds of SDD-0002 section 3.
A label word outside the table is an error, so that a typo such as `Chrous:` is
not silently read as a stanza. (A lyric line that ends in a colon, as the first
line of a block, is therefore also an error; see the open points.)

**Unlabelled blocks are stanzas.** They are labelled `1`, `2`, ... in the order
printed, skipping any number that a `Verse N:` block takes explicitly, wherever
in the song it is. `Verse:` with lines and no number is an unlabelled stanza.
Two parts of the same kind with the same label, or both with none, are an error;
a song with two choruses writes `Chorus 1:` and `Chorus 2:`.

### 2.4 References

A label alone, with no lines under it (a blank line or the end of the song
follows), is not a part. It is that part **sung again at this place**, as a
printed hymnal prints "Chorus" after a stanza:

```text
Verse 1:
Alas! and did my Saviour bleed,
And did my Sovereign die?

Chorus:
```

It must name a part printed in the song, before or after, by kind and label
(`Chorus 2:` when there are several). A bare `Chorus:` names the song's only
chorus. A reference to nothing, or a bare one with several candidates, is an
error. A reference takes no text of its own.

### 2.5 Sequence

An optional line

```text
Sequence: Verse 1 Chorus Verse 2 Chorus
```

gives the sung order. It stands in the details, or alone as a one-line block
before the first part. At most one per song.

The value is a list of entries separated by spaces. An entry is a label as above
without the colon, case-insensitive: `Verse 1`, `Stanza 2`, `Chorus`,
`Chorus 2`, `Bridge`; or a bare number, which is the stanza with that label. The
words are read greedily: a kind word followed by a token takes the token as its
label if a part of that kind with that label exists; otherwise the kind word
stands alone and the token is the next entry. So with one unlabelled chorus,
`1 Chorus 2 Chorus 3 Chorus` is stanza 1, chorus, stanza 2, chorus, stanza 3,
chorus. A kind word standing alone must name exactly one part of that kind.

Each entry must name a part, or it is an error. A part may appear any number of
times. **Every part must appear at least once**: format 1 refuses a part that is
never sung (SDD-0001 invariant I5), and so does the parser. To leave a part out,
delete it from the text. The Sequence line wins over the default rule below.

### 2.6 The default sequence

With no Sequence line, the sung order is:

1. **The song has references:** the order as printed, each reference being the
   part it names.
2. **No references, and no chorus:** the order as printed.
3. **No references, one chorus, and no pre-chorus or post-chorus** (the rule of
   SDD-0003 section 3, from ADR-0009): the chorus is sung first if it is printed
   first, and after every stanza and bridge. An intro is first, and an outro and
   a tag last, where printed.
4. **Anything else** (several choruses, or a pre-chorus or post-chorus, with no
   references and no Sequence line): the order as printed, and the review says
   so, so that you can add a Sequence line if it is wrong.

## 3. What it becomes

A song is `NNNN.json` of format 1, with `number`, `title`, `meta` (`{}` if there
were no details), `parts` and `sequence`.

- Each block that is not a reference is a part, in printed order. Its `kind` and
  `label` are from section 2.3; its `lines` are the block's lines. Its `id` is
  assigned by the parser, by kind and count: `s1`, `s2`, ... for stanzas, `c1`
  for choruses, `b` bridges, `i` intros, `o` outros, `t` tags, `p` pre-choruses,
  `q` post-choruses. An id means nothing outside its hymn.
- The `sequence` is a list of `{ "partId": ... }`, from section 2.5 or 2.6.
- A file with several songs is also a book, and needs the book's own fields,
  asked for at the call and never guessed from the text: `id`, `title`,
  `language` (BCP-47) and `script` (ISO 15924). `format` is 1 and `hymnCount` is
  the number of songs. The result is a book the validator accepts or rejects
  whole.

## 4. Errors

The parser reports every error it finds, each with its line number, and writes
nothing if there is any. It never repairs, guesses or skips. The errors:

| Line number is  | Error                                                          |
| --------------- | -------------------------------------------------------------- |
| the title line  | no number in a book; number 0; number used twice; empty title  |
| the line        | a detail with an empty value, or a key given twice             |
| the line        | a line after the title that is not a detail, before a blank    |
| the label line  | a label word not in the table                                  |
| the label line  | the same kind and label as an earlier part                     |
| the reference   | it names no part, or too many (bare, with several candidates)  |
| the sequence    | an entry that names no part or is ambiguous; a second Sequence |
| the part's line | a part that no sequence entry names (its first line)           |
| the `---` line  | an empty song between two separators, or before the first one  |
| line 1          | a file with no song in it                                      |
| the title line  | a number that is not a whole number, 1 or more (and below 2⁵³) |

Then the book-level rules of SDD-0002 section 4 apply to the result, as they do
to any format 1 book.

## 5. Open points

- A first line of a block that is a lyric ending in a colon is read as a label
  and refused. A way to write one (an escape) is not specified; if a real hymn
  needs it, it is a change to this format.
- Chords, repeat marks and directions have no place in this format or in format
  1. A source's `(x2)` or `(ladies)` is either left in the line as lyric or
     taken out by the author; the parser does neither.
