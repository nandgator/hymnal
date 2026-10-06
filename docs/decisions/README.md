# Architecture Decision Records

Why things are the way they are. Format is [MADR](https://adr.github.io/madr/);
the workflow is described in [`docs/README.md`](../README.md).

ADRs are **immutable**. A decision that stops being right is superseded by a new
record, never edited.

## Index

| #                                                                   | Decision                                                | Status                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [0001](0001-record-architecture-decisions.md)                       | Record architecture decisions                           | Accepted                                                                             |
| [0002](0002-rebuild-from-a-clean-slate.md)                          | Rebuild from a clean slate, archiving the old build     | Accepted                                                                             |
| [0003](0003-model-hymns-as-parts-and-an-occurrence-sequence.md)     | Model hymns as parts plus an occurrence sequence        | Accepted                                                                             |
| [0004](0004-build-a-responsive-web-application.md)                  | Build the client as a responsive web application        | Accepted                                                                             |
| [0005](0005-use-solidjs.md)                                         | Use SolidJS as the frontend framework                   | Accepted                                                                             |
| [0006](0006-defer-the-native-wrapper-decision.md)                   | Defer the native wrapper decision                       | Deferred                                                                             |
| [0007](0007-bundle-the-core-hymnbook.md)                            | Bundle the core hymnbook, download additional books     | Accepted                                                                             |
| [0008](0008-sqlite-as-the-on-device-content-store.md)               | SQLite as the on-device content store                   | Superseded by [0015](0015-use-official-sqlite-wasm-not-wa-sqlite.md)                 |
| [0009](0009-migrate-the-corpus-by-rule.md)                          | Migrate the corpus by rule, refine in place             | Superseded by [0026](0026-songs-leave-the-repository.md)                             |
| [0010](0010-model-liveness-as-pluggable-follow-sources.md)          | Model "what is live" as pluggable follow sources        | Accepted                                                                             |
| [0011](0011-defer-multi-device-sync-and-projector-output.md)        | Defer multi-device sync and projector output            | Deferred; projector output by [0028](0028-put-the-output-on-the-projector-screen.md) |
| [0012](0012-drop-the-bookmark-helper.md)                            | Drop the bookmark helper                                | Accepted                                                                             |
| [0013](0013-toolchain-bun-biome-prettier-markdownlint.md)           | Toolchain: bun, biome, prettier with markdownlint       | Accepted                                                                             |
| [0014](0014-defer-transliteration.md)                               | Defer transliteration (search and display)              | Deferred                                                                             |
| [0015](0015-use-official-sqlite-wasm-not-wa-sqlite.md)              | Use the official SQLite Wasm build, not wa-sqlite       | Accepted                                                                             |
| [0016](0016-license-under-apache-2.md)                              | License the project under Apache-2.0                    | Accepted                                                                             |
| [0017](0017-fix-the-interface-scale.md)                             | Fix the interface scale; only content scales            | Accepted                                                                             |
| [0018](0018-import-songs-through-a-layout-aware-pipeline.md)        | Import songs through a layout-aware pipeline, CLI first | Accepted                                                                             |
| [0019](0019-version-the-content-format.md)                          | Version the content format; one gzipped file per book   | Accepted                                                                             |
| [0020](0020-present-songs-do-not-publish-them.md)                   | Present songs; don't publish them                       | Accepted                                                                             |
| [0021](0021-identify-books-by-the-store-that-holds-them.md)         | Identify books by the store that holds them             | Accepted                                                                             |
| [0022](0022-publish-a-json-schema-for-the-format.md)                | Publish a JSON Schema for the content format            | Accepted                                                                             |
| [0023](0023-recognise-the-document-and-infer-its-layout.md)         | Recognise what a document holds; infer its layout       | Superseded by [0024](0024-import-case-by-case.md)                                    |
| [0024](0024-import-case-by-case.md)                                 | Import case by case; the app loads only format 1        | Accepted                                                                             |
| [0025](0025-call-it-the-chorus.md)                                  | Call it the chorus: screen, key, code and format        | Accepted                                                                             |
| [0026](0026-songs-leave-the-repository.md)                          | Songs leave the repository; every book is an import     | Accepted                                                                             |
| [0027](0027-review-a-book-without-editing-it.md)                    | Review a book without editing it                        | Accepted                                                                             |
| [0028](0028-put-the-output-on-the-projector-screen.md)              | Put the Output on the projector screen                  | Accepted                                                                             |
| [0029](0029-others-build-their-books-the-format-is-the-contract.md) | Others build their books: the format is the contract    | Accepted                                                                             |
| [0030](0030-security-a-local-first-threat-model.md)                 | Security: a local-first threat model                    | Accepted                                                                             |

## Open questions

Not yet decided, and deliberately so. Each needs evidence rather than
deliberation.

| Question                                   | Blocked on                                                    |
| ------------------------------------------ | ------------------------------------------------------------- |
| Lyrics copyright and redistribution rights | Establishing provenance — blocks any store release            |
| Content authoring and correction UI        | Evidence that hand-editing has become the bottleneck          |
| Transliteration scheme and library         | Phase 1 in use; see [ADR-0014](0014-defer-transliteration.md) |
| AI in the app (the user's own agent)       | Tauri: an ADR for an MCP interface over the app's actions     |
