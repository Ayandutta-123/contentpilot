import { createHash } from 'crypto';
import { prisma } from '../lib/prisma';
import { resolveProviders } from './providers.service';
import { createSearchProvider, type SearchProvider, type SearchResult } from '../providers/search';
import { countryLabels, normalizeTargetCountries } from '../lib/market-countries';

export type TrendCandidate = SearchResult & {
  id: string;
  topicId: string;
  topicName: string;
};

/**
 * Stable unique id per article. Do NOT use truncated base64 of the raw URL —
 * same-host articles share a long prefix and collided after .slice(0, 24),
 * which made two news cards share one checkbox selection key in the UI.
 */
export function makeTrendCandidateId(topicId: string, url: string, title: string): string {
  const key = `${topicId}\0${(url || '').trim()}\0${(title || '').trim()}`;
  return createHash('sha256').update(key).digest('base64url').slice(0, 28);
}

export type TrendTopicRow = { id: string; name: string; searchKeywords: string | null };

export type TrendDiscoverContext = {
  topics: TrendTopicRow[];
  search: SearchProvider;
  industry?: string;
  geoHint: string;
};

export async function loadTrendDiscoverContext(tenantId: string): Promise<TrendDiscoverContext> {
  const [topics, brand, providers] = await Promise.all([
    prisma.topic.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      orderBy: { rotationOrder: 'asc' },
      select: { id: true, name: true, searchKeywords: true },
    }),
    prisma.brandSettings.findUnique({ where: { tenantId } }),
    resolveProviders(tenantId),
  ]);

  if (topics.length === 0) {
    throw new Error('No active topics configured. Add them in Settings → Topics.');
  }

  const markets = normalizeTargetCountries(brand?.targetCountries);
  const geoHint = markets.includes('worldwide') ? '' : countryLabels(markets);

  return {
    topics,
    search: createSearchProvider(providers),
    industry: brand?.industry?.trim() || undefined,
    geoHint,
  };
}

export function candidateDedupeKey(c: Pick<TrendCandidate, 'url' | 'title' | 'topicId'>): string {
  return c.url || `${c.title}|${c.topicId}`;
}

export async function searchTopicTrends(
  ctx: TrendDiscoverContext,
  topic: TrendTopicRow,
  opts: { days: number; perTopic: number },
): Promise<TrendCandidate[]> {
  const base = topic.searchKeywords || topic.name;
  const query = [
    ctx.industry ? `${base} ${ctx.industry}` : `${base} industry`,
    ctx.geoHint ? `in ${ctx.geoHint}` : '',
    `news last ${opts.days} days`,
  ]
    .filter(Boolean)
    .join(' ');

  const results = await ctx.search.search(query, {
    maxResults: opts.perTopic,
    days: opts.days,
  });

  const usedIds = new Set<string>();
  return results.map((r: SearchResult, index: number) => {
    let id = makeTrendCandidateId(topic.id, r.url || '', r.title || '');
    // Absolute uniqueness within the batch (empty URL + duplicate titles)
    if (usedIds.has(id)) {
      id = makeTrendCandidateId(topic.id, r.url || '', `${r.title || ''}\0${index}`);
    }
    usedIds.add(id);
    return {
      ...r,
      id,
      topicId: topic.id,
      topicName: topic.name,
    };
  });
}

/**
 * Discover past-N-days industry news for all active topics (sync helper).
 * Prefer startTrendsDiscoverJob for UI — avoids proxy timeouts on large topic lists.
 */
export async function discoverTrendCandidates(
  tenantId: string,
  opts?: { days?: number; perTopic?: number },
): Promise<{
  days: number;
  candidates: TrendCandidate[];
  topics: TrendTopicRow[];
}> {
  const days = opts?.days ?? 7;
  const perTopic = opts?.perTopic ?? 5;
  const ctx = await loadTrendDiscoverContext(tenantId);
  const seen = new Set<string>();
  const candidates: TrendCandidate[] = [];

  for (const topic of ctx.topics) {
    const batch = await searchTopicTrends(ctx, topic, { days, perTopic });
    for (const c of batch) {
      const key = candidateDedupeKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(c);
    }
  }

  return { days, candidates, topics: ctx.topics };
}
