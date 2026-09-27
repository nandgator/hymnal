# 0025 — Call it the chorus

- **Status:** Accepted
- **Date:** 2026-09-27

## Context and Problem Statement

The part sung between verses has been called the **refrain** everywhere:
on the keypad, in the lyrics, in the Output's cue to the congregation, on
the **R** key, and in the content format, where its kind sits between
`pre-chorus` and `post-chorus`. The people who use Hymnal say **chorus**,
and so do the books: _Hymns of Fellowship_ labels it "Chorus", and the
importer maps that label to `refrain`.

Format 1 ([SDD-0002](../design/0002-content-format.md),
[ADR-0022](0022-publish-a-json-schema-for-the-format.md)) was published
this week and nothing outside this repository reads it yet, so renaming it
now costs the least it ever will.

## Considered Options

- **The screen only**: every word a person reads becomes "chorus"; the
  data keeps `refrain`
- **Everywhere**: the screen, the key, the code and the format

## Decision Outcome

Chosen: **everywhere.**

- **The part kind is `chorus`**: the kinds read `intro`, `stanza`,
  `pre-chorus`, `chorus`, `post-chorus`, `bridge`, `outro`, `tag`. Format 1
  and its JSON Schema change in place, not to a format 2, since no file
  outside this repository uses them; the 1,188 songs that had a refrain
  are rewritten by a one-off substitution of that value, not regenerated
  ([ADR-0009](0009-migrate-the-corpus-by-rule.md)).
- **On screen** it is the Chorus: the keypad, the lyrics' headings, the
  Output's cue, Settings ("Pin the chorus").
- **The key is C.** R is free again.
- **The code says chorus too**, so no name is left that the app never
  shows. ADRs already written keep their wording; this record supersedes
  the word.
- **Stored preferences:** `pinRefrain` becomes `pinChorus`; a device's
  saved value is read under the old name once and not written back.
- **Installed songbooks:** the content schema goes to version 2. A device
  holding an older copy (version 1, with `refrain`) replaces it from the
  app's own bundled one; only a copy newer than the app still says the app
  needs an update.

### Consequences

Good:

- The words match what people sing and what the books print; the kinds
  read as one family.
- An installed songbook no longer strands a device when the app ships a
  newer schema.

Bad:

- Anyone who learned R relearns C.
- A large, mechanical diff across the content.

Neutral:

- An older document written as format 1 with `refrain` no longer
  validates. None exist outside this repository.
