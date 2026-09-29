import { prisma } from '../lib/prisma';

export class GenerationAbortedError extends Error {
  readonly contentId: string;
  constructor(contentId: string) {
    super(`Generation aborted (${contentId})`);
    this.name = 'GenerationAbortedError';
    this.contentId = contentId;
  }
}

/** Throw if the content row is no longer actively generating (user aborted / deleted). */
export async function assertGenerationActive(contentId: string): Promise<void> {
  const row = await prisma.generatedContent.findFirst({
    where: { id: contentId, deletedAt: null },
    select: { status: true },
  });
  if (!row || row.status !== 'generating') {
    throw new GenerationAbortedError(contentId);
  }
}

export function isGenerationAbortedError(err: unknown): boolean {
  return err instanceof GenerationAbortedError || (err instanceof Error && err.name === 'GenerationAbortedError');
}
