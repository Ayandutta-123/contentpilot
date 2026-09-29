/**
 * Auto layout selection for Calendar / Carousel designed posters.
 *
 * IMPORTANT separation of concerns:
 * - `posterLayout` → SVG compositor geometry (stored separately)
 * - `artPrompt` → photo-only prompt for fal / image models (never mention type/layout)
 * - `layoutCopyDirection` → LLM copy density rules only (never sent to image model)
 */

import type { PosterLayoutId, PosterSpec } from '../providers/images/poster-frame';
import { POSTER_LAYOUTS } from '../providers/images/poster-frame';

/** Layouts safe for auto Calendar/Carousel (no sale masters / uploads). */
export const AUTO_POSTER_LAYOUTS: PosterLayoutId[] = [
  'hero_right',
  'hero_top',
  'editorial_left',
  'center_stage',
  'split_band',
];

/**
 * Soft photography composition for the IMAGE MODEL only.
 * Never mentions typography, layout engines, type columns, or "for text".
 */
const LAYOUT_PHOTO_COMPOSITION: Record<PosterLayoutId, string> = {
  hero_right:
    'Subject weighted to the right half; left half slightly darker and calmer. No blown-out white hotspot. Editorial magazine crop.',
  hero_top:
    'Subject in the top third. Lower half of the photo underexposed and uncluttered so a type band can sit under it. No bright centre glow.',
  editorial_left:
    'Subject weighted to the left; right half quieter and a stop darker. Tall portrait-leaning crop. No blown highlights.',
  center_stage:
    'Dark cinematic scene, exposure pulled down two stops, no blown centre, deep shadows, uncluttered middle. Moody, not a lit notepad.',
  split_band:
    'Subject lives in the upper half only. Lower third of the photograph is calm, slightly underexposed, almost empty. No busy detail at the bottom.',
  sale_circles: 'Subject clear and centred for circular crop.',
  sale_split: 'Subject on the right half; clean left edge.',
  uploaded_master: 'Subject clear in the photo region of the plate.',
};

/** Copy-density rules for the LLM — compositor only, never append to artPrompt. */
const LAYOUT_COPY_HINT: Record<PosterLayoutId, string> = {
  hero_right:
    'Eyebrow + headline + short subhead. At most 2 short pillars OR a stat+callout — never all three. Premium whitespace.',
  hero_top:
    'Headline under the photo band. Prefer 0–2 pillars. Short closing line. Airy spacing.',
  editorial_left:
    'Narrow type column — 0–2 pillars as rows. Skip wide callout cards if crowded.',
  center_stage:
    'Bold centred claim. Prefer 0 pillars. Optional one big stat. No multi-column cards.',
  split_band:
    'Strong headline + subhead in the lower band. Prefer 0 pillars. Optional stat. Short CTA.',
  sale_circles: 'Minimal copy for sale circles.',
  sale_split: 'Minimal copy for sale split.',
  uploaded_master: 'Only fill slots the master plate exposes.',
};

/** Human-readable layout labels for stored meta / UI. */
export const LAYOUT_LABELS: Record<PosterLayoutId, string> = {
  hero_right: 'Hero right · type left',
  hero_top: 'Hero top · type below',
  editorial_left: 'Editorial · photo left',
  center_stage: 'Centre stage · full bleed',
  split_band: 'Split band · keyline',
  sale_circles: 'Sale circles',
  sale_split: 'Sale split',
  uploaded_master: 'Uploaded master',
};

/** Phrases that must never reach the image model (layout leaks). */
const LAYOUT_LEAK_RE =
  /\b(hero photo bleeds?|for typography|for type|type column|layout engine|headline \+|cards underneath|calm negative space on the (left|right) for|leave calm negative space|typography\.|stacked type|type is centred|type is centered|solid type band|colour keyline|color keyline|capabilities poster|icon cards?)\b/gi;

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function isAutoPosterLayout(id: string | null | undefined): id is PosterLayoutId {
  return !!id && (AUTO_POSTER_LAYOUTS as string[]).includes(id);
}

/** @deprecated Use layoutPhotoComposition — kept so older imports compile. */
export function layoutArtDirection(layout: PosterLayoutId): string {
  return layoutPhotoComposition(layout);
}

/** Photo-only composition hint for fal / image models. */
export function layoutPhotoComposition(layout: PosterLayoutId): string {
  return LAYOUT_PHOTO_COMPOSITION[layout] || LAYOUT_PHOTO_COMPOSITION.hero_right;
}

/** LLM copy rules — never sent to the image model. */
export function layoutCopyDirection(layout: PosterLayoutId): string {
  return LAYOUT_COPY_HINT[layout] || LAYOUT_COPY_HINT.hero_right;
}

/**
 * Strip compositor / typography instructions that leaked into an art prompt.
 * Then optionally append a soft photo composition line (no type jargon).
 */
export function finalizeArtPrompt(
  raw: string,
  layout: PosterLayoutId,
  opts?: { appendComposition?: boolean },
): string {
  let s = (raw || '').trim();

  // Drop whole sentences that are layout/compositor instructions
  s = s
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      const t = sentence.toLowerCase();
      if (!t.trim()) return false;
      if (/\b(typography|type column|layout engine|icon cards?|capabilities poster)\b/.test(t))
        return false;
      if (/\bbleeds?\b/.test(t) && /\b(right|left|top|bottom)\b/.test(t)) return false;
      if (/\bnegative space\b/.test(t) && /\b(type|typography|text|cards|left|right)\b/.test(t))
        return false;
      if (/\bfor (type|typography|text|cards)\b/.test(t)) return false;
      if (/^(hero photo|leave calm|layout id|compositor)\b/.test(t)) return false;
      return true;
    })
    .join(' ')
    .replace(LAYOUT_LEAK_RE, ' ')
    .replace(/\b(in from the (RIGHT|LEFT|TOP|BOTTOM)|on the (LEFT|RIGHT)(?:\s+for\s+\w+)?)\b\.?/gi, ' ')
    .replace(/\bfor the skyline,\s*type\.?/gi, 'for the skyline.')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/^[,.\s]+|[,.\s]+$/g, '')
    .trim();

  if (opts?.appendComposition !== false) {
    const comp = layoutPhotoComposition(layout);
    if (comp && !s.toLowerCase().includes(comp.slice(0, 28).toLowerCase())) {
      s = s ? `${s.replace(/\.*$/, '.') } ${comp}` : comp;
    }
  }
  return s.replace(/\s{2,}/g, ' ').trim();
}

/** Max icon pillars that fit this geometry without truncating. */
export function layoutPillarBudget(
  layout: PosterLayoutId,
  opts?: { isFirst?: boolean; isLast?: boolean },
): 0 | 1 | 2 | 3 {
  if (opts?.isLast) return 0;
  if (opts?.isFirst) return 0;
  if (layout === 'center_stage' || layout === 'split_band') return 0;
  if (layout === 'editorial_left') return 2;
  if (layout === 'hero_top') return 2;
  return 2;
}

export function pickSinglePosterLayout(seed: string): PosterLayoutId {
  const pool = AUTO_POSTER_LAYOUTS.filter((id) => POSTER_LAYOUTS[id]);
  const idx = hashSeed(seed || 'poster') % pool.length;
  return pool[idx]!;
}

/** Cover / proof / close — Instagram carousels are three jobs, not one repeated poster. */
export type CarouselSlideRole = 'cover' | 'proof' | 'close';

/** Type sits on a solid/split plate — never full-bleed photo behind the cover headline. */
export const CAROUSEL_COVER_LAYOUTS: PosterLayoutId[] = ['split_band', 'hero_top', 'editorial_left'];
/** Proof slides: photo beside or above type, not a title over a hotspot. */
export const CAROUSEL_PROOF_LAYOUTS: PosterLayoutId[] = ['hero_right', 'editorial_left', 'hero_top'];
/** Closing CTA: type band for the ask, not a giant stat card over a photo. */
export const CAROUSEL_CLOSE_LAYOUTS: PosterLayoutId[] = ['split_band', 'hero_top', 'editorial_left'];

export function pickCarouselLayouts(slideCount: number, seed = 'carousel'): PosterLayoutId[] {
  const n = Math.max(2, Math.min(10, Math.round(slideCount) || 5));
  const h = hashSeed(seed);
  const out: PosterLayoutId[] = [];
  out.push(CAROUSEL_COVER_LAYOUTS[h % CAROUSEL_COVER_LAYOUTS.length]!);

  for (let i = 1; i < n - 1; i++) {
    let pick = CAROUSEL_PROOF_LAYOUTS[(h + i * 31 + seed.length * 7) % CAROUSEL_PROOF_LAYOUTS.length]!;
    if (pick === out[i - 1] && CAROUSEL_PROOF_LAYOUTS.length > 1) {
      pick = CAROUSEL_PROOF_LAYOUTS[(h + i * 31 + 3) % CAROUSEL_PROOF_LAYOUTS.length]!;
    }
    if (out.includes(pick) && CAROUSEL_PROOF_LAYOUTS.length > out.length) {
      const unused = CAROUSEL_PROOF_LAYOUTS.find((l) => !out.includes(l));
      if (unused) pick = unused;
    }
    out.push(pick);
  }

  let last = CAROUSEL_CLOSE_LAYOUTS[(h + 97 + n) % CAROUSEL_CLOSE_LAYOUTS.length]!;
  if (n > 1 && last === out[n - 2]) {
    last = CAROUSEL_CLOSE_LAYOUTS[(h + 98 + n) % CAROUSEL_CLOSE_LAYOUTS.length]!;
  }
  out.push(last);
  return out.slice(0, n);
}

export function carouselSlideRole(index: number, total: number): CarouselSlideRole {
  if (index <= 0) return 'cover';
  if (index >= Math.max(1, total - 1)) return 'close';
  return 'proof';
}

/** Front-load for Flux (it truncates the tail). */
export function carouselArtPrefix(role: CarouselSlideRole): string {
  if (role === 'cover') {
    return 'Premium Instagram carousel COVER photograph: darker editorial still, no blown-out centre, no stock handshake, colour-grade toward the brand hexes.';
  }
  if (role === 'close') {
    return 'Premium carousel CLOSING photograph: calm darker scene, empty lower band, colour-grade toward the brand hexes.';
  }
  return 'Premium carousel PROOF photograph: a new camera angle in the same brand world, darker mid-tones, quiet edges.';
}

/**
 * Hard copy contract so the compositor cannot dump a "4 files" card on the cover.
 * Prompt rules are not enough — the LLM still invents stats.
 */
export function applyCarouselCopyContract(
  spec: PosterSpec,
  role: CarouselSlideRole,
  layout: PosterLayoutId,
): PosterSpec {
  const next: PosterSpec = {
    ...spec,
    pillars: [...(spec.pillars || [])],
  };

  const clipSubhead = (s: string | undefined, words: number) => {
    const parts = (s || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length <= words) return s || '';
    return parts.slice(0, words).join(' ');
  };

  if (role === 'cover') {
    next.pillars = [];
    next.statValue = '';
    next.statLabel = '';
    next.calloutTitle = '';
    next.calloutBody = '';
    next.closingLine = '';
    next.footerNote = '';
    next.subhead = clipSubhead(next.subhead, 16);
    return next;
  }

  if (role === 'close') {
    next.pillars = [];
    next.statValue = '';
    next.statLabel = '';
    next.calloutTitle = '';
    next.calloutBody = '';
    return next;
  }

  const max = layoutPillarBudget(layout, { isFirst: false, isLast: false });
  if ((next.pillars?.length || 0) > max) next.pillars = (next.pillars || []).slice(0, max);
  if (layout === 'center_stage' || layout === 'split_band') {
    next.pillars = [];
    next.calloutTitle = '';
    next.calloutBody = '';
  }
  // One extra block only — never pillars + stat + callout together
  if ((next.pillars?.length || 0) > 0 && next.statValue) {
    next.calloutTitle = '';
    next.calloutBody = '';
  }
  return next;
}

export function resolvePosterLayout(
  preferred: string | null | undefined,
  fallbackSeed: string,
): PosterLayoutId {
  if (isAutoPosterLayout(preferred)) return preferred;
  return pickSinglePosterLayout(fallbackSeed);
}
