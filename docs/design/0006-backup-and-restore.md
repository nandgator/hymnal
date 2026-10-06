# SDD-0006 — Backup and restore

- **Status:** Accepted (Board #46)
- **Date:** 2026-10-06
- **Decisions:** the maintainer's, 2026-10-06 (PLAN Log): every loaded book and
  the user state in one `.hymnal` file; Restore merges; Back Up and Restore in
  Settings, and Load Books recognises a backup. The rest decided by the
  recommendation, marked so below.

One file brings a device back: the books and the settings, recents and position
that go with them. Nobody has to know which file goes where. Restoring adds to
what the device holds and never takes anything away.

## 1. The file

`Hymnal backup 2026-10-06.hymnal`, a zip written with fflate (already a
dependency, SDD-0004 §2):

| Entry                 | Holds                                                 |
| --------------------- | ----------------------------------------------------- |
| `manifest.json`       | what the file is and what it holds                    |
| `user-state.json`     | the user-state document, as `cleanUserDoc` returns it |
| `books/<key>.sqlite3` | each book's package, exported from the pool as it is  |

```ts
interface BackupManifest {
  format: "hymnal-backup";
  version: 1;
  created: string; // ISO 8601
  build: string; // __APP_BUILD__
  books: {
    key: string;
    title: string;
    songs: number;
    file: string;
    sha256: string;
  }[];
}
```

A shipped book is left out: the app puts it back itself. A book that cannot be
opened (`needs-reloading`, `unreadable`, `needs-newer-app`, a missing file) is
left out too, and Back Up names it. The registry is not in the file: it is an
index, rebuilt from the packages (SDD-0004 §6).

## 2. Back Up

Settings gains a **Backup** section with two buttons, **Back Up** and
**Restore…**, and a line saying the file holds the books, the settings and the
recent hymns, and stays wherever it is saved. Back Up asks the worker for each
held book's bytes (`exportFile`), builds the zip in the worker, and hands it to
the page, which saves it (`showSaveFilePicker` where there is one, else a
download). Progress shows as a load's does (SDD-0004 §14). Nothing leaves the
device except to where the user saves it.

## 3. Reading a backup

The file is untrusted, whoever made it. The worker reads it:

1. **Size and shape.** At most 2 GB. A zip whose entries are `manifest.json`,
   `user-state.json` and the `books/` files the manifest names, and nothing
   else. A name not in the manifest, or a manifest naming a missing entry,
   refuses the file.
2. **Manifest.** Checked field by field. Another `format` is "not a backup". A
   higher `version` is "this backup needs a newer app", naming both, as a book
   format is (ADR-0019).
3. **Inflating.** Each entry is inflated with a ceiling of its declared size,
   itself capped at 512 MB, the declared sizes together at 2 GB, and its SHA-256
   checked against the manifest. A mismatch refuses that book as damaged and
   lets the rest restore.
4. **Each book, rebuilt.** A package is never copied into the pool as it is. It
   is opened from its bytes in a scratch in-memory database with
   `trusted_schema` off and SQLite's defensive flag on; its schema must hold
   only a package's own tables, columns and indexes (and `hymn_fts`'s), checked
   against the schema the app writes rather than by `sqlite_master`'s `type`,
   and any trigger, view or other row refuses it; `PRAGMA integrity_check` must
   pass. A version the app can migrate is migrated in the scratch (SDD-0004 §7).
   Its rows are read back into a book and its hymns, `validateCorpus` runs as
   for a load, and the package is written fresh by `packageRows`, the one
   builder, under the backup's key with its origin, `sources` and
   `content_hash`. So a restored book is exactly as safe as a loaded one.
5. **User state** goes through `cleanUserDoc` (SDD-0001 §11.1).

## 4. The review

Restore shows one sheet, like Load Books with several files: the backup's date
and build, then each book with what restoring will do. The verdict is SDD-0004
§8's pure function, fed the package's `sources` as its file hashes, its origin
and its song hashes:

| Found on the device                          | Does                                                     |
| -------------------------------------------- | -------------------------------------------------------- |
| The same key, the same songs                 | Nothing: "already here"                                  |
| The same key, different songs                | **Keep this device's** (default), or **Replace** from it |
| Another book with the same songs or a source | Nothing: "already here as _title_"                       |
| Nothing                                      | **Restore**, under the backup's key                      |
| The same key, but it cannot be opened here   | **Restore** over it, as Load Again does (SDD-0004 §9)    |

**Decided by the recommendation:** a conflict keeps the device's copy by
default, since it may be the newer edit, and Merge loses nothing. A restored
book keeps its key, so the backup's recents and position point at it.

One button, **Restore**, writes the books, then the user state. Settings come
from the backup. Recents are merged: both lists, one entry per song, the newest
first, capped at 20, keeping only those whose book is now held. The position
comes from the backup if its book is held. A failure in one book is reported and
the rest go on; the user state is written once the books are done.

## 5. From Load Books

The Library's picker also accepts `.hymnal`. A picked file that is a zip with a
`manifest.json` of `format: "hymnal-backup"` opens the restore review of §4
instead of a book's; the file's name does not decide it. Picked together with
books, it is refused with a line asking for it on its own.

## 6. Testing

Pure parts in Node: the manifest check, the entry rules, the ceilings, the
recents merge, and the verdict table, each case. The rebuild (§3.4) against
packages built with a trigger, a view, an extra table, a damaged page, an older
version and a newer one. A round trip: back up a store with two books and some
user state, restore it into an empty store and into one holding a different
edition, and compare. The sheet and the Settings section in component tests; the
save dialog and a 100 MB backup are hand checks in a browser.
