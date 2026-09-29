/**
 * Offline: baked raw recovery for Apply logo position.
 * npx tsx scripts/verify-bake-raw-recovery.ts
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { stampRealLogoOnBakedPoster } from '../src/services/baked-poster.service';
import { reframeExistingImage } from '../src/services/image-attach.service';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { deletedAt: null },
    select: { id: true },
  });
  if (!tenant) throw new Error('no tenant');
  const brand = await prisma.brandSettings.findUnique({
    where: { tenantId: tenant.id },
    select: { logoUrl: true },
  });
  if (!brand?.logoUrl) throw new Error('no logo');

  const dir = path.resolve(config.UPLOAD_DIR, tenant.id, 'ai-art');
  fs.mkdirSync(dir, { recursive: true });
  const png = await sharp({
    create: { width: 1080, height: 1080, channels: 3, background: { r: 30, g: 40, b: 60 } },
  })
    .png()
    .toBuffer();
  const artTs = Date.now();
  const artName = `art-${artTs}.png`;
  fs.writeFileSync(path.join(dir, artName), png);
  const artUrl = `/uploads/${tenant.id}/ai-art/${artName}`;

  const stamped = await stampRealLogoOnBakedPoster({
    tenantId: tenant.id,
    imagePublicUrl: artUrl,
    logoUrl: brand.logoUrl,
    placement: 'top-left',
    format: 'instagram_square',
  });
  assert(stamped.includes('baked-logo-'), `expected stamped url, got ${stamped}`);

  const content = await prisma.generatedContent.findFirst({
    where: { tenantId: tenant.id, deletedAt: null },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, templateSlots: true, imageUrl: true, rawImageUrl: true },
  });
  if (!content) throw new Error('no content row to test');

  const backup = {
    imageUrl: content.imageUrl,
    rawImageUrl: content.rawImageUrl,
    templateSlots: content.templateSlots,
  };

  const prevSlots =
    content.templateSlots && typeof content.templateSlots === 'object' && !Array.isArray(content.templateSlots)
      ? (content.templateSlots as Record<string, unknown>)
      : {};

  try {
    await prisma.generatedContent.update({
      where: { id: content.id },
      data: {
        imageUrl: stamped,
        rawImageUrl: null,
        templateSlots: {
          ...prevSlots,
          creativeMode: 'ai_baked_layout',
          bakeBrief: {
            onImageHeadline: 'Test',
            onImageSubhead: 'Sub',
            onImageCta: 'Go',
            layoutHint: 'center_stage',
            logoPlacement: 'top-left',
            bakedArtPrompt: 'test',
          },
        } as object,
      },
    });

    const moved = await reframeExistingImage(tenant.id, content.id, {
      logoPlacement: 'bottom-right',
      format: 'instagram_square',
      overlay: { overlaysEnabled: true },
      throwOnError: true,
    });

    const after = await prisma.generatedContent.findUniqueOrThrow({
      where: { id: content.id },
      select: { imageUrl: true, rawImageUrl: true, templateSlots: true },
    });

    assert(Boolean(after.rawImageUrl), 'rawImageUrl should be recovered');
    assert(after.rawImageUrl === artUrl, `raw should be pre-stamp art, got ${after.rawImageUrl}`);
    assert(after.imageUrl !== stamped, 'imageUrl should be a new stamp');
    assert(after.imageUrl === moved.imageUrl, 'return matches db');
    const slots = after.templateSlots as Record<string, unknown>;
    assert(slots.logoPlacement === 'bottom-right', 'placement persisted');

    console.log('ok recovered raw from art-* beside baked-logo-*');
    console.log('ok logo restamped bottom-right without double-layer on clean art');
    console.log('ALL BAKE RAW RECOVERY CHECKS PASSED');
  } finally {
    await prisma.generatedContent.update({
      where: { id: content.id },
      data: {
        imageUrl: backup.imageUrl,
        rawImageUrl: backup.rawImageUrl,
        templateSlots: backup.templateSlots as object,
      },
    });
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
