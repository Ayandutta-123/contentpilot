import { prisma } from '../src/lib/prisma';
import { enqueueContentGeneration } from '../src/workers';
import { ContentEngine } from '@contentpilot/shared';

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  if (!tenant) throw new Error('no tenant');
  const brand = await prisma.brandSettings.findUnique({
    where: { tenantId: tenant.id },
    select: { companyName: true, logoUrl: true },
  });
  console.log('tenant', tenant.name, 'company', brand?.companyName, 'logo', Boolean(brand?.logoUrl));

  const contentId = await enqueueContentGeneration(
    tenant.id,
    ContentEngine.CALENDAR,
    undefined,
    undefined,
    {
      customPlan: {
        title: 'The Gulf does not have a capital problem. It has a first-cheque problem.',
        date: '2026-09-23',
        theme: 'P1 Thesis & Market POV',
        notes: 'Baked poster test — AI must paint headline + logo into the image.',
        hashtags: ['VentureCapital', 'Gulf', 'Startups'],
      },
      platforms: [],
      publishNow: false,
      scheduledAt: null,
      useBrandTemplate: false,
      visualMode: 'ai_baked_layout',
      visualStyleId: 'professional_photo',
    },
  );
  console.log('queued', contentId);

  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const row = await prisma.generatedContent.findUnique({
      where: { id: contentId },
      select: {
        status: true,
        imageUrl: true,
        headline: true,
        publishError: true,
        templateSlots: true,
      },
    });
    console.log(
      'status',
      row?.status,
      'image',
      row?.imageUrl?.slice(0, 90),
      'err',
      row?.publishError?.slice(0, 160),
    );
    if (row && ['pending_approval', 'failed', 'rejected'].includes(row.status)) {
      const slots = row.templateSlots as Record<string, unknown> | null;
      const bake = slots?.bakeBrief as { onImageHeadline?: string } | undefined;
      console.log('creativeMode', slots?.creativeMode, 'bakeHeadline', bake?.onImageHeadline);
      console.log(
        'DONE',
        JSON.stringify({
          id: contentId,
          status: row.status,
          imageUrl: row.imageUrl,
          headline: row.headline,
        }),
      );
      break;
    }
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
