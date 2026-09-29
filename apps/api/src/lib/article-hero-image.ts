/**
 * Resolve a usable hero/photo URL for a news article (exact image when the page exposes one).
 * Prefer Open Graph / Twitter card images. Never invent URLs.
 */

const FETCH_MS = 12_000;

function absolutize(base: string, maybeRel: string): string | null {
  const raw = (maybeRel || '').trim().replace(/^['"]|['"]$/g, '');
  if (!raw || raw.startsWith('data:')) return null;
  try {
    const u = new URL(raw, base);
    if (!/^https?:$/i.test(u.protocol)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function metaContent(html: string, ...attrMatchers: RegExp[]): string | null {
  for (const re of attrMatchers) {
    const m = re.exec(html);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

/** Extract og:image / twitter:image from HTML (best-effort). */
export function extractOgImageFromHtml(html: string, pageUrl: string): string | null {
  if (!html || html.length < 40) return null;
  const slice = html.slice(0, 180_000);
  const candidates = [
    metaContent(
      slice,
      /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image:secure_url["']/i,
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
      /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
    ),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    const abs = absolutize(pageUrl, c);
    if (abs && !/\.(svg)(\?|$)/i.test(abs)) return abs;
  }
  return null;
}

export async function resolveArticleHeroImage(
  articleUrl: string | null | undefined,
  preferred?: string | null,
): Promise<string | null> {
  const pref = (preferred || '').trim();
  if (/^https?:\/\//i.test(pref) && !/localhost|127\.0\.0\.1/i.test(pref)) {
    return pref;
  }

  const url = (articleUrl || '').trim();
  if (!/^https?:\/\//i.test(url) || /localhost|127\.0\.0\.1/i.test(url)) return null;

  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_MS);
    const res = await fetch(url, {
      signal: ac.signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (compatible; ContentPilot/1.0; +https://contentpilot.local; news-image)',
      },
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (ctype && !ctype.includes('html') && !ctype.includes('text/plain') && !ctype.includes('xml')) {
      return null;
    }
    const html = await res.text();
    return extractOgImageFromHtml(html, res.url || url);
  } catch {
    return null;
  }
}
