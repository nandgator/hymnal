import type { HymnbookId, HymnNumber } from "../domain/types.ts";
import type { BookHits, ContentStore } from "../persistence/content-store.ts";

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
  /** More results follow the last item, to be fetched on demand (Board #66). */
  more?: boolean;
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
  /** The songs numbered `typed` or starting with it (ADR-0032, amended); a source without
   * numbers leaves this out. */
  searchNumber?(typed: string, context: SearchContext): Promise<FinderGroup[]>;
  /** The next page of one group's results, after the `offset` already listed (Board #66); a
   * source whose groups are whole leaves this out. */
  more?(group: string, query: string, offset: number, context: SearchContext): Promise<MorePage>;
}

/** The next results of a group, and whether still more follow. */
export interface MorePage {
  items: FinderItem[];
  more: boolean;
}

/** A book's hits as a group of its own. */
const itemOf = (book: HymnbookId, result: BookHits["results"][number]): FinderItem => ({
  number: result.number,
  title: result.title,
  // The matched line is often the first line, which is the title.
  snippet: result.snippet && result.snippet !== result.title ? result.snippet : undefined,
  book,
});

const bookGroups = (hits: BookHits[], currentKey: HymnbookId): FinderGroup[] =>
  hits.map((book) => ({
    id: book.key,
    title: book.title,
    current: book.key === currentKey,
    items: book.results.map((result) => itemOf(book.key, result)),
    ...(book.more ? { more: true } : {}),
  }));

/** Every held book, the current one first. */
const bookSource: FinderSource = {
  id: "books",
  async search(query, { store, currentKey }) {
    return bookGroups(await store.searchAll(query, currentKey), currentKey);
  },
  async searchNumber(typed, { store, currentKey }) {
    return bookGroups(await store.searchNumber(typed, currentKey), currentKey);
  },
  async more(group, query, offset, { store }) {
    const page = await store.searchMore(group, query, offset);
    return { items: page.results.map((result) => itemOf(group, result)), more: page.more };
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

/** The next page of a group, from the source that has it: none, for a source that is whole. */
export async function searchSourcesMore(
  sources: readonly FinderSource[],
  group: string,
  query: string,
  offset: number,
  context: SearchContext,
): Promise<MorePage> {
  for (const source of sources) {
    if (source.more) return source.more(group, query, offset, context);
  }
  return { items: [], more: false };
}

/** The sources' groups for a typed number, in the sources' order. */
export async function searchSourcesByNumber(
  sources: readonly FinderSource[],
  typed: string,
  context: SearchContext,
): Promise<FinderGroup[]> {
  const found = await Promise.all(sources.map((source) => source.searchNumber?.(typed, context)));
  return found.flatMap((groups) => groups ?? []);
}
