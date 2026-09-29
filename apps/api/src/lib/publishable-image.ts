import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { resolveUploadPath } from '../providers/templates/brand-renderer';
import { resolveProviders } from '../services/providers.service';
import { uploadPlacidMedia } from '../providers/templates/placid.client';

/** Hosts Meta cannot reliably fetch (broken DNS / private). */
const UNREACHABLE_HOST_RE =
  /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|storage\.placid\.app|(^https:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.))/i;

/** True when Meta/LinkedIn servers can fetch this HTTPS URL themselves. */
export function isExternallyReachableHttps(url: string | null | undefined): boolean {
  const u = (url || '').trim();
  if (!/^https:\/\//i.test(u)) return false;
  if (UNREACHABLE_HOST_RE.test(u)) return false;
  return true;
}

export type PublishImageBytes = {
  buffer: Buffer;
  filename: string;
  mimetype: string;
};

/** Load a stored or remote image into memory for publishing. */
export async function loadImageBytesForPublish(
  url: string,
): Promise<PublishImageBytes | null> {
  const raw = (url || '').trim();
  if (!raw) return null;

  if (raw.startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.+)$/i.exec(raw);
    if (!m) return null;
    const mimetype = m[1] || 'image/jpeg';
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length < 64) return null;
    const ext = mimetype.includes('png') ? 'png' : mimetype.includes('webp') ? 'webp' : 'jpg';
    return { buffer, filename: `embed.${ext}`, mimetype };
  }

  const disk = resolveUploadPath(raw);
  if (disk) {
    const buffer = await fs.readFile(disk);
    if (buffer.length < 64) return null;
    const filename = path.basename(disk) || 'upload.jpg';
    const ext = path.extname(filename).toLowerCase();
    const mimetype =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.svg'
              ? 'image/svg+xml'
              : 'image/jpeg';
    return { buffer, filename, mimetype };
  }

  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const res = await fetch(raw, { headers: { Accept: 'image/*,*/*' }, redirect: 'follow' });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 64) return null;
    const mimetype = contentType.startsWith('image/') ? contentType : 'image/jpeg';
    let filename = (raw.split('?')[0].split('/').pop() || 'remote.jpg').replace(
      /[^a-zA-Z0-9._-]+/g,
      '_',
    );
    if (!/\.(png|jpe?g|webp|gif|svg)$/i.test(filename)) {
      filename += mimetype.includes('png') ? '.png' : mimetype.includes('svg') ? '.svg' : '.jpg';
    }
    return { buffer, filename, mimetype };
  } catch {
    return null;
  }
}

/** Instagram only accepts JPEG from a public URL — rasterize SVG/PNG/WebP. */
export async function toInstagramJpeg(bytes: PublishImageBytes): Promise<PublishImageBytes> {
  const isJpeg =
    /image\/jpe?g/i.test(bytes.mimetype) || /\.jpe?g$/i.test(bytes.filename);
  if (isJpeg && !/image\/svg/i.test(bytes.mimetype)) {
    try {
      const buffer = await sharp(bytes.buffer, { failOn: 'none' })
        .rotate()
        .jpeg({ quality: 92, mozjpeg: true })
        .toBuffer();
      return { buffer, filename: bytes.filename.replace(/\.[^.]+$/, '.jpg'), mimetype: 'image/jpeg' };
    } catch {
      return { ...bytes, mimetype: 'image/jpeg' };
    }
  }

  const buffer = await sharp(bytes.buffer, { failOn: 'none', density: 150 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();
  return {
    buffer,
    filename: bytes.filename.replace(/\.[^.]+$/, '.jpg') || 'publish.jpg',
    mimetype: 'image/jpeg',
  };
}

/**
 * Upload JPEG to a CDN Instagram/Facebook can fetch.
 * Prefer catbox — Placid media URLs (storage.placid.app) have broken public DNS
 * and Meta rejects them with 9004/2207052.
 */
async function uploadPublicJpegHost(jpeg: PublishImageBytes): Promise<string> {
  const errors: string[] = [];
  const fileName = jpeg.filename.endsWith('.jpg') ? jpeg.filename : 'publish.jpg';
  const blob = new Blob([new Uint8Array(jpeg.buffer)], { type: 'image/jpeg' });

  // 1) catbox.moe — public HTTPS, no API key
  try {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', blob, fileName);
    const res = await fetch('https://catbox.moe/user/api.php', {
      method: 'POST',
      body: form,
    });
    const text = (await res.text()).trim();
    if (res.ok && /^https:\/\/files\.catbox\.moe\//i.test(text)) {
      return text;
    }
    errors.push(`catbox: ${res.status} ${text.slice(0, 120)}`);
  } catch (err) {
    errors.push(`catbox: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2) tmpfiles.org — convert download page URL to direct link
  try {
    const form = new FormData();
    form.append('file', blob, 'publish.jpg');
    const res = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      body: form,
    });
    const data = (await res.json()) as {
      status?: string;
      data?: { url?: string };
      message?: string;
    };
    const pageUrl = data.data?.url?.trim();
    if (res.ok && pageUrl) {
      const direct = pageUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
      if (/^https:\/\//i.test(direct)) return direct;
    }
    errors.push(`tmpfiles: ${res.status} ${data.message || pageUrl || 'no url'}`);
  } catch (err) {
    errors.push(`tmpfiles: ${err instanceof Error ? err.message : String(err)}`);
  }

  throw new Error(`Could not host image on a Meta-reachable CDN. ${errors.join(' | ')}`);
}

/**
 * Host an image where Instagram/Facebook can fetch it.
 * Required for local /uploads and localhost API_URL.
 */
export async function hostImageForSocialPublish(
  tenantId: string,
  url: string,
): Promise<string> {
  const trimmed = (url || '').trim();
  if (!trimmed) throw new Error('No image URL to publish');

  // Fast path: already a public image on a Meta-reachable HTTPS CDN
  if (isExternallyReachableHttps(trimmed) && !/\.svg(\?|$)/i.test(trimmed)) {
    return trimmed;
  }

  const loaded = await loadImageBytesForPublish(trimmed);
  if (!loaded) {
    throw new Error(
      `Could not read image for publish (${trimmed.slice(0, 80)}). Re-generate the post image and try again.`,
    );
  }

  const jpeg = await toInstagramJpeg(loaded);

  try {
    return await uploadPublicJpegHost(jpeg);
  } catch (primaryErr) {
    // Fallback: Placid media — only if the returned host is actually public
    const providers = await resolveProviders(tenantId);
    if (providers.placidApiKey) {
      try {
        const placidUrl = await uploadPlacidMedia({
          apiKey: providers.placidApiKey,
          buffer: jpeg.buffer,
          filename: jpeg.filename.endsWith('.jpg') ? jpeg.filename : 'publish.jpg',
          mimetype: 'image/jpeg',
        });
        if (isExternallyReachableHttps(placidUrl)) return placidUrl;
      } catch {
        /* fall through */
      }
    }
    const msg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    throw new Error(
      `Instagram needs a public HTTPS image. Local /uploads cannot be fetched by Meta. ${msg}`,
    );
  }
}

/** Resolve every slide/cover URL to a Meta-fetchable HTTPS JPEG. */
export async function resolvePublishImageUrls(
  tenantId: string,
  urls: Array<string | null | undefined>,
): Promise<string[]> {
  const out: string[] = [];
  for (const u of urls) {
    if (!u?.trim()) continue;
    out.push(await hostImageForSocialPublish(tenantId, u.trim()));
  }
  return out;
}
