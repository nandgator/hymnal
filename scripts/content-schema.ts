/**
 * 2: the chorus, once the refrain (ADR-0025).
 * 3: `hymnbook.origin` and `sources`, `part.position` (SDD-0004 §7).
 */
export const SCHEMA_VERSION = 3;

/**
 * Migrations in place, keyed by the version they start from (SDD-0004 §7).
 * Each runs in one transaction. 2 to 3: position is filled from rowid order,
 * the best a version 2 file has (the app has never vacuumed one).
 */
export const PACKAGE_MIGRATIONS: Readonly<Record<number, readonly string[]>> = {
  2: [
    "ALTER TABLE hymnbook ADD COLUMN origin TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE hymnbook ADD COLUMN sources TEXT NOT NULL DEFAULT '[]'",
    "UPDATE hymnbook SET origin = id",
    "ALTER TABLE part ADD COLUMN position INTEGER NOT NULL DEFAULT 0",
    `UPDATE part SET position = (SELECT COUNT(*) FROM part AS p
       WHERE p.hymn_number = part.hymn_number AND p.rowid < part.rowid)`,
    "CREATE UNIQUE INDEX part_position ON part (hymn_number, position)",
    "UPDATE hymnbook SET schema_version = 3",
  ],
};

/**
 * Malayalam dependent vowel signs (U+0D3E-U+0D4C), virama (U+0D4D) and ZWJ/ZWNJ.
 * unicode61 treats these as separators by default, which fragments words to bare
 * consonants (SDD-0001 §6, risk R5).
 */
export const FTS_TOKENCHARS = "ാിീുൂൃൄെേൈൊോൌ്‌‍";

/**
 * Mirrors SDD-0001 §6. Keep the two in step.
 *
 * Do not edit this text, even a comment, without freezing it: a backup's book
 * is matched against it exactly (SDD-0006 §3.4), so any change, or a bump of
 * SCHEMA_VERSION, makes every older backup "unsafe". Freeze the current DDL as
 * a `SCHEMA_V<n>_SQL` constant, add it as an accepted family in the backup
 * schema match (and its migrated form), then update the pin in
 * scripts/backup.test.ts.
 */
export const SCHEMA_SQL = `
CREATE TABLE hymnbook (
  id             TEXT PRIMARY KEY,    -- the key
  origin         TEXT NOT NULL,       -- the id the file declared
  title          TEXT NOT NULL,
  language       TEXT NOT NULL,
  script         TEXT NOT NULL,
  publisher      TEXT,
  edition        TEXT,
  isbn           TEXT,
  schema_version INTEGER NOT NULL,
  content_hash   TEXT NOT NULL,
  sources        TEXT NOT NULL        -- JSON array of container file hashes
) STRICT;

CREATE TABLE hymn (
  number  INTEGER PRIMARY KEY,
  title   TEXT NOT NULL,
  author  TEXT,
  tune    TEXT,
  meter   TEXT
) STRICT;

CREATE TABLE part (
  hymn_number INTEGER NOT NULL REFERENCES hymn(number),
  id          TEXT NOT NULL,
  position    INTEGER NOT NULL,   -- printed order, as the file has the parts
  kind        TEXT NOT NULL CHECK (kind IN ('intro','stanza','pre-chorus','chorus','post-chorus','bridge','outro','tag')),
  label       TEXT,
  PRIMARY KEY (hymn_number, id),
  UNIQUE (hymn_number, position)
) STRICT;

CREATE TABLE line (
  hymn_number INTEGER NOT NULL,
  part_id     TEXT    NOT NULL,
  idx         INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  PRIMARY KEY (hymn_number, part_id, idx),
  FOREIGN KEY (hymn_number, part_id) REFERENCES part(hymn_number, id)
) STRICT;

CREATE TABLE sequence_entry (
  hymn_number INTEGER NOT NULL,
  idx         INTEGER NOT NULL,
  part_id     TEXT    NOT NULL,
  PRIMARY KEY (hymn_number, idx),
  FOREIGN KEY (hymn_number, part_id) REFERENCES part(hymn_number, id)
) STRICT;

CREATE VIRTUAL TABLE hymn_fts USING fts5(
  title,
  body,
  content = '',
  tokenize = 'unicode61 tokenchars ''${FTS_TOKENCHARS}'''
);
`;

/**
 * Package schema version 2 as it was written, kept so a backup's older packages
 * can be recognised exactly (SDD-0006 §3.4); `PACKAGE_MIGRATIONS` takes it to 3.
 */
export const SCHEMA_V2_SQL = `
CREATE TABLE hymnbook (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  language       TEXT NOT NULL,
  script         TEXT NOT NULL,
  publisher      TEXT,
  edition        TEXT,
  isbn           TEXT,
  schema_version INTEGER NOT NULL,
  content_hash   TEXT NOT NULL
) STRICT;

CREATE TABLE hymn (
  number  INTEGER PRIMARY KEY,
  title   TEXT NOT NULL,
  author  TEXT,
  tune    TEXT,
  meter   TEXT
) STRICT;

CREATE TABLE part (
  hymn_number INTEGER NOT NULL REFERENCES hymn(number),
  id          TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('intro','stanza','pre-chorus','chorus','post-chorus','bridge','outro','tag')),
  label       TEXT,
  PRIMARY KEY (hymn_number, id)
) STRICT;

CREATE TABLE line (
  hymn_number INTEGER NOT NULL,
  part_id     TEXT    NOT NULL,
  idx         INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  PRIMARY KEY (hymn_number, part_id, idx),
  FOREIGN KEY (hymn_number, part_id) REFERENCES part(hymn_number, id)
) STRICT;

CREATE TABLE sequence_entry (
  hymn_number INTEGER NOT NULL,
  idx         INTEGER NOT NULL,
  part_id     TEXT    NOT NULL,
  PRIMARY KEY (hymn_number, idx),
  FOREIGN KEY (hymn_number, part_id) REFERENCES part(hymn_number, id)
) STRICT;

CREATE VIRTUAL TABLE hymn_fts USING fts5(
  title,
  body,
  content = '',
  tokenize = 'unicode61 tokenchars ''${FTS_TOKENCHARS}'''
);
`;
