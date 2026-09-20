# Architecture Decision Records

Why things are the way they are. Format is [MADR](https://adr.github.io/madr/);
the workflow is described in [`docs/README.md`](../README.md).

ADRs are **immutable**. A decision that stops being right is superseded by a
new record, never edited.

## Index

| #                                                               | Decision                                            | Status   |
| --------------------------------------------------------------- | --------------------------------------------------- | -------- |
| [0001](0001-record-architecture-decisions.md)                   | Record architecture decisions                       | Accepted |
| [0002](0002-rebuild-from-a-clean-slate.md)                      | Rebuild from a clean slate, archiving the old build | Accepted |
| [0003](0003-model-hymns-as-parts-and-an-occurrence-sequence.md) | Model hymns as parts plus an occurrence sequence    | Accepted |
| [0004](0004-build-a-responsive-web-application.md)              | Build the client as a responsive web application    | Accepted |
| [0005](0005-use-solidjs.md)                                     | Use SolidJS as the frontend framework               | Accepted |
| [0006](0006-defer-the-native-wrapper-decision.md)               | Defer the native wrapper decision                   | Deferred |
| [0007](0007-bundle-the-core-hymnbook.md)                        | Bundle the core hymnbook, download additional books | Accepted |
| [0008](0008-sqlite-as-the-on-device-content-store.md)           | SQLite as the on-device content store               | Accepted |
| [0009](0009-migrate-the-corpus-by-rule.md)                      | Migrate the corpus by rule, refine in place         | Accepted |
| [0010](0010-model-liveness-as-pluggable-follow-sources.md)      | Model "what is live" as pluggable follow sources    | Accepted |
| [0011](0011-defer-multi-device-sync-and-projector-output.md)    | Defer multi-device sync and projector output        | Deferred |
| [0012](0012-drop-the-bookmark-helper.md)                        | Drop the bookmark helper                            | Accepted |
| [0013](0013-toolchain-bun-biome-prettier-markdownlint.md)       | Toolchain: bun, biome, prettier with markdownlint   | Accepted |

## Open questions

Not yet decided, and deliberately so. Each needs evidence rather than
deliberation.

| Question                                   | Blocked on                                                         |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Visual language for repeated parts         | Something real on screen to judge against                          |
| Whether FTS5's tokeniser suits Malayalam   | An experiment against the real corpus                              |
| Lyrics copyright and redistribution rights | Establishing provenance — blocks any store release                 |
| AGPL-3.0 versus Apple App Store terms      | Resolve with [ADR-0006](0006-defer-the-native-wrapper-decision.md) |
| Content authoring and correction UI        | Evidence that hand-editing has become the bottleneck               |
