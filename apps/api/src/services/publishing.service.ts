import { config } from '../config';
import { prisma } from '../lib/prisma';
import { decrypt } from '../lib/encryption';
import { getPublisher, InstagramPublisher } from '../providers/publishing';
import { markEntityUsed } from './rotation.service';
import { executionLogService } from './execution-log.service';
import { notifyWorkflowFailure, notifyPublished, buildPlatformPostUrl } from '../providers/notifications';
import { ContentEngine, ExecutionStatus } from '@contentpilot/shared';
import { asStringArray } from '../lib/json';
import { notifySuccess, notifyError } from './app-notification.service';
import { captionForPlatform } from './platform-captions';
import { extractCarouselPayload } from '../lib/carousel-parse';
import { toPublicMediaUrl } from '../lib/public-media-url';
import { resolvePublishImageUrls } from '../lib/publishable-image';
import type { PublishContent } from '../providers/publishing/publishing.interface';

interface PublishInput {
  contentId: string;
  tenantId: string;
  platforms: string[];
}

class PublishingService {
  async publishToAll(input: PublishInput): Promise<void> {
    const content = await prisma.generatedContent.findUniqueOrThrow({
      where: { id: input.contentId },
    });

    await prisma.generatedContent.update({
      where: { id: input.contentId },
      data: { status: 'publishing' },
    });

    const carousel = extractCarouselPayload(content.templateSlots);
    const rawSlides = (carousel?.slides.map((s) => s.imageUrl).filter(Boolean) || []) as string[];
    const rawCover = content.imageUrl || rawSlides[0] || null;

    // Meta (IG/FB) cannot fetch localhost /uploads — host publicly (JPEG) before publish.
    // LinkedIn uploads bytes directly and does not need a public URL.
    const needsPublicHost = input.platforms.some((p) =>
      ['instagram', 'facebook'].includes(p),
    );
    let publicSlides: string[] = [];
    let publicCover: string | undefined;
    try {
      if (needsPublicHost) {
        const hosted = await resolvePublishImageUrls(input.tenantId, [
          rawCover,
          ...rawSlides.filter((u) => u !== rawCover),
        ]);
        publicCover = hosted[0];
        publicSlides = hosted.length >= 2 ? hosted : hosted[0] ? [hosted[0]] : [];
      } else {
        publicCover = toPublicMediaUrl(rawCover) || rawCover || undefined;
        publicSlides = rawSlides
          .map((u) => toPublicMediaUrl(u) || u)
          .filter(Boolean) as string[];
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.generatedContent.update({
        where: { id: input.contentId },
        data: { status: 'failed', publishError: msg },
      });
      await notifyWorkflowFailure('publish', msg, input.contentId, false, input.tenantId);
      await notifyError(input.tenantId, 'Publish failed', msg, `/logs`);
      return;
    }

    const baseContent = {
      headline: content.headline,
      body: content.body,
      hashtags: asStringArray(content.hashtags),
      callToAction: content.callToAction ?? null,
      platformCaptions: content.platformCaptions,
      imageUrl: publicCover,
      /** Original path for LinkedIn binary upload */
      localImageUrl: rawCover || undefined,
      imageUrls: publicSlides.length >= 2 ? publicSlides : undefined,
    };

    let allSucceeded = true;
    const errors: string[] = [];
    const publishedPosts: Array<{
      platform: string;
      platformPostId?: string | null;
      postUrl?: string | null;
      accountId?: string | null;
      accountName?: string | null;
    }> = [];

    for (const platform of input.platforms) {
      try {
        const caption = captionForPlatform(platform, baseContent);
        await executionLogService.log({
          tenantId: input.tenantId,
          contentId: input.contentId,
          workflowStep: `publish:${platform}:caption`,
          message: `headline=${(caption.headline || '').slice(0, 80)} bodyChars=${(caption.body || '').length} image=${Boolean(baseContent.imageUrl)}`,
        });
        const publishContent = {
          headline: caption.headline,
          body: caption.body,
          hashtags: caption.hashtags,
          imageUrl: baseContent.imageUrl,
          localImageUrl: baseContent.localImageUrl,
          imageUrls: platform === 'instagram' ? baseContent.imageUrls : undefined,
          callToAction: caption.callToAction ?? undefined,
        };
        const posted = await this.publishToPlatform(
          input.contentId,
          input.tenantId,
          platform,
          publishContent,
        );
        publishedPosts.push(posted);
      } catch (error) {
        allSucceeded = false;
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${platform}: ${msg}`);
      }
    }

    if (allSucceeded) {
      const publishedAt = new Date();
      await prisma.generatedContent.update({
        where: { id: input.contentId },
        data: {
          status: 'published',
          publishedAt,
          publishError: null,
        },
      });

      const engine = content.engine as ContentEngine;
      if (engine === ContentEngine.NEWSLETTER) {
        if (content.libraryItemId) {
          await markEntityUsed(ContentEngine.LIBRARY, content.libraryItemId);
        }
        if (content.newsletterTemplateId) {
          await markEntityUsed(ContentEngine.NEWSLETTER, content.newsletterTemplateId);
        }
      } else if (engine === ContentEngine.MEME && content.libraryItemId) {
        // Product-doc rotation for meme automations: advance only after successful publish.
        await markEntityUsed(ContentEngine.LIBRARY, content.libraryItemId);
      } else {
        const entityId = content.topicId ?? content.competitorId ?? content.libraryItemId;
        if (entityId) await markEntityUsed(engine, entityId);
      }
      if (content.brandTemplateId) {
        const { markBrandTemplateUsed } = await import('./rotation.service');
        await markBrandTemplateUsed(content.brandTemplateId);
      }
      await notifySuccess(
        input.tenantId,
        'Published successfully',
        content.headline || 'Your post is live',
        `/dashboard`,
      );
      await notifyPublished({
        tenantId: input.tenantId,
        contentId: input.contentId,
        headline: content.headline,
        body: content.body,
        hashtags: content.hashtags,
        imageUrl: content.imageUrl,
        publishedAt,
        posts: publishedPosts,
      }).catch((err) => console.warn('[publish] chat notify failed', err));
    } else {
      await prisma.generatedContent.update({
        where: { id: input.contentId },
        data: { status: 'failed', publishError: errors.join('; ') },
      });
      await notifyWorkflowFailure('publish', errors.join('; '), input.contentId, false, input.tenantId);
      await notifyError(
        input.tenantId,
        'Publish failed',
        errors.join('; '),
        `/logs`,
      );
    }
  }

  private async publishToPlatform(
    contentId: string,
    tenantId: string,
    platform: string,
    publishContent: PublishContent,
  ): Promise<{
    platform: string;
    platformPostId?: string | null;
    postUrl?: string | null;
    accountId?: string | null;
    accountName?: string | null;
  }> {
    const connection = await prisma.platformConnection.findFirst({
      where: { tenantId, platform: platform as 'instagram' | 'linkedin' | 'facebook', isActive: true },
    });

    if (!connection) {
      throw new Error(`No active ${platform} connection for tenant`);
    }

    const accessToken = await this.ensureValidToken(connection);
    const publisher = getPublisher(platform);
    let accountId = (connection.accountId || '').trim();

    // Older manual connections allowed a blank Instagram account ID. Resolve and
    // persist the linked IG Professional account before creating a media container.
    if (platform === 'instagram' && !accountId) {
      const { resolveInstagramPublishingAccount } = await import(
        './instagram-account.service'
      );
      const resolved = await resolveInstagramPublishingAccount({
        accessToken,
        accountName: connection.accountName,
      });
      accountId = resolved.accountId;
      await prisma.platformConnection.update({
        where: { id: connection.id },
        data: {
          accountId,
          accountName: resolved.accountName,
        },
      });
    }

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: `publish:${platform}:start`,
    });

    let result = await publisher.publish(publishContent, accessToken, accountId);

    if (result.needsPolling && result.containerId && publisher.checkMediaStatus) {
      result = await this.pollMediaStatus(
        publisher,
        result.containerId,
        accessToken,
        contentId,
        platform,
      );

      if (result.success && platform === 'instagram') {
        const igPublisher = publisher as InstagramPublisher;
        result = await igPublisher.publishContainer(
          result.containerId!,
          accessToken,
          accountId,
        );
      }
    }

    const publishLog = await prisma.publishLog.create({
      data: {
        contentId,
        platform: platform as 'instagram' | 'linkedin' | 'facebook',
        status: result.success ? 'success' : 'failed',
        platformPostId: result.platformPostId,
        errorMessage: result.error,
      },
    });

    if (!result.success) {
      throw new Error(result.error ?? `Publish to ${platform} failed`);
    }

    let postUrl =
      buildPlatformPostUrl(platform, result.platformPostId, accountId) || null;

    if (platform === 'instagram' && result.platformPostId) {
      try {
        const permalink = await this.fetchInstagramPermalink(
          result.platformPostId,
          accessToken,
        );
        if (permalink) postUrl = permalink;
      } catch {
        // keep best-effort URL
      }
    }

    // Persist so the dashboard can link straight to the live post later.
    if (postUrl) {
      await prisma.publishLog.update({
        where: { id: publishLog.id },
        data: { postUrl },
      });
    }

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: `publish:${platform}:complete`,
      status: ExecutionStatus.SUCCESS,
      message: `Published: ${result.platformPostId}${postUrl ? ` · ${postUrl}` : ''}`,
    });

    return {
      platform,
      platformPostId: result.platformPostId,
      postUrl,
      accountId: accountId || null,
      accountName: connection.accountName,
    };
  }

  private async fetchInstagramPermalink(
    mediaId: string,
    accessToken: string,
  ): Promise<string | null> {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { permalink?: string };
    return data.permalink?.trim() || null;
  }

  /**
   * Poll media container status — NEVER use fixed sleep/wait.
   */
  private async pollMediaStatus(
    publisher: ReturnType<typeof getPublisher>,
    containerId: string,
    accessToken: string,
    contentId: string,
    platform: string,
  ) {
    if (!publisher.checkMediaStatus) {
      return { success: false, error: 'Publisher does not support media status polling' };
    }

    for (let attempt = 1; attempt <= config.PUBLISH_POLL_MAX_ATTEMPTS; attempt++) {
      const status = await publisher.checkMediaStatus!(containerId, accessToken);

      await prisma.publishLog.updateMany({
        where: { contentId, platform: platform as 'instagram' | 'linkedin' | 'facebook' },
        data: { pollAttempts: attempt },
      });

      if (status.status === 'FINISHED') {
        return { success: true, containerId, needsPolling: false };
      }

      if (status.status === 'ERROR' || status.status === 'EXPIRED') {
        return {
          success: false,
          error: `Media container ${status.status}: ${status.errorMessage ?? 'unknown error'}`,
        };
      }

      if (attempt < config.PUBLISH_POLL_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, config.PUBLISH_POLL_INTERVAL_MS));
      }
    }

    return {
      success: false,
      error: `Media processing timed out after ${config.PUBLISH_POLL_MAX_ATTEMPTS} attempts (${config.PUBLISH_POLL_MAX_ATTEMPTS * config.PUBLISH_POLL_INTERVAL_MS / 1000}s)`,
    };
  }

  /**
   * Instagram media IDs are not public URLs, so posts published before we stored
   * `postUrl` have no link. Fetch the Graph permalink for those once and persist it.
   * Best-effort: a failure here must never break the page that called it.
   */
  async backfillMissingPostUrls(tenantId: string): Promise<number> {
    const pending = await prisma.publishLog.findMany({
      where: {
        status: 'success',
        postUrl: null,
        platform: 'instagram',
        platformPostId: { not: null },
        content: { tenantId, deletedAt: null },
      },
      select: { id: true, platformPostId: true },
      take: 40,
    });
    if (!pending.length) return 0;

    const connection = await prisma.platformConnection.findFirst({
      where: { tenantId, platform: 'instagram', isActive: true },
    });
    if (!connection) return 0;

    let accessToken: string;
    try {
      accessToken = await this.ensureValidToken(connection);
    } catch {
      return 0;
    }

    let filled = 0;
    for (const log of pending) {
      try {
        const permalink = await this.fetchInstagramPermalink(
          log.platformPostId!,
          accessToken,
        );
        if (!permalink) continue;
        await prisma.publishLog.update({
          where: { id: log.id },
          data: { postUrl: permalink },
        });
        filled++;
      } catch {
        // Deleted media or a revoked token — leave it unlinked.
      }
    }
    return filled;
  }

  private async ensureValidToken(connection: {
    id: string;
    accessToken: string;
    refreshToken: string | null;
    tokenExpiresAt: Date | null;
    platform: string;
  }): Promise<string> {
    const token = decrypt(connection.accessToken);

    if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() - Date.now() < 300_000) {
      if (!connection.refreshToken) {
        throw new Error(`Token for ${connection.platform} expired and no refresh token available`);
      }

      const publisher = getPublisher(connection.platform);
      if (!publisher.refreshToken) {
        throw new Error(`Token expired for ${connection.platform} and no refresh mechanism available`);
      }

      const refreshed = await publisher.refreshToken(decrypt(connection.refreshToken));
      const { encrypt } = await import('../lib/encryption');

      await prisma.platformConnection.update({
        where: { id: connection.id },
        data: {
          accessToken: encrypt(refreshed.accessToken),
          tokenExpiresAt: refreshed.expiresAt,
        },
      });

      return refreshed.accessToken;
    }

    return token;
  }
}

export const publishingService = new PublishingService();
