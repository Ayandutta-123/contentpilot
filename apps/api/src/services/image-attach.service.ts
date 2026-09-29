import { ExecutionStatus } from '@contentpilot/shared';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { resolveProviders } from './providers.service';
import { generateContentImage } from '../providers/images/fal.provider';
import {
  brandSocialFrame,
  buildSocialImagePrompt,
  insightSocialFrame,
  newsletterSocialFrame,
  resolveVisualStylePrompt,
  SOCIAL_IMAGE_FORMATS,
  OVERLAY_FONTS,
  type InsightReportContent,
  type LogoPlacement,
  type NewsletterEditionContent,
  type OverlayStyleOpts,
  type SocialImageFormat,
} from '../providers/images/social-frame';
import { executionLogService } from './execution-log.service';
import { config } from '../config';
import { ProviderCreditError, isProviderCreditError } from '../lib/provider-credits';
import { preferOriginalLogoUrl } from '../lib/store-upload';
import {
  brandPosterFrame,
  type PosterLayoutId,
  type PosterSpec,
} from '../providers/images/poster-frame';
import {
  brandKitArtStyleLine,
  brandKitFromSettings,
  resolveBrandKitPalette,
} from '../lib/brand-kit';
import {
  explainMissingPremium,
  ImageModelUnavailableError,
  isHighEndModel,
  nextFallbackProviders,
  routeForGeneration,
  type ArtRole,
  type RouteContext,
  type RouteDecision,
} from './smart-image-router.service';
import type { ResolvedProviders } from './providers.service';

async function resolveBrandKitVisuals(
  tenantId: string,
  contentId: string,
  brandImageStyle?: string | null,
): Promise<{
  palette?: {
    ground: string;
    ink: string;
    muted: string;
    accent: string;
    panel: string;
    onAccent: string;
  };
  headingFontCss?: string;
  bodyFontCss?: string;
  artStyleLine: string;
  kitApplied: boolean;
}> {
  const row = await prisma.brandSettings.findUnique({ where: { tenantId } });
  const kit = brandKitFromSettings(row);
  const resolved = resolveBrandKitPalette(kit, {
    seed: contentId,
    fallbackStyleText: brandImageStyle || row?.imageStyle,
  });
  if (!resolved) {
    return { artStyleLine: '', kitApplied: false };
  }
  const { applied: _a, ...palette } = resolved;
  void _a;
  return {
    palette,
    headingFontCss: OVERLAY_FONTS[kit.fonts.heading].css,
    bodyFontCss: OVERLAY_FONTS[kit.fonts.body].css,
    artStyleLine: brandKitArtStyleLine(kit, true),
    kitApplied: true,
  };
}

export type AttachImageOpts = {
  format?: SocialImageFormat;
  /** Use the prompt exactly — do not force a default photo style */
  exact?: boolean;
  brandImageStyle?: string | null;
  companyName?: string | null;
  logoUrl?: string | null;
  /** Persist prompt onto the content row */
  savePrompt?: boolean;
  /** When true, surface provider errors to the caller instead of swallowing */
  throwOnError?: boolean;
  /** Skip logo/social frame — return raw AI art (for brand-template hero slots) */
  rawOnly?: boolean;
  /** Visual style preset id (illustration, vector, photo, …) */
  visualStyleId?: string | null;
  /** Apply finished-poster + brand feed art-direction guardrails to the prompt */
  posterQuality?: boolean;
  logoPlacement?: LogoPlacement;
  headerText?: string | null;
  footerCta?: string | null;
  overlay?: OverlayStyleOpts;
  /** Optional headline/body grounding so art matches the post */
  contentBrief?: string | null;
  /** Brand reference — style-lock / img2img */
  referenceImageUrl?: string | null;
  /** Edit the reference/source image instead of creating a fresh composition. */
  editMode?: boolean;
  /**
   * social = logo+headline overlay | newsletter = edition page
   * insight = designed report poster | poster = designed brand poster (hero art + type + icon pillars)
   * fal_full_poster = typography model bakes text; real logo stamped after (no SVG overlay)
   */
  creativeType?: 'social' | 'newsletter' | 'insight' | 'poster' | 'fal_full_poster';
  /** Exact on-image copy + scene for fal_full_poster */
  bakeBrief?: import('./baked-poster.service').BakeBrief | null;
  /** Force router capability (baked posters → typography_native). */
  forceCapability?: import('./smart-image-router.service').ImageCapability | null;
  /** Layout brief for creativeType 'poster'. */
  posterSpec?: PosterSpec | null;
  /** Poster layout variant. */
  posterLayout?: PosterLayoutId;
  /** Effective fill engine when posterLayout is uploaded_master. */
  fillLayout?: PosterLayoutId;
  /** Uploaded finished plate URL. */
  sourceImageUrl?: string | null;
  /** Carousel badge, e.g. "2 / 4". */
  slideLabel?: string | null;
  /** Last-slide contact chips from Brand Kit. */
  contactChips?: Array<{ label: string; value: string }> | null;
  /** Things the image model must not draw. */
  negativePrompt?: string | null;
  /** Supporting copy rendered into the newsletter card. */
  bodyText?: string | null;
  /** Small newsletter category above the headline. */
  eyebrow?: string | null;
  /** Structured multi-section newsletter edition (preferred). */
  newsletterEdition?: NewsletterEditionContent | null;
  /** Structured blocks for insightSocialFrame (calendar Full AI / AI Assistant). */
  insightReport?: InsightReportContent | null;
  /** Generate + frame but do not write imageUrl onto the content row (carousel slides). */
  skipPersist?: boolean;
  /** AI Assistant play id — feeds the smart image router. */
  playId?: string | null;
  /** Locked poster template id. */
  posterTemplateId?: string | null;
  designSource?: 'template' | 'brand_template' | 'ai' | null;
  artRole?: ArtRole | null;
  /** auto (default) classifies; manual pins Settings / modelOverride. */
  routingMode?: 'auto' | 'manual';
  modelOverride?: string | null;
  chatHistory?: Array<{ role: string; content: string }>;
};

async function downloadArtToUploads(tenantId: string, remoteUrl: string): Promise<string> {
  if (remoteUrl.startsWith('/uploads/') || remoteUrl.startsWith('data:')) return remoteUrl;
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`Could not download generated image (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = path.resolve(config.UPLOAD_DIR, tenantId, 'ai-art');
  fs.mkdirSync(dir, { recursive: true });
  const ext = /\.jpe?g/i.test(remoteUrl) ? 'jpg' : /\.webp/i.test(remoteUrl) ? 'webp' : 'png';
  const filename = `art-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), buf);
  return `/uploads/${tenantId}/ai-art/${filename}`;
}

function buildRouteContext(
  prompt: string,
  opts: AttachImageOpts,
  providers: ResolvedProviders,
): RouteContext {
  const artRole: ArtRole | null | undefined =
    opts.artRole ||
    (opts.creativeType === 'fal_full_poster'
      ? 'final_with_text'
      : opts.creativeType === 'poster' || opts.posterTemplateId || opts.posterSpec
        ? 'hero_under_svg'
        : opts.creativeType === 'social' || opts.creativeType === 'newsletter' || opts.creativeType === 'insight'
          ? 'hero_under_svg'
          : opts.rawOnly
            ? 'raw'
            : undefined);

  const routingMode =
    opts.routingMode ||
    providers.imageRoutingMode ||
    'auto';

  return {
    prompt,
    playId: opts.creativeType === 'fal_full_poster' ? opts.playId || 'announcement' : opts.playId,
    selectedCategory:
      opts.creativeType === 'fal_full_poster' ? opts.playId || 'announcement' : opts.playId,
    posterTemplateId: opts.posterTemplateId,
    designSource: opts.designSource || (opts.posterTemplateId ? 'template' : undefined),
    artRole,
    chatHistory: opts.chatHistory,
    referenceImageUrl: opts.referenceImageUrl,
    forceCapability:
      opts.forceCapability ||
      (opts.creativeType === 'fal_full_poster' ? 'typography_native' : null),
    routingMode:
      opts.creativeType === 'fal_full_poster' ? 'auto' : opts.routingMode || providers.imageRoutingMode || 'auto',
    modelOverride:
      opts.creativeType === 'fal_full_poster'
        ? null
        : opts.modelOverride || (routingMode === 'manual' ? providers.falModel : null),
    settingsFalModel: isHighEndModel(providers.falModel || '') ? providers.falModel : null,
  };
}

function isAuthFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(401|403)\b/.test(msg) || /rejected the API key/i.test(msg);
}

function blockAfterFailure(
  err: unknown,
  providers: ResolvedProviders,
  decision: RouteDecision,
): never {
  if (err instanceof ProviderCreditError || isProviderCreditError(err)) {
    const credit = err instanceof ProviderCreditError ? err : new ProviderCreditError({
      tool: 'fal',
      toolLabel: 'Image model',
      title: 'Add money to Image model',
      message: '',
      billingUrl: 'https://fal.ai/dashboard/billing',
      job: 'image',
    });
    throw new ProviderCreditError({
      tool: credit.tool,
      toolLabel: credit.toolLabel,
      title: credit.tool === 'fal' ? 'Add money to Image model' : 'Add money to Text model',
      billingUrl: credit.billingUrl,
      job: 'image',
      message: `${credit.message} We did not switch to a cheaper image model. ${explainMissingPremium(providers, decision.capability)}`,
    });
  }
  if (err instanceof ImageModelUnavailableError) throw err;
  throw new ImageModelUnavailableError(
    `${explainMissingPremium(providers, decision.capability)} Last high-end attempt (${decision.endpoint}) failed: ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
}

async function generateWithSmartRoute(
  providers: ResolvedProviders,
  prompt: string,
  opts: AttachImageOpts,
  genOpts: Parameters<typeof generateContentImage>[2],
): Promise<{ image: NonNullable<Awaited<ReturnType<typeof generateContentImage>>>; decision: RouteDecision }> {
  const { decision, providers: routed } = routeForGeneration(
    buildRouteContext(prompt, opts, providers),
    providers,
  );
  if (!isHighEndModel(decision.endpoint)) {
    throw new ImageModelUnavailableError(explainMissingPremium(providers, decision.capability));
  }
  try {
    const image = await generateContentImage(routed, prompt, genOpts);
    if (!image?.url) throw new Error('Image provider returned no URL');
    return { image, decision };
  } catch (err) {
    const sameWallet = isProviderCreditError(err) || isAuthFailure(err);
    const advanced = nextFallbackProviders(routed, decision, decision.endpoint, {
      otherProviderOnly: sameWallet,
    });
    if (!advanced || !isHighEndModel(advanced.decision.endpoint)) {
      blockAfterFailure(err, providers, decision);
    }
    try {
      const image = await generateContentImage(advanced.providers, prompt, genOpts);
      if (!image?.url) blockAfterFailure(err, providers, decision);
      return { image, decision: advanced.decision };
    } catch (err2) {
      blockAfterFailure(err2, providers, advanced.decision);
    }
  }
}

/**
 * Generate AI art URL only (no social-frame branding). Used for Brand Studio hero slots.
 */
export async function generateRawArtUrl(
  tenantId: string,
  contentId: string,
  imagePrompt: string,
  initialOpts: AttachImageOpts = {},
): Promise<string> {
  let opts = initialOpts;
  const format = opts.format || 'instagram_square';
  const providers = await resolveProviders(tenantId);
  const brand = await prisma.brandSettings.findUnique({ where: { tenantId } });
  let guidedPrompt = imagePrompt.trim();
  try {
    const { resolvePosterVisualGuidance } = await import('./brand-poster-reference.service');
    const guidance = await resolvePosterVisualGuidance({
      tenantId,
      seed: contentId,
      hasExplicitReference: Boolean(opts.referenceImageUrl),
      designSource: opts.designSource,
    });
    if (guidance.styleInstruction) {
      guidedPrompt = `${guidedPrompt}\n\n${guidance.styleInstruction}`;
    }
    if (!opts.referenceImageUrl && guidance.referenceImageUrl) {
      opts = { ...opts, referenceImageUrl: guidance.referenceImageUrl };
    }
  } catch (error) {
    console.warn('[brand-visual-dna] could not resolve raw-art references', error);
  }

  const styleLine = resolveVisualStylePrompt(
    opts.visualStyleId,
    opts.brandImageStyle ?? brand?.imageStyle,
  );

  const finalPrompt = buildSocialImagePrompt({
    basePrompt: guidedPrompt,
    companyName: opts.companyName ?? brand?.companyName,
    imageStyle: styleLine || opts.brandImageStyle || brand?.imageStyle,
    visualStyleId: opts.visualStyleId,
    format,
    exact: opts.exact === true,
    logoPlacement: opts.logoPlacement || 'top-left',
    overlayHeaderFooter: Boolean(opts.headerText || opts.footerCta),
    posterQuality: opts.posterQuality === true,
    contentBrief: opts.contentBrief,
  });

  const { assembleFalPromptFrontLoaded } = await import('../lib/image-prompt-sanitize');
  const falPrompt = assembleFalPromptFrontLoaded(finalPrompt, []);

  await executionLogService.log({
    tenantId,
    contentId,
    workflowStep: 'image:generate_raw',
    message: `request ${providers.imageProvider}/${providers.falModel} raw art style=${opts.visualStyleId || 'custom'} exact=${Boolean(opts.exact)} promptChars=${falPrompt.length}`,
  });

  const { image, decision } = await generateWithSmartRoute(providers, falPrompt, opts, {
    format,
    exact: true,
    referenceImageUrl: opts.referenceImageUrl || undefined,
    referenceStrength: opts.referenceImageUrl ? 0.58 : undefined,
    editMode: opts.editMode === true,
  });
  await executionLogService.log({
    tenantId,
    contentId,
    workflowStep: 'image:generate_raw',
    message: `ok model=${image.model} route=${decision.endpoint} (${decision.reason})`,
  });
  return downloadArtToUploads(tenantId, image.url);
}

export async function attachGeneratedImage(
  tenantId: string,
  contentId: string,
  imagePrompt: string | undefined | null,
  brandImageStyleOrOpts?: string | null | AttachImageOpts,
): Promise<{ imageUrl: string; rawImageUrl?: string } | null> {
  if (!imagePrompt?.trim()) return null;

  let opts: AttachImageOpts =
    typeof brandImageStyleOrOpts === 'string' || brandImageStyleOrOpts == null
      ? { brandImageStyle: brandImageStyleOrOpts }
      : brandImageStyleOrOpts;

  // Keep image-model prompt photo-only; layout lives in posterLayout / SVG compositor
  let cleanPrompt = imagePrompt.trim();
  const isAiCreative =
    opts.posterQuality === true ||
    opts.designSource === 'ai' ||
    opts.creativeType === 'poster' ||
    opts.creativeType === 'fal_full_poster' ||
    opts.creativeType === 'insight' ||
    opts.creativeType === 'newsletter';
  if (isAiCreative) {
    try {
      const { resolvePosterVisualGuidance } = await import('./brand-poster-reference.service');
      const guidance = await resolvePosterVisualGuidance({
        tenantId,
        seed: contentId,
        hasExplicitReference: Boolean(opts.referenceImageUrl),
        designSource: opts.designSource,
      });
      if (guidance.styleInstruction) {
        cleanPrompt = `${cleanPrompt}\n\n${guidance.styleInstruction}`;
      }
      if (!opts.referenceImageUrl && guidance.referenceImageUrl) {
        opts = { ...opts, referenceImageUrl: guidance.referenceImageUrl };
      }
    } catch (error) {
      console.warn('[brand-visual-dna] could not resolve poster references', error);
    }
  }
  if (opts.creativeType === 'poster' || opts.posterSpec) {
    try {
      const { finalizeArtPrompt } = await import('./poster-layout-pick');
      const layoutId =
        opts.posterLayout && typeof opts.posterLayout === 'string' ? opts.posterLayout : 'hero_right';
      cleanPrompt = finalizeArtPrompt(cleanPrompt, layoutId as import('../providers/images/poster-frame').PosterLayoutId);
    } catch {
      // keep original if helper unavailable
    }
  }

  const format = opts.format || 'instagram_square';
  const logoPlacement: LogoPlacement = opts.logoPlacement || 'top-left';

  try {
    if (opts.rawOnly) {
      const raw = await generateRawArtUrl(tenantId, contentId, cleanPrompt, opts);
      if (!opts.skipPersist) {
        await prisma.generatedContent.update({
          where: { id: contentId },
          data: {
            imageUrl: raw,
            ...(opts.savePrompt !== false ? { imagePrompt: cleanPrompt } : {}),
          },
        });
      }
      return { imageUrl: raw };
    }

    // ── AI baked poster: typography model paints text; real logo stamped after ─
    if (opts.creativeType === 'fal_full_poster') {
      const providers = await resolveProviders(tenantId);
      const brandRow = await prisma.brandSettings.findUnique({ where: { tenantId } });
      const companyName =
        opts.companyName ?? brandRow?.companyName ?? 'Brand';
      const logoUrl =
        opts.logoUrl === null
          ? null
          : preferOriginalLogoUrl(opts.logoUrl ?? brandRow?.logoUrl) ??
            opts.logoUrl ??
            brandRow?.logoUrl ??
            null;

      const { buildBakedPosterPrompt, stampRealLogoOnBakedPoster } = await import(
        './baked-poster.service'
      );
      type BakeBrief = import('./baked-poster.service').BakeBrief;
      let brief = opts.bakeBrief as BakeBrief | null | undefined;
      if (!brief) {
        const row = await prisma.generatedContent.findUnique({
          where: { id: contentId },
          select: { headline: true, body: true, callToAction: true, templateSlots: true },
        });
        const slots =
          row?.templateSlots && typeof row.templateSlots === 'object' && !Array.isArray(row.templateSlots)
            ? (row.templateSlots as Record<string, unknown>)
            : {};
        const saved = slots.bakeBrief;
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
          brief = saved as BakeBrief;
        } else {
          brief = {
            onImageHeadline: (row?.headline || 'Update').slice(0, 72),
            onImageSubhead: (row?.body || '').split(/[.!?]/)[0]?.slice(0, 110) || '',
            onImageCta: (row?.callToAction || 'Learn more')
              .trim()
              .split(/\s+/)
              .slice(0, 5)
              .join(' ')
              .slice(0, 36),
            layoutHint: 'center_stage',
            logoPlacement: logoPlacement,
            bakedArtPrompt: cleanPrompt,
          };
        }
      }

      const falPrompt = buildBakedPosterPrompt({
        companyName,
        brief,
        visualStyleId: opts.visualStyleId,
        brandImageStyle: opts.brandImageStyle ?? brandRow?.imageStyle,
        format,
      });

      // Typography + logo ban first; scene second (survives truncation)
      const { assembleFalPromptFrontLoaded } = await import('../lib/image-prompt-sanitize');
      const typoHead = falPrompt.slice(0, 1100);
      const sceneTail = falPrompt.slice(1100);
      const promptWithKit = assembleFalPromptFrontLoaded(
        typoHead,
        sceneTail ? [sceneTail] : [],
        10000,
      );

      await executionLogService.log({
        tenantId,
        contentId,
        workflowStep: 'image:generate_baked',
        message: `request baked poster ${format} typography_native logoStamp=${Boolean(logoUrl)} promptChars=${promptWithKit.length}`,
      });

      const { image, decision } = await generateWithSmartRoute(
        providers,
        promptWithKit,
        {
          ...opts,
          creativeType: 'fal_full_poster',
          artRole: 'final_with_text',
          playId: opts.playId || 'announcement',
          routingMode: 'auto',
          modelOverride: null,
          forceCapability: 'typography_native',
          referenceImageUrl: opts.referenceImageUrl,
        },
        {
          format,
          exact: true,
          referenceImageUrl: opts.referenceImageUrl || undefined,
          referenceStrength: opts.referenceImageUrl ? 0.7 : undefined,
          negativePrompt:
            opts.negativePrompt ||
            'misspelled text, garbled letters, fake logos, invented brand marks, watermarks, low-res typography, cluttered collage, dashed logo boxes, LOGO placeholder',
        },
      );

      await executionLogService.log({
        tenantId,
        contentId,
        workflowStep: 'image:generate_baked',
        message: `ok model=${image.model} route=${decision.endpoint} capability=${decision.capability} (${decision.reason})`,
      });

      let rawUrl = await downloadArtToUploads(tenantId, image.url);
      let localUrl = rawUrl;

      if (logoUrl) {
        try {
          localUrl = await stampRealLogoOnBakedPoster({
            tenantId,
            imagePublicUrl: rawUrl,
            logoUrl,
            placement: brief.logoPlacement || logoPlacement,
            format,
          });
          await executionLogService.log({
            tenantId,
            contentId,
            workflowStep: 'image:bake_logo_stamp',
            message: `stamped real brand logo (${brief.logoPlacement || logoPlacement})`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await executionLogService.log({
            tenantId,
            contentId,
            workflowStep: 'image:bake_logo_stamp_skip',
            message: msg.slice(0, 200),
          });
        }
      }

      if (!opts.skipPersist) {
        const existing = await prisma.generatedContent.findUnique({
          where: { id: contentId },
          select: { templateSlots: true },
        });
        const prev =
          existing?.templateSlots &&
          typeof existing.templateSlots === 'object' &&
          !Array.isArray(existing.templateSlots)
            ? (existing.templateSlots as Record<string, unknown>)
            : {};
        await prisma.generatedContent.update({
          where: { id: contentId },
          data: {
            imageUrl: localUrl,
            // Clean typography art BEFORE logo stamp — required for Apply logo position
            rawImageUrl: rawUrl,
            imagePrompt: promptWithKit,
            templateSlots: {
              ...prev,
              creativeMode: 'ai_baked_layout',
              bakeBrief: brief,
              bakeModel: decision.endpoint,
              bakeCapability: decision.capability,
              logoPlacement: brief.logoPlacement || logoPlacement,
            } as object,
          },
        });
      }
      return { imageUrl: localUrl, rawImageUrl: rawUrl };
    }

    const providers = await resolveProviders(tenantId);

    let brand = {
      imageStyle: opts.brandImageStyle ?? null,
      companyName: opts.companyName ?? null,
      // Explicit null = caller wants no logo (do not fall back to brand settings)
      logoUrl:
        opts.logoUrl === null
          ? null
          : preferOriginalLogoUrl(opts.logoUrl) ?? opts.logoUrl ?? null,
    };
    if (opts.companyName === undefined || opts.logoUrl === undefined || opts.brandImageStyle === undefined) {
      const row = await prisma.brandSettings.findUnique({ where: { tenantId } });
      brand = {
        imageStyle: opts.brandImageStyle ?? row?.imageStyle ?? null,
        companyName: opts.companyName ?? row?.companyName ?? null,
        logoUrl:
          opts.logoUrl === null
            ? null
            : preferOriginalLogoUrl(opts.logoUrl ?? row?.logoUrl) ??
              opts.logoUrl ??
              row?.logoUrl ??
              null,
      };
    }

    const styleLine = resolveVisualStylePrompt(opts.visualStyleId, brand.imageStyle);

    const hasOverlays = Boolean(
      (opts.headerText && opts.headerText.trim()) || (opts.footerCta && opts.footerCta.trim()),
    );

    // Ground the scene in the actual post — but NEVER when exact prompt mode is on
    let contentBrief = opts.exact ? '' : opts.contentBrief?.trim() || '';
    if (!opts.exact && !contentBrief) {
      const row = await prisma.generatedContent.findUnique({
        where: { id: contentId },
        select: { headline: true, body: true, callToAction: true },
      });
      if (row) {
        contentBrief = [row.headline, row.body?.slice(0, 220), row.callToAction]
          .filter(Boolean)
          .join(' — ');
      }
    }

    const finalPrompt = buildSocialImagePrompt({
      basePrompt: cleanPrompt,
      companyName: brand.companyName,
      imageStyle: styleLine || brand.imageStyle,
      visualStyleId: opts.visualStyleId,
      format,
      exact: opts.exact,
      logoPlacement,
      overlayHeaderFooter: hasOverlays,
      // Always: logo (and usually header/CTA) are composited — never bake words into pixels
      forbidInImageText: true,
      posterQuality: opts.posterQuality === true,
      contentBrief: opts.exact ? null : contentBrief,
    });

    const kitVisuals = await resolveBrandKitVisuals(tenantId, contentId, brand.imageStyle);
    // Scene MUST stay first — FLUX truncates ~512 tokens; prepending kit made images look random.
    const { assembleFalPromptFrontLoaded } = await import('../lib/image-prompt-sanitize');
    const promptWithKit = assembleFalPromptFrontLoaded(
      finalPrompt,
      kitVisuals.artStyleLine ? [kitVisuals.artStyleLine] : [],
      12000,
    );

    const overlayWithKit = {
      ...(opts.overlay || {}),
      headerFontCss: opts.overlay?.headerFontCss || kitVisuals.headingFontCss,
      footerFontCss: opts.overlay?.footerFontCss || kitVisuals.bodyFontCss,
    };

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'image:generate',
      message: `request ${providers.imageProvider}/${providers.falModel} ${format} style=${opts.visualStyleId || 'default'} exact=${Boolean(opts.exact)} logo=${logoPlacement} brandKit=${kitVisuals.kitApplied} promptChars=${promptWithKit.length}`,
    });

    const { image, decision } = await generateWithSmartRoute(providers, promptWithKit, opts, {
      format,
      exact: true,
      referenceImageUrl: opts.referenceImageUrl || undefined,
      referenceStrength: opts.referenceImageUrl ? 0.55 : undefined,
      editMode: opts.editMode === true,
      negativePrompt: opts.negativePrompt || opts.posterSpec?.artNegativePrompt || undefined,
    });

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'image:generate',
      message: `ok model=${image.model} route=${decision.endpoint} capability=${decision.capability} (${decision.reason})`,
    });

    const framed =
      opts.creativeType === 'poster' && opts.posterSpec
        ? await brandPosterFrame({
            tenantId,
            imageUrl: image.url,
            spec: opts.posterSpec,
            companyName: brand.companyName,
            logoUrl: brand.logoUrl,
            brandImageStyle: brand.imageStyle,
            palette: kitVisuals.palette,
            headingFontCss: kitVisuals.headingFontCss,
            bodyFontCss: kitVisuals.bodyFontCss,
            layout: opts.posterLayout,
            fillLayout: opts.fillLayout,
            sourceImageUrl: opts.sourceImageUrl,
            slideLabel: opts.slideLabel ?? null,
            contactChips: opts.contactChips ?? null,
            width: SOCIAL_IMAGE_FORMATS[format].width,
            height: SOCIAL_IMAGE_FORMATS[format].height,
          })
        : opts.creativeType === 'newsletter'
        ? await newsletterSocialFrame({
            tenantId,
            imageUrl: image.url,
            companyName: brand.companyName,
            logoUrl: brand.logoUrl,
            brandImageStyle: brand.imageStyle,
            palette: kitVisuals.palette,
            headingFontCss: kitVisuals.headingFontCss,
            bodyFontCss: kitVisuals.bodyFontCss,
            edition:
              opts.newsletterEdition ||
              ({
                headline: opts.headerText || contentBrief || 'Product update',
                intro: opts.bodyText || contentBrief || '',
                sectionTitle: 'This edition',
                sectionTitleRight: 'Also in this issue',
                sectionBodyLeft: (opts.bodyText || '').slice(0, 420),
                sectionBodyRight: (opts.bodyText || '').slice(420, 840),
                featureTitle: 'Spotlight',
                featureBody: opts.bodyText || '',
                sneakPeek: [
                  {
                    title: 'Product',
                    text: (opts.bodyText || contentBrief || '').slice(0, 180) || 'What shipped in this edition.',
                  },
                  {
                    title: 'Why it matters',
                    text: (opts.headerText || '').slice(0, 180) || 'Value for operators and customers.',
                  },
                  {
                    title: 'How to engage',
                    text: opts.footerCta || 'Connect with our team for a walkthrough.',
                  },
                ],
                closing: 'Thank you for reading this edition.',
                cta: opts.footerCta || 'Learn more',
              } satisfies NewsletterEditionContent),
          })
        : opts.creativeType === 'insight'
          ? await insightSocialFrame({
              tenantId,
              imageUrl: image.url,
              companyName: brand.companyName,
              logoUrl: brand.logoUrl,
              brandImageStyle: brand.imageStyle,
              palette: kitVisuals.palette,
              report: opts.insightReport || {
                headline: opts.headerText || contentBrief || 'Key insight',
                subheadline: (opts.bodyText || '').slice(0, 160),
                points: [
                  { title: 'Context', text: (opts.bodyText || contentBrief || 'Supporting point').slice(0, 110) },
                  { title: 'Insight', text: (opts.bodyText || contentBrief || 'Supporting point').slice(0, 110) },
                  { title: 'Impact', text: (opts.footerCta || 'Take the next step').slice(0, 110) },
                ],
                summary: (opts.bodyText || contentBrief || '').slice(0, 220),
                calloutTitle: 'Next step',
                calloutBody: opts.footerCta || 'Learn more',
              },
              width: SOCIAL_IMAGE_FORMATS[format].width,
              height: SOCIAL_IMAGE_FORMATS[format].height,
            })
          : await brandSocialFrame({
              tenantId,
              imageUrl: image.url,
              companyName: brand.companyName,
              logoUrl: brand.logoUrl,
              format,
              logoPlacement,
              headerText: opts.headerText,
              footerCta: opts.footerCta,
              overlay: overlayWithKit,
            });

    const rawLocal = await downloadArtToUploads(tenantId, image.url);

    if (!opts.skipPersist) {
      await prisma.generatedContent.update({
        where: { id: contentId },
        data: {
          imageUrl: framed.publicUrl,
          rawImageUrl: rawLocal,
          ...(opts.savePrompt !== false ? { imagePrompt: cleanPrompt } : {}),
        },
      });
    }
    return { imageUrl: framed.publicUrl, rawImageUrl: rawLocal };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'image:failed',
      status: ExecutionStatus.TRANSIENT_FAILURE,
      message: msg,
    });
    const { reportIfCreditError } = await import('./provider-credit-alert.service');
    await reportIfCreditError(tenantId, err, 'image');
    if (opts.throwOnError) throw err;
    return null;
  }
}

/**
 * Re-apply logo + overlay settings onto existing raw art (no AI regenerate).
 * Preserves the original frame type — insight posters stay insight posters.
 * Never swaps to a different layout or generates new AI art.
 */
export async function reframeExistingImage(
  tenantId: string,
  contentId: string,
  opts: AttachImageOpts = {},
): Promise<{ imageUrl: string }> {
  const content = await prisma.generatedContent.findFirst({
    where: { id: contentId, tenantId, deletedAt: null },
  });
  if (!content) throw new Error('Content not found');

  if (content.brandTemplateId) {
    throw new Error(
      'Logo position and on-image text overlays cannot be applied to Brand Studio / Placid template posts.',
    );
  }

  const slots =
    content.templateSlots && typeof content.templateSlots === 'object' && !Array.isArray(content.templateSlots)
      ? (content.templateSlots as Record<string, unknown>)
      : {};
  const isBaked =
    slots.creativeMode === 'ai_baked_layout' ||
    (slots.bakeBrief != null && typeof slots.bakeBrief === 'object');

  // Prefer stored clean art. Recover from SVG frames, pre-stamp bake files, or imageUrl.
  let source = content.rawImageUrl;
  let recoveredRaw = false;
  if (!source) {
    source = await tryExtractRawFromFramedSvg(tenantId, content.imageUrl);
    if (source) recoveredRaw = true;
  }
  if (!source) {
    source = tryRecoverPreStampArt(tenantId, content.imageUrl);
    if (source) recoveredRaw = true;
  }
  if (!source && content.imageUrl) {
    source = content.imageUrl;
    recoveredRaw = true;
  }
  if (!source) {
    throw new Error(
      'No original art stored for this post. Click “Generate image again” once so overlays can be applied without changing the picture.',
    );
  }
  if (recoveredRaw && source !== content.rawImageUrl) {
    await prisma.generatedContent.update({
      where: { id: contentId },
      data: { rawImageUrl: source },
    });
  }

  const brandRow = await prisma.brandSettings.findUnique({ where: { tenantId } });
  const overlaysOn = opts.overlay?.overlaysEnabled !== false;
  const brand = {
    companyName: opts.companyName ?? brandRow?.companyName ?? null,
    imageStyle: opts.brandImageStyle ?? brandRow?.imageStyle ?? null,
    logoUrl: !overlaysOn
      ? null
      : opts.logoUrl === null
        ? null
        : preferOriginalLogoUrl(opts.logoUrl ?? brandRow?.logoUrl) ??
          opts.logoUrl ??
          brandRow?.logoUrl ??
          null,
  };

  const isInsight = slots.playId === 'insight_report' && slots.insightReport;
  const format = opts.format || 'instagram_square';
  const logoPlacement = opts.logoPlacement || 'top-left';
  const storedPosterSpec =
    slots.posterSpec && typeof slots.posterSpec === 'object' && !Array.isArray(slots.posterSpec)
      ? (slots.posterSpec as PosterSpec)
      : null;
  const posterLayout =
    typeof slots.posterLayout === 'string' ? (slots.posterLayout as PosterLayoutId) : undefined;
  const fillLayout =
    typeof slots.fillLayout === 'string' ? (slots.fillLayout as PosterLayoutId) : undefined;
  const sourceImageUrl =
    typeof slots.sourceImageUrl === 'string' ? slots.sourceImageUrl : undefined;

  // Painted (baked) posters: text is in the pixels — only move/restamp the real logo.
  if (isBaked && !isInsight) {
    if (!overlaysOn || !brand.logoUrl) {
      await prisma.generatedContent.update({
        where: { id: contentId },
        data: {
          imageUrl: source,
          rawImageUrl: source,
          templateSlots: {
            ...slots,
            logoPlacement,
            overlaysEnabled: overlaysOn,
          } as object,
        },
      });
      return { imageUrl: source };
    }
    const { stampRealLogoOnBakedPoster } = await import('./baked-poster.service');
    const stamped = await stampRealLogoOnBakedPoster({
      tenantId,
      imagePublicUrl: source,
      logoUrl: brand.logoUrl,
      placement: logoPlacement,
      format,
    });
    await prisma.generatedContent.update({
      where: { id: contentId },
      data: {
        imageUrl: stamped,
        rawImageUrl: source,
        templateSlots: {
          ...slots,
          logoPlacement,
          overlaysEnabled: true,
        } as object,
      },
    });
    return { imageUrl: stamped };
  }

  const { extractCarouselPayload } = await import('../lib/carousel-parse');
  const carousel = extractCarouselPayload(content.templateSlots);
  const kitVisuals = await resolveBrandKitVisuals(tenantId, contentId, brand.imageStyle);
  if (carousel && carousel.slides.length >= 2 && !isInsight) {
    const reframed = [];
    for (let i = 0; i < carousel.slides.length; i++) {
      const slide = carousel.slides[i];
      const raw = slide.rawImageUrl || (i === 0 ? source : null);
      if (!raw) {
        reframed.push(slide);
        continue;
      }
      if (!overlaysOn) {
        reframed.push({ ...slide, imageUrl: raw });
        continue;
      }
      // Designed posters must stay posters — re-render the stored layout brief.
      const slideSpec = (slide.posterSpec as PosterSpec | null) || (i === 0 ? storedPosterSpec : null);
      if (slideSpec) {
        const slideLayout =
          (typeof slide.posterLayout === 'string' && slide.posterLayout
            ? (slide.posterLayout as PosterLayoutId)
            : null) || posterLayout;
        const isLast = i === carousel.slides.length - 1;
        const storedContacts = Array.isArray(
          (content.templateSlots as { carousel?: { contacts?: unknown } } | null)?.carousel
            ?.contacts,
        )
          ? ((content.templateSlots as { carousel: { contacts: Array<{ label: string; value: string }> } })
              .carousel.contacts)
          : null;
        const poster = await brandPosterFrame({
          tenantId,
          imageUrl: raw,
          spec: slideSpec,
          companyName: brand.companyName,
          logoUrl: brand.logoUrl,
          brandImageStyle: brand.imageStyle,
          palette: kitVisuals.palette,
          headingFontCss: kitVisuals.headingFontCss,
          bodyFontCss: kitVisuals.bodyFontCss,
          layout: slideLayout || 'hero_right',
          fillLayout,
          sourceImageUrl,
          slideLabel: `${i + 1} / ${carousel.slides.length}`,
          contactChips: isLast ? storedContacts : null,
          logoPlacement,
          width: SOCIAL_IMAGE_FORMATS[format].width,
          height: SOCIAL_IMAGE_FORMATS[format].height,
        });
        reframed.push({ ...slide, imageUrl: poster.publicUrl, rawImageUrl: raw });
        continue;
      }
      const framedSlide = await brandSocialFrame({
        tenantId,
        imageUrl: raw,
        companyName: brand.companyName,
        logoUrl: brand.logoUrl,
        format,
        logoPlacement,
        headerText:
          i === 0 && opts.headerText != null ? opts.headerText : slide.headline,
        footerCta:
          i === carousel.slides.length - 1
            ? opts.footerCta ?? null
            : `Slide ${i + 1} / ${carousel.slides.length}`,
        overlay: {
          ...(opts.overlay || {}),
          headerFontCss: opts.overlay?.headerFontCss || kitVisuals.headingFontCss,
          footerFontCss: opts.overlay?.footerFontCss || kitVisuals.bodyFontCss,
        },
      });
      reframed.push({ ...slide, imageUrl: framedSlide.publicUrl, rawImageUrl: raw });
    }
    const cover = reframed[0];
    await prisma.generatedContent.update({
      where: { id: contentId },
      data: {
        imageUrl: cover.imageUrl,
        rawImageUrl: cover.rawImageUrl || content.rawImageUrl,
        templateSlots: {
          ...slots,
          format: 'carousel',
          logoPlacement,
          overlaysEnabled: overlaysOn,
          carousel: { slideCount: reframed.length, slides: reframed },
        } as object,
      },
    });
    return { imageUrl: cover.imageUrl };
  }

  let framed: { publicUrl: string };

  if (isInsight) {
    const report = slots.insightReport as InsightReportContent;
    // Overlay off → show the same clean art only (same picture, no designed plate).
    if (!overlaysOn) {
      await prisma.generatedContent.update({
        where: { id: contentId },
        data: { imageUrl: source },
      });
      return { imageUrl: source };
    }
    // Same picture + same insight layout — only logo/typography refresh.
    framed = await insightSocialFrame({
      tenantId,
      imageUrl: source,
      companyName: brand.companyName,
      logoUrl: brand.logoUrl,
      brandImageStyle: brand.imageStyle,
      palette: kitVisuals.palette,
      logoPlacement: opts.logoPlacement || 'top-left',
      report: {
        ...report,
        headline: (opts.headerText || report.headline || '').trim() || report.headline,
        calloutBody: (opts.footerCta || report.calloutBody || '').trim() || report.calloutBody,
      },
      width: SOCIAL_IMAGE_FORMATS[format].width,
      height: SOCIAL_IMAGE_FORMATS[format].height,
    });
  } else if (storedPosterSpec) {
    // Overlay off → show the clean art only, same as the insight path.
    if (!overlaysOn) {
      await prisma.generatedContent.update({
        where: { id: contentId },
        data: { imageUrl: source },
      });
      return { imageUrl: source };
    }
    framed = await brandPosterFrame({
      tenantId,
      imageUrl: source,
      spec: {
        ...storedPosterSpec,
        headline: (opts.headerText || '').trim() || storedPosterSpec.headline,
        closingLine: (opts.footerCta || '').trim() || storedPosterSpec.closingLine,
      },
      companyName: brand.companyName,
      logoUrl: brand.logoUrl,
      brandImageStyle: brand.imageStyle,
      palette: kitVisuals.palette,
      headingFontCss: kitVisuals.headingFontCss,
      bodyFontCss: kitVisuals.bodyFontCss,
      layout: posterLayout,
      fillLayout,
      sourceImageUrl,
      logoPlacement: opts.logoPlacement || 'top-left',
      width: SOCIAL_IMAGE_FORMATS[format].width,
      height: SOCIAL_IMAGE_FORMATS[format].height,
    });
  } else if (opts.creativeType === 'newsletter' || content.engine === 'newsletter') {
    const storedEdition =
      slots.newsletterEdition && typeof slots.newsletterEdition === 'object'
        ? (slots.newsletterEdition as NewsletterEditionContent)
        : null;
    framed = await newsletterSocialFrame({
      tenantId,
      imageUrl: source,
      companyName: brand.companyName,
      logoUrl: brand.logoUrl,
      brandImageStyle: brand.imageStyle,
      palette: kitVisuals.palette,
      headingFontCss: kitVisuals.headingFontCss,
      bodyFontCss: kitVisuals.bodyFontCss,
      edition:
        opts.newsletterEdition ||
        storedEdition ||
        ({
          headline: opts.headerText || content.headline || 'Product update',
          intro: opts.bodyText || content.body || '',
          sectionTitle: 'This edition',
          sectionTitleRight: 'Also in this issue',
          sectionBodyLeft: (opts.bodyText || content.body || '').slice(0, 420),
          sectionBodyRight: (opts.bodyText || content.body || '').slice(420, 840),
          featureTitle: 'Spotlight',
          featureBody: opts.bodyText || content.body || '',
          sneakPeek: [],
          closing: 'Thank you for reading this edition.',
          cta: opts.footerCta || content.callToAction || 'Learn more',
        } satisfies NewsletterEditionContent),
    });
  } else {
    framed = await brandSocialFrame({
      tenantId,
      imageUrl: source,
      companyName: brand.companyName,
      logoUrl: brand.logoUrl,
      format,
      logoPlacement: opts.logoPlacement || 'top-left',
      headerText: opts.headerText,
      footerCta: opts.footerCta,
      overlay: {
        ...(opts.overlay || {}),
        headerFontCss: opts.overlay?.headerFontCss || kitVisuals.headingFontCss,
        footerFontCss: opts.overlay?.footerFontCss || kitVisuals.bodyFontCss,
      },
    });
  }

  await prisma.generatedContent.update({
    where: { id: contentId },
    data: {
      imageUrl: framed.publicUrl,
      templateSlots: {
        ...slots,
        logoPlacement: opts.logoPlacement || 'top-left',
        overlaysEnabled: overlaysOn,
      } as object,
    },
  });

  return { imageUrl: framed.publicUrl };
}

async function tryExtractRawFromFramedSvg(
  tenantId: string,
  imageUrl: string | null | undefined,
): Promise<string | null> {
  if (!imageUrl?.includes('/social-images/') || !imageUrl.endsWith('.svg')) return null;
  try {
    const cleaned = imageUrl.replace(/^\/uploads\//, '');
    const full = path.resolve(config.UPLOAD_DIR, cleaned);
    if (!full.startsWith(path.resolve(config.UPLOAD_DIR)) || !fs.existsSync(full)) return null;
    const svg = fs.readFileSync(full, 'utf8');
    // Prefer the full-bleed background (first / largest) — never the logo watermark <image>
    const matches = [...svg.matchAll(/<image\b[^>]*\bhref="([^"]+)"[^>]*>/g)];
    if (!matches.length) return null;
    let best = matches[0][1];
    let bestArea = 0;
    for (const m of matches) {
      const tag = m[0];
      const w = Number(/width="([\d.]+)"/.exec(tag)?.[1] || 0);
      const h = Number(/height="([\d.]+)"/.exec(tag)?.[1] || 0);
      const area = w * h;
      if (area >= bestArea) {
        bestArea = area;
        best = m[1];
      }
    }
    return best
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  } catch {
    return null;
  }
}

/**
 * Baked posts used to persist only the stamped PNG. The clean typography art
 * usually still sits beside it as art-<ts>.png — recover that for logo moves.
 */
function tryRecoverPreStampArt(
  tenantId: string,
  imageUrl: string | null | undefined,
): string | null {
  if (!imageUrl?.includes('/ai-art/')) return null;
  const stampMatch = /baked-logo-(\d+)\.(png|jpe?g|webp)$/i.exec(imageUrl);
  if (!stampMatch) return null;
  const stampTs = Number(stampMatch[1]);
  if (!Number.isFinite(stampTs)) return null;
  try {
    const dir = path.resolve(config.UPLOAD_DIR, tenantId, 'ai-art');
    if (!dir.startsWith(path.resolve(config.UPLOAD_DIR)) || !fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir);
    let best: { url: string; delta: number } | null = null;
    for (const name of files) {
      const m = /^art-(\d+)\.(png|jpe?g|webp)$/i.exec(name);
      if (!m) continue;
      const artTs = Number(m[1]);
      const delta = stampTs - artTs;
      // Art is downloaded just before stamp — allow up to 2 minutes earlier
      if (delta < 0 || delta > 120_000) continue;
      if (!best || delta < best.delta) {
        best = { url: `/uploads/${tenantId}/ai-art/${name}`, delta };
      }
    }
    return best?.url || null;
  } catch {
    return null;
  }
}
