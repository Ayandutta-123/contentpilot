import { prisma } from '../lib/prisma';
import type { Prisma } from '@prisma/client';
import type { TrendCandidate } from './trends-discover.service';
import type { MemeCandidate } from './meme-discover.service';

export type DiscoverKind = 'trends' | 'meme';

const DEFAULT_LIMIT = 80;
const MAX_KEEP = 200;

function asPayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parsePublishedAt(raw?: string | null): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function trendExternalKey(c: Pick<TrendCandidate, 'url' | 'title' | 'topicId' | 'id'>): string {
  const url = (c.url || '').trim();
  if (url) return `url:${url.slice(0, 500)}`;
  return `id:${c.id || `${c.topicId}|${c.title}`}`;
}

function memeExternalKey(
  c: Pick<MemeCandidate, 'url' | 'imageUrl' | 'imageUrls' | 'id' | 'title'>,
): string {
  const img = (c.imageUrl || c.imageUrls?.[0] || '').trim();
  const url = (c.url || '').trim();
  if (img) return `img:${img.slice(0, 500)}`;
  if (url) return `url:${url.slice(0, 500)}`;
  return `id:${c.id || c.title}`;
}

/**
 * Soft-delete oldest retained scrapes beyond MAX_KEEP so the table stays bounded
 * while still mirroring competitor retention across reloads.
 */
async function pruneOldScrapes(tenantId: string, kind: DiscoverKind) {
  const keep = await prisma.scrapedDiscoverItem.findMany({
    where: { tenantId, kind, deletedAt: null },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true },
    take: MAX_KEEP,
  });
  if (keep.length < MAX_KEEP) return;
  const keepIds = keep.map((r) => r.id);
  await prisma.scrapedDiscoverItem.updateMany({
    where: {
      tenantId,
      kind,
      deletedAt: null,
      id: { notIn: keepIds },
    },
    data: { deletedAt: new Date() },
  });
}

export async function persistTrendCandidates(
  tenantId: string,
  candidates: TrendCandidate[],
): Promise<number> {
  if (!candidates.length) return 0;
  let saved = 0;
  for (const c of candidates) {
    const externalKey = trendExternalKey(c);
    const imageUrls = [c.imageUrl].filter((u): u is string => Boolean(u?.trim()));
    const data = {
      title: (c.title || '').slice(0, 500) || 'Untitled',
      url: (c.url || '').slice(0, 2000),
      snippet: (c.snippet || '').slice(0, 4000),
      source: 'trends',
      imageUrls,
      publishedAt: parsePublishedAt(c.publishedDate),
      payload: {
        topicId: c.topicId,
        topicName: c.topicName,
        publishedDate: c.publishedDate || null,
        candidateId: c.id,
      } as Prisma.InputJsonValue,
      deletedAt: null,
    };
    await prisma.scrapedDiscoverItem.upsert({
      where: {
        tenantId_kind_externalKey: { tenantId, kind: 'trends', externalKey },
      },
      create: {
        tenantId,
        kind: 'trends',
        externalKey,
        ...data,
      },
      update: data,
    });
    saved += 1;
  }
  await pruneOldScrapes(tenantId, 'trends');
  return saved;
}

export async function persistMemeCandidates(
  tenantId: string,
  candidates: MemeCandidate[],
  meta?: { providersTried?: string[]; primaryProvider?: string },
): Promise<number> {
  if (!candidates.length) return 0;
  let saved = 0;
  for (const c of candidates) {
    const externalKey = memeExternalKey(c);
    const imageUrls = Array.from(
      new Set(
        [c.imageUrl, ...(c.imageUrls || [])].filter((u): u is string => Boolean(u?.trim())),
      ),
    );
    const data = {
      title: (c.title || '').slice(0, 500) || 'Untitled',
      url: (c.url || '').slice(0, 2000),
      snippet: (c.snippet || '').slice(0, 4000),
      source: c.source || 'meme',
      imageUrls,
      publishedAt: parsePublishedAt(c.publishedDate),
      payload: {
        candidateId: c.id,
        country: c.country,
        countryLabel: c.countryLabel,
        suggestedFormatId: c.suggestedFormatId || null,
        publishedDate: c.publishedDate || null,
        postText: c.postText || null,
        providersTried: meta?.providersTried || [],
        primaryProvider: meta?.primaryProvider || null,
      } as Prisma.InputJsonValue,
      deletedAt: null,
    };
    await prisma.scrapedDiscoverItem.upsert({
      where: {
        tenantId_kind_externalKey: { tenantId, kind: 'meme', externalKey },
      },
      create: {
        tenantId,
        kind: 'meme',
        externalKey,
        ...data,
      },
      update: data,
    });
    saved += 1;
  }
  await pruneOldScrapes(tenantId, 'meme');
  return saved;
}

export async function listScrapedTrendCandidates(
  tenantId: string,
  opts?: { limit?: number },
): Promise<{ candidates: TrendCandidate[]; scrapedAt: string | null }> {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? DEFAULT_LIMIT));
  const rows = await prisma.scrapedDiscoverItem.findMany({
    where: { tenantId, kind: 'trends', deletedAt: null },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
  let scrapedAt: string | null = null;
  const candidates = rows.map((r) => {
    const p = asPayload(r.payload);
    if (!scrapedAt || r.updatedAt.toISOString() > scrapedAt) {
      scrapedAt = r.updatedAt.toISOString();
    }
    return {
      id: String(p.candidateId || r.id),
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      publishedDate:
        (typeof p.publishedDate === 'string' && p.publishedDate) ||
        r.publishedAt?.toISOString() ||
        undefined,
      topicId: String(p.topicId || ''),
      topicName: String(p.topicName || 'Topic'),
      imageUrl: r.imageUrls[0] || undefined,
    };
  });
  return { candidates, scrapedAt };
}

export async function listScrapedMemeCandidates(
  tenantId: string,
  opts?: { limit?: number },
): Promise<{
  candidates: MemeCandidate[];
  scrapedAt: string | null;
  providersTried: string[];
  primaryProvider: string;
  visualCount: number;
}> {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? DEFAULT_LIMIT));
  const rows = await prisma.scrapedDiscoverItem.findMany({
    where: { tenantId, kind: 'meme', deletedAt: null },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  let scrapedAt: string | null = null;
  const providersTried = new Set<string>();
  let primaryProvider = '';

  const candidates: MemeCandidate[] = rows.map((r) => {
    const p = asPayload(r.payload);
    if (!scrapedAt || r.updatedAt.toISOString() > scrapedAt) {
      scrapedAt = r.updatedAt.toISOString();
    }
    if (Array.isArray(p.providersTried)) {
      for (const x of p.providersTried) if (typeof x === 'string') providersTried.add(x);
    }
    if (!primaryProvider && typeof p.primaryProvider === 'string' && p.primaryProvider) {
      primaryProvider = p.primaryProvider;
    }
    const imageUrls = r.imageUrls.length
      ? r.imageUrls
      : typeof p.imageUrl === 'string' && p.imageUrl
        ? [p.imageUrl]
        : [];
    return {
      id: String(p.candidateId || r.id),
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      source: (
        [
          'meme_api',
          'imgflip',
          'reddit',
          'google_trends',
          'tavily',
          'serpapi',
          'apify',
          'catalog',
        ].includes(r.source)
          ? r.source
          : 'catalog'
      ) as MemeCandidate['source'],
      country: String(p.country || ''),
      countryLabel: String(p.countryLabel || ''),
      suggestedFormatId:
        typeof p.suggestedFormatId === 'string' && p.suggestedFormatId
          ? p.suggestedFormatId
          : undefined,
      publishedDate:
        (typeof p.publishedDate === 'string' && p.publishedDate) ||
        r.publishedAt?.toISOString() ||
        undefined,
      imageUrl: imageUrls[0],
      imageUrls,
      postText: typeof p.postText === 'string' ? p.postText : undefined,
    };
  });

  return {
    candidates,
    scrapedAt,
    providersTried: [...providersTried],
    primaryProvider: primaryProvider || candidates.find((c) => c.imageUrl)?.source || '',
    visualCount: candidates.filter((c) => c.imageUrl || c.imageUrls?.length).length,
  };
}
