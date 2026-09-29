/**
 * Smart Image Router — dry-run classifier tests + optional live generate.
 *
 *   npx tsx scripts/test-smart-image-router.ts
 *   LIVE=1 npx tsx scripts/test-smart-image-router.ts   # hits fal/openai if keys exist
 */
import {
  determineBestModel,
  inspectProviderStack,
  isHighEndModel,
  isLowEndModel,
  normalizeEndpoint,
  routeForGeneration,
  type RouteContext,
} from '../src/services/smart-image-router.service';
import type { ResolvedProviders } from '../src/services/providers.service';
import { config } from '../src/config';

function fakeProviders(opts: {
  fal?: boolean;
  openai?: boolean;
  claude?: boolean;
  falModel?: string;
  imageProvider?: 'fal' | 'openai';
}): ResolvedProviders {
  return {
    llmProvider: opts.claude ? 'claude' : 'openai',
    llmModel: opts.claude ? 'claude-sonnet-5' : 'gpt-4o',
    openaiApiKey: opts.openai ? 'sk-test' : undefined,
    claudeApiKey: opts.claude ? 'claude-test' : undefined,
    imageProvider: opts.imageProvider || 'fal',
    falModel: opts.falModel || 'fal-ai/flux/dev',
    falApiKey: opts.fal ? 'fal-test' : undefined,
    imageRoutingMode: 'auto' as const,
    searchProvider: 'tavily',
    scrapingProvider: 'apify',
    notificationProvider: 'none',
    soundAlertsEnabled: false,
    trendsMode: 'manual',
    competitorMode: 'manual',
    competitorImageMode: 'new_topic',
    newsletterMode: 'manual',
  };
}

type Case = {
  name: string;
  ctx: RouteContext;
  providers: ResolvedProviders;
  expectEndpointIncludes?: string;
  expectCapability?: string;
  expectProvider?: 'fal' | 'openai';
  rejectEndpointIncludes?: string;
};

const cases: Case[] = [
  {
    name: 'aesthetic + cinematic → photoreal flux-2-pro',
    ctx: {
      prompt: 'cinematic product photography, highly detailed',
      playId: 'aesthetic',
      artRole: 'raw',
      routingMode: 'auto',
    },
    providers: fakeProviders({ fal: true, openai: true }),
    expectCapability: 'photoreal_general',
    expectEndpointIncludes: 'flux-2',
  },
  {
    name: 'offer poster under SVG → photoreal NOT gpt-image',
    ctx: {
      prompt: '15% OFF launch for AI video software',
      playId: 'offer',
      posterTemplateId: 'offer_sale_circles',
      designSource: 'template',
      artRole: 'hero_under_svg',
      routingMode: 'auto',
    },
    providers: fakeProviders({ fal: true, openai: true }),
    expectCapability: 'photoreal_general',
    rejectEndpointIncludes: 'gpt-image',
  },
  {
    name: 'logo + transparent + hex → recraft',
    ctx: {
      prompt: 'Make a vector logo with transparent background #0B1F3A',
      playId: null,
      routingMode: 'auto',
    },
    providers: fakeProviders({ fal: true }),
    expectCapability: 'vector_brand',
    expectEndpointIncludes: 'recraft',
  },
  {
    name: 'same face + reference → nano-banana',
    ctx: {
      prompt: 'Keep the same face across this multi-post campaign',
      referenceImageUrl: 'https://example.com/face.png',
      routingMode: 'auto',
    },
    providers: fakeProviders({ fal: true }),
    expectCapability: 'character_consistent',
    expectEndpointIncludes: 'nano-banana',
  },
  {
    name: 'billboard with text → typography gpt-image',
    ctx: {
      prompt: 'Billboard that says OPEN NOW in neon',
      artRole: 'final_with_text',
      designSource: 'ai',
      routingMode: 'auto',
    },
    providers: fakeProviders({ fal: true, openai: true }),
    expectCapability: 'typography_native',
    expectEndpointIncludes: 'gpt-image',
  },
  {
    name: 'no fal → Claude then OpenAI keys; pixels OpenAI',
    ctx: {
      prompt: 'photorealistic studio shot',
      routingMode: 'auto',
    },
    providers: fakeProviders({ fal: false, openai: true, claude: true }),
    expectProvider: 'openai',
  },
  {
    name: 'no fal, only OpenAI (no Claude) → OpenAI images',
    ctx: {
      prompt: 'photorealistic studio shot',
      routingMode: 'auto',
    },
    providers: fakeProviders({ fal: false, openai: true, claude: false }),
    expectProvider: 'openai',
  },
  {
    name: 'weak fal only + OpenAI → prefer OpenAI pixels',
    ctx: {
      prompt: 'billboard that says SALE TODAY',
      artRole: 'final_with_text',
      routingMode: 'auto',
    },
    // fal key present but we still prefer gpt-image for typography; strong fal gpt-image via fal wins first
    providers: fakeProviders({ fal: true, openai: true, falModel: 'fal-ai/flux/dev' }),
    expectCapability: 'typography_native',
    expectEndpointIncludes: 'gpt-image',
  },
  {
    name: 'manual override remaps when fal missing',
    ctx: {
      prompt: 'anything',
      routingMode: 'manual',
      modelOverride: 'fal-ai/recraft/v4/text-to-image',
    },
    providers: fakeProviders({ fal: false, openai: true, claude: true }),
    expectProvider: 'openai',
  },
  {
    name: 'alias nano-banana-2 normalizes',
    ctx: {
      prompt: 'x',
      routingMode: 'manual',
      modelOverride: 'fal-ai/nano-banana-2',
    },
    providers: fakeProviders({ fal: true }),
    expectEndpointIncludes: 'nano-banana-pro',
  },
  {
    name: 'countdown play → typography',
    ctx: {
      prompt: 'T-minus 3 days to launch',
      playId: 'countdown',
      artRole: 'final_with_text',
      routingMode: 'auto',
    },
    providers: fakeProviders({ fal: true }),
    expectCapability: 'typography_native',
  },
  {
    name: 'insight_report → typography',
    ctx: {
      prompt: 'Q3 industry stats poster',
      playId: 'insight_report',
      artRole: 'hero_under_svg',
      routingMode: 'auto',
    },
    providers: fakeProviders({ fal: true }),
    // hero_under_svg suppresses typography — photoreal for background
    expectCapability: 'photoreal_general',
  },
];

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  let failures = 0;

  // Alias unit check
  assert(
    normalizeEndpoint('fal-ai/recraft-v4') === 'fal-ai/recraft/v4/text-to-image',
    'recraft alias',
  );
  assert(normalizeEndpoint('fal-ai/gpt-image-2-5') === 'openai/gpt-image-2.5/sunburst/text-to-image', 'gpt alias');
  assert(isHighEndModel('fal-ai/flux-2-pro') && isHighEndModel('gpt-6-astra'), 'high-end allow-list');
  assert(isLowEndModel('fal-ai/flux/dev') && isLowEndModel('fal-ai/flux-2') && isLowEndModel('gpt-image-1'), 'low-end denylist');

  const stack = inspectProviderStack(fakeProviders({ fal: false, openai: true, claude: true }));
  assert(stack.llmAssist === 'claude', 'LLM assist should prefer Claude when key exists');
  assert(stack.imageProvider === 'openai', 'pixels should be OpenAI when fal missing');
  console.log(`ok   stack inspect (no fal): ${stack.summary}`);

  for (const c of cases) {
    try {
      const d = determineBestModel(
        { ...c.ctx, settingsFalModel: c.providers.falModel },
        c.providers,
      );
      if (c.expectCapability) {
        assert(d.capability === c.expectCapability, `capability ${d.capability} != ${c.expectCapability}`);
      }
      if (c.expectEndpointIncludes) {
        assert(
          d.endpoint.includes(c.expectEndpointIncludes),
          `endpoint ${d.endpoint} missing ${c.expectEndpointIncludes}`,
        );
      }
      if (c.rejectEndpointIncludes) {
        assert(
          !d.endpoint.includes(c.rejectEndpointIncludes),
          `endpoint ${d.endpoint} should not include ${c.rejectEndpointIncludes}`,
        );
      }
      if (c.expectProvider) {
        assert(d.provider === c.expectProvider, `provider ${d.provider} != ${c.expectProvider}`);
      }
      assert(d.fallbackChain.length >= 1, 'empty fallback chain');
      assert(
        d.fallbackChain.every((e) => isHighEndModel(e)),
        `low-end slipped into chain: ${d.fallbackChain.join(', ')}`,
      );
      assert(
        !d.endpoint.includes('flux/dev') && !d.endpoint.includes('schnell') && d.endpoint !== 'gpt-image-1',
        `must not pick low-end ${d.endpoint}`,
      );
      assert(Boolean(d.reason), 'missing reason');
      console.log(`ok   ${c.name.padEnd(56)} → ${d.endpoint} (${d.capability})`);
      console.log(`     ${d.reason}`);
    } catch (err) {
      failures++;
      console.log(`FAIL ${c.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // No image keys — Claude alone is not enough for pixels
  try {
    determineBestModel({ prompt: 'hi', routingMode: 'auto' }, fakeProviders({ claude: true }));
    failures++;
    console.log('FAIL expected throw when only Claude key (no image provider)');
  } catch {
    console.log('ok   throws when only Claude key (no fal/OpenAI for pixels)');
  }

  try {
    determineBestModel({ prompt: 'hi', routingMode: 'auto' }, fakeProviders({}));
    failures++;
    console.log('FAIL expected throw when no keys');
  } catch {
    console.log('ok   throws when no keys configured');
  }

  console.log(`\n${cases.length + 3} checks, ${failures} failures`);
  if (failures) process.exitCode = 1;
  await liveOptional();
}

async function liveOptional() {
  if (process.env.LIVE !== '1') return;
  let failures = 0;
  const providers: ResolvedProviders = {
    ...fakeProviders({
      fal: Boolean(config.FAL_API_KEY),
      openai: Boolean(config.OPENAI_API_KEY),
      falModel: config.FAL_MODEL,
      imageProvider: (config.IMAGE_PROVIDER as 'fal' | 'openai') || 'fal',
    }),
    falApiKey: config.FAL_API_KEY || undefined,
    openaiApiKey: config.OPENAI_API_KEY || undefined,
  };

  if (!providers.falApiKey && !providers.openaiApiKey) {
    console.log('LIVE skip — no FAL_API_KEY / OPENAI_API_KEY');
    return;
  }
  const { generateContentImage } = await import('../src/providers/images/fal.provider');
  const { decision, providers: routed } = routeForGeneration(
    {
      prompt: 'Minimal studio product photo of a ceramic mug, soft light, no text',
      playId: 'aesthetic',
      artRole: 'raw',
      routingMode: 'auto',
    },
    providers,
  );
  console.log(`LIVE route → ${decision.endpoint} · ${decision.reason}`);
  try {
    const img = await generateContentImage(
      routed,
      'Minimal ceramic mug product photo, soft daylight, no text no logo',
      { format: 'instagram_square', exact: true },
    );
    console.log(`LIVE ok model=${img?.model} url=${img?.url?.slice(0, 80)}…`);
  } catch (err) {
    failures++;
    console.log(`LIVE FAIL ${err instanceof Error ? err.message : String(err)}`);
  }
  if (failures) process.exitCode = 1;
}

void main();
