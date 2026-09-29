import type { SearchProvider, SearchResult, SearchOptions } from './search.interface';
import type { ResolvedProviders } from '../../services/providers.service';
import {
  ProviderCreditError,
  buildProviderCreditAlert,
  isCreditFailureText,
} from '../../lib/provider-credits';

export type { SearchProvider, SearchResult, SearchOptions };

export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';
  constructor(private apiKey: string) {}

  async search(query: string, maxResultsOrOpts: number | SearchOptions = 5): Promise<SearchResult[]> {
    if (!this.apiKey) throw new Error('Search API key not configured. Add it in Settings → Integrations.');

    const opts: SearchOptions =
      typeof maxResultsOrOpts === 'number' ? { maxResults: maxResultsOrOpts } : maxResultsOrOpts;
    const maxResults = opts.maxResults ?? 5;
    const days = opts.days ?? 7;

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: maxResults,
        include_answer: false,
        include_images: true,
        topic: 'news',
        days,
        search_depth: 'basic',
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      if (isCreditFailureText(`tavily ${body}`, response.status)) {
        throw new ProviderCreditError(buildProviderCreditAlert('tavily', 'search'));
      }
      throw new Error(`Tavily search failed (${response.status}): ${body}`);
    }

    const data = await response.json() as {
      results: Array<{
        title: string;
        url: string;
        content: string;
        published_date?: string;
        image_url?: string;
        images?: Array<string | { url?: string }>;
      }>;
      images?: string[];
    };

    return data.results.map((r) => {
      const fromResult =
        (typeof r.image_url === 'string' && r.image_url.trim()) ||
        (Array.isArray(r.images)
          ? r.images
              .map((img) => (typeof img === 'string' ? img : img?.url || ''))
              .find((u) => /^https?:\/\//i.test(u))
          : '') ||
        '';
      return {
        title: r.title,
        url: r.url,
        snippet: r.content,
        publishedDate: r.published_date,
        ...(fromResult ? { imageUrl: fromResult } : {}),
      };
    });
  }
}

export class SerpApiSearchProvider implements SearchProvider {
  readonly name = 'serpapi';
  constructor(private apiKey: string) {}

  async search(query: string, maxResultsOrOpts: number | SearchOptions = 5): Promise<SearchResult[]> {
    if (!this.apiKey) throw new Error('Search API key not configured. Add it in Settings → Integrations.');

    const opts: SearchOptions =
      typeof maxResultsOrOpts === 'number' ? { maxResults: maxResultsOrOpts } : maxResultsOrOpts;
    const maxResults = opts.maxResults ?? 5;

    const params = new URLSearchParams({
      q: query,
      api_key: this.apiKey,
      engine: 'google_news',
      num: String(maxResults),
      // Past week when supported by Google News via SerpAPI
      tbs: 'qdr:w',
    });

    const response = await fetch(`https://serpapi.com/search?${params}`);
    if (!response.ok) {
      throw new Error(`SerpAPI search failed (${response.status}): ${await response.text()}`);
    }

    const data = await response.json() as {
      news_results?: Array<{
        title: string;
        link: string;
        snippet: string;
        date?: string;
        thumbnail?: string;
      }>;
    };

    return (data.news_results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      publishedDate: r.date,
      ...(r.thumbnail && /^https?:\/\//i.test(r.thumbnail) ? { imageUrl: r.thumbnail } : {}),
    }));
  }
}

export function createSearchProvider(providers: ResolvedProviders): SearchProvider {
  if (providers.searchProvider === 'serpapi') {
    return new SerpApiSearchProvider(providers.serpapiApiKey ?? '');
  }
  return new TavilySearchProvider(providers.tavilyApiKey ?? '');
}
