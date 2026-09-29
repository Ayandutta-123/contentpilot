import { LLMService } from './llm.service';
import { resolveProviders } from './providers.service';
import { resolveClaudeModelId } from '@contentpilot/shared';
import { defaultBrandKit, type BrandKitColors } from '../lib/brand-kit';
import { buildPaletteFromCssSources, extractStylesheetUrls } from './extract-site-palette';

const MAX_PAGES = 8;
const MAX_CHARS_PER_PAGE = 8000;
const MAX_TOTAL_CHARS = 48000;
const FETCH_TIMEOUT_MS = 20000;
/** Below this, treat page as empty SPA shell and use a render reader */
const MIN_USEFUL_CHARS = 280;

const PRIORITY_PATHS = [
  '/',
  '/about',
  '/about-us',
  '/company',
  '/team',
  '/portfolio',
  '/product',
  '/products',
  '/solutions',
  '/platform',
  '/services',
  '/pricing',
  '/customers',
  '/partners',
  '/contact',
  '/venture-studio',
  '/build-with-us',
];

export type BrandWebsiteProfile = {
  companyName?: string;
  productName?: string;
  productTagline?: string;
  industry: string;
  brandVoice: string;
  contentGuidelines: string;
  targetAudience: string;
  imageStyle: string;
  hashtagStrategy: string;
  contactEmail?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  /** Prefill Brand Kit — still editable in Settings */
  colors: BrandKitColors;
  colorSource: 'css' | 'llm' | 'mixed' | 'fallback';
  colorsDetected: number;
  pagesScraped: number;
  sourceUrls: string[];
  scrapeMethod: 'html' | 'rendered' | 'mixed';
  llmProvider: string;
  llmModel: string;
};

function normalizeWebsiteUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Website URL is required');
  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProto);
  } catch {
    throw new Error('Invalid website URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Website must be http or https');
  }
  return url;
}

function sameSite(a: URL, b: URL): boolean {
  const strip = (h: string) => h.replace(/^www\./i, '').toLowerCase();
  return strip(a.hostname) === strip(b.hostname);
}

/** Pull mailto + social profile URLs from raw HTML / text corpus. */
function extractContactsFromCorpus(corpus: string): {
  contactEmail?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
} {
  const out: {
    contactEmail?: string;
    instagramUrl?: string;
    facebookUrl?: string;
    linkedinUrl?: string;
    twitterUrl?: string;
  } = {};

  const mailto = corpus.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  if (mailto?.[1]) out.contactEmail = mailto[1].toLowerCase();

  const pick = (re: RegExp) => {
    const m = corpus.match(re);
    return m?.[1] ? m[1].replace(/["'>\s].*$/, '').replace(/\/$/, '') : '';
  };

  const ig = pick(/https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._/-]+)/i);
  if (ig) out.instagramUrl = `https://instagram.com/${ig.split('/')[0]}`;

  const li = pick(/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/([A-Za-z0-9._%-]+)/i);
  if (li) out.linkedinUrl = `https://www.linkedin.com/company/${li}`;

  const fb = pick(/https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9._%-]+)/i);
  if (fb && !/sharer|share\.php/i.test(fb)) out.facebookUrl = `https://facebook.com/${fb}`;

  const tw = pick(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i);
  if (tw && !/intent|share/i.test(tw)) out.twitterUrl = `https://x.com/${tw}`;

  return out;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function metaFallback(html: string): string {
  const bits: string[] = [];
  const ogTitle = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1]
    || html.match(/content=["']([^"']+)["']\s+property=["']og:title["']/i)?.[1];
  const ogDesc = html.match(/property=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1]
    || html.match(/content=["']([^"']+)["']\s+property=["']og:description["']/i)?.[1];
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (title) bits.push(title.trim());
  if (ogTitle) bits.push(ogTitle.trim());
  if (ogDesc) bits.push(ogDesc.trim());
  return bits.join('\n');
}

function extractLinks(html: string, base: URL): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) {
      continue;
    }
    try {
      const abs = new URL(href, base);
      if (!sameSite(abs, base)) continue;
      abs.hash = '';
      if (!['http:', 'https:'].includes(abs.protocol)) continue;
      if (/\.(pdf|png|jpe?g|gif|webp|svg|css|js|zip|mp4|webm)(\?|$)/i.test(abs.pathname)) continue;
      out.push(abs.toString());
    } catch {
      // ignore
    }
  }
  // Also pick markdown-style links from Jina output
  const md = /\[[^\]]+\]\((https?:\/\/[^)]+)\)/gi;
  while ((m = md.exec(html))) {
    try {
      const abs = new URL(m[1]);
      if (!sameSite(abs, base)) continue;
      abs.hash = '';
      out.push(abs.toString());
    } catch {
      // ignore
    }
  }
  return out;
}

async function fetchWithTimeout(url: string, headers?: Record<string, string>): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ContentPilotBrandBot/1.1)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        ...headers,
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtmlPage(url: string): Promise<{ url: string; html: string } | null> {
  const res = await fetchWithTimeout(url);
  if (!res?.ok) return null;
  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  if (ctype && !ctype.includes('text/html') && !ctype.includes('application/xhtml') && !ctype.includes('text/plain')) {
    return null;
  }
  const html = await res.text();
  if (!html || html.length < 40) return null;
  return { url: res.url || url, html };
}

/** Jina Reader returns rendered markdown for JS-heavy SPAs */
async function fetchRenderedText(url: string): Promise<{ url: string; text: string } | null> {
  const endpoints = [
    `https://r.jina.ai/${url}`,
    `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`,
  ];
  // Prefer https form once
  const tryUrl = endpoints[0];
  const res = await fetchWithTimeout(tryUrl, { Accept: 'text/plain' });
  if (!res?.ok) return null;
  const text = (await res.text()).trim();
  if (text.length < MIN_USEFUL_CHARS) return null;
  return { url, text: text.slice(0, MAX_CHARS_PER_PAGE) };
}

async function fetchPageContent(url: string): Promise<{
  url: string;
  text: string;
  method: 'html' | 'rendered';
  discoverHtml?: string;
} | null> {
  const page = await fetchHtmlPage(url);
  if (page) {
    const stripped = stripHtml(page.html);
    const meta = metaFallback(page.html);
    const combined = [meta, stripped].filter(Boolean).join('\n').trim();
    if (combined.length >= MIN_USEFUL_CHARS) {
      return {
        url: page.url,
        text: combined.slice(0, MAX_CHARS_PER_PAGE),
        method: 'html',
        discoverHtml: page.html,
      };
    }
  }

  const rendered = await fetchRenderedText(url);
  if (rendered) {
    return {
      url: rendered.url,
      text: rendered.text,
      method: 'rendered',
      discoverHtml: rendered.text,
    };
  }

  // Last resort: keep thin meta so we don't return zero pages when homepage exists
  if (page) {
    const thin = [metaFallback(page.html), stripHtml(page.html)].filter(Boolean).join('\n').trim();
    if (thin.length >= 40) {
      return {
        url: page.url,
        text: thin.slice(0, MAX_CHARS_PER_PAGE),
        method: 'html',
        discoverHtml: page.html,
      };
    }
  }
  return null;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

async function fetchCssText(url: string): Promise<string | null> {
  const res = await fetchWithTimeout(url, {
    Accept: 'text/css,*/*;q=0.1',
  });
  if (!res?.ok) return null;
  const text = await res.text();
  if (!text || text.length < 20) return null;
  return text.slice(0, 200_000);
}

/**
 * Crawl key pages on the company website and LLM-extract B2B brand profile fields.
 * Brand Kit colours are NOT applied here — use scrapeBrandColorsFromWebsite / Settings → Scrape colours.
 * Uses rendered-page fallback for JS SPAs (empty #root shells).
 */
export async function scrapeBrandWebsite(
  tenantId: string,
  websiteUrl: string,
): Promise<BrandWebsiteProfile> {
  const origin = normalizeWebsiteUrl(websiteUrl);
  const baseOrigin = `${origin.protocol}//${origin.host}`;
  const providers = await resolveProviders(tenantId);
  const llmProvider = providers.llmProvider || 'openai';
  const llmModel =
    llmProvider === 'claude'
      ? resolveClaudeModelId(providers.llmModel)
      : providers.llmModel || 'gpt-4o';

  const queue: string[] = [];
  const seen = new Set<string>();
  const push = (u: string) => {
    try {
      const parsed = new URL(u);
      parsed.hash = '';
      const key = parsed.toString().replace(/\/$/, '') || parsed.origin;
      if (seen.has(key)) return;
      if (!sameSite(parsed, origin)) return;
      seen.add(key);
      queue.push(parsed.toString());
    } catch {
      // skip
    }
  };

  for (const path of PRIORITY_PATHS) {
    push(path === '/' ? `${baseOrigin}/` : `${baseOrigin}${path}`);
  }
  push(origin.toString());

  const pages: Array<{ url: string; text: string; method: 'html' | 'rendered' }> = [];
  const cssSources: string[] = [];
  const stylesheetQueue: string[] = [];
  let totalChars = 0;
  let usedHtml = false;
  let usedRendered = false;

  // Always pull homepage HTML for CSS / theme-color detection (SPAs often use Jina for copy).
  const homeHtml = await fetchHtmlPage(`${baseOrigin}/`).catch(() => null);
  if (homeHtml?.html) {
    cssSources.push(homeHtml.html);
    for (const sheet of extractStylesheetUrls(homeHtml.html, homeHtml.url)) {
      if (!stylesheetQueue.includes(sheet)) stylesheetQueue.push(sheet);
    }
  }
  const originHtml = await fetchHtmlPage(origin.toString()).catch(() => null);
  if (originHtml?.html && originHtml.url !== homeHtml?.url) {
    cssSources.push(originHtml.html);
    for (const sheet of extractStylesheetUrls(originHtml.html, originHtml.url)) {
      if (!stylesheetQueue.includes(sheet)) stylesheetQueue.push(sheet);
    }
  }

  while (queue.length && pages.length < MAX_PAGES && totalChars < MAX_TOTAL_CHARS) {
    const next = queue.shift()!;
    const page = await fetchPageContent(next);
    if (!page) continue;

    pages.push({ url: page.url, text: page.text, method: page.method });
    totalChars += page.text.length;
    if (page.method === 'html') usedHtml = true;
    if (page.method === 'rendered') usedRendered = true;

    if (page.discoverHtml && page.method === 'html') {
      cssSources.push(page.discoverHtml);
      if (pages.length <= 2) {
        for (const sheet of extractStylesheetUrls(page.discoverHtml, page.url)) {
          if (!stylesheetQueue.includes(sheet)) stylesheetQueue.push(sheet);
        }
      }
    }

    if (pages.length <= 3 && page.discoverHtml) {
      for (const link of extractLinks(page.discoverHtml, new URL(page.url)).slice(0, 25)) {
        push(link);
      }
    }
  }

  // Fetch a few stylesheets for CSS variable / hex detection
  for (const sheet of stylesheetQueue.slice(0, 4)) {
    const css = await fetchCssText(sheet);
    if (css) cssSources.push(css);
  }

  if (!pages.length) {
    throw new Error(
      `Could not scrape any readable content from ${origin.host}. ` +
        'The site may block bots or require login. Try another public URL.',
    );
  }

  const corpus = pages
    .map((p, i) => `--- PAGE ${i + 1}: ${p.url} (${p.method}) ---\n${p.text}`)
    .join('\n\n')
    .slice(0, MAX_TOTAL_CHARS);

  const llm = await LLMService.forTenant(tenantId);
  const json = await llm.generateRawJson({
    job: 'scrape',
    systemPrompt: `You are a B2B brand strategist. From website copy, extract a concise brand profile for social content generation.
Return ONLY a JSON object with these keys (strings unless noted):
- companyName
- productName
- productTagline (one short line)
- industry (sector, e.g. "Venture studio / deep tech")
- brandVoice (tone: 2–4 sentences on how the brand speaks)
- contentGuidelines (brand guidelines: do/don't, messaging pillars, claims to use or avoid — multi-sentence)
- targetAudience (who they sell to / partner with in B2B)
- imageStyle (visual direction for social images — photography / lighting / mood only, NOT fonts or hex colours)
- hashtagStrategy (short guidance)
Be specific to THIS company. Do not invent fake products. If unclear, write a careful best-effort from the site. Do NOT return colour hex codes or font family names.`,
    userPrompt: `Website: ${origin.toString()}\nLLM: ${llmProvider}/${llmModel}\nPages scraped: ${pages.length}\n\n${corpus}`,
    maxRetries: 2,
  });

  // Colours are scraped separately via scrapeBrandColorsFromWebsite — CSS snapshot for meta only.
  const kitDefaults = defaultBrandKit().colors;
  const cssBuilt = buildPaletteFromCssSources(cssSources, kitDefaults);
  const colors = cssBuilt.colors;
  const colorSource: BrandWebsiteProfile['colorSource'] =
    cssBuilt.detected >= 4 || cssBuilt.rolesFromVars >= 2 ? 'css' : 'fallback';

  const scrapeMethod: BrandWebsiteProfile['scrapeMethod'] =
    usedHtml && usedRendered ? 'mixed' : usedRendered ? 'rendered' : 'html';

  const contacts = extractContactsFromCorpus(
    [...cssSources, corpus].join('\n').slice(0, 200_000),
  );

  return {
    companyName: asString(json.companyName) || undefined,
    productName: asString(json.productName) || undefined,
    productTagline: asString(json.productTagline) || undefined,
    industry: asString(json.industry),
    brandVoice: asString(json.brandVoice),
    contentGuidelines: asString(json.contentGuidelines),
    targetAudience: asString(json.targetAudience),
    imageStyle: asString(json.imageStyle),
    hashtagStrategy: asString(json.hashtagStrategy),
    contactEmail: contacts.contactEmail,
    instagramUrl: contacts.instagramUrl,
    facebookUrl: contacts.facebookUrl,
    linkedinUrl: contacts.linkedinUrl,
    twitterUrl: contacts.twitterUrl,
    colors,
    colorSource,
    colorsDetected: cssBuilt.detected,
    pagesScraped: pages.length,
    sourceUrls: pages.map((p) => p.url),
    scrapeMethod,
    llmProvider,
    llmModel,
  };
}
