/**
 * Fill an uploaded finished-poster master: keep the exact plate, stamp Brand Kit
 * logo + brief text overlays. Used when fillLayout is uploaded_master (no coded
 * sale_* SVG geometry available for this category).
 */

import fs from 'fs/promises';
import path from 'path';
import sharp, { type OverlayOptions } from 'sharp';
import { config } from '../../config';
import type { PosterSpec } from './poster-frame';
import { resolveImageHrefAsync } from './social-frame';

function sanitize(s: string | undefined | null, max: number): string {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function localPathFromUrl(url: string, tenantId: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('/uploads/')) {
    const abs = path.resolve(config.UPLOAD_DIR, url.replace(/^\/uploads\//, ''));
    try {
      await fs.access(abs);
      return abs;
    } catch {
      return null;
    }
  }
  if (url.startsWith('data:')) return null;
  // Absolute under uploads for this tenant
  const guess = path.resolve(config.UPLOAD_DIR, tenantId, url);
  try {
    await fs.access(guess);
    return guess;
  } catch {
    return null;
  }
}

export async function writeUploadedMasterPoster(opts: {
  tenantId: string;
  width: number;
  height: number;
  /** Uploaded finished poster (exact plate). */
  sourceImageUrl: string;
  /** Optional AI hero art — soft-blended into the right half when present. */
  artHref?: string;
  logoHref?: string;
  companyName?: string | null;
  headingFont: string;
  bodyFont: string;
  spec: PosterSpec;
  palette: { ground: string; ink: string; accent: string; muted: string };
}): Promise<{ publicUrl: string; width: number; height: number }> {
  const w = opts.width;
  const h = opts.height;
  const c = opts.palette;

  const sourcePath = await localPathFromUrl(opts.sourceImageUrl, opts.tenantId);
  let plate: Buffer;
  if (sourcePath) {
    plate = await sharp(sourcePath, { failOn: 'none' })
      .resize(w, h, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
  } else {
    const href = await resolveImageHrefAsync(opts.sourceImageUrl);
    if (href.startsWith('data:')) {
      const b64 = href.split(',')[1] || '';
      plate = await sharp(Buffer.from(b64, 'base64'), { failOn: 'none' })
        .resize(w, h, { fit: 'cover', position: 'centre' })
        .png()
        .toBuffer();
    } else {
      // Solid fallback if master cannot be loaded
      plate = await sharp({
        create: { width: w, height: h, channels: 3, background: c.ground },
      })
        .png()
        .toBuffer();
    }
  }

  const headline = sanitize(opts.spec.headline, 80);
  const accentWord = sanitize(opts.spec.headlineAccent, 40);
  const stat = sanitize(opts.spec.statValue, 12);
  const cta = sanitize(opts.spec.closingLine, 28) || 'ORDER NOW';
  const site = sanitize(opts.spec.footerNote, 60);
  const company = sanitize(opts.companyName, 40);

  const overlays: OverlayOptions[] = [];

  // Soft brand veil on the left type column so new copy stays legible over the plate.
  const veilSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="v" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${escapeXml(c.ground)}" stop-opacity="0.82"/>
      <stop offset="55%" stop-color="${escapeXml(c.ground)}" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="${escapeXml(c.ground)}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${Math.round(w * 0.58)}" height="${h}" fill="url(#v)"/>
  <rect x="0" y="0" width="${w}" height="${Math.round(h * 0.018)}" fill="${escapeXml(c.accent)}"/>
  <rect x="0" y="${h - Math.round(h * 0.018)}" width="${w}" height="${Math.round(h * 0.018)}" fill="${escapeXml(c.accent)}"/>
  <rect x="${w - Math.round(w * 0.018)}" y="0" width="${Math.round(w * 0.018)}" height="${h}" fill="${escapeXml(c.accent)}"/>
</svg>`;
  overlays.push({ input: Buffer.from(veilSvg), top: 0, left: 0 });

  const typeX = Math.round(w * 0.06);
  const headY = Math.round(h * 0.28);
  const headPx = Math.round(Math.min(w, h) * 0.055);
  const statPx = Math.round(Math.min(w, h) * 0.11);
  const copySvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  ${
    company
      ? `<text x="${typeX}" y="${Math.round(h * 0.12)}" font-family="${escapeXml(opts.bodyFont)}" font-size="${Math.round(headPx * 0.45)}" font-weight="600" fill="${escapeXml(c.ink)}">${escapeXml(company)}</text>`
      : ''
  }
  ${
    headline
      ? `<text x="${typeX}" y="${headY}" font-family="${escapeXml(opts.headingFont)}" font-size="${headPx}" font-weight="800" fill="${escapeXml(c.ink)}">${escapeXml(headline)}</text>`
      : ''
  }
  ${
    accentWord
      ? `<text x="${typeX}" y="${headY + Math.round(headPx * 1.15)}" font-family="${escapeXml(opts.headingFont)}" font-size="${Math.round(headPx * 0.85)}" font-weight="800" fill="${escapeXml(c.accent)}">${escapeXml(accentWord)}</text>`
      : ''
  }
  ${
    stat
      ? `<text x="${typeX}" y="${Math.round(h * 0.52)}" font-family="${escapeXml(opts.headingFont)}" font-size="${statPx}" font-weight="800" fill="${escapeXml(c.accent)}">${escapeXml(stat)}</text>
         <text x="${typeX}" y="${Math.round(h * 0.52) + Math.round(statPx * 0.55)}" font-family="${escapeXml(opts.headingFont)}" font-size="${Math.round(statPx * 0.4)}" font-weight="700" fill="${escapeXml(c.ink)}">OFF</text>`
      : ''
  }
  <rect x="${typeX}" y="${Math.round(h * 0.78)}" width="${Math.round(w * 0.28)}" height="${Math.round(h * 0.055)}" rx="${Math.round(h * 0.012)}" fill="${escapeXml(c.accent)}"/>
  <text x="${typeX + Math.round(w * 0.14)}" y="${Math.round(h * 0.78) + Math.round(h * 0.036)}" text-anchor="middle" font-family="${escapeXml(opts.bodyFont)}" font-size="${Math.round(h * 0.022)}" font-weight="700" fill="#FFFFFF">${escapeXml(cta)}</text>
  ${
    site
      ? `<text x="${typeX}" y="${Math.round(h * 0.9)}" font-family="${escapeXml(opts.bodyFont)}" font-size="${Math.round(h * 0.018)}" font-weight="600" fill="${escapeXml(c.ink)}">${escapeXml(site)}</text>`
      : ''
  }
</svg>`;
  overlays.push({ input: Buffer.from(copySvg), top: 0, left: 0 });

  if (opts.logoHref) {
    try {
      let logoBuf: Buffer | null = null;
      if (opts.logoHref.startsWith('data:')) {
        const b64 = opts.logoHref.split(',')[1] || '';
        logoBuf = Buffer.from(b64, 'base64');
      } else if (opts.logoHref.startsWith('/uploads/') || opts.logoHref.includes('/uploads/')) {
        const p = await localPathFromUrl(
          opts.logoHref.includes('/uploads/')
            ? opts.logoHref.slice(opts.logoHref.indexOf('/uploads/'))
            : opts.logoHref,
          opts.tenantId,
        );
        if (p) logoBuf = await fs.readFile(p);
      }
      if (logoBuf) {
        const logoW = Math.round(w * 0.16);
        const resized = await sharp(logoBuf, { failOn: 'none' })
          .resize(logoW, Math.round(logoW * 0.7), { fit: 'inside' })
          .png()
          .toBuffer();
        overlays.push({
          input: resized,
          top: Math.round(h * 0.045),
          left: typeX,
        });
      }
    } catch {
      // logo optional
    }
  }

  const out = await sharp(plate).composite(overlays).png().toBuffer();
  const dir = path.resolve(config.UPLOAD_DIR, opts.tenantId, 'posters');
  await fs.mkdir(dir, { recursive: true });
  const filename = `uploaded-master-${Date.now()}.png`;
  await fs.writeFile(path.join(dir, filename), out);
  return {
    publicUrl: `/uploads/${opts.tenantId}/posters/${filename}`,
    width: w,
    height: h,
  };
}
