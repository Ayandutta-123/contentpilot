import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config';

/** Soft ceiling for canvas layout metadata only — never used to re-encode uploads. */
export const MAX_CANVAS_EDGE = 8192;
export const MIN_CANVAS_EDGE = 240;

/** Keep original extension when safe; never force PNG→JPEG. */
export function safeImageFilename(original: string, mimetype: string): string {
  const cleaned =
    original
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 120) || 'image';
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(cleaned)) return cleaned;
  if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') return `${cleaned}.jpg`;
  if (mimetype === 'image/webp') return `${cleaned}.webp`;
  if (mimetype === 'image/gif') return `${cleaned}.gif`;
  if (mimetype === 'image/svg+xml') return `${cleaned}.svg`;
  return `${cleaned}.png`;
}

/**
 * Read pixel size without re-encoding.
 * Canvas layout may clamp to MAX_CANVAS_EDGE; the stored file is never resized.
 */
export async function imageDimensions(
  buffer: Buffer,
  fallbackW?: number,
  fallbackH?: number,
): Promise<{ width: number; height: number; nativeWidth: number; nativeHeight: number }> {
  let nativeWidth = 0;
  let nativeHeight = 0;
  try {
    const meta = await sharp(buffer, { failOn: 'none' }).metadata();
    if (meta.width && meta.height) {
      nativeWidth = meta.width;
      nativeHeight = meta.height;
    }
  } catch {
    // fall through
  }

  const clamp = (n: number) =>
    Math.min(MAX_CANVAS_EDGE, Math.max(MIN_CANVAS_EDGE, Math.round(n)));

  if (nativeWidth > 0 && nativeHeight > 0) {
    return {
      width: clamp(nativeWidth),
      height: clamp(nativeHeight),
      nativeWidth,
      nativeHeight,
    };
  }

  const fw =
    Number.isFinite(fallbackW) && (fallbackW as number) > 0
      ? clamp(fallbackW as number)
      : 1080;
  const fh =
    Number.isFinite(fallbackH) && (fallbackH as number) > 0
      ? clamp(fallbackH as number)
      : 1080;
  return { width: fw, height: fh, nativeWidth: fw, nativeHeight: fh };
}

export type StoredUpload = {
  absolutePath: string;
  publicUrl: string;
  filename: string;
  bytes: number;
  width?: number;
  height?: number;
  format?: string;
};

/**
 * Persist multipart bytes byte-identical. Never converts format or recompresses.
 */
export async function storeOriginalImage(opts: {
  tenantId: string;
  subdir: string;
  buffer: Buffer;
  originalFilename: string;
  mimetype: string;
  logLabel: string;
}): Promise<StoredUpload> {
  const dir = path.resolve(config.UPLOAD_DIR, opts.tenantId, opts.subdir);
  await fs.mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${safeImageFilename(opts.originalFilename, opts.mimetype)}`;
  const absolutePath = path.join(dir, filename);
  await fs.writeFile(absolutePath, opts.buffer);

  let width: number | undefined;
  let height: number | undefined;
  let format: string | undefined;
  try {
    const meta = await sharp(opts.buffer, { failOn: 'none' }).metadata();
    width = meta.width;
    height = meta.height;
    format = meta.format;
  } catch {
    // metadata optional
  }

  console.log(
    `[upload:${opts.logLabel}] stored original bytes=${opts.buffer.length}` +
      (width && height ? ` ${width}x${height}` : '') +
      (format ? ` format=${format}` : '') +
      ` mime=${opts.mimetype} → ${filename}`,
  );

  return {
    absolutePath,
    publicUrl: `/uploads/${opts.tenantId}/${opts.subdir}/${filename}`,
    filename,
    bytes: opts.buffer.length,
    width,
    height,
    format,
  };
}

/** If logoUrl points at a knockout derivative, prefer the sibling original when present. */
export function preferOriginalLogoUrl(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  if (!/-knockout(-v\d+)?\.(png|jpe?g|webp)$/i.test(logoUrl)) return logoUrl;
  const originalGuess = logoUrl
    .replace(/-knockout-v\d+\.(png|jpe?g|webp)$/i, '.$1')
    .replace(/-knockout\.(png|jpe?g|webp)$/i, '.$1')
    .replace(/-knockout-test\.(png|jpe?g|webp)$/i, '.$1');
  // Extension may have been forced to .png on knockout; try common originals
  const candidates = [
    originalGuess,
    logoUrl.replace(/-knockout(-v\d+|-test)?\.png$/i, '.png'),
    logoUrl.replace(/-knockout(-v\d+|-test)?\.png$/i, '.jpg'),
    logoUrl.replace(/-knockout(-v\d+|-test)?\.png$/i, '.jpeg'),
    logoUrl.replace(/-knockout(-v\d+|-test)?\.png$/i, '.webp'),
  ];
  for (const candidate of candidates) {
    if (candidate === logoUrl) continue;
    const cleaned = candidate.replace(/^\/uploads\//, '');
    const full = path.resolve(config.UPLOAD_DIR, cleaned);
    if (full.startsWith(path.resolve(config.UPLOAD_DIR)) && fsSync.existsSync(full)) {
      return candidate;
    }
  }
  return logoUrl;
}
