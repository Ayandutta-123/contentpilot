import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../../config';

/** Bump when knockout algorithm / max-edge policy changes so stale caches are ignored. */
const CACHE_SUFFIX = '-knockout-v3.png';

/** Only downscale knockout derivatives above this longest edge (lossless PNG otherwise). */
const MAX_KNOCKOUT_EDGE = 8192;

/**
 * Brand logos from Canva/etc. are often RGB (no alpha) with a solid white canvas.
 * Knock out white, un-premultiply antifalias fringes, trim, and cache a transparent PNG
 * so overlays blend into any social image without a white box.
 *
 * Never mutates the Settings upload — callers must keep logoUrl pointing at originals.
 */
export async function prepareLogoForOverlay(
  logoUrlOrPath: string,
  tenantId: string,
): Promise<string> {
  if (!logoUrlOrPath) return '';
  if (logoUrlOrPath.startsWith('data:image/png') && logoUrlOrPath.includes('base64,')) {
    return logoUrlOrPath;
  }

  let inputBuf: Buffer;
  let cacheKey = 'remote';

  if (logoUrlOrPath.startsWith('http://') || logoUrlOrPath.startsWith('https://')) {
    const res = await fetch(logoUrlOrPath);
    if (!res.ok) throw new Error(`Failed to download logo (${res.status})`);
    inputBuf = Buffer.from(await res.arrayBuffer());
    cacheKey = `url-${Buffer.from(logoUrlOrPath).toString('base64url').slice(0, 24)}`;
  } else if (logoUrlOrPath.startsWith('data:')) {
    const m = logoUrlOrPath.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
    if (!m) return logoUrlOrPath;
    inputBuf = Buffer.from(m[1], 'base64');
    cacheKey = `data-${inputBuf.length}`;
  } else {
    const cleaned = logoUrlOrPath.replace(/^\/uploads\//, '');
    const full = path.resolve(config.UPLOAD_DIR, cleaned);
    if (!full.startsWith(path.resolve(config.UPLOAD_DIR)) || !fs.existsSync(full)) {
      return logoUrlOrPath;
    }
    // Prefer original source if this path is already a knockout
    if (full.includes('-knockout')) {
      const buf = fs.readFileSync(full);
      if (full.includes(CACHE_SUFFIX) || full.endsWith(CACHE_SUFFIX)) {
        return `data:image/png;base64,${buf.toString('base64')}`;
      }
      // Old knockout — try find original without suffix
      const originalGuess = full
        .replace(/-knockout-v\d+\.png$/i, '.png')
        .replace(/-knockout\.png$/i, '.png')
        .replace(/-knockout-test\.png$/i, '.png');
      const originalCandidates = [
        originalGuess,
        full.replace(/-knockout(-v\d+|-test)?\.png$/i, '.png'),
        full.replace(/-knockout(-v\d+|-test)?\.png$/i, '.jpg'),
        full.replace(/-knockout(-v\d+|-test)?\.png$/i, '.jpeg'),
        full.replace(/-knockout(-v\d+|-test)?\.png$/i, '.webp'),
      ];
      const found = originalCandidates.find((p) => p !== full && fs.existsSync(p));
      if (found) {
        inputBuf = fs.readFileSync(found);
        cacheKey = path.basename(found, path.extname(found));
      } else {
        // Re-run knockout on existing file (may already be transparent)
        inputBuf = buf;
        cacheKey =
          path.basename(full, path.extname(full)).replace(/-knockout(-v\d+)?$/i, '') + '-fromko';
      }
    } else {
      inputBuf = fs.readFileSync(full);
      cacheKey = path.basename(full, path.extname(full));
    }
  }

  const cacheDir = path.resolve(config.UPLOAD_DIR, tenantId, 'brand-logo');
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, `${cacheKey}${CACHE_SUFFIX}`);

  if (fs.existsSync(cachePath)) {
    const cached = fs.readFileSync(cachePath);
    return `data:image/png;base64,${cached.toString('base64')}`;
  }

  const processed = await knockoutWhiteAndTrim(inputBuf);
  fs.writeFileSync(cachePath, processed);
  console.log(
    `[logo-prepare] knockout cache bytes=${processed.length} key=${cacheKey} (source bytes=${inputBuf.length})`,
  );
  return `data:image/png;base64,${processed.toString('base64')}`;
}

/**
 * Remove solid white backgrounds and recover true edge colors (no white halo).
 * Uses: alpha ≈ 1 - min(R,G,B)/255, then unblends from white.
 * Output is lossless PNG at full resolution (or capped only if enormous).
 */
export async function knockoutWhiteAndTrim(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = data;
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = px[o];
    const g = px[o + 1];
    const b = px[o + 2];
    const minC = Math.min(r, g, b);
    const maxC = Math.max(r, g, b);

    // Already transparent
    if (px[o + 3] < 8) {
      px[o + 3] = 0;
      continue;
    }

    // Near-pure white / very light neutral → fully gone
    if (minC >= 248 && maxC - minC <= 12) {
      px[o] = 0;
      px[o + 1] = 0;
      px[o + 2] = 0;
      px[o + 3] = 0;
      continue;
    }

    // Unblend from white: out = src*a + 255*(1-a)  =>  a = 1 - min/255
    const a = 1 - minC / 255;
    if (a < 0.04) {
      px[o] = 0;
      px[o + 1] = 0;
      px[o + 2] = 0;
      px[o + 3] = 0;
      continue;
    }

    const invA = 1 / a;
    px[o] = Math.max(0, Math.min(255, Math.round((r / 255 - (1 - a)) * invA * 255)));
    px[o + 1] = Math.max(0, Math.min(255, Math.round((g / 255 - (1 - a)) * invA * 255)));
    px[o + 2] = Math.max(0, Math.min(255, Math.round((b / 255 - (1 - a)) * invA * 255)));
    px[o + 3] = Math.round(a * 255);
  }

  let pipeline = sharp(px, {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).trim({ threshold: 10 });

  const longest = Math.max(info.width, info.height);
  if (longest > MAX_KNOCKOUT_EDGE) {
    pipeline = pipeline.resize({
      width: MAX_KNOCKOUT_EDGE,
      height: MAX_KNOCKOUT_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
    });
  }

  // compressionLevel affects size only — PNG stays lossless
  return pipeline.png({ compressionLevel: 9, effort: 7 }).toBuffer();
}
