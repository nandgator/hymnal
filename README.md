# Hymnal

> _O sing unto the Lord a new song..._

A multilingual Christian hymnal — select a hymnbook, find a hymn, and present it
dynamically, following the order it is actually **sung** rather than the order
it is printed.

## Status

**Phase 1, design stage.** No implementation yet. The architecture is settled
and documented; the previous implementation has been archived.

> **Picking up work — human or agent — start at
> [`docs/PLAN.md`](docs/PLAN.md).** It is the live control document: current
> state, ordered board, and the invariants that must not be broken. The rest of
> `docs/` is reference behind it.

## What makes this different

A refrain printed once is sung after every stanza. Most hymn software stores
lyrics flat and infers repetition at render time, which means repetition lives
in template branches rather than in data.

Here, a hymn owns a set of **parts** and, separately, a **sequence** of
references to them. A part may be referenced many times. That makes an
_occurrence_ — one position in the sung order — addressable independently of
the part whose text it shows, so the presenter knows not just _which text_ but
_which showing of it_: seen before, how many times, and what preceded it.

See [ADR-0003](docs/decisions/0003-model-hymns-as-parts-and-an-occurrence-sequence.md)
and the [domain model](docs/design/0001-domain-model.md).

## Documentation

| Document                                         | Purpose                            |
| ------------------------------------------------ | ---------------------------------- |
| [Plan](docs/PLAN.md)                             | Live state, board, invariants      |
| [Architecture](docs/architecture/arc42.md)       | arc42 — how the system is shaped   |
| [Decisions](docs/decisions/README.md)            | ADRs — why it is shaped that way   |
| [Domain model](docs/design/0001-domain-model.md) | SDD — entities, invariants, schema |
| [Docs workflow](docs/README.md)                  | How these three relate             |

## Development

Requires [bun](https://bun.sh).

```sh
bun install
bun run check    # lint and format checks
bun run format   # apply formatting
```

Markdown is formatted by prettier and linted by markdownlint; TypeScript is
handled by biome. The scopes do not overlap — see
[ADR-0013](docs/decisions/0013-toolchain-bun-biome-prettier-markdownlint.md).

## Archive

The previous implementation — a Rust build-time generator producing static
reveal.js decks, with a SvelteKit front end — lives in [`archive/`](archive/).
It is excluded from the build and from all tooling, and is retained only as a
reference for the corpus migration. See
[ADR-0002](docs/decisions/0002-rebuild-from-a-clean-slate.md).

The hymn corpus in `archive/data/lyrics/mal/` — 1,631 Malayalam hymns — is the
input to that migration and the most valuable thing in this repository.

## Licence

[AGPL-3.0-only](LICENSE).

All songs are owned by their respective authors. Note that redistribution
rights for the lyrics are **not yet established** — this is tracked as a risk
and blocks any app store release.
