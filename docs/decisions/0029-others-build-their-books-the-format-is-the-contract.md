# 0029 — Others build their books: the format is the contract

- **Status:** Accepted
- **Date:** 2026-10-02

## Context and Problem Statement

Every book so far came through the maintainer. The profile pipeline
([ADR-0018](0018-import-songs-through-a-layout-aware-pipeline.md),
[ADR-0024](0024-import-case-by-case.md), SDD-0003) turns a PDF or a deck into
format 1 with a profile written per book. It works, and it does not scale to a
church that has a songbook in a Word file, a spreadsheet, or a pile of
photographed pages: each needs a profile or a script, from the one person who
can write them.

The pieces for a different arrangement exist. The app loads format 1 only
([ADR-0024](0024-import-case-by-case.md)), from a file on the device, into the
device's own store ([ADR-0026](0026-songs-leave-the-repository.md),
[ADR-0021](0021-identify-books-by-the-store-that-holds-them.md)), validates it,
rejects a bad book whole with every violation listed, and shows a read-only
review before storing anything
([ADR-0027](0027-review-a-book-without-editing-it.md), Board #28). The format
has a published JSON Schema
([ADR-0022](0022-publish-a-json-schema-for-the-format.md)) and a written
specification ([SDD-0002](../design/0002-content-format.md)). What is missing is
a way for someone who is not the maintainer, and has no PDF profile, to make
that file.

The obvious tool is a language model: paste the lyrics, ask for format 1. This
record has to say what part such a tool may play without breaking the standing
rule that no LLM is a stage of the import pipeline and that lyrics stay on the
device (PLAN, Board #27; [ADR-0020](0020-present-songs-do-not-publish-them.md)).
It does not touch sharing, rights, or the authoring UI.

### What the existing formats offer (checked 2026-10-02)

**ChordPro** is a plain-text format: lyric lines with chords in brackets, and
directives in braces. It has `{title: …}` and the metadata directives,
`{start_of_verse}`/`{end_of_verse}`, `{start_of_chorus}`/`{end_of_chorus}` (and
`{chorus}` to put a chorus again), `{comment}`, and attributes such as
`{start_of_verse label="Verse 1"}`. It describes how a song is laid out on a
page for musicians, and it has no sung-order sequence: repeats are written out,
or a `{chorus}` is placed where it recurs
([directives](https://www.chordpro.org/chordpro/chordpro-directives/)). It is
what a person might type, but a stanza's bounds are directives, not blank lines,
and its chords are noise to Hymnal.

**OpenLyrics** is XML for presentation software (it came from OpenLP). A song
has `<properties>` (titles, authors) and `<lyrics>` of `<verse name="v1">` with
`<lines>`; the name carries a type (`i`, `v`, `p`, `c`, `s`, `b`, `m`, `o`,
`e`), and a `<verseOrder>` such as `v1 c v2 c` gives the sung order
([data format](https://docs.openlyrics.org/en/latest/dataformat.html)). Its
model is close to ours: parts and a sequence of them (ADR-0003). It is an
interchange format, not a thing to type, and one file holds one song; it has no
book, hymn number or label for a stanza. Board #24 plans it as export and import
in Phase 2, mapped to format 1, and the mapping of its types to our kinds is
that item's work.

## Considered Options

- **The maintainer converts every songbook**, as today
- **A language model writes format 1 directly**, from pasted lyrics, with the
  schema as the guide
- **A hosted converter service** that takes a file and returns a book
- **ChordPro or OpenLyrics as the input format**, read by a parser to format 1
- **The format is the contract, with two ways in:** the profile pipeline for
  bulk, a plain song text format for everyone else, and AI as the user's own
  tool, checked locally

## Decision Outcome

Chosen (proposed): **the format is the contract.** Hymnal does not convert every
songbook; anything that produces valid format 1 can be loaded.

1. **The maintainer is not the converter for every book.** Format 1
   ([SDD-0002](../design/0002-content-format.md) and its JSON Schema) is the
   contract. A file that is valid format 1, from any tool or by hand, is loaded
   on a device, where it is validated and reviewed read-only (ADR-0027, Board
   #28). The app does not care how it was made.
2. **Two paths in.**
   - **a. Bulk and whole-book imports keep the profile pipeline**:
     `bun run import`, a profile per book, local judges, and Laya (SDD-0003
     §4.1) if a report earns it. It is for technical contributors and the
     maintainer. Documented, not packaged as a public installer.
   - **b. A light path for everyone: a plain song text format and a
     deterministic parser** to format 1, in the app (Library: paste or load
     text) and in the CLI. Specified below.
3. **AI is the user's own tool, never a stage of our pipeline.** The standing
   rule is kept: no LLM in the import pipeline, local judges only, lyrics stay
   on the device. Someone may use a model of their choosing to turn their text
   into the song text format; Hymnal supplies an **authoring kit** for that,
   versioned with the format: the text format's specification, one prompt
   template, a sample, and "load it in the app to check". The docs say plainly
   that pasting lyrics into a hosted AI **sends them to that provider**. That is
   the user's choice, and may matter for a copyrighted book. Hymnal never makes
   that call, and has no key, endpoint or setting for one.
4. **A local, deterministic source check** compares the source text with the
   result, so that an AI's or a person's silent edits are caught. See below.
5. **Sharing stays out of scope.** Books are built and loaded on the user's own
   device (ADR-0026). There is no public catalogue and no upload: the rights to
   most songbooks are not the project's to give (arc42 R2).
6. **Order:** the authoring kit (docs) first; then the text parser and the
   source check in the app; then the same in the CLI; the CMS (Board #14) and
   Laya later, if hand-editing or the reports show a need.

Why this and not the options: the maintainer converting everything makes one
person the whole catalogue and fails the first time he is away. The format
already exists, is versioned, validated and reviewed, so the cheapest way to let
others in is to make producing it easy and checking it honest. A route that
needs a model to reach a book, or a server, would break the rule the project is
built on. The text format keeps the user's step to something a person can do
without a model, and a model can do too.

### The song text format (first draft)

A plain UTF-8 text file. It describes songs as a person would type them; the
parser turns it into format 1 with no judgement, and a line it cannot place is
an error with its line number, never a guess. This is a first draft: the
specification, with the exact grammar and test cases, becomes a SDD when the
authoring kit is written, and format 1 itself is untouched.

**Songs.** A file holds one song, or a book of them, with a line of three or
more hyphens (`---`) alone between songs. Whitespace at the ends of lines and
blank lines at the ends of a song are ignored; line endings are normalised.

**The title line.** The first line of a song is its number and title:
`12. Amazing Grace`, `12) Amazing Grace` or `12 Amazing Grace`. The number is
the hymn's number as printed (an integer, 1 or more, unique in the file). When
the file holds one song and the first line has no number, the parser asks for
one at the call (the app's field, the CLI's `--number`), and a book's songs must
all be numbered. The title is the rest of the line; there is no first-line
fallback (SDD-0003's rule for books that print none belongs to the importer;
here the author writes the title).

**Details.** Directly after the title, lines of the form `Author: …`, `Tune: …`,
`Meter: …` set `meta.author`, `meta.tune`, `meta.meter`. They are optional and
end at the first blank line. No other key is accepted.

**Blocks.** The rest of the song is blocks separated by one or more blank lines.
Each line in a block is one displayed line (`lines` entry); the parser never
joins or splits lines, so a hard-wrapped source is wrapped by the author or an
authoring tool, not by the parser.

**Labels.** A block whose first line is a label ending in a colon, and nothing
else on that line, is that kind of part, the remaining lines being its text:

| Label (any case)           | Kind          | `label` in the part |
| -------------------------- | ------------- | ------------------- |
| `Chorus:` or `Refrain:`    | `chorus`      | absent              |
| `Verse:`, `Stanza:`        | `stanza`      | the number, below   |
| `Pre-chorus:`              | `pre-chorus`  | absent              |
| `Post-chorus:`             | `post-chorus` | absent              |
| `Bridge:`                  | `bridge`      | as written, if any  |
| `Intro:`, `Outro:`, `Tag:` | the same kind | absent              |

A number or name after the word is kept as the part's `label` (`Verse 3:` is a
stanza labelled `3`; `Bridge 2:` is a bridge labelled `2`). The words are the
kinds of SDD-0002 §3; no label outside that table is accepted, so a typo is an
error, not a stanza.

**Unlabelled blocks are stanzas**, labelled `1`, `2`, … in order, skipping any
number a `Verse N:` block has taken explicitly, and a duplicate label in the
song is an error.

**A reference.** A label alone, with no lines under it (`Chorus:` then a blank
line or the end), is not a part. It is the chorus (or bridge, and so on) sung
again at that place, as printed hymnals do ("Chorus" after a stanza). It must
name a part printed in the song, before or after, and with several of a kind,
its label (`Chorus 2:`).

**Sequence.** An optional line `Sequence: 1 Chorus 2 Chorus 3 Chorus` after the
details, or on its own line before the first block, gives the sung order, as the
words of the labels above (`Verse 1`, `1`, `Chorus`, `Chorus 2`, `Bridge`,
case-insensitive, space-separated). Each must name a part; an unknown word is an
error. A part may appear any number of times, and a part not named is not sung.
(Amended 2026-10-02: every part must be sung, as invariant I5 requires; text
format 1 in `docs/authoring/text-format.md` is the spec where it and this draft
differ.) The line wins over everything below.

**How it maps to format 1.**

- A song becomes a `NNNN.json`: `number`, `title`, `meta`, `parts`, `sequence`.
  A file of several songs also needs the book's own fields (`id`, `title`,
  `language`, `script`), asked for at the call, never guessed from the text; the
  result is a book that `validate.ts` accepts or rejects whole.
- Each block becomes a part in printed order. Its `id` is assigned by the parser
  (`s1`, `s2`, …; `c1`; `b1`; `i1`; `o1`; `t1`; `p1`; `q1`) and has no meaning
  outside the hymn. Its `kind` and `label` are from the table. Its `lines` are
  the block's lines.
- The `sequence` is the Sequence line, when given. Otherwise the default
  sequence rule of SDD-0003 §3, as ADR-0009 set it out: if the song's text has
  references, the order is the order as printed, references included (a printed
  chorus reference is the chorus again). If it has none and a single chorus, the
  chorus is sung first if printed first, and after every stanza and bridge; an
  intro is first, an outro and tag last, where printed. With several choruses
  and no references and no Sequence line, the order is as printed, and the app
  says so in the review.

**Example.**

```text
12. Amazing Grace
Author: John Newton
Tune: New Britain

Verse 1:
Amazing grace, how sweet the sound
That saved a wretch like me

Verse 2:
'Twas grace that taught my heart to fear
And grace my fears relieved

Chorus:
My chains are gone, I've been set free

Sequence: 1 Chorus 2 Chorus
```

becomes one hymn with parts `s1` (stanza, label `1`), `s2` (stanza, label `2`),
`c1` (chorus, no label), and `sequence` `s1 c1 s2 c1`. The Sequence line here
states what the default rule would give for a chorus printed last (after every
stanza), so it could be left out; it is there for a song sung otherwise.

The parser lives in `src/import/` as pure TypeScript with no Node or DOM import
(SDD-0003 §1), so the app and the CLI run the same code and agree.

### The source check

Given the source text (what the user pasted or loaded) and the result (a format
1 file, however it was made), the check answers two questions and says nothing
about whether the lyrics are good.

1. **Every result line must appear in the source.** Each line of every part, and
   each title, is looked for in the source after normalisation: Unicode NFC,
   whitespace collapsed and trimmed, and the quote and dash forms folded (curly
   and straight quotes, the dashes). A result line not found is listed as
   **added or altered**, with its hymn and part. Matching is by multiset: a line
   found once in the source may be matched by one result line, so a chorus
   written out twice as parts when the source printed it once, an invented
   chorus, or a stanza repeated, is listed too.
2. **Source lines missing from the result are listed.** Each non-blank source
   line that matches no result line (nor a title, label, detail or sequence line
   the format has a place for) is listed with its line number, as **dropped**: a
   missing stanza, a skipped line. Page numbers and headings will appear here
   and that is fine: it is a list for a person, in order, not a verdict.

The check is local and deterministic, with no model, and is the same code in the
app and the CLI. Normalisation is deliberately narrow: it does not fix spelling,
case or punctuation, so a changed word is reported. It cannot tell a dropped
stanza from a deliberate cut, so it reports and the person decides; the review
stays read-only (ADR-0027), and a fix goes back to the source and is loaded
again. Where the source is a file kept by the user, loading a result and a
source together is a Library step, "check against the source", before the
review's Load button, and optional.

### Consequences

Good:

- A church with a songbook in a document can have a Hymnal book without the
  maintainer, with a text file and a paste, or a model of its own choosing.
- The contract is the format that already has a schema, a validator and a
  review. Nothing new is trusted at load time.
- The rule against an LLM in the pipeline stands, and so does "lyrics stay on
  the device", by Hymnal's own code. The check keeps an AI honest without being
  one.
- A person with no model can type the text format, and no one needs the CLI.
- The profile pipeline stays what it is, for what it does well.

Bad:

- **A second way to write a book to maintain**: a specification, a parser, test
  cases and an authoring kit, versioned with the format. When format 1 changes,
  the text format and the kit change with it, and there are no minor versions to
  absorb it (SDD-0002 §5).
- **The check cannot find a wrong word that is also in the source,** a swapped
  stanza, or a misplaced chorus. It catches edits and drops, not a book that is
  structurally wrong (a stanza that is really a chorus). That is for the review
  and the person.
- **A user who pastes copyrighted lyrics into a hosted AI** has sent them to a
  third party. The docs say so, and Hymnal cannot stop it.
- The parser's strictness will reject what a model or a tired typist writes
  loosely (a label it does not know). That is intended: nothing is repaired, and
  every error carries a line number.
- A default sequence that guesses (the single-chorus rule) can be wrong for a
  song, as the importer's can. The review shows the sequence, and the Sequence
  line fixes it.

Neutral:

- Format 1 is not changed. If the text format later needs a field the format
  lacks (a repeat count, a chord), that is a new format version and its own
  record.
- ADR-0024's "the app imports only format 1" still holds: the text parser makes
  format 1, and what is stored is what it made, never the text.
- Board #24 (OpenLyrics) stays on the Board. This record does not mention
  ChordPro or OpenLyrics in the app; if import of either is wanted, it maps to
  the same format 1 and the same source check.
- Items to add to the Board, in order, by the orchestrator: the authoring kit;
  text parser, Library paste/load and source check; CLI parity.

## Alternatives

**The maintainer converts everything.** Not rejected as a way to start, rejected
as the plan. It makes one person the bottleneck and the only holder of every
book's profile, and it is the status quo this record exists to change. It stays
for books that need a profile.

**A language model writes format 1 directly.** Rejected as the recommended
route. JSON is a poor thing to ask of a model and of a person to check: the
rules that matter (I1–I7, no unknown fields, part ids, a sequence that names
parts) fail in ways that are easy to miss by eye, and the model has little to
hold it to the source's words. The text format is shorter, a person can read and
fix it, and the parser, not the model, owns the JSON. A user can still try to
produce JSON by hand or by model and load it: the validator and the source check
treat it as any other file.

**A hosted converter service.** Rejected. It means uploading lyrics to the
project's server, which ADR-0020 and ADR-0026 exist to avoid, needs a backend
arc42 §2.1 rules out, and is a redistribution channel for text whose rights are
unknown. A service the user runs themselves is a tool, not a Hymnal feature.

**ChordPro or OpenLyrics as the input format.** Not chosen for the light path,
for different reasons. ChordPro is typed by hand and widely known, but it
describes a page for musicians: a stanza's bounds are directives, the sung order
has no place, a hymn number and a book have none, and its chords are noise for
lyrics; a ChordPro file also says a chorus by `{chorus}` where we need a
sequence. OpenLyrics fits the model, parts and a verse order, but it is XML a
person will not type and one song per file, with no book and no number. Neither
makes "paste your text" easier than a title line, blank lines and `Chorus:`,
which is what a printed hymnal looks like. Both are worth reading as imports
later, as Board #24 plans for OpenLyrics, mapped to format 1: this decision does
not close them out, and the text format is chosen so that a ChordPro or
OpenLyrics reader could feed the same source check. Compatibility is open
point 1.

## Open points, answered

The user answered on 2026-10-02, each as recommended:

1. **Text format**: our own; ChordPro and OpenLyrics readers come later, under
   Board #24.
2. **Authoring kit**: in `docs/` first; in-app help links to it later.
3. **No source given**: the source check is optional; a book loaded without one
   is marked "not checked against a source" in the review.
