# Hymnal

> _O sing unto the Lord a new song..._

A multilingual Christian hymnal for worship. Load a hymnbook, find a hymn, and
present it on the projector screen in the order it is actually **sung**, not the
order it is printed.

**Try the beta at [hymnal.sagaveracity.com](https://hymnal.sagaveracity.com).**
"Try the Sample" in the empty Library loads a public-domain sample: 28 hymns
from _The Otterbein Hymnal_ (1890) and two Malayalam songs.

## Status

**Phase 1 is built and in beta.** It runs in the browser and installs as an app
(a PWA). It has not yet had its pass on real phones and tablets (iOS Safari,
Android Chrome); until then, treat those as untested.

> **Picking up work, human or agent: start at [`docs/PLAN.md`](docs/PLAN.md).**
> It is the live control document: current state, the ordered board, and the
> invariants that must not be broken. The rest of `docs/` is reference behind
> it.

## What it does

- **Presents in sung order.** Choruses come back after every stanza; Repeat and
  Undo handle what the congregation actually does, live.
- **The Output on the projector.** The Operator drives a second window placed on
  the projector screen, or presents full screen on its own screen ("Present
  Here"). Blank and Hold keep the audience's screen calm while the Operator
  works.
- **Keyboard and clicker first.** Every action has a key; a presentation
  clicker's Page Up and Page Down work, even from the Library while live.
- **Any language.** Malayalam and English today, with fonts bundled; the format
  takes any script.
- **Your books stay on your device.** Books load from files, through the
  Library, and are stored on the device. Nothing is sent anywhere; there is no
  account, tracking or server. It works offline after the first visit.
- **Back Up and Restore** every book, setting and recent hymn in one `.hymnal`
  file.

## What makes it different

A chorus printed once is sung after every stanza. Most hymn software stores
lyrics flat and infers repetition at render time, which means repetition lives
in template branches rather than in data.

Here, a hymn owns a set of **parts** and, separately, a **sequence** of
references to them. A part may be referenced many times. That makes an
_occurrence_ — one position in the sung order — addressable independently of the
part whose text it shows, so the presenter knows not just _which text_ but
_which showing of it_: seen before, how many times, and what preceded it.

See
[ADR-0003](docs/decisions/0003-model-hymns-as-parts-and-an-occurrence-sequence.md)
and the [domain model](docs/design/0001-domain-model.md).

## Books

Hymnal ships no songbook of its own beyond the public-domain sample
([ADR-0026](docs/decisions/0026-songs-leave-the-repository.md)). A book comes in
as a `.hymnbook.json.gz` container, through **Load Books** in the Library, or is
typed in with **From Text**. To build one from your own songs, see the
[authoring kit](docs/authoring/README.md): the song text format, a sample, and a
prompt for an AI of your choosing (if you use one, read its result against your
original before loading).

## Documentation

| Document                                     | Purpose                                       |
| -------------------------------------------- | --------------------------------------------- |
| [Plan](docs/PLAN.md)                         | Live state, board, invariants                 |
| [Architecture](docs/architecture/arc42.md)   | arc42: how the system is shaped               |
| [Decisions](docs/decisions/README.md)        | ADRs: why it is shaped that way               |
| [Design](docs/design/)                       | SDDs: domain, format, import, loading, backup |
| [Visual design](docs/visual/DESIGN.md)       | How it looks and moves                        |
| [Authoring kit](docs/authoring/README.md)    | For people building their own books           |
| [The sample's rights](docs/sample/RIGHTS.md) | Why each sample song is in the public domain  |
| [Docs workflow](docs/README.md)              | How these relate                              |

## Development

Requires [bun](https://bun.sh), and Node (the version in `.node-version`) for
the tests.

```sh
bun install
bun run dev        # the app, at http://localhost:5173/
bun run check      # formatting, lint, types and unit tests
bun run cqa:fix    # format, lint --fix, typecheck
bun run test:e2e   # Playwright smoke suite: Chromium, Firefox, WebKit
```

The content tools:

```sh
bun run import <file.pdf> [--profile p.json]   # song import (SDD-0003)
bun run text <file.txt> --id … --title …       # song text format to a book
bun run pack <dir>                             # a book directory to a container
bun scripts/sample-sources.ts                  # the sample's sources (maintainer)
```

Markdown is formatted by prettier and linted by markdownlint; TypeScript is
handled by biome. The scopes do not overlap — see
[ADR-0013](docs/decisions/0013-toolchain-bun-biome-prettier-markdownlint.md). A
push to `main` deploys to GitHub Pages once the audit, the checks and the smoke
suite pass.

## History

The previous implementation, a Rust generator of static reveal.js decks with a
SvelteKit front end, was replaced from a clean slate
([ADR-0002](docs/decisions/0002-rebuild-from-a-clean-slate.md)). It remains in
git history up to and including commit `155baea`.

## Licence

The code is licensed under [Apache-2.0](LICENSE)
([ADR-0016](docs/decisions/0016-license-under-apache-2.md)). Versions published
before that decision remain under AGPL-3.0-only.

The licence covers the code, not hymn texts. The sample's songs are in the
public domain, each with its record in
[`docs/sample/RIGHTS.md`](docs/sample/RIGHTS.md). Any other book is the user's
own: Hymnal presents what the user loads and never publishes it
([ADR-0020](docs/decisions/0020-present-songs-do-not-publish-them.md)), and the
user answers for having the right to use it.
