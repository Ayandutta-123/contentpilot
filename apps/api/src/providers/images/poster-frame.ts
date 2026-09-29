import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import {
  charsPerLine,
  escapeXml,
  logoCornerBox,
  luminance,
  mixHex,
  OVERLAY_FONTS,
  parseBrandPalette,
  resolveImageHrefAsync,
  wrapLines,
  type InsightPalette,
  type LogoPlacement,
} from './social-frame';

/**
 * Designed B2B poster: brand ground, hero art bleeding in from one side, a
 * headline with one accent-coloured phrase, icon pillars, a stat badge and a
 * callout. This is the layout real brand studios ship — not a photo with a
 * caption dropped on top.
 */

export type PosterIconId =
  | 'chip'
  | 'handshake'
  | 'globe'
  | 'rocket'
  | 'shield'
  | 'chart'
  | 'target'
  | 'bolt'
  | 'clock'
  | 'check'
  | 'trophy'
  | 'search'
  | 'spark'
  | 'users'
  | 'lock'
  | 'layers'
  | 'building'
  | 'cloud';

/** 24×24 stroke icons — drawn in the accent colour, no fills, no fake logos. */
const ICON_PATHS: Record<PosterIconId, string> = {
  chip: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><rect x="10.5" y="10.5" width="3" height="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 3.8 7 7M18 3.8 17 7"/>',
  handshake: '<path d="M2 12l4-4 4 3 4-3 4 4-4 5-4-3-4 3z"/><path d="M6 8 4 6M18 8l2-2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"/>',
  rocket: '<path d="M12 2c3.5 2.5 5.5 6.5 5.5 11L12 19l-5.5-6C6.5 8.5 8.5 4.5 12 2z"/><circle cx="12" cy="10" r="2"/><path d="M8 18l-2 4 4-2M16 18l2 4-4-2"/>',
  shield: '<path d="M12 2.5 20 6v6c0 5-3.5 8-8 9.5C8 20 4.5 17 4.5 12V6z"/><path d="M9 12l2.5 2.5L16 10"/>',
  chart: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7.5" y="12" width="3" height="5"/><rect x="12.5" y="8.5" width="3" height="8.5"/><rect x="17" y="5.5" width="3" height="11.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  bolt: '<path d="M13.5 2 5 13h6l-1.5 9L19 11h-6z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l4 2.5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 5.5H5.5A3.5 3.5 0 0 0 9 9M16 5.5h2.5A3.5 3.5 0 0 1 15 9"/><path d="M12 13v4M8.5 20h7M10 17h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8 21 21"/>',
  spark: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.3 6.3l3.2 3.2M14.5 14.5l3.2 3.2M17.7 6.3l-3.2 3.2M9.5 14.5l-3.2 3.2"/>',
  users: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 7.2a3 3 0 0 1 0 5.6M17.5 19c0-2.2-.8-3.9-2-5"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/><path d="M12 14v2.5"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
  building: '<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h6"/>',
  cloud: '<path d="M7 18h10a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.6-1.2A3.9 3.9 0 0 0 7 18z"/>',
};

function iconSvg(icon: PosterIconId | string, x: number, y: number, size: number, stroke: string): string {
  const key = (icon in ICON_PATHS ? icon : 'spark') as PosterIconId;
  const scale = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${scale.toFixed(4)})" fill="none" stroke="${stroke}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[key]}</g>`;
}

export type PosterPillar = {
  icon?: PosterIconId | string;
  title: string;
  text: string;
};

export type PosterSpec = {
  /** Small caps line above the headline (e.g. "AI infrastructure"). */
  eyebrow?: string;
  headline: string;
  /** Exact substring of headline to paint in the accent colour. */
  headlineAccent?: string;
  subhead?: string;
  pillars?: PosterPillar[];
  /** Big number / metric, e.g. "#2" or "62%". */
  statValue?: string;
  statLabel?: string;
  calloutTitle?: string;
  calloutBody?: string;
  /** Punchy closing line, accent coloured. */
  closingLine?: string;
  footerNote?: string;
  /** Art direction for the hero image (no text, no logos). */
  artPrompt?: string;
  /** Things the image model must not draw. */
  artNegativePrompt?: string;
};

export type PosterLayoutId =
  | 'hero_right'
  | 'hero_top'
  | 'editorial_left'
  | 'center_stage'
  | 'split_band'
  | 'sale_circles'
  | 'sale_split'
  /** Locked plate from an uploaded finished poster (Brand Kit fills slots only). */
  | 'uploaded_master';

type PosterLayoutGeom = {
  /** Where the hero artwork sits on the canvas. */
  art: (w: number, h: number) => { x: number; y: number; w: number; h: number };
  /** How the artwork fades into the brand ground. */
  mask: 'x' | 'xr' | 'y' | 'none';
  /** Left edge of the type column. */
  textLeft: (w: number, pad: number) => number;
  /** Width of the type column. */
  textColW: (w: number, pad: number) => number;
  align: 'left' | 'center';
  /** Ground scrim style: vertical fade, flat veil over the whole art, or none. */
  scrim: 'vertical' | 'veil' | 'none';
  /** Fraction of the ART height where the vertical scrim begins. */
  scrimAt: number;
  /** Vertically centre the headline stack (only when there are no pillars). */
  centerStack: boolean;
  /** Solid accent keyline along the art/type seam. */
  seamBand: boolean;
  /** Bottom blocks (pillars, stat, callout, footer) may span the full canvas. */
  bottomFullWidth: boolean;
  /** Where the type stack starts. Layouts with opaque art must clear it. */
  textTop: (pad: number, artH: number) => number;
  /** Narrow type columns stack pillars as rows instead of side-by-side. */
  pillarMode: 'columns' | 'rows';
  /** Darken the top strip so the logo and eyebrow stay legible over bright art. */
  topVeil: boolean;
};

export const POSTER_LAYOUTS: Record<PosterLayoutId, PosterLayoutGeom> = {
  // Hero art bleeding in from the right, type in a left column — premium editorial.
  hero_right: {
    art: (w, h) => ({
      x: Math.round(w * 0.42),
      y: 0,
      w: w - Math.round(w * 0.42),
      h: Math.round(h * 0.72),
    }),
    mask: 'x',
    textLeft: (_w, pad) => Math.round(pad * 1.15),
    textColW: (w, pad) => Math.round(w * 0.5) - Math.round(pad * 1.15),
    align: 'left',
    scrim: 'vertical',
    scrimAt: 0.38,
    centerStack: false,
    seamBand: false,
    bottomFullWidth: true,
    textTop: (pad) => Math.round(pad * 1.05),
    pillarMode: 'columns',
    topVeil: false,
  },
  // Full-width art band across the top, type stacked underneath.
  hero_top: {
    art: (w, h) => ({ x: 0, y: 0, w, h: Math.round(h * 0.4) }),
    mask: 'y',
    textLeft: (_w, pad) => Math.round(pad * 1.1),
    textColW: (w, pad) => w - Math.round(pad * 2.2),
    align: 'left',
    scrim: 'vertical',
    scrimAt: 0.28,
    centerStack: false,
    seamBand: false,
    bottomFullWidth: true,
    textTop: (pad) => Math.round(pad * 0.85),
    pillarMode: 'columns',
    topVeil: true,
  },
  // Magazine split: full-height art on the left, type column on the right.
  editorial_left: {
    art: (w, h) => ({ x: 0, y: 0, w: Math.round(w * 0.5), h }),
    mask: 'xr',
    textLeft: (w, pad) => Math.round(w * 0.52) + Math.round(pad * 0.35),
    textColW: (w, pad) => w - Math.round(w * 0.52) - Math.round(pad * 1.5),
    align: 'left',
    scrim: 'none',
    scrimAt: 0,
    centerStack: true,
    seamBand: false,
    bottomFullWidth: false,
    textTop: (pad) => Math.round(pad * 1.15),
    pillarMode: 'rows',
    topVeil: false,
  },
  // Full-bleed art behind a dark veil, type centred — campaign / countdown feel.
  center_stage: {
    art: (w, h) => ({ x: 0, y: 0, w, h }),
    mask: 'none',
    textLeft: (_w, pad) => Math.round(pad * 1.6),
    textColW: (w, pad) => w - Math.round(pad * 3.2),
    align: 'center',
    scrim: 'veil',
    scrimAt: 0,
    centerStack: true,
    seamBand: false,
    bottomFullWidth: false,
    textTop: (pad) => Math.round(pad * 1.2),
    pillarMode: 'columns',
    topVeil: true,
  },
  // Hard horizontal split with an accent keyline — offer / announcement poster.
  split_band: {
    art: (w, h) => ({ x: 0, y: 0, w, h: Math.round(h * 0.46) }),
    mask: 'none',
    textLeft: (_w, pad) => Math.round(pad * 1.1),
    textColW: (w, pad) => w - Math.round(pad * 2.2),
    align: 'left',
    scrim: 'none',
    scrimAt: 0,
    centerStack: false,
    seamBand: true,
    bottomFullWidth: true,
    textTop: (pad, artH) => artH + Math.round(pad * 0.95),
    pillarMode: 'columns',
    topVeil: false,
  },
  // Retail offer: white card, circular photo cutouts, giant SALE lockup.
  sale_circles: {
    art: (w, h) => ({ x: Math.round(w * 0.48), y: Math.round(h * 0.28), w: Math.round(w * 0.5), h: Math.round(h * 0.62) }),
    mask: 'none',
    textLeft: (_w, pad) => pad,
    textColW: (w, pad) => Math.round(w * 0.46) - pad,
    align: 'left',
    scrim: 'none',
    scrimAt: 0,
    centerStack: false,
    seamBand: false,
    bottomFullWidth: false,
    textTop: (pad) => pad,
    pillarMode: 'columns',
    topVeil: false,
  },
  // Retail offer: type column left, full-bleed photo right, accent frame.
  sale_split: {
    art: (w, h) => ({ x: Math.round(w * 0.5), y: 0, w: Math.round(w * 0.5), h }),
    mask: 'none',
    textLeft: (_w, pad) => pad,
    textColW: (w, pad) => Math.round(w * 0.46) - pad,
    align: 'left',
    scrim: 'none',
    scrimAt: 0,
    centerStack: false,
    seamBand: true,
    bottomFullWidth: false,
    textTop: (pad) => pad,
    pillarMode: 'columns',
    topVeil: false,
  },
  // Uploaded finished plate — geom unused (early-return to fill engines).
  uploaded_master: {
    art: (w, h) => ({ x: Math.round(w * 0.45), y: 0, w: Math.round(w * 0.55), h }),
    mask: 'x',
    textLeft: (_w, pad) => pad,
    textColW: (w, pad) => Math.round(w * 0.5) - pad,
    align: 'left',
    scrim: 'none',
    scrimAt: 1,
    centerStack: false,
    seamBand: false,
    bottomFullWidth: false,
    textTop: (pad) => pad,
    pillarMode: 'columns',
    topVeil: false,
  },
};

export const POSTER_LAYOUT_IDS = Object.keys(POSTER_LAYOUTS) as PosterLayoutId[];

function sanitizeLine(s: string | undefined | null, max: number): string {
  return (s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function textLines(
  lines: string[],
  x: number,
  topY: number,
  fontPx: number,
  fill: string,
  weight: number,
  lineH: number,
  font: string,
  extra = '',
  anchor: 'left' | 'center' = 'left',
): string {
  const anchorAttr = anchor === 'center' ? ' text-anchor="middle"' : '';
  return lines
    .map(
      (line, i) =>
        `<text x="${x}" y="${Math.round(topY + fontPx + i * lineH)}"${anchorAttr} font-family="${font}" font-size="${fontPx}" font-weight="${weight}" fill="${fill}" ${extra}>${escapeXml(
          line,
        )}</text>`,
    )
    .join('\n');
}

/** Headline with one phrase painted in the accent colour, flowed as inline tspans. */
function headlineSvg(
  lines: string[],
  accentPhrase: string,
  x: number,
  topY: number,
  fontPx: number,
  ink: string,
  accent: string,
  lineH: number,
  font: string,
  anchor: 'left' | 'center' = 'left',
): string {
  const phrase = accentPhrase.trim();
  const anchorAttr = anchor === 'center' ? ' text-anchor="middle"' : '';
  return lines
    .map((line, i) => {
      const y = Math.round(topY + fontPx + i * lineH);
      // xml:space keeps the spaces around the accent tspan ("ranked #2 in").
      const open = `<text x="${x}" y="${y}"${anchorAttr} xml:space="preserve" font-family="${font}" font-size="${fontPx}" font-weight="800" fill="${ink}" letter-spacing="-0.5">`;
      if (!phrase) return `${open}${escapeXml(line)}</text>`;

      const at = line.toLowerCase().indexOf(phrase.toLowerCase());
      if (at < 0) return `${open}${escapeXml(line)}</text>`;

      const before = line.slice(0, at);
      const hit = line.slice(at, at + phrase.length);
      const after = line.slice(at + phrase.length);
      return [
        open,
        before ? `<tspan>${escapeXml(before)}</tspan>` : '',
        `<tspan fill="${accent}">${escapeXml(hit)}</tspan>`,
        after ? `<tspan>${escapeXml(after)}</tspan>` : '',
        '</text>',
      ].join('');
    })
    .join('\n');
}

export async function brandPosterFrame(opts: {
  tenantId: string;
  /** Hero artwork (already generated, text-free). */
  imageUrl: string;
  spec: PosterSpec;
  companyName?: string | null;
  logoUrl?: string | null;
  brandImageStyle?: string | null;
  width?: number;
  height?: number;
  layout?: PosterLayoutId;
  /** When layout is uploaded_master, which engine fills the plate. */
  fillLayout?: PosterLayoutId;
  /** Exact uploaded finished poster used as the locked plate. */
  sourceImageUrl?: string | null;
  palette?: Partial<InsightPalette>;
  /** Heading / body font CSS stacks (from Brand Kit). */
  headingFontCss?: string | null;
  bodyFontCss?: string | null;
  /** Slide 2/4 marker for carousels. */
  slideLabel?: string | null;
  /** Last-slide CTA contact chips (only filled brand kit links). */
  contactChips?: Array<{ label: string; value: string }> | null;
  /** Corner for the brand mark — defaults to top-left (editorial stack). */
  logoPlacement?: LogoPlacement;
}): Promise<{ publicUrl: string; width: number; height: number }> {
  const width = opts.width || 1080;
  const height = opts.height || 1080;
  const short = Math.min(width, height);
  const pad = Math.round(short * 0.072);
  const headingFont = opts.headingFontCss || OVERLAY_FONTS.modern.css;
  const bodyFont = opts.bodyFontCss || OVERLAY_FONTS.sans.css;
  const colors = { ...parseBrandPalette(opts.brandImageStyle), ...opts.palette };
  const ground = colors.ground;
  const ink = colors.ink;
  const accent = colors.accent;
  const muted = colors.muted;
  const panel = mixHex(ground, ink, 0.09);
  const panelLine = mixHex(ground, ink, 0.2);
  const subTint = mixHex(accent, ink, 0.45);
  const onAccent = luminance(accent) < 0.45 ? '#FFFFFF' : '#12100B';

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

  const spec = opts.spec;
  const fillLayout =
    opts.layout === 'uploaded_master'
      ? opts.fillLayout || 'uploaded_master'
      : opts.layout;

  if (fillLayout === 'sale_circles' || fillLayout === 'sale_split') {
    const { writeRetailOfferPoster } = await import('./poster-offer-retail');
    return writeRetailOfferPoster({
      tenantId: opts.tenantId,
      width,
      height,
      layout: fillLayout,
      artHref,
      logoHref,
      companyName: opts.companyName,
      headingFont,
      bodyFont,
      spec,
      palette: colors,
    });
  }

  if (opts.layout === 'uploaded_master' || fillLayout === 'uploaded_master') {
    if (!opts.sourceImageUrl) {
      throw new Error('Uploaded master template is missing its source image.');
    }
    const { writeUploadedMasterPoster } = await import('./poster-uploaded-master');
    return writeUploadedMasterPoster({
      tenantId: opts.tenantId,
      width,
      height,
      sourceImageUrl: opts.sourceImageUrl,
      artHref,
      logoHref,
      companyName: opts.companyName,
      headingFont,
      bodyFont,
      spec,
      palette: colors,
    });
  }

  if (opts.layout === 'sale_circles' || opts.layout === 'sale_split') {
    const { writeRetailOfferPoster } = await import('./poster-offer-retail');
    return writeRetailOfferPoster({
      tenantId: opts.tenantId,
      width,
      height,
      layout: opts.layout,
      artHref,
      logoHref,
      companyName: opts.companyName,
      headingFont,
      bodyFont,
      spec,
      palette: colors,
    });
  }
  const eyebrow = sanitizeLine(spec.eyebrow, 48);
  const headline = sanitizeLine(spec.headline, 150) || 'Brand update';
  const headlineAccent = sanitizeLine(spec.headlineAccent, 40);
  const subhead = sanitizeLine(spec.subhead, 180);
  const statValue = sanitizeLine(spec.statValue, 8);
  const statLabel = sanitizeLine(spec.statLabel, 60);
  const calloutTitle = sanitizeLine(spec.calloutTitle, 60);
  const calloutBody = sanitizeLine(spec.calloutBody, 220);
  const closingLine = sanitizeLine(spec.closingLine, 120);
  const footerNote = sanitizeLine(spec.footerNote, 200);
  const pillars = (spec.pillars || [])
    .map((p) => ({
      icon: p.icon || 'spark',
      title: sanitizeLine(p.title, 24),
      text: sanitizeLine(p.text, 72),
    }))
    .filter((p) => p.title || p.text)
    .slice(0, 2); // never more than 2 on auto plates — keeps studio-grade whitespace

  const layout: PosterLayoutId = opts.layout && POSTER_LAYOUTS[opts.layout] ? opts.layout : 'hero_right';
  const geom = POSTER_LAYOUTS[layout];
  const hasStat = Boolean(statValue);
  const hasCallout = Boolean(calloutTitle || calloutBody);
  // A square canvas can't carry headline + pillars + stat + callout + a closing
  // paragraph. Prefer air over clutter.
  const crowded = pillars.length > 0 && (hasStat || hasCallout);

  // ---- art placement (bleeds off canvas, fades into the brand ground) -------
  const art = geom.art(width, height);

  // ---- type column ---------------------------------------------------------
  const blockX = geom.textLeft(width, pad);
  const textColW = geom.textColW(width, pad);
  const centered = geom.align === 'center';
  const anchor: 'left' | 'center' = centered ? 'center' : 'left';
  const tx = centered ? blockX + Math.round(textColW / 2) : blockX;
  const narrowCol = textColW < width * 0.5;
  // Larger display type, fewer lines — reads more like a studio poster
  const baseHeadPx = short * (crowded ? 0.058 : pillars.length ? 0.068 : 0.078) * (narrowCol ? 0.82 : 1);
  const eyebrowPx = Math.round(short * 0.017);
  const bodyPx = Math.round(short * 0.0155);

  // ---- vertical flow: logo → eyebrow → headline → subhead → rule -----------
  const logoH = Math.round(short * 0.062);
  const logoW = Math.round(width * 0.2);
  const stackTop0 = geom.textTop(pad, art.y + art.h);
  const placement: LogoPlacement = opts.logoPlacement || 'top-left';
  const corner = logoCornerBox(placement, width, height, logoW, logoH, pad);
  // Default top-left keeps the editorial in-stack mark; other corners use a watermark.
  const useStackLogo = placement === 'top-left';
  const logoX = useStackLogo
    ? centered
      ? Math.round(tx - logoW / 2)
      : blockX
    : corner.x;
  const logoY = useStackLogo ? stackTop0 : corner.y;
  const logoAspect = useStackLogo
    ? centered
      ? 'xMidYMid'
      : 'xMinYMid'
    : corner.left
      ? 'xMinYMid'
      : 'xMaxYMid';
  let brandBlock = '';
  if (logoHref) {
    brandBlock = `<image href="${logoHref}" xlink:href="${logoHref}" x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" preserveAspectRatio="${logoAspect} meet"/>`;
  } else {
    const nameX = useStackLogo ? tx : corner.left ? pad : width - pad;
    const nameY = useStackLogo
      ? stackTop0 + Math.round(logoH * 0.68)
      : corner.top
        ? pad + Math.round(logoH * 0.68)
        : height - pad - 8;
    const nameAnchor = useStackLogo
      ? centered
        ? 'middle'
        : 'start'
      : corner.left
        ? 'start'
        : 'end';
    brandBlock = `<text x="${nameX}" y="${nameY}" text-anchor="${nameAnchor}" font-family="${headingFont}" font-size="${Math.round(
      short * 0.022,
    )}" font-weight="800" fill="${ink}" letter-spacing="2">${escapeXml(
      (opts.companyName || 'Brand').toUpperCase(),
    )}</text>`;
  }

  // Everything from the eyebrow to the rule is one stack, built at a type scale
  // so it can be re-fitted once we know how much room the bottom blocks left.
  // Bottom / opposite-corner logos sit as watermarks and do not push the type stack.
  const stackTop = useStackLogo
    ? stackTop0 + logoH + Math.round(short * 0.03)
    : stackTop0;

  type Stack = {
    eyebrowBlock: string;
    headBlock: string;
    subBlock: string;
    ruleBlock: string;
    endY: number;
  };

  const buildStack = (scale: number): Stack => {
    const headPx = Math.max(18, Math.round(baseHeadPx * scale));
    const subPx = Math.max(12, Math.round(short * 0.025 * Math.min(1, scale + 0.12)));
    const headLineH = Math.round(headPx * 1.1);
    const headChars = Math.max(10, Math.floor(textColW / (headPx * 0.52)));
    const headLines = wrapLines(headline, headChars, narrowCol ? 5 : 4);
    const subChars = Math.max(14, Math.floor(textColW / (subPx * 0.54)));
    const subLines = subhead ? wrapLines(subhead, subChars, crowded || scale < 0.9 ? 2 : 3) : [];

    let sy = stackTop;
    const eyebrowBlock = eyebrow
      ? `<text x="${tx}" y="${sy + eyebrowPx}"${
          centered ? ' text-anchor="middle"' : ''
        } font-family="${headingFont}" font-size="${eyebrowPx}" font-weight="700" fill="${accent}" letter-spacing="2.4">${escapeXml(
          eyebrow.toUpperCase(),
        )}</text>`
      : '';
    if (eyebrow) sy += eyebrowPx + Math.round(short * 0.018);

    const headBlock = headlineSvg(
      headLines,
      headlineAccent,
      tx,
      sy,
      headPx,
      ink,
      accent,
      headLineH,
      headingFont,
      anchor,
    );
    sy += headLines.length * headLineH + Math.round(short * 0.016);

    const subBlock = subLines.length
      ? textLines(subLines, tx, sy, subPx, subTint, 700, Math.round(subPx * 1.34), bodyFont, '', anchor)
      : '';
    if (subLines.length) sy += subLines.length * Math.round(subPx * 1.34) + Math.round(short * 0.022);

    const ruleW = Math.round(short * 0.1);
    const ruleBlock = `<rect x="${centered ? Math.round(tx - ruleW / 2) : blockX}" y="${sy}" width="${ruleW}" height="3" rx="1.5" fill="${accent}"/>`;
    sy += Math.round(short * 0.034);

    return { eyebrowBlock, headBlock, subBlock, ruleBlock, endY: sy };
  };

  let stackFit = buildStack(1);
  let y = stackFit.endY;

  // ---- bottom-up blocks: footer, closing, callout/stat, pillars ------------
  let bottom = height - pad;

  // Contact strip (carousel closing CTA) — only when chips are provided.
  const contactChips = (opts.contactChips || [])
    .map((c) => ({
      label: sanitizeLine(c.label, 12),
      value: sanitizeLine(c.value, 42),
    }))
    .filter((c) => c.value)
    .slice(0, 5);
  let contactBlock = '';
  if (contactChips.length) {
    const chipPx = Math.round(short * 0.015);
    const chipH = Math.round(short * 0.038);
    const gap = Math.round(short * 0.012);
    const chipTexts = contactChips.map((c) => `${c.label} ${c.value}`);
    // Estimate widths; wrap into up to 2 rows.
    const approxChar = chipPx * 0.55;
    const rows: string[][] = [[]];
    let rowWUsed = 0;
    const maxRowW = width - pad * 2;
    for (const t of chipTexts) {
      const w = Math.round(t.length * approxChar + short * 0.04);
      if (rowWUsed + w > maxRowW && rows[rows.length - 1].length) {
        if (rows.length >= 2) break;
        rows.push([]);
        rowWUsed = 0;
      }
      rows[rows.length - 1].push(t);
      rowWUsed += w + gap;
    }
    const blockH = rows.length * chipH + (rows.length - 1) * gap;
    bottom -= blockH;
    const startY = bottom;
    contactBlock = rows
      .map((row, ri) => {
        const y = startY + ri * (chipH + gap);
        let x = pad;
        return row
          .map((t) => {
            const w = Math.min(maxRowW, Math.round(t.length * approxChar + short * 0.036));
            const svg = `<g>
              <rect x="${x}" y="${y}" width="${w}" height="${chipH}" rx="${Math.round(chipH / 2)}" fill="${panel}" stroke="${panelLine}"/>
              <text x="${x + Math.round(w / 2)}" y="${y + Math.round(chipH * 0.68)}" text-anchor="middle" font-family="${bodyFont}" font-size="${chipPx}" font-weight="700" fill="${ink}">${escapeXml(t)}</text>
            </g>`;
            x += w + gap;
            return svg;
          })
          .join('\n');
      })
      .join('\n');
    bottom -= Math.round(short * 0.02);
  }

  // Pillars, stat/callout and footer sit below the art on hero/split layouts, so
  // they may run the full canvas width; on side-by-side layouts they must stay
  // inside the type column.
  const rowX = geom.bottomFullWidth ? pad : blockX;
  const rowW = geom.bottomFullWidth ? width - pad * 2 : textColW;
  const rtx = centered ? rowX + Math.round(rowW / 2) : rowX;
  const colChars = (fontPx: number) => Math.max(12, Math.floor(rowW / (fontPx * 0.52)));

  const footerLines =
    footerNote && !crowded && !contactChips.length ? wrapLines(footerNote, colChars(bodyPx), 2) : [];
  let footerBlock = '';
  if (footerLines.length) {
    const h = footerLines.length * Math.round(bodyPx * 1.42);
    bottom -= h;
    footerBlock = textLines(
      footerLines,
      rtx,
      bottom,
      bodyPx,
      muted,
      500,
      Math.round(bodyPx * 1.42),
      bodyFont,
      '',
      anchor,
    );
    bottom -= Math.round(short * 0.018);
  }

  let closingBlock = '';
  if (closingLine) {
    const closePx = Math.round(short * 0.023);
    const closeLines = wrapLines(closingLine, colChars(closePx), 2);
    const h = closeLines.length * Math.round(closePx * 1.3);
    bottom -= h;
    closingBlock = textLines(
      closeLines,
      rtx,
      bottom,
      closePx,
      accent,
      800,
      Math.round(closePx * 1.3),
      headingFont,
      '',
      anchor,
    );
    bottom -= Math.round(short * 0.024);
  }

  // Stat badge + callout share one row when both exist.
  let statBlock = '';
  let calloutBlock = '';
  if (hasStat || hasCallout) {
    const statW = hasStat ? Math.round(rowW * (hasCallout ? 0.3 : 0.46)) : 0;
    const gap = hasStat && hasCallout ? Math.round(short * 0.02) : 0;
    const calloutW = hasCallout ? rowW - statW - gap : 0;
    // A lone stat badge would hang off to one side on a centred layout.
    const rowStartX = centered
      ? rowX + Math.round((rowW - (statW + gap + calloutW)) / 2)
      : rowX;

    const calloutTitleLines = calloutTitle
      ? wrapLines(calloutTitle, Math.max(12, Math.floor((calloutW - 36) / ((bodyPx + 3) * 0.55))), 1)
      : [];
    const calloutBodyLines = calloutBody
      ? wrapLines(calloutBody, Math.max(14, Math.floor((calloutW - 36) / (bodyPx * 0.55))), 2)
      : [];
    const calloutH =
      Math.round(short * 0.03) +
      calloutTitleLines.length * Math.round((bodyPx + 3) * 1.35) +
      calloutBodyLines.length * Math.round(bodyPx * 1.4) +
      Math.round(short * 0.026);
    const statH = Math.round(short * 0.13);
    const rowH = Math.max(calloutH, hasStat ? statH : 0);

    bottom -= rowH;
    const rowY = bottom;

    if (hasStat) {
      const statPx = Math.round(short * 0.072);
      const labelLines = statLabel
        ? wrapLines(statLabel, Math.max(10, Math.floor((statW - 28) / (bodyPx * 0.55))), 2)
        : [];
      statBlock = `
      <rect x="${rowStartX}" y="${rowY}" width="${statW}" height="${rowH}" rx="${Math.round(short * 0.018)}" fill="${accent}"/>
      <text x="${rowStartX + 20}" y="${rowY + Math.round(rowH * 0.46)}" font-family="${headingFont}" font-size="${statPx}" font-weight="800" fill="${onAccent}" letter-spacing="-1">${escapeXml(
        statValue,
      )}</text>
      ${textLines(
        labelLines,
        rowStartX + 20,
        rowY + Math.round(rowH * 0.52),
        bodyPx,
        onAccent,
        600,
        Math.round(bodyPx * 1.35),
        bodyFont,
      )}`;
    }

    if (hasCallout) {
      const cx = rowStartX + statW + gap;
      const iconSize = Math.round(short * 0.03);
      calloutBlock = `
      <rect x="${cx}" y="${rowY}" width="${calloutW}" height="${rowH}" rx="${Math.round(short * 0.018)}" fill="${panel}" stroke="${panelLine}"/>
      ${iconSvg('trophy', cx + 18, rowY + 16, iconSize, accent)}
      ${textLines(
        calloutTitleLines,
        cx + 18 + iconSize + 12,
        rowY + 14,
        bodyPx + 3,
        ink,
        800,
        Math.round((bodyPx + 3) * 1.35),
        headingFont,
      )}
      ${textLines(
        calloutBodyLines,
        cx + 18,
        rowY + 18 + Math.max(iconSize, calloutTitleLines.length * Math.round((bodyPx + 3) * 1.35)) + 8,
        bodyPx,
        muted,
        500,
        Math.round(bodyPx * 1.4),
        bodyFont,
      )}`;
    }
    bottom -= Math.round(short * 0.024);
  }

  // ---- re-fit the headline stack into whatever the bottom blocks left ------
  // Layouts that start the type below an opaque art band (split_band) only have
  // half a canvas, so a full-size headline would run straight through the stat
  // badge. Shrink the type until it clears, rather than overlapping.
  const roomForStack = bottom - Math.round(short * (pillars.length ? 0.12 : 0.02));
  if (y > roomForStack) {
    for (const scale of [0.88, 0.78, 0.68, 0.6, 0.52, 0.45]) {
      stackFit = buildStack(scale);
      y = stackFit.endY;
      if (y <= roomForStack) break;
    }
  }
  const stackHeight = y - stackTop;

  // ---- pillars fill the space between the headline block and bottom row ----
  let pillarBlock = '';
  const stackedPillars = geom.pillarMode === 'rows';
  if (pillars.length && stackedPillars) {
    // Narrow type column: side-by-side pillars would be two words wide, so run
    // them as rows with the icon beside the title.
    const iconSize = Math.round(short * 0.028);
    const rowGap = Math.round(short * 0.022);
    const textX = rowX + iconSize + 14;
    const titleChars = Math.max(8, Math.floor((rowW - iconSize - 14) / ((bodyPx + 2) * 0.55)));
    const bodyChars = Math.max(12, Math.floor((rowW - iconSize - 14) / (bodyPx * 0.54)));
    const titleLineH = Math.round((bodyPx + 2) * 1.3);
    const bodyLineH = Math.round(bodyPx * 1.42);
    const available = bottom - y;

    const measure = (maxBodyLines: number) => {
      const laid = pillars.map((p) => ({
        icon: p.icon,
        titleLines: wrapLines(p.title, titleChars, 1),
        bodyLines: maxBodyLines > 0 ? wrapLines(p.text, bodyChars, maxBodyLines) : [],
      }));
      const total =
        laid.reduce(
          (sum, p) => sum + p.titleLines.length * titleLineH + 6 + p.bodyLines.length * bodyLineH,
          0,
        ) +
        rowGap * (laid.length - 1);
      return { laid, total };
    };

    let fitted = measure(3);
    for (let maxLines = 2; maxLines >= 0 && fitted.total > available; maxLines--) {
      fitted = measure(maxLines);
    }
    const { laid, total } = fitted;
    let cy = total <= available ? Math.round(y + (available - total) / 2) : y;

    pillarBlock = laid
      .map((p) => {
        const top = cy;
        const ico = iconSvg(p.icon, rowX, top, iconSize, accent);
        const title = textLines(p.titleLines, textX, top, bodyPx + 2, ink, 800, titleLineH, headingFont);
        let ty = top + p.titleLines.length * titleLineH + 6;
        const body = textLines(p.bodyLines, textX, ty, bodyPx, muted, 500, bodyLineH, bodyFont);
        ty += p.bodyLines.length * bodyLineH;
        cy = ty + rowGap;
        return `${ico}\n${title}\n${body}`;
      })
      .join('\n');
  } else if (pillars.length) {
    const gap = Math.round(short * 0.022);
    const iconSize = Math.round(short * 0.036);
    const titleLineH = Math.round((bodyPx + 2) * 1.3);
    const bodyLineH = Math.round(bodyPx * 1.42);
    const available = Math.max(0, bottom - y);

    const measure = (count: number, maxBodyLines: number) => {
      const subset = pillars.slice(0, count);
      const colW = Math.floor((rowW - gap * Math.max(0, subset.length - 1)) / Math.max(1, subset.length));
      const titleChars = Math.max(8, Math.floor(colW / ((bodyPx + 2) * 0.55)));
      const bodyChars = Math.max(10, Math.floor(colW / (bodyPx * 0.54)));
      const laid = subset.map((p) => ({
        icon: p.icon,
        titleLines: wrapLines(p.title, titleChars, 2),
        bodyLines: maxBodyLines > 0 ? wrapLines(p.text, bodyChars, maxBodyLines) : [],
        colW,
      }));
      const tallest = Math.max(
        ...laid.map(
          (p) =>
            iconSize + 14 + p.titleLines.length * titleLineH + 8 + p.bodyLines.length * bodyLineH,
        ),
        0,
      );
      return { laid, tallest, colW };
    };

    let fitted = measure(pillars.length, 3);
    for (let maxLines = 2; maxLines >= 0 && fitted.tallest > available; maxLines--) {
      fitted = measure(pillars.length, maxLines);
    }
    while (fitted.laid.length > 1 && fitted.tallest > available) {
      fitted = measure(fitted.laid.length - 1, 2);
    }
    if (fitted.tallest > available) {
      fitted = measure(Math.min(2, fitted.laid.length), 0);
    }

    const { laid, tallest, colW } = fitted;
    const pillarY =
      tallest <= available
        ? Math.round(y + (available - tallest) / 2)
        : Math.max(stackTop, bottom - tallest);

    pillarBlock = laid
      .map((p, i) => {
        const x = rowX + i * (colW + gap);
        let cy = pillarY;
        const ico = iconSvg(p.icon, x, cy, iconSize, accent);
        cy += iconSize + 14;
        const title = textLines(p.titleLines, x, cy, bodyPx + 2, ink, 800, titleLineH, headingFont);
        cy += p.titleLines.length * titleLineH + 8;
        const body = textLines(p.bodyLines, x, cy, bodyPx, muted, 500, bodyLineH, bodyFont);
        return `${ico}\n${title}\n${body}`;
      })
      .join('\n');
  }

  // Centred layouts float the headline stack in the free band between the logo
  // and whatever the bottom blocks claimed. Pillars stay in normal flow.
  const stackShift =
    geom.centerStack && !pillars.length
      ? Math.max(0, Math.round((bottom - stackTop - stackHeight) / 2))
      : 0;

  const slideBadge = opts.slideLabel
    ? `<g>
        <rect x="${width - pad - Math.round(short * 0.12)}" y="${pad}" width="${Math.round(
          short * 0.12,
        )}" height="${Math.round(short * 0.042)}" rx="${Math.round(short * 0.021)}" fill="${accent}"/>
        <text x="${width - pad - Math.round(short * 0.06)}" y="${
          pad + Math.round(short * 0.029)
        }" text-anchor="middle" font-family="${headingFont}" font-size="${Math.round(
          short * 0.019,
        )}" font-weight="800" fill="${onAccent}" letter-spacing="1">${escapeXml(opts.slideLabel)}</text>
      </g>`
    : '';

  const glowR = Math.round(short * 0.5);
  const maskId =
    geom.mask === 'y' ? 'artFadeY' : geom.mask === 'xr' ? 'artFadeXR' : 'artFadeX';
  const artGroup =
    geom.mask === 'none'
      ? `<image href="${artHref}" xlink:href="${artHref}" x="${art.x}" y="${art.y}" width="${art.w}" height="${art.h}" preserveAspectRatio="xMidYMid slice"/>`
      : `<g mask="url(#artMask)">
    <image href="${artHref}" xlink:href="${artHref}" x="${art.x}" y="${art.y}" width="${art.w}" height="${art.h}" preserveAspectRatio="xMidYMid slice"/>
  </g>`;

  // Keep type legible over the art without washing the photo out.
  const scrimBlock =
    geom.scrim === 'veil'
      ? `<rect width="${width}" height="${height}" fill="${ground}" opacity="0.78"/>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#veilScrim)"/>`
      : geom.scrim === 'vertical'
        ? (() => {
            const top = Math.round(art.h * geom.scrimAt);
            return `<rect x="0" y="${top}" width="${width}" height="${height - top}" fill="url(#groundScrim)"/>`;
          })()
        : '';

  const topVeilBlock = geom.topVeil
    ? `<rect x="0" y="0" width="${width}" height="${Math.round(art.h * 0.55)}" fill="url(#topVeil)"/>`
    : '';

  const seamBlock = geom.seamBand
    ? `<rect x="0" y="${art.y + art.h - Math.round(short * 0.012)}" width="${width}" height="${Math.round(
        short * 0.012,
      )}" fill="${accent}"/>`
    : '';

  const typeBand =
    geom.scrim === 'veil'
      ? `<rect x="${Math.round(pad * 0.55)}" y="${stackTop0 - Math.round(short * 0.016)}" width="${
          width - Math.round(pad * 1.1)
        }" height="${Math.max(48, stackFit.endY - stackTop0 + Math.round(short * 0.05))}" rx="${Math.round(
          short * 0.022,
        )}" fill="${ground}" opacity="0.82"/>`
      : '';

  const colorGrade = `<rect x="${art.x}" y="${art.y}" width="${art.w}" height="${art.h}" fill="${ground}" opacity="0.16"/>
  <rect x="${art.x}" y="${art.y}" width="${art.w}" height="${art.h}" fill="${accent}" opacity="0.1"/>`;

  const stack = [
    stackFit.eyebrowBlock,
    stackFit.headBlock,
    stackFit.subBlock,
    stackFit.ruleBlock,
  ]
    .filter(Boolean)
    .join('\n  ');
  const stackBlock = stackShift ? `<g transform="translate(0 ${stackShift})">${stack}</g>` : stack;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="artFadeX" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="32%" stop-color="#ffffff" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="1"/>
    </linearGradient>
    <linearGradient id="artFadeY" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="62%" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="artFadeXR" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="68%" stop-color="#ffffff" stop-opacity="0.88"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <mask id="artMask">
      <rect x="${art.x}" y="${art.y}" width="${art.w}" height="${art.h}" fill="url(#${maskId})"/>
    </mask>
    <linearGradient id="topVeil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${ground}" stop-opacity="0.62"/>
      <stop offset="60%" stop-color="${ground}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${ground}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="veilScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${ground}" stop-opacity="0.72"/>
      <stop offset="42%" stop-color="${ground}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${ground}" stop-opacity="0.88"/>
    </linearGradient>
    <radialGradient id="accentGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="${accent}" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="groundScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${ground}" stop-opacity="0"/>
      <stop offset="45%" stop-color="${ground}" stop-opacity="0.6"/>
      <stop offset="72%" stop-color="${ground}" stop-opacity="0.94"/>
      <stop offset="100%" stop-color="${ground}" stop-opacity="0.99"/>
    </linearGradient>
  </defs>

  <rect width="${width}" height="${height}" fill="${ground}"/>
  <circle cx="${art.x + art.w * 0.4}" cy="${art.h * 0.35}" r="${glowR}" fill="url(#accentGlow)"/>
  ${artGroup}
  ${colorGrade}
  ${topVeilBlock}
  ${scrimBlock}
  ${seamBlock}

  ${typeBand}
  ${brandBlock}
  ${slideBadge}
  ${stackBlock}
  ${pillarBlock}
  ${statBlock}
  ${calloutBlock}
  ${closingBlock}
  ${contactBlock}
  ${footerBlock}
</svg>`;

  const dir = path.resolve(config.UPLOAD_DIR, opts.tenantId, 'social-images');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `poster-${width}x${height}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.svg`;
  fs.writeFileSync(path.join(dir, filename), svg, 'utf8');
  return {
    publicUrl: `/uploads/${opts.tenantId}/social-images/${filename}`,
    width,
    height,
  };
}

export const POSTER_ICON_IDS = Object.keys(ICON_PATHS) as PosterIconId[];
