export const SCHEMA_VERSION = 1;

/**
 * Malayalam dependent vowel signs (U+0D3E-U+0D4C), virama (U+0D4D) and ZWJ/ZWNJ.
 * unicode61 treats these as separators by default, which fragments words to bare
 * consonants (SDD-0001 §6, risk R5).
 */
export const FTS_TOKENCHARS = "ാിീുൂൃൄെേൈൊോൌ്‌‍";

/** Mirrors SDD-0001 §6. Keep the two in step. */
export const SCHEMA_SQL = `
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
  kind        TEXT NOT NULL CHECK (kind IN ('stanza','refrain','bridge','tag')),
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
