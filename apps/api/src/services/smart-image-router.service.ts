/**
 * Smart Image Model Router — picks the best fal / OpenAI image endpoint from
 * AI Assistant play cards, chat briefs, optional overrides, and which API keys
 * the tenant actually has saved.
 *
 * Key check order when fal is missing or only weak fal models remain:
 *   1) Claude (LLM assist / classification — Anthropic has no pixel API)
 *   2) OpenAI (LLM assist + native image generation)
 * Image pixels always use fal first when a strong fal model is available, else OpenAI Images.
 */

import type { ResolvedProviders } from './providers.service';

export type ImageCapability =
  | 'vector_brand'
  | 'character_consistent'
  | 'photoreal_general'
  | 'typography_native'
  | 'product_ui';

export type ArtRole = 'hero_under_svg' | 'final_with_text' | 'raw';

export type ImageProviderKind = 'fal' | 'openai';
export type LlmAssistKind = 'claude' | 'openai';

export type RouteContext = {
  prompt: string;
  /** AI Assistant play id, e.g. offer | aesthetic | meme */
  playId?: string | null;
  selectedCategory?: string | null;
  posterTemplateId?: string | null;
  designSource?: 'template' | 'brand_template' | 'ai' | null;
  artRole?: ArtRole | null;
  chatHistory?: Array<{ role: string; content: string }>;
  referenceImageUrl?: string | null;
  /** auto = classify; manual = pin modelOverride or Settings falModel */
  routingMode?: 'auto' | 'manual';
  modelOverride?: string | null;
  /** Soft preference from Settings (boosted inside the chosen capability). */
  settingsFalModel?: string | null;
  /**
   * When set (e.g. baked posters), skip scoring and use this capability only.
   * Use with artRole final_with_text for typography-native Ideogram / GPT Image.
   */
  forceCapability?: ImageCapability | null;
};

export type ModelCandidate = {
  endpoint: string;
  provider: ImageProviderKind;
  label: string;
};

export type ProviderStack = {
  fal: boolean;
  claude: boolean;
  openai: boolean;
  /** Claude first, then OpenAI — for classification / prompt assist only. */
  llmAssist: LlmAssistKind | null;
  /** Where pixels will run after key + quality check. */
  imageProvider: ImageProviderKind | null;
  summary: string;
};

export type RouteDecision = {
  endpoint: string;
  provider: ImageProviderKind;
  capability: ImageCapability;
  reason: string;
  fallbackChain: string[];
  artRole: ArtRole;
  score: number;
  stack?: ProviderStack;
  llmAssist?: LlmAssistKind | null;
};

/**
 * Allow-list of models Auto (and remapped Manual) may actually call.
 * Flux Dev / Schnell / FLUX.2 Dev / GPT Image 1 / Flare / DALL·E 2 are never used —
 * if these cannot run we stop and tell the user to add a key or credits.
 */
export const HIGH_END_MODELS = new Set([
  'fal-ai/flux-2-max',
  'fal-ai/flux-2-pro',
  'fal-ai/flux-pro/v1.1-ultra',
  'fal-ai/flux-pro/v1.1',
  'fal-ai/imagen4/preview/ultra',
  'fal-ai/recraft/v4/text-to-image',
  'fal-ai/ideogram/v3',
  'fal-ai/nano-banana-pro',
  'openai/gpt-image-2.5/sunburst/text-to-image',
  'gpt-6-astra',
  'gpt-6-astra-pro',
  'gpt-image-2.5-sunburst',
]);

export function isHighEndModel(endpoint: string): boolean {
  const e = normalizeEndpoint(endpoint);
  if (HIGH_END_MODELS.has(e)) return true;
  if (e.startsWith('fal-ai/nano-banana-pro')) return true;
  if (e.startsWith('fal-ai/flux-2-pro') || e.startsWith('fal-ai/flux-2-max')) return true;
  if (e.startsWith('gpt-6-astra')) return true;
  if (e.includes('gpt-image-2.5-sunburst') || e.includes('gpt-image-2.5/sunburst')) return true;
  return false;
}

/** Capability → ranked high-end candidates only (primary first). */
export const CAPABILITY_CANDIDATES: Record<ImageCapability, ModelCandidate[]> = {
  vector_brand: [
    { endpoint: 'fal-ai/recraft/v4/text-to-image', provider: 'fal', label: 'Recraft V4' },
    { endpoint: 'fal-ai/ideogram/v3', provider: 'fal', label: 'Ideogram V3' },
    { endpoint: 'openai/gpt-image-2.5/sunburst/text-to-image', provider: 'fal', label: 'GPT Image 2.5 Sunburst (fal)' },
    { endpoint: 'gpt-6-astra', provider: 'openai', label: 'GPT-6 Astra' },
    { endpoint: 'gpt-image-2.5-sunburst', provider: 'openai', label: 'GPT Image 2.5 Sunburst' },
  ],
  character_consistent: [
    { endpoint: 'fal-ai/nano-banana-pro', provider: 'fal', label: 'Nano Banana Pro' },
    { endpoint: 'fal-ai/flux-2-pro', provider: 'fal', label: 'FLUX.2 Pro' },
    { endpoint: 'gpt-6-astra', provider: 'openai', label: 'GPT-6 Astra' },
    { endpoint: 'gpt-image-2.5-sunburst', provider: 'openai', label: 'GPT Image 2.5 Sunburst' },
  ],
  photoreal_general: [
    { endpoint: 'fal-ai/flux-2-max', provider: 'fal', label: 'FLUX.2 Max' },
    { endpoint: 'fal-ai/flux-2-pro', provider: 'fal', label: 'FLUX.2 Pro' },
    { endpoint: 'fal-ai/flux-pro/v1.1-ultra', provider: 'fal', label: 'FLUX Pro Ultra' },
    { endpoint: 'fal-ai/imagen4/preview/ultra', provider: 'fal', label: 'Imagen 4 Ultra' },
    { endpoint: 'gpt-6-astra', provider: 'openai', label: 'GPT-6 Astra' },
    { endpoint: 'gpt-image-2.5-sunburst', provider: 'openai', label: 'GPT Image 2.5 Sunburst' },
  ],
  typography_native: [
    { endpoint: 'openai/gpt-image-2.5/sunburst/text-to-image', provider: 'fal', label: 'GPT Image 2.5 Sunburst (fal)' },
    { endpoint: 'fal-ai/ideogram/v3', provider: 'fal', label: 'Ideogram V3' },
    { endpoint: 'gpt-6-astra', provider: 'openai', label: 'GPT-6 Astra' },
    { endpoint: 'gpt-image-2.5-sunburst', provider: 'openai', label: 'GPT Image 2.5 Sunburst' },
    { endpoint: 'fal-ai/flux-2-pro', provider: 'fal', label: 'FLUX.2 Pro' },
  ],
  product_ui: [
    { endpoint: 'fal-ai/flux-2-pro', provider: 'fal', label: 'FLUX.2 Pro' },
    { endpoint: 'fal-ai/recraft/v4/text-to-image', provider: 'fal', label: 'Recraft V4' },
    { endpoint: 'openai/gpt-image-2.5/sunburst/text-to-image', provider: 'fal', label: 'GPT Image 2.5 Sunburst (fal)' },
    { endpoint: 'gpt-6-astra', provider: 'openai', label: 'GPT-6 Astra' },
    { endpoint: 'gpt-image-2.5-sunburst', provider: 'openai', label: 'GPT Image 2.5 Sunburst' },
  ],
};

export class ImageModelUnavailableError extends Error {
  statusCode = 422;
  code = 'IMAGE_MODEL_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'ImageModelUnavailableError';
  }
}

/** Soft cross-capability fallback when a whole class is unavailable / fails. */
const CAPABILITY_FALLBACK: Record<ImageCapability, ImageCapability[]> = {
  typography_native: ['photoreal_general', 'product_ui'],
  vector_brand: ['typography_native', 'photoreal_general'],
  character_consistent: ['photoreal_general'],
  product_ui: ['photoreal_general', 'vector_brand'],
  photoreal_general: ['typography_native'],
};

const PLAY_BIAS: Record<string, Partial<Record<ImageCapability, number>>> = {
  offer: { photoreal_general: 3, typography_native: 1, vector_brand: 1 },
  countdown: { typography_native: 3, photoreal_general: 1 },
  launch: { photoreal_general: 3, typography_native: 2, product_ui: 2 },
  update: { typography_native: 3, product_ui: 2 },
  announcement: { typography_native: 3, photoreal_general: 1 },
  aesthetic: { photoreal_general: 4 },
  meme: { typography_native: 3, photoreal_general: 1 },
  thought_leadership: { typography_native: 3, photoreal_general: 1 },
  insight_report: { typography_native: 4 },
  festival: { photoreal_general: 3, typography_native: 2 },
  carousel_tips: { photoreal_general: 3, typography_native: 2 },
};

type KeywordRule = { capability: ImageCapability; patterns: RegExp[]; weight: number };

const KEYWORD_RULES: KeywordRule[] = [
  {
    capability: 'vector_brand',
    weight: 2,
    patterns: [
      /\bvector\b/i,
      /\bsvg\b/i,
      /\btransparent\s+background\b/i,
      /\bisometric\b/i,
      /\bbrand\s+colou?rs?\b/i,
      /#[0-9a-fA-F]{3,8}\b/,
      /\bflat\s+design\b/i,
      /\bui\s+asset\b/i,
    ],
  },
  {
    capability: 'character_consistent',
    weight: 2,
    patterns: [
      /\bconsistent\s+character\b/i,
      /\bsame\s+person\b/i,
      /\bsame\s+face\b/i,
      /\bkeep\s+(the\s+)?face\b/i,
      /\breference\s+image\b/i,
      /\bcomposite\b/i,
      /\bidentity\s+lock\b/i,
      /\bmulti[- ]post\s+campaign\b/i,
    ],
  },
  {
    capability: 'photoreal_general',
    weight: 2,
    patterns: [
      /\bphotoreal(istic)?\b/i,
      /\bcinematic\b/i,
      /\bphotography\b/i,
      /\bmacro\b/i,
      /\bhighly\s+detailed\b/i,
      /\b4k\b/i,
      /\bnegative\s+space\b/i,
      /\bproduct\s+shot\b/i,
      /\blifestyle\b/i,
      /\bstudio\s+lighting\b/i,
    ],
  },
  {
    capability: 'typography_native',
    weight: 2,
    patterns: [
      /\bposter\s+with\s+text\b/i,
      /\btypography\b/i,
      /\bwrite\s+the\s+words\b/i,
      /\bneon\s+sign\s+saying\b/i,
      /\bbillboard\s+that\s+says\b/i,
      /\btext\s+on\s+(the\s+)?image\b/i,
      /\bembed(ded)?\s+text\b/i,
      /\bsays?\s+[“"][^”"]+[”"]/i,
      /\bheadline\s+in\s+the\s+image\b/i,
      /\bmeme\s+caption\b/i,
    ],
  },
  {
    capability: 'product_ui',
    weight: 2,
    patterns: [
      /\bscreenshot\b/i,
      /\bapp\s+ui\b/i,
      /\bdashboard\b/i,
      /\bsaas\s+interface\b/i,
      /\bui\s+mock(up)?\b/i,
    ],
  },
];

/** Normalize aliases users / docs may type to catalog endpoints. */
const ENDPOINT_ALIASES: Record<string, string> = {
  'fal-ai/recraft-v4': 'fal-ai/recraft/v4/text-to-image',
  'fal-ai/recraft/v4': 'fal-ai/recraft/v4/text-to-image',
  'fal-ai/nano-banana-2': 'fal-ai/nano-banana-pro',
  'fal-ai/gpt-image-2-5': 'openai/gpt-image-2.5/sunburst/text-to-image',
  'fal-ai/gpt-image-2.5': 'openai/gpt-image-2.5/sunburst/text-to-image',
  'openai/gpt-image-2.5': 'openai/gpt-image-2.5/sunburst/text-to-image',
  'fal-ai/gpt-image-2': 'openai/gpt-image-2',
  'gpt-6-astra-pro': 'gpt-6-astra',
  'flux-2-pro': 'fal-ai/flux-2-pro',
  'flux/dev': 'fal-ai/flux/dev',
};

export function normalizeEndpoint(id: string): string {
  const raw = (id || '').trim();
  if (!raw) return raw;
  return ENDPOINT_ALIASES[raw] || ENDPOINT_ALIASES[raw.toLowerCase()] || raw;
}

function hasFal(providers: ResolvedProviders): boolean {
  return Boolean(providers.falApiKey);
}

function hasOpenAIImages(providers: ResolvedProviders): boolean {
  return Boolean(providers.openaiApiKey);
}

function hasClaude(providers: ResolvedProviders): boolean {
  return Boolean(providers.claudeApiKey);
}

export function isWeakFalModel(endpoint: string): boolean {
  return !isHighEndModel(endpoint);
}

export function isLowEndModel(endpoint: string): boolean {
  return !isHighEndModel(endpoint);
}

export function explainMissingPremium(
  providers: ResolvedProviders,
  capability?: ImageCapability,
): string {
  const stack = inspectProviderStack(providers);
  const kind = capability ? capabilityLabel(capability) : 'this image';
  const missing: string[] = [];
  if (!stack.fal) missing.push('a fal.ai API key (Settings → Image generation)');
  if (!stack.openai) missing.push('an OpenAI API key (Settings → Text model) for GPT-6 Astra / GPT Image 2.5');
  const needLine = missing.length
    ? `Add ${missing.join(' and ')}.`
    : 'Top up fal.ai and/or OpenAI billing — the high-end model for this brief is out of credits or rejected the request.';
  return [
    `Image generation stopped. We only run high-end models (FLUX.2 Max/Pro, Recraft V4, Ideogram V3, Nano Banana Pro, GPT Image 2.5 Sunburst, GPT-6 Astra) — never Flux Dev, Schnell, FLUX.2 Dev, GPT Image 1, Flare, or DALL·E 2.`,
    `Needed for ${kind}: a paid high-end image model with remaining credits.`,
    needLine,
    `Right now: ${stack.summary}.`,
  ].join(' ');
}

/**
 * Inspect which integration keys exist and the preferred Claude → OpenAI order.
 * Claude has no image API — llmAssist is for routing/copy; imageProvider is fal|openai.
 */
export function inspectProviderStack(providers: ResolvedProviders): ProviderStack {
  const fal = hasFal(providers);
  const claude = hasClaude(providers);
  const openai = hasOpenAIImages(providers);
  const llmAssist: LlmAssistKind | null = claude ? 'claude' : openai ? 'openai' : null;
  const imageProvider: ImageProviderKind | null = fal ? 'fal' : openai ? 'openai' : null;
  const bits = [
    `fal${fal ? '✓' : '✗'}`,
    `claude${claude ? '✓' : '✗'}`,
    `openai${openai ? '✓' : '✗'}`,
  ];
  const summary = `keys ${bits.join(' ')} · LLM ${llmAssist || 'none'} · pixels ${imageProvider || 'none'}`;
  return { fal, claude, openai, llmAssist, imageProvider, summary };
}

function candidateAvailable(c: ModelCandidate, providers: ResolvedProviders): boolean {
  if (c.provider === 'fal') return hasFal(providers);
  return hasOpenAIImages(providers);
}

/**
 * Prefer strong fal models; if fal is missing or only weak fal remains, switch to
 * OpenAI images (after Claude→OpenAI key check for LLM assist is recorded separately).
 */
function preferStrongModels(
  all: ModelCandidate[],
  providers: ResolvedProviders,
): ModelCandidate[] {
  const high = all.filter((c) => isHighEndModel(c.endpoint) && candidateAvailable(c, providers));
  const fal = high.filter((c) => c.provider === 'fal');
  const oai = high.filter((c) => c.provider === 'openai');
  if (fal.length) return [...fal, ...oai];
  return [...oai];
}

function gatherText(ctx: RouteContext): string {
  const hist = (ctx.chatHistory || [])
    .slice(-6)
    .map((m) => m.content)
    .join('\n');
  return [ctx.prompt, hist, ctx.selectedCategory, ctx.playId, ctx.posterTemplateId]
    .filter(Boolean)
    .join('\n');
}

export function inferArtRole(ctx: RouteContext): ArtRole {
  if (ctx.artRole) return ctx.artRole;
  if (ctx.posterTemplateId || ctx.designSource === 'template' || ctx.designSource === 'brand_template') {
    return 'hero_under_svg';
  }
  const text = gatherText(ctx);
  if (KEYWORD_RULES.find((r) => r.capability === 'typography_native')!.patterns.some((p) => p.test(text))) {
    return 'final_with_text';
  }
  if (ctx.designSource === 'ai') return 'final_with_text';
  return 'raw';
}

function scoreCapabilities(ctx: RouteContext, artRole: ArtRole): Record<ImageCapability, number> {
  const scores: Record<ImageCapability, number> = {
    vector_brand: 0,
    character_consistent: 0,
    photoreal_general: 0,
    typography_native: 0,
    product_ui: 0,
  };

  const playId = (ctx.playId || ctx.selectedCategory || '').trim();
  const bias = PLAY_BIAS[playId];
  if (bias) {
    for (const [cap, w] of Object.entries(bias)) {
      scores[cap as ImageCapability] += w || 0;
    }
  }

  const text = gatherText(ctx);
  for (const rule of KEYWORD_RULES) {
    let hits = 0;
    for (const p of rule.patterns) if (p.test(text)) hits += 1;
    if (hits) scores[rule.capability] += rule.weight * hits;
  }

  if (ctx.referenceImageUrl) {
    scores.character_consistent += 3;
  }

  // Poster SVG compositors draw type — keep raster text-free.
  if (artRole === 'hero_under_svg') {
    scores.photoreal_general += 4;
    scores.vector_brand = Math.max(0, scores.vector_brand - 4);
    scores.typography_native = Math.max(0, scores.typography_native - 5);
  } else if (artRole === 'final_with_text') {
    scores.typography_native += 4;
  }

  // Soft prefer Settings model class.
  const settings = normalizeEndpoint(ctx.settingsFalModel || '');
  if (settings) {
    for (const [cap, list] of Object.entries(CAPABILITY_CANDIDATES) as Array<
      [ImageCapability, ModelCandidate[]]
    >) {
      if (list.some((c) => c.endpoint === settings)) scores[cap] += 1;
    }
  }

  return scores;
}

function pickCapability(scores: Record<ImageCapability, number>): ImageCapability {
  let best: ImageCapability = 'photoreal_general';
  let bestScore = -1;
  for (const [cap, score] of Object.entries(scores) as Array<[ImageCapability, number]>) {
    if (score > bestScore) {
      best = cap;
      bestScore = score;
    }
  }
  if (bestScore <= 0) return 'photoreal_general';
  return best;
}

function buildChain(
  capability: ImageCapability,
  providers: ResolvedProviders,
  prefer?: string | null,
  opts?: { allowCrossCapabilityPrefer?: boolean; strictCapability?: boolean },
): ModelCandidate[] {
  const preferNorm = prefer ? normalizeEndpoint(prefer) : '';
  const primary = [...CAPABILITY_CANDIDATES[capability]];
  const extras: ModelCandidate[] = [];
  if (!opts?.strictCapability) {
    for (const next of CAPABILITY_FALLBACK[capability] || []) {
      for (const c of CAPABILITY_CANDIDATES[next]) {
        if (!primary.some((p) => p.endpoint === c.endpoint) && !extras.some((e) => e.endpoint === c.endpoint)) {
          extras.push(c);
        }
      }
    }
  }
  const preferHighEnd = preferNorm && isHighEndModel(preferNorm) ? preferNorm : '';
  let all = preferStrongModels(
    [...primary, ...extras].filter((c) => candidateAvailable(c, providers)),
    providers,
  );

  if (preferHighEnd) {
    const hitIdx = all.findIndex((c) => c.endpoint === preferHighEnd);
    if (hitIdx > 0) {
      const primaryEndpoint = primary[0]?.endpoint;
      const primaryAvailable = primaryEndpoint
        ? all.some((c) => c.endpoint === primaryEndpoint && isHighEndModel(c.endpoint))
        : false;
      if (!primaryAvailable || preferHighEnd === primaryEndpoint) {
        const [hit] = all.splice(hitIdx, 1);
        all = preferStrongModels([hit, ...all], providers);
      }
    } else if (opts?.allowCrossCapabilityPrefer) {
      const fromAny = Object.values(CAPABILITY_CANDIDATES)
        .flat()
        .find((c) => c.endpoint === preferHighEnd);
      if (fromAny && candidateAvailable(fromAny, providers) && isHighEndModel(fromAny.endpoint)) {
        all = preferStrongModels(
          [fromAny, ...all.filter((c) => c.endpoint !== preferHighEnd)],
          providers,
        );
      }
    }
  }

  if (!all.length && hasOpenAIImages(providers)) {
    all.push({ endpoint: 'gpt-6-astra', provider: 'openai', label: 'GPT-6 Astra' });
  }
  if (!all.length && hasFal(providers)) {
    all.push({ endpoint: 'fal-ai/flux-2-pro', provider: 'fal', label: 'FLUX.2 Pro' });
  }
  return all.filter((c) => isHighEndModel(c.endpoint));
}

function capabilityLabel(cap: ImageCapability): string {
  switch (cap) {
    case 'vector_brand':
      return 'vector / brand graphics';
    case 'character_consistent':
      return 'character consistency';
    case 'photoreal_general':
      return 'photorealistic art';
    case 'typography_native':
      return 'native typography';
    case 'product_ui':
      return 'product / UI visuals';
  }
}

/**
 * Classify prompt + play + keys → endpoint decision (no network).
 */
export function determineBestModel(
  ctx: RouteContext,
  providers: ResolvedProviders,
): RouteDecision {
  const artRole = inferArtRole(ctx);
  const mode = ctx.routingMode || 'auto';
  const stack = inspectProviderStack(providers);

  if (!stack.fal && !stack.openai) {
    throw new ImageModelUnavailableError(explainMissingPremium(providers));
  }

  if (mode === 'manual') {
    const pinned = normalizeEndpoint(ctx.modelOverride || providers.falModel || '');
    const chain = buildChain('photoreal_general', providers, pinned, {
      allowCrossCapabilityPrefer: true,
    });
    let capability: ImageCapability = 'photoreal_general';
    for (const [cap, list] of Object.entries(CAPABILITY_CANDIDATES) as Array<
      [ImageCapability, ModelCandidate[]]
    >) {
      if (list.some((c) => c.endpoint === pinned)) {
        capability = cap;
        break;
      }
    }
    const manualChain = buildChain(capability, providers, pinned, {
      allowCrossCapabilityPrefer: true,
    });
    const pick = manualChain[0] || chain[0];
    if (!pick || !isHighEndModel(pick.endpoint)) {
      throw new ImageModelUnavailableError(explainMissingPremium(providers, capability));
    }
    const remapped = pinned && pick.endpoint !== pinned;
    const keyNote = !stack.fal
      ? ` · fal✗ → Claude${stack.claude ? '✓' : '✗'} then OpenAI${stack.openai ? '✓' : '✗'} (pixels ${pick.provider})`
      : '';
    return {
      endpoint: pick.endpoint,
      provider: pick.provider,
      capability,
      reason: remapped
        ? `Manual pin "${pinned}" unavailable — switched to ${pick.label} (${capabilityLabel(capability)})${keyNote}`
        : `Manual pin → ${pick.label}${keyNote}`,
      fallbackChain: manualChain.map((c) => c.endpoint),
      artRole,
      score: 99,
      stack,
      llmAssist: stack.llmAssist,
    };
  }

  const scores = scoreCapabilities(ctx, artRole);
  const capability = ctx.forceCapability || pickCapability(scores);
  const chain = buildChain(capability, providers, ctx.settingsFalModel || providers.falModel, {
    strictCapability: Boolean(ctx.forceCapability),
  });
  const pick = chain[0];
  if (!pick || !isHighEndModel(pick.endpoint)) {
    throw new ImageModelUnavailableError(explainMissingPremium(providers, capability));
  }

  const playId = (ctx.playId || ctx.selectedCategory || '').trim();
  const parts = [
    playId ? `play=${playId}` : 'chat/brief',
    `artRole=${artRole}`,
    ctx.forceCapability ? `forced=${capabilityLabel(capability)}` : capabilityLabel(capability),
    `→ ${pick.label}`,
  ];
  if (ctx.referenceImageUrl && !ctx.forceCapability) parts.push('reference image');
  if (!ctx.forceCapability && scores[capability] <= 1) parts.push('default high-quality path');

  if (!stack.fal) {
    parts.push(
      `fal✗ · prefer Claude${stack.claude ? '✓' : '✗'} then OpenAI${stack.openai ? '✓' : '✗'} · pixels via OpenAI`,
    );
  } else if (pick.provider === 'openai' && stack.fal) {
    parts.push('high-end fal unavailable for this capability → OpenAI');
  }

  if (stack.llmAssist) {
    parts.push(`LLM assist ${stack.llmAssist}`);
  }

  return {
    endpoint: pick.endpoint,
    provider: pick.provider,
    capability,
    reason: `Routed for ${parts.join(' · ')}`,
    fallbackChain: chain.map((c) => c.endpoint),
    artRole,
    score: scores[capability],
    stack,
    llmAssist: stack.llmAssist,
  };
}

/** Apply a route onto ResolvedProviders for generateContentImage. */
export function applyRouteToProviders(
  providers: ResolvedProviders,
  decision: RouteDecision,
): ResolvedProviders {
  return {
    ...providers,
    imageProvider: decision.provider,
    falModel: decision.endpoint,
  };
}

/**
 * After a hard failure on the primary endpoint, advance to the next in the chain.
 */
export function nextFallbackProviders(
  providers: ResolvedProviders,
  decision: RouteDecision,
  failedEndpoint: string,
  opts?: { otherProviderOnly?: boolean },
): { providers: ResolvedProviders; decision: RouteDecision } | null {
  const idx = decision.fallbackChain.indexOf(failedEndpoint);
  const rest = decision.fallbackChain
    .slice(idx + 1)
    .concat(decision.fallbackChain.filter((e) => e !== failedEndpoint))
    .filter((e, i, arr) => arr.indexOf(e) === i && e !== failedEndpoint && isHighEndModel(e));

  for (const nextId of rest) {
    let provider: ImageProviderKind = 'fal';
    for (const list of Object.values(CAPABILITY_CANDIDATES)) {
      const hit = list.find((c) => c.endpoint === nextId);
      if (hit) {
        provider = hit.provider;
        break;
      }
    }
    if (!nextId.includes('/') && !nextId.startsWith('fal-')) provider = 'openai';
    if (opts?.otherProviderOnly && provider === decision.provider) continue;

    const nextDecision: RouteDecision = {
      ...decision,
      endpoint: nextId,
      provider,
      reason: `${decision.reason} · high-end peer after ${failedEndpoint} → ${nextId}`,
    };
    return { providers: applyRouteToProviders(providers, nextDecision), decision: nextDecision };
  }
  return null;
}

/** Convenience used by scripts / future callers. */
export function routeForGeneration(
  ctx: RouteContext,
  providers: ResolvedProviders,
): { decision: RouteDecision; providers: ResolvedProviders } {
  const decision = determineBestModel(
    {
      ...ctx,
      settingsFalModel: ctx.settingsFalModel ?? providers.falModel,
    },
    providers,
  );
  return { decision, providers: applyRouteToProviders(providers, decision) };
}
