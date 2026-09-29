import { ContentEngine, ExecutionStatus } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { selectNextCompetitor } from '../services/rotation.service';
import { LLMService, buildSystemPrompt } from '../services/llm.service';
import { executionLogService } from '../services/execution-log.service';
import { assertGenerationActive } from '../services/generation-abort.service';
import {
  listScrapedCompetitorPosts,
  pickBestScrapedPost,
  scrapeCompetitors,
} from '../services/competitor-monitor.service';
import {
  defaultBrandCanvas,
  renderBrandCanvasSvg,
  saveRenderedSvg,
  isLayerDynamic,
  type BrandCanvas,
} from '../providers/templates/brand-renderer';
import { preferOriginalLogoUrl } from '../lib/store-upload';
import { toPublicMediaUrl } from '../lib/public-media-url';
import { resolveProviders } from '../services/providers.service';
import {
  applyExactImageToSlots,
  pictureLayersForFill,
} from '../services/fill-brand-template.service';

export type CompetitorImageMode = 'new_topic' | 'near_mirror';

export type CompetitorGenerateOpts = {
  scrapedPostId?: string;
  competitorId?: string;
  /** When true and no scrapedPostId, scrape then auto-pick best */
  refreshScrape?: boolean;
  useBrandTemplate?: boolean;
  brandTemplateId?: string;
  visualMode?: 'existing_template' | 'ai' | 'ai_baked_layout';
  /** Override Settings → competitor image mode for this run */
  competitorImageMode?: CompetitorImageMode;
  platforms?: Array<'instagram' | 'linkedin' | 'facebook' | 'twitter'>;
  requireApproval?: boolean;
};

function isExternallyFetchableHttps(url: string | null | undefined): boolean {
  const u = (url || '').trim();
  if (!/^https:\/\//i.test(u)) return false;
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(u)) return false;
  if (/^https:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u)) return false;
  return true;
}

function pickExactScrapedImage(imageUrls: string[] | null | undefined): {
  /** Durable path preferred for storage (/uploads/...) */
  imageUrl: string;
  /** Absolute URL (may be localhost in dev) */
  absoluteUrl: string;
  /**
   * HTTPS URL Placid can fetch (remote CDN). Prefer this over /uploads → localhost.
   * Null when only local cache exists — Placid must use AI-generated CDN art instead.
   */
  placidImageUrl: string | null;
} | null {
  if (!imageUrls?.length) return null;
  let local: string | undefined;
  let remote: string | undefined;
  let placidRemote: string | undefined;
  for (const raw of imageUrls) {
    const u = (raw || '').trim();
    if (!u) continue;
    if (u.startsWith('/uploads/')) local = local || u;
    else if (/^https?:\/\//i.test(u)) {
      remote = remote || u;
      if (!placidRemote && isExternallyFetchableHttps(u)) placidRemote = u;
    }
  }
  const imageUrl = local || remote;
  if (!imageUrl) return null;
  const absoluteUrl = toPublicMediaUrl(imageUrl) || imageUrl;
  const placidImageUrl =
    placidRemote || (isExternallyFetchableHttps(absoluteUrl) ? absoluteUrl : null);
  return { imageUrl, absoluteUrl, placidImageUrl };
}

export class CompetitorEngine {
  async generate(tenantId: string, contentId: string, opts: CompetitorGenerateOpts = {}): Promise<void> {
    await assertGenerationActive(contentId);
    const start = Date.now();
    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'competitor:select',
      engine: ContentEngine.COMPETITOR,
    });

    let scrapedPost =
      opts.scrapedPostId
        ? await prisma.scrapedCompetitorPost.findFirst({
            where: { id: opts.scrapedPostId, tenantId, deletedAt: null },
            include: { competitor: true },
          })
        : null;

    // Auto / dashboard: refresh scrape then pick highest-scoring post
    if (!scrapedPost && (opts.refreshScrape || !opts.scrapedPostId)) {
      await executionLogService.log({
        tenantId,
        contentId,
        workflowStep: 'competitor:scrape',
        engine: ContentEngine.COMPETITOR,
        message: opts.competitorId
          ? `Refreshing scrape for competitor ${opts.competitorId}`
          : 'Refreshing competitor scrapes before auto-pick',
      });

      try {
        await scrapeCompetitors(tenantId, {
          competitorId: opts.competitorId,
          platforms: opts.platforms,
        });
      } catch (err) {
        // If scrape fails but we already have posts, continue with best available
        const existing = await listScrapedCompetitorPosts(tenantId, {
          competitorId: opts.competitorId,
          platforms: opts.platforms,
          limit: 5,
        });
        if (existing.length === 0) throw err;
      }

      const best = await pickBestScrapedPost(tenantId, opts.competitorId, opts.platforms);
      if (best) {
        scrapedPost = await prisma.scrapedCompetitorPost.findFirst({
          where: { id: best.id, tenantId, deletedAt: null },
          include: { competitor: true },
        });
      }
    }

    if (!scrapedPost) {
      // Fallback: rotate competitor and scrape (legacy path)
      const competitor = opts.competitorId
        ? await prisma.competitor.findFirst({
            where: { id: opts.competitorId, tenantId, deletedAt: null, isActive: true },
          })
        : await selectNextCompetitor(tenantId);
      if (!competitor) {
        throw new Error('No active competitors configured. Add them in Settings → Competitors.');
      }
      await scrapeCompetitors(tenantId, {
        competitorId: competitor.id,
        platforms: opts.platforms,
      });
      const best = await pickBestScrapedPost(tenantId, competitor.id, opts.platforms);
      if (!best) {
        throw new Error(`No recent posts found for competitor: ${competitor.name}`);
      }
      scrapedPost = await prisma.scrapedCompetitorPost.findFirst({
        where: { id: best.id, tenantId },
        include: { competitor: true },
      });
    }

    if (!scrapedPost?.competitor) {
      throw new Error('Selected competitor post not found.');
    }

    const competitor = scrapedPost.competitor;
    const brandSettings = await prisma.brandSettings.findUnique({ where: { tenantId } });
    const providers = await resolveProviders(tenantId);
    const imageMode: CompetitorImageMode =
      opts.competitorImageMode ||
      (providers.competitorImageMode === 'near_mirror' ? 'near_mirror' : 'new_topic');
    const exactScraped =
      imageMode === 'near_mirror' ? pickExactScrapedImage(scrapedPost.imageUrls) : null;
    // near_mirror requires the scraped photo; if missing, fall back to new-topic AI
    const useExactImage = imageMode === 'near_mirror' && Boolean(exactScraped);

    const commentsRaw = scrapedPost.comments;
    const comments = Array.isArray(commentsRaw)
      ? (commentsRaw as Array<{ text?: string }>).slice(0, 5)
      : [];

    const imgs = scrapedPost.imageUrls?.length
      ? `\nCompetitor images: ${scrapedPost.imageUrls.join(', ')}`
      : '';
    const commentBlock = comments.length
      ? `\nTop comments: ${comments.map((c) => c.text || '').filter(Boolean).join(' | ')}`
      : '';

    const sourceMaterial = `[Selected competitor post]
@${competitor.handle} (${scrapedPost.platform})
Engagement: ${scrapedPost.likes} likes · ${scrapedPost.commentsCount} comments · ${scrapedPost.shares} shares
Posted: ${scrapedPost.postedAt?.toISOString() ?? 'unknown'}
URL: ${scrapedPost.postUrl || 'n/a'}

Content:
${scrapedPost.content || '(image/video post with little caption)'}${imgs}${commentBlock}`;

    const llm = await LLMService.forTenant(tenantId);
    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'competitor:generate',
      engine: ContentEngine.COMPETITOR,
      message: `Creating brand-styled response to post ${scrapedPost.id} (imageMode=${imageMode}${
        useExactImage ? ', exact scraped image' : imageMode === 'near_mirror' ? ', no scraped image → new topic' : ''
      })`,
    });

    const useBrand = Boolean(opts.useBrandTemplate && opts.brandTemplateId);
    const brandTemplate = useBrand
      ? await prisma.brandTemplate.findFirst({
          where: {
            id: opts.brandTemplateId!,
            tenantId,
            deletedAt: null,
            isActive: true,
          },
        })
      : null;

    const dynamicSlots = brandTemplate
      ? ((brandTemplate.canvas as BrandCanvas | null)?.layers || [])
          .filter((l) => isLayerDynamic(l) && l.type === 'text')
          .map((l) => l.slot || l.id)
      : [];

    const nearMirrorVisualHint = useExactImage
      ? `\n- Image: the published visual will reuse the competitor's EXACT scraped photo. STILL write a FULL detailed imagePrompt for OUR brand topic (photoreal scene matching the headline/body) so Approvals can regenerate AI art later — do NOT write "Reference photo" or "metadata only".`
      : `\n- Image prompt: write a LONG, highly detailed photorealistic brief matching our brand style (${brandSettings?.imageStyle || 'professional B2B'}). Never ask for icons, logos, flat badges, red circles, clipart, or line drawings.`;

    const post = await llm.generatePost({
      systemPrompt: buildSystemPrompt(brandSettings ?? {
        brandVoice: '', imageStyle: '', hashtagStrategy: '', contentGuidelines: '', targetAudience: '',
      }),
      userPrompt: `Create a social post inspired by this REAL competitor post. Match the CONTENT TYPE (announcement, offer, tip, carousel vibe, CTA style, hashtag density) but rewrite everything in OUR brand voice, audience, and visual style. Do NOT name the competitor. Do NOT copy their wording verbatim.

${sourceMaterial}

Requirements:
- Similar post type / angle / structure (e.g. if they ran a launch teaser, we do our own launch-style teaser)
- Hashtags: same energy and count range, but ours (follow brand hashtag strategy)
${nearMirrorVisualHint}
- Position our brand strategically and helpfully
${
  brandTemplate
    ? `\nAlso prepare short on-image copy. Slot names: ${dynamicSlots.join(', ') || 'headline, body'}.`
    : ''
}`,
    });

    let slots: Record<string, string> = {
      headline: post.headline,
      subheadline: post.callToAction || post.body.slice(0, 120),
      body: post.body.slice(0, 280),
      offer: post.callToAction || '',
    };

    if (brandTemplate && dynamicSlots.length) {
      try {
        const slotJson = await llm.generateRawJson({
          systemPrompt: 'Return JSON only. Fill each key with short on-brand copy for a social graphic.',
          userPrompt: `Competitor-inspired angle: ${post.headline}\nBody: ${post.body}\nFill these slots: ${JSON.stringify(dynamicSlots)}`,
        });
        for (const [k, v] of Object.entries(slotJson)) {
          if (typeof v === 'string') slots[k] = v;
          else if (v != null) slots[k] = JSON.stringify(v);
        }
        if (!slots.headline) slots.headline = post.headline;
      } catch {
        // keep defaults
      }
    }

    let imageUrl: string | null = null;
    await assertGenerationActive(contentId);
    if (brandTemplate) {
      const isPlacidTemplate =
        brandTemplate.provider === 'placid' && Boolean(brandTemplate.placidTemplateId);

      await executionLogService.log({
        tenantId,
        contentId,
        workflowStep: 'competitor:brand_template',
        engine: ContentEngine.COMPETITOR,
        message: useExactImage
          ? `Brand template ${brandTemplate.name} + EXACT scraped image into picture zones${
              isPlacidTemplate ? ' (via Placid media upload)' : ''
            }`
          : `Brand template ${brandTemplate.name} + NEW TOPIC AI photo into picture zones`,
      });

      const prompt =
        post.imagePrompt?.trim() ||
        `Photorealistic B2B marketing photo for: ${post.headline}. ${post.body.slice(0, 160)}`;

      // Exact mode: put the scraped photo into every picture slot (incl. mis-tagged static zones).
      // New-topic mode: leave picture slots empty so the renderer generates AI art.
      // In-house SVG reads /uploads from disk; Placid path uploads those bytes to Placid media.
      if (useExactImage && exactScraped) {
        const canvas = (brandTemplate.canvas as BrandCanvas | null) || {
          width: 1080,
          height: 1080,
          layers: [],
        };
        const applied = applyExactImageToSlots(canvas, slots, exactScraped.imageUrl);
        slots = applied.slots;
        await executionLogService.log({
          tenantId,
          contentId,
          workflowStep: 'competitor:exact_image',
          engine: ContentEngine.COMPETITOR,
          message: `Filled ${applied.filled} picture slot(s) with exact scraped image (contain fit): ${exactScraped.imageUrl}`,
        });
      }

      const renderOpts = {
        tenantId,
        contentId,
        brandTemplateId: brandTemplate.id,
        slots,
        imagePrompt: prompt,
        prefix: 'competitor' as const,
        referenceImageUrl: useExactImage && exactScraped ? exactScraped.imageUrl : undefined,
        forbidAiPictureFallback: useExactImage,
        context: {
          headline: post.headline,
          body: post.body,
          callToAction: post.callToAction,
          extra: sourceMaterial.slice(0, 800),
        },
      };

      try {
        const { renderBrandTemplateWithAiArt } = await import('../services/content-template.service');
        const rendered = await renderBrandTemplateWithAiArt(renderOpts);
        imageUrl = rendered.imageUrl;
        slots = rendered.slots;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await executionLogService.log({
          tenantId,
          contentId,
          workflowStep: 'competitor:brand_template_fallback',
          engine: ContentEngine.COMPETITOR,
          message: msg,
        });

        if (useExactImage && exactScraped) {
          // Exact mode: never swap in AI art. Retry plate with local scraped URL (SVG / re-upload).
          const canvas = (brandTemplate.canvas as BrandCanvas | null) || {
            width: 1080,
            height: 1080,
            layers: [],
          };
          const { slots: exactSlots } = applyExactImageToSlots(
            canvas,
            { ...slots },
            exactScraped.imageUrl,
          );
          try {
            const { renderBrandTemplateWithAiArt } = await import(
              '../services/content-template.service'
            );
            const rendered = await renderBrandTemplateWithAiArt({
              ...renderOpts,
              slots: exactSlots,
              referenceImageUrl: exactScraped.imageUrl,
              forbidAiPictureFallback: true,
            });
            imageUrl = rendered.imageUrl;
            slots = rendered.slots;
          } catch (retryErr) {
            const canvas = (
              brandTemplate.canvas && typeof brandTemplate.canvas === 'object'
                ? structuredClone(brandTemplate.canvas)
                : defaultBrandCanvas({
                    companyName: brandSettings?.companyName || undefined,
                    backgroundUrl: brandTemplate.backgroundUrl || undefined,
                  })
            ) as BrandCanvas;
            if (brandTemplate.backgroundUrl) {
              canvas.background = { type: 'image', value: brandTemplate.backgroundUrl };
            }
            try {
              const svg = await renderBrandCanvasSvg(canvas, exactSlots);
              const saved = await saveRenderedSvg(tenantId, svg, 'competitor');
              imageUrl = saved.publicUrl;
              slots = exactSlots;
              await executionLogService.log({
                tenantId,
                contentId,
                workflowStep: 'competitor:brand_template_svg_fallback',
                engine: ContentEngine.COMPETITOR,
                message:
                  retryErr instanceof Error ? retryErr.message : String(retryErr),
              });
            } catch {
              imageUrl = exactScraped.imageUrl;
            }
          }
        } else {
          // New-topic: clear picture URLs and regenerate AI into the plate.
          try {
            const retrySlots = { ...slots };
            const pictureKeys = pictureLayersForFill(
              (brandTemplate.canvas as BrandCanvas | null) || { width: 1080, height: 1080, layers: [] },
              { exactMode: false },
            ).map((l) => l.slot || l.id);
            for (const key of pictureKeys) {
              delete retrySlots[key];
            }
            const { renderBrandTemplateWithAiArt } = await import(
              '../services/content-template.service'
            );
            const rendered = await renderBrandTemplateWithAiArt({
              ...renderOpts,
              slots: retrySlots,
              forbidAiPictureFallback: false,
            });
            imageUrl = rendered.imageUrl;
            slots = rendered.slots;
            await executionLogService.log({
              tenantId,
              contentId,
              workflowStep: 'competitor:brand_template_retry',
              engine: ContentEngine.COMPETITOR,
              message: 'Retried brand template with AI-filled picture slots',
            });
          } catch (retryErr) {
            const canvas = (
              brandTemplate.canvas && typeof brandTemplate.canvas === 'object'
                ? structuredClone(brandTemplate.canvas)
                : defaultBrandCanvas({
                    companyName: brandSettings?.companyName || undefined,
                    backgroundUrl: brandTemplate.backgroundUrl || undefined,
                  })
            ) as BrandCanvas;
            if (brandTemplate.backgroundUrl) {
              canvas.background = { type: 'image', value: brandTemplate.backgroundUrl };
            }
            try {
              const svg = await renderBrandCanvasSvg(canvas, slots);
              const saved = await saveRenderedSvg(tenantId, svg, 'competitor');
              imageUrl = saved.publicUrl;
              await executionLogService.log({
                tenantId,
                contentId,
                workflowStep: 'competitor:brand_template_svg_fallback',
                engine: ContentEngine.COMPETITOR,
                message:
                  retryErr instanceof Error ? retryErr.message : String(retryErr),
              });
            } catch {
              // leave imageUrl null — generation will surface without image
            }
          }
        }
      }
    } else if (useExactImage && exactScraped) {
      // No brand template: post image IS the scraped photo, byte-for-byte (cached URL).
      imageUrl = exactScraped.imageUrl;
      await executionLogService.log({
        tenantId,
        contentId,
        workflowStep: 'competitor:exact_image',
        engine: ContentEngine.COMPETITOR,
        message: `Using exact scraped image: ${imageUrl}`,
      });
    }

    const { buildPlatformCaptionsFromIntent, normalizeHashtags } = await import(
      '../services/platform-captions'
    );
    const hashtags = normalizeHashtags(post.hashtags || []);
    const platformCaptions = buildPlatformCaptionsFromIntent({}, {
      headline: post.headline,
      body: post.body,
      hashtags,
      callToAction: post.callToAction ?? null,
    });

    await prisma.generatedContent.update({
      where: { id: contentId },
      data: {
        headline: post.headline,
        body: post.body,
        hashtags,
        callToAction: post.callToAction,
        platformCaptions,
        imagePrompt: post.imagePrompt,
        sourceReference: scrapedPost.postUrl || `scraped:${scrapedPost.id}`,
        competitorId: competitor.id,
        brandTemplateId: brandTemplate?.id ?? null,
        ...(brandTemplate ? { templateSlots: slots } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(opts.platforms?.length ? { targetPlatforms: opts.platforms } : {}),
        status: 'generating',
      },
    });

    // Only generate AI art when NOT using the exact scraped image
    if (!brandTemplate && !useExactImage) {
      const isB2c = String(brandSettings?.brandType || 'b2b').toLowerCase() === 'b2c';
      if (opts.visualMode === 'ai_baked_layout') {
        const { attachBakedPosterForContent } = await import('../services/baked-poster.service');
        await attachBakedPosterForContent({
          tenantId,
          contentId,
          companyName: brandSettings?.companyName || 'Brand',
          headline: post.headline,
          body: post.body,
          callToAction: post.callToAction,
          topic: competitor.name,
          visualStyleId: isB2c ? 'cinematic_photo' : 'professional_photo',
          brandImageStyle: brandSettings?.imageStyle,
          playId: 'announcement',
        });
      } else {
        const { attachGeneratedImage } = await import('../services/image-attach.service');
        await attachGeneratedImage(tenantId, contentId, post.imagePrompt, {
          brandImageStyle: brandSettings?.imageStyle,
          companyName: brandSettings?.companyName,
          logoUrl:
            preferOriginalLogoUrl(brandSettings?.logoUrl) || brandSettings?.logoUrl || null,
          creativeType: 'social',
          format: 'instagram_square',
          headerText: post.headline,
          footerCta: post.callToAction || null,
          overlay: { overlaysEnabled: true },
          visualStyleId: isB2c ? 'cinematic_photo' : 'professional_photo',
          posterQuality: true,
          contentBrief: `${post.headline} — ${post.body.slice(0, 220)}`.slice(0, 420),
          throwOnError: true,
        });
      }
    }

    await prisma.competitor.update({
      where: { id: competitor.id },
      data: { lastUsedAt: new Date() },
    });

    const { applyGenerationOutcome } = await import('../services/generation-outcome.service');
    const outcome = await applyGenerationOutcome(tenantId, contentId, {
      platforms: opts.platforms,
      requireApproval: opts.requireApproval,
    });

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'competitor:complete',
      engine: ContentEngine.COMPETITOR,
      status: ExecutionStatus.SUCCESS,
      durationMs: Date.now() - start,
      message: outcome === 'publishing' ? 'Auto-publishing' : 'Ready for approval',
    });
  }
}
