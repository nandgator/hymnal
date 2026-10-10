import type { HymnbookId, HymnNumber } from "../domain/types.ts";
import type { ContentStore } from "../persistence/content-store.ts";

/** One song a source found. `book` is where it lives: picking it hands that book on. */
export interface FinderItem {
  number: HymnNumber;
  title: string;
  /** The matched lyric line, when it adds something beyond the title. */
  snippet?: string;
  book: HymnbookId;
}

/** What one source found: a group under its own heading, never merged with another's. */
export interface FinderGroup {
  id: string;
  title: string;
  /** The book now open: its group shows every result, the others a few. */
  current: boolean;
  items: FinderItem[];
}

export interface SearchContext {
  store: ContentStore;
  /** The book now open (SDD-0001 §13.1). */
  currentKey: HymnbookId;
}

/**
 * Something the Finder searches on its own terms (ADR-0032). Books are the only
 * one built; arrangements, the queue and annotations join this list as sources
 * of their own, each with its own matcher.
 */
export interface FinderSource {
  id: string;
  search(query: string, context: SearchContext): Promise<FinderGroup[]>;
}

/** Every held book, the current one first. */
const bookSource: FinderSource = {
  id: "books",
  async search(query, { store, currentKey }) {
    const hits = await store.searchAll(query, currentKey);
    return hits.map((book) => ({
      id: book.key,
      title: book.title,
      current: book.key === currentKey,
      items: book.results.map((result) => ({
        number: result.number,
        title: result.title,
        // The matched line is often the first line, which is the title.
        snippet: result.snippet !== result.title ? result.snippet : undefined,
        book: book.key,
      })),
    }));
  },
};

export const SOURCES: readonly FinderSource[] = [bookSource];

/** The sources' groups, in the sources' order. */
export async function searchSources(
  sources: readonly FinderSource[],
  query: string,
  context: SearchContext,
): Promise<FinderGroup[]> {
  const found = await Promise.all(sources.map((source) => source.search(query, context)));
  return found.flat();
}
