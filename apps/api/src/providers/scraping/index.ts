import type { ScrapingProvider, CompetitorPost, CompetitorComment } from './scraping.interface';
import { sanitizeApiSecret } from '../../services/providers.service';
import {
  ProviderCreditError,
  buildProviderCreditAlert,
  isCreditFailureText,
} from '../../lib/provider-credits';

const ACTOR_MAP: Record<string, string> = {
  instagram: 'apify~instagram-scraper',
  linkedin: 'apify~linkedin-profile-scraper',
  facebook: 'apify~facebook-pages-scraper',
  twitter: 'apidojo~tweet-scraper',
};

function usernameFromUrl(platform: string, profileUrl?: string, fallback = ''): string {
  if (!profileUrl) return fallback.replace(/^@/, '');
  try {
    const u = new URL(profileUrl.includes('://') ? profileUrl : `https://${profileUrl}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (platform === 'linkedin' && (parts[0] === 'company' || parts[0] === 'in' || parts[0] === 'school')) {
      return parts[1] || parts[0] || fallback;
    }
    return (parts[0] || fallback).replace(/^@/, '');
  } catch {
    return fallback.replace(/^@/, '');
  }
}

function apifyAuthHeaders(token: string): Record<string, string> {
  const clean = sanitizeApiSecret(token);
  if (!clean) {
    throw new Error('Scraping API token is empty. Paste it in Settings → Integrations.');
  }
  return {
    Authorization: `Bearer ${clean}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

export class ApifyScrapingProvider implements ScrapingProvider {
  readonly name = 'apify';
  private token: string;

  constructor(token: string) {
    this.token = sanitizeApiSecret(token);
  }

  async scrapeProfile(
    platform: string,
    handle: string,
    profileUrl?: string,
  ): Promise<CompetitorPost[]> {
    if (!this.token) {
      throw new Error('Scraping API token not configured. Add it in Settings → Integrations.');
    }

    const actorId = ACTOR_MAP[platform];
    if (!actorId) {
      throw new Error(`No scrape job configured for platform: ${platform}`);
    }

    if (!profileUrl?.trim() && !handle?.trim()) {
      throw new Error(
        `No social profile URL saved for ${platform}. Add the competitor's ${platform} URL in Settings → Competitors.`,
      );
    }

    const input = this.buildInput(platform, handle, profileUrl);
    const headers = apifyAuthHeaders(this.token);
    // waitForFinish keeps one HTTP round-trip with Apify (max 120s server-side)
    const runUrl =
      `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs` +
      `?waitForFinish=120`;

    let runResponse: Response;
    try {
      runResponse = await fetch(runUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(input),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ByteString|greater than 255/i.test(msg)) {
        throw new Error(
          'Scraping token has invalid characters. Re-paste only the token from Settings → Integrations.',
        );
      }
      throw new Error(`Could not reach scraping service: ${msg}`);
    }

    if (runResponse.status === 401 || runResponse.status === 403) {
      throw new Error(
        'Scraping service rejected this API token. Paste a fresh token in Settings → Integrations.',
      );
    }

    if (!runResponse.ok) {
      const body = (await runResponse.text()).slice(0, 400);
      if (isCreditFailureText(`apify ${body}`, runResponse.status)) {
        throw new ProviderCreditError(buildProviderCreditAlert('apify', 'scrape'));
      }
      throw new Error(`Scrape run failed (${runResponse.status}): ${body}`);
    }

    const run = (await runResponse.json()) as {
      data: { id: string; defaultDatasetId: string; status: string; statusMessage?: string };
    };

    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.data.status)) {
      const detail = run.data.statusMessage
        ? `Scrape run ended with ${run.data.status}: ${run.data.statusMessage}`
        : `Scrape run ended with ${run.data.status}`;
      if (isCreditFailureText(`apify ${detail}`, null)) {
        throw new ProviderCreditError(buildProviderCreditAlert('apify', 'scrape'));
      }
      throw new Error(detail);
    }

    // If still running after waitForFinish window, poll briefly
    if (run.data.status !== 'SUCCEEDED') {
      await this.waitForRun(run.data.id);
    }

    const datasetResponse = await fetch(
      `https://api.apify.com/v2/datasets/${run.data.defaultDatasetId}/items?limit=20`,
      { headers },
    );
    if (!datasetResponse.ok) {
      throw new Error(`Scrape dataset fetch failed (${datasetResponse.status})`);
    }

    const items = (await datasetResponse.json()) as Record<string, unknown>[];
    const label = usernameFromUrl(platform, profileUrl, handle);
    return items.slice(0, 10).map((item) => this.normalizePost(platform, label, item));
  }

  /**
   * Prefer the exact saved profile URL from Settings. Never invent competitor profiles.
   */
  private buildInput(platform: string, handle: string, profileUrl?: string): Record<string, unknown> {
    const url = (profileUrl || '').trim();
    const user = usernameFromUrl(platform, url, handle);

    switch (platform) {
      case 'instagram':
        if (url) {
          return {
            directUrls: [url],
            resultsLimit: 10,
            resultsType: 'posts',
          };
        }
        return {
          usernames: [user],
          resultsLimit: 10,
          resultsType: 'posts',
        };
      case 'linkedin':
        if (!url) {
          throw new Error('LinkedIn scrape requires a saved LinkedIn profile/company URL.');
        }
        return { urls: [url] };
      case 'facebook':
        if (!url) {
          throw new Error('Facebook scrape requires a saved Facebook page URL.');
        }
        return { startUrls: [{ url }], resultsLimit: 10 };
      case 'twitter':
        if (url) {
          return {
            startUrls: [{ url }],
            maxItems: 10,
            includeSearchTerms: false,
          };
        }
        return {
          twitterHandles: [user],
          maxItems: 10,
          includeSearchTerms: false,
        };
      default:
        if (!url && !user) throw new Error(`Unsupported platform: ${platform}`);
        return url ? { startUrls: [{ url }] } : { query: user };
    }
  }

  private async waitForRun(runId: string, maxWaitMs = 180_000): Promise<void> {
    const headers = apifyAuthHeaders(this.token);
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const res = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
      if (!res.ok) {
        throw new Error(`Scrape status check failed (${res.status})`);
      }
      const data = (await res.json()) as {
        data: { status: string; statusMessage?: string };
      };
      if (data.data.status === 'SUCCEEDED') return;
      if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(data.data.status)) {
        const detail = data.data.statusMessage
          ? `Scrape run ${runId} ended with status: ${data.data.status} — ${data.data.statusMessage}`
          : `Scrape run ${runId} ended with status: ${data.data.status}`;
        if (isCreditFailureText(`apify ${detail}`, null)) {
          throw new ProviderCreditError(buildProviderCreditAlert('apify', 'scrape'));
        }
        throw new Error(detail);
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    throw new Error(`Scrape run ${runId} timed out after ${maxWaitMs}ms`);
  }

  private normalizePost(
    platform: string,
    handle: string,
    item: Record<string, unknown>,
  ): CompetitorPost {
    const imageUrls = this.extractImages(item);
    const comments = this.extractComments(item);

    return {
      platform,
      handle,
      content: String(item.caption ?? item.text ?? item.fullText ?? item.description ?? item.content ?? ''),
      postUrl: String(item.url ?? item.postUrl ?? item.link ?? item.twitterUrl ?? ''),
      postedAt: String(item.timestamp ?? item.date ?? item.postedAt ?? item.createdAt ?? ''),
      imageUrls,
      comments,
      engagement: {
        likes: Number(item.likesCount ?? item.likes ?? item.favoriteCount ?? 0),
        comments: Number(item.commentsCount ?? item.comments ?? item.replyCount ?? comments.length),
        shares: Number(item.sharesCount ?? item.shares ?? item.retweetCount ?? 0),
      },
    };
  }

  private extractImages(item: Record<string, unknown>): string[] {
    const images: string[] = [];
    const videos: string[] = [];
    const push = (v: unknown, asVideo = false) => {
      const add = (s: string) => {
        if (!/^https?:\/\//i.test(s)) return;
        const lower = s.toLowerCase();
        const videoish =
          asVideo ||
          /\.(mp4|mov|m4v|webm)(\?|#|$)/i.test(lower) ||
          lower.includes('/video/');
        if (videoish) videos.push(s);
        else images.push(s);
      };
      if (typeof v === 'string') add(v);
      else if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (typeof o.url === 'string') add(o.url);
        if (typeof o.src === 'string') add(o.src);
        if (typeof o.displayUrl === 'string') add(o.displayUrl);
        if (typeof o.thumbnailUrl === 'string') add(o.thumbnailUrl);
        if (typeof o.imageUrl === 'string') add(o.imageUrl);
        if (typeof o.videoUrl === 'string') {
          if (/^https?:\/\//i.test(o.videoUrl)) videos.push(o.videoUrl);
        }
      }
    };

    // Prefer still images / thumbnails over video files for Competitor Monitor thumbs.
    const imageFirst = [
      item.displayUrl,
      item.display_url,
      item.thumbnailUrl,
      item.thumbnail_url,
      item.thumbnailSrc,
      item.imageUrl,
      item.image,
      item.mediaUrl,
      ...(Array.isArray(item.images) ? item.images : []),
      ...(Array.isArray(item.media) ? item.media : []),
      ...(Array.isArray(item.childPosts) ? item.childPosts : []),
      ...(Array.isArray(item.sidecarChildren) ? item.sidecarChildren : []),
    ];
    for (const c of imageFirst) push(c);

    // Instagram image_versions2.candidates[0].url
    const versions = (item.image_versions2 || item.imageVersions2) as
      | { candidates?: Array<{ url?: string }> }
      | undefined;
    if (versions?.candidates?.length) {
      for (const c of versions.candidates) push(c?.url);
    }

    // Video poster / last-resort only if we found no still image.
    if (!images.length) {
      push(item.videoUrl, true);
      push(item.video_url, true);
    }

    const ordered = [...new Set([...images, ...videos])];
    return ordered.slice(0, 10);
  }

  private extractComments(item: Record<string, unknown>): CompetitorComment[] {
    const raw = item.latestComments ?? item.comments ?? item.replies;
    if (!Array.isArray(raw)) return [];
    return raw
      .slice(0, 20)
      .map((c) => {
        if (typeof c === 'string') return { text: c };
        const obj = c as Record<string, unknown>;
        return {
          author: String(obj.ownerUsername ?? obj.author ?? obj.user ?? ''),
          text: String(obj.text ?? obj.content ?? obj.comment ?? ''),
        };
      })
      .filter((c) => c.text.trim().length > 0);
  }
}

export function createScrapingProvider(token: string): ScrapingProvider {
  return new ApifyScrapingProvider(token);
}
