# 0015 — Use the official SQLite Wasm build, not wa-sqlite

- **Status:** Accepted
- **Date:** 2026-09-22
- **Supersedes:** [0008](0008-sqlite-as-the-on-device-content-store.md)'s
  choice of library. The two-store split (SQLite content / IndexedDB user
  state) from 0008 is unaffected.

## Context and Problem Statement

Implementing Board #6's content store against `wa-sqlite` surfaced a problem
0008 didn't account for: `wa-sqlite`'s OPFS support is not part of its stable,
versioned API. `AccessHandlePoolVFS` lives in `src/examples/`, and the
package's own README calls its OPFS and IndexedDB VFS implementations
"examples provided as proof of concept." It is real, working code, but
upstream owes it no semver guarantee — a minor version bump could change or
drop it.

## Considered Options

- **Keep `wa-sqlite`**, accepting its OPFS support as unmaintained example code
- **`@sqlite.org/sqlite-wasm`**, the SQLite project's own npm-published Wasm
  build

## Decision Outcome

Chosen: **`@sqlite.org/sqlite-wasm`**, using its `opfs-sahpool` VFS
(`sqlite3.installOpfsSAHPoolVfs()` → `OpfsSAHPoolDatabase`).

`wa-sqlite`'s one differentiator — authoring custom VFS/tokenizers in
JavaScript — turns out not to be needed. The Malayalam fix
([SDD-0001 §6](../design/0001-domain-model.md#6-storage-schema)) uses
`unicode61 tokenchars`, a built-in SQLite option, not a custom tokenizer. Once
that's off the table, there's no reason to carry a library whose OPFS path is
explicitly unmaintained example code when the SQLite project ships the same
technique (an Access Handle pool) as documented, first-class functionality.

The official build's query API (`db.exec()`, `db.selectObjects()`,
`prepare().bind().step()` as methods on real objects) is also materially
smaller to write against than `wa-sqlite`'s C-style bindings, which return
integer pointers and require manual `prepare_v2`/`step`/`finalize` handle
management — a real cost for a solo maintainer (arc42 R8).

`opfs-sahpool` specifically, not the `opfs` VFS: `opfs` requires the server to
send `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers,
which not every static host supports. `opfs-sahpool` needs neither.

### Consequences

Good:

- OPFS persistence is now first-class, maintained functionality, not example
  code.
- Smaller, more direct query API; less code in the content-store worker.
- No cross-origin-isolation headers required of the host.
- `OpfsSAHPoolDatabase`/pool utility ships `importDb()`, built for exactly the
  first-run provisioning step (copy the prebuilt package into OPFS) with no
  SQL required.

Bad:

- None known relative to `wa-sqlite` for this project's actual usage.

Neutral:

- **`opfs-sahpool` does not support multiple simultaneous connections.** A
  second browser tab open on the same origin at the same time will fail to
  acquire the store. Accepted for Phase 1 (single-device scope guard); that's
  not the same thing as single-tab, worth remembering if that gap is reported.
