import { libraryOrder } from "../domain/own.ts";
import type { Sql } from "./package-io.ts";
import type { BookRow } from "./registry.ts";

export interface SearchResult {
  number: number;
  title: string;
  snippet: string;
}

/** What one book found for a query (SDD-0001 §13.1). */
export interface BookHits {
  key: string;
  title: string;
  results: SearchResult[];
  /** Whether more follow the page returned (Board #66): the Finder asks for them as the list is scrolled. */
  more?: boolean;
}

/** One page of a book's matches, and whether more follow it. */
export interface SearchPage {
  results: SearchResult[];
  more: boolean;
}

/**
 * A book's songs for a typed number: the exact number first, then those it starts
 * ("4" finds 4, then 42, 421), in the book's order, at most `limit`.
 */
export function numberMatches(
  songs: readonly { number: number; title: string }[],
  typed: string,
  limit = 8,
): SearchResult[] {
  const exact = songs.filter((song) => String(song.number) === typed);
  const prefixed = songs.filter(
    (song) => String(song.number).startsWith(typed) && String(song.number) !== typed,
  );
  return [...exact, ...prefixed]
    .slice(0, limit)
    .map((song) => ({ number: song.number, title: song.title, snippet: "" }));
}

/** A page of results from one book: a common word matches hundreds of hymns. */
export const SEARCH_LIMIT = 30;

/**
 * Per-word prefix match, implicit AND (Board #8): each word becomes a
 * quoted, prefix-matched FTS5 term (`"word"*`), so a query matches lines
 * containing all the words regardless of order or completion. Quoting each
 * term (not just escaping it) keeps FTS5 query-syntax characters in free
 * text from breaking the query.
 *
 * hymn_fts is contentless (SDD-0001 §6, deliberately: no duplicated lyric
 * text), so it can MATCH but returns NULL for every selected column,
 * `snippet()` included. Title and snippet come from a join back to
 * `hymn`/`line` instead: the snippet is the first line containing any of
 * the query's words, since a multi-word query can match across lines.
 *
 * A page is SEARCH_LIMIT: a common word (found by browser-testing this
 * against the real corpus) matches hundreds of hymns, and `rank` ordering
 * doesn't help a caller that renders every row. The Finder asks for the next
 * page with `offset` as the list is scrolled (SDD-0001 §13.2); the order is
 * rank, then number, so the pages never overlap.
 */
export function searchBookPage(sql: Sql, query: string, offset = 0): SearchPage {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { results: [], more: false };

  const quote = (word: string) => `"${word.replace(/"/g, '""')}"*`;
  const matchQuery = words.map(quote).join(" ");
  const likeClauses = words.map(() => "line.text LIKE '%' || ? || '%'").join(" OR ");

  const rows = sql
    .all(
      `SELECT hymn.number AS number, hymn.title AS title,
              (SELECT line.text FROM line
               WHERE line.hymn_number = hymn.number AND (${likeClauses})
               LIMIT 1) AS snippet
       FROM hymn_fts JOIN hymn ON hymn.number = hymn_fts.rowid
       WHERE hymn_fts MATCH ? ORDER BY rank, hymn.number
       LIMIT ${SEARCH_LIMIT + 1} OFFSET ${Math.max(0, Math.floor(offset))}`,
      [...words, matchQuery],
    )
    .map((row) => ({
      number: row.number as number,
      title: row.title as string,
      snippet: (row.snippet as string | null) ?? "",
    }));
  // One row more than a page was asked for: it says whether another page follows.
  return { results: rows.slice(0, SEARCH_LIMIT), more: rows.length > SEARCH_LIMIT };
}

/** The first page of a book's matches (SDD-0001 §13). */
export function searchBook(sql: Sql, query: string): SearchResult[] {
  return searchBookPage(sql, query).results;
}

/**
 * The books to search, in the order their groups are shown (SDD-0001 §13.1):
 * the current book first, then the rest in the Library's order. Only a book
 * whose state is `ok` is searched.
 */
export function searchOrder(books: readonly BookRow[], currentKey: string): BookRow[] {
  const ok = libraryOrder(books).filter((book) => book.state === "ok");
  return [...ok.filter((b) => b.key === currentKey), ...ok.filter((b) => b.key !== currentKey)];
}

/**
 * Searches every readable book with `search`, in {@link searchOrder}. A book
 * with no match, or that throws (unreadable, evicted), is left out: one bad
 * book must not hide the others' results.
 */
export function searchBooks(
  books: readonly BookRow[],
  currentKey: string,
  search: (book: BookRow) => SearchResult[] | SearchPage,
): BookHits[] {
  const hits: BookHits[] = [];
  for (const book of searchOrder(books, currentKey)) {
    try {
      const found = search(book);
      const page = Array.isArray(found) ? { results: found, more: false } : found;
      if (page.results.length > 0) {
        hits.push({ key: book.key, title: book.title, results: page.results, more: page.more });
      }
    } catch {
      // not readable now; its row in the Library says why
    }
  }
  return hits;
}
