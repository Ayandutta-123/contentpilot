import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { resolveProviders } from './providers.service';
import { ProviderCreditError, buildProviderCreditAlert, isCreditFailureText, type CreditTool } from '../lib/provider-credits';

function throwVisionFailure(tool: CreditTool, label: string, status: number, errText: string): never {
  if (isCreditFailureText(`${errText} ${tool}`, status)) {
    throw new ProviderCreditError(buildProviderCreditAlert(tool, 'caption'));
  }
  throw new Error(`${label} (${status}): ${errText.slice(0, 240)}`);
}

/**
 * Load a brand-reference upload (or remote URL) as a data URI for vision / img2img.
 */
export async function resolveReferenceDataUri(urlOrPath: string): Promise<string> {
  if (!urlOrPath) throw new Error('No brand reference image');
  if (urlOrPath.startsWith('data:')) return urlOrPath;

  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    const res = await fetch(urlOrPath);
    if (!res.ok) throw new Error(`Could not fetch brand reference (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ctype = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    const mime = ctype.startsWith('image/') ? ctype : 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  const cleaned = urlOrPath.replace(/^\/uploads\//, '');
  const full = path.resolve(config.UPLOAD_DIR, cleaned);
  if (!full.startsWith(path.resolve(config.UPLOAD_DIR)) || !fs.existsSync(full)) {
    throw new Error('Brand reference file not found');
  }
  const buf = fs.readFileSync(full);
  const ext = path.extname(full).toLowerCase();
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.gif'
          ? 'image/gif'
          : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Absolute URL for providers that need a fetchable image (fal img2img).
 * Local uploads are served from API /uploads.
 */
export function resolveReferencePublicUrl(urlOrPath: string): string {
  if (!urlOrPath) return '';
  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://') || urlOrPath.startsWith('data:')) {
    return urlOrPath;
  }
  const base = config.API_URL.replace(/\/$/, '');
  const pathPart = urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`;
  return `${base}${pathPart}`;
}

const STYLE_ANALYSIS_PROMPT = `You are a creative art director. Analyze this brand / social reference image.

Return a detailed STYLE BRIEF (plain text, 120–220 words) covering ONLY visual style — not the specific subject matter:
- Medium (photo / flat illustration / 3D / collage / vector / watercolor / etc.)
- Color palette (exact dominant hues + accents)
- Lighting and mood
- Composition / layout energy (centered hero, grid, typography-led, full-bleed photo, etc.)
- Texture and finish (grain, soft gradients, hard edges, glossy, matte)
- Typography treatment if lettering appears (weight, placement) — say "leave room for new headline" without copying words
- What to keep constant for a matching campaign post

Do NOT invent a new topic. Do NOT list the readable headline text to reuse. Focus on how it LOOKS.`;

/**
 * Use vision (OpenAI or Claude) so the image model can actually "see" the brand reference.
 */
export async function describeBrandReferenceStyle(
  tenantId: string,
  referenceImageUrl: string,
): Promise<string> {
  const providers = await resolveProviders(tenantId);
  const dataUri = await resolveReferenceDataUri(referenceImageUrl);

  if (providers.llmProvider === 'claude' && providers.claudeApiKey) {
    return describeWithClaude(
      providers.claudeApiKey,
      providers.llmModel,
      dataUri,
      providers.claudeWorkspaceId,
    );
  }
  if (providers.openaiApiKey) {
    return describeWithOpenAI(providers.openaiApiKey, dataUri);
  }
  if (providers.claudeApiKey) {
    return describeWithClaude(
      providers.claudeApiKey,
      providers.llmModel || 'claude-sonnet-4-20250514',
      dataUri,
      providers.claudeWorkspaceId,
    );
  }
  throw new Error('No LLM API key available to analyze the brand reference image.');
}

async function describeWithOpenAI(apiKey: string, dataUri: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: STYLE_ANALYSIS_PROMPT },
            { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throwVisionFailure('openai', 'Vision style analysis failed', res.status, await res.text());
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Vision style analysis returned empty');
  return text;
}

async function describeWithClaude(
  apiKey: string,
  model: string,
  dataUri: string,
  workspaceId?: string,
): Promise<string> {
  const m = dataUri.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid reference data URI for vision analysis');
  const mediaType = m[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      ...(workspaceId ? { 'anthropic-workspace-id': workspaceId } : {}),
    },
    body: JSON.stringify({
      model: model.includes('claude') ? model : 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: m[2] },
            },
            { type: 'text', text: STYLE_ANALYSIS_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throwVisionFailure('claude', 'Vision analysis failed', res.status, await res.text());
  }
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === 'text')?.text?.trim();
  if (!text) throw new Error('Vision analysis returned empty');
  return text;
}

/** Build the locked prompt: same visual style as reference, new subject from chat. */
export function buildReferenceLockedImagePrompt(opts: {
  chatSubject: string;
  styleBrief: string;
  companyName?: string | null;
  brandImageStyle?: string | null;
}): string {
  const company = opts.companyName?.trim() || 'the brand';
  return [
    `Create a NEW social media poster for ${company}.`,
    `SUBJECT / MESSAGE (from the chat — customize THIS, do not copy the reference scene): ${opts.chatSubject}`,
    `STYLE LOCK (mandatory — match the brand reference closely): ${opts.styleBrief}`,
    opts.brandImageStyle ? `Additional brand image style notes: ${opts.brandImageStyle}` : '',
    'Keep the same medium, palette, lighting, composition energy, and finish as the reference.',
    'Change only the subject/content to match the chat request — it should feel like the next post in the same campaign series.',
    'Do not copy readable text, logos, or watermarks from the reference.',
    'Agency-quality finished LinkedIn/Instagram creative, full-bleed.',
  ]
    .filter(Boolean)
    .join(' ');
}

const MEME_STRUCTURE_PROMPT = `You analyze a viral meme image for STRUCTURE only (not to copy copyrighted art or celebrity faces).

Return JSON ONLY:
{
  "layout": "split_v" | "split_h" | "impact" | "stacked",
  "panelCount": 1-4,
  "captionStyle": "short description of how text sits (top/bottom Impact bars, panel labels, etc.)",
  "structureNotes": "how the joke is paced across panels — setup vs punchline",
  "visualRecipe": "ORIGINAL recreation recipe: composition, panel split, color energy, silhouette/object metaphors — NO celebrity likeness, NO readable text to paint",
  "suggestedFormatId": "expectation_vs_reality|reject_approve|expanding_brain|distracted_choice|this_is_fine|waiting|trade_offer|one_does_not_simply|other"
}`;

export type MemeStructureBrief = {
  layout: 'split_v' | 'split_h' | 'impact' | 'stacked';
  panelCount: number;
  captionStyle: string;
  structureNotes: string;
  visualRecipe: string;
  suggestedFormatId?: string;
};

/** Vision: extract meme layout + caption structure from a scraped meme image. */
export async function describeMemeReferenceStructure(
  tenantId: string,
  referenceImageUrl: string,
): Promise<MemeStructureBrief> {
  const providers = await resolveProviders(tenantId);
  const dataUri = await resolveReferenceDataUri(referenceImageUrl);
  let raw = '';

  if (providers.llmProvider === 'claude' && providers.claudeApiKey) {
    raw = await visionTextClaude(
      providers.claudeApiKey,
      providers.llmModel,
      dataUri,
      MEME_STRUCTURE_PROMPT,
      providers.claudeWorkspaceId,
    );
  } else if (providers.openaiApiKey) {
    raw = await visionTextOpenAI(providers.openaiApiKey, dataUri, MEME_STRUCTURE_PROMPT);
  } else if (providers.claudeApiKey) {
    raw = await visionTextClaude(
      providers.claudeApiKey,
      providers.llmModel || 'claude-sonnet-4-20250514',
      dataUri,
      MEME_STRUCTURE_PROMPT,
      providers.claudeWorkspaceId,
    );
  } else {
    throw new Error('No LLM API key available to analyze the meme reference image.');
  }

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as Record<string, unknown>) : {};
  const layoutRaw = String(parsed.layout || 'impact');
  const layout = (['split_v', 'split_h', 'impact', 'stacked'].includes(layoutRaw)
    ? layoutRaw
    : 'impact') as MemeStructureBrief['layout'];

  return {
    layout,
    panelCount: Math.min(4, Math.max(1, Number(parsed.panelCount) || 2)),
    captionStyle: String(parsed.captionStyle || 'Classic top/bottom meme captions'),
    structureNotes: String(parsed.structureNotes || 'Setup then punchline'),
    visualRecipe: String(
      parsed.visualRecipe ||
        'Recreate the same panel layout and comic energy with original anonymous silhouettes — no celebrity faces, no readable text in art',
    ),
    suggestedFormatId:
      typeof parsed.suggestedFormatId === 'string' ? parsed.suggestedFormatId : undefined,
  };
}

async function visionTextOpenAI(apiKey: string, dataUri: string, prompt: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throwVisionFailure('openai', 'Vision structure analysis failed', res.status, await res.text());
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Vision structure analysis returned empty');
  return text;
}

async function visionTextClaude(
  apiKey: string,
  model: string,
  dataUri: string,
  prompt: string,
  workspaceId?: string,
): Promise<string> {
  const m = dataUri.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid reference data URI for vision analysis');
  const mediaType = m[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
      ...(workspaceId ? { 'anthropic-workspace-id': workspaceId } : {}),
    },
    body: JSON.stringify({
      model: model.includes('claude') ? model : 'claude-sonnet-4-20250514',
      max_tokens: 700,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: m[2] },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throwVisionFailure('claude', 'Vision structure analysis failed', res.status, await res.text());
  }
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === 'text')?.text?.trim();
  if (!text) throw new Error('Vision structure analysis returned empty');
  return text;
}
