import { ContentEngine } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';

/**
 * Select the next entity for rotation.
 * CRITICAL: Does NOT update last_used_at — that happens only after confirmed publish.
 * Soft-deleted rows (deletedAt != null) are never selected.
 */
export async function selectNextTopic(tenantId: string) {
  return prisma.topic.findFirst({
    where: { tenantId, isActive: true, deletedAt: null },
    orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }, { rotationOrder: 'asc' }],
  });
}

export async function selectNextCompetitor(tenantId: string) {
  return prisma.competitor.findFirst({
    where: { tenantId, isActive: true, deletedAt: null },
    orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }, { rotationOrder: 'asc' }],
  });
}

export async function selectNextLibraryItem(
  tenantId: string,
  poolIds?: string[] | null,
) {
  const ids = (poolIds || []).filter(Boolean);
  // Unused first (null lastUsedAt), then least-recently published, then chronological save order.
  // After every active doc has been published once, least-recent lastUsedAt wraps back to doc #1.
  return prisma.contentLibraryItem.findFirst({
    where: {
      tenantId,
      isActive: true,
      deletedAt: null,
      ...(ids.length ? { id: { in: ids } } : {}),
    },
    orderBy: [
      { lastUsedAt: { sort: 'asc', nulls: 'first' } },
      { rotationOrder: 'asc' },
      { createdAt: 'asc' },
    ],
  });
}

export async function selectNextNewsletterTemplate(tenantId: string) {
  return prisma.newsletterTemplate.findFirst({
    where: { tenantId, isActive: true, deletedAt: null },
    orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }, { rotationOrder: 'asc' }],
  });
}

export async function selectNextBrandTemplate(
  tenantId: string,
  poolIds?: string[] | null,
) {
  const ids = (poolIds || []).filter(Boolean);
  return prisma.brandTemplate.findFirst({
    where: {
      tenantId,
      isActive: true,
      deletedAt: null,
      ...(ids.length ? { id: { in: ids } } : {}),
    },
    orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }, { rotationOrder: 'asc' }],
  });
}

export async function markBrandTemplateUsed(templateId: string): Promise<void> {
  await prisma.brandTemplate.update({
    where: { id: templateId },
    data: { lastUsedAt: new Date() },
  });
}

export async function selectNextEntity(tenantId: string, engine: ContentEngine) {
  switch (engine) {
    case ContentEngine.TRENDS:
      return selectNextTopic(tenantId);
    case ContentEngine.COMPETITOR:
      return selectNextCompetitor(tenantId);
    case ContentEngine.NEWSLETTER:
      return selectNextNewsletterTemplate(tenantId);
    case ContentEngine.LIBRARY:
      return selectNextLibraryItem(tenantId);
    default:
      return null;
  }
}

/**
 * Mark entity as used — ONLY call after confirmed successful publish.
 */
export async function markEntityUsed(engine: ContentEngine, entityId: string): Promise<void> {
  const now = new Date();
  switch (engine) {
    case ContentEngine.TRENDS:
      await prisma.topic.update({ where: { id: entityId }, data: { lastUsedAt: now } });
      break;
    case ContentEngine.COMPETITOR:
      await prisma.competitor.update({ where: { id: entityId }, data: { lastUsedAt: now } });
      break;
    case ContentEngine.NEWSLETTER:
      await prisma.newsletterTemplate.update({ where: { id: entityId }, data: { lastUsedAt: now } });
      break;
    case ContentEngine.LIBRARY:
      await prisma.contentLibraryItem.update({ where: { id: entityId }, data: { lastUsedAt: now } });
      break;
    default:
      break;
  }
}

export async function getRotationStatus(tenantId: string) {
  const [topics, competitors, newsletters, documents, brandTemplates] = await Promise.all([
    prisma.topic.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, isActive: true, lastUsedAt: true, rotationOrder: true },
      orderBy: { rotationOrder: 'asc' },
    }),
    prisma.competitor.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, isActive: true, lastUsedAt: true, rotationOrder: true },
      orderBy: { rotationOrder: 'asc' },
    }),
    prisma.newsletterTemplate.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, isActive: true, lastUsedAt: true, rotationOrder: true },
      orderBy: { rotationOrder: 'asc' },
    }),
    prisma.contentLibraryItem.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, title: true, isActive: true, lastUsedAt: true, rotationOrder: true },
      orderBy: [{ rotationOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.brandTemplate.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true, isActive: true, lastUsedAt: true, rotationOrder: true },
      orderBy: { rotationOrder: 'asc' },
    }),
  ]);

  return {
    trends: topics.map((t) => ({
      id: t.id,
      name: t.name,
      engine: ContentEngine.TRENDS,
      isActive: t.isActive,
      lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
      rotationOrder: t.rotationOrder,
    })),
    competitor: competitors.map((c) => ({
      id: c.id,
      name: c.name,
      engine: ContentEngine.COMPETITOR,
      isActive: c.isActive,
      lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
      rotationOrder: c.rotationOrder,
    })),
    newsletter: newsletters.map((n) => ({
      id: n.id,
      name: n.name,
      engine: ContentEngine.NEWSLETTER,
      isActive: n.isActive,
      lastUsedAt: n.lastUsedAt?.toISOString() ?? null,
      rotationOrder: n.rotationOrder,
    })),
    documents: documents.map((d) => ({
      id: d.id,
      name: d.title,
      engine: ContentEngine.LIBRARY,
      isActive: d.isActive,
      lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
      rotationOrder: d.rotationOrder,
    })),
    brandTemplates: brandTemplates.map((b) => ({
      id: b.id,
      name: b.name,
      engine: 'brand_template',
      isActive: b.isActive,
      lastUsedAt: b.lastUsedAt?.toISOString() ?? null,
      rotationOrder: b.rotationOrder,
    })),
  };
}
