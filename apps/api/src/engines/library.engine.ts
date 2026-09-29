import { ContentEngine, ExecutionStatus } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { selectNextLibraryItem } from '../services/rotation.service';
import { LLMService, buildSystemPrompt } from '../services/llm.service';
import { executionLogService } from '../services/execution-log.service';

export class LibraryEngine {
  async generate(tenantId: string, contentId: string): Promise<void> {
    const start = Date.now();
    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'library:select',
      engine: ContentEngine.LIBRARY,
    });

    const libraryItem = await selectNextLibraryItem(tenantId);
    if (!libraryItem) {
      throw new Error('No active content library items. Upload documents in Settings → Content Library.');
    }

    if (!libraryItem.extractedText.trim()) {
      throw new Error(`Content library item "${libraryItem.title}" has no extracted text`);
    }

    const brandSettings = await prisma.brandSettings.findUnique({ where: { tenantId } });
    const llm = await LLMService.forTenant(tenantId);

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'library:generate',
      engine: ContentEngine.LIBRARY,
      message: `Generating from: ${libraryItem.title}`,
    });

    const post = await llm.generatePost({
      systemPrompt: buildSystemPrompt(brandSettings ?? {
        brandVoice: '', imageStyle: '', hashtagStrategy: '', contentGuidelines: '', targetAudience: '',
      }),
      userPrompt: `Generate a social media post from this content library document. Use ONLY information from the document.

Document Title: ${libraryItem.title}
Category: ${libraryItem.category || 'Uncategorized'}

Document Content:
${libraryItem.extractedText.slice(0, 8000)}`,
    });

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
        sourceReference: libraryItem.title,
        libraryItemId: libraryItem.id,
        status: 'pending_approval',
      },
    });

    const { attachGeneratedImage } = await import('../services/image-attach.service');
    await attachGeneratedImage(tenantId, contentId, post.imagePrompt, brandSettings?.imageStyle);

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'library:complete',
      engine: ContentEngine.LIBRARY,
      status: ExecutionStatus.SUCCESS,
      durationMs: Date.now() - start,
    });
  }
}
