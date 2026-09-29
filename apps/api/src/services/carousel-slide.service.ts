import { prisma } from '../lib/prisma';
import { preferOriginalLogoUrl, storeOriginalImage } from '../lib/store-upload';
import { extractCarouselPayload } from '../lib/carousel-parse';
import { CAROUSEL_POSTER_LAYOUT } from './carousel-generate.service';
import { buildBrandContactChips } from '../lib/brand-contacts';
import type { PosterSpec, PosterLayoutId } from '../providers/images/poster-frame';

function asPosterSpec(raw: unknown): PosterSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as PosterSpec;
}

async function persistCarouselSlides(
  contentId: string,
  slides: NonNullable<ReturnType<typeof extractCarouselPayload>>['slides'],
  extraSlots?: Record<string, unknown>,
) {
  const content = await prisma.generatedContent.findUnique({ where: { id: contentId } });
  if (!content) throw new Error('Content not found');
  const cover = slides[0];
  const base =
    content.templateSlots && typeof content.templateSlots === 'object' && !Array.isArray(content.templateSlots)
      ? { ...(content.templateSlots as Record<string, unknown>) }
      : {};
  const next = {
    ...base,
    ...extraSlots,
    format: 'carousel',
    posterLayout: cover?.posterLayout || base.posterLayout || CAROUSEL_POSTER_LAYOUT,
    posterSpec: cover?.posterSpec || base.posterSpec,
    carousel: {
      ...((base.carousel && typeof base.carousel === 'object' ? base.carousel : {}) as object),
      slideCount: slides.length,
      slides,
    },
  };
  await prisma.generatedContent.update({
    where: { id: contentId },
    data: {
      imageUrl: cover?.imageUrl || content.imageUrl,
      rawImageUrl: cover?.rawImageUrl || content.rawImageUrl,
      imagePrompt: cover?.imagePrompt || content.imagePrompt,
      templateSlots: next as object,
      revisionCount: { increment: 1 },
    },
  });
}

/** Replace one carousel slide's hero photo with an uploaded image; keep typography. */
export async function replaceCarouselSlideImage(opts: {
  tenantId: string;
  contentId: string;
  slideIndex: number; // 0-based
  buffer: Buffer;
  filename: string;
  mimetype: string;
}) {
  const content = await prisma.generatedContent.findFirst({
    where: { id: opts.contentId, tenantId: opts.tenantId, deletedAt: null },
  });
  if (!content) throw new Error('Content not found');
  const carousel = extractCarouselPayload(content.templateSlots);
  if (!carousel?.slides.length) throw new Error('This post is not a carousel');
  if (opts.slideIndex < 0 || opts.slideIndex >= carousel.slides.length) {
    throw new Error(`Slide index out of range (0–${carousel.slides.length - 1})`);
  }

  const stored = await storeOriginalImage({
    tenantId: opts.tenantId,
    subdir: 'carousel-heroes',
    buffer: opts.buffer,
    originalFilename: opts.filename,
    mimetype: opts.mimetype,
    logLabel: 'carousel-slide-replace',
  });

  const brand = await prisma.brandSettings.findUnique({ where: { tenantId: opts.tenantId } });
  const { brandPosterFrame } = await import('../providers/images/poster-frame');
  const { SOCIAL_IMAGE_FORMATS } = await import('../providers/images/social-frame');
  const slide = carousel.slides[opts.slideIndex];
  const spec = asPosterSpec(slide.posterSpec);
  if (!spec) throw new Error('Slide has no poster layout to reframe — regenerate the carousel first.');

  const isLast = opts.slideIndex === carousel.slides.length - 1;
  const contacts = buildBrandContactChips({
    websiteUrl: brand?.websiteUrl,
    contactEmail: brand?.contactEmail,
    instagramUrl: brand?.instagramUrl,
    facebookUrl: brand?.facebookUrl,
    linkedinUrl: brand?.linkedinUrl,
    twitterUrl: brand?.twitterUrl,
  });

  const framed = await brandPosterFrame({
    tenantId: opts.tenantId,
    imageUrl: stored.publicUrl,
    spec,
    companyName: brand?.companyName,
    logoUrl: preferOriginalLogoUrl(brand?.logoUrl) || brand?.logoUrl,
    brandImageStyle: brand?.imageStyle,
    layout: (slide.posterLayout as PosterLayoutId) || CAROUSEL_POSTER_LAYOUT,
    slideLabel: `${opts.slideIndex + 1} / ${carousel.slides.length}`,
    contactChips: isLast ? contacts : null,
    width: SOCIAL_IMAGE_FORMATS.instagram_square.width,
    height: SOCIAL_IMAGE_FORMATS.instagram_square.height,
  });

  const slides = carousel.slides.map((s, i) =>
    i === opts.slideIndex
      ? {
          ...s,
          imageUrl: framed.publicUrl,
          rawImageUrl: stored.publicUrl,
          posterLayout: s.posterLayout || CAROUSEL_POSTER_LAYOUT,
        }
      : s,
  );
  await persistCarouselSlides(opts.contentId, slides);
  return { slideIndex: opts.slideIndex, imageUrl: framed.publicUrl, rawImageUrl: stored.publicUrl };
}

/** Regenerate ONLY the hero art for one slide via AI prompt; keep typography / layout. */
export async function regenerateCarouselSlideArt(opts: {
  tenantId: string;
  contentId: string;
  slideIndex: number;
  prompt: string;
  exact?: boolean;
}) {
  const content = await prisma.generatedContent.findFirst({
    where: { id: opts.contentId, tenantId: opts.tenantId, deletedAt: null },
  });
  if (!content) throw new Error('Content not found');
  const carousel = extractCarouselPayload(content.templateSlots);
  if (!carousel?.slides.length) throw new Error('This post is not a carousel');
  if (opts.slideIndex < 0 || opts.slideIndex >= carousel.slides.length) {
    throw new Error(`Slide index out of range (0–${carousel.slides.length - 1})`);
  }

  const brand = await prisma.brandSettings.findUnique({ where: { tenantId: opts.tenantId } });
  const slide = carousel.slides[opts.slideIndex];
  const spec = asPosterSpec(slide.posterSpec);
  if (!spec) throw new Error('Slide has no poster layout — regenerate the carousel first.');

  const isLast = opts.slideIndex === carousel.slides.length - 1;
  const contacts = buildBrandContactChips({
    websiteUrl: brand?.websiteUrl,
    contactEmail: brand?.contactEmail,
    instagramUrl: brand?.instagramUrl,
    facebookUrl: brand?.facebookUrl,
    linkedinUrl: brand?.linkedinUrl,
    twitterUrl: brand?.twitterUrl,
  });

  const prompt = opts.prompt.trim();
  if (prompt.length < 4) throw new Error('Enter a prompt for the hero photo area');

  const nextSpec: PosterSpec = {
    ...spec,
    artPrompt: prompt,
  };

  const { attachGeneratedImage } = await import('./image-attach.service');
  const attached = await attachGeneratedImage(opts.tenantId, opts.contentId, prompt, {
    creativeType: 'poster',
    posterSpec: nextSpec,
    posterLayout: (slide.posterLayout as PosterLayoutId) || CAROUSEL_POSTER_LAYOUT,
    format: 'instagram_square',
    posterQuality: !opts.exact,
    slideLabel: `${opts.slideIndex + 1} / ${carousel.slides.length}`,
    contactChips: isLast ? contacts : null,
    companyName: brand?.companyName,
    logoUrl: preferOriginalLogoUrl(brand?.logoUrl) || brand?.logoUrl,
    brandImageStyle: brand?.imageStyle,
    contentBrief: opts.exact ? null : `${slide.headline}`.slice(0, 420),
    savePrompt: false,
    skipPersist: true,
    throwOnError: true,
    overlay: { overlaysEnabled: true },
  });

  if (!attached?.imageUrl) throw new Error('Slide art generation failed');

  const slides = carousel.slides.map((s, i) =>
    i === opts.slideIndex
      ? {
          ...s,
          imageUrl: attached.imageUrl,
          rawImageUrl: attached.rawImageUrl || null,
          imagePrompt: prompt,
          posterSpec: nextSpec as unknown as Record<string, unknown>,
          posterLayout: s.posterLayout || CAROUSEL_POSTER_LAYOUT,
        }
      : s,
  );
  await persistCarouselSlides(opts.contentId, slides);
  return {
    slideIndex: opts.slideIndex,
    imageUrl: attached.imageUrl,
    rawImageUrl: attached.rawImageUrl || null,
    imagePrompt: prompt,
  };
}
