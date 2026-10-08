# 0026 — Songs leave the repository

- **Status:** Accepted
- **Date:** 2026-10-02
- **Supersedes:** [ADR-0009](0009-migrate-the-corpus-by-rule.md)

## Context and Problem Statement

[ADR-0009](0009-migrate-the-corpus-by-rule.md) made the migrated corpus source:
1,631 Malayalam hymns, committed under `content/`, corrected in place, built
into a SQLite package by CI and served from GitHub Pages
([ADR-0007](0007-bundle-the-core-hymnbook.md)).
[ADR-0020](0020-present-songs-do-not-publish-them.md) then made Hymnal a tool
that presents what the user brings, and left that book bundled "for now",
pending its rights (arc42 R2, open, blocking any release).

Since then the app has gained a second way to get a book: an import, as a format
1 file or a container ([ADR-0019](0019-version-the-content-format.md),
[ADR-0024](0024-import-case-by-case.md)), loaded into the device's own store and
keyed there ([ADR-0021](0021-identify-books-by-the-store-that-holds-them.md)).
Board #28 builds that path. Left beside a bundled book, the app would have two
ways to get a book on a device, and the project would keep serving lyrics it has
no right to serve.

What the repository holds today, and what depends on it:

| What                        | Where                                                                   |
| --------------------------- | ----------------------------------------------------------------------- |
| The corpus, as source       | `content/mal-ymef-athmeeya-geethangal-16/`, committed                   |
| Its package                 | `bun run build:content` → `public/content/*.sqlite`, gitignored         |
| The deploy                  | `deploy.yml`: `check`, `build:content`, `build`; `public/` is published |
| First run                   | `ensureInstalled` fetches the bundled package for a fixed book id       |
| A PLAN Invariant            | "Migration output is committed source, never regenerated wholesale"     |
| Recents and last position   | `idb`, holding the book's slug                                          |
| Devices that already use it | The package in OPFS, installed from the live site                       |

## Considered Options

- **Keep the corpus committed**, and add imports beside it
- **Move only the Malayalam book out**, and keep other books committed as
  samples in `content/`
- **Every book comes in as an import**, the Malayalam one included; the
  repository holds the pipeline and nothing of anyone's songs

## Decision Outcome

Chosen, by the maintainer: **the songs leave the repository.** In the next
phase, every book, `content/`'s Malayalam book included, comes into the app as
an import: a format 1 file, or the result of an import from a PDF and the like.
This reverses ADR-0009's committed corpus. This record comes before Board #28's
build, which loads them.

Keeping the corpus committed leaves two paths and a standing problem with
rights. Moving only the Malayalam book still leaves committed lyrics in the tree
for the next book to follow, and the next book's rights are no clearer. Only
"every book is an import" has one way to get a book, and the repository then
carries no book whose rights are unknown.

What follows, option by option.

### What the deploy builds

- **Keep `build:content` in CI over a directory of committed samples.** There
  are no samples to build today; the step would run to build nothing.
- **Build the app alone, and add a step when a sample exists.**

Chosen: **the app alone.** `deploy.yml` drops `build:content` and the site stops
serving `public/content/`. `bun run build:content` stays in the tree until the
sample question below is decided, since it is the machinery one answer reuses.
CI needs no `content/`, which the maintainer's machine keeps, ignored.

### What "shipped" means

Chosen, by the maintainer, as ADR-0020 has it: **a shipped book is a bundled
sample whose songs are public domain**, each with a rights record showing why
(SDD-0001 §8). Nothing ships today, and no book ships because it was once
bundled. Shipped books keep slugs as keys and are replaced from the bundle when
the schema moves
([ADR-0021](0021-identify-books-by-the-store-that-holds-them.md),
[ADR-0025](0025-call-it-the-chorus.md)); loaded books are neither.

Chosen, by the maintainer: **nothing ships until a sample exists, and how it
reaches the device is decided then.** The candidates are a prebuilt package from
a committed source directory (today's machinery) or a committed container
offered in the Library and loaded like any file; the second is the leaning, for
having one path. Chosen, by the maintainer (2026-10-07): **a container built
locally, published as a GitHub Release asset, fetched by the deploy and checked
against a SHA-256 committed in the repository**, then offered in the Library and
loaded like any file. Each song's rights record is a page beside the books, not
a field in them, so format 1 stands (SDD-0002 §5). Until then no code is kept
for shipped books beyond what SDD-0004 names.

### The first run on a device with nothing bundled

- **An empty Library with one action**, to load a book
- **A demonstration book**, so the Operator can be tried at once
- **A download from a host**, as ADR-0007 allowed

Chosen, by the maintainer: **the empty Library.** It explains that books load
from a file and offers the file picker; the other screens say "no book yet" and
lead there. No demonstration book and no download. A demonstration book would be
a sample, so it waits on a public-domain song with a rights record, and is for
the sample decision to add. A host serving books is the redistribution this
record ends, and would need a backend that arc42 §2.1 rules out.

### What replaces the Invariant

The PLAN says: "Migration output is committed source, never regenerated
wholesale" (ADR-0009). Nothing the repository holds is migration output after
this.

- **Drop it.** Nothing committed is left to protect.
- **Keep it unchanged.** It would name committed source that no longer exists.
- **Keep the principle, drop the place:** reviewed source is corrected in place
  and never regenerated wholesale, wherever it lives.

Chosen: **keep the principle, drop the place.** The reason for the rule stands:
a rule-derived book is wrong in places (arc42 R1), and a wholesale re-run throws
away the corrections made by hand. The importer already follows it
(`bun run import` keeps a draft's `HAND-FIXES.md`, SDD-0003 §5). The PLAN reads:
"A reviewed book's source is corrected in place, never regenerated wholesale".
It fits source that is no longer in git, where nothing but the maintainer's care
stands between a re-run and the corrections. The rules ADR-0009 set out stay in
use, as the importer's sequence rule (SDD-0003 §3); what ends is the committed
corpus.

### Where the Malayalam book's source lives

Chosen, by the maintainer: **only on the maintainer's machine, in an ignored
`content/`, backed up as the maintainer sees fit.** It stays at `content/<id>/`,
which becomes gitignored like `content-local/`; the packing command takes a
path, so nothing depends on the name. The code change happens in Board #28's
last part, the songs leaving (SDD-0004 §13, part 6), after the book has been
packed and loaded through the Library: the committed files are removed from the
tree and `content/` is added to `.gitignore`. Not now. The overlay of
`content-local/` (test hymns merged by `build:content`) ends with it: a test
hymn is a file in that directory.

### The other decisions

Also chosen, by the maintainer:

- **A device that already holds the bundled Malayalam book keeps it.** The
  registry adopts the file in place, as a loaded book with its slug as key (an
  exception to ADR-0021's UUIDv7 for loaded books, which stay opaque), migrated
  at version 2. Recents stay valid, and a later load of the book's container is
  "the same songs" (SDD-0004 §6, §7).
- **The history will be rewritten to remove the Malayalam songs, later.** The
  tree stops carrying `content/` first (part 6). Rewriting `content/` out of the
  history follows as a separate step of the maintainer's, not part of Board #28;
  every clone and fork is then out of step, and the Pages history goes with it.
- **Removing a loaded book drops its recents; the next held book becomes
  current.** Chosen, by the maintainer (SDD-0004 §9).
- **"The same songs"** means the same set of numbers, each with an equal hash.

### Consequences

Good:

- One way to get a book on a device, whatever the book.
- The site stops serving lyrics whose rights are unknown; R2 narrows to the
  samples, if any.
- The repository is the pipeline alone: importer, validator, container, app.

Bad:

- **The history still holds the corpus.** A tree without the files is not a
  repository without them, and the live site has served them. Until the rewrite,
  it does.
- **A book is no longer re-installable.** ADR-0008's table counts content as
  "re-installable", which held while a host had it; a loaded book is on the
  device and in the file the user kept. OPFS eviction (arc42 R4) now loses books
  until the file is loaded again. Chosen, by the maintainer: persistent storage
  is asked for at the first load, and if it is refused, a one-time note says to
  keep the file.
- **A device that holds the bundled book** has no bundle to replace it from, and
  recents that name its slug. The book is adopted in place, as above.
- **The Malayalam source is no longer versioned by this repository,** and its
  corrections (R1) are the hardest thing to rebuild; backing it up is the
  maintainer's.
- A first run is useless until the user has a file. ADR-0020 accepted that, and
  the Malayalam book's container is the maintainer's to hand on.

Neutral:

- This ends ADR-0020's "the bundled Malayalam book stays for now", and revises
  ADR-0007 further: there is no core book.
- arc42 §3.3 is amended now (ADR-0027). The rest of arc42 that describes the
  bundled book (§1.1's deferred list, §3.2, §6.3, §7, R1) stays stale until the
  songs leave, in Board #28's last part, and is rewritten then.

Revised by this record, briefly:

- [ADR-0007](0007-bundle-the-core-hymnbook.md): there is no core book to bundle.
- [ADR-0020](0020-present-songs-do-not-publish-them.md): the Malayalam book no
  longer "stays for now".
- [ADR-0021](0021-identify-books-by-the-store-that-holds-them.md): an adopted
  book keeps its slug as key, though loaded; keys stay opaque, so nothing else
  changes.
- [ADR-0025](0025-call-it-the-chorus.md): "replaced from the app's own bundle"
  holds only for a shipped book; a loaded one is migrated in place (SDD-0004
  §7).
- SDD-0001 §6 (a copy replaced from the bundle: shipped books only), §11 (the
  `installed` field: the registry replaces it) and §12 (the Library: a list of
  books held), and SDD-0002 §1 (the container is built; the directory is no
  longer committed). SDD-0004 is the current text for each.
- SDD-0003 §5: a reviewed draft is packed into a container and loaded, not moved
  into `content/`.
- arc42 R4 (and §8.5): content is re-fetchable only for shipped books; a loaded
  book is lost to eviction until its file is loaded again.
