import fs from 'fs';
import path from 'path';
import { resolveProviders } from './providers.service';
import { createSearchProvider } from '../providers/search';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import {
  countryLabels,
  normalizeTargetCountries,
  resolveMarketCountries,
  type MarketCountry,
} from '../lib/market-countries';
import { MEME_FORMAT_CATALOG, type MemeFormat } from './meme-format-catalog';

export type MemeTrendSignal = {
  title: string;
  url?: string;
  snippet?: string;
};

export type MemeDiscoverSource =
  | 'meme_api'
  | 'imgflip'
  | 'reddit'
  | 'google_trends'
  | 'tavily'
  | 'serpapi'
  | 'apify'
  | 'catalog';

export type MemeCandidate = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: MemeDiscoverSource;
  country: string;
  countryLabel: string;
  suggestedFormatId?: string;
  publishedDate?: string;
  imageUrl?: string;
  imageUrls?: string[];
  postText?: string;
};

function guessFormatId(text: string): string | undefined {
  const t = text.toLowerCase();
  if (/expect|reality|vs\b/.test(t)) return 'expectation_vs_reality';
  if (/drake|reject|approve|nah|hell yes|hotline/.test(t)) return 'reject_approve';
  if (/expanding brain|galaxy brain/.test(t)) return 'expanding_brain';
  if (/distracted|boyfriend/.test(t)) return 'distracted_choice';
  if (/this is fine|on fire/.test(t)) return 'this_is_fine';
  if (/waiting|still waiting|loading/.test(t)) return 'waiting';
  if (/trade offer/.test(t)) return 'trade_offer';
  if (/one does not simply|boromir/.test(t)) return 'one_does_not_simply';
  if (/two buttons|buttons/.test(t)) return 'reject_approve';
  return undefined;
}

function candidateId(source: string, url: string, title: string): string {
  const raw = `${source}:${url || title}`.slice(0, 180);
  return Buffer.from(raw).toString('base64url').slice(0, 48);
}

function absoluteSourceUrl(raw?: string): string {
  const u = (raw || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return `https://www.reddit.com${u}`;
  if (/^redd\.it\//i.test(u)) return `https://${u}`;
  return `https://${u.replace(/^\/+/, '')}`;
}

async function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url: string, timeoutMs = 12000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** Download remote meme art into tenant uploads so the UI always has a stable URL. */
async function cacheMemeImage(tenantId: string, remoteUrl: string): Promise<string | null> {
  try {
    const res = await fetch(remoteUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) return null;
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    const ext = ctype.includes('png')
      ? 'png'
      : ctype.includes('webp')
        ? 'webp'
        : ctype.includes('gif')
          ? 'gif'
          : 'jpg';
    const dir = path.resolve(config.UPLOAD_DIR, tenantId, 'meme-cache');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    fs.writeFileSync(path.join(dir, filename), buf);
    return `/uploads/${tenantId}/meme-cache/${filename}`;
  } catch {
    return null;
  }
}

async function withCachedImages(
  tenantId: string,
  rows: MemeCandidate[],
): Promise<MemeCandidate[]> {
  const out: MemeCandidate[] = [];
  for (const row of rows) {
    const remote = row.imageUrl || row.imageUrls?.[0];
    if (!remote || remote.startsWith('/uploads/')) {
      out.push(row);
      continue;
    }
    const cached = await cacheMemeImage(tenantId, remote);
    if (cached) {
      out.push({
        ...row,
        imageUrl: cached,
        imageUrls: [cached, ...(row.imageUrls || []).filter((u) => u !== remote)].slice(0, 4),
      });
    } else {
      // Keep remote URL — browser may still load i.redd.it / imgflip
      out.push(row);
    }
  }
  return out;
}

/**
 * Free visual memes via meme-api.com (proxies Reddit hot posts with image URLs).
 * Direct reddit.com JSON is often 403 from datacenter IPs.
 */
async function scrapeMemeApiFree(
  markets: MarketCountry[],
  perSub = 10,
): Promise<MemeCandidate[]> {
  type MemeApiItem = {
    postLink?: string;
    subreddit?: string;
    title?: string;
    url?: string;
    nsfw?: boolean;
    spoiler?: boolean;
    ups?: number;
    preview?: string[];
  };

  const out: MemeCandidate[] = [];
  const seen = new Set<string>();
  const subs = new Map<string, string>();

  for (const m of markets) {
    for (const sub of m.redditSubs.slice(0, 4)) {
      if (!subs.has(sub.toLowerCase())) subs.set(sub.toLowerCase(), m.code);
    }
  }

  for (const [sub, country] of subs) {
    try {
      const data = await fetchJson<MemeApiItem & { count?: number; memes?: MemeApiItem[] }>(
        `https://meme-api.com/gimme/${encodeURIComponent(sub)}/${perSub}`,
      );

      const list: MemeApiItem[] = Array.isArray(data.memes)
        ? data.memes
        : data.url
          ? [data]
          : [];
      const market = markets.find((m) => m.code === country) || markets[0]!;

      for (const item of list) {
        if (!item.title || item.nsfw) continue;
        const image = (item.url || item.preview?.[item.preview.length - 1] || '').trim();
        if (!image || !/^https?:\/\//i.test(image)) continue;
        const postUrl = absoluteSourceUrl(item.postLink) || image;
        if (seen.has(image)) continue;
        seen.add(image);
        out.push({
          id: candidateId('meme_api', image, item.title),
          title: item.title.slice(0, 180),
          url: postUrl,
          snippet: `r/${item.subreddit || sub}${typeof item.ups === 'number' ? ` · ${item.ups} ups` : ''} — visual meme`,
          source: 'meme_api',
          country: market.code,
          countryLabel: market.label,
          suggestedFormatId: guessFormatId(item.title),
          imageUrl: image,
          imageUrls: [image, ...(item.preview || []).filter((p) => p !== image)].slice(0, 4),
          postText: item.title,
        });
      }
    } catch {
      // next sub
    }
  }
  return out;
}

/** Free classic meme templates with images (Imgflip public API). */
async function scrapeImgflipFree(markets: MarketCountry[]): Promise<MemeCandidate[]> {
  const market = markets[0]!;
  try {
    const data = await fetchJson<{
      success?: boolean;
      data?: {
        memes?: Array<{
          id?: string;
          name?: string;
          url?: string;
          box_count?: number;
        }>;
      };
    }>('https://api.imgflip.com/get_memes');
    const memes = data.data?.memes || [];
    return memes.slice(0, 16).map((m) => {
      const image = m.url || '';
      const name = m.name || 'Meme template';
      return {
        id: candidateId('imgflip', m.id || image, name),
        title: name,
        url: image ? `https://imgflip.com/memegenerator/${m.id || ''}` : 'https://imgflip.com',
        snippet: `Popular format · ${m.box_count || 2} text boxes — use as layout reference`,
        source: 'imgflip' as const,
        country: market.code,
        countryLabel: market.label,
        suggestedFormatId: guessFormatId(name),
        imageUrl: image,
        imageUrls: image ? [image] : [],
        postText: name,
      };
    }).filter((c) => c.imageUrl);
  } catch {
    return [];
  }
}

/** Culture cues only (titles) — fixed working Google Trends explore links. */
async function scrapeGoogleTrendsFree(markets: MarketCountry[]): Promise<MemeCandidate[]> {
  const out: MemeCandidate[] = [];
  const seen = new Set<string>();

  for (const m of markets) {
    const geo = m.trendsGeo || 'US';
    const geos = m.code === 'worldwide' ? ['US', 'IN', 'GB'] : [geo];

    for (const g of geos) {
      try {
        const xml = await fetchText(
          `https://trends.google.com/trending/rss?geo=${encodeURIComponent(g)}`,
        );
        const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/gi)].slice(0, 6);
        for (const mItem of items) {
          const block = mItem[0];
          const title =
            block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i)?.[1] ||
            block.match(/<title>(.*?)<\/title>/i)?.[1] ||
            '';
          const cleanTitle = title.replace(/<[^>]+>/g, '').trim();
          if (!cleanTitle || seen.has(cleanTitle)) continue;
          seen.add(cleanTitle);
          const explore = `https://trends.google.com/trends/explore?q=${encodeURIComponent(cleanTitle)}&geo=${encodeURIComponent(g)}`;
          out.push({
            id: candidateId('google_trends', explore, cleanTitle),
            title: `Trending topic: ${cleanTitle}`.slice(0, 180),
            url: explore,
            snippet: `Google Trends (${m.code === 'worldwide' ? `global/${g}` : m.label}) — culture cue (no image)`,
            source: 'google_trends',
            country: m.code,
            countryLabel: m.label,
            suggestedFormatId: guessFormatId(cleanTitle),
            postText: cleanTitle,
          });
        }
      } catch {
        // next
      }
    }
  }
  return out;
}

async function scrapeViaSearchProvider(
  tenantId: string,
  markets: MarketCountry[],
  industry: string,
): Promise<{ candidates: MemeCandidate[]; provider: 'tavily' | 'serpapi' | null }> {
  const providers = await resolveProviders(tenantId);
  const out: MemeCandidate[] = [];
  const seen = new Set<string>();
  let providerName: 'tavily' | 'serpapi' | null = null;

  try {
    const search = createSearchProvider(providers);
    providerName = providers.searchProvider === 'serpapi' ? 'serpapi' : 'tavily';

    for (const m of markets) {
      const where = m.code === 'worldwide' ? 'worldwide' : `${m.label} (${m.code})`;
      const queries = [
        `trending memes ${where} this week`,
        `viral meme image ${where}`,
        `${industry} meme viral ${where}`,
      ];
      for (const q of queries) {
        try {
          const results = await search.search(q, { maxResults: 4, days: 14 });
          for (const r of results) {
            const key = r.url || r.title;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            const href = absoluteSourceUrl(r.url);
            out.push({
              id: candidateId(providerName, href || r.title, r.title),
              title: r.title.slice(0, 180),
              url: href,
              snippet: (r.snippet || '').slice(0, 280),
              source: providerName,
              country: m.code,
              countryLabel: m.label,
              suggestedFormatId: guessFormatId(`${r.title} ${r.snippet || ''}`),
              publishedDate: r.publishedDate,
              postText: r.title,
            });
          }
        } catch {
          // continue
        }
      }
    }
  } catch {
    return { candidates: [], provider: null };
  }

  return { candidates: out, provider: providerName };
}

async function scrapeViaApify(
  tenantId: string,
  markets: MarketCountry[],
): Promise<MemeCandidate[]> {
  const providers = await resolveProviders(tenantId);
  const token = (providers.apifyApiToken || '').trim();
  if (!token) return [];

  const out: MemeCandidate[] = [];
  const seen = new Set<string>();
  const subs = [...new Set(markets.flatMap((m) => m.redditSubs.slice(0, 2)))].slice(0, 4);
  const actorId = 'trudax~reddit-scraper-lite';

  try {
    const runUrl =
      `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/runs?waitForFinish=90`;
    const runResponse = await fetch(runUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startUrls: subs.map((s) => ({ url: `https://www.reddit.com/r/${s}/hot/` })),
        maxItems: 20,
        maxPostCount: 10,
        skipComments: true,
      }),
    });
    if (!runResponse.ok) return [];
    const run = (await runResponse.json()) as {
      data?: { defaultDatasetId?: string; status?: string };
    };
    const datasetId = run.data?.defaultDatasetId;
    if (!datasetId) return [];

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?limit=25`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!itemsRes.ok) return [];
    const items = (await itemsRes.json()) as Array<{
      title?: string;
      url?: string;
      body?: string;
      communityName?: string;
      imageUrls?: string[];
      imageUrl?: string;
      thumbnailUrl?: string;
      previewUrl?: string;
    }>;
    const market = markets[0]!;
    for (const item of items) {
      if (!item.title) continue;
      const url = absoluteSourceUrl(item.url);
      const images = [
        ...(item.imageUrls || []),
        item.imageUrl,
        item.previewUrl,
        item.thumbnailUrl,
      ].filter((u): u is string => Boolean(u && /^https?:/i.test(u)));
      const key = images[0] || url || item.title;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: candidateId('apify', url || images[0] || '', item.title),
        title: item.title.slice(0, 180),
        url,
        snippet: (item.body || item.communityName || 'Apify Reddit scrape').slice(0, 280),
        source: 'apify',
        country: market.code,
        countryLabel: market.label,
        suggestedFormatId: guessFormatId(item.title),
        imageUrl: images[0],
        imageUrls: images,
        postText: item.title,
      });
    }
  } catch {
    return [];
  }
  return out;
}

function catalogFallback(markets: MarketCountry[]): MemeCandidate[] {
  const market = markets[0]!;
  return [...MEME_FORMAT_CATALOG]
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 6)
    .map((f) => ({
      id: candidateId('catalog', f.id, f.label),
      title: `${f.label} (evergreen high-engagement format)`,
      url: '',
      snippet: `${f.structure} · Use when: ${f.useWhen}`,
      source: 'catalog' as const,
      country: market.code,
      countryLabel: market.label,
      suggestedFormatId: f.id,
      postText: f.label,
    }));
}

export type MemeDiscoverResult = {
  countries: string[];
  countryLabels: string;
  providersTried: string[];
  primaryProvider: string;
  candidates: MemeCandidate[];
  visualCount: number;
  formats: Array<Pick<MemeFormat, 'id' | 'label' | 'structure' | 'heat'>>;
};

/**
 * Discover trending meme visuals for the brand's selected countries.
 * Priority: meme-api (images) → Imgflip → Apify if few visuals → culture cues last.
 */
export async function discoverMemeCandidates(
  tenantId: string,
  opts: { limit?: number } = {},
): Promise<MemeDiscoverResult> {
  const limit = Math.min(Math.max(opts.limit || 24, 5), 40);
  const brand = await prisma.brandSettings.findUnique({ where: { tenantId } });
  const markets = resolveMarketCountries(brand?.targetCountries);
  const industry = brand?.industry?.trim() || brand?.companyName || 'business';
  const providersTried: string[] = [];
  const merged: MemeCandidate[] = [];
  const seen = new Set<string>();

  const pushAll = (rows: MemeCandidate[]) => {
    for (const r of rows) {
      const key = (r.imageUrl || r.url || r.title).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({
        ...r,
        url: absoluteSourceUrl(r.url) || r.url,
      });
    }
  };

  // 1) Free visual sources (Reddit.com JSON is often blocked — use meme-api)
  providersTried.push('meme_api');
  pushAll(await scrapeMemeApiFree(markets, 12));

  providersTried.push('imgflip');
  pushAll(await scrapeImgflipFree(markets));

  const visualCountSoFar = () => merged.filter((c) => c.imageUrl).length;

  // 2) Apify when still few visuals (user may have token)
  if (visualCountSoFar() < 8) {
    const apifyRows = await scrapeViaApify(tenantId, markets);
    if (apifyRows.length) {
      providersTried.push('apify');
      pushAll(apifyRows);
    }
  }

  // 3) Culture cues (no images) — only if we already have visuals, keep them secondary
  providersTried.push('google_trends_free');
  const trends = await scrapeGoogleTrendsFree(markets);

  if (visualCountSoFar() < 6) {
    const paid = await scrapeViaSearchProvider(tenantId, markets, industry);
    if (paid.provider) providersTried.push(paid.provider);
    pushAll(paid.candidates);
  }

  // Attach trends after visuals so sort still prefers images
  pushAll(trends);

  if (visualCountSoFar() < 4 && merged.length < 4) {
    providersTried.push('catalog');
    pushAll(catalogFallback(markets));
  }

  // Cache remote images locally for reliable UI display
  const withImages = await withCachedImages(
    tenantId,
    merged.filter((c) => c.imageUrl),
  );
  const withoutImages = merged.filter((c) => !c.imageUrl);

  // Prefer visuals in the list the user browses; keep a few culture cues after
  const ranked = [
    ...withImages,
    ...withoutImages.slice(0, withImages.length >= 8 ? 4 : 8),
  ];

  const primaryProvider =
    ranked.find((c) => c.imageUrl)?.source ||
    ranked[0]?.source ||
    'catalog';

  const candidates = ranked.slice(0, limit);
  const visualCount = candidates.filter((c) => c.imageUrl).length;

  return {
    countries: normalizeTargetCountries(brand?.targetCountries),
    countryLabels: countryLabels(brand?.targetCountries),
    providersTried,
    primaryProvider,
    candidates,
    visualCount,
    formats: MEME_FORMAT_CATALOG.map((f) => ({
      id: f.id,
      label: f.label,
      structure: f.structure,
      heat: f.heat,
    })),
  };
}

export function candidatesToSignals(candidates: MemeCandidate[]): MemeTrendSignal[] {
  return candidates.map((c) => ({
    title: c.title,
    url: c.url || undefined,
    snippet: c.snippet,
  }));
}
