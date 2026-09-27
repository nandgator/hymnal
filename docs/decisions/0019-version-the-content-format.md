# 0019 — Version the content format; one gzipped file per book

- **Status:** Accepted
- **Date:** 2026-09-27

## Context and Problem Statement

The content format, `hymnbook.json` plus one `NNNN.json` per hymn, has been
defined only by `validate.ts` and [SDD-0001](../design/0001-domain-model.md)
§6 and §9. That was enough while the build was its only reader and the
migration its only writer. The importer
([ADR-0018](0018-import-songs-through-a-layout-aware-pipeline.md)) is a
second writer, meant to be run standalone. From then on the format is a
contract between tools of different versions, and needs a written spec
and a version number.

Two constraints bear on versioning. Validation rejects any field it does not
know ("unsupported metadata fails", SDD-0001 §9), and content is never
silently repaired or trimmed ([arc42 §8.6](../architecture/arc42.md)).

A book is also moved as a unit: downloaded, shared, imported. Measured on the
1,631-hymn corpus (5.4 MB of source):

| Container                           | Size    |
| ----------------------------------- | ------- |
| Zip of the per-hymn files           | 1.20 MB |
| One JSON document, gzip -9          | 508 KB  |
| Tar of the per-hymn files, zstd -19 | 413 KB  |
| The built `.sqlite` package, gzip   | 2.2 MB  |

## Considered Options

Versioning:

- **A whole number; a reader refuses any newer version**
- **major.minor; old readers skip fields added in a minor**
- **No version; readers probe for fields**

Container:

- **Zip of the directory**, as EPUB does
- **One JSON document, gzipped**
- **Tar, zstd**

## Decision Outcome

Chosen: **a whole-number `format` in `hymnbook.json`, currently `1`, and a
reader that refuses any version it does not know.** A minor version would
need old readers to skip unknown fields, which is a silent drop and
contradicts §8.6. A refusal with a clear message ("this book needs a newer
app") loses nothing.

Chosen: **the container is one JSON document holding the book and every
hymn, gzipped** (`<id>.hymnbook.json.gz`). Zip compresses each small file
alone and comes out 2.4× larger. zstd is 20% smaller again, but browsers do
not decompress it natively, while gzip is built into `DecompressionStream`
and Bun: no library either side.

**Specified now, built when something needs it.** The committed source stays
a directory of per-hymn files, which diff and review well. The container
format is written into [SDD-0002](../design/0002-content-format.md); no
tool writes it until a download or sharing path needs one.

### Consequences

Good:

- Any tool can tell whether it can read a book before trying.
- The container needs no dependency in the browser or in Bun.

Bad:

- Every addition to the format, however small, is a new version, and older
  apps refuse the newer books. Acceptable while one maintainer ships the
  app and the books together.

Neutral:

- `format` versions the source; the SQLite package's `schema_version`
  versions the package. They change independently.
- **Noted, not decided:** a downloaded book could be the gzipped source
  (508 KB) with the SQLite package built on the device, rather than the
  package itself (2.2 MB). The browser importer needs an on-device builder
  anyway. That would revisit
  [ADR-0007](0007-bundle-the-core-hymnbook.md) and SDD-0001 §9.
