# 0016 — License the project under Apache-2.0

- **Status:** Accepted
- **Date:** 2026-09-24
- **Replaces:** the AGPL-3.0-only constraint in
  [arc42 §2.2](../architecture/arc42.md) (a constraint, not an earlier ADR).

## Context and Problem Statement

The project was licensed AGPL-3.0-only. That choice carried over from the
archived implementation rather than being decided for this one, and it had costs
arc42 already recorded:

- **R3:** AGPL-3.0 conflicts with Apple's App Store terms, which threatened the
  iOS target and weighed on
  [ADR-0006](0006-defer-the-native-wrapper-decision.md).
- Every wrapper, dependency and distribution channel had to be checked for AGPL
  compatibility.

Nothing in the current implementation requires a copyleft license. Every runtime
dependency is permissively licensed: solid-js (MIT), comlink (Apache-2.0), idb
(ISC), `@sqlite.org/sqlite-wasm` (Apache-2.0). The bundled font is OFL-1.1,
which sits alongside any code license. The icons are Material Symbols paths
(Apache-2.0). No third-party code is vendored.

**Who can relicense.** A copyright holder may relicense their own work. The
repository's history has two identities, one GitHub account renamed plus a
second address; the maintainer confirmed both are theirs and that no one else's
code is in the tree. So the maintainer holds all copyright and can relicense
without anyone else's consent.

## Considered Options

- **Keep AGPL-3.0-only**
- **Apache-2.0**
- **MIT**

## Decision Outcome

Chosen: **Apache-2.0**, from this commit on.

Over MIT: Apache-2.0 adds an explicit patent grant and a patent-retaliation
clause, and states how contributions are licensed (§5), which matters once
people send corrections (PLAN Board #16). It's equally permissive for users and
app stores.

Over keeping AGPL: the copyleft protects against a proprietary fork of a free
hymnal, but the maintainer judged that risk smaller than the app-store and
compatibility costs above.

### Consequences

Good:

- R3 is resolved: Apache-2.0 is compatible with the App Store, removing that
  force from [ADR-0006](0006-defer-the-native-wrapper-decision.md) (which stays
  unedited, as ADRs are immutable).
- Dependencies and wrappers need only permissive-license checks.

Bad, or to keep in mind:

- **Versions already published under AGPL-3.0 stay AGPL-3.0** for anyone who
  received them. A license can't be withdrawn retroactively; this governs new
  versions only.
- Anyone may now build a closed fork. Accepted.
- **Lyrics are not covered.** The code license says nothing about the hymn texts
  in `content/`; their redistribution rights are a separate open question (arc42
  R2), unchanged by this decision.
