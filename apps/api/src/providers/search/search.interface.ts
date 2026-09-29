export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  /** Hero/thumbnail from the search provider when available (exact article image). */
  imageUrl?: string;
}

export type SearchOptions = {
  maxResults?: number;
  /** Restrict to roughly the last N days when the provider supports it */
  days?: number;
};

export interface SearchProvider {
  readonly name: string;
  search(query: string, maxResultsOrOpts?: number | SearchOptions): Promise<SearchResult[]>;
}
