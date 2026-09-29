import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import {
  escapeXml,
  luminance,
  mixHex,
  wrapLines,
  type InsightPalette,
} from './social-frame';
import type { PosterLayoutId, PosterSpec } from './poster-frame';

export function isRetailOfferLayout(layout?: PosterLayoutId | null): boolean {
  return layout === 'sale_circles' || layout === 'sale_split';
}

type RetailColors = {
  paper: string;
  frame: string;
  ink: string;
  muted: string;
  accent: string;
  onAccent: string;
  photoBack: string;
};

function retailColors(palette: InsightPalette): RetailColors {
  const paper = '#FFFFFF';
  const frame = palette.accent;
  const ink =
    luminance(palette.ink) > 0.55 ? mixHex(palette.ground, '#111111', 0.12) : palette.ink;
  const muted = mixHex(ink, '#8B93A2', 0.52);
  const onAccent = luminance(frame) < 0.45 ? '#FFFFFF' : mixHex(ink, '#111111', 0.35);
  const photoBack = mixHex(frame, '#F4D27A', 0.42);
  return { paper, frame, ink, muted, accent: frame, onAccent, photoBack };
}

function kicker(eyebrow: string): string {
  const words = eyebrow.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1 && words[0].length <= 10) return words[0].toUpperCase();
  if (words.length === 2 && words.join(' ').length <= 12) return words.join(' ').toUpperCase();
  return 'SALE';
}

function websiteLine(footer: string, company: string): string {
  const raw = (footer || company || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
    .toUpperCase()
    .slice(0, 28);
}

/** Rough chars that fit a column at a given font size (sans / display). */
function charsAt(colW: number, fontPx: number, factor = 0.55): number {
  return Math.max(8, Math.floor(colW / (fontPx * factor)));
}

function fitFont(base: number, text: string, softMax: number, hardMin: number): number {
  if (text.length <= softMax) return base;
  const scale = softMax / text.length;
  return Math.max(hardMin, Math.round(base * Math.max(0.62, scale)));
}

function tri(cx: number, cy: number, s: number, fill: string, rot = 0): string {
  const h = s * 0.9;
  return `<polygon points="${cx},${cy - h} ${cx + s},${cy + h * 0.5} ${cx - s},${cy + h * 0.5}" fill="${fill}" transform="rotate(${rot} ${cx} ${cy})"/>`;
}

function txt(
  x: number,
  y: number,
  font: string,
  size: number,
  weight: number,
  fill: string,
  content: string,
  extra = '',
): string {
  return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${escapeXml(
    content,
  )}</text>`;
}

function stackedHeadline(
  headline: string,
  accentPhrase: string,
  x: number,
  startY: number,
  font: string,
  sizes: number[],
  gap: number,
  ink: string,
  accent: string,
): string {
  const words = headline.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  let baseline = startY;
  return words
    .map((word, i) => {
      const size = sizes[Math.min(i, sizes.length - 1)];
      baseline += i === 0 ? size : size + gap;
      const paintAccent =
        accentPhrase && word.toLowerCase() === accentPhrase.toLowerCase()
          ? accent
          : !accentPhrase && i === 1
            ? accent
            : ink;
      return txt(x, baseline, font, size, 800, paintAccent, word);
    })
    .join('\n');
}

function logoLockup(opts: {
  logoHref: string;
  company: string;
  x: number;
  y: number;
  w: number;
  h: number;
  accent: string;
  onAccent: string;
  headingFont: string;
  badge?: boolean;
}): string {
  const { logoHref, company, x, y, w, h, accent, onAccent, headingFont, badge } = opts;
  if (logoHref) {
    if (badge) {
      const pad = 7;
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(
        h * 0.18,
      )}" fill="${accent}"/><image href="${logoHref}" xlink:href="${logoHref}" x="${x + pad}" y="${
        y + pad
      }" width="${w - pad * 2}" height="${h - pad * 2}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    return `<image href="${logoHref}" xlink:href="${logoHref}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMinYMid meet"/>`;
  }
  const label = (company || 'LOGO').slice(0, 14).toUpperCase();
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(
    h * 0.18,
  )}" fill="${accent}"/>${txt(
    x + w / 2,
    y + h * 0.68,
    headingFont,
    Math.round(h * 0.36),
    800,
    onAccent,
    label,
    'text-anchor="middle"',
  )}`;
}

function ctaPill(
  x: number,
  y: number,
  label: string,
  font: string,
  accent: string,
  onAccent: string,
  size: number,
  maxW: number,
): { svg: string; h: number } {
  const clean = label.trim().slice(0, 28);
  let fontPx = size;
  let w = Math.round(clean.length * fontPx * 0.58 + 44);
  if (w > maxW) {
    fontPx = Math.max(13, Math.floor(((maxW - 44) / Math.max(1, clean.length)) / 0.58));
    w = Math.min(maxW, Math.round(clean.length * fontPx * 0.58 + 44));
  }
  const h = Math.round(fontPx * 2.15);
  const svg = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(
    h / 2,
  )}" fill="${accent}"/>${txt(
    x + w / 2,
    y + h * 0.68,
    font,
    fontPx,
    700,
    onAccent,
    clean,
    'text-anchor="middle"',
  )}`;
  return { svg, h };
}

/** Circular photo with an intentional crop offset so two cutouts never look identical. */
function circlePhoto(opts: {
  id: string;
  cx: number;
  cy: number;
  r: number;
  artHref: string;
  ring: string;
  back: string;
  ringW: number;
  /** Horizontal crop bias: negative = show more left, positive = more right. */
  ox: number;
  /** Vertical crop bias. */
  oy: number;
  /** Scale of the source image relative to diameter (1.4–1.9). */
  scale: number;
}): string {
  const { id, cx, cy, r, artHref, ring, back, ringW, ox, oy, scale } = opts;
  const side = r * 2 * scale;
  const x = cx - r * scale + ox;
  const y = cy - r * scale + oy;
  return `<circle cx="${cx}" cy="${cy}" r="${r + Math.round(ringW * 0.9)}" fill="${back}"/>
  <clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
  <image href="${artHref}" xlink:href="${artHref}" x="${x}" y="${y}" width="${side}" height="${side}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ring}" stroke-width="${ringW}"/>`;
}

function renderSaleCircles(opts: {
  width: number;
  height: number;
  artHref: string;
  logoHref: string;
  company: string;
  headingFont: string;
  bodyFont: string;
  spec: PosterSpec;
  c: RetailColors;
}): string {
  const { width: W, height: H, artHref, logoHref, company, headingFont, bodyFont, spec, c } = opts;
  const u = Math.min(W, H) / 1080;
  // Outer brand-colour frame (matches Magnific card edge).
  const frame = Math.round(28 * u);
  const ix = frame;
  const iy = frame;
  const iw = W - frame * 2;
  const ih = H - frame * 2;
  const rx = Math.round(10 * u);

  const eyebrow = kicker(spec.eyebrow || '');
  const headline = (spec.headline || 'New Collections').trim();
  const subhead = (spec.subhead || '').trim();
  const statValue = (spec.statValue || '').trim();
  const statLabel = (spec.statLabel || '').trim();
  const bonus = /\boff\b/i.test(statLabel) ? 'Sale Bonus!' : (statLabel || 'Sale Bonus!').slice(0, 18);
  const cta = (spec.closingLine || 'Shop Now').trim();
  const site = websiteLine(spec.footerNote || '', company) || 'WEBSITE GOES HERE';

  // Mustard arc on the right — photo lives inside it (exact Magnific geometry).
  const arcR = Math.round(ih * 0.62);
  const arcCx = Math.round(ix + iw + arcR * 0.18);
  const arcCy = Math.round(iy + ih * 0.58);

  // Large circular portrait (mostly inside the arc).
  const bigR = Math.round(iw * 0.28);
  const bigCx = Math.round(ix + iw * 0.78);
  const bigCy = Math.round(iy + ih * 0.52);

  // Smaller overlapping circle mid-bottom.
  const smallR = Math.round(iw * 0.135);
  const smallCx = Math.round(ix + iw * 0.48);
  const smallCy = Math.round(iy + ih * 0.78);

  const leftX = Math.round(ix + 52 * u);
  const typeW = Math.max(240, Math.round(smallCx - smallR - leftX - 16 * u));

  const salePx = fitFont(Math.round((eyebrow.length > 5 ? 96 : 124) * u), eyebrow, 5, Math.round(78 * u));
  const headPx = fitFont(Math.round(38 * u), headline, 16, Math.round(24 * u));
  const bodyPx = Math.round(18 * u);

  const logoY = Math.round(iy + 40 * u);
  const logoH = Math.round(52 * u);
  const logoW = Math.round(148 * u);

  let cursor = logoY + logoH + Math.round(42 * u);
  const saleY = cursor + salePx;
  cursor = saleY + Math.round(14 * u);

  const headLines = wrapLines(headline, charsAt(typeW, headPx, 0.52), 2);
  const headBlock = headLines
    .map((line, i) => {
      const y = cursor + headPx + i * Math.round(headPx * 1.18);
      return txt(leftX, y, headingFont, headPx, 800, c.ink, line);
    })
    .join('\n');
  cursor += headLines.length * Math.round(headPx * 1.18) + Math.round(26 * u);

  const ctaBandTop = Math.round(iy + ih - 168 * u);
  const bodyBudget = Math.max(0, ctaBandTop - cursor - Math.round(16 * u));
  const bodyLineH = Math.round(bodyPx * 1.4);
  const maxBodyLines = Math.min(4, Math.max(0, Math.floor(bodyBudget / bodyLineH)));
  const bodyLines =
    maxBodyLines > 0
      ? wrapLines(
          subhead || 'We are committed to providing the best quality product at a low price.',
          charsAt(typeW, bodyPx, 0.5),
          maxBodyLines,
        )
      : [];
  const bodyBlock = bodyLines
    .map((line, i) =>
      txt(leftX, cursor + bodyPx + i * bodyLineH, bodyFont, bodyPx, 500, c.ink, line),
    )
    .join('\n');

  // 25% OFF stacked top-right with script "Sale Bonus!" over OFF.
  const statPx = Math.round(72 * u);
  const offPx = Math.round(34 * u);
  const statRight = Math.round(ix + iw - 48 * u);
  const statTop = Math.round(iy + 118 * u);

  const ctaMaxW = Math.min(typeW, Math.round(280 * u));
  const ctaY = Math.round(iy + ih - (site ? 148 : 108) * u);
  const ctaBlock = cta
    ? (() => {
        // Magnific uses a rounded rectangle CTA, not a full pill.
        const clean = cta.trim().slice(0, 28);
        let fontPx = Math.round(17 * u);
        let w = Math.round(clean.length * fontPx * 0.58 + 48);
        if (w > ctaMaxW) {
          fontPx = Math.max(13, Math.floor(((ctaMaxW - 48) / Math.max(1, clean.length)) / 0.58));
          w = Math.min(ctaMaxW, Math.round(clean.length * fontPx * 0.58 + 48));
        }
        const h = Math.round(fontPx * 2.35);
        const r = Math.round(10 * u);
        return {
          svg: `<rect x="${leftX}" y="${ctaY}" width="${w}" height="${h}" rx="${r}" fill="${c.accent}"/>${txt(
            leftX + w / 2,
            ctaY + h * 0.68,
            headingFont,
            fontPx,
            700,
            c.onAccent,
            clean,
            'text-anchor="middle"',
          )}`,
          h,
        };
      })()
    : null;
  const siteY = Math.round(iy + ih - 52 * u);

  // Scattered outline triangles + dots (Magnific ornaments).
  const accents = [
    `<polygon points="${Math.round(ix + iw * 0.42)},${Math.round(iy + 58 * u)} ${Math.round(ix + iw * 0.42 + 14 * u)},${Math.round(iy + 78 * u)} ${Math.round(ix + iw * 0.42 - 14 * u)},${Math.round(iy + 78 * u)}" fill="none" stroke="${c.accent}" stroke-width="${2.2 * u}"/>`,
    `<polygon points="${Math.round(leftX + 4 * u)},${Math.round(saleY - salePx * 0.55)} ${Math.round(leftX + 14 * u)},${Math.round(saleY - salePx * 0.35)} ${Math.round(leftX + 4 * u)},${Math.round(saleY - salePx * 0.15)}" fill="${c.ink}"/>`,
    `<polygon points="${Math.round(ix + iw * 0.36)},${Math.round(iy + ih * 0.48)} ${Math.round(ix + iw * 0.36 + 11 * u)},${Math.round(iy + ih * 0.48 + 16 * u)} ${Math.round(ix + iw * 0.36 - 11 * u)},${Math.round(iy + ih * 0.48 + 16 * u)}" fill="none" stroke="${c.accent}" stroke-width="${2 * u}"/>`,
    `<circle cx="${Math.round(ix + iw * 0.56)}" cy="${Math.round(iy + 88 * u)}" r="${5 * u}" fill="none" stroke="${c.paper}" stroke-width="${2.5 * u}"/>`,
    `<circle cx="${Math.round(ix + iw * 0.55)}" cy="${Math.round(iy + ih - 88 * u)}" r="${6 * u}" fill="${c.accent}"/>`,
    `<polygon points="${Math.round(ix + 72 * u)},${Math.round(iy + ih * 0.62)} ${Math.round(ix + 84 * u)},${Math.round(iy + ih * 0.62 + 10 * u)} ${Math.round(ix + 72 * u)},${Math.round(iy + ih * 0.62 + 20 * u)}" fill="${c.accent}"/>`,
  ].join('\n');

  // Crumpled-paper feel via soft noise overlay (filter defined in <defs>).
  const paperOverlay = `<rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="${rx}" filter="url(#paperGrain)" opacity="0.55"/>`;

  const pctW = Math.round(
    [...statValue].reduce((w, ch) => w + (ch === '%' ? 0.72 : 0.58), 0) * statPx,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="softShadow" x="-25%" y="-25%" width="150%" height="150%">
      <feDropShadow dx="0" dy="${5 * u}" stdDeviation="${8 * u}" flood-color="#000000" flood-opacity="0.18"/>
    </filter>
    <filter id="paperGrain" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" result="n"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.55  0 0 0 0 0.55  0 0 0 0 0.55  0 0 0 0.08 0" in="n"/>
    </filter>
    <clipPath id="innerCard"><rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="${rx}"/></clipPath>
    <clipPath id="arcPhoto"><circle cx="${arcCx}" cy="${arcCy}" r="${arcR}"/></clipPath>
    <clipPath id="bigCut"><circle cx="${bigCx}" cy="${bigCy}" r="${bigR}"/></clipPath>
    <clipPath id="smallCut"><circle cx="${smallCx}" cy="${smallCy}" r="${smallR}"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" rx="${Math.round(18 * u)}" fill="${c.frame}"/>
  <rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" rx="${rx}" fill="#F3F1EC"/>
  ${paperOverlay}

  <g clip-path="url(#innerCard)">
    <!-- Mustard arc (brand secondary / warm mix) -->
    <circle cx="${arcCx}" cy="${arcCy}" r="${arcR}" fill="${c.photoBack}"/>
    <!-- Hero photo clipped to arc -->
    <image href="${artHref}" xlink:href="${artHref}" x="${arcCx - arcR}" y="${arcCy - arcR * 1.05}" width="${arcR * 2}" height="${arcR * 2.1}" preserveAspectRatio="xMidYMid slice" clip-path="url(#arcPhoto)" opacity="0.92"/>
  </g>

  ${accents}

  ${logoLockup({
    logoHref,
    company,
    x: leftX,
    y: logoY,
    w: logoW,
    h: logoH,
    accent: c.accent,
    onAccent: c.onAccent,
    headingFont,
    badge: true,
  })}

  ${txt(leftX, saleY, headingFont, salePx, 800, c.accent, eyebrow)}
  ${headBlock}
  ${bodyBlock}

  ${
    statValue
      ? `<g>
      ${txt(statRight - pctW, statTop, headingFont, statPx, 800, c.accent, statValue)}
      ${txt(statRight - pctW * 0.15, statTop + Math.round(42 * u), headingFont, offPx, 800, c.accent, 'OFF')}
      <text x="${statRight - pctW * 0.05}" y="${statTop + Math.round(28 * u)}" font-family="${headingFont}" font-size="${Math.round(
          26 * u,
        )}" font-weight="600" font-style="italic" fill="${c.ink}" text-anchor="end" transform="rotate(-8 ${statRight - pctW * 0.05} ${statTop + Math.round(28 * u)})">${escapeXml(bonus)}</text>
      <circle cx="${statRight - pctW - Math.round(18 * u)}" cy="${statTop - Math.round(28 * u)}" r="${7 * u}" fill="none" stroke="${c.paper}" stroke-width="${2.5 * u}"/>
    </g>`
      : ''
  }

  <g filter="url(#softShadow)" clip-path="url(#innerCard)">
    <circle cx="${bigCx}" cy="${bigCy}" r="${bigR + Math.round(6 * u)}" fill="${c.photoBack}"/>
    <image href="${artHref}" xlink:href="${artHref}" x="${bigCx - bigR * 1.35}" y="${bigCy - bigR * 1.45}" width="${bigR * 2.7}" height="${bigR * 2.7}" preserveAspectRatio="xMidYMid slice" clip-path="url(#bigCut)"/>
    <circle cx="${bigCx}" cy="${bigCy}" r="${bigR}" fill="none" stroke="${c.paper}" stroke-width="${Math.round(8 * u)}"/>
  </g>
  <g filter="url(#softShadow)" clip-path="url(#innerCard)">
    <circle cx="${smallCx}" cy="${smallCy}" r="${smallR + Math.round(4 * u)}" fill="${c.paper}"/>
    <image href="${artHref}" xlink:href="${artHref}" x="${smallCx - smallR * 1.55}" y="${smallCy - smallR * 1.2}" width="${smallR * 3.1}" height="${smallR * 3.1}" preserveAspectRatio="xMidYMid slice" clip-path="url(#smallCut)"/>
    <circle cx="${smallCx}" cy="${smallCy}" r="${smallR}" fill="none" stroke="${c.paper}" stroke-width="${Math.round(7 * u)}"/>
  </g>

  ${ctaBlock ? ctaBlock.svg : ''}

  ${
    site
      ? `<g>
    <rect x="${leftX}" y="${siteY - Math.round(18 * u)}" width="${Math.round(28 * u)}" height="${Math.round(28 * u)}" rx="${Math.round(4 * u)}" fill="none" stroke="${c.ink}" stroke-width="${2.2 * u}"/>
    <path d="M${leftX + 8 * u} ${siteY - 4 * u}h${12 * u}m${-4 * u} ${-5 * u}l${5 * u} ${5 * u} ${-5 * u} ${5 * u}" fill="none" stroke="${c.ink}" stroke-width="${2.4 * u}" stroke-linecap="round" stroke-linejoin="round"/>
    ${txt(leftX + Math.round(40 * u), siteY + Math.round(2 * u), headingFont, Math.round(16 * u), 800, c.ink, site, 'letter-spacing="1.4"')}
  </g>`
      : ''
  }
</svg>`;
}

function socialMark(cx: number, cy: number, r: number, letter: string, fill: string, font: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>${txt(
    cx,
    cy + r * 0.38,
    font,
    Math.round(r * 0.9),
    700,
    '#FFFFFF',
    letter,
    'text-anchor="middle"',
  )}`;
}

function phoneGlyph(cx: number, cy: number, r: number, fill: string, ink: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>
  <path d="M${cx - r * 0.35} ${cy - r * 0.28}c${r * 0.08} ${-r * 0.12} ${r * 0.32} ${-r * 0.06} ${r * 0.42} ${r * 0.12} ${r * 0.12} ${r * 0.2} ${r * 0.14} ${r * 0.48} ${r * 0.02} ${r * 0.58}l${-r * 0.18} ${r * 0.12} ${-r * 0.22} ${-r * 0.24}c0 ${-r * 0.12} ${-r * 0.06} ${-r * 0.22} ${-r * 0.14} ${-r * 0.28}z" fill="${ink}"/>`;
}

function renderSaleSplit(opts: {
  width: number;
  height: number;
  artHref: string;
  logoHref: string;
  company: string;
  headingFont: string;
  bodyFont: string;
  spec: PosterSpec;
  c: RetailColors;
}): string {
  const { width: W, height: H, artHref, logoHref, company, headingFont, bodyFont, spec, c } = opts;
  const u = Math.min(W, H) / 1080;
  // Thick brand frame + vertical divider (exact Magnific split).
  const border = Math.round(22 * u);
  const splitX = Math.round(W * 0.54);
  const leftX = Math.round(border + 44 * u);
  const typeW = splitX - leftX - Math.round(32 * u);
  const rightW = W - splitX - border;

  const tagline = (spec.eyebrow || 'Tagline here').trim().slice(0, 28);
  const headline = (spec.headline || 'Big Sale Offer').trim();
  const accentPhrase = (spec.headlineAccent || '').trim() || 'Sale';
  const statValue = (spec.statValue || '').trim();
  const cta = (spec.closingLine || 'Order Now').trim().toUpperCase();
  const phone = (spec.calloutBody || spec.calloutTitle || '').trim() || '+00 123 456 789';
  const showPhone = true;
  const site = websiteLine(spec.footerNote || '', company) || 'WWW.YOURWEBSITE.COM';

  const words = headline.split(/\s+/).filter(Boolean).slice(0, 4);
  const long = words.join(' ').length > 22;
  const sizes = words.map((_, i) =>
    Math.round((i === 1 ? (long ? 78 : 96) : long ? 56 : 68) * u),
  );
  const logoTop = Math.round(border + 36 * u);
  const headStart = Math.round(border + 150 * u);
  const gap = Math.round(4 * u);
  let headH = 0;
  for (let i = 0; i < words.length; i++) {
    const size = sizes[Math.min(i, sizes.length - 1)];
    headH += i === 0 ? size : size + gap;
  }
  const getY = headStart + headH + Math.round(48 * u);
  const statPx = Math.round((statValue.length > 4 ? 72 : 88) * u);

  const dots = (ox: number, oy: number, rows = 4, cols = 5) => {
    const cells: string[] = [];
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        cells.push(
          `<circle cx="${ox + col * 9 * u}" cy="${oy + r * 9 * u}" r="${1.6 * u}" fill="${c.ink}" opacity="0.32"/>`,
        );
      }
    }
    return cells.join('');
  };

  // Bottom band: phone left, CTA above chevron.
  const phoneCy = H - border - Math.round(78 * u);
  const ctaY = Math.round(getY + (statValue ? 110 : 40) * u);
  const ctaMaxW = Math.min(typeW, Math.round(210 * u));
  const ctaClean = cta.slice(0, 22);
  let ctaFont = Math.round(15 * u);
  let ctaW = Math.round(ctaClean.length * ctaFont * 0.58 + 44);
  if (ctaW > ctaMaxW) {
    ctaFont = Math.max(12, Math.floor(((ctaMaxW - 44) / Math.max(1, ctaClean.length)) / 0.58));
    ctaW = Math.min(ctaMaxW, Math.round(ctaClean.length * ctaFont * 0.58 + 44));
  }
  const ctaH = Math.round(ctaFont * 2.2);
  const ctaRx = Math.round(ctaH / 2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="rightPhoto">
      <rect x="${splitX}" y="${border}" width="${rightW}" height="${H - border * 2}"/>
    </clipPath>
    <linearGradient id="photoScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.55"/>
      <stop offset="22%" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="72%" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.72"/>
    </linearGradient>
  </defs>
  <!-- Outer frame -->
  <rect width="${W}" height="${H}" fill="${c.frame}"/>
  <!-- Left paper -->
  <rect x="${border}" y="${border}" width="${splitX - border}" height="${H - border * 2}" fill="${c.paper}"/>
  <!-- Right photo -->
  <image href="${artHref}" xlink:href="${artHref}" x="${splitX}" y="${border}" width="${rightW}" height="${H - border * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#rightPhoto)"/>
  <rect x="${splitX}" y="${border}" width="${rightW}" height="${H - border * 2}" fill="url(#photoScrim)"/>
  <!-- Vertical divider -->
  <rect x="${splitX - Math.round(border * 0.45)}" y="${border}" width="${Math.round(border * 0.9)}" height="${H - border * 2}" fill="${c.frame}"/>

  ${logoLockup({
    logoHref,
    company,
    x: leftX,
    y: logoTop,
    w: Math.round(132 * u),
    h: Math.round(40 * u),
    accent: c.accent,
    onAccent: c.onAccent,
    headingFont,
    badge: !logoHref,
  })}
  ${txt(
    leftX,
    logoTop + Math.round(58 * u),
    bodyFont,
    Math.round(12 * u),
    700,
    c.ink,
    tagline.toUpperCase(),
    'letter-spacing="1.8"',
  )}

  ${dots(Math.round(splitX - 72 * u), Math.round(border + 40 * u), 4, 5)}
  ${dots(leftX, Math.round(H - border - 210 * u), 4, 4)}
  ${dots(splitX + Math.round(18 * u), Math.round(H * 0.42), 3, 4)}
  <!-- Triangle accents -->
  <polygon points="${Math.round(splitX - 56 * u)},${Math.round(border + 132 * u)} ${Math.round(splitX - 40 * u)},${Math.round(border + 148 * u)} ${Math.round(splitX - 56 * u)},${Math.round(border + 164 * u)}" fill="none" stroke="${c.accent}" stroke-width="${2.4 * u}"/>
  <polygon points="${Math.round(leftX + typeW * 0.72)},${Math.round(getY + 20 * u)} ${Math.round(leftX + typeW * 0.72 + 16 * u)},${Math.round(getY + 32 * u)} ${Math.round(leftX + typeW * 0.72)},${Math.round(getY + 44 * u)}" fill="${c.accent}"/>

  ${stackedHeadline(headline, accentPhrase, leftX, headStart, headingFont, sizes, gap, c.ink, c.accent)}

  ${
    statValue
      ? `<g>
      <text x="${leftX}" y="${getY}" font-family="${headingFont}" font-size="${Math.round(
          32 * u,
        )}" font-weight="600" font-style="italic" fill="${c.ink}">Get</text>
      ${txt(leftX, getY + Math.round(78 * u), headingFont, statPx, 800, c.accent, statValue)}
      ${txt(
        leftX + Math.round(statValue.length * statPx * 0.55 + 10 * u),
        getY + Math.round(78 * u),
        headingFont,
        Math.round(28 * u),
        800,
        c.ink,
        'Off',
      )}
    </g>`
      : ''
  }

  <!-- CTA pill -->
  <rect x="${leftX}" y="${Math.min(ctaY, phoneCy - Math.round(92 * u))}" width="${ctaW}" height="${ctaH}" rx="${ctaRx}" fill="${c.accent}"/>
  ${txt(
    leftX + ctaW / 2,
    Math.min(ctaY, phoneCy - Math.round(92 * u)) + ctaH * 0.68,
    headingFont,
    ctaFont,
    800,
    c.onAccent,
    ctaClean,
    'text-anchor="middle"',
  )}
  <!-- Chevron under CTA -->
  <path d="M${leftX + ctaW / 2 - 8 * u} ${Math.min(ctaY, phoneCy - Math.round(92 * u)) + ctaH + 14 * u}l${8 * u} ${-8 * u} ${8 * u} ${8 * u}" fill="none" stroke="${c.accent}" stroke-width="${3 * u}" stroke-linecap="round" stroke-linejoin="round"/>

  ${
    showPhone
      ? `<g>
      ${phoneGlyph(leftX + Math.round(16 * u), phoneCy, Math.round(16 * u), c.accent, c.onAccent)}
      ${txt(leftX + Math.round(42 * u), phoneCy - Math.round(8 * u), bodyFont, Math.round(10 * u), 700, c.ink, 'CALL FOR MORE INFORMATION', 'letter-spacing="1.1"')}
      ${txt(leftX + Math.round(42 * u), phoneCy + Math.round(12 * u), headingFont, Math.round(16 * u), 800, c.accent, phone.slice(0, 22))}
    </g>`
      : ''
  }

  <!-- Social on photo -->
  <g>
    ${txt(splitX + Math.round(36 * u), border + Math.round(48 * u), bodyFont, Math.round(12 * u), 700, c.ink, 'FOLLOW ON US', 'letter-spacing="1.6"')}
    ${socialMark(splitX + Math.round(48 * u), border + Math.round(82 * u), Math.round(14 * u), 'f', c.accent, headingFont)}
    ${socialMark(splitX + Math.round(84 * u), border + Math.round(82 * u), Math.round(14 * u), 'o', c.accent, headingFont)}
    ${socialMark(splitX + Math.round(120 * u), border + Math.round(82 * u), Math.round(14 * u), 'x', c.accent, headingFont)}
  </g>

  <!-- Website on photo -->
  <g>
    <circle cx="${splitX + Math.round(48 * u)}" cy="${H - border - Math.round(52 * u)}" r="${Math.round(15 * u)}" fill="${c.accent}"/>
    <circle cx="${splitX + Math.round(48 * u)}" cy="${H - border - Math.round(52 * u)}" r="${Math.round(7 * u)}" fill="none" stroke="${c.onAccent}" stroke-width="${2 * u}"/>
    ${txt(splitX + Math.round(74 * u), H - border - Math.round(58 * u), headingFont, Math.round(13 * u), 800, c.accent, site, 'letter-spacing="1"')}
    ${txt(splitX + Math.round(74 * u), H - border - Math.round(38 * u), bodyFont, Math.round(11 * u), 700, c.accent, 'VISIT OUR WEBSITE', 'letter-spacing="1.2"')}
  </g>
</svg>`;
}

export async function writeRetailOfferPoster(opts: {
  tenantId: string;
  width: number;
  height: number;
  layout: 'sale_circles' | 'sale_split';
  artHref: string;
  logoHref: string;
  companyName?: string | null;
  headingFont: string;
  bodyFont: string;
  spec: PosterSpec;
  palette: InsightPalette;
}): Promise<{ publicUrl: string; width: number; height: number }> {
  const c = retailColors(opts.palette);
  const company = (opts.companyName || '').trim();
  const svg =
    opts.layout === 'sale_split'
      ? renderSaleSplit({
          width: opts.width,
          height: opts.height,
          artHref: opts.artHref,
          logoHref: opts.logoHref,
          company,
          headingFont: opts.headingFont,
          bodyFont: opts.bodyFont,
          spec: opts.spec,
          c,
        })
      : renderSaleCircles({
          width: opts.width,
          height: opts.height,
          artHref: opts.artHref,
          logoHref: opts.logoHref,
          company,
          headingFont: opts.headingFont,
          bodyFont: opts.bodyFont,
          spec: opts.spec,
          c,
        });

  const dir = path.resolve(config.UPLOAD_DIR, opts.tenantId, 'social-images');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `poster-${opts.width}x${opts.height}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.svg`;
  fs.writeFileSync(path.join(dir, filename), svg, 'utf8');
  return {
    publicUrl: `/uploads/${opts.tenantId}/social-images/${filename}`,
    width: opts.width,
    height: opts.height,
  };
}
