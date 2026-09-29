/**
 * Offline checks: typography force + logo stamp + prompt logo-ban.
 * Does not call fal — run before E2E.
 */
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import {
  buildBakedPosterPrompt,
  stampRealLogoOnBakedPoster,
  type BakeBrief,
} from '../src/services/baked-poster.service';
import { determineBestModel } from '../src/services/smart-image-router.service';
import { resolveProviders } from '../src/services/providers.service';

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  if (!tenant) throw new Error('no tenant');
  const brand = await prisma.brandSettings.findUnique({
    where: { tenantId: tenant.id },
    select: { companyName: true, logoUrl: true, imageStyle: true },
  });
  if (!brand?.logoUrl) throw new Error('tenant has no logo — cannot verify stamp');

  const brief: BakeBrief = {
    onImageHeadline: 'First-cheque problem',
    onImageSubhead: 'Gulf capital needs earlier belief',
    onImageCta: 'Read the thesis',
    layoutHint: 'center_stage',
    logoPlacement: 'top-left',
    bakedArtPrompt:
      'Clean B2B editorial scene of founders and early capital in the Gulf, calm dark panel, generous whitespace.',
  };

  const prompt = buildBakedPosterPrompt({
    companyName: brand.companyName || 'Brand',
    brief,
    brandImageStyle: brand.imageStyle,
    format: 'instagram_square',
  });
  if (!/LOGO BAN/i.test(prompt)) throw new Error('prompt missing LOGO BAN');
  if (!/Headline exactly/i.test(prompt)) throw new Error('prompt missing typography block');
  if (/draw the logo|include the logo|brand logo in the image/i.test(prompt)) {
    throw new Error('prompt still asks model to draw logo');
  }
  console.log('prompt_ok chars=', prompt.length);

  const providers = await resolveProviders(tenant.id);
  const decision = determineBestModel(
    {
      prompt,
      playId: 'announcement',
      artRole: 'final_with_text',
      routingMode: 'auto',
      forceCapability: 'typography_native',
      referenceImageUrl: null,
    },
    providers,
  );
  console.log('route', decision.endpoint, decision.capability, decision.reason);
  if (decision.capability !== 'typography_native') {
    throw new Error(`expected typography_native got ${decision.capability}`);
  }
  const typoModels = [
    'ideogram',
    'gpt-image',
    'gpt-6-astra',
    'sunburst',
  ];
  if (!typoModels.some((m) => decision.endpoint.toLowerCase().includes(m))) {
    console.warn('WARN: primary endpoint not an obvious typography model:', decision.endpoint);
  }

  // Synthetic poster to stamp onto
  const sharp = (await import('sharp')).default;
  const dir = path.resolve(config.UPLOAD_DIR, tenant.id, 'ai-art');
  fs.mkdirSync(dir, { recursive: true });
  const baseName = `verify-base-${Date.now()}.png`;
  const baseAbs = path.join(dir, baseName);
  await sharp({
    create: {
      width: 1080,
      height: 1080,
      channels: 3,
      background: { r: 20, g: 24, b: 40 },
    },
  })
    .png()
    .toFile(baseAbs);
  const baseUrl = `/uploads/${tenant.id}/ai-art/${baseName}`;

  const stamped = await stampRealLogoOnBakedPoster({
    tenantId: tenant.id,
    imagePublicUrl: baseUrl,
    logoUrl: brand.logoUrl,
    placement: 'top-left',
    format: 'instagram_square',
  });
  if (stamped === baseUrl) throw new Error('stamp returned same URL — logo prepare likely failed');
  const stampedAbs = path.resolve(
    config.UPLOAD_DIR,
    stamped.replace(/^\/uploads\//, ''),
  );
  if (!fs.existsSync(stampedAbs)) throw new Error(`stamped file missing ${stampedAbs}`);
  const meta = await sharp(stampedAbs).metadata();
  console.log('stamp_ok', stamped, `${meta.width}x${meta.height}`);

  console.log('VERIFY_OK', JSON.stringify({ tenant: tenant.name, capability: decision.capability, endpoint: decision.endpoint, stamped }));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
