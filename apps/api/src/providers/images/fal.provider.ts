import type { ResolvedProviders } from '../../services/providers.service';
import { config } from '../../config';
import {
  SOCIAL_IMAGE_FORMATS,
  type SocialImageFormat,
} from './social-frame';
import { ProviderCreditError, buildProviderCreditAlert, isCreditFailureText } from '../../lib/provider-credits';
import {
  explainMissingPremium,
  ImageModelUnavailableError,
  isHighEndModel,
} from '../../services/smart-image-router.service';

interface FalImageResult {
  url: string;
  model: string;
}

export type GenerateImageOptions = {
  format?: SocialImageFormat;
  /** When true, send prompt as-is (no style/size suffix) */
  exact?: boolean;
  brandImageStyle?: string;
  /** Brand reference — prefer img2img / style-preserving generation when set */
  referenceImageUrl?: string | null;
  /** 0–1 how strongly to keep reference look (img2img strength inverted conceptually) */
  referenceStrength?: number;
  /** Things the model must not draw. Sent natively when the endpoint supports it. */
  negativePrompt?: string | null;
  /** Preserve the supplied source image and apply only the requested edit. */
  editMode?: boolean;
};

/** Endpoints that edit/transform an existing image — not valid for text→image posts */
const FAL_EDIT_OR_I2I = [
  '/edit',
  'image-to-image',
  'img2img',
  '/inpaint',
  'pulid',
  'face-to-sticker',
  'ip-adapter',
];

const FALLBACK_T2I = 'fal-ai/flux-2-pro';

function resolveFalTextToImageModel(model: string): string {
  const m = (model || '').toLowerCase();
  if (!m) return FALLBACK_T2I;
  if (FAL_EDIT_OR_I2I.some((s) => m.includes(s))) {
    if (m.includes('nano-banana')) return 'fal-ai/nano-banana-pro';
    return FALLBACK_T2I;
  }
  return model;
}

function isGptImageModel(model: string): boolean {
  const m = model.toLowerCase();
  return (
    m.includes('gpt-image') ||
    m.includes('openai/gpt-image') ||
    m.startsWith('gpt-6-astra')
  );
}

/**
 * Distilled/guidance-free models (flux-pro, GPT Image) reject negative_prompt —
 * for those we fold the ban list into the prompt text instead.
 */
function supportsNegativePrompt(model: string): boolean {
  const m = model.toLowerCase();
  if (isGptImageModel(m)) return false;
  if (m.includes('flux-pro') || m.includes('flux/pro') || m.includes('ultra')) return false;
  return (
    m.includes('stable-diffusion') ||
    m.includes('sd3') ||
    m.includes('flux/dev') ||
    m.includes('flux/schnell') ||
    m.includes('recraft')
  );
}

/** Pro / Ultra tiers tune sampling internally and reject step & CFG overrides. */
function acceptsSamplingControls(model: string): boolean {
  const m = model.toLowerCase();
  if (m.includes('flux-pro') || m.includes('flux/pro') || m.includes('ultra')) return false;
  if (isGptImageModel(m)) return false;
  return m.includes('flux') || m.includes('stable-diffusion') || m.includes('sd3');
}

/**
 * fal defaults (28 steps / CFG 3.5) are tuned for speed. Brand creative needs
 * more sampling and firmer prompt adherence. GPT Image models want quality=high.
 */
function buildFalBody(
  model: string,
  prompt: string,
  format: SocialImageFormat,
  negativePrompt?: string | null,
): Record<string, unknown> {
  const sizeSpec = SOCIAL_IMAGE_FORMATS[format];
  // GPT Image 2 rewards concrete briefs + high quality; prefer sharper square.
  const imageSize = isGptImageModel(model)
    ? format === 'instagram_square'
      ? { width: 1536, height: 1536 }
      : sizeSpec.falSize
    : sizeSpec.falSize;

  const body: Record<string, unknown> = {
    prompt,
    num_images: 1,
    enable_safety_checker: true,
    image_size: imageSize,
    output_format: 'png',
  };
  if (isGptImageModel(model)) {
    body.quality = 'high';
  }
  if (negativePrompt?.trim() && supportsNegativePrompt(model)) {
    body.negative_prompt = negativePrompt.trim().slice(0, 900);
  }
  if (acceptsSamplingControls(model)) {
    body.num_inference_steps = 40;
    body.guidance_scale = 4.5;
    body.acceleration = 'none';
  }
  return body;
}

function readImageUrl(data: unknown): string | null {
  const d = data as {
    images?: Array<{ url?: string }>;
    image?: { url?: string };
    data?: { images?: Array<{ url?: string }> };
  };
  return d?.images?.[0]?.url ?? d?.image?.url ?? d?.data?.images?.[0]?.url ?? null;
}

/**
 * Generate an image via fal.ai using a fixed social size.
 * Degrades payload (then model) rather than failing when an endpoint rejects options.
 */
export async function generateImageWithFal(
  providers: ResolvedProviders,
  prompt: string,
  format: SocialImageFormat = 'instagram_square',
  negativePrompt?: string | null,
): Promise<FalImageResult> {
  const apiKey = providers.falApiKey || config.FAL_API_KEY;
  if (!apiKey) {
    throw new Error('Image API key not configured. Add it in Settings → Integrations.');
  }

  const requested = providers.falModel || config.FAL_MODEL;
  const primary = resolveFalTextToImageModel(requested);
  if (!isHighEndModel(primary)) {
    throw new ImageModelUnavailableError(
      `${explainMissingPremium(providers)} Requested “${requested}” is a low-end model and is blocked.`,
    );
  }
  const sizeSpec = SOCIAL_IMAGE_FORMATS[format];
  // Never silently downgrade a high-end model — retry payload shapes on the same model only.
  const models = [primary];

  let lastError = 'unknown error';

  for (const model of models) {
    const bodies: Array<Record<string, unknown>> = [
      buildFalBody(model, prompt, format, negativePrompt),
      isGptImageModel(model)
        ? {
            prompt,
            num_images: 1,
            quality: 'high',
            enable_safety_checker: true,
            image_size: format === 'instagram_square' ? 'square_hd' : sizeSpec.falSize,
            output_format: 'png',
          }
        : { prompt, num_images: 1, enable_safety_checker: true, image_size: sizeSpec.falSize },
      {
        prompt: `${prompt} Aspect ratio ${sizeSpec.width}:${sizeSpec.height}, fill frame.`,
        num_images: 1,
        enable_safety_checker: true,
        image_size: 'square_hd',
        ...(isGptImageModel(model) ? { quality: 'high' } : {}),
      },
    ];

    for (const body of bodies) {
      const response = await fetch(`https://fal.run/${model}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const url = readImageUrl(await response.json());
        if (url) {
          if (model !== primary) {
            console.warn(
              `[fal] requested ${primary} failed; succeeded with fallback model=${model}`,
            );
          }
          return { url, model };
        }
        lastError = `model=${model} returned no image URL`;
        continue;
      }

      const errText = (await response.text()).slice(0, 300);
      lastError = `${response.status} model=${model}: ${errText}`;
      console.warn(`[fal] model=${model} rejected: ${lastError}`);
      if (isCreditFailureText(`${errText} fal.ai`, response.status)) {
        throw new ProviderCreditError(buildProviderCreditAlert('fal', 'image'));
      }
      // Bad credentials will fail identically on every retry — stop now.
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Image service rejected the API key (${response.status}): ${errText}`);
      }
    }
  }

  throw new ImageModelUnavailableError(
    `${explainMissingPremium(providers)} High-end model ${requested} failed: ${lastError}`,
  );
}

const OPENAI_NATIVE_IMAGE_IDS = new Set([
  'gpt-6-astra',
  'gpt-6-astra-pro',
  'gpt-image-2.5-sunburst',
]);

/** GPT-6 Astra uses Responses + image_generation tool (not Images API model id). */
async function generateImageWithOpenAIResponses(
  apiKey: string,
  model: string,
  prompt: string,
  size: string,
): Promise<FalImageResult> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: prompt,
      tools: [
        {
          type: 'image_generation',
          size,
          quality: 'high',
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = (await response.text()).slice(0, 300);
    if (isCreditFailureText(`${errText} openai`, response.status)) {
      throw new ProviderCreditError(buildProviderCreditAlert('openai', 'image'));
    }
    throw new Error(`Image generation failed (${response.status}): ${errText}`);
  }

  const data = (await response.json()) as {
    output?: Array<{
      type?: string;
      result?: string;
      b64_json?: string;
      image_url?: string;
      url?: string;
    }>;
  };

  for (const item of data.output ?? []) {
    if (item.type !== 'image_generation_call') continue;
    const b64 = item.result || item.b64_json;
    if (b64) return { url: `data:image/png;base64,${b64}`, model };
    const url = item.image_url || item.url;
    if (url) return { url, model };
  }
  throw new Error('Image service returned no image');
}

export async function generateImageWithOpenAI(
  providers: ResolvedProviders,
  prompt: string,
  format: SocialImageFormat = 'instagram_square',
): Promise<FalImageResult> {
  if (!providers.openaiApiKey) {
    throw new ImageModelUnavailableError(
      `${explainMissingPremium(providers)} Add an OpenAI API key in Settings → Text model.`,
    );
  }

  const model = OPENAI_NATIVE_IMAGE_IDS.has(providers.falModel)
    ? providers.falModel
    : 'gpt-6-astra';

  const { width, height } = SOCIAL_IMAGE_FORMATS[format];
  // OpenAI only accepts specific sizes — prefer square for social feed
  const size =
    format === 'linkedin' ? '1536x1024' : format === 'story' ? '1024x1536' : '1024x1024';
  const fullPrompt = `${prompt} Target canvas ${width}x${height}.`;

  if (model.startsWith('gpt-6-astra')) {
    return generateImageWithOpenAIResponses(providers.openaiApiKey, model, fullPrompt, size);
  }

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${providers.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt: fullPrompt,
      n: 1,
      size,
      // gpt-image tiers accept an explicit render quality; DALL·E does not.
      ...(model.startsWith('gpt-image') ? { quality: 'high' } : {}),
    }),
  });

  if (!response.ok) {
    const errText = (await response.text()).slice(0, 300);
    if (isCreditFailureText(`${errText} openai`, response.status)) {
      throw new ProviderCreditError(buildProviderCreditAlert('openai', 'image'));
    }
    throw new Error(`Image generation failed (${response.status}): ${errText}`);
  }

  const data = await response.json() as {
    data?: Array<{ url?: string; b64_json?: string }>;
  };

  const item = data.data?.[0];
  if (item?.url) return { url: item.url, model };
  if (item?.b64_json) return { url: `data:image/png;base64,${item.b64_json}`, model };
  throw new Error('Image service returned no image');
}

/**
 * Style-preserving generation from a brand reference — high-end endpoints only.
 */
export async function generateImageWithFalReference(
  providers: ResolvedProviders,
  prompt: string,
  referenceImageUrl: string,
  format: SocialImageFormat = 'instagram_square',
  strength = 0.55,
  editMode = false,
): Promise<FalImageResult> {
  const apiKey = providers.falApiKey || config.FAL_API_KEY;
  if (!apiKey) {
    throw new ImageModelUnavailableError(
      `${explainMissingPremium(providers)} A fal.ai key is required for reference-guided images.`,
    );
  }

  const requested = (providers.falModel || '').toLowerCase();
  const model = editMode
    ? 'fal-ai/nano-banana-pro/edit'
    : requested.includes('nano-banana')
    ? 'fal-ai/nano-banana-pro/edit'
    : requested.includes('flux-2-max')
      ? 'fal-ai/flux-2-max'
      : 'fal-ai/flux-2-pro';

  const sizeSpec = SOCIAL_IMAGE_FORMATS[format];
  const isNanoEdit = model.includes('nano-banana-pro/edit');
  const body: Record<string, unknown> = isNanoEdit
    ? {
        prompt,
        image_urls: [referenceImageUrl],
        num_images: 1,
        output_format: 'png',
        aspect_ratio:
          format === 'story'
            ? '9:16'
            : format === 'instagram_portrait'
              ? '4:5'
              : format === 'linkedin'
                ? '16:9'
                : '1:1',
      }
    : {
        prompt,
        image_url: referenceImageUrl,
        image_urls: [referenceImageUrl],
        strength: Math.min(0.85, Math.max(0.35, strength)),
        num_images: 1,
        enable_safety_checker: true,
        image_size: typeof sizeSpec.falSize === 'string' ? sizeSpec.falSize : 'square_hd',
        output_format: 'png',
      };

  const response = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = (await response.text()).slice(0, 300);
    if (isCreditFailureText(`${errText} fal.ai`, response.status)) {
      throw new ProviderCreditError(buildProviderCreditAlert('fal', 'image'));
    }
    throw new Error(
      `fal high-end reference generate failed (${response.status}): ${errText}`,
    );
  }

  const url = readImageUrl(await response.json());
  if (!url) throw new Error('fal reference generate returned no image URL');
  return { url, model };
}

export async function generateContentImage(
  providers: ResolvedProviders,
  prompt: string,
  brandImageStyleOrOpts?: string | GenerateImageOptions,
): Promise<FalImageResult | null> {
  const opts: GenerateImageOptions =
    typeof brandImageStyleOrOpts === 'string' || brandImageStyleOrOpts == null
      ? { brandImageStyle: brandImageStyleOrOpts || undefined }
      : brandImageStyleOrOpts;

  const format = opts.format || 'instagram_square';
  const styledPrompt =
    opts.exact || !opts.brandImageStyle
      ? prompt
      : `${prompt}. Visual style: ${opts.brandImageStyle}`;
  const negative = opts.negativePrompt?.trim() || '';
  // flux-pro / GPT Image ignore negative_prompt, so state the bans in-prompt too.
  const fullPrompt = negative
    ? `${styledPrompt} Do NOT include any of the following: ${negative.slice(0, 700)}.`
    : styledPrompt;

  // Prefer fal img2img when a brand reference is attached
  if (opts.referenceImageUrl && (providers.falApiKey || config.FAL_API_KEY)) {
    try {
      return await generateImageWithFalReference(
        providers,
        fullPrompt,
        opts.referenceImageUrl,
        format,
        opts.referenceStrength ?? 0.55,
        opts.editMode === true,
      );
    } catch (err) {
      const { toProviderCreditError } = await import('../../lib/provider-credits');
      if (toProviderCreditError(err, 'fal', 'image')) throw err;
      if (opts.editMode) {
        throw new ImageModelUnavailableError(
          `Precise image editing failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // Fall through to text-to-image with style-locked prompt
    }
  }

  if (opts.editMode) {
    throw new ImageModelUnavailableError(
      'Precise image editing requires a fal.ai key for Nano Banana Pro Edit. The text-model choice still controls the chat.',
    );
  }

  if (providers.imageProvider === 'openai') {
    return generateImageWithOpenAI(providers, fullPrompt, format);
  }

  if (!providers.falApiKey && !config.FAL_API_KEY) {
    return null;
  }

  return generateImageWithFal(providers, fullPrompt, format, negative || undefined);
}
