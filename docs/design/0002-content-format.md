# SDD-0002 — Content format, version 1

- **Status:** Accepted
- **Date:** 2026-09-27
- **Decisions:** [ADR-0019](../decisions/0019-version-the-content-format.md)
  (versioning, container), [ADR-0022](../decisions/0022-publish-a-json-schema-for-the-format.md)
  (JSON Schema), [ADR-0021](../decisions/0021-identify-books-by-the-store-that-holds-them.md)
  (identity across books), [ADR-0009](../decisions/0009-migrate-the-corpus-by-rule.md)
  (source is committed and corrected in place)

The files a hymnbook is written in: what the migration and the importer
produce, what the content pipeline reads. It is the contract between those
tools. The in-memory model is [SDD-0001 §2](0001-domain-model.md#2-entities);
the built package is SDD-0001 §6. Neither is this format.

## 1. Two forms

**Directory**, the source form, committed under `content/<id>/`:

```text
content/<id>/
  hymnbook.json
  0001.json
  0002.json
  …
```

**Container**, one file for moving a book as a unit: `<id>.hymnbook.json.gz`,
the gzip of one UTF-8 JSON document:

```jsonc
{
  "hymnbook": {/* hymnbook.json, verbatim */},
  "hymns": [/* every NNNN.json, in number order */],
}
```

Both forms carry the same content and pass the same rules. Specified, not
yet built: no tool writes the container until a download or sharing path
needs it (ADR-0019).

All files are UTF-8 JSON. `NNNN` is the hymn number, zero-padded to four
digits.

## 2. `hymnbook.json`

| Field       | Type    | Required | Meaning                                                                          |
| ----------- | ------- | -------- | -------------------------------------------------------------------------------- |
| `$schema`   | string  | no       | The schema this file follows, for editors (§6)                                   |
| `format`    | integer | yes      | This format's version; `1`                                                       |
| `id`        | string  | yes      | Opaque slug, the directory name ([SDD-0001 §2.1](0001-domain-model.md#21-types)) |
| `title`     | string  | yes      | Title in the book's own script                                                   |
| `language`  | string  | yes      | BCP-47, e.g. `ml`                                                                |
| `script`    | string  | yes      | ISO 15924, e.g. `Mlym`                                                           |
| `publisher` | string  | no       |                                                                                  |
| `edition`   | string  | no       |                                                                                  |
| `isbn`      | string  | no       |                                                                                  |
| `hymnCount` | integer | yes      | How many hymn files there are                                                    |

## 3. `NNNN.json`

| Field      | Type         | Required | Meaning                                                      |
| ---------- | ------------ | -------- | ------------------------------------------------------------ |
| `$schema`  | string       | no       | The schema this file follows, for editors (§6)               |
| `number`   | integer, ≥ 1 | yes      | Number as printed; matches the file name                     |
| `title`    | string       | yes      | As the hymn is known; the first line when none is printed    |
| `parts`    | array        | yes      | Each text block, printed once, in printed order              |
| `sequence` | array        | yes      | Sung order, as `{ "partId": … }` entries                     |
| `meta`     | object       | yes      | `author`, `tune`, `meter`, all optional strings; may be `{}` |

A part:

| Field   | Type     | Required | Meaning                                            |
| ------- | -------- | -------- | -------------------------------------------------- |
| `id`    | string   | yes      | Unique in the hymn, e.g. `s1`, `r`                 |
| `kind`  | string   | yes      | Its role; one of the kinds below                   |
| `label` | string   | no       | Shown with the part, e.g. `1`; absent for choruses |
| `lines` | string[] | yes      | One entry per displayed line                       |

The kinds, in the usual order of a song: `intro`, `stanza` (a verse),
`pre-chorus`, `chorus`, `post-chorus`, `bridge`, `outro`, `tag`
(a closing line or two, repeated). An instrumental solo, an ad lib or an
elision has no lyrics of its own, so none is a part.

## 4. Rules

A book that breaks any rule is rejected whole, with every violation listed;
nothing is repaired ([arc42 §8.6](../architecture/arc42.md#86-handling-imperfect-content)).
The rules are the invariants I1–I7 of
[SDD-0001 §4](0001-domain-model.md#4-invariants), plus:

- Each file name matches its `number`; the file count matches `hymnCount`.
- Every required field is present, with the type above.
- **No field outside these tables**, at any level. An unknown field is a
  violation, never ignored.
- `format` is a version the reader knows. A newer one is refused with a
  message naming both versions.

## 5. Versioning

`format` is a whole number. Any change to the fields or rules above,
additions included, is a new version, and this document is updated with it.
A reader accepts exactly the versions it was written for. There are no minor
versions: an old reader skipping a new field would be a silent drop (ADR-0019).

Format 1 was amended twice before anything outside this repository read it:
`$schema` (ADR-0022), and the kinds beyond `stanza`, `chorus`, `bridge` and
`tag` (2026-09-27). Once a file leaves the repository, amending stops.

`format` versions this source. The SQLite package's `schema_version`
versions the package; they change independently.

## 6. Schema

JSON Schema (2020-12) for each form, one set per format version, in
`public/schema/1/` and served with the site under `schema/1/`:

| File                    | Describes                         |
| ----------------------- | --------------------------------- |
| `hymnbook.schema.json`  | `hymnbook.json`                   |
| `hymn.schema.json`      | `NNNN.json`                       |
| `container.schema.json` | `<id>.hymnbook.json.gz`, unzipped |

They carry no absolute `$id` and refer to each other by relative path, so
they work wherever they are served. They describe shape only: §4's rules
that span a document (I2, I5, I7, file names, `hymnCount`) are enforced by
`validate.ts`, which also reads its allowed fields from these files
([ADR-0022](../decisions/0022-publish-a-json-schema-for-the-format.md)).
A file names its schema, relative or absolute, in `$schema`:

```json
{ "$schema": "../../public/schema/1/hymn.schema.json", "number": 1 }
```

## 7. What a file can't promise

A book file guarantees uniqueness only within itself: part ids in a hymn
(I1), hymn numbers in a book (I7). That its `id` is unique among books is
up to whatever holds them. The repository build requires `id` to match
the book's directory; a device store assigns its own keys and keeps `id`
as the book's origin
([ADR-0021](../decisions/0021-identify-books-by-the-store-that-holds-them.md)).
