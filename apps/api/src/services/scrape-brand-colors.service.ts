/**
 * Scrape Brand Kit colours from a website (CSS / theme tokens only — no LLM).
 * Does not change fonts, image style, or copy fields.
 */

import { defaultBrandKit, type BrandKitColors } from '../lib/brand-kit';
import {
  buildPaletteFromCssSources,
  extractStylesheetUrls,
} from './extract-site-palette';

const FETCH_TIMEOUT_MS = 22000;
const MAX_SHEETS = 10;
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

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

async function fetchWithTimeout(url: string, headers?: Record<string, string>): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': CHROME_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/css,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers,
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, accept?: string): Promise<string | null> {
  const res = await fetchWithTimeout(url, accept ? { Accept: accept } : undefined);
  if (!res?.ok) return null;
  const text = await res.text();
  return text && text.length >= 20 ? text : null;
}

async function collectSheets(
  html: string,
  baseUrl: string,
  sources: string[],
  seen: Set<string>,
): Promise<number> {
  let fetched = 0;
  const sheets = extractStylesheetUrls(html, baseUrl);
  for (const sheet of sheets) {
    if (fetched >= MAX_SHEETS) break;
    if (seen.has(sheet)) continue;
    seen.add(sheet);
    const css = await fetchText(sheet, 'text/css,*/*;q=0.1');
    if (!css) continue;
    sources.push(css.slice(0, 350_000));
    fetched += 1;
  }
  return fetched;
}

async function tryManifestColors(origin: URL, sources: string[]): Promise<void> {
  const candidates = [
    new URL('/manifest.json', origin).toString(),
    new URL('/site.webmanifest', origin).toString(),
    new URL('/manifest.webmanifest', origin).toString(),
  ];
  for (const url of candidates) {
    const text = await fetchText(url, 'application/manifest+json,application/json,*/*;q=0.1');
    if (!text) continue;
    sources.push(text.slice(0, 50_000));
    break;
  }
}

export type BrandColorScrapeResult = {
  colors: BrandKitColors;
  colorSource: 'css' | 'fallback';
  colorsDetected: number;
  rolesFromVars: number;
  stylesheetsFetched: number;
  sourceUrl: string;
};

/**
 * Fetch homepage + stylesheets (+ manifest) and build a Brand Kit palette.
 * Fast — no LLM. Safe to call from a dedicated “Scrape colours” button.
 */
export async function scrapeBrandColorsFromWebsite(
  websiteUrl: string,
): Promise<BrandColorScrapeResult> {
  const origin = normalizeWebsiteUrl(websiteUrl);
  const home = `${origin.protocol}//${origin.host}/`;
  const sources: string[] = [];
  const seenSheets = new Set<string>();
  let stylesheetsFetched = 0;
  let sourceUrl = home;

  const ingestHtml = async (url: string) => {
    const html = await fetchText(url);
    if (!html) return;
    sources.push(html.slice(0, 400_000));
    // Prefer final URL if redirects happened — re-resolve via fetch headers not available;
    // extractStylesheetUrls uses the request URL as base which is fine for same-origin.
    stylesheetsFetched += await collectSheets(html, url, sources, seenSheets);
  };

  await ingestHtml(home);
  sourceUrl = home;

  // Exact path the user typed (may differ from /)
  const typed = origin.toString();
  if (typed.replace(/\/$/, '') !== home.replace(/\/$/, '')) {
    await ingestHtml(typed);
    sourceUrl = typed;
  }

  await tryManifestColors(origin, sources);

  // SPA shells often have almost no colours in HTML; try common CSS entrypoints
  if (stylesheetsFetched === 0 || sources.join('').length < 800) {
    const guesses = [
      '/styles.css',
      '/style.css',
      '/css/main.css',
      '/css/app.css',
      '/assets/main.css',
      '/assets/index.css',
      '/static/css/main.css',
    ];
    for (const path of guesses) {
      if (stylesheetsFetched >= MAX_SHEETS) break;
      const abs = new URL(path, home).toString();
      if (seenSheets.has(abs)) continue;
      seenSheets.add(abs);
      const css = await fetchText(abs, 'text/css,*/*;q=0.1');
      if (!css) continue;
      sources.push(css.slice(0, 350_000));
      stylesheetsFetched += 1;
    }
  }

  if (!sources.length) {
    throw new Error(
      `Could not fetch ${origin.host} to read colours. Check the URL or try again.`,
    );
  }

  const fallback = defaultBrandKit().colors;
  const built = buildPaletteFromCssSources(sources, fallback);

  return {
    colors: built.colors,
    colorSource: built.rolesFromVars >= 1 || built.detected >= 4 ? 'css' : 'fallback',
    colorsDetected: built.detected,
    rolesFromVars: built.rolesFromVars,
    stylesheetsFetched,
    sourceUrl,
  };
}
