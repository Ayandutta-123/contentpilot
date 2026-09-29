/**
 * Detect a Brand Kit palette from website HTML / CSS.
 * Prefers theme tokens (--primary, --brand, …), then theme-color / manifest,
 * then frequent hex/rgb/oklch — never Tailwind font-size tokens like --text-xs.
 */

import { normalizeHex, type BrandKitColors } from '../lib/brand-kit';

const HEX_FIND =
  /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_FIND =
  /\brgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*[,/]\s*[\d.]+%?)?\s*\)/gi;
const HSL_FIND =
  /\bhsla?\(\s*(\d{1,3}(?:\.\d+)?)(?:deg)?\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%?\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%?(?:\s*[,/]\s*[\d.]+%?)?\s*\)/gi;
const OKLCH_FIND =
  /\boklch\(\s*([^\)]+)\)/gi;
/** shadcn / Tailwind v4: `--primary: 254 41% 21%;` */
const SPACE_HSL_RE = /^\s*(\d{1,3}(?:\.\d+)?)\s+(\d{1,3}(?:\.\d+)?)%?\s+(\d{1,3}(?:\.\d+)?)%?\s*$/;

/** Exact theme tokens only — do NOT match --text-xs / --text-sm (font sizes). */
const ROLE_VAR_NAMES: Array<{ role: keyof BrandKitColors; names: string[] }> = [
  {
    role: 'primary',
    names: [
      'primary',
      'brand',
      'brand-primary',
      'brand-color',
      'color-primary',
      'color-brand',
      'main',
      'theme',
      'key-color',
      'company-color',
    ],
  },
  {
    role: 'secondary',
    names: ['secondary', 'brand-secondary', 'color-secondary', 'muted', 'neutral'],
  },
  {
    role: 'accent',
    names: [
      'accent',
      'brand-accent',
      'color-accent',
      'cta',
      'highlight',
      'link',
      'destructive',
      'ring',
    ],
  },
  {
    role: 'background',
    names: [
      'background',
      'bg',
      'page-bg',
      'color-bg',
      'canvas',
      'surface',
      'body-bg',
      'page-background',
    ],
  },
  {
    role: 'text',
    names: ['foreground', 'color-text', 'text-color', 'ink', 'body-color', 'body-text'],
  },
];

const SOCIAL_BRAND_HEXES = new Set([
  '#0077B5', // LinkedIn
  '#1DA1F2', // Twitter
  '#1877F2', // Facebook
  '#E4405F', // Instagram-ish
  '#25D366', // WhatsApp
  '#FF0000', // YouTube
  '#0A66C2', // LinkedIn alt
  '#FFFC00', // Snapchat
]);

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((v) => clampByte(v).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function expandHex(raw: string): string | null {
  const s = raw.trim();
  if (!s.startsWith('#')) return null;
  if (/^#[0-9a-fA-F]{8}$/.test(s)) return `#${s.slice(1, 7).toUpperCase()}`;
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const h = s.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase();
  }
  return null;
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** Approximate OKLCH → sRGB hex (good enough for brand kit scraping). */
function oklchToHex(L: number, C: number, H: number): string | null {
  if (!Number.isFinite(L) || !Number.isFinite(C) || !Number.isFinite(H)) return null;
  // Accept L as 0–1 or 0–100
  const l = L > 1 ? L / 100 : L;
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  let r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  let bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  // Linear → sRGB
  const toSrgb = (c: number) => {
    const v = Math.max(0, Math.min(1, c));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  };
  r = toSrgb(r);
  g = toSrgb(g);
  bl = toSrgb(bl);
  return toHex(r * 255, g * 255, bl * 255);
}

function parseOklchArgs(args: string): string | null {
  // oklch(0.55 0.18 250) | oklch(55% 0.18 250deg) | oklch(0.55 0.18 250 / 0.9)
  const cleaned = args.replace(/\/[^)]+$/, '').trim();
  const parts = cleaned.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const L = parseFloat(parts[0]!.replace('%', ''));
  const C = parseFloat(parts[1]!);
  const H = parseFloat(parts[2]!.replace(/deg/i, ''));
  if ([L, C, H].some((n) => Number.isNaN(n))) return null;
  const Lnorm = parts[0]!.includes('%') ? L / 100 : L;
  return oklchToHex(Lnorm, C, H);
}

export function parseColorToken(raw: string): string | null {
  const t = raw.trim().replace(/^["']|["']$/g, '');
  if (!t || /^transparent$/i.test(t) || /^inherit$/i.test(t) || /^currentcolor$/i.test(t)) {
    return null;
  }
  // Skip non-colour CSS values (rem, font stacks, etc.)
  if (
    /rem|em|px|%|ch|vw|vh|normal|bold|italic|sans|serif|mono/i.test(t) &&
    !SPACE_HSL_RE.test(t) &&
    !t.includes('#') &&
    !/rgb|hsl|oklch/i.test(t)
  ) {
    if (!/^\d/.test(t)) return null;
  }

  const hex = expandHex(t);
  if (hex) return hex;

  const rgb = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i.exec(t);
  if (rgb) return toHex(+rgb[1]!, +rgb[2]!, +rgb[3]!);

  const hsl =
    /^hsla?\(\s*(\d{1,3}(?:\.\d+)?)(?:deg)?\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%?\s*[, ]\s*(\d{1,3}(?:\.\d+)?)%?/i.exec(
      t,
    );
  if (hsl) return hslToHex(+hsl[1]!, +hsl[2]!, +hsl[3]!);

  const oklch = /^oklch\(\s*([^\)]+)\)/i.exec(t);
  if (oklch) return parseOklchArgs(oklch[1]!);

  // shadcn: "254 41% 21%" or "254.1 41.2% 21.3%"
  const space = SPACE_HSL_RE.exec(t);
  if (space) return hslToHex(+space[1]!, +space[2]!, +space[3]!);

  return null;
}

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(hex: string): number {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === 0) return 0;
  return (max - min) / max;
}

function hue(hex: string): number {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}

function hueDistance(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

function isNearGray(hex: string): boolean {
  return saturation(hex) < 0.12;
}

function collectAllColors(cssOrHtml: string): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (hex: string | null, weight = 1) => {
    if (!hex) return;
    if (SOCIAL_BRAND_HEXES.has(hex)) weight *= 0.15; // de-rank social icon colours
    counts.set(hex, (counts.get(hex) || 0) + weight);
  };

  let m: RegExpExecArray | null;
  const hexRe = new RegExp(HEX_FIND.source, 'g');
  while ((m = hexRe.exec(cssOrHtml))) bump(expandHex(m[0]!), 1);

  const rgbRe = new RegExp(RGB_FIND.source, 'gi');
  while ((m = rgbRe.exec(cssOrHtml))) bump(toHex(+m[1]!, +m[2]!, +m[3]!), 1);

  const hslRe = new RegExp(HSL_FIND.source, 'gi');
  while ((m = hslRe.exec(cssOrHtml))) bump(hslToHex(+m[1]!, +m[2]!, +m[3]!), 1);

  const oklchRe = new RegExp(OKLCH_FIND.source, 'gi');
  while ((m = oklchRe.exec(cssOrHtml))) bump(parseOklchArgs(m[1]!), 2.5);

  // shadcn space-HSL inside var declarations only
  const varHsl =
    /--[a-zA-Z0-9-]+\s*:\s*(\d{1,3}(?:\.\d+)?\s+\d{1,3}(?:\.\d+)?%?\s+\d{1,3}(?:\.\d+)?%?)\s*;/g;
  while ((m = varHsl.exec(cssOrHtml))) bump(parseColorToken(m[1]!), 4);

  // Exact CSS custom properties with color values (high weight = prefer exact brand tokens)
  const varColor =
    /--(?:primary|secondary|accent|brand|background|foreground|cta|theme|main|color-[\w-]+|brand-[\w-]+)\s*:\s*([^;!}]+)/gi;
  while ((m = varColor.exec(cssOrHtml))) bump(parseColorToken(m[1]!), 8);

  // Inline SVG brand marks
  const svgFill = /(?:fill|stroke)=["']([^"']+)["']/gi;
  while ((m = svgFill.exec(cssOrHtml))) {
    const hex = parseColorToken(m[1]!);
    if (hex && !isNearGray(hex) && saturation(hex) >= 0.2) bump(hex, 3);
  }

  // Inline style="…color…"
  const styleAttr = /style=["']([^"']+)["']/gi;
  while ((m = styleAttr.exec(cssOrHtml))) {
    const style = m[1]!;
    const bg = /background(?:-color)?\s*:\s*([^;]+)/i.exec(style)?.[1];
    const col = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(style)?.[1];
    if (bg) bump(parseColorToken(bg), 2);
    if (col) bump(parseColorToken(col), 1.5);
  }

  return counts;
}

function readCssVar(cssOrHtml: string, name: string): string | null {
  // Match `--name: value;` but not `--name-something:`
  const re = new RegExp(`--${name}\\s*:\\s*([^;!}]+)`, 'i');
  const m = re.exec(cssOrHtml);
  if (!m) return null;
  return parseColorToken(m[1] || '');
}

function extractRoleHints(cssOrHtml: string): Partial<BrandKitColors> {
  const out: Partial<BrandKitColors> = {};
  for (const { role, names } of ROLE_VAR_NAMES) {
    for (const name of names) {
      const parsed = readCssVar(cssOrHtml, name);
      if (parsed) {
        out[role] = parsed;
        break;
      }
    }
  }

  const theme =
    cssOrHtml.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    cssOrHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i)?.[1] ||
    cssOrHtml.match(
      /<meta[^>]+name=["']msapplication-TileColor["'][^>]+content=["']([^"']+)["']/i,
    )?.[1] ||
    cssOrHtml.match(
      /<meta[^>]+name=["']msapplication-navbutton-color["'][^>]+content=["']([^"']+)["']/i,
    )?.[1];
  const asBrandPrimary = (hex: string | null): boolean => {
    if (!hex) return false;
    // Browser chrome theme-colors are often pure black/white — not the logo hue
    const lum = luminance(hex);
    const sat = saturation(hex);
    if (lum < 0.08 || lum > 0.92) return false;
    if (sat < 0.12 && (lum < 0.2 || lum > 0.8)) return false;
    return sat >= 0.12 || (lum > 0.15 && lum < 0.75);
  };

  if (theme) {
    const hex = parseColorToken(theme);
    if (hex && asBrandPrimary(hex) && !out.primary) out.primary = hex;
    else if (hex && luminance(hex) > 0.85 && !out.background) out.background = hex;
    else if (hex && luminance(hex) < 0.12 && !out.background) out.background = hex;
  }

  // web app manifest snippet sometimes inlined
  const manifestTheme = cssOrHtml.match(/"theme_color"\s*:\s*"([^"]+)"/i)?.[1];
  if (manifestTheme) {
    const hex = parseColorToken(manifestTheme);
    if (hex && asBrandPrimary(hex) && !out.primary) out.primary = hex;
  }
  const manifestBg = cssOrHtml.match(/"background_color"\s*:\s*"([^"]+)"/i)?.[1];
  if (manifestBg) {
    const hex = parseColorToken(manifestBg);
    if (hex && !out.background) out.background = hex;
  }

  const bodyBg = cssOrHtml.match(
    /(?:body|html|:root)\s*\{[^}]*(?:background(?:-color)?)\s*:\s*([^;!}]+)/i,
  )?.[1];
  if (bodyBg && !out.background) {
    const hex = parseColorToken(bodyBg);
    if (hex) out.background = hex;
  }
  const bodyColor = cssOrHtml.match(/(?:body|html|:root)\s*\{[^}]*\bcolor\s*:\s*([^;!}]+)/i)?.[1];
  if (bodyColor && !out.text) {
    const hex = parseColorToken(bodyColor);
    if (hex) out.text = hex;
  }

  return out;
}

/**
 * Collect stylesheet URLs from HTML (link stylesheet, preload-as-style, @import,
 * and hashed Next/Vite CSS paths referenced in the document).
 */
export function extractStylesheetUrls(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const push = (href: string | undefined | null) => {
    if (!href) return;
    try {
      const abs = new URL(href, baseUrl).toString();
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(abs)) return;
      if (!/\.css(\?|$)/i.test(abs) && !/css/i.test(href) && !/_next\/static\/css/i.test(abs)) {
        return;
      }
      out.push(abs);
    } catch {
      // skip
    }
  };

  // <link rel="stylesheet" …> and <link rel="preload" as="style" …>
  const linkRe = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    const rel = (tag.match(/\brel=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    const as = (tag.match(/\bas=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (rel.includes('stylesheet') || as === 'style' || (rel.includes('preload') && as === 'style')) {
      push(href);
    }
  }

  const imp = /@import\s+(?:url\()?["']?([^"')]+)["']?\)?/gi;
  while ((m = imp.exec(html))) push(m[1]);

  // Hashed asset paths embedded in HTML / hydration payloads
  const assetCss =
    /(?:["'(])(\/_next\/static\/css\/[^"'()\s]+\.css(?:\?[^"'()\s]*)?|\/assets\/[^"'()\s]+\.css(?:\?[^"'()\s]*)?)/gi;
  while ((m = assetCss.exec(html))) push(m[1]);

  return [...new Set(out)].slice(0, 12);
}

export function buildPaletteFromCssSources(
  sources: string[],
  fallback: BrandKitColors,
): { colors: BrandKitColors; detected: number; rolesFromVars: number } {
  const mergedCounts = new Map<string, number>();
  const roleHints: Partial<BrandKitColors> = {};

  for (const src of sources) {
    const hints = extractRoleHints(src);
    for (const [k, v] of Object.entries(hints) as Array<[keyof BrandKitColors, string]>) {
      if (v && !roleHints[k]) roleHints[k] = v;
    }
    const counts = collectAllColors(src);
    for (const [hex, n] of counts) {
      mergedCounts.set(hex, (mergedCounts.get(hex) || 0) + n);
    }
  }

  const ranked = [...mergedCounts.entries()]
    .filter(([hex]) => !SOCIAL_BRAND_HEXES.has(hex) || (mergedCounts.get(hex) || 0) > 8)
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => hex);

  const detected = ranked.length;
  const rolesFromVars = Object.keys(roleHints).length;

  // Trust theme tokens when primary looks like a real brand hue (not chrome black/white).
  const primaryLooksBrand =
    !!roleHints.primary &&
    saturation(roleHints.primary) >= 0.12 &&
    luminance(roleHints.primary) > 0.08 &&
    luminance(roleHints.primary) < 0.92;

  if (primaryLooksBrand) {
    const primary = normalizeHex(roleHints.primary!, fallback.primary);
    const secondary = normalizeHex(
      roleHints.secondary || mixToward(primary, '#FFFFFF', 0.35),
      fallback.secondary,
    );
    const accent = normalizeHex(
      roleHints.accent ||
        ranked.find(
          (c) =>
            c !== primary &&
            saturation(c) >= 0.2 &&
            hueDistance(c, primary) > 20 &&
            !SOCIAL_BRAND_HEXES.has(c),
        ) ||
        primary,
      fallback.accent,
    );
    const background = normalizeHex(
      roleHints.background ||
        ranked.find((c) => luminance(c) > 0.85) ||
        ranked.find((c) => luminance(c) < 0.12) ||
        fallback.background,
      fallback.background,
    );
    let text = normalizeHex(
      roleHints.text || (luminance(background) > 0.5 ? '#111111' : '#F7F4EE'),
      fallback.text,
    );
    if (Math.abs(luminance(text) - luminance(background)) < 0.25) {
      text = luminance(background) > 0.5 ? '#111111' : '#F7F4EE';
    }
    return {
      colors: { primary, secondary, accent, background, text },
      detected,
      rolesFromVars,
    };
  }

  let background =
    roleHints.background ||
    ranked.find((c) => luminance(c) > 0.85) ||
    ranked.find((c) => luminance(c) < 0.12) ||
    fallback.background;

  let text =
    roleHints.text ||
    ranked
      .filter((c) => Math.abs(luminance(c) - luminance(background)) > 0.35)
      .sort(
        (a, b) =>
          Math.abs(luminance(b) - luminance(background)) -
          Math.abs(luminance(a) - luminance(background)),
      )[0] ||
    (luminance(background) > 0.5 ? '#111111' : '#F7F4EE');

  const brandCandidates = ranked
    .filter((c) => c !== background && c !== text)
    .filter((c) => !SOCIAL_BRAND_HEXES.has(c))
    .filter((c) => saturation(c) >= 0.18)
    .filter((c) => {
      const lum = luminance(c);
      return lum > 0.08 && lum < 0.88;
    })
    .filter((c) => Math.abs(luminance(c) - luminance(background)) > 0.1)
    .sort((a, b) => {
      const score = (hex: string) => {
        const sat = saturation(hex);
        const lum = luminance(hex);
        const mid = 1 - Math.abs(lum - 0.42) * 1.6;
        return sat * 3 + mid + (mergedCounts.get(hex) || 0) * 0.02;
      };
      return score(b) - score(a);
    });

  let primary =
    (roleHints.primary &&
    saturation(roleHints.primary) >= 0.08 &&
    luminance(roleHints.primary) < 0.92
      ? roleHints.primary
      : null) ||
    brandCandidates[0] ||
    ranked.find(
      (c) => !isNearGray(c) && c !== background && c !== text && !SOCIAL_BRAND_HEXES.has(c),
    ) ||
    fallback.primary;

  let accent =
    (roleHints.accent && saturation(roleHints.accent) >= 0.15 && luminance(roleHints.accent) < 0.9
      ? roleHints.accent
      : null) ||
    brandCandidates.find((c) => c !== primary && hueDistance(c, primary) > 25) ||
    brandCandidates.find((c) => c !== primary) ||
    primary;

  let secondary =
    (roleHints.secondary && saturation(roleHints.secondary) >= 0.08
      ? roleHints.secondary
      : null) ||
    brandCandidates.find((c) => c !== primary && c !== accent) ||
    (luminance(background) > 0.5
      ? mixToward(primary, '#000000', 0.35)
      : mixToward(primary, '#FFFFFF', 0.25));

  background = normalizeHex(background, fallback.background);
  text = normalizeHex(text, fallback.text);
  primary = normalizeHex(primary, fallback.primary);
  secondary = normalizeHex(secondary, fallback.secondary);
  accent = normalizeHex(accent, fallback.accent);

  if (Math.abs(luminance(text) - luminance(background)) < 0.25) {
    text = luminance(background) > 0.5 ? '#111111' : '#F7F4EE';
  }

  return {
    colors: { primary, secondary, accent, background, text },
    detected,
    rolesFromVars,
  };
}

function mixToward(hex: string, toward: string, t: number): string {
  const a = hex.replace('#', '');
  const b = toward.replace('#', '');
  const mix = (i: number) => {
    const x = parseInt(a.slice(i, i + 2), 16);
    const y = parseInt(b.slice(i, i + 2), 16);
    return clampByte(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${mix(0)}${mix(2)}${mix(4)}`.toUpperCase();
}

/** Merge CSS-detected palette with optional LLM hex suggestions (CSS wins when present). */
export function mergePaletteHints(
  cssPalette: BrandKitColors,
  llm: Partial<BrandKitColors> | null | undefined,
  fallback: BrandKitColors,
  cssDetectedCount: number,
): BrandKitColors {
  const useLlm = cssDetectedCount < 4;
  const pick = (role: keyof BrandKitColors) => {
    const fromCss = cssPalette[role];
    const fromLlm = llm?.[role] ? normalizeHex(llm[role], '') : '';
    if (!useLlm) return normalizeHex(fromCss, fallback[role]);
    if (fromLlm && fromLlm.length === 7) return fromLlm;
    return normalizeHex(fromCss, fallback[role]);
  };
  return {
    primary: pick('primary'),
    secondary: pick('secondary'),
    accent: pick('accent'),
    background: pick('background'),
    text: pick('text'),
  };
}
