export type ModelOption = {
  id: string;
  label: string;
  group?: string;
};

/** OpenAI chat / text models — pick ONE in Settings */
export const OPENAI_MODELS: ModelOption[] = [
  // GPT-6 family
  { id: 'gpt-6-astra', label: 'GPT-6 Astra (flagship)', group: 'GPT-6' },
  { id: 'gpt-6-astra-pro', label: 'GPT-6 Astra Pro', group: 'GPT-6' },
  // GPT-5.6 family (current flagship)
  { id: 'gpt-5.6', label: 'GPT-5.6 (alias → Sol)', group: 'GPT-5.6' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol (flagship)', group: 'GPT-5.6' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra (balanced)', group: 'GPT-5.6' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna (fast/cheap)', group: 'GPT-5.6' },
  // GPT-5 family
  { id: 'gpt-5', label: 'GPT-5', group: 'GPT-5' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini', group: 'GPT-5' },
  { id: 'gpt-5-nano', label: 'GPT-5 Nano', group: 'GPT-5' },
  { id: 'gpt-5-pro', label: 'GPT-5 Pro', group: 'GPT-5' },
  // GPT-4.1 family
  { id: 'gpt-4.1', label: 'GPT-4.1', group: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', group: 'GPT-4.1' },
  { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', group: 'GPT-4.1' },
  { id: 'gpt-4.1-2025-04-14', label: 'GPT-4.1 (2025-04-14)', group: 'GPT-4.1' },
  // GPT-4o family
  { id: 'gpt-4o', label: 'GPT-4o', group: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', group: 'GPT-4o' },
  { id: 'gpt-4o-2024-08-06', label: 'GPT-4o (2024-08-06)', group: 'GPT-4o' },
  { id: 'chatgpt-4o-latest', label: 'ChatGPT-4o Latest', group: 'GPT-4o' },
  // Reasoning (o-series)
  { id: 'o3', label: 'o3', group: 'Reasoning' },
  { id: 'o3-mini', label: 'o3 Mini', group: 'Reasoning' },
  { id: 'o3-pro', label: 'o3 Pro', group: 'Reasoning' },
  { id: 'o4-mini', label: 'o4 Mini', group: 'Reasoning' },
  { id: 'o1', label: 'o1', group: 'Reasoning' },
  { id: 'o1-pro', label: 'o1 Pro', group: 'Reasoning' },
  { id: 'o1-mini', label: 'o1 Mini', group: 'Reasoning' },
  // Legacy GPT-4 / 3.5
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', group: 'Legacy' },
  { id: 'gpt-4-turbo-2024-04-09', label: 'GPT-4 Turbo (2024-04-09)', group: 'Legacy' },
  { id: 'gpt-4', label: 'GPT-4', group: 'Legacy' },
  { id: 'gpt-4-0613', label: 'GPT-4 (0613)', group: 'Legacy' },
  { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', group: 'Legacy' },
  { id: 'gpt-3.5-turbo-0125', label: 'GPT-3.5 Turbo (0125)', group: 'Legacy' },
];

/** Anthropic Claude models — pick ONE in Settings */
export const CLAUDE_MODELS: ModelOption[] = [
  // Current (recommended)
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', group: 'Current' },
  { id: 'claude-opus-5', label: 'Claude Opus 5', group: 'Current' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', group: 'Current' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', group: 'Current' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (20251001)', group: 'Current' },
  // Still available (previous gen)
  { id: 'claude-fable-5', label: 'Claude Fable 5', group: 'Previous' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', group: 'Previous' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', group: 'Previous' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 (20250929)', group: 'Previous' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', group: 'Previous' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', group: 'Previous' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', group: 'Previous' },
  { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', group: 'Previous' },
];

/** Map retired / removed Claude IDs → current replacements */
export const CLAUDE_MODEL_MIGRATIONS: Record<string, string> = {
  'claude-sonnet-4-20250514': 'claude-sonnet-5',
  'claude-sonnet-4': 'claude-sonnet-5',
  'claude-opus-4-20250514': 'claude-opus-5',
  'claude-opus-4': 'claude-opus-5',
  'claude-opus-4-1-20250805': 'claude-opus-5',
  'claude-3-7-sonnet-latest': 'claude-sonnet-5',
  'claude-3-7-sonnet-20250219': 'claude-sonnet-5',
  'claude-3-5-sonnet-latest': 'claude-sonnet-5',
  'claude-3-5-sonnet-20241022': 'claude-sonnet-5',
  'claude-3-5-haiku-latest': 'claude-haiku-4-5',
  'claude-3-5-haiku-20241022': 'claude-haiku-4-5',
  'claude-3-opus-latest': 'claude-opus-5',
  'claude-3-opus-20240229': 'claude-opus-5',
  'claude-3-sonnet-20240229': 'claude-sonnet-5',
  'claude-3-haiku-20240307': 'claude-haiku-4-5',
  'claude-mythos-5': 'claude-opus-5',
};

export function resolveClaudeModelId(modelId: string | undefined | null): string {
  const id = (modelId || DEFAULT_CLAUDE_MODEL).trim();
  return CLAUDE_MODEL_MIGRATIONS[id] || id;
}

/** fal.ai text-to-image endpoints — pick ONE image model in Settings */
export const FAL_IMAGE_MODELS: ModelOption[] = [
  // FLUX.2
  { id: 'fal-ai/flux-2-pro', label: 'FLUX.2 Pro', group: 'FLUX.2' },
  { id: 'fal-ai/flux-2', label: 'FLUX.2 Dev', group: 'FLUX.2' },
  { id: 'fal-ai/flux-2-flex', label: 'FLUX.2 Flex', group: 'FLUX.2' },
  { id: 'fal-ai/flux-2-max', label: 'FLUX.2 Max', group: 'FLUX.2' },
  // FLUX.1
  { id: 'fal-ai/flux/dev', label: 'FLUX.1 Dev', group: 'FLUX.1' },
  { id: 'fal-ai/flux/schnell', label: 'FLUX.1 Schnell (fast)', group: 'FLUX.1' },
  { id: 'fal-ai/flux-pro', label: 'FLUX.1 Pro', group: 'FLUX.1' },
  { id: 'fal-ai/flux-pro/v1.1', label: 'FLUX Pro v1.1', group: 'FLUX.1' },
  { id: 'fal-ai/flux-pro/v1.1-ultra', label: 'FLUX Pro Ultra', group: 'FLUX.1' },
  { id: 'fal-ai/flux/dev/image-to-image', label: 'FLUX Dev Image-to-Image', group: 'FLUX.1' },
  { id: 'fal-ai/flux-lora', label: 'FLUX LoRA', group: 'FLUX.1' },
  { id: 'fal-ai/flux-realism', label: 'FLUX Realism', group: 'FLUX.1' },
  // OpenAI on fal (GPT-6 Astra is OpenAI-native only — not published on fal)
  { id: 'openai/gpt-image-2.5/sunburst/text-to-image', label: 'GPT Image 2.5 Sunburst (via fal)', group: 'OpenAI on fal' },
  { id: 'openai/gpt-image-2.5/flare/text-to-image', label: 'GPT Image 2.5 Flare (via fal)', group: 'OpenAI on fal' },
  { id: 'openai/gpt-image-2', label: 'GPT Image 2 (via fal)', group: 'OpenAI on fal' },
  { id: 'fal-ai/gpt-image-1', label: 'GPT Image 1 (via fal)', group: 'OpenAI on fal' },
  // Google
  { id: 'fal-ai/imagen4/preview', label: 'Imagen 4 Preview', group: 'Google' },
  { id: 'fal-ai/imagen4/preview/ultra', label: 'Imagen 4 Ultra', group: 'Google' },
  { id: 'fal-ai/imagen4/preview/fast', label: 'Imagen 4 Fast', group: 'Google' },
  // Ideogram
  { id: 'fal-ai/ideogram/v3', label: 'Ideogram V3', group: 'Ideogram' },
  { id: 'fal-ai/ideogram/v2', label: 'Ideogram V2', group: 'Ideogram' },
  { id: 'fal-ai/ideogram/v2a', label: 'Ideogram V2a', group: 'Ideogram' },
  { id: 'fal-ai/ideogram/v2/turbo', label: 'Ideogram V2 Turbo', group: 'Ideogram' },
  // Recraft
  { id: 'fal-ai/recraft-v3', label: 'Recraft V3', group: 'Recraft' },
  { id: 'fal-ai/recraft/v3/text-to-image', label: 'Recraft V3 Text-to-Image', group: 'Recraft' },
  { id: 'fal-ai/recraft/v4/text-to-image', label: 'Recraft V4', group: 'Recraft' },
  // Nano Banana / Google Gemini image
  { id: 'fal-ai/nano-banana', label: 'Nano Banana', group: 'Nano Banana' },
  { id: 'fal-ai/nano-banana-pro', label: 'Nano Banana Pro', group: 'Nano Banana' },
  { id: 'fal-ai/nano-banana/edit', label: 'Nano Banana Edit', group: 'Nano Banana' },
  // ByteDance / Seedream
  { id: 'fal-ai/bytedance/seedream/v3/text-to-image', label: 'Seedream V3', group: 'Seedream' },
  { id: 'fal-ai/bytedance/seedream/v4/text-to-image', label: 'Seedream V4', group: 'Seedream' },
  { id: 'fal-ai/bytedance/seedream/v4.5/text-to-image', label: 'Seedream V4.5', group: 'Seedream' },
  // Stable Diffusion
  { id: 'fal-ai/stable-diffusion-v35-large', label: 'SD 3.5 Large', group: 'Stable Diffusion' },
  { id: 'fal-ai/stable-diffusion-v3-medium', label: 'SD 3 Medium', group: 'Stable Diffusion' },
  { id: 'fal-ai/fast-sdxl', label: 'Fast SDXL', group: 'Stable Diffusion' },
  { id: 'fal-ai/stable-diffusion-v15', label: 'SD 1.5', group: 'Stable Diffusion' },
  // Others
  { id: 'fal-ai/aura-flow', label: 'AuraFlow', group: 'Other' },
  { id: 'fal-ai/minimax/image-01', label: 'MiniMax Image-01', group: 'Other' },
  { id: 'fal-ai/luma-photon', label: 'Luma Photon', group: 'Other' },
  { id: 'fal-ai/kolors', label: 'Kolors', group: 'Other' },
  { id: 'fal-ai/hunyuan-image/v3/text-to-image', label: 'Hunyuan Image V3', group: 'Other' },
  { id: 'fal-ai/qwen-image', label: 'Qwen Image', group: 'Other' },
  { id: 'fal-ai/krea-2/text-to-image', label: 'Krea 2', group: 'Other' },
  { id: 'fal-ai/z-image/turbo', label: 'Z-Image Turbo', group: 'Other' },
  { id: 'xai/grok-imagine-image', label: 'Grok Imagine', group: 'Other' },
];

/** OpenAI native image models (when image provider = openai) */
export const OPENAI_IMAGE_MODELS: ModelOption[] = [
  { id: 'gpt-6-astra', label: 'GPT-6 Astra (image)', group: 'OpenAI Images' },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', group: 'OpenAI Images' },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', group: 'OpenAI Images' },
  { id: 'gpt-image-2', label: 'GPT Image 2', group: 'OpenAI Images' },
  { id: 'gpt-image-1', label: 'GPT Image 1', group: 'OpenAI Images' },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5', group: 'OpenAI Images' },
  { id: 'dall-e-3', label: 'DALL·E 3', group: 'OpenAI Images' },
  { id: 'dall-e-2', label: 'DALL·E 2', group: 'OpenAI Images' },
];

export const DEFAULT_OPENAI_MODEL = 'gpt-4o';
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5';
export const DEFAULT_FAL_MODEL = 'fal-ai/flux-2-pro';
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-6-astra';
