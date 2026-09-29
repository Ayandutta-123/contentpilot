import { ContentEngine, ExecutionStatus } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { selectNextTopic } from '../services/rotation.service';
import { createSearchProvider, type SearchResult } from '../providers/search';
import { LLMService, buildSystemPrompt } from '../services/llm.service';
import { resolveProviders } from '../services/providers.service';
import { executionLogService } from '../services/execution-log.service';
import { assertGenerationActive } from '../services/generation-abort.service';
import {
  defaultBrandCanvas,
  renderBrandCanvasSvg,
  saveRenderedSvg,
  isLayerDynamic,
  type BrandCanvas,
} from '../providers/templates/brand-renderer';
import { preferOriginalLogoUrl } from '../lib/store-upload';

export type TrendsGenerateOpts = {
  topicId?: string;
  sources?: SearchResult[];
  useBrandTemplate?: boolean;
  brandTemplateId?: string;
  visualMode?: 'existing_template' | 'ai' | 'ai_baked_layout';
  platforms?: Array<'instagram' | 'linkedin' | 'facebook' | 'twitter'>;
  requireApproval?: boolean;
};

export class TrendsEngine {
  async generate(tenantId: string, contentId: string, opts: TrendsGenerateOpts = {}): Promise<void> {
    const start = Date.now();
    await assertGenerationActive(contentId);
    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'trends:select_topic',
      engine: ContentEngine.TRENDS,
    });

    const topic = opts.topicId
      ? await prisma.topic.findFirst({
          where: { id: opts.topicId, tenantId, deletedAt: null, isActive: true },
        })
      : await selectNextTopic(tenantId);

    if (!topic) {
      throw new Error('No active topics configured. Add topics in Settings → Topics.');
    }

    const [brandSettings, providers] = await Promise.all([
      prisma.brandSettings.findUnique({ where: { tenantId } }),
      resolveProviders(tenantId),
    ]);

    let results: SearchResult[] = opts.sources?.length ? opts.sources : [];

    if (results.length === 0) {
      const query = topic.searchKeywords || topic.name;
      const search = createSearchProvider(providers);

      await executionLogService.log({
        tenantId,
        contentId,
        workflowStep: 'trends:search',
        engine: ContentEngine.TRENDS,
        message: `Searching via ${providers.searchProvider} (last 7 days): ${query}`,
      });

      results = await search.search(query, { maxResults: 5, days: 7 });
    } else {
      await executionLogService.log({
        tenantId,
        contentId,
        workflowStep: 'trends:search',
        engine: ContentEngine.TRENDS,
        message: `Using ${results.length} manually selected source(s)`,
      });
    }

    if (results.length === 0) {
      throw new Error(`No search results found for topic: ${topic.name}`);
    }

    // Primary = first selected article — caption / hashtags / poster must match THIS story.
    const primary = results[0]!;
    const supporting = results.slice(1);

    // Exact article hero image: provider thumbnail → og:image scrape
    const { resolveArticleHeroImage } = await import('../lib/article-hero-image');
    const exactHeroUrl = await resolveArticleHeroImage(primary.url, primary.imageUrl);
    const useExactImage = Boolean(exactHeroUrl);

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'trends:exact_story',
      engine: ContentEngine.TRENDS,
      message: `Primary: "${primary.title.slice(0, 120)}" · exactImage=${useExactImage ? 'yes' : 'no'}${
        exactHeroUrl ? ` · ${exactHeroUrl.slice(0, 100)}` : ''
      }`,
    });

    const sourceMaterial = [
      `[PRIMARY ARTICLE — write the post ABOUT THIS exact story]\nTitle: ${primary.title}\n${primary.snippet}\nSource: ${primary.url}${
        primary.publishedDate ? `\nPublished: ${primary.publishedDate}` : ''
      }`,
      ...supporting.map(
        (r, i) =>
          `[Supporting ${i + 1}]\nTitle: ${r.title}\n${r.snippet}\nSource: ${r.url}`,
      ),
    ].join('\n\n');

    const llm = await LLMService.forTenant(tenantId);
    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'trends:generate',
      engine: ContentEngine.TRENDS,
      message: `LLM: ${providers.llmProvider}/${providers.llmModel}`,
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

    const post = await llm.generatePost({
      systemPrompt: buildSystemPrompt(brandSettings ?? {
        brandVoice: '', imageStyle: '', hashtagStrategy: '', contentGuidelines: '', targetAudience: '',
      }),
      userPrompt: `You are writing ONE social post grounded in a REAL news article the user selected.

PRIMARY STORY (must drive headline, body, hashtags, CTA, and imagePrompt — do NOT invent a different topic):
Title: ${primary.title}
URL: ${primary.url}
${primary.snippet}

Topic label from settings (context only, not a substitute for the article): "${topic.name}"

${supporting.length ? `Optional supporting context (do not switch the story away from PRIMARY):\n${supporting
  .map((r) => `- ${r.title} (${r.url})`)
  .join('\n')}\n` : ''}
Rules:
- Caption + hashtags must clearly be about the PRIMARY article facts (who/what/where), not a generic "${topic.name}" fluff post.
- Do NOT fabricate quotes, numbers, or claims that are not in the PRIMARY snippet/title.
- imagePrompt must describe a photo matching the PRIMARY story scene (people/places/industry of THAT article).
- Include sourceAttribution with the PRIMARY URL.
${
  brandTemplate
    ? `\nBrand template on-image text will be filled separately into these layer slots: ${dynamicSlots.join(', ') || 'title, subtitle'}. Write a strong feed caption; imagePrompt must describe PHOTOGRAPHY ONLY with no text or logos (Placid places typography).`
    : ''
}${
  useExactImage
    ? '\nAn exact article photo will be used on the poster when possible — imagePrompt is backup only if that photo cannot be applied.'
    : ''
}`,
    });

    let slots: Record<string, string> = {};
    if (post.headline) {
      slots.headline = post.headline;
      slots.title = post.headline;
    }
    if (post.callToAction) slots.cta = post.callToAction;
    if (post.body) {
      slots.body = post.body.slice(0, 220);
      slots.subtext = post.body.slice(0, 120);
      slots.subtitle = post.body.split(/[.!?]/)[0]?.trim() || post.body.slice(0, 120);
      slots.subheadline = slots.subtitle;
    }

    let imageUrl: string | null = null;
    await assertGenerationActive(contentId);
    if (brandTemplate) {
      await executionLogService.log({
        tenantId,
        contentId,
        workflowStep: 'trends:brand_template',
        engine: ContentEngine.TRENDS,
        message: useExactImage
          ? `Fill brand/Placid template ${brandTemplate.name} + EXACT article image`
          : `Fill brand/Placid template ${brandTemplate.name}`,
      });

      const prompt =
        post.imagePrompt?.trim() ||
        `Photorealistic editorial photo for this news story: ${primary.title}. ${post.body.slice(0, 160)}`;

      if (useExactImage && exactHeroUrl) {
        const { applyExactImageToSlots } = await import('../services/fill-brand-template.service');
        const canvas = (brandTemplate.canvas as BrandCanvas | null) || {
          width: 1080,
          height: 1080,
          layers: [],
        };
        const applied = applyExactImageToSlots(canvas, slots, exactHeroUrl);
        slots = applied.slots;
      }

      try {
        const { renderBrandTemplateWithAiArt } = await import('../services/content-template.service');
        const rendered = await renderBrandTemplateWithAiArt({
          tenantId,
          contentId,
          brandTemplateId: brandTemplate.id,
          slots,
          imagePrompt: prompt,
          prefix: 'trends',
          referenceImageUrl: useExactImage ? exactHeroUrl : undefined,
          forbidAiPictureFallback: useExactImage,
          context: {
            topic: topic.name,
            headline: post.headline,
            body: post.body,
            callToAction: post.callToAction,
            extra: `PRIMARY ARTICLE: ${primary.title}\n${primary.url}\n${sourceMaterial.slice(0, 700)}`,
          },
        });
        imageUrl = rendered.imageUrl;
        slots = rendered.slots;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await executionLogService.log({
          tenantId,
          contentId,
          workflowStep: 'trends:brand_template_fallback',
          engine: ContentEngine.TRENDS,
          message: msg,
        });
        if (useExactImage && exactHeroUrl) {
          imageUrl = exactHeroUrl;
        } else {
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
          const svg = await renderBrandCanvasSvg(canvas, slots);
          const saved = await saveRenderedSvg(tenantId, svg, 'trends');
          imageUrl = saved.publicUrl;
        }
      }
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
        sourceReference: primary.url || post.sourceAttribution || results.map((r) => r.url).filter(Boolean).join('\n'),
        topicId: topic.id,
        brandTemplateId: brandTemplate?.id ?? null,
        ...(brandTemplate ? { templateSlots: slots } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(opts.platforms?.length ? { targetPlatforms: opts.platforms } : {}),
        status: 'generating',
      },
    });

    if (!brandTemplate) {
      const isB2c = String(brandSettings?.brandType || 'b2b').toLowerCase() === 'b2c';
      const storyBrief = `${primary.title} — ${post.headline} — ${post.body.slice(0, 200)}`.slice(0, 420);

      if (useExactImage && exactHeroUrl && opts.visualMode !== 'ai_baked_layout') {
        // Exact article photo as the post image (AI/LLM layout still uses overlays when framing)
        await executionLogService.log({
          tenantId,
          contentId,
          workflowStep: 'trends:exact_image',
          engine: ContentEngine.TRENDS,
          message: `Using exact article image: ${exactHeroUrl.slice(0, 160)}`,
        });
        const { attachGeneratedImage } = await import('../services/image-attach.service');
        try {
          await attachGeneratedImage(tenantId, contentId, post.imagePrompt || primary.title, {
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
            contentBrief: storyBrief,
            referenceImageUrl: exactHeroUrl,
            throwOnError: true,
          });
        } catch {
          // If framing fails, still persist the exact news photo
          await prisma.generatedContent.update({
            where: { id: contentId },
            data: { imageUrl: exactHeroUrl },
          });
        }
      } else if (opts.visualMode === 'ai_baked_layout') {
        const { attachBakedPosterForContent } = await import('../services/baked-poster.service');
        await attachBakedPosterForContent({
          tenantId,
          contentId,
          companyName: brandSettings?.companyName || 'Brand',
          headline: post.headline,
          body: post.body,
          callToAction: post.callToAction,
          topic: `${topic.name}: ${primary.title}`.slice(0, 200),
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
          contentBrief: storyBrief,
          referenceImageUrl: exactHeroUrl || undefined,
          throwOnError: true,
        });
      }
    }

    const { applyGenerationOutcome } = await import('../services/generation-outcome.service');
    const outcome = await applyGenerationOutcome(tenantId, contentId, {
      platforms: opts.platforms,
      requireApproval: opts.requireApproval,
    });

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'trends:complete',
      engine: ContentEngine.TRENDS,
      status: ExecutionStatus.SUCCESS,
      durationMs: Date.now() - start,
      message: outcome === 'publishing' ? 'Auto-publishing' : 'Ready for approval',
    });
  }
}
