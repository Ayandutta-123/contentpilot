import { ContentEngine } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { LLMService } from './llm.service';
import { executionLogService } from './execution-log.service';
import { assertGenerationActive } from './generation-abort.service';
import { preferOriginalLogoUrl } from '../lib/store-upload';
import { posterSpecFromJson, POSTER_ART_NEGATIVE } from './poster-spec.service';
import { POSTER_ICON_IDS, type PosterLayoutId, type PosterSpec } from '../providers/images/poster-frame';
import {
  clampSlideCount,
  type CarouselSlide,
} from '../lib/carousel-parse';
import {
  buildBrandContactChips,
  formatBrandContactLine,
  type BrandContactLinks,
} from '../lib/brand-contacts';
import {
  layoutPhotoComposition,
  layoutCopyDirection,
  layoutPillarBudget,
  pickCarouselLayouts,
  finalizeArtPrompt,
  LAYOUT_LABELS,
  carouselSlideRole,
  carouselArtPrefix,
  applyCarouselCopyContract,
} from './poster-layout-pick';

export type CarouselPostCopy = {
  headline: string;
  body: string;
  imagePrompt?: string | null;
  callToAction?: string | null;
};

export type GenerateCarouselSlidesInput = {
  tenantId: string;
  contentId: string;
  slideCount: number;
  company: string;
  brief: string;
  post: CarouselPostCopy;
  brandImageStyle?: string | null;
  companyName?: string | null;
  logoUrl?: string | null;
  brandType?: string | null;
  playId: string;
  source: string;
  visualStyleId?: string | null;
  engine?: ContentEngine;
  workflowStep?: string;
  /** Persist cover + templateSlots onto GeneratedContent (default true). */
  persist?: boolean;
  /**
   * Optional per-slide hero image URLs (exact uploads). When set for a slide index,
   * that art is used instead of generating a new photo — poster type still frames it.
   */
  heroImageUrls?: Array<string | null | undefined>;
  /** Brand kit contacts for the last-slide CTA strip (only filled fields are shown). */
  contacts?: BrandContactLinks | null;
};

export type GenerateCarouselSlidesResult = {
  slideCount: number;
  slides: CarouselSlide[];
  coverImageUrl: string;
  coverRawImageUrl: string | null;
  coverImagePrompt: string;
  templateSlots: Record<string, unknown>;
};

/**
 * @deprecated Prefer per-slide layouts from pickCarouselLayouts(). Kept as a
 * fallback id for older callers that still import a constant.
 */
export const CAROUSEL_POSTER_LAYOUT = 'hero_right' as const;

/**
 * Outline N designed-poster slides via LLM, render each with a VARIED layout
 * (not always hero_right), and store cover + templateSlots.carousel.
 */
export async function generateCarouselSlides(
  input: GenerateCarouselSlidesInput,
): Promise<GenerateCarouselSlidesResult> {
  const slideCount = clampSlideCount(input.slideCount);
  const llm = await LLMService.forTenant(input.tenantId);
  const { attachGeneratedImage } = await import('./image-attach.service');
  const { brandPosterFrame } = await import('../providers/images/poster-frame');
  const { SOCIAL_IMAGE_FORMATS } = await import('../providers/images/social-frame');

  const engine = input.engine || ContentEngine.CALENDAR;
  const workflowStep = input.workflowStep || 'carousel:slides';
  const isB2c = String(input.brandType || 'b2b').toLowerCase() === 'b2c';
  const visualStyleId =
    input.visualStyleId || (isB2c ? 'cinematic_photo' : 'professional_photo');
  const logoUrl = preferOriginalLogoUrl(input.logoUrl) || input.logoUrl || null;

  const contacts = input.contacts || {};
  const contactChips = buildBrandContactChips(contacts);
  const contactLine = formatBrandContactLine(contacts);

  const layouts = pickCarouselLayouts(
    slideCount,
    `${input.contentId}:${input.playId}:${input.brief.slice(0, 80)}`,
  );

  await executionLogService.log({
    tenantId: input.tenantId,
    contentId: input.contentId,
    workflowStep,
    engine,
    message: `Generating ${slideCount}-slide carousel (layouts: ${layouts.join(' → ')})`,
  });

  const layoutBrief = layouts
    .map((layout, i) => {
      const role = carouselSlideRole(i, layouts.length);
      const roleLine =
        role === 'cover'
          ? 'COVER: eyebrow + headline + one short subhead ONLY. No pillars, no stat, no callout, no closing card.'
          : role === 'close'
            ? 'CLOSE: CTA closingLine only. No pillars, no stat, no callout.'
            : `PROOF: ${layoutCopyDirection(layout)} Max pillars: ${layoutPillarBudget(layout, { isFirst: false, isLast: false })}.`;
      return `Slide ${i + 1} (${role}): layoutId="${layout}" (${LAYOUT_LABELS[layout] || layout}) — COPY: ${roleLine} PHOTO (never as layout jargon): ${carouselArtPrefix(role)} ${layoutPhotoComposition(layout)}`;
    })
    .join('\n');

  const outline = await llm.generateRawJson({
    systemPrompt: `Return JSON only. Art-direct a ${slideCount}-slide Instagram/LinkedIn carousel that looks like a real brand studio sequence (cover → proof → CTA), not three copies of one brochure.

CRITICAL: Each slide has TWO separate fields:
- Copy blocks (eyebrow, headline, pillars…) → SVG layout engine uses layoutId
- imagePrompt → PHOTO ONLY. NEVER mention typography, type columns, "negative space for text", left/right for type, layout names, or "bleeds in".

Shape: { "slides": [ {
  "layout": "exact layout id assigned below",
  "eyebrow": "2-4 word label or empty",
  "headline": "5-9 words",
  "headlineAccent": "EXACT substring of headline (2-4 words or a number)",
  "subhead": "one sentence, max 14 words — or empty",
  "pillars": [ { "icon": "allowed icon id", "title": "2-3 words", "text": "8-14 words MAX" } ],
  "statValue": "short metric — omit on cover and close; only if in the brief",
  "statLabel": "4-8 words",
  "calloutTitle": "empty on cover and close",
  "calloutBody": "empty on cover and close",
  "closingLine": "6-12 word CTA on LAST slide only; empty elsewhere",
  "imagePrompt": "2-3 sentences PHOTO ONLY: subject, setting, camera, darker light, brand-coloured grade",
  "artNegativePrompt": "comma separated bans"
} ] }

PER-SLIDE CONTRACT:
${layoutBrief}

Story rules:
- Cover = one bold claim. Sparse. Metrics belong on a later proof slide.
- Middle = one proof point. Vary camera angle. Never exceed max pillars.
- LAST = CTA only.
- Never invent stats/customers not in the brief.
- Premium feed — airy, thumbnail-legible, not a stacked PDF.
Allowed icons: ${POSTER_ICON_IDS.join(', ')}.
Every artNegativePrompt must include: ${POSTER_ART_NEGATIVE}`,
    userPrompt: `Brand: ${input.company}
Carousel topic (stay faithful):
${input.brief}

Feed caption headline: ${input.post.headline}
Feed caption body (context): ${input.post.body.slice(0, 500)}
Base visual direction: ${input.post.imagePrompt || 'professional brand photography'}
Desired closing CTA: ${input.post.callToAction || 'soft professional CTA'}
${contactLine ? `Brand contacts available for the LAST slide only (do not invent others): ${contactLine}` : 'No brand contacts configured — last slide closingLine only.'}

Produce ${slideCount} slides. imagePrompt = photography only; layout id is separate.`,
  });

  const rawSlides = Array.isArray(outline.slides) ? outline.slides : [];
  const planned: Array<{
    headline: string;
    imagePrompt: string;
    spec: PosterSpec;
    layout: PosterLayoutId;
  }> = [];

  for (let i = 0; i < slideCount; i++) {
    const layout = layouts[i] || 'hero_right';
    const role = carouselSlideRole(i, slideCount);
    const row =
      rawSlides[i] && typeof rawSlides[i] === 'object' && !Array.isArray(rawSlides[i])
        ? (rawSlides[i] as Record<string, unknown>)
        : {};
    const isLast = role === 'close';
    const isFirst = role === 'cover';
    const maxPillars = layoutPillarBudget(layout, { isFirst, isLast });
    const fallbackHeadline =
      i === 0 ? input.post.headline : `${input.post.headline} · ${i + 1}`;
    const fallbackArt = finalizeArtPrompt(
      `${carouselArtPrefix(role)} ${input.post.imagePrompt || input.post.headline}. Distinct composition from other slides. Photoreal editorial, no text in frame.`,
      layout,
    );

    if (isLast || maxPillars === 0) {
      delete row.pillars;
    } else if (Array.isArray(row.pillars) && row.pillars.length > maxPillars) {
      row.pillars = row.pillars.slice(0, maxPillars);
    }

    if (isFirst) {
      delete row.statValue;
      delete row.statLabel;
      delete row.calloutTitle;
      delete row.calloutBody;
      delete row.closingLine;
      delete row.pillars;
    }

    // Centre-stage / split-band: drop dense cards so type stays readable
    if (layout === 'center_stage' || layout === 'split_band') {
      if (!isLast) {
        delete row.calloutTitle;
        delete row.calloutBody;
      }
      if (maxPillars === 0) delete row.pillars;
    }

    let spec = posterSpecFromJson(
      { ...row, artPrompt: row.artPrompt ?? row.imagePrompt },
      {
        headline: fallbackHeadline,
        subhead: input.post.body.split(/(?<=[.!?])\s+/)[0]?.slice(0, 140) || '',
        closingLine: isLast
          ? input.post.callToAction || 'See what we can build together.'
          : '',
        artPrompt: fallbackArt,
      },
    );
    spec = applyCarouselCopyContract(spec, role, layout);
    spec.artPrompt = finalizeArtPrompt(
      `${carouselArtPrefix(role)} ${spec.artPrompt || fallbackArt}`,
      layout,
    );
    if (isLast && contactLine) {
      spec.footerNote = contactLine;
    }

    planned.push({
      headline: spec.headline,
      imagePrompt: spec.artPrompt || fallbackArt,
      spec,
      layout,
    });
  }

  const format = SOCIAL_IMAGE_FORMATS.instagram_square;

  const baseAttach = {
    brandImageStyle: input.brandImageStyle,
    companyName: input.companyName || input.company,
    logoUrl,
    creativeType: 'poster' as const,
    format: 'instagram_square' as const,
    overlay: { overlaysEnabled: true },
    visualStyleId,
    posterQuality: true,
    throwOnError: true,
  };

  const slides: CarouselSlide[] = [];
  for (let i = 0; i < planned.length; i++) {
    await assertGenerationActive(input.contentId);
    const slide = planned[i]!;
    const isLast = i === planned.length - 1;
    const exactHero = (input.heroImageUrls?.[i] || '').trim();

    let imageUrl = '';
    let rawImageUrl: string | null = null;

    if (exactHero) {
      const framed = await brandPosterFrame({
        tenantId: input.tenantId,
        imageUrl: exactHero,
        spec: slide.spec,
        companyName: input.companyName || input.company,
        logoUrl,
        brandImageStyle: input.brandImageStyle,
        layout: slide.layout,
        slideLabel: `${i + 1} / ${planned.length}`,
        contactChips: isLast ? contactChips : null,
        width: format.width,
        height: format.height,
      });
      imageUrl = framed.publicUrl;
      rawImageUrl = exactHero;
    } else {
      const attached = await attachGeneratedImage(
        input.tenantId,
        input.contentId,
        slide.imagePrompt,
        {
          ...baseAttach,
          posterSpec: slide.spec,
          posterLayout: slide.layout,
          slideLabel: `${i + 1} / ${planned.length}`,
          contactChips: isLast ? contactChips : null,
          negativePrompt: slide.spec.artNegativePrompt,
          contentBrief: `${slide.headline} — ${input.post.body.slice(0, 180)}`.slice(0, 420),
          savePrompt: false,
          skipPersist: true,
        },
      );
      if (!attached?.imageUrl) {
        throw new Error(`Carousel slide ${i + 1} failed to generate`);
      }
      imageUrl = attached.imageUrl;
      rawImageUrl = attached.rawImageUrl || null;
    }

    slides.push({
      index: i + 1,
      headline: slide.headline,
      imagePrompt: slide.imagePrompt,
      imageUrl,
      rawImageUrl,
      posterSpec: slide.spec as unknown as Record<string, unknown>,
      posterLayout: slide.layout,
    });
  }

  const cover = slides[0]!;
  const templateSlots: Record<string, unknown> = {
    playId: input.playId,
    source: input.source,
    format: 'carousel',
    posterSpec: planned[0]?.spec as unknown as Record<string, unknown>,
    posterLayout: planned[0]?.layout,
    layoutLabel: planned[0]?.layout ? LAYOUT_LABELS[planned[0].layout] : undefined,
    /** Separated prompts: art = photo model; layout = compositor id */
    prompts: {
      image: cover.imagePrompt,
      layout: planned[0]?.layout,
      layoutLabel: planned[0]?.layout ? LAYOUT_LABELS[planned[0].layout] : undefined,
    },
    carousel: {
      slideCount: slides.length,
      slides,
      contacts: contactChips,
      layouts,
    },
  };

  if (input.persist !== false) {
    await prisma.generatedContent.update({
      where: { id: input.contentId },
      data: {
        imageUrl: cover.imageUrl,
        rawImageUrl: cover.rawImageUrl || null,
        imagePrompt: cover.imagePrompt,
        templateSlots: templateSlots as object,
      },
    });
  }

  return {
    slideCount: slides.length,
    slides,
    coverImageUrl: cover.imageUrl,
    coverRawImageUrl: cover.rawImageUrl || null,
    coverImagePrompt: cover.imagePrompt,
    templateSlots,
  };
}
