import { config } from '../config';

/** Turn /uploads/... into an absolute URL. Localhost is not Instagram-reachable. */
export function toPublicMediaUrl(url: string | null | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  const u = url.trim();
  if (/^https:\/\//i.test(u)) {
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(u)) return undefined;
    return u;
  }
  if (/^http:\/\//i.test(u)) {
    if (/localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(u)) return undefined;
    // Prefer leaving http as-is for non-IG callers; IG path hosts via Placid.
    return u.replace(/^http:\/\//i, 'https://');
  }
  if (u.startsWith('/uploads/')) {
    const base = (config.API_URL || '').replace(/\/$/, '');
    if (!base || /localhost|127\.0\.0\.1/i.test(base)) return undefined;
    return `${base}${u}`;
  }
  return u;
}
