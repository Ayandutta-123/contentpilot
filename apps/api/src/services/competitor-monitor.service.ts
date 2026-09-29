import { prisma } from '../lib/prisma';
import { createScrapingProvider } from '../providers/scraping';
import { resolveProviders } from './providers.service';
import type { Prisma } from '@prisma/client';
import {
  cacheRemoteImageList,
  displayMediaUrl,
  mergeCachedImageUrls,
  preferLocalImageUrls,
} from '../lib/cache-remote-image';

export type ScrapedPostRow = {
  id: string;
  competitorId: string;
  competitorName: string;
  competitorHandle: string;
  platform: string;
  content: string;
  postUrl: string | null;
  imageUrls: string[];
  likes: number;
  commentsCount: number;
  shares: number;
  postedAt: string | null;
  createdAt: string;
  score: number;
};

function engagementScore(p: {
  likes: number;
  commentsCount: number;
  shares: number;
  postedAt: Date | null;
  createdAt: Date;
}): number {
  const engagement = p.likes * 1 + p.commentsCount * 3 + p.shares * 2;
  const when = p.postedAt || p.createdAt;
  const ageHours = Math.max(0, (Date.now() - when.getTime()) / 3_600_000);
  // Prefer high engagement, lightly boost fresher posts
  const freshness = Math.max(0, 48 - ageHours) * 0.5;
  return engagement + freshness;
}

export async function listScrapedCompetitorPosts(
  tenantId: string,
  opts?: { competitorId?: string; limit?: number; platforms?: string[] },
): Promise<ScrapedPostRow[]> {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 50));
  const platformFilter =
    opts?.platforms?.length
      ? opts.platforms.map((p) => p.toLowerCase()).filter(Boolean)
      : null;
  const rows = await prisma.scrapedCompetitorPost.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(opts?.competitorId ? { competitorId: opts.competitorId } : {}),
      ...(platformFilter?.length
        ? { platform: { in: platformFilter as Array<'instagram' | 'linkedin' | 'facebook' | 'twitter'> } }
        : {}),
      competitor: { deletedAt: null, isActive: true },
    },
    include: {
      competitor: { select: { id: true, name: true, handle: true } },
    },
    orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  // Soft-heal remote CDN URLs into local uploads — prioritize posts with no durable thumb.
  const scored = rows
    .map((r) => ({ r, score: engagementScore(r) }))
    .sort(
      (a, b) =>
        b.score - a.score || (b.r.postedAt?.getTime() || 0) - (a.r.postedAt?.getTime() || 0),
    );

  const needsHeal = scored.filter(({ r }) => {
    const urls = r.imageUrls || [];
    return (
      urls.some((u) => /^https?:\/\//i.test(u)) && !urls.some((u) => u.startsWith('/uploads/'))
    );
  }).slice(0, 16);

  await Promise.all(
    needsHeal.map(async ({ r }) => {
      const urls = r.imageUrls || [];
      // Try a few remotes only — expired Instagram URLs fail fast.
      const tryList = preferLocalImageUrls(urls).slice(0, 4);
      const cached = await cacheRemoteImageList(tenantId, tryList);
      const merged = mergeCachedImageUrls(cached, urls);
      if (
        merged.some((u) => u.startsWith('/uploads/')) &&
        merged.join('\0') !== urls.join('\0')
      ) {
        await prisma.scrapedCompetitorPost.update({
          where: { id: r.id },
          data: { imageUrls: merged },
        });
        r.imageUrls = merged;
      }
    }),
  );

  // Persist local-first ordering so thumbs stay durable across scrapes/UI loads.
  await Promise.all(
    scored.map(async ({ r }) => {
      const ordered = preferLocalImageUrls(r.imageUrls || []);
      if (ordered.join('\0') === (r.imageUrls || []).join('\0')) return;
      await prisma.scrapedCompetitorPost.update({
        where: { id: r.id },
        data: { imageUrls: ordered },
      });
      r.imageUrls = ordered;
    }),
  );

  return scored.map(({ r, score }) => ({
    id: r.id,
    competitorId: r.competitorId,
    competitorName: r.competitor.name,
    competitorHandle: r.competitor.handle,
    platform: r.platform,
    content: r.content,
    postUrl: r.postUrl,
    // Locals first; proxy remote CDN URLs so the browser is not blocked by hotlink rules.
    imageUrls: preferLocalImageUrls(r.imageUrls || [])
      .map((u) => displayMediaUrl(u))
      .filter(Boolean),
    likes: r.likes,
    commentsCount: r.commentsCount,
    shares: r.shares,
    postedAt: r.postedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    score,
  }));
}

export async function pickBestScrapedPost(
  tenantId: string,
  competitorId?: string,
  platforms?: string[],
) {
  const posts = await listScrapedCompetitorPosts(tenantId, {
    competitorId,
    platforms,
    limit: 40,
  });
  return posts[0] || null;
}

/** Networks we can scrape via Apify for Competitor Monitor. */
export const SCRAPE_PLATFORMS = ['instagram', 'linkedin', 'facebook', 'twitter'] as const;
export type ScrapePlatform = (typeof SCRAPE_PLATFORMS)[number];

/**
 * Resolve which profile URLs to scrape for one competitor.
 * Uses every saved social URL (instagram / linkedin / facebook / twitter),
 * optionally filtered to the channels the user (or automation) selected.
 */
export function resolveCompetitorScrapeTargets(
  competitor: {
    platform: string;
    handle: string;
    profileUrl?: string | null;
    socialUrls?: unknown;
  },
  platformsFilter?: string[] | null,
): Array<{ platform: ScrapePlatform; url: string; handle: string }> {
  const filter =
    platformsFilter?.length
      ? new Set(platformsFilter.map((p) => p.toLowerCase().trim()).filter(Boolean))
      : null;

  const urls =
    competitor.socialUrls &&
    typeof competitor.socialUrls === 'object' &&
    !Array.isArray(competitor.socialUrls)
      ? (competitor.socialUrls as Record<string, string>)
      : {};

  const targets: Array<{ platform: ScrapePlatform; url: string; handle: string }> = [];
  for (const platform of SCRAPE_PLATFORMS) {
    if (filter && !filter.has(platform)) continue;
    const fromMap = (urls[platform] || '').trim();
    const legacy =
      String(competitor.platform) === platform ? (competitor.profileUrl || '').trim() : '';
    const url = fromMap || legacy;
    if (!url) continue;
    targets.push({
      platform,
      url,
      handle: (competitor.handle || platform).replace(/^@/, ''),
    });
  }
  return targets;
}

/** Scrape active competitors across all (or selected) saved social channels. */
export async function scrapeCompetitors(
  tenantId: string,
  opts?: { competitorId?: string; platforms?: string[] },
): Promise<{
  scraped: number;
  competitors: number;
  posts: ScrapedPostRow[];
  errors: string[];
  platforms: string[];
}> {
  const providers = await resolveProviders(tenantId);
  if (!providers.apifyApiToken) {
    throw new Error('Scraping token not set. Add it in Settings → Integrations.');
  }

  const platformsFilter =
    opts?.platforms?.length
      ? opts.platforms.map((p) => p.toLowerCase()).filter(Boolean)
      : undefined;

  const competitors = await prisma.competitor.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isActive: true,
      ...(opts?.competitorId ? { id: opts.competitorId } : {}),
    },
    orderBy: [{ lastUsedAt: 'asc' }, { rotationOrder: 'asc' }],
  });

  if (competitors.length === 0) {
    throw new Error('No active competitors. Add them in Settings → Competitors.');
  }

  const scraper = createScrapingProvider(providers.apifyApiToken);
  let scraped = 0;
  const errors: string[] = [];
  let scrapeAttempts = 0;

  for (const competitor of competitors) {
    const targets = resolveCompetitorScrapeTargets(competitor, platformsFilter);
    if (!targets.length) {
      errors.push(
        `${competitor.name}: no ${
          platformsFilter?.length ? platformsFilter.join('/') : 'Instagram/LinkedIn/Facebook'
        } URL saved — add profile links in Settings → Competitors`,
      );
      continue;
    }

    let competitorHadSuccess = false;
    for (const target of targets) {
      scrapeAttempts += 1;
      try {
        const posts = await scraper.scrapeProfile(target.platform, target.handle, target.url);

        for (const p of posts.slice(0, 10)) {
          const postUrl = (p.postUrl || '').trim() || null;
          const imageUrls = await cacheRemoteImageList(tenantId, p.imageUrls);

          if (postUrl) {
            const existing = await prisma.scrapedCompetitorPost.findFirst({
              where: { tenantId, competitorId: competitor.id, postUrl, deletedAt: null },
            });
            if (existing) {
              const nextImages = mergeCachedImageUrls(imageUrls, existing.imageUrls || []);
              await prisma.scrapedCompetitorPost.update({
                where: { id: existing.id },
                data: {
                  platform: target.platform,
                  content: p.content || existing.content,
                  imageUrls: nextImages,
                  likes: p.engagement?.likes ?? existing.likes,
                  commentsCount: p.engagement?.comments ?? existing.commentsCount,
                  shares: p.engagement?.shares ?? existing.shares,
                  comments: (p.comments ?? existing.comments) as unknown as Prisma.InputJsonValue,
                },
              });
              continue;
            }
          }

          await prisma.scrapedCompetitorPost.create({
            data: {
              competitorId: competitor.id,
              tenantId,
              platform: target.platform,
              content: p.content,
              postUrl,
              imageUrls: preferLocalImageUrls(imageUrls),
              comments: (p.comments ?? []) as unknown as Prisma.InputJsonValue,
              likes: p.engagement?.likes ?? 0,
              commentsCount: p.engagement?.comments ?? 0,
              shares: p.engagement?.shares ?? 0,
              postedAt: (() => {
                if (!p.postedAt) return null;
                const d = new Date(p.postedAt);
                return Number.isNaN(d.getTime()) ? null : d;
              })(),
            },
          });
          scraped += 1;
        }
        competitorHadSuccess = true;
      } catch (err) {
        const { toProviderCreditError } = await import('../lib/provider-credits');
        const credit = toProviderCreditError(err, 'apify', 'scrape');
        if (credit) {
          throw credit;
        }
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${competitor.name} (${target.platform}): ${msg}`);
      }
    }

    if (competitorHadSuccess) {
      await prisma.competitor.update({
        where: { id: competitor.id },
        data: { lastUsedAt: new Date() },
      });
    }
  }

  if (scraped === 0 && errors.length > 0 && scrapeAttempts > 0 && errors.length >= scrapeAttempts) {
    const joined = new Error(errors.join(' · '));
    const { toProviderCreditError } = await import('../lib/provider-credits');
    const credit = toProviderCreditError(joined, 'apify', 'scrape');
    if (credit) throw credit;
    throw joined;
  }

  const posts = await listScrapedCompetitorPosts(tenantId, {
    competitorId: opts?.competitorId,
    platforms: platformsFilter,
    limit: 50,
  });

  return {
    scraped,
    competitors: competitors.length,
    posts,
    errors,
    platforms: platformsFilter || [...SCRAPE_PLATFORMS],
  };
}
