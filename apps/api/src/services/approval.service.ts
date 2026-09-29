import { config } from '../config';
import { prisma } from '../lib/prisma';
import { ApprovalAction, ExecutionStatus } from '@contentpilot/shared';
import { LLMService, buildSystemPrompt } from './llm.service';
import { notifyApprovalPending } from '../providers/notifications';
import { executionLogService } from './execution-log.service';
import { asStringArray } from '../lib/json';
import {
  describeTemplateLayers,
  loadBrandCanvas,
  renderContentFromTemplate,
  slotsFromJson,
  type TemplateSlotMap,
} from './content-template.service';
import { isLayerDynamic } from '../providers/templates/brand-renderer';
import { extractCarouselPayload } from '../lib/carousel-parse';
import type { PosterSpec } from '../providers/images/poster-frame';

interface ProcessApprovalInput {
  contentId: string;
  reviewerId: string;
  action: ApprovalAction;
  feedback?: string;
  editedContent?: {
    headline?: string;
    body?: string;
    hashtags?: string[];
    callToAction?: string;
    platformCaptions?: {
      instagram?: { headline: string; body: string; hashtags: string[]; callToAction?: string | null };
      linkedin?: { headline: string; body: string; hashtags: string[]; callToAction?: string | null };
      facebook?: { headline: string; body: string; hashtags: string[]; callToAction?: string | null };
      twitter?: { headline: string; body: string; hashtags: string[]; callToAction?: string | null };
    };
  };
  platforms?: string[];
}

class ApprovalService {
  async processDecision(input: ProcessApprovalInput): Promise<{ nextAction: string; contentId: string }> {
    const content = await prisma.generatedContent.findUniqueOrThrow({
      where: { id: input.contentId },
    });

    await prisma.approvalDecision.create({
      data: {
        contentId: input.contentId,
        reviewerId: input.reviewerId,
        action: input.action,
        feedback: input.feedback,
        editedContent: input.editedContent ?? undefined,
        platforms: (input.platforms ?? []) as ('instagram' | 'linkedin' | 'facebook' | 'twitter')[],
      },
    });

    switch (input.action) {
      case ApprovalAction.APPROVE:
        return this.handleApprove(
          input.contentId,
          input.platforms ?? asStringArray(content.targetPlatforms),
        );

      case ApprovalAction.REJECT_EDIT:
        return this.handleDirectEdit(input.contentId, input.editedContent!);

      case ApprovalAction.REJECT_REGENERATE:
        return this.handleRegenerate(content, input.feedback);

      default:
        throw new Error(`Unknown approval action: ${input.action}`);
    }
  }

  private async handleApprove(contentId: string, platforms: string[]) {
    if (!platforms.length) {
      throw new Error('Select at least one connected channel to publish.');
    }
    await prisma.generatedContent.update({
      where: { id: contentId },
      data: {
        status: 'approved',
        targetPlatforms: platforms as ('instagram' | 'linkedin' | 'facebook' | 'twitter')[],
      },
    });

    return { nextAction: 'publish', contentId };
  }

  private async handleDirectEdit(
    contentId: string,
    editedContent: NonNullable<ProcessApprovalInput['editedContent']>,
  ) {
    const existing = await prisma.generatedContent.findUniqueOrThrow({ where: { id: contentId } });
    // Prefer LinkedIn variant as primary fields for backward compatibility
    const primary = editedContent.platformCaptions?.linkedin;
    const headline = primary?.headline ?? editedContent.headline;
    const body = primary?.body ?? editedContent.body;
    const hashtags = primary?.hashtags ?? editedContent.hashtags;
    const callToAction =
      primary?.callToAction !== undefined ? primary.callToAction ?? undefined : editedContent.callToAction;

    const slots = slotsFromJson(existing.templateSlots);
    // Do not map caption → plate text here; plate slots already hold Dynamic on-image text.
    // Only fill empty legacy aliases so older content still renders.
    if (headline && !slots.headline?.trim() && !slots.title?.trim() && !slots.TITLE?.trim()) {
      slots.headline = headline;
    }
    if (callToAction && !slots.subheadline?.trim() && !slots.subtitle?.trim() && !slots.SUBTITLE?.trim()) {
      slots.subheadline = callToAction;
      slots.offer = callToAction;
    }
    if (body && !slots.body?.trim()) {
      slots.body = body.slice(0, 280);
    }

    let imageUrl = existing.imageUrl;
    if (existing.brandTemplateId) {
      const rendered = await renderContentFromTemplate({
        tenantId: existing.tenantId,
        brandTemplateId: existing.brandTemplateId,
        slots,
        prefix: 'approval-edit',
        lockProvidedSlots: true,
      });
      imageUrl = rendered.imageUrl;
      Object.assign(slots, rendered.slots);
    }

    const { mergeTemplateSlots } = await import('../lib/carousel-parse');
    await prisma.generatedContent.update({
      where: { id: contentId },
      data: {
        headline,
        body,
        hashtags,
        callToAction,
        ...(editedContent.platformCaptions !== undefined
          ? { platformCaptions: editedContent.platformCaptions }
          : {}),
        templateSlots: mergeTemplateSlots(existing.templateSlots, slots) as object,
        ...(imageUrl ? { imageUrl } : {}),
        status: 'pending_approval',
        revisionCount: { increment: 1 },
      },
    });

    const updated = await prisma.generatedContent.findUniqueOrThrow({ where: { id: contentId } });
    await notifyApprovalPending(updated);

    return { nextAction: 're_review', contentId };
  }

  private async handleRegenerate(
    content: {
      id: string;
      tenantId: string;
      engine: string;
      revisionCount: number;
      headline: string;
      body: string;
      hashtags: unknown;
      brandTemplateId?: string | null;
      templateSlots?: unknown;
      imagePrompt?: string | null;
    },
    feedback?: string,
  ) {
    if (content.revisionCount >= config.MAX_REVISION_CYCLES) {
      await prisma.generatedContent.update({
        where: { id: content.id },
        data: { status: 'manual_intervention' },
      });

      await executionLogService.log({
        tenantId: content.tenantId,
        contentId: content.id,
        workflowStep: 'approval:max_revisions',
        status: ExecutionStatus.HARD_FAILURE,
        message: `Max revision cycles (${config.MAX_REVISION_CYCLES}) exceeded`,
      });

      return { nextAction: 'manual_intervention', contentId: content.id };
    }

    const brandSettings = await prisma.brandSettings.findUnique({
      where: { tenantId: content.tenantId },
    });

    await executionLogService.log({
      tenantId: content.tenantId,
      contentId: content.id,
      workflowStep: 'approval:regenerate',
      message: `Revision ${content.revisionCount + 1}, feedback: ${feedback ?? 'none'}`,
    });

    const llm = await LLMService.forTenant(content.tenantId);
    const changePrompt =
      (feedback || '').trim() ||
      'Please improve the overall quality of the caption, hashtags, and on-image text.';

    const post = await llm.generatePost({
      systemPrompt: buildSystemPrompt(brandSettings ?? {
        brandVoice: '', imageStyle: '', hashtagStrategy: '', contentGuidelines: '', targetAudience: '',
      }),
      userPrompt: `Revise this social media post based on the reviewer's change request. Keep facts accurate. Update headline, body, hashtags, and image prompt as needed.

Previous version:
Headline: ${content.headline}
Body: ${content.body}
Hashtags: ${asStringArray(content.hashtags).join(', ')}

Reviewer wants changed: ${changePrompt}

Generate an improved version that specifically addresses that request.`,
    });

    let slots: TemplateSlotMap = {
      ...slotsFromJson(content.templateSlots),
      headline: post.headline,
      subheadline: post.callToAction || post.body.slice(0, 120),
      body: post.body.slice(0, 280),
      offer: post.callToAction || '',
    };

    let imageUrl: string | null | undefined;

    if (content.brandTemplateId) {
      const loaded = await loadBrandCanvas(content.tenantId, content.brandTemplateId);
      const dynamicSlots = loaded
        ? (loaded.canvas.layers || [])
            .filter((l) => isLayerDynamic(l) && l.type === 'text')
            .map((l) => l.slot || l.id)
        : [];

      if (dynamicSlots.length) {
        try {
          const slotJson = await llm.generateRawJson({
            systemPrompt: 'Return JSON only. Fill each key with short on-brand copy for a social graphic.',
            userPrompt: `Change request: ${changePrompt}\nHeadline: ${post.headline}\nBody: ${post.body}\nFill these slots: ${JSON.stringify(dynamicSlots)}`,
          });
          for (const [k, v] of Object.entries(slotJson)) {
            if (typeof v === 'string') slots[k] = v;
            else if (v != null) slots[k] = JSON.stringify(v);
          }
          if (!slots.headline) slots.headline = post.headline;
        } catch {
          // keep merged defaults
        }
      }

      // Generate fresh AI photography into hero slots, then composite on template
      try {
        const { renderBrandTemplateWithAiArt } = await import('./content-template.service');
        const withArt = await renderBrandTemplateWithAiArt({
          tenantId: content.tenantId,
          contentId: content.id,
          brandTemplateId: content.brandTemplateId,
          slots,
          imagePrompt:
            post.imagePrompt?.trim() ||
            `Photorealistic marketing photo for: ${post.headline}. ${post.body.slice(0, 160)}`,
          prefix: 'approval-regen-ai',
        });
        imageUrl = withArt.imageUrl;
        slots = withArt.slots;
      } catch {
        const rendered = await renderContentFromTemplate({
          tenantId: content.tenantId,
          brandTemplateId: content.brandTemplateId,
          slots,
          prefix: 'approval-regen',
        });
        imageUrl = rendered.imageUrl;
      }
    }

    const { buildPlatformCaptionsFromIntent, normalizeHashtags } = await import('./platform-captions');
    const { mergeTemplateSlots, extractCarouselPayload, clampSlideCount } = await import(
      '../lib/carousel-parse'
    );
    const hashtags = normalizeHashtags(post.hashtags || []);
    const platformCaptions = buildPlatformCaptionsFromIntent({}, {
      headline: post.headline,
      body: post.body,
      hashtags,
      callToAction: post.callToAction ?? null,
    });

    await prisma.generatedContent.update({
      where: { id: content.id },
      data: {
        headline: post.headline,
        body: post.body,
        hashtags,
        callToAction: post.callToAction,
        platformCaptions,
        imagePrompt: post.imagePrompt,
        templateSlots: mergeTemplateSlots(content.templateSlots, slots) as object,
        ...(imageUrl ? { imageUrl } : {}),
        status: 'pending_approval',
        revisionCount: { increment: 1 },
      },
    });

    // If no brand template, refresh AI image using new prompt (carousel → all slides)
    if (!content.brandTemplateId && post.imagePrompt) {
      try {
        const { attachGeneratedImage } = await import('./image-attach.service');
        const existingCarousel = extractCarouselPayload(content.templateSlots);
        const prevSlotsRaw =
          content.templateSlots && typeof content.templateSlots === 'object' && !Array.isArray(content.templateSlots)
            ? (content.templateSlots as Record<string, unknown>)
            : {};
        // Designed poster? Rewrite the layout brief from the revised copy.
        let posterSpec: PosterSpec | null = null;
        if (prevSlotsRaw.posterSpec && typeof prevSlotsRaw.posterSpec === 'object') {
          const { generatePosterSpecRespectingTemplate } = await import('./poster-spec.service');
          const locked = await generatePosterSpecRespectingTemplate({
            tenantId: content.tenantId,
            posterTemplateId:
              typeof prevSlotsRaw.posterTemplateId === 'string' ? prevSlotsRaw.posterTemplateId : null,
            topic: post.headline,
            brief: post.imagePrompt,
            headline: post.headline,
            body: post.body,
            callToAction: post.callToAction,
            layout:
              typeof prevSlotsRaw.posterLayout === 'string'
                ? (prevSlotsRaw.posterLayout as import('../providers/images/poster-frame').PosterLayoutId)
                : null,
          });
          posterSpec = locked.spec;
          if (locked.layout) prevSlotsRaw.posterLayout = locked.layout;
          if (locked.template) prevSlotsRaw.posterTemplateId = locked.template.id;
        }
        if (existingCarousel && existingCarousel.slides.length >= 2) {
          const slideCount = clampSlideCount(existingCarousel.slideCount);
          const brand = await prisma.brandSettings.findUnique({ where: { tenantId: content.tenantId } });
          const { preferOriginalLogoUrl } = await import('../lib/store-upload');
          const slides = [];
          for (let i = 0; i < slideCount; i++) {
            const prev = existingCarousel.slides[i];
            const headline = prev?.headline || (i === 0 ? post.headline : `${post.headline} · ${i + 1}`);
            const slideSpec = posterSpec
              ? { ...((prev?.posterSpec as PosterSpec | null) || posterSpec), headline }
              : null;
            const imagePrompt =
              slideSpec?.artPrompt ||
              (i === 0
                ? post.imagePrompt
                : `${post.imagePrompt}. Slide ${i + 1} of ${slideCount} — continue the same visual story, distinct composition.`);
            const attached = await attachGeneratedImage(content.tenantId, content.id, imagePrompt, {
              brandImageStyle: brand?.imageStyle,
              companyName: brand?.companyName,
              logoUrl: preferOriginalLogoUrl(brand?.logoUrl) || brand?.logoUrl || null,
              creativeType: slideSpec ? 'poster' : 'social',
              posterSpec: slideSpec,
              posterLayout:
                (typeof prev?.posterLayout === 'string' && prev.posterLayout
                  ? (prev.posterLayout as import('../providers/images/poster-frame').PosterLayoutId)
                  : null) ||
                (typeof prevSlotsRaw.posterLayout === 'string'
                  ? (prevSlotsRaw.posterLayout as import('../providers/images/poster-frame').PosterLayoutId)
                  : undefined) ||
                'hero_right',
              slideLabel: slideSpec ? `${i + 1} / ${slideCount}` : null,
              negativePrompt: slideSpec?.artNegativePrompt ?? null,
              format: 'instagram_square',
              headerText: headline,
              footerCta:
                i === slideCount - 1 ? post.callToAction || null : `Slide ${i + 1} / ${slideCount}`,
              overlay: { overlaysEnabled: true },
              posterQuality: true,
              contentBrief: `${headline} — ${post.body.slice(0, 180)}`.slice(0, 420),
              savePrompt: false,
              skipPersist: true,
              throwOnError: true,
            });
            if (!attached?.imageUrl) throw new Error(`Carousel slide ${i + 1} failed`);
            slides.push({
              index: i + 1,
              headline,
              imagePrompt,
              imageUrl: attached.imageUrl,
              rawImageUrl: attached.rawImageUrl || null,
              posterLayout: prev?.posterLayout || prevSlotsRaw.posterLayout || null,
              ...(slideSpec ? { posterSpec: slideSpec as unknown as Record<string, unknown> } : {}),
            });
          }
          const cover = slides[0];
          const prevSlots = prevSlotsRaw;
          await prisma.generatedContent.update({
            where: { id: content.id },
            data: {
              imageUrl: cover.imageUrl,
              rawImageUrl: cover.rawImageUrl || null,
              imagePrompt: cover.imagePrompt,
              templateSlots: {
                ...prevSlots,
                ...slots,
                format: 'carousel',
                ...(posterSpec ? { posterSpec: posterSpec as unknown as Record<string, unknown> } : {}),
                carousel: { slideCount: slides.length, slides },
              } as object,
            },
          });
        } else if (posterSpec) {
          const brand = await prisma.brandSettings.findUnique({ where: { tenantId: content.tenantId } });
          const { preferOriginalLogoUrl } = await import('../lib/store-upload');
          await attachGeneratedImage(
            content.tenantId,
            content.id,
            posterSpec.artPrompt || post.imagePrompt,
            {
              brandImageStyle: brand?.imageStyle,
              companyName: brand?.companyName,
              logoUrl: preferOriginalLogoUrl(brand?.logoUrl) || brand?.logoUrl || null,
              creativeType: 'poster',
              posterSpec,
              posterLayout:
                typeof prevSlotsRaw.posterLayout === 'string'
                  ? (prevSlotsRaw.posterLayout as import('../providers/images/poster-frame').PosterLayoutId)
                  : undefined,
              negativePrompt: posterSpec.artNegativePrompt,
              format: 'instagram_square',
              overlay: { overlaysEnabled: true },
              posterQuality: true,
            },
          );
          await prisma.generatedContent.update({
            where: { id: content.id },
            data: {
              templateSlots: {
                ...prevSlotsRaw,
                ...slots,
                posterSpec: posterSpec as unknown as Record<string, unknown>,
              } as object,
            },
          });
        } else {
          await attachGeneratedImage(
            content.tenantId,
            content.id,
            post.imagePrompt,
            brandSettings?.imageStyle,
          );
        }
      } catch {
        // keep text revision even if image fails
      }
    }

    const updated = await prisma.generatedContent.findUniqueOrThrow({ where: { id: content.id } });
    await notifyApprovalPending(updated);

    return { nextAction: 're_review', contentId: content.id };
  }

  async getPendingApprovals(tenantId: string) {
    return prisma.generatedContent.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: ['pending_approval', 'generating', 'manual_intervention'] },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        approvals: {
          orderBy: { createdAt: 'desc' },
          include: { reviewer: { select: { name: true, email: true } } },
        },
      },
    });
  }

  /**
   * Stop a generating / pending post without deleting history — marks rejected.
   */
  async abortContent(opts: {
    tenantId: string;
    contentId: string;
    reviewerId: string;
    reason?: string;
  }) {
    const content = await prisma.generatedContent.findFirst({
      where: { id: opts.contentId, tenantId: opts.tenantId, deletedAt: null },
    });
    if (!content) throw new Error('Content not found');
    if (['published', 'publishing', 'approved'].includes(content.status)) {
      throw new Error('Published or publishing posts cannot be aborted — delete instead if needed.');
    }

    await prisma.approvalDecision.create({
      data: {
        contentId: content.id,
        reviewerId: opts.reviewerId,
        action: 'reject_edit',
        feedback: opts.reason?.trim() || 'Aborted by reviewer — generation / review cancelled.',
      },
    });

  await prisma.generatedContent.update({
    where: { id: content.id },
    data: { status: 'rejected' },
  });

  try {
    const { cancelQueuedGeneration } = await import('../workers');
    await cancelQueuedGeneration(content.id);
  } catch (err) {
    console.warn('[abort] queue cancel failed', err);
  }

  await executionLogService.log({
    tenantId: opts.tenantId,
    contentId: content.id,
    workflowStep: 'approval:abort',
    message: opts.reason?.trim() || 'Content aborted from Approvals',
    status: ExecutionStatus.SUCCESS,
  });

  let calendarEntry = null;
  try {
    const { releasePlanEntriesForContent } = await import('./calendar-plan-schedule.service');
    calendarEntry = await releasePlanEntriesForContent(content.id, 'aborted');
  } catch {
    calendarEntry = null;
  }

  return { id: content.id, status: 'rejected' as const, calendarEntry };
}

  /**
   * Permanently delete a post from Postgres (and cascaded publish/approval rows).
   * Approvals Delete / Clear queue use this — not soft-delete.
   */
  async deleteContent(opts: { tenantId: string; contentId: string; reviewerId: string }) {
    const content = await prisma.generatedContent.findFirst({
      where: { id: opts.contentId, tenantId: opts.tenantId },
    });
    if (!content) throw new Error('Content not found');
    if (content.status === 'publishing') {
      throw new Error('Wait until publishing finishes before deleting.');
    }

    let calendarEntry = null;
    try {
      const { releasePlanEntriesForContent } = await import('./calendar-plan-schedule.service');
      calendarEntry = await releasePlanEntriesForContent(content.id, 'deleted');
    } catch {
      calendarEntry = null;
    }

    // Detach optional FKs that do not cascade, then remove the row.
    await prisma.executionLog.updateMany({
      where: { contentId: content.id },
      data: { contentId: null },
    });

    await prisma.generatedContent.delete({
      where: { id: content.id },
    });

    await executionLogService.log({
      tenantId: opts.tenantId,
      workflowStep: 'approval:delete',
      message: `Hard-deleted content ${content.id} by user ${opts.reviewerId}`,
      status: ExecutionStatus.SUCCESS,
    });

    return { id: content.id, deleted: true as const, calendarEntry };
  }

  /** Permanently delete all queue items (pending / generating / stuck). */
  async clearApprovalQueue(opts: { tenantId: string; reviewerId: string }) {
    const where = {
      tenantId: opts.tenantId,
      status: {
        in: ['pending_approval', 'generating', 'manual_intervention', 'rejected', 'failed'] as Array<
          'pending_approval' | 'generating' | 'manual_intervention' | 'rejected' | 'failed'
        >,
      },
    };
    const doomed = await prisma.generatedContent.findMany({
      where,
      select: { id: true },
    });

    try {
      const { releasePlanEntriesForContent } = await import('./calendar-plan-schedule.service');
      await Promise.all(doomed.map((row) => releasePlanEntriesForContent(row.id, 'deleted')));
    } catch {
      // calendar rows stay stale until the next calendar list reconcile
    }

    const ids = doomed.map((row) => row.id);
    if (ids.length) {
      await prisma.executionLog.updateMany({
        where: { contentId: { in: ids } },
        data: { contentId: null },
      });
      await prisma.generatedContent.deleteMany({
        where: { id: { in: ids }, tenantId: opts.tenantId },
      });
    }

    await executionLogService.log({
      tenantId: opts.tenantId,
      workflowStep: 'approval:clear_queue',
      message: `Hard-deleted ${ids.length} item(s) from Approvals queue`,
      status: ExecutionStatus.SUCCESS,
    });

    return { cleared: ids.length };
  }

  /** Enrich content for Approvals detail UI */
  async getContentForReview(tenantId: string, contentId: string) {
    const content = await prisma.generatedContent.findFirst({
      where: { id: contentId, tenantId, deletedAt: null },
      include: {
        approvals: {
          orderBy: { createdAt: 'desc' },
          include: { reviewer: { select: { name: true, email: true } } },
        },
        publishLogs: true,
        brandTemplate: {
          select: { id: true, name: true, backgroundUrl: true, canvas: true },
        },
      },
    });
    if (!content) return null;

    const connections = await prisma.platformConnection.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      select: { id: true, platform: true, accountName: true },
      orderBy: { platform: 'asc' },
    });

    const loaded = content.brandTemplateId
      ? await loadBrandCanvas(tenantId, content.brandTemplateId)
      : null;

    return {
      ...content,
      templateSlots: slotsFromJson(content.templateSlots),
      carousel: extractCarouselPayload(content.templateSlots),
      templateLayers: loaded ? describeTemplateLayers(loaded.canvas) : [],
      templateName: loaded?.templateName || content.brandTemplate?.name || null,
      connectedPlatforms: connections,
    };
  }
}

export const approvalService = new ApprovalService();
