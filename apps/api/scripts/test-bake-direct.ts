/**
 * Direct bake (no calendar LLM) — verifies typography route + logo stamp + short CTA.
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { attachBakedPosterForContent } from '../src/services/baked-poster.service';

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  if (!tenant) throw new Error('no tenant');
  const brand = await prisma.brandSettings.findUnique({
    where: { tenantId: tenant.id },
  });

  const content = await prisma.generatedContent.create({
    data: {
      tenantId: tenant.id,
      engine: 'calendar',
      status: 'generating',
      headline: 'The first cheque is the real gap',
      body: 'There is no shortage of capital in the Gulf. Early belief is scarce.',
      callToAction: 'Talk to Risin',
      targetPlatforms: [],
    },
  });

  const result = await attachBakedPosterForContent({
    tenantId: tenant.id,
    contentId: content.id,
    companyName: brand?.companyName || 'Risin Ventures',
    headline: content.headline,
    body: content.body,
    callToAction: content.callToAction,
    topic: 'Gulf venture capital',
    visualStyleId: 'professional_photo',
    brandImageStyle: brand?.imageStyle,
    logoPlacement: 'top-left',
    format: 'instagram_square',
    playId: 'announcement',
    throwOnError: true,
  });

  const row = await prisma.generatedContent.findUnique({
    where: { id: content.id },
    select: { imageUrl: true, templateSlots: true, status: true },
  });
  const slots = (row?.templateSlots || {}) as Record<string, unknown>;
  const brief = slots.bakeBrief as { onImageCta?: string; onImageHeadline?: string } | undefined;

  if (!result?.imageUrl) throw new Error('no image');
  if (!brief?.onImageCta) throw new Error('missing CTA');
  if (/[…]|\.\.\.$/.test(brief.onImageCta)) throw new Error(`CTA has ellipsis: ${brief.onImageCta}`);
  if ((brief.onImageCta.split(/\s+/).length > 5)) throw new Error(`CTA too many words: ${brief.onImageCta}`);
  if (slots.bakeCapability !== 'typography_native') {
    throw new Error(`expected typography_native got ${slots.bakeCapability}`);
  }
  if (!String(row?.imageUrl || '').includes('baked-logo-')) {
    throw new Error(`expected stamped baked-logo file, got ${row?.imageUrl}`);
  }

  const abs = path.resolve(config.UPLOAD_DIR, String(row!.imageUrl).replace(/^\/uploads\//, ''));
  if (!fs.existsSync(abs)) throw new Error(`missing file ${abs}`);

  console.log(
    'DIRECT_BAKE_OK',
    JSON.stringify({
      id: content.id,
      imageUrl: row?.imageUrl,
      bakeModel: slots.bakeModel,
      bakeCapability: slots.bakeCapability,
      cta: brief.onImageCta,
      headline: brief.onImageHeadline,
    }),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
