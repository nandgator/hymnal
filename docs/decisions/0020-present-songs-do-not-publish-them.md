# 0020 — Present songs; don't publish them

- **Status:** Accepted
- **Date:** 2026-09-27

## Context and Problem Statement

The app was framed as a hymnal: a catalogue of hymns it ships and the user
browses. Under that framing it had to hold every book it offers, which puts
the project in the business of redistributing lyrics it has no right to
(arc42 R2, open and blocking any release).

What the app actually does, and does well, is present a song during worship:
in sung order, repeats made legible, followed live. It doesn't need to own
the songs for that. Song import
([ADR-0018](0018-import-songs-through-a-layout-aware-pipeline.md)) lets the
user bring their own, kept on their device.

## Considered Options

- **A catalogue:** the app ships the books, and rights are cleared for each
- **A presentation tool:** the app presents what the user brings, plus
  what ships because it is public domain

## Decision Outcome

Chosen: **a presentation tool.** Hymnal is a vehicle for presenting songs,
drawn from several sources:

- **The user's own imports**, songs or whole books, kept on their device
  and never uploaded. The Library offers the upload (Board #28).
- **Public-domain books and songs that ship with the app** or are offered in
  the Library as samples. Each carries a rights record showing why it's
  free (SDD-0001 §8). The command line importer is how they are made.

**The bundled Malayalam book stays for now.** Its rights aren't established,
and some of its authors are recent. It is decided once per-song rights
records exist: permission from the publisher, its public-domain songs only,
or unbundled so users bring it themselves. R2 stays open until then.

### Consequences

Good:

- Copyright stops blocking the product. Most of what is presented is the
  user's own copy, which never leaves their device.
- Adding a book no longer depends on the project clearing its rights.

Bad:

- The first run is only as good as what ships. Without the Malayalam book,
  that is public-domain samples until the user imports something.
- In-browser import (#28) becomes central, not an extra, and it needs a
  review screen that arc42 §3.3 still defers.

Neutral:

- This partly revises [ADR-0007](0007-bundle-the-core-hymnbook.md): bundling
  and downloading stay the delivery paths, but only for what may be
  redistributed.
