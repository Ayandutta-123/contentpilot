import { ContentEngine, ExecutionStatus } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { LLMService, buildSystemPrompt } from '../services/llm.service';
import { executionLogService } from '../services/execution-log.service';
import { assertGenerationActive } from '../services/generation-abort.service';
import { clampSlideCount } from '../lib/carousel-parse';
import { generateCarouselSlides } from '../services/carousel-generate.service';

export type CarouselGenerateOpts = {
  /** Main topic / campaign title */
  topic: string;
  /** Longer brief / notes for slide storytelling */
  brief?: string;
  /** Explicit slide count (2–10). Defaults to 3. */
  slideCount?: number;
  platforms?: Array<'instagram' | 'linkedin' | 'facebook' | 'twitter'>;
  visualStyleId?: string | null;
  /** Optional CTA hint for the last slide / caption */
  callToActionHint?: string;
  hashtags?: string[];
  /** Optional per-slide exact hero image URLs (uploads). */
  heroImageUrls?: Array<string | null | undefined>;
};

function imagePromptInstruction(subject: string, brandStyle?: string | null): string {
  return [
    `- imagePrompt: write a LONG, highly detailed photography brief for ONE finished ${brandStyle || 'professional'} full-bleed social background matching ${subject} — subject, setting, lighting, camera, materials, color grade, composition, mood; no logos or readable text.`,
    '  Prefer photoreal editorial photography. Darker mid-tones. No blown-out white hotspot in the centre.',
    '  Name the concrete focal subject, setting, camera angle, lighting, and a three-colour palette that matches the brand kit.',
    '  HARD BANS: no outdoor/rooftop server racks, no holographic wireframe buildings, no text or logos in the art, no stock handshakes.',
    '  Keep the top ~20% and bottom ~20% visually calm and slightly underexposed so a logo + headline + CTA can overlay cleanly.',
  ].join('\n');
}

export class CarouselEngine {
  async generate(tenantId: string, contentId: string, opts: CarouselGenerateOpts): Promise<void> {
    const start = Date.now();
    await assertGenerationActive(contentId);

    const topic = (opts.topic || '').trim();
    if (!topic) throw new Error('Carousel generation requires a topic');

    const slideCount = clampSlideCount(opts.slideCount ?? 3);
    const brandSettings = await prisma.brandSettings.findUnique({ where: { tenantId } });
    const llm = await LLMService.forTenant(tenantId);
    const company = brandSettings?.companyName || 'our brand';
    const briefParts = [
      `Carousel topic: ${topic}`,
      opts.brief?.trim()
        ? `Source materials (parsed from user attachments — treat as ground truth; do not invent facts beyond these):\n${opts.brief.trim()}`
        : '',
      opts.callToActionHint?.trim() ? `Desired CTA: ${opts.callToActionHint.trim()}` : '',
      opts.hashtags?.length ? `Suggested hashtags: ${opts.hashtags.join(', ')}` : '',
    ].filter(Boolean);
    const brief = briefParts.join('\n');

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'carousel:start',
      engine: ContentEngine.CAROUSEL,
      message: `${slideCount}-slide carousel · ${topic} · ${company}`,
    });

    const post = await llm.generatePost({
      systemPrompt: buildSystemPrompt(
        brandSettings ?? {
          brandVoice: '',
          imageStyle: '',
          hashtagStrategy: '',
          contentGuidelines: '',
          targetAudience: '',
        },
      ),
      userPrompt: `Create a professional social media caption for a ${slideCount}-slide Instagram/LinkedIn carousel.

STRICT RULES:
- Write ONLY for company "${company}" using the brand voice, audience, and guidelines from the system prompt.
- One strong feed caption that works across the whole carousel (hook on slide 1, payoff in the caption).
- Stay faithful to the topic and brief; do not invent unrelated campaigns.

${brief}

Requirements:
- Sound like a thoughtful B2B brand post for ${company} — not a generic template.
- Write the body primarily for LinkedIn: professional, 2–4 short paragraphs, clear CTA.
- Headline max ~100 chars. Hashtags: 4–8 tags as plain words WITHOUT # prefixes.
- Instagram will be adapted automatically into a shorter punchier variant.
${imagePromptInstruction(topic, brandSettings?.imageStyle)}`,
    });

    const platforms = (opts.platforms || ['instagram', 'linkedin']) as Array<
      'instagram' | 'linkedin' | 'facebook' | 'twitter'
    >;
    const { buildPlatformCaptionsFromIntent, normalizeHashtags } = await import(
      '../services/platform-captions'
    );
    const hashtags = normalizeHashtags(
      post.hashtags?.length
        ? post.hashtags
        : opts.hashtags?.length
          ? opts.hashtags
          : [],
    );
    const platformCaptions = buildPlatformCaptionsFromIntent(
      {},
      {
        headline: post.headline,
        body: post.body,
        hashtags,
        callToAction: post.callToAction ?? opts.callToActionHint ?? null,
      },
    );

    const sourceReference = [
      'carousel:hub',
      `slides:${slideCount}`,
      `company:${company}`,
      topic,
      opts.brief || '',
    ]
      .filter(Boolean)
      .join('\n');

    await prisma.generatedContent.update({
      where: { id: contentId },
      data: {
        headline: post.headline,
        body: post.body,
        hashtags,
        callToAction: post.callToAction ?? opts.callToActionHint ?? null,
        platformCaptions,
        imagePrompt: post.imagePrompt,
        sourceReference,
        targetPlatforms: platforms,
        status: 'generating',
      },
    });

    const isB2c = String(brandSettings?.brandType || 'b2b').toLowerCase() === 'b2c';
    await generateCarouselSlides({
      tenantId,
      contentId,
      slideCount,
      company,
      brief,
      post: {
        headline: post.headline,
        body: post.body,
        imagePrompt: post.imagePrompt,
        callToAction: post.callToAction ?? opts.callToActionHint,
      },
      brandImageStyle: brandSettings?.imageStyle,
      companyName: brandSettings?.companyName,
      logoUrl: brandSettings?.logoUrl,
      brandType: brandSettings?.brandType,
      playId: isB2c ? 'b2c_carousel' : 'carousel_hub',
      source: 'carousel_hub',
      visualStyleId: opts.visualStyleId,
      engine: ContentEngine.CAROUSEL,
      workflowStep: 'carousel:slides',
      heroImageUrls: opts.heroImageUrls,
      contacts: {
        websiteUrl: brandSettings?.websiteUrl,
        contactEmail: brandSettings?.contactEmail,
        instagramUrl: brandSettings?.instagramUrl,
        facebookUrl: brandSettings?.facebookUrl,
        linkedinUrl: brandSettings?.linkedinUrl,
        twitterUrl: brandSettings?.twitterUrl,
      },
    });

    await prisma.generatedContent.update({
      where: { id: contentId },
      data: { status: 'pending_approval' },
    });

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'carousel:complete',
      engine: ContentEngine.CAROUSEL,
      status: ExecutionStatus.SUCCESS,
      durationMs: Date.now() - start,
      message: `Ready for approval · ${slideCount} slides`,
    });
  }
}
