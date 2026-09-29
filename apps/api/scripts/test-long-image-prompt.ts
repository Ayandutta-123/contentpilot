/**
 * Live test: can fal.ai accept / generate from a long imagePrompt?
 *
 *   npx tsx scripts/test-long-image-prompt.ts
 *   MIN_CHARS=5000 npx tsx scripts/test-long-image-prompt.ts
 */
import { resolveProviders } from '../src/services/providers.service';
import { generateContentImage } from '../src/providers/images/fal.provider';
import { prisma } from '../src/lib/prisma';

function buildLongPrompt(minChars: number): string {
  const core = `Photorealistic editorial photograph for a LinkedIn B2B deep-tech post.
Subject: a single brushed stainless-steel industrial IoT edge sensor mounted on a charcoal steel post in a modern Gulf logistics yard at dusk.
Lighting: low golden-hour sunlight from camera-left raking across brushed metal panels; soft fill from a cool teal LED status light on the device; deep navy-charcoal sky with a thin band of residual gold on the horizon.
Camera: 35mm full-frame look, slight three-quarter angle, shallow depth of field, subject sharp, distant warehouse silhouettes softly out of focus.
Materials: raw brushed stainless, matte charcoal cladding, clean asphalt with faint wet reflections, no rust, no stickers.
Composition: hardware framed slightly off-centre, generous calm negative space in the upper-left corner for a logo badge, no text, no logos, no watermarks, no UI chrome.
Mood: calm, premium, restrained, agency-quality B2B editorial — believable real-world industrial scene, not sci-fi.
Color grade: navy, charcoal, brushed steel, subtle teal accent, warm gold rim light.
`;
  let prompt = core;
  const extras = [
    ' Include faint heat shimmer above the asphalt.',
    ' Keep the lower third slightly underexposed and empty.',
    ' Avoid neon cyberpunk cities, glowing brain jars, cyborg faces, and holographic HUDs.',
    ' The device should look like manufacturable industrial hardware, not a consumer gadget.',
    ' Background should suggest GCC logistics infrastructure without readable signage.',
    ' Maintain photoreal micro-detail on metal grain and fastener heads.',
    ' Use natural atmospheric haze toward the horizon only.',
    ' Prefer documentary editorial realism over glossy stock cliché.',
    ' Secondary subject: a blurred forklift silhouette far left, not competing with the sensor.',
    ' Sky should remain deep navy with no lens flares or rainbow artifacts.',
  ];
  let i = 0;
  while (prompt.length < minChars) {
    prompt += extras[i % extras.length];
    i += 1;
  }
  return prompt;
}

async function main() {
  const minChars = Math.max(100, parseInt(process.env.MIN_CHARS || '2200', 10) || 2200);
  const tenant =
    (await prisma.providerSettings.findFirst({
      where: { falApiKey: { not: null } },
      orderBy: { updatedAt: 'desc' },
      select: { tenantId: true },
    }))?.tenantId || 'bc57113d-6115-4816-9ee0-d65ccf383821';

  const providers = await resolveProviders(tenant);
  if (!providers.falApiKey) {
    console.error('FAIL: no fal API key for tenant', tenant);
    process.exit(1);
  }

  const prompt = buildLongPrompt(minChars);
  console.log('tenant', tenant);
  console.log('promptChars', prompt.length);
  console.log('settingsFalModel', providers.falModel);
  console.log('routing', providers.imageRoutingMode);

  const pinned = {
    ...providers,
    falModel: 'fal-ai/flux-2-max',
    imageRoutingMode: 'manual' as const,
  };

  const t0 = Date.now();
  try {
    const result = await generateContentImage(pinned, prompt, {
      format: 'instagram_square',
      exact: true,
    });
    const ms = Date.now() - t0;
    if (!result?.url) {
      console.error('FAIL: no image URL returned after', ms, 'ms');
      process.exit(1);
    }
    console.log('OK');
    console.log('model', result.model);
    console.log('elapsedMs', ms);
    console.log('imageUrl', result.url.slice(0, 160) + (result.url.length > 160 ? '…' : ''));
    console.log('acceptedPromptOver5k', prompt.length >= 5000);
  } catch (err) {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
