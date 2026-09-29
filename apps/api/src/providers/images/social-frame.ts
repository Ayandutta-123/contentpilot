import fs from 'fs';
import path from 'path';
import { config } from '../../config';

export type SocialImageFormat = 'instagram_square' | 'instagram_portrait' | 'linkedin' | 'story';

export type LogoPlacement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Canvas-corner box for a logo watermark (used by social / insight / poster frames). */
export function logoCornerBox(
  placement: LogoPlacement,
  canvasW: number,
  canvasH: number,
  logoW: number,
  logoH: number,
  pad: number,
): { x: number; y: number; top: boolean; left: boolean } {
  const top = placement === 'top-left' || placement === 'top-right';
  const left = placement === 'top-left' || placement === 'bottom-left';
  return {
    x: left ? pad : canvasW - pad - logoW,
    y: top ? pad : canvasH - pad - logoH,
    top,
    left,
  };
}

export type VisualStyleId =
  | 'professional_photo'
  | 'cinematic_photo'
  | 'illustration'
  | 'vector_flat'
  | '3d_render'
  | 'watercolor'
  | 'line_art'
  | 'editorial_collage'
  | 'meme_comic'
  | 'custom';

export const SOCIAL_IMAGE_FORMATS: Record<
  SocialImageFormat,
  { label: string; width: number; height: number; falSize: string | { width: number; height: number } }
> = {
  instagram_square: {
    label: 'Instagram / feed (1080×1080)',
    width: 1080,
    height: 1080,
    falSize: 'square_hd',
  },
  instagram_portrait: {
    label: 'Instagram portrait (1080×1350)',
    width: 1080,
    height: 1350,
    falSize: { width: 1080, height: 1350 },
  },
  linkedin: {
    label: 'LinkedIn (1200×627)',
    width: 1200,
    height: 627,
    falSize: { width: 1200, height: 627 },
  },
  story: {
    label: 'Story / Reels (1080×1920)',
    width: 1080,
    height: 1920,
    falSize: { width: 1080, height: 1920 },
  },
};

/** Presets users can pick in Approvals / generators — LinkedIn/B2B social quality */
export const VISUAL_STYLE_PRESETS: Array<{
  id: VisualStyleId;
  label: string;
  hint: string;
  prompt: string;
}> = [
  {
    id: 'professional_photo',
    label: 'Professional photo',
    hint: 'Clean B2B photography',
    prompt:
      'Photorealistic LinkedIn-ready B2B photography of a plausible real-world scene, natural soft key light, shallow depth of field, magazine finish. Prefer interiors, streets, stages, or product stills — never outdoor server racks, holographic wireframes, or sci-fi HUD overlays.',
  },
  {
    id: 'cinematic_photo',
    label: 'Cinematic photo',
    hint: 'Dramatic lighting',
    prompt:
      'Cinematic photorealistic advertising still of a believable location, controlled rim light, rich but restrained contrast, premium brand campaign photography for LinkedIn. No floating holograms, no rooftop data centres, no neon circuit floors.',
  },
  {
    id: 'illustration',
    label: 'Illustration',
    hint: 'B2B editorial illustration',
    prompt:
      'Premium B2B editorial illustration for LinkedIn/Instagram (Stripe / Notion / McKinsey marketing art quality): polished digital painting, clear conceptual metaphor that matches the topic, soft studio lighting, restrained corporate color palette, generous calm negative space, sophisticated and trustworthy — NOT sci-fi cyborg heads, NOT neon cyberpunk, NOT robotic faces, NOT clipart, NOT icon packs, NOT generic “AI brain” stock.',
  },
  {
    id: 'vector_flat',
    label: 'Vector / flat',
    hint: 'Clean geometric vector',
    prompt:
      'Modern flat vector social graphic for B2B LinkedIn, crisp geometry, limited refined palette, Swiss-poster clarity, intentional whitespace, premium SaaS brand system — not 3D, not photo, not clipart.',
  },
  {
    id: '3d_render',
    label: '3D render',
    hint: 'Soft studio 3D',
    prompt:
      'Premium soft-studio 3D product/tech visualization for B2B social, gentle global illumination, matte materials, contemporary SaaS aesthetic — tasteful, not gamer CGI.',
  },
  {
    id: 'watercolor',
    label: 'Watercolor',
    hint: 'Artistic wash',
    prompt:
      'Elegant watercolor editorial illustration for a premium B2B brand, controlled pigment, fine paper texture, calm sophisticated palette — gallery quality, not children’s art.',
  },
  {
    id: 'line_art',
    label: 'Line art',
    hint: 'Minimal ink lines',
    prompt:
      'Refined continuous-line editorial illustration, minimalist black plus one brand accent, sophisticated negative space, LinkedIn thought-leadership aesthetic.',
  },
  {
    id: 'editorial_collage',
    label: 'Editorial collage',
    hint: 'Magazine collage',
    prompt:
      'Contemporary editorial collage for a serious business magazine cover, layered paper/photo textures, bold but professional composition — FT / Wired energy, not chaotic scrapbook.',
  },
  {
    id: 'meme_comic',
    label: 'Meme / comic',
    hint: 'Internet meme illustration',
    prompt:
      'Crude high-contrast internet meme comic illustration, bold simple shapes, thick outlines, flat saturated colors, anonymous silhouettes only, viral social-meme energy — NOT photorealistic, NOT corporate photography, NOT glossy B2B stock, NO celebrity likeness, NO readable text in the artwork.',
  },
  {
    id: 'custom',
    label: 'Custom (prompt only)',
    hint: 'Follow prompt / brand style',
    prompt: '',
  },
];

export function resolveVisualStylePrompt(
  styleId?: string | null,
  customStyle?: string | null,
): string {
  const preset = VISUAL_STYLE_PRESETS.find((p) => p.id === styleId);
  const custom = (customStyle || '').trim();
  if (preset && preset.id !== 'custom' && preset.prompt) {
    // Preset sets the medium; brand style still steers palette and mood.
    return custom ? `${preset.prompt} Brand style to respect within that medium: ${custom}` : preset.prompt;
  }
  return custom;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export type OverlayFontId = 'serif' | 'sans' | 'display' | 'modern';

export const OVERLAY_FONTS: Record<OverlayFontId, { label: string; css: string }> = {
  serif: { label: 'Serif (editorial)', css: 'Georgia,Times New Roman,serif' },
  sans: { label: 'Sans (clean)', css: 'Helvetica Neue,Helvetica,Arial,sans-serif' },
  display: { label: 'Display (bold)', css: 'Arial Black,Helvetica Bold,Arial,sans-serif' },
  modern: { label: 'Modern UI', css: 'system-ui,Segoe UI,Roboto,sans-serif' },
};

export type OverlayStyleOpts = {
  /** When false: no logo, no header, no footer CTA — clean art only */
  overlaysEnabled?: boolean;
  headerFontSize?: number; // px at canvas resolution (e.g. 36–72)
  footerFontSize?: number;
  headerFont?: OverlayFontId;
  footerFont?: OverlayFontId;
  /** Optional direct CSS fallback from Brand Kit mapping. */
  headerFontCss?: string;
  footerFontCss?: string;
  /** Max header lines (default 3) */
  headerMaxLines?: number;
  footerMaxLines?: number;
};

export function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    // Break very long single words
    if (w.length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = '';
        if (lines.length >= maxLines) return lines.slice(0, maxLines);
      }
      let rest = w;
      while (rest.length > maxChars && lines.length < maxLines) {
        lines.push(rest.slice(0, maxChars - 1) + '…');
        rest = rest.slice(maxChars - 1);
        if (lines.length >= maxLines) return lines.slice(0, maxLines);
      }
      cur = rest;
      continue;
    }
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // If we overflowed words, ellipsis last line
  if (lines.length >= maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    if (last && !last.endsWith('…')) {
      lines[maxLines - 1] = last.length > 3 ? `${last.slice(0, -1)}…` : `${last}…`;
    }
  }
  return lines.slice(0, maxLines);
}

/** Approx chars per line for a given font size / canvas width (conservative to avoid clipping). */
export function charsPerLine(width: number, fontPx: number, pad: number): number {
  const usable = width - pad * 2;
  // Serif bold is wider — use ~0.58em average char width
  return Math.max(12, Math.floor(usable / (fontPx * 0.58)));
}

function resolveLocalUploadToDataUri(urlOrPath: string): string {
  if (!urlOrPath) return '';
  if (urlOrPath.startsWith('data:')) return urlOrPath;
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    return urlOrPath;
  }
  const cleaned = urlOrPath.replace(/^\/uploads\//, '');
  const full = path.resolve(config.UPLOAD_DIR, cleaned);
  if (!full.startsWith(path.resolve(config.UPLOAD_DIR)) || !fs.existsSync(full)) {
    return urlOrPath;
  }
  const buf = fs.readFileSync(full);
  const ext = path.extname(full).toLowerCase();
  const mime =
    ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export async function resolveImageHrefAsync(urlOrPath: string): Promise<string> {
  if (!urlOrPath) return '';
  if (urlOrPath.startsWith('data:')) return urlOrPath;

  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    const res = await fetch(urlOrPath);
    if (!res.ok) {
      throw new Error(`Failed to download generated image (${res.status})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ctype = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
    const mime = ctype.startsWith('image/') ? ctype : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  return resolveLocalUploadToDataUri(urlOrPath);
}

/**
 * Composite logo + optional header / footer CTA onto the finished poster.
 * Edge-to-edge art (no letterbox border). Logo is transparent-friendly, no white tile.
 */
export async function brandSocialFrame(opts: {
  tenantId: string;
  imageUrl: string;
  companyName?: string | null;
  logoUrl?: string | null;
  format?: SocialImageFormat;
  logoPlacement?: LogoPlacement;
  headerText?: string | null;
  footerCta?: string | null;
  overlay?: OverlayStyleOpts;
}): Promise<{ publicUrl: string; width: number; height: number }> {
  const format = opts.format || 'instagram_square';
  const placement: LogoPlacement = opts.logoPlacement || 'top-left';
  const { width, height } = SOCIAL_IMAGE_FORMATS[format];
  const overlay = opts.overlay || {};
  /** Off = clean art only — no header, footer CTA, or logo watermark. */
  const overlaysOn = overlay.overlaysEnabled !== false;
  const bgHref = escapeXml(await resolveImageHrefAsync(opts.imageUrl));

  let logoHref = '';
  if (overlaysOn && opts.logoUrl) {
    try {
      const { prepareLogoForOverlay } = await import('./logo-prepare');
      const prepared = await prepareLogoForOverlay(opts.logoUrl, opts.tenantId);
      logoHref = escapeXml(prepared || (await resolveImageHrefAsync(opts.logoUrl)));
    } catch {
      try {
        logoHref = escapeXml(await resolveImageHrefAsync(opts.logoUrl));
      } catch {
        logoHref = '';
      }
    }
  }

  const pad = Math.round(Math.min(width, height) * 0.055);
  // Wordmark after knockout is wide — size for social watermark, not a sticker box
  const logoMaxW = Math.round(width * 0.2);
  const logoMaxH = Math.round(height * 0.07);
  const { x: logoX, y: logoY, top: topLogo, left: leftLogo } = logoCornerBox(
    placement,
    width,
    height,
    logoMaxW,
    logoMaxH,
    pad,
  );
  const logoAlign = 'xMidYMid';

  // Transparent logo + soft shadow only — no white plate (blends on any image)
  const logoBlock = logoHref
    ? `<g filter="url(#logoBlend)">
        <image
          href="${logoHref}"
          x="${logoX}"
          y="${logoY}"
          width="${logoMaxW}"
          height="${logoMaxH}"
          preserveAspectRatio="${logoAlign} meet"
        />
      </g>`
    : '';

  const rawName = (opts.companyName || '').trim();
  const nameEl =
    !logoHref && rawName
      ? `<text x="${leftLogo ? pad : width - pad}" y="${
          topLogo ? pad + Math.round(height * 0.028) : height - pad
        }" font-family="${OVERLAY_FONTS.sans.css}" font-size="${Math.round(
          height * 0.022,
        )}" font-weight="600" fill="#ffffff" filter="url(#textLegibility)" text-anchor="${leftLogo ? 'start' : 'end'}">${escapeXml(
          rawName,
        )}</text>`
      : '';

  const header = overlaysOn ? (opts.headerText || '').trim() : '';
  const footer = overlaysOn ? (opts.footerCta || '').trim() : '';

  const headerFontPx = Math.round(
    Math.min(Math.max(overlay.headerFontSize || height * 0.04, 22), height * 0.065),
  );
  const footerFontPx = Math.round(
    Math.min(Math.max(overlay.footerFontSize || height * 0.024, 16), height * 0.04),
  );
  const headerFontCss = overlay.headerFontCss?.trim() || OVERLAY_FONTS[overlay.headerFont || 'serif'].css;
  const footerFontCss = overlay.footerFontCss?.trim() || OVERLAY_FONTS[overlay.footerFont || 'modern'].css;
  const headerMaxLines = overlay.headerMaxLines ?? 3;
  const footerMaxLines = overlay.footerMaxLines ?? 2;

  // When logo is top-left, indent header below the logo with breathing room
  const headerTop =
    topLogo && logoHref
      ? pad + logoMaxH + Math.round(height * 0.028)
      : pad + Math.round(height * 0.022);
  const headerMaxChars = charsPerLine(width, headerFontPx, pad);
  const footerMaxChars = charsPerLine(width, footerFontPx, pad);
  const headerLines = header ? wrapLines(header, headerMaxChars, headerMaxLines) : [];
  const footerLines = footer ? wrapLines(footer, footerMaxChars, footerMaxLines) : [];

  const headerScrimH = Math.round(
    headerTop + headerLines.length * headerFontPx * 1.28 + pad * 1.1,
  );
  const headerBlock =
    headerLines.length > 0
      ? `<g>
          <rect x="0" y="0" width="${width}" height="${headerScrimH}" fill="url(#headerScrim)"/>
          ${headerLines
            .map(
              (line, i) =>
                `<text x="${pad}" y="${headerTop + headerFontPx + i * headerFontPx * 1.28}" font-family="${headerFontCss}" font-size="${headerFontPx}" font-weight="700" fill="#ffffff" filter="url(#textLegibility)">${escapeXml(
                  line,
                )}</text>`,
            )
            .join('')}
        </g>`
      : '';

  const footerH = Math.round(
    pad * 1.4 + footerLines.length * footerFontPx * 1.3 + (footerLines.length ? pad * 0.5 : 0),
  );
  const footerBlock =
    footerLines.length > 0
      ? `<g>
          <rect x="0" y="${height - Math.max(footerH, Math.round(height * 0.14))}" width="${width}" height="${Math.max(
            footerH,
            Math.round(height * 0.14),
          )}" fill="url(#footerScrim)"/>
          ${footerLines
            .map(
              (line, i) =>
                `<text x="${width / 2}" y="${
                  height - pad - (footerLines.length - 1 - i) * footerFontPx * 1.3
                }" font-family="${footerFontCss}" font-size="${footerFontPx}" font-weight="600" fill="#ffffff" text-anchor="middle" filter="url(#textLegibility)">${escapeXml(
                  line,
                )}</text>`,
            )
            .join('')}
        </g>`
      : '';

  // Full-bleed square/rect — no rounded corners, no outer chrome
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <clipPath id="frame"><rect width="${width}" height="${height}"/></clipPath>
    <filter id="logoBlend" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="1" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.4"/>
    </filter>
    <filter id="textLegibility" x="-5%" y="-5%" width="110%" height="110%">
      <feDropShadow dx="0" dy="1" stdDeviation="2.2" flood-color="#000000" flood-opacity="0.65"/>
    </filter>
    <linearGradient id="headerScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.72"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="footerScrim" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.7"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#frame)">
    <image href="${bgHref}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
    ${headerBlock}
    ${footerBlock}
    ${logoBlock}
    ${nameEl}
  </g>
</svg>`;

  const dir = path.resolve(config.UPLOAD_DIR, opts.tenantId, 'social-images');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `social-${format}-${Date.now()}.svg`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, svg, 'utf8');
  return {
    publicUrl: `/uploads/${opts.tenantId}/social-images/${filename}`,
    width,
    height,
  };
}

export type NewsletterEditionContent = {
  volumeLabel?: string;
  dateLabel?: string;
  headline: string;
  intro: string;
  sectionTitle: string;
  sectionTitleRight?: string;
  sectionBodyLeft: string;
  sectionBodyRight: string;
  featureTitle: string;
  featureBody: string;
  sneakPeek: Array<{ title: string; text: string }>;
  closing: string;
  cta: string;
  websiteUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
};

/** Default editorial page size — tall newsletter document, not a social tile. */
export const NEWSLETTER_PAGE = { width: 1080, height: 1600 } as const;

/** Wrap all words; only ellipsize if we hit a hard safety cap. */
function wrapFit(text: string, maxChars: number, maxLines: number): string[] {
  const words = (text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (w.length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = '';
        if (lines.length >= maxLines) break;
      }
      let rest = w;
      while (rest.length > maxChars && lines.length < maxLines) {
        lines.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      }
      cur = rest;
      if (lines.length >= maxLines) break;
      continue;
    }
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines.slice(0, maxLines);
}

function textBlock(
  lines: string[],
  x: number,
  startY: number,
  opts: { size: number; weight?: string; fill: string; lineH: number; font?: string },
): string {
  const font = opts.font || OVERLAY_FONTS.modern.css;
  return lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${startY + i * opts.lineH}" font-family="${font}" font-size="${opts.size}" font-weight="${
          opts.weight || '400'
        }" fill="${opts.fill}">${escapeXml(line)}</text>`,
    )
    .join('');
}

function newsletterPaperColors(opts: {
  brandImageStyle?: string | null;
  palette?: Partial<InsightPalette>;
}): {
  paper: string;
  ink: string;
  muted: string;
  header: string;
  accent: string;
  onHeader: string;
  rule: string;
  soft: string;
  headerMeta: string;
} {
  const kit = { ...parseBrandPalette(opts.brandImageStyle), ...opts.palette };
  const header = luminance(kit.ground) < 0.52 ? kit.ground : mixHex(kit.ground, '#10141C', 0.62);
  const accent = kit.accent || '#C9A227';
  const paper = '#FFFFFF';
  const ink = mixHex(header, '#12141A', 0.28);
  const muted = mixHex(ink, paper, 0.42);
  const onHeader = luminance(header) < 0.45 ? '#FFFFFF' : '#12141A';
  return {
    paper,
    ink,
    muted,
    header,
    accent,
    onHeader,
    rule: mixHex(ink, paper, 0.82),
    soft: mixHex(header, paper, 0.93),
    headerMeta: mixHex(onHeader, header, 0.28),
  };
}

/**
 * Multi-section B2B newsletter page (no brand template).
 * Light editorial paper, Brand Kit colors/fonts, independent columns, no clipped copy.
 */
export async function newsletterSocialFrame(opts: {
  tenantId: string;
  imageUrl: string;
  companyName?: string | null;
  logoUrl?: string | null;
  edition: NewsletterEditionContent;
  brandImageStyle?: string | null;
  palette?: Partial<InsightPalette>;
  headingFontCss?: string | null;
  bodyFontCss?: string | null;
}): Promise<{ publicUrl: string; width: number; height: number }> {
  const width = NEWSLETTER_PAGE.width;
  const c = newsletterPaperColors(opts);
  const headingFont = opts.headingFontCss || OVERLAY_FONTS.serif.css;
  const bodyFont = opts.bodyFontCss || OVERLAY_FONTS.sans.css;
  const padX = 72;
  const contentW = width - padX * 2;
  const colGap = 48;
  const colW = Math.floor((contentW - colGap) / 2);
  const rightX = padX + colW + colGap;
  const artHref = escapeXml(await resolveImageHrefAsync(opts.imageUrl));
  const company = (opts.companyName || '').trim() || 'Newsletter';
  const website = (opts.edition.websiteUrl || '').replace(/^https?:\/\//i, '').replace(/\/$/, '').trim();

  let logoHref = '';
  if (opts.logoUrl) {
    try {
      const { prepareLogoForOverlay } = await import('./logo-prepare');
      const prepared = await prepareLogoForOverlay(opts.logoUrl, opts.tenantId);
      logoHref = escapeXml(prepared || (await resolveImageHrefAsync(opts.logoUrl)));
    } catch {
      try {
        logoHref = escapeXml(await resolveImageHrefAsync(opts.logoUrl));
      } catch {
        logoHref = '';
      }
    }
  }

  const ed = opts.edition;
  const volume = ed.volumeLabel || 'Volume 01';
  const dateLabel =
    ed.dateLabel || new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const headline = (ed.headline || 'Product update').trim();
  const intro = (ed.intro || '').trim();
  const leftTitle = (ed.sectionTitle || 'This edition').trim();
  const rightTitle = (ed.sectionTitleRight || ed.featureTitle || 'Also in this issue').trim();
  const featureTitle = (ed.featureTitle || 'In focus').trim();
  const peek = (ed.sneakPeek || []).filter((p) => p.title && p.text).slice(0, 3);
  const closing = (ed.closing || 'Thank you for reading. Reach out if you want a walkthrough.').trim();
  const cta = (ed.cta || 'Learn more').trim();

  const headChars = charsPerLine(contentW, 30, 0);
  const bodyChars = charsPerLine(contentW, 16, 0);
  const colTitleChars = charsPerLine(colW, 20, 0);
  const colBodyChars = charsPerLine(colW, 15, 0);
  const peekChars = charsPerLine(colW - 28, 13, 0);
  const footerChars = charsPerLine(contentW - 64, 15, 0);

  const headlineLines = wrapFit(headline, headChars, 4);
  const introLines = wrapFit(intro, bodyChars, 8);
  const leftTitleLines = wrapFit(leftTitle, colTitleChars, 3);
  const rightTitleLines = wrapFit(rightTitle, colTitleChars, 3);
  const leftLines = wrapFit(ed.sectionBodyLeft || '', colBodyChars, 16);
  const rightLines = wrapFit(ed.sectionBodyRight || '', colBodyChars, 16);
  const featureTitleLines = wrapFit(featureTitle, colTitleChars, 3);
  const peekTitleLines = wrapFit('In this edition', colTitleChars, 2);
  const featureLines = wrapFit(ed.featureBody || '', colBodyChars, 16);
  const closingLines = wrapFit(closing, footerChars, 6);

  const peekPrepared = peek.map((item) => ({
    titleLines: wrapFit(item.title, peekChars, 2),
    textLines: wrapFit(item.text, peekChars, 4),
  }));

  const parts: string[] = [];
  let y = 0;
  const headerH = 92;
  const logoBlock = logoHref
    ? `<image href="${logoHref}" x="${padX}" y="22" width="200" height="48" preserveAspectRatio="xMinYMid meet"/>`
    : `<text x="${padX}" y="54" font-family="${headingFont}" font-size="22" font-weight="700" fill="${c.onHeader}">${escapeXml(
        company,
      )}</text>`;

  parts.push(`<rect width="${width}" height="${headerH}" fill="${c.header}"/>`);
  parts.push(`<rect y="${headerH}" width="${width}" height="4" fill="${c.accent}"/>`);
  parts.push(logoBlock);
  parts.push(
    `<text x="${width - padX}" y="40" text-anchor="end" font-family="${bodyFont}" font-size="12" letter-spacing="0.6" fill="${c.headerMeta}">${escapeXml(
      `NEWSLETTER  ·  ${volume}  ·  ${dateLabel}`,
    )}</text>`,
  );
  parts.push(
    `<text x="${width - padX}" y="62" text-anchor="end" font-family="${bodyFont}" font-size="12" fill="${c.headerMeta}">${escapeXml(
      website || company,
    )}</text>`,
  );
  y = headerH + 4 + 40;

  parts.push(
    `<text x="${padX}" y="${y}" font-family="${headingFont}" font-size="12" font-weight="700" letter-spacing="2.4" fill="${c.accent}">NEWSLETTER</text>`,
  );
  y += 36;
  parts.push(textBlock(headlineLines, padX, y, { size: 30, weight: '700', fill: c.ink, lineH: 36, font: headingFont }));
  y += headlineLines.length * 36 + 18;
  parts.push(textBlock(introLines, padX, y, { size: 16, fill: c.muted, lineH: 24, font: bodyFont }));
  y += introLines.length * 24 + 36;

  const heroH = 340;
  const heroY = y;
  parts.push(`<rect x="${padX}" y="${heroY}" width="${contentW}" height="${heroH}" rx="10" fill="${c.soft}"/>`);
  parts.push(
    `<clipPath id="heroClip"><rect x="${padX}" y="${heroY}" width="${contentW}" height="${heroH}" rx="10"/></clipPath>`,
  );
  parts.push(
    `<g clip-path="url(#heroClip)"><image href="${artHref}" x="${padX}" y="${heroY}" width="${contentW}" height="${heroH}" preserveAspectRatio="xMidYMid slice"/></g>`,
  );
  y = heroY + heroH + 48;

  // Two titled articles — each column has its own heading, then body. Advance by the taller column.
  const articleTitleH = Math.max(leftTitleLines.length, rightTitleLines.length, 1) * 26;
  parts.push(textBlock(leftTitleLines, padX, y, { size: 20, weight: '700', fill: c.ink, lineH: 26, font: headingFont }));
  parts.push(textBlock(rightTitleLines, rightX, y, { size: 20, weight: '700', fill: c.ink, lineH: 26, font: headingFont }));
  y += articleTitleH + 10;
  parts.push(`<line x1="${padX}" y1="${y}" x2="${padX + colW}" y2="${y}" stroke="${c.rule}" stroke-width="1"/>`);
  parts.push(`<line x1="${rightX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="${c.rule}" stroke-width="1"/>`);
  y += 22;
  parts.push(textBlock(leftLines, padX, y, { size: 15, fill: c.ink, lineH: 23, font: bodyFont }));
  parts.push(textBlock(rightLines, rightX, y, { size: 15, fill: c.ink, lineH: 23, font: bodyFont }));
  y += Math.max(leftLines.length, rightLines.length, 1) * 23 + 48;

  const midTitleH = Math.max(featureTitleLines.length, peekTitleLines.length, 1) * 26;
  parts.push(
    textBlock(featureTitleLines, padX, y, { size: 20, weight: '700', fill: c.ink, lineH: 26, font: headingFont }),
  );
  parts.push(
    textBlock(peekTitleLines, rightX, y, { size: 20, weight: '700', fill: c.ink, lineH: 26, font: headingFont }),
  );
  y += midTitleH + 10;
  parts.push(`<line x1="${padX}" y1="${y}" x2="${padX + colW}" y2="${y}" stroke="${c.rule}" stroke-width="1"/>`);
  parts.push(`<line x1="${rightX}" y1="${y}" x2="${width - padX}" y2="${y}" stroke="${c.rule}" stroke-width="1"/>`);
  y += 22;
  const midBodyY = y;
  parts.push(textBlock(featureLines, padX, midBodyY, { size: 15, fill: c.ink, lineH: 23, font: bodyFont }));

  let peekY = midBodyY;
  const peekSvg = peekPrepared
    .map((item, i) => {
      const titleH = item.titleLines.length * 18;
      const textH = item.textLines.length * 18;
      const blockH = titleH + 6 + textH + 20;
      const cx = rightX + 8;
      const g = `<g>
        <circle cx="${cx}" cy="${peekY - 4}" r="5" fill="${c.accent}"/>
        ${
          i < peekPrepared.length - 1
            ? `<line x1="${cx}" y1="${peekY + 4}" x2="${cx}" y2="${peekY + blockH - 16}" stroke="${c.rule}" stroke-width="1.5"/>`
            : ''
        }
        ${textBlock(item.titleLines, cx + 18, peekY, { size: 14, weight: '700', fill: c.ink, lineH: 18, font: headingFont })}
        ${textBlock(item.textLines, cx + 18, peekY + titleH + 6, { size: 13, fill: c.muted, lineH: 18, font: bodyFont })}
      </g>`;
      peekY += blockH;
      return g;
    })
    .join('');
  parts.push(peekSvg);
  y = Math.max(midBodyY + featureLines.length * 23, peekY) + 44;

  const contactBits = [ed.contactPhone, ed.contactEmail, website].filter(Boolean) as string[];
  const footerInnerTop = 32;
  const footerTextH = closingLines.length * 22;
  const footerH = footerInnerTop + footerTextH + 28 + 36 + 24;
  const footerY = y;
  parts.push(`<rect x="${padX}" y="${footerY}" width="${contentW}" height="${footerH}" rx="14" fill="${c.header}"/>`);
  parts.push(
    textBlock(closingLines, padX + 32, footerY + footerInnerTop + 14, {
      size: 15,
      fill: c.onHeader,
      lineH: 22,
      font: bodyFont,
    }),
  );
  const ruleY = footerY + footerInnerTop + footerTextH + 24;
  parts.push(
    `<line x1="${padX + 32}" y1="${ruleY}" x2="${width - padX - 32}" y2="${ruleY}" stroke="${mixHex(
      c.onHeader,
      c.header,
      0.55,
    )}" stroke-width="1"/>`,
  );
  parts.push(
    `<text x="${padX + 32}" y="${ruleY + 28}" font-family="${headingFont}" font-size="14" font-weight="700" fill="${c.accent}">${escapeXml(
      cta,
    )} →</text>`,
  );
  parts.push(
    `<text x="${width - padX - 32}" y="${ruleY + 28}" text-anchor="end" font-family="${bodyFont}" font-size="13" fill="${c.headerMeta}">${escapeXml(
      contactBits.join('  ·  ') || company,
    )}</text>`,
  );
  y = footerY + footerH + 48;
  const height = Math.max(NEWSLETTER_PAGE.height, y);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${c.paper}"/>
  ${parts.join('\n  ')}
</svg>`;

  const dir = path.resolve(config.UPLOAD_DIR, opts.tenantId, 'social-images');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `newsletter-page-${Date.now()}.svg`;
  fs.writeFileSync(path.join(dir, filename), svg, 'utf8');
  return { publicUrl: `/uploads/${opts.tenantId}/social-images/${filename}`, width, height };
}

export type InsightReportContent = {
  headline: string;
  /** Unused for layout — kept so older callers still type-check. */
  headlineAccent?: string;
  subheadline: string;
  points: Array<{ title?: string; text: string }>;
  summary: string;
  calloutTitle: string;
  calloutBody: string;
};

export type InsightPalette = {
  ground: string;
  ink: string;
  muted: string;
  accent: string;
  panel: string;
  onAccent: string;
};

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').trim();
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-fA-F]{6}$/.test(n)) return null;
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}

export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const lin = [rgb.r, rgb.g, rgb.b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  if (!A || !B) return a;
  const u = Math.min(1, Math.max(0, t));
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(Math.round(A.r + (B.r - A.r) * u))}${h(Math.round(A.g + (B.g - A.g) * u))}${h(
    Math.round(A.b + (B.b - A.b) * u),
  )}`;
}

/** Pull brand hexes out of imageStyle / a color line. Never invent a second brand. */
export function parseBrandPalette(styleText?: string | null): InsightPalette {
  const hexes = [...(styleText || '').matchAll(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g)].map(
    (m) => (m[0].length === 4 ? `#${m[1][0]}${m[1][0]}${m[1][1]}${m[1][1]}${m[1][2]}${m[1][2]}` : m[0]),
  );
  const named: Record<string, string> = {
    navy: '#0B1F3A',
    indigo: '#1E3A5F',
    teal: '#0F766E',
    amber: '#D97706',
    gold: '#C9A227',
    coral: '#E06B4F',
    crimson: '#B42318',
    forest: '#14532D',
    charcoal: '#111827',
  };
  const namedHits = Object.entries(named)
    .filter(([name]) => new RegExp(`\\b${name}\\b`, 'i').test(styleText || ''))
    .map(([, hex]) => hex);
  const colors = [...hexes, ...namedHits];
  const dominant = colors[0] || '#0B1220';
  const accent = colors[1] || colors[0] || '#C9844A';
  const darkGround = luminance(dominant) < 0.45;
  const ground = darkGround ? dominant : mixHex(dominant, '#0B1220', 0.72);
  const ink = luminance(ground) < 0.45 ? '#F7F4EE' : '#111827';
  const muted = mixHex(ink, ground, 0.38);
  const onAccent = luminance(accent) < 0.45 ? '#F7F4EE' : '#1A1208';
  const panel = mixHex(ground, ink, 0.08);
  return { ground, ink, muted, accent, panel, onAccent };
}

function insightTextBlock(
  lines: string[],
  x: number,
  y: number,
  fontPx: number,
  fill: string,
  weight: number,
  lineH: number,
  font = OVERLAY_FONTS.modern.css,
): string {
  return lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${Math.round(y + fontPx + i * lineH)}" font-family="${font}" font-size="${fontPx}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`,
    )
    .join('\n');
}

/**
 * Designed insight poster. Art lives in a reserved frame — never behind type.
 * Colors come from Brand imageStyle hexes / named hues, not a hardcoded coral kit.
 */
export async function insightSocialFrame(opts: {
  tenantId: string;
  imageUrl: string;
  companyName?: string | null;
  logoUrl?: string | null;
  report: InsightReportContent;
  width?: number;
  height?: number;
  brandImageStyle?: string | null;
  palette?: Partial<InsightPalette>;
  /** Corner for the brand mark — defaults to top-left. */
  logoPlacement?: LogoPlacement;
}): Promise<{ publicUrl: string; width: number; height: number }> {
  const width = opts.width || 1080;
  const height = opts.height || 1350;
  const pad = Math.round(Math.min(width, height) * 0.055);
  const gap = 16;
  const font = OVERLAY_FONTS.modern.css;
  const colors = { ...parseBrandPalette(opts.brandImageStyle), ...opts.palette };
  const placement: LogoPlacement = opts.logoPlacement || 'top-left';

  const artHref = escapeXml(await resolveImageHrefAsync(opts.imageUrl));
  let logoHref = '';
  if (opts.logoUrl) {
    try {
      const { prepareLogoForOverlay } = await import('./logo-prepare');
      const prepared = await prepareLogoForOverlay(opts.logoUrl, opts.tenantId);
      logoHref = escapeXml(prepared || (await resolveImageHrefAsync(opts.logoUrl)));
    } catch {
      try {
        logoHref = escapeXml(await resolveImageHrefAsync(opts.logoUrl));
      } catch {
        logoHref = '';
      }
    }
  }

  const company = (opts.companyName || '').trim() || 'Brand';
  const r = opts.report;
  const headline = (r.headline || '').trim() || 'Key insight';
  const sub = (r.subheadline || '').trim();
  const points = (r.points || [])
    .map((p) => ({
      title: (p.title || '').trim() || 'Point',
      text: (p.text || '').trim(),
    }))
    .filter((p) => p.text)
    .slice(0, 3);
  while (points.length < 3) {
    points.push({ title: `Point ${points.length + 1}`, text: 'Add a supporting line.' });
  }
  const summary = (r.summary || '').trim();
  const calloutTitle = (r.calloutTitle || '').trim() || 'Next step';
  const calloutBody = (r.calloutBody || '').trim();

  const headPx = Math.round(Math.min(width, height) * 0.042);
  const subPx = Math.round(Math.min(width, height) * 0.02);
  const bodyPx = Math.round(Math.min(width, height) * 0.016);
  const headLines = wrapLines(headline, charsPerLine(width, headPx, pad), 3);
  const subLines = sub ? wrapLines(sub, charsPerLine(width, subPx, pad), 2) : [];
  const headH = headLines.length * Math.round(headPx * 1.18);
  const subH = subLines.length * Math.round(subPx * 1.35);

  const logoH = 44;
  const logoW = 168;
  const corner = logoCornerBox(placement, width, height, logoW, logoH, pad);
  let y = pad;
  // Top placements reserve flow space under the mark; bottom placements stamp as a corner watermark.
  const logoBlock = logoHref
    ? `<image href="${logoHref}" x="${corner.x}" y="${corner.y}" width="${logoW}" height="${logoH}" preserveAspectRatio="${
        corner.left ? 'xMinYMid' : 'xMaxYMid'
      } meet"/>`
    : `<text x="${corner.left ? pad : width - pad}" y="${
        corner.top ? pad + 28 : height - pad - 8
      }" text-anchor="${corner.left ? 'start' : 'end'}" font-family="${font}" font-size="18" font-weight="700" fill="${colors.ink}" letter-spacing="1.4">${escapeXml(
        company.toUpperCase(),
      )}</text>`;
  if (corner.top) y += logoH + 22;

  const headBlock = insightTextBlock(headLines, pad, y, headPx, colors.ink, 750, Math.round(headPx * 1.18), font);
  y += headH + (subLines.length ? 10 : 20);
  const subBlock = subLines.length
    ? insightTextBlock(subLines, pad, y, subPx, colors.muted, 500, Math.round(subPx * 1.35), font)
    : '';
  y += subH + 22;

  const ctaTitleLines = wrapLines(calloutTitle, charsPerLine(width, bodyPx + 2, pad + 20), 1);
  const ctaBodyLines = calloutBody
    ? wrapLines(calloutBody, charsPerLine(width, bodyPx, pad + 20), 2)
    : [];
  const ctaH = 28 + ctaTitleLines.length * 24 + ctaBodyLines.length * 22 + 20;
  const summaryLines = summary
    ? wrapLines(summary, charsPerLine(width, bodyPx, pad), 3)
    : [];
  const summaryH = summaryLines.length ? summaryLines.length * Math.round(bodyPx * 1.4) + 8 : 0;

  const colGap = gap;
  const colW = Math.floor((width - pad * 2 - colGap * 2) / 3);
  const colCharsTitle = Math.max(10, Math.floor(colW / ((bodyPx + 1) * 0.58)));
  const colCharsBody = Math.max(12, Math.floor(colW / (bodyPx * 0.56)));
  const pointLayouts = points.map((p, i) => {
    const titleLines = wrapLines(p.title || `Point ${i + 1}`, colCharsTitle, 2);
    const bodyLines = wrapLines(p.text, colCharsBody, 4);
    const h = 22 + 28 + titleLines.length * 20 + 8 + bodyLines.length * 20 + 18;
    return { titleLines, bodyLines, h };
  });
  const pointsH = Math.max(...pointLayouts.map((p) => p.h), 120);

  const reservedBottom = pad + ctaH + (summaryH ? summaryH + 12 : 0) + 8;
  // Shrink the art slot so headline + cards + summary + CTA never collide.
  const availableForArt = height - y - pointsH - reservedBottom - gap * 2;
  const artH = Math.max(160, Math.min(Math.round(height * 0.26), availableForArt));

  const artY = y;
  const artX = pad;
  const artW = width - pad * 2;
  y += artH + 18;

  const pointSvgs = pointLayouts
    .map((p, i) => {
      const x = pad + i * (colW + colGap);
      const titleSvg = insightTextBlock(p.titleLines, x + 16, y + 46, bodyPx + 1, colors.ink, 700, 20, font);
      const bodySvg = insightTextBlock(
        p.bodyLines,
        x + 16,
        y + 50 + p.titleLines.length * 20 + 6,
        bodyPx,
        colors.muted,
        450,
        20,
        font,
      );
      return `
      <rect x="${x}" y="${y}" width="${colW}" height="${pointsH}" rx="14" fill="${colors.panel}"/>
      <circle cx="${x + 30}" cy="${y + 26}" r="14" fill="${colors.accent}"/>
      <text x="${x + 30}" y="${y + 31}" text-anchor="middle" font-family="${font}" font-size="13" font-weight="800" fill="${colors.onAccent}">${i + 1}</text>
      ${titleSvg}
      ${bodySvg}`;
    })
    .join('\n');
  y += pointsH + 16;

  // If summary would push the CTA off-canvas, drop summary rather than overlap.
  let summaryBlock = '';
  if (summaryLines.length && y + summaryH + ctaH + pad <= height) {
    summaryBlock = insightTextBlock(
      summaryLines,
      pad,
      y,
      bodyPx,
      colors.muted,
      500,
      Math.round(bodyPx * 1.4),
      font,
    );
    y += summaryH;
  }

  const ctaY = Math.max(y + 8, Math.min(y + 8, height - pad - ctaH));
  const ctaBlock = `
    <rect x="${pad}" y="${ctaY}" width="${width - pad * 2}" height="${ctaH}" rx="14" fill="${colors.accent}"/>
    ${insightTextBlock(ctaTitleLines, pad + 22, ctaY + 10, bodyPx + 3, colors.onAccent, 800, 24, font)}
    ${
      ctaBodyLines.length
        ? insightTextBlock(
            ctaBodyLines,
            pad + 22,
            ctaY + 14 + ctaTitleLines.length * 24,
            bodyPx,
            colors.onAccent,
            500,
            22,
            font,
          )
        : ''
    }`;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <clipPath id="artSlot"><rect x="${artX}" y="${artY}" width="${artW}" height="${artH}" rx="18"/></clipPath>
  </defs>
  <rect width="${width}" height="${height}" fill="${colors.ground}"/>
  ${logoBlock}
  ${headBlock}
  ${subBlock}
  <g clip-path="url(#artSlot)">
    <image href="${artHref}" x="${artX}" y="${artY}" width="${artW}" height="${artH}" preserveAspectRatio="xMidYMid slice"/>
  </g>
  ${pointSvgs}
  ${summaryBlock}
  ${ctaBlock}
</svg>`;

  const dir = path.resolve(config.UPLOAD_DIR, opts.tenantId, 'social-images');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `insight-report-${Date.now()}.svg`;
  fs.writeFileSync(path.join(dir, filename), svg, 'utf8');
  return { publicUrl: `/uploads/${opts.tenantId}/social-images/${filename}`, width, height };
}

export type MemePanelCaption = {
  label?: string;
  text: string;
};

/**
 * Classic meme typography over AI art: Impact-style bars + optional panel labels.
 * Layout recreates viral FORMAT structure; art must be original (no stolen templates).
 */
export async function memeSocialFrame(opts: {
  tenantId: string;
  imageUrl: string;
  companyName?: string | null;
  logoUrl?: string | null;
  /** Format layout hint */
  layout: 'split_v' | 'split_h' | 'impact' | 'stacked';
  panels: MemePanelCaption[];
  formatLabel?: string | null;
  width?: number;
  height?: number;
}): Promise<{ publicUrl: string; width: number; height: number }> {
  const width = opts.width || 1080;
  const height = opts.height || 1080;
  const artHref = escapeXml(await resolveImageHrefAsync(opts.imageUrl));
  let logoHref = '';
  if (opts.logoUrl) {
    try {
      const { prepareLogoForOverlay } = await import('./logo-prepare');
      const prepared = await prepareLogoForOverlay(opts.logoUrl, opts.tenantId);
      logoHref = escapeXml(prepared || (await resolveImageHrefAsync(opts.logoUrl)));
    } catch {
      try {
        logoHref = escapeXml(await resolveImageHrefAsync(opts.logoUrl));
      } catch {
        logoHref = '';
      }
    }
  }

  const font = OVERLAY_FONTS.display.css;
  const panels = (opts.panels || []).filter((p) => (p.text || '').trim()).slice(0, 4);
  const p0 = panels[0];
  const p1 = panels[1];

  const impactLine = (text: string, y: number, maxChars: number) =>
    wrapLines(text.toUpperCase(), maxChars, 2)
      .map((line, i) => {
        const yy = y + i * 52;
        const t = escapeXml(line);
        return `
  <text x="${width / 2}" y="${yy}" text-anchor="middle" font-family="${font}" font-size="44" font-weight="900" fill="#000000" stroke="#000000" stroke-width="10" paint-order="stroke">${t}</text>
  <text x="${width / 2}" y="${yy}" text-anchor="middle" font-family="${font}" font-size="44" font-weight="900" fill="#ffffff">${t}</text>`;
      })
      .join('\n');

  const badge = (label: string, x: number, y: number) => {
    const t = escapeXml(label.toUpperCase().slice(0, 28));
    return `
  <rect x="${x}" y="${y}" width="${Math.min(360, 18 + t.length * 14)}" height="36" rx="6" fill="#f5e642" stroke="#111" stroke-width="3"/>
  <text x="${x + 12}" y="${y + 25}" font-family="${font}" font-size="18" font-weight="800" fill="#111">${t}</text>`;
  };

  let captionsSvg = '';
  if (opts.layout === 'split_v' && p0 && p1) {
    captionsSvg = `
  ${p0.label ? badge(p0.label, 28, 28) : ''}
  ${p1.label ? badge(p1.label, width / 2 + 28, 28) : ''}
  <rect x="0" y="${height - 170}" width="${width}" height="170" fill="rgba(0,0,0,0.55)"/>
  ${impactLine(p0.text, height - 120, 22)}
  ${impactLine(p1.text, height - 55, 22)}`;
  } else if (opts.layout === 'split_h' && p0 && p1) {
    captionsSvg = `
  ${p0.label ? badge(p0.label, 28, 24) : ''}
  ${p1.label ? badge(p1.label, 28, height / 2 + 16) : ''}
  ${impactLine(p0.text, Math.floor(height / 2) - 36, 28)}
  ${impactLine(p1.text, height - 56, 28)}`;
  } else if (opts.layout === 'stacked' && panels.length >= 3) {
    const rowH = Math.floor(height / panels.length);
    captionsSvg = panels
      .map((p, i) => {
        const y = i * rowH + 36;
        return `${p.label ? badge(p.label, 24, y) : ''}${impactLine(p.text, y + rowH - 48, 30)}`;
      })
      .join('\n');
  } else {
    // Classic top / bottom Impact bars
    const top = p0?.text || '';
    const bottom = p1?.text || panels.map((p) => p.text).slice(1).join(' · ') || '';
    captionsSvg = `
  <rect x="0" y="0" width="${width}" height="120" fill="rgba(0,0,0,0.35)"/>
  <rect x="0" y="${height - 130}" width="${width}" height="130" fill="rgba(0,0,0,0.45)"/>
  ${top ? impactLine(top, 70, 28) : ''}
  ${bottom ? impactLine(bottom, height - 55, 28) : ''}`;
  }

  const company = (opts.companyName || '').trim();
  const formatChip = (opts.formatLabel || '').trim();

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image href="${artHref}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
  ${captionsSvg}
  ${
    logoHref
      ? `<image href="${logoHref}" x="${width - 168}" y="16" width="140" height="44" preserveAspectRatio="xMaxYMid meet" opacity="0.92"/>`
      : company
        ? `<text x="${width - 24}" y="40" text-anchor="end" font-family="${OVERLAY_FONTS.modern.css}" font-size="16" font-weight="700" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke">${escapeXml(company)}</text>`
        : ''
  }
  ${
    formatChip
      ? `<text x="24" y="${height - 14}" font-family="${OVERLAY_FONTS.modern.css}" font-size="12" fill="rgba(255,255,255,0.55)">${escapeXml(formatChip)}</text>`
      : ''
  }
</svg>`;

  const dir = path.resolve(config.UPLOAD_DIR, opts.tenantId, 'social-images');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `meme-${Date.now()}.svg`;
  fs.writeFileSync(path.join(dir, filename), svg, 'utf8');
  return { publicUrl: `/uploads/${opts.tenantId}/social-images/${filename}`, width, height };
}

/** Hard ban: AI must not paint words — we composite headline/CTA/logo in SVG. */
const NO_IN_IMAGE_TEXT = [
  'CRITICAL — PURE VISUAL ONLY: zero readable text in the artwork.',
  'No headlines, slogans, captions, CTAs, hashtags, watermarks, signs with words, posters with lettering, UI labels, or letterforms of any kind.',
  'Ignore any title/slogan/CTA wording in the scene description — depict the scene only; typography is added in a separate overlay step.',
].join(' ');

export function buildSocialImagePrompt(opts: {
  basePrompt: string;
  companyName?: string | null;
  imageStyle?: string | null;
  /** Preset style id — overrides generic look when set */
  visualStyleId?: string | null;
  format?: SocialImageFormat;
  exact?: boolean;
  logoPlacement?: LogoPlacement;
  /**
   * When true (default for framed posts), AI must not paint any words —
   * header/CTA/logo are composited after.
   */
  overlayHeaderFooter?: boolean;
  /** Always forbid in-image text when we brandSocialFrame (logo + overlays). */
  forbidInImageText?: boolean;
  /** Apply finished-poster + brand feed art-direction guardrails. */
  posterQuality?: boolean;
  /** Headline + caption brief — scene must match this content */
  contentBrief?: string | null;
}): string {
  const format = opts.format || 'instagram_square';
  const { width, height, label } = SOCIAL_IMAGE_FORMATS[format];
  const base = opts.basePrompt.trim();
  const placement: LogoPlacement = opts.logoPlacement || 'top-left';
  // Framed posts pass forbidInImageText; overlays also force a hard ban.
  const noText = opts.forbidInImageText === true || opts.overlayHeaderFooter === true;
  const brief = (opts.contentBrief || '').trim();

  const poster = opts.posterQuality === true;
  const contentLock = brief
    ? `CONTENT LOCK (mandatory): Illustrate THIS post topic only — “${brief.slice(0, 420)}”. Use a clear, specific visual metaphor for that story. Do NOT substitute a generic sci-fi robot face, cyborg, neon cyberpunk city, glowing brain-in-jar, or unrelated stock AI trope unless the brief explicitly asks for that.`
    : 'CONTENT LOCK (mandatory): Follow the scene brief exactly. Prefer a specific B2B metaphor for the stated topic — avoid generic sci-fi robot / cyborg / neon cyberpunk stock unless the brief asks for it.';

  // Exact mode: ONLY the user's prompt drives the image — no style preset, no post headline lock
  if (opts.exact) {
    return [
      base,
      `Output ${width}×${height} (${label}), full-bleed social creative.`,
      noText ? NO_IN_IMAGE_TEXT : '',
      'Do not invent logos, LOGO placeholders, dashed boxes, or UI chrome.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  const styleFromPreset = resolveVisualStylePrompt(opts.visualStyleId, opts.imageStyle);
  const calmCorner =
    placement === 'top-left'
      ? 'top-left'
      : placement === 'top-right'
        ? 'top-right'
        : placement === 'bottom-right'
          ? 'bottom-right'
          : 'bottom-left';

  const brand = opts.companyName?.trim();

  // Poster mode: FLUX truncates ~512 tokens — keep the scene brief first and short extras.
  if (poster) {
    const scene = base.length > 1400 ? `${base.slice(0, 1390).trim()}…` : base;
    return [
      scene,
      'Photoreal, plausible real-world scene only — no outdoor servers, holographic buildings, floating HUDs or digital-twin wireframes.',
      noText ? NO_IN_IMAGE_TEXT_SHORT : '',
      brief ? `Illustrate this topic and nothing else: “${brief.slice(0, 200)}”.` : '',
      styleFromPreset ? `Style: ${styleFromPreset}` : '',
      posterQualityGuardrails(noText),
      brand
        ? `Do not draw or invent a logo for ${brand}; leave the ${calmCorner} corner calm so a real logo badge can sit there.`
        : 'Do not invent logos; keep one corner calm for a brand mark.',
      opts.overlayHeaderFooter
        ? 'Keep the top and bottom bands calm and slightly darker for an overlaid headline and CTA.'
        : '',
      `Full-bleed ${label}.`,
    ]
      .filter(Boolean)
      .join(' ');
  }

  return [
    base,
    brief ? `Post topic: ${brief.slice(0, 360)}` : '',
    contentLock,
    `Finished agency-quality social creative for ${label} (${width}×${height}). Full-bleed LinkedIn / Instagram feed post — looks like a real B2B brand asset from GPT Image 2 / top creative agencies.`,
    styleFromPreset
      ? `REQUIRED VISUAL STYLE: ${styleFromPreset}`
      : 'Premium B2B marketing look: refined hierarchy, intentional whitespace, professional finish.',
    noText
      ? NO_IN_IMAGE_TEXT
      : 'If the prompt explicitly asks for on-image typography, keep lettering crisp and professional.',
    brand
      ? `Do not draw the company logo or invent a mark for ${brand}. Leave the ${calmCorner} corner clean and uncluttered (soft gradient or calm negative space) so a real logo badge can sit there.`
      : 'Do not invent logos or brand marks. Keep one corner calm for a brand mark overlay.',
    opts.overlayHeaderFooter
      ? 'Keep the top and bottom bands visually calm (soft gradient-friendly) for overlaid headline and CTA — no busy detail and no fake text there.'
      : 'Compose like a finished social tile: strong single focal subject, balanced margins, no busy edges.',
    'CRITICAL: do NOT draw placeholders, wireframes, mockup chrome, empty rectangles, dashed boxes, white logo tiles, or text that says LOGO, PLACEHOLDER, LOREM, or SAMPLE.',
    'No low-quality clipart, no stock watermark badges, no random floating UI.',
  ]
    .filter(Boolean)
    .join(' ');
}
export const PROFESSIONAL_POSTER_GUARDRAILS = [
  'Create a finished, print-ready marketing poster — not a template sketch.',
  'Premium composition: strong focal hierarchy, balanced margins, cohesive palette, high-end typography.',
  'Never render the words LOGO BAR, LOGO, PLACEHOLDER, or empty framed boxes.',
  'Never draw fake logos, white logo tiles, footer bars, or browser/UI chrome.',
  'Event posters should feel like a real invitation or launch campaign (venue energy optional; date/time only if provided).',
].join(' ');

/** Same standard as above, for pipelines where typography is composited afterwards. */
const POSTER_GUARDRAILS_TEXT_FREE =
  'Finished campaign-grade brand visual, not a template sketch. Never draw fake logos, logo tiles, footer bars, UI chrome or empty framed boxes.';

/**
 * Art-direction rules distilled from how established B2B/B2C brands build feed
 * creative: a tight palette, one focal idea, real negative space, thumbnail legibility.
 * Kept terse — FLUX truncates prompts at roughly 512 tokens.
 */
export const BRAND_FEED_CREATIVE_GUARDRAILS = [
  'Art-direct it like a brand studio shipping a paid social asset.',
  'At most 3–4 colours: one dominant, one neutral ground, one restrained accent.',
  'Exactly one focal subject; believable real-world physics and scale.',
  'Calm negative space in the top-left and bottom bands for logo/headline/CTA overlays.',
  'Intentional key light, clean shadows, premium finish — no muddy grey wash.',
  'BANNED clichés: handshakes, laptop huddles, glowing brains, robot mascots, hexagon HUDs, circuit wallpaper, outdoor/rooftop server racks, holographic wireframe buildings, floating digital-twin overlays, neon cyberpunk roofs.',
].join(' ');

/** Condensed text ban for poster mode, where prompt budget is tight. */
const NO_IN_IMAGE_TEXT_SHORT =
  'CRITICAL — zero readable text in the artwork: no headlines, captions, CTAs, hashtags, watermarks, signage or letterforms of any kind. Ignore any wording in the brief; typography is overlaid in a later step.';

/** Guardrail block for finished-quality creative; text-free when typography is overlaid later. */
export function posterQualityGuardrails(noInImageText: boolean): string {
  return [
    noInImageText ? POSTER_GUARDRAILS_TEXT_FREE : PROFESSIONAL_POSTER_GUARDRAILS,
    BRAND_FEED_CREATIVE_GUARDRAILS,
  ].join(' ');
}
