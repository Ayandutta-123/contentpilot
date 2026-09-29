/**
 * Smoke: generate a 2-slide carousel via CarouselEngine (uses LLM + image providers).
 * Run: npx tsx scripts/smoke-carousel-engine.ts
 */
import { ContentEngine } from '@contentpilot/shared';
import { prisma } from '../src/lib/prisma';
import { CarouselEngine } from '../src/engines/carousel.engine';
import { parseCarouselSlideCount } from '../src/lib/carousel-parse';

async function main() {
  console.log('parse', parseCarouselSlideCount('Theme · Carousel (4 slides)') === 4 ? 'ok' : 'FAIL');

  const tenant = await prisma.tenant.findFirst({
    where: { deletedAt: null, isActive: true },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!tenant) throw new Error('No active tenant');

  const brand = await prisma.brandSettings.findUnique({
    where: { tenantId: tenant.id },
    select: { companyName: true },
  });
  if (!brand?.companyName?.trim()) {
    await prisma.brandSettings.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, companyName: 'Smoke Test Co' },
      update: { companyName: 'Smoke Test Co' },
    });
  }

  const content = await prisma.generatedContent.create({
    data: {
      tenantId: tenant.id,
      engine: ContentEngine.CAROUSEL,
      status: 'generating',
      targetPlatforms: ['instagram', 'linkedin'],
    },
  });
  console.log('contentId', content.id);

  await new CarouselEngine().generate(tenant.id, content.id, {
    topic: 'Two ways docs speed API onboarding',
    brief: 'B2B developers. Proof: sandbox keys and clear errors. CTA: Try the sandbox.',
    slideCount: 2,
    platforms: ['instagram', 'linkedin'],
  });

  const row = await prisma.generatedContent.findUnique({ where: { id: content.id } });
  const slots = (row?.templateSlots || {}) as Record<string, unknown>;
  const car = (slots.carousel || {}) as {
    slideCount?: number;
    slides?: Array<{ imageUrl?: string }>;
  };
  const slides = Array.isArray(car.slides) ? car.slides : [];
  const summary = {
    status: row?.status,
    engine: row?.engine,
    format: slots.format,
    slideCount: car.slideCount,
    slidesWithImages: slides.filter((s) => Boolean(s.imageUrl)).length,
    hasCover: Boolean(row?.imageUrl),
    headlineLen: (row?.headline || '').length,
    failed: row?.status === 'failed',
  };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.status !== 'pending_approval' || summary.slidesWithImages < 2) {
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
