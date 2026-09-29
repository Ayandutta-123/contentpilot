import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GeneratedPostSchema, CHARACTER_LIMITS, resolveClaudeModelId, type GeneratedPost } from '@contentpilot/shared';
import { resolveProviders, type ResolvedProviders } from './providers.service';
import { config } from '../config';
import { rethrowIfCreditError, type CreditJob } from '../lib/provider-credits';
import { marketGuidanceForPrompt } from '../lib/market-countries';
import { parseJsonObjectLenient } from '../lib/json';

export interface LLMGenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  maxRetries?: number;
  /** Used in the out-of-credits popup (caption vs website scrape). */
  job?: CreditJob;
  /** Override completion budget (default 4096). Use higher for long calendars. */
  maxTokens?: number;
}

export class LLMService {
  private providers: ResolvedProviders;

  constructor(providers: ResolvedProviders) {
    this.providers = providers;
  }

  static async forTenant(tenantId: string): Promise<LLMService> {
    return new LLMService(await resolveProviders(tenantId));
  }

  async generatePost(options: LLMGenerateOptions): Promise<GeneratedPost> {
    const maxRetries = options.maxRetries ?? 3;
    let lastError: Error | null = null;
    const tool = this.providers.llmProvider === 'claude' ? 'claude' : 'openai';
    const job = options.job || 'caption';
    // Higher default so detailed imagePrompt + caption fit in one completion
    const opts: LLMGenerateOptions = {
      ...options,
      maxTokens: options.maxTokens ?? 8192,
    };

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const raw =
          this.providers.llmProvider === 'claude'
            ? await this.generateWithClaude(opts)
            : await this.generateWithOpenAI(opts);

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (parseError) {
          throw new Error(
            `LLM JSON parse failed (attempt ${attempt}): ${parseError instanceof Error ? parseError.message : 'unknown'}. Raw: ${raw.slice(0, 200)}`,
          );
        }

        const validated = GeneratedPostSchema.safeParse(parsed);
        if (!validated.success) {
          throw new Error(
            `LLM output schema validation failed (attempt ${attempt}): ${validated.error.message}`,
          );
        }

        this.enforceCharacterLimits(validated.data);
        return validated.data;
      } catch (error) {
        rethrowIfCreditError(error, tool, job);
        lastError = error instanceof Error ? error : new Error(String(error));
        console.error(`[LLM] Attempt ${attempt}/${maxRetries} failed:`, lastError.message);
        if (/API key not configured|workspace ID/i.test(lastError.message)) throw lastError;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    }

    rethrowIfCreditError(lastError, tool, job);
    throw new Error(
      `LLM generation failed after ${maxRetries} attempts: ${lastError?.message ?? 'unknown error'}`,
    );
  }

  private async generateWithOpenAI(options: LLMGenerateOptions): Promise<string> {
    if (!this.providers.openaiApiKey) {
      throw new Error('Text-model API key not configured. Add it in Settings → Integrations.');
    }
    const client = new OpenAI({ apiKey: this.providers.openaiApiKey });
    const response = await client.chat.completions.create({
      model: this.providers.llmModel || config.LLM_MODEL,
      max_tokens: options.maxTokens ?? 4096,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: options.userPrompt },
      ],
    });
    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error('Text model returned an empty response');
    return raw;
  }

  private async generateWithClaude(options: LLMGenerateOptions): Promise<string> {
    if (!this.providers.claudeApiKey) {
      throw new Error('Text-model API key not configured. Add it in Settings → Integrations.');
    }
    const workspaceId = this.providers.claudeWorkspaceId?.trim();
    const client = new Anthropic({
      apiKey: this.providers.claudeApiKey,
      ...(workspaceId
        ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } }
        : {}),
    });
    const model =
      this.providers.llmProvider === 'claude'
        ? resolveClaudeModelId(this.providers.llmModel)
        : this.providers.llmModel || config.LLM_MODEL;
    try {
      const response = await client.messages.create({
        model,
        max_tokens: options.maxTokens ?? 4096,
        system: options.systemPrompt + '\n\nRespond with ONLY valid JSON. No markdown fences.',
        messages: [{ role: 'user', content: options.userPrompt }],
      });
      const block = response.content.find((c) => c.type === 'text');
      if (!block || block.type !== 'text') throw new Error('Text model returned an empty response');
      return block.text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      rethrowIfCreditError(err, 'claude', 'caption');
      if (/anthropic-workspace-id is required/i.test(msg)) {
        throw new Error(
          'Your text-model API key needs a workspace ID. Add it in Settings → Integrations, then Save.',
        );
      }
      throw err;
    }
  }

  /** Free-form JSON for newsletter slots / chatbot (no GeneratedPost schema). */
  async generateRawJson(options: LLMGenerateOptions): Promise<Record<string, unknown>> {
    const maxRetries = options.maxRetries ?? 3;
    let lastError: Error | null = null;
    const tool = this.providers.llmProvider === 'claude' ? 'claude' : 'openai';
    const job = options.job || 'caption';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const raw =
          this.providers.llmProvider === 'claude'
            ? await this.generateWithClaude(options)
            : await this.generateWithOpenAI(options);
        const parsed = parseJsonObjectLenient(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Expected a JSON object');
        }
        return parsed as Record<string, unknown>;
      } catch (error) {
        rethrowIfCreditError(error, tool, job);
        lastError = error instanceof Error ? error : new Error(String(error));
        if (/API key not configured|workspace ID/i.test(lastError.message)) throw lastError;
        if (attempt < maxRetries) await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    rethrowIfCreditError(lastError, tool, job);
    throw new Error(
      `LLM JSON generation failed after ${maxRetries} attempts: ${lastError?.message ?? 'unknown'}`,
    );
  }

  private enforceCharacterLimits(post: GeneratedPost): void {
    const violations: string[] = [];
    if (post.headline.length > CHARACTER_LIMITS.headline) {
      violations.push(`headline: ${post.headline.length}/${CHARACTER_LIMITS.headline} chars`);
    }
    if (post.body.length > CHARACTER_LIMITS.body) {
      violations.push(`body: ${post.body.length}/${CHARACTER_LIMITS.body} chars`);
    }
    if (post.callToAction && post.callToAction.length > CHARACTER_LIMITS.callToAction) {
      violations.push(`callToAction: ${post.callToAction.length}/${CHARACTER_LIMITS.callToAction} chars`);
    }
    if (post.hashtags.length > CHARACTER_LIMITS.maxHashtags) {
      violations.push(`hashtags: ${post.hashtags.length}/${CHARACTER_LIMITS.maxHashtags} count`);
    }
    if (violations.length > 0) {
      throw new Error(`Character limit violations: ${violations.join(', ')}`);
    }
  }
}

export function buildSystemPrompt(brandSettings: {
  companyName?: string;
  productName?: string;
  productTagline?: string;
  industry?: string;
  brandType?: string;
  brandVoice: string;
  imageStyle: string;
  hashtagStrategy: string;
  contentGuidelines: string;
  targetAudience: string;
  targetCountries?: string[] | null;
}): string {
  const audienceMode =
    brandSettings.brandType === 'b2c'
      ? 'Audience mode: B2C (consumers / end users). Write like a cool consumer brand — punchy, scroll-stopping, human, Instagram-native. Avoid corporate jargon.'
      : 'Audience mode: B2B (business buyers, operators, decision-makers). Write like a thoughtful LinkedIn brand — clear, credible, specific.';
  return `You are a social media content generator for a configurable SaaS content engine.
Generate content based ONLY on the source material and brand profile provided.
Do NOT invent company or product names that are not in the brand profile.

COMPANY / PRODUCT PROFILE (user-configured — never hardcode elsewhere):
- ${audienceMode}
- Company: ${brandSettings.companyName || 'Not configured'}
- Product: ${brandSettings.productName || 'Not configured'}
- Tagline: ${brandSettings.productTagline || 'Not configured'}
- Industry / sector: ${brandSettings.industry || 'Not configured'}
- Brand Voice / tone: ${brandSettings.brandVoice || 'Neutral professional'}
- Target Audience: ${brandSettings.targetAudience || 'General audience'}
- ${marketGuidanceForPrompt(brandSettings.targetCountries)}
- Brand / content guidelines: ${brandSettings.contentGuidelines || 'None specified'}
- Hashtag Strategy: ${brandSettings.hashtagStrategy || 'Relevant industry hashtags'}
- Image Style: ${brandSettings.imageStyle || 'Clean, professional'}

STRICT CHARACTER LIMITS (characters, not words) — apply to caption fields only:
- headline: max ${CHARACTER_LIMITS.headline}
- body: max ${CHARACTER_LIMITS.body}
- callToAction: max ${CHARACTER_LIMITS.callToAction}
- hashtags: max ${CHARACTER_LIMITS.maxHashtags}
- imagePrompt: NO short limit — write a long, highly detailed art-direction brief (up to ~${CHARACTER_LIMITS.imagePrompt} chars is fine)

Hashtag rules:
- Return hashtags as an array of plain words WITHOUT the # character (e.g. ["APIEconomy", "Integration"]).
- Prefer 4–8 relevant tags; avoid stuffing.

imagePrompt rules (${
    brandSettings.brandType === 'b2c'
      ? 'Instagram / TikTok-ready B2C feed tile'
      : 'LinkedIn/Instagram B2B social tile'
  }):
- Write a DETAILED photography brief the image model can follow almost literally — not a one-liner.
- Include: subject & action, setting/location, time of day, lighting (direction + quality), camera (lens/angle/DOF), materials/textures, color grade / palette, composition & framing, mood, and clear negative space for a corner logo if needed.
- Match THIS headline/body exactly (same topic, metaphor, and energy).
${
  brandSettings.brandType === 'b2c'
    ? `- Bold, scroll-stopping, high contrast, warm or cinematic light.
- Feel modern and cool (Glossier / Aesop / Nike energy), not corporate stock.`
    : `- Premium B2B editorial look: clear subject, calm composition, restrained palette.
- Avoid generic sci-fi tropes (cyborg faces, neon cyberpunk cities, glowing brain jars) unless the topic explicitly requires them.`
}
- Never invent logos, watermarks, UI chrome, or readable text in the art.
- Prefer 4–10 rich sentences over a short caption-style prompt.

If headline/body/CTA exceed limits, COMPRESS MEANING — do not truncate mid-thought.
Example: "Revolutionary breakthrough in sustainable energy storage technology" (62)
→ "Breakthrough in sustainable energy storage" (42)

Respond ONLY with valid JSON:
{
  "headline": "string",
  "body": "string",
  "hashtags": ["string"],
  "callToAction": "string (optional)",
  "imagePrompt": "string — long detailed art direction (optional)",
  "sourceAttribution": "string (optional)"
}`;
}
