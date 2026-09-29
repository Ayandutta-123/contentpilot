/**
 * Brand Kit — structured colors + typography stored on BrandSettings.
 * Modes control how strongly the kit is enforced when rendering posters / overlays.
 */

export type BrandKitMode = 'strict' | 'mix' | 'sometimes' | 'off';

export type BrandFontId = 'serif' | 'sans' | 'display' | 'modern';

export type BrandKitColors = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
};

export type BrandKitFonts = {
  heading: BrandFontId;
  body: BrandFontId;
};

export type BrandKit = {
  mode: BrandKitMode;
  colors: BrandKitColors;
  fonts: BrandKitFonts;
};

export const BRAND_KIT_MODES: Array<{ id: BrandKitMode; label: string; hint: string }> = [
  {
    id: 'strict',
    label: 'Brand only',
    hint: 'Always use your hex colors and fonts on posters — no free palette',
  },
  {
    id: 'mix',
    label: 'Mix & match',
    hint: 'Lead with brand colors, gently blend neutrals for contrast',
  },
  {
    id: 'sometimes',
    label: 'Sometimes',
    hint: 'About half the time use the brand kit; otherwise fall back to image style',
  },
  {
    id: 'off',
    label: 'Off',
    hint: 'Ignore the kit — parse colors from Image style text only',
  },
];

export const BRAND_FONT_OPTIONS: Array<{ id: BrandFontId; label: string }> = [
  { id: 'sans', label: 'Sans (clean)' },
  { id: 'serif', label: 'Serif (editorial)' },
  { id: 'modern', label: 'Modern UI' },
  { id: 'display', label: 'Display (bold)' },
];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function normalizeHex(raw: string | null | undefined, fallback: string): string {
  const s = (raw || '').trim();
  if (!s) return fallback;
  const withHash = s.startsWith('#') ? s : `#${s}`;
  if (!HEX_RE.test(withHash)) return fallback;
  if (withHash.length === 4) {
    const h = withHash.slice(1);
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase();
  }
  return withHash.toUpperCase();
}

export function isBrandFontId(v: unknown): v is BrandFontId {
  return v === 'serif' || v === 'sans' || v === 'display' || v === 'modern';
}

export function isBrandKitMode(v: unknown): v is BrandKitMode {
  return v === 'strict' || v === 'mix' || v === 'sometimes' || v === 'off';
}

export function defaultBrandKit(): BrandKit {
  return {
    mode: 'mix',
    colors: {
      primary: '#0B1F3A',
      secondary: '#1E3A5F',
      accent: '#E23A2E',
      background: '#0B1220',
      text: '#F7F4EE',
    },
    fonts: {
      heading: 'modern',
      body: 'sans',
    },
  };
}

/** Read kit fields from a BrandSettings-like row (Prisma or API payload). */
export function brandKitFromSettings(row: {
  brandKitMode?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  textColor?: string | null;
  headingFont?: string | null;
  bodyFont?: string | null;
} | null | undefined): BrandKit {
  const d = defaultBrandKit();
  if (!row) return d;
  return {
    mode: isBrandKitMode(row.brandKitMode) ? row.brandKitMode : d.mode,
    colors: {
      primary: normalizeHex(row.primaryColor, d.colors.primary),
      secondary: normalizeHex(row.secondaryColor, d.colors.secondary),
      accent: normalizeHex(row.accentColor, d.colors.accent),
      background: normalizeHex(row.backgroundColor, d.colors.background),
      text: normalizeHex(row.textColor, d.colors.text),
    },
    fonts: {
      heading: isBrandFontId(row.headingFont) ? row.headingFont : d.fonts.heading,
      body: isBrandFontId(row.bodyFont) ? row.bodyFont : d.fonts.body,
    },
  };
}

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

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const lin = [rgb.r, rgb.g, rgb.b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  if (!A || !B) return a;
  const u = Math.min(1, Math.max(0, t));
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(Math.round(A.r + (B.r - A.r) * u))}${h(Math.round(A.g + (B.g - A.g) * u))}${h(
    Math.round(A.b + (B.b - A.b) * u),
  )}`.toUpperCase();
}

export type ResolvedBrandPalette = {
  ground: string;
  ink: string;
  muted: string;
  accent: string;
  panel: string;
  onAccent: string;
  /** True when kit colors were applied for this render. */
  applied: boolean;
};

/**
 * Decide whether to apply the kit for this render.
 * `sometimes` is deterministic per seed so reframe stays consistent.
 */
export function shouldApplyBrandKit(mode: BrandKitMode, seed?: string | null): boolean {
  if (mode === 'off') return false;
  if (mode === 'strict' || mode === 'mix') return true;
  // sometimes ≈ 50% based on seed (content id) or random when no seed
  if (!seed) return Math.random() < 0.5;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 2 === 0;
}

/**
 * Build a poster/insight palette from the Brand Kit.
 * strict = exact brand hexes (with contrast fixes for ink/onAccent only).
 * mix = brand-led with soft neutral blends for panels/muted.
 */
export function resolveBrandKitPalette(
  kit: BrandKit,
  opts?: { seed?: string | null; fallbackStyleText?: string | null },
): ResolvedBrandPalette | null {
  if (!shouldApplyBrandKit(kit.mode, opts?.seed)) return null;

  const { primary, secondary, accent, background, text } = kit.colors;
  const ground = normalizeHex(background, primary);
  let ink = normalizeHex(text, luminance(ground) < 0.45 ? '#F7F4EE' : '#111827');
  // Contrast safety: if ink is too close to ground, flip it.
  if (Math.abs(luminance(ink) - luminance(ground)) < 0.2) {
    ink = luminance(ground) < 0.45 ? '#F7F4EE' : '#111827';
  }
  const accentHex = normalizeHex(accent, secondary);
  const onAccent = luminance(accentHex) < 0.45 ? '#FFFFFF' : '#12100B';

  if (kit.mode === 'strict') {
    return {
      ground,
      ink,
      muted: mixHex(ink, ground, 0.35),
      accent: accentHex,
      panel: mixHex(ground, ink, 0.1),
      onAccent,
      applied: true,
    };
  }

  // mix: lead with brand, soften edges
  return {
    ground: mixHex(ground, primary, 0.35),
    ink,
    muted: mixHex(ink, ground, 0.4),
    accent: accentHex,
    panel: mixHex(ground, secondary, 0.25),
    onAccent,
    applied: true,
  };
}

/** Short line for image-model prompts so art respects brand hexes when kit is on. */
export function brandKitArtStyleLine(kit: BrandKit, applied: boolean): string {
  if (!applied || kit.mode === 'off') return '';
  const { primary, secondary, accent, background } = kit.colors;
  if (kit.mode === 'strict') {
    return `Brand palette only: ground ${background}, primary ${primary}, secondary ${secondary}, accent ${accent}. Do not introduce unrelated brand colours.`;
  }
  return `Lead with brand colours ${primary}, ${secondary}, accent ${accent} on ground ${background}; restrained complementary neutrals OK.`;
}
