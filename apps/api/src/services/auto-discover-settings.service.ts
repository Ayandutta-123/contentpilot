import { prisma } from '../lib/prisma';
import { LLMService } from './llm.service';
import { resolveProviders } from './providers.service';
import { createSearchProvider, type SearchResult } from '../providers/search';
import { scrapeBrandWebsite } from './brand-website-scrape.service';

const MAX_COMPETITORS = 12;
const MAX_TOPICS = 15;

export type AutoCompetitorCandidate = {
  name: string;
  platform: 'instagram' | 'linkedin' | 'facebook' | 'twitter';
  socialUrls: Record<string, string>;
  website?: string;
};

export type AutoTopicCandidate = {
  name: string;
  searchKeywords: string;
};

function ensureUrl(raw: string): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  try {
    const url = v.includes('://') ? v : `https://${v}`;
    // eslint-disable-next-line no-new
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

function extractSocialUrlsFromText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const ig = text.match(/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/i);
  if (ig?.[1] && !/p\/|reel\/|stories\//i.test(ig[0])) {
    out.instagram = `https://instagram.com/${ig[1]}`;
  }
  const fb = text.match(/https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9.]+)/i);
  if (fb?.[1] && !/sharer|share\.php/i.test(fb[0])) {
    out.facebook = `https://facebook.com/${fb[1]}`;
  }
  const li = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([A-Za-z0-9._%-]+)/i);
  if (li?.[1]) {
    out.linkedin = `https://www.linkedin.com/company/${li[1]}`;
  }
  const tw = text.match(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i);
  if (tw?.[1] && !/intent|share/i.test(tw[1])) {
    out.twitter = `https://x.com/${tw[1]}`;
  }
  return out;
}

function platformFromSocial(social: Record<string, string>): AutoCompetitorCandidate['platform'] {
  if (social.instagram) return 'instagram';
  if (social.linkedin) return 'linkedin';
  if (social.facebook) return 'facebook';
  if (social.twitter) return 'twitter';
  return 'instagram';
}

function handleFromUrl(platform: string, url: string | null | undefined, fallbackName: string): string {
  if (!url) {
    return fallbackName.toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 64) || 'competitor';
  }
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (platform === 'linkedin' && (parts[0] === 'company' || parts[0] === 'in')) {
      return parts.slice(0, 2).join('/') || parts[0];
    }
    return (parts[0] || '').replace(/^@/, '') || fallbackName.toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 64) || 'competitor';
  } catch {
    return fallbackName.toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 64) || 'competitor';
  }
}

async function loadBrandContext(tenantId: string, websiteOverride?: string) {
  const brand = await prisma.brandSettings.findUnique({ where: { tenantId } });
  if (!brand) throw new Error('Brand settings not found. Save Company details first.');

  let websiteUrl = (websiteOverride || brand.websiteUrl || '').trim();
  let companyName = (brand.companyName || '').trim();
  let productName = (brand.productName || '').trim();
  let industry = (brand.industry || '').trim();
  let audience = (brand.targetAudience || '').trim();
  let scrapedPages = 0;

  if (!websiteUrl && !companyName) {
    throw new Error('Add a company website (or company name) in Settings → Company first.');
  }

  // Scrape website when we have a URL and thin brand context
  if (websiteUrl && (!industry || !companyName || !productName)) {
    try {
      const profile = await scrapeBrandWebsite(tenantId, websiteUrl);
      scrapedPages = profile.pagesScraped;
      companyName = companyName || profile.companyName || '';
      productName = productName || profile.productName || '';
      industry = industry || profile.industry || '';
      audience = audience || profile.targetAudience || '';
      // Persist light fills so future autos are faster
      await prisma.brandSettings.update({
        where: { tenantId },
        data: {
          ...(brand.companyName ? {} : companyName ? { companyName } : {}),
          ...(brand.productName ? {} : productName ? { productName } : {}),
          ...(brand.industry ? {} : industry ? { industry } : {}),
          ...(brand.targetAudience ? {} : audience ? { targetAudience: audience } : {}),
          websiteUrl,
          websiteScrapedAt: new Date(),
        },
      });
    } catch (err) {
      console.warn('[auto-discover] website scrape skipped:', err instanceof Error ? err.message : err);
    }
  }

  if (!companyName && websiteUrl) {
    try {
      companyName = new URL(websiteUrl.includes('://') ? websiteUrl : `https://${websiteUrl}`).hostname
        .replace(/^www\./, '')
        .split('.')[0];
    } catch {
      companyName = 'Our company';
    }
  }

  return {
    websiteUrl,
    companyName: companyName || 'Our company',
    productName,
    industry: industry || 'B2B technology',
    audience,
    scrapedPages,
  };
}

function packSearch(results: SearchResult[]): string {
  return results
    .slice(0, 10)
    .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${(r.snippet || '').slice(0, 280)}`)
    .join('\n\n');
}

/**
 * Discover direct competitors + social profiles from the company website / brand,
 * then save new Competitor rows (deduped).
 */
export async function autoDiscoverCompetitors(
  tenantId: string,
  opts?: { websiteUrl?: string; limit?: number },
): Promise<{
  created: number;
  skipped: number;
  candidates: AutoCompetitorCandidate[];
  warnings: string[];
  brand: { companyName: string; websiteUrl: string; industry: string; scrapedPages: number };
}> {
  const limit = Math.min(opts?.limit ?? 8, MAX_COMPETITORS);
  const warnings: string[] = [];
  const brand = await loadBrandContext(tenantId, opts?.websiteUrl);
  const providers = await resolveProviders(tenantId);
  const search = createSearchProvider(providers);
  const llm = await LLMService.forTenant(tenantId);

  const queries = [
    `direct competitors of ${brand.companyName} ${brand.industry}`,
    `${brand.companyName} alternatives ${brand.productName || brand.industry}`.trim(),
    `top ${brand.industry} companies competing with ${brand.companyName} LinkedIn Instagram`,
  ];

  const searchBlocks: string[] = [];
  const socialPool: Record<string, string> = {};
  for (const q of queries) {
    try {
      const results = await search.search(q, { maxResults: 8, days: 365 });
      searchBlocks.push(`### ${q}\n${packSearch(results)}`);
      for (const r of results) {
        Object.assign(socialPool, extractSocialUrlsFromText(`${r.url}\n${r.title}\n${r.snippet}`));
      }
    } catch (err) {
      warnings.push(`Search “${q.slice(0, 40)}…” failed: ${err instanceof Error ? err.message : 'error'}`);
    }
  }

  if (!searchBlocks.length) {
    throw new Error(
      warnings[0] ||
        'Search failed. Add a Tavily/SerpAPI key in Settings → Integrations to auto-find competitors.',
    );
  }

  const json = await llm.generateRawJson({
    job: 'caption',
    systemPrompt: `You identify DIRECT business competitors for a brand.
Return ONLY valid JSON:
{
  "competitors": [
    {
      "name": "Competitor Brand",
      "website": "https://...",
      "instagram": "https://instagram.com/...",
      "linkedin": "https://linkedin.com/company/...",
      "facebook": "https://facebook.com/...",
      "twitter": "https://x.com/..."
    }
  ]
}
Rules:
- Only REAL companies that compete for the same customers (not partners, not news sites, not the brand itself).
- Prefer companies with at least one social profile URL from the research.
- Max ${limit} competitors.
- Omit unknown social fields rather than inventing URLs.
- Never include ${brand.companyName} itself.`,
    userPrompt: `Brand: ${brand.companyName}
Product: ${brand.productName || 'n/a'}
Industry: ${brand.industry}
Website: ${brand.websiteUrl || 'n/a'}
Audience: ${brand.audience || 'n/a'}

Research:
${searchBlocks.join('\n\n').slice(0, 14000)}

Extra social URLs spotted:
${JSON.stringify(socialPool)}`,
  });

  const rawList = Array.isArray(json.competitors) ? json.competitors : [];
  const candidates: AutoCompetitorCandidate[] = [];
  const seenNames = new Set<string>();

  for (const item of rawList) {
    if (candidates.length >= limit) break;
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = String(row.name || '').trim();
    if (!name) continue;
    if (name.toLowerCase() === brand.companyName.toLowerCase()) continue;
    if (seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());

    const socialUrls: Record<string, string> = {};
    for (const key of ['instagram', 'linkedin', 'facebook', 'twitter', 'website'] as const) {
      const url = ensureUrl(String(row[key] || ''));
      if (url) socialUrls[key === 'website' ? 'website' : key] = url;
    }
    // Merge any URLs found in research text matching the name
    Object.assign(socialUrls, extractSocialUrlsFromText(JSON.stringify(row)));

    candidates.push({
      name,
      platform: platformFromSocial(socialUrls),
      socialUrls,
      website: socialUrls.website,
    });
  }

  // Enrich missing socials with a targeted search per competitor (cap to avoid rate limits)
  for (const c of candidates.slice(0, limit)) {
    const hasSocial = ['instagram', 'linkedin', 'facebook', 'twitter'].some((k) => c.socialUrls[k]);
    if (hasSocial) continue;
    try {
      const results = await search.search(
        `"${c.name}" (instagram.com OR linkedin.com/company OR facebook.com OR x.com OR twitter.com)`,
        { maxResults: 5, days: 365 },
      );
      const found = extractSocialUrlsFromText(packSearch(results));
      Object.assign(c.socialUrls, found);
      if (!c.platform || c.platform === 'instagram') c.platform = platformFromSocial(c.socialUrls);
    } catch {
      // ignore enrichment failures
    }
  }

  const withUrls = candidates.filter((c) =>
    ['instagram', 'linkedin', 'facebook', 'twitter'].some((k) => c.socialUrls[k]),
  );
  const dropped = candidates.length - withUrls.length;
  if (dropped > 0) {
    warnings.push(`Dropped ${dropped} competitor(s) with no Instagram/LinkedIn/Facebook/X URL.`);
  }

  const existing = await prisma.competitor.findMany({
    where: { tenantId, deletedAt: null },
    select: { name: true, profileUrl: true, handle: true },
  });
  const existingKeys = new Set(
    existing.flatMap((c) =>
      [c.name.trim().toLowerCase(), (c.profileUrl || '').toLowerCase(), (c.handle || '').toLowerCase()].filter(
        Boolean,
      ),
    ),
  );

  const maxOrder = await prisma.competitor.aggregate({
    where: { tenantId },
    _max: { rotationOrder: true },
  });
  let nextOrder = (maxOrder._max.rotationOrder ?? 0) + 1;
  let created = 0;
  let skipped = 0;

  for (const c of withUrls) {
    const scrapeUrl =
      c.socialUrls[c.platform] ||
      c.socialUrls.instagram ||
      c.socialUrls.linkedin ||
      c.socialUrls.facebook ||
      c.socialUrls.twitter ||
      null;
    const handle = handleFromUrl(c.platform, scrapeUrl, c.name);
    const keys = [c.name.toLowerCase(), (scrapeUrl || '').toLowerCase(), handle.toLowerCase()].filter(Boolean);
    if (keys.some((k) => existingKeys.has(k))) {
      skipped += 1;
      continue;
    }

    await prisma.competitor.create({
      data: {
        tenantId,
        name: c.name,
        handle,
        platform: c.platform,
        profileUrl: scrapeUrl,
        socialUrls: c.socialUrls,
        rotationOrder: nextOrder++,
      },
    });
    keys.forEach((k) => existingKeys.add(k));
    created += 1;
  }

  if (!created && !withUrls.length) {
    throw new Error(
      'Could not find competitors with social profiles. Try again after saving a clearer company website/industry.',
    );
  }

  return {
    created,
    skipped,
    candidates: withUrls,
    warnings,
    brand: {
      companyName: brand.companyName,
      websiteUrl: brand.websiteUrl,
      industry: brand.industry,
      scrapedPages: brand.scrapedPages,
    },
  };
}

/**
 * Suggest + save trend keywords/topics from the company website / brand profile.
 */
export async function autoDiscoverTopics(
  tenantId: string,
  opts?: { websiteUrl?: string; limit?: number },
): Promise<{
  created: number;
  skipped: number;
  candidates: AutoTopicCandidate[];
  warnings: string[];
  brand: { companyName: string; websiteUrl: string; industry: string; scrapedPages: number };
}> {
  const limit = Math.min(opts?.limit ?? 10, MAX_TOPICS);
  const warnings: string[] = [];
  const brand = await loadBrandContext(tenantId, opts?.websiteUrl);
  const providers = await resolveProviders(tenantId);
  const search = createSearchProvider(providers);
  const llm = await LLMService.forTenant(tenantId);

  let research = '';
  try {
    const results = await search.search(
      `${brand.industry} ${brand.productName || brand.companyName} trending topics keywords content marketing`,
      { maxResults: 8, days: 60 },
    );
    research = packSearch(results);
  } catch (err) {
    warnings.push(`Trend research search failed: ${err instanceof Error ? err.message : 'error'}`);
  }

  const json = await llm.generateRawJson({
    job: 'caption',
    systemPrompt: `You create trend-monitoring keywords for a B2B/B2C content engine.
Return ONLY valid JSON:
{
  "topics": [
    { "name": "Short topic label", "searchKeywords": "comma, separated, search, terms" }
  ]
}
Rules:
- Topics should help find industry news & social trends relevant to this brand.
- Prefer specific, searchable phrases over vague ones.
- Max ${limit} topics.
- Do not include the company name as a topic unless it is a market category.`,
    userPrompt: `Brand: ${brand.companyName}
Product: ${brand.productName || 'n/a'}
Industry: ${brand.industry}
Website: ${brand.websiteUrl || 'n/a'}
Audience: ${brand.audience || 'n/a'}

Research snippets:
${research.slice(0, 10000) || '(none — invent strong industry keywords from brand context)'}`,
  });

  const rawList = Array.isArray(json.topics) ? json.topics : [];
  const candidates: AutoTopicCandidate[] = [];
  const seen = new Set<string>();
  for (const item of rawList) {
    if (candidates.length >= limit) break;
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = String(row.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const searchKeywords = String(row.searchKeywords || name).trim() || name;
    candidates.push({ name, searchKeywords });
  }

  if (!candidates.length) {
    throw new Error('No topics suggested. Check Integrations (LLM) and try again.');
  }

  const existing = await prisma.topic.findMany({
    where: { tenantId, deletedAt: null },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((t) => t.name.trim().toLowerCase()));
  const maxOrder = await prisma.topic.aggregate({
    where: { tenantId },
    _max: { rotationOrder: true },
  });
  let nextOrder = (maxOrder._max.rotationOrder ?? 0) + 1;
  let created = 0;
  let skipped = 0;

  for (const t of candidates) {
    if (existingNames.has(t.name.toLowerCase())) {
      skipped += 1;
      continue;
    }
    await prisma.topic.create({
      data: {
        tenantId,
        name: t.name,
        searchKeywords: t.searchKeywords,
        rotationOrder: nextOrder++,
      },
    });
    existingNames.add(t.name.toLowerCase());
    created += 1;
  }

  return {
    created,
    skipped,
    candidates,
    warnings,
    brand: {
      companyName: brand.companyName,
      websiteUrl: brand.websiteUrl,
      industry: brand.industry,
      scrapedPages: brand.scrapedPages,
    },
  };
}
