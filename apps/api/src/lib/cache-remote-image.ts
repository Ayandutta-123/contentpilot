import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Hosts Instagram / Meta / X / LinkedIn commonly use for post media. */
export function isRemoteHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export function isAllowedMediaHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      host.endsWith('.cdninstagram.com') ||
      host === 'cdninstagram.com' ||
      host.endsWith('.fbcdn.net') ||
      host.endsWith('.instagram.com') ||
      host === 'instagram.com' ||
      host.endsWith('.twimg.com') ||
      host === 'pbs.twimg.com' ||
      host.endsWith('.twitter.com') ||
      host === 'twitter.com' ||
      host === 'x.com' ||
      host.endsWith('.x.com') ||
      host.endsWith('.licdn.com') ||
      host.endsWith('.linkedin.com') ||
      host === 'media.licdn.com' ||
      host.endsWith('.pinimg.com') ||
      host.endsWith('.redd.it') ||
      host.endsWith('.imgur.com') ||
      host.endsWith('.imgflip.com') ||
      host.endsWith('.googleusercontent.com')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function isLikelyVideoUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    /\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i.test(u) ||
    u.includes('/video/') ||
    u.includes('video_dash') ||
    u.includes('video_url')
  );
}

function looksLikeImageBuffer(buf: Buffer): boolean {
  if (buf.length < 400) return false;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return true;
  // WEBP (RIFF....WEBP)
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf.slice(8, 12).toString() === 'WEBP'
  ) {
    return true;
  }
  return false;
}

function extFromBuffer(buf: Buffer, ctype: string): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'gif';
  if (buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (ctype.includes('png')) return 'png';
  if (ctype.includes('webp')) return 'webp';
  if (ctype.includes('gif')) return 'gif';
  return 'jpg';
}

export async function fetchImageBytes(url: string): Promise<{ buf: Buffer; ctype: string } | null> {
  const headerSets: Record<string, string>[] = [
    {
      'User-Agent': UA,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      Referer: 'https://www.instagram.com/',
    },
    {
      'User-Agent': UA,
      Accept: 'image/*,*/*;q=0.8',
      Referer: 'https://www.instagram.com/',
      Origin: 'https://www.instagram.com',
    },
    {
      'User-Agent': UA,
      Accept: '*/*',
    },
  ];

  for (const headers of headerSets) {
    try {
      const res = await fetch(url, { headers, redirect: 'follow' });
      if (!res.ok) continue;
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (ctype.startsWith('video/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      // Reject HTML/JSON error bodies even when CDN lies about content-type.
      if (!looksLikeImageBuffer(buf)) continue;
      return { buf, ctype };
    } catch {
      /* try next header set */
    }
  }
  return null;
}

/**
 * Download a remote social CDN image into tenant uploads.
 * Instagram signed URLs expire; caching at scrape time keeps Competitor Monitor thumbnails stable.
 */
export async function cacheRemoteImage(
  tenantId: string,
  remoteUrl: string,
  subdir = 'competitor-cache',
): Promise<string | null> {
  const url = (remoteUrl || '').trim();
  if (!url || url.startsWith('/uploads/') || url.startsWith('data:')) return url || null;
  if (!isRemoteHttpUrl(url)) return null;
  if (isLikelyVideoUrl(url)) return null;

  const dir = path.resolve(config.UPLOAD_DIR, tenantId, subdir);
  fs.mkdirSync(dir, { recursive: true });

  // Stable name from URL path (ignore query — IG signs change, path usually stable).
  let stableKey = url;
  try {
    const parsed = new URL(url);
    stableKey = `${parsed.hostname}${parsed.pathname}`;
  } catch {
    /* keep raw */
  }
  const hash = crypto.createHash('sha1').update(stableKey).digest('hex').slice(0, 16);
  const existing = fs.readdirSync(dir).find((f) => f.startsWith(`c-${hash}.`));
  if (existing) {
    return `/uploads/${tenantId}/${subdir}/${existing}`;
  }

  const fetched = await fetchImageBytes(url);
  if (!fetched) return null;

  const ext = extFromBuffer(fetched.buf, fetched.ctype);
  const filename = `c-${hash}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), fetched.buf);
  return `/uploads/${tenantId}/${subdir}/${filename}`;
}

/** Persist already-downloaded image bytes under competitor-cache. */
export function storeCachedImageBuffer(
  tenantId: string,
  remoteUrl: string,
  buf: Buffer,
  ctype = 'image/jpeg',
  subdir = 'competitor-cache',
): string | null {
  const url = (remoteUrl || '').trim();
  if (!url || !looksLikeImageBuffer(buf)) return null;
  const dir = path.resolve(config.UPLOAD_DIR, tenantId, subdir);
  fs.mkdirSync(dir, { recursive: true });
  let stableKey = url;
  try {
    const parsed = new URL(url);
    stableKey = `${parsed.hostname}${parsed.pathname}`;
  } catch {
    /* keep */
  }
  const hash = crypto.createHash('sha1').update(stableKey).digest('hex').slice(0, 16);
  const ext = extFromBuffer(buf, ctype);
  const filename = `c-${hash}.${ext}`;
  const full = path.join(dir, filename);
  if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
  return `/uploads/${tenantId}/${subdir}/${filename}`;
}

/** Cache each remote URL; keep originals that fail so the UI can still try a proxy. */
export async function cacheRemoteImageList(
  tenantId: string,
  urls: string[] | undefined | null,
  subdir = 'competitor-cache',
): Promise<string[]> {
  const list = (urls || []).filter(Boolean).slice(0, 10);
  if (!list.length) return [];
  const out = await Promise.all(
    list.map(async (u) => {
      if (u.startsWith('/uploads/') || u.startsWith('data:')) return u;
      if (isLikelyVideoUrl(u)) return null;
      const cached = await cacheRemoteImage(tenantId, u, subdir);
      return cached || u;
    }),
  );
  return preferLocalImageUrls([...new Set(out.filter((u): u is string => Boolean(u)))]);
}

/** Locals first so the UI always tries a durable thumbnail before expired CDNs. */
export function preferLocalImageUrls(urls: string[]): string[] {
  const locals: string[] = [];
  const remotes: string[] = [];
  const other: string[] = [];
  for (const u of urls) {
    if (!u) continue;
    if (u.startsWith('/uploads/') || u.startsWith('data:')) locals.push(u);
    else if (isRemoteHttpUrl(u) && !isLikelyVideoUrl(u)) remotes.push(u);
    else if (!isLikelyVideoUrl(u)) other.push(u);
  }
  return [...locals, ...remotes, ...other].slice(0, 10);
}

/**
 * On re-scrape: never throw away already-cached locals when the new CDN fetch fails.
 */
export function mergeCachedImageUrls(incoming: string[], existing: string[]): string[] {
  const next = preferLocalImageUrls(incoming || []);
  const prev = preferLocalImageUrls(existing || []);
  const nextLocals = next.filter((u) => u.startsWith('/uploads/') || u.startsWith('data:'));
  const prevLocals = prev.filter((u) => u.startsWith('/uploads/') || u.startsWith('data:'));

  if (nextLocals.length) {
    return preferLocalImageUrls([...new Set([...nextLocals, ...prevLocals, ...next])]);
  }
  if (prevLocals.length) {
    const remotes = next.filter((u) => isRemoteHttpUrl(u));
    return preferLocalImageUrls([...new Set([...prevLocals, ...remotes])]);
  }
  return next.length ? next : prev;
}

/** Browser-safe display URL: local uploads pass through; remote CDNs go via our proxy. */
export function displayMediaUrl(url: string | null | undefined): string {
  const u = (url || '').trim();
  if (!u) return '';
  if (u.startsWith('/uploads/') || u.startsWith('data:') || u.startsWith('/api/')) return u;
  if (isRemoteHttpUrl(u)) {
    return `/api/content/image-proxy?url=${encodeURIComponent(u)}`;
  }
  return u;
}
