import { prisma } from '../lib/prisma';
import { GenerationAbortedError } from './generation-abort.service';

type Platform = 'instagram' | 'linkedin' | 'facebook' | 'twitter';

export type GenerationOutcomeOpts = {
  platforms?: Platform[] | string[];
  /** When true (default), land in Approvals. When false, auto-publish to platforms. */
  requireApproval?: boolean;
};

/**
 * Set final status after an engine finishes generating copy/image.
 * Default behavior matches historical engines: pending_approval.
 */
export async function applyGenerationOutcome(
  tenantId: string,
  contentId: string,
  opts: GenerationOutcomeOpts = {},
): Promise<'pending_approval' | 'publishing' | 'rejected'> {
  const current = await prisma.generatedContent.findFirst({
    where: { id: contentId, deletedAt: null },
    select: { status: true },
  });
  if (!current || current.status !== 'generating') {
    throw new GenerationAbortedError(contentId);
  }

  const platforms = (opts.platforms || []).filter(Boolean) as Platform[];
  const requireApproval = opts.requireApproval !== false;

  if (!requireApproval && platforms.length) {
    await prisma.generatedContent.update({
      where: { id: contentId },
      data: {
        status: 'approved',
        targetPlatforms: platforms,
      },
    });
    const { enqueuePublishing } = await import('../workers');
    await enqueuePublishing(contentId, tenantId, platforms);
    return 'publishing';
  }

  await prisma.generatedContent.update({
    where: { id: contentId },
    data: {
      status: 'pending_approval',
      ...(platforms.length ? { targetPlatforms: platforms } : {}),
    },
  });
  return 'pending_approval';
}
