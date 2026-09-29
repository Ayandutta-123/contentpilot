import { ContentEngine, ExecutionStatus } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import {
  selectNextBrandTemplate,
  selectNextLibraryItem,
  selectNextNewsletterTemplate,
} from '../services/rotation.service';
import { LLMService, buildSystemPrompt } from '../services/llm.service';
import { executionLogService } from '../services/execution-log.service';
import { assertGenerationActive } from '../services/generation-abort.service';
import { applyTemplateSlots, extractSlotsFromTemplate, parseFillZones } from '../services/template-slots';
import { preferOriginalLogoUrl } from '../lib/store-upload';
import type { NewsletterEditionContent } from '../providers/images/social-frame';

export type NewsletterGenerateOpts = {
  useBrandTemplate?: boolean;
  brandTemplateId?: string;
  /** Rotate among these brand templates when no fixed id (automation) */
  brandTemplateIds?: string[];
  newsletterTemplateId?: string;
  libraryItemId?: string;
  libraryItemIds?: string[];
  /** Free-text operator instructions for this run (followed exactly) */
  generationRules?: string;
  /** Per dynamic text slot fill style chosen on the Newsletter page */
  slotFillStyles?: Record<string, 'professional' | 'headline' | 'bullets' | 'paragraph' | 'keep'>;
  /** Skip newsletter format rotation — document + operator prompt only */
  freeform?: boolean;
  /** When no brand template: composite company logo onto AI image */
  includeLogo?: boolean;
  visualMode?: 'existing_template' | 'ai' | 'ai_baked_layout';
  platforms?: Array<'instagram' | 'linkedin' | 'facebook' | 'twitter'>;
  requireApproval?: boolean;
};

/** Combinatorial newsletter styles — same product facts, different framing each run. */
const NEWSLETTER_STYLE_ANGLES = [
  'feature spotlight',
  'customer problem → solution',
  "what's new this edition",
  'how it works (step-by-step)',
  'ROI / business outcome',
  'technical deep-dive (still plain language)',
  'before vs after',
  'use-case story',
  'objection handling / FAQ',
  'competitive differentiation (no invented competitor claims)',
  'quick wins checklist',
  'executive brief',
  'operator / practitioner tips',
  'risks avoided',
  'integration & workflow fit',
  'seasonal / timely angle',
] as const;

const NEWSLETTER_STYLE_TONES = [
  'crisp B2B professional',
  'warm and conversational',
  'confident and decisive',
  'curious and educational',
  'urgent but not hypey',
  'calm and authoritative',
  'story-led',
  'data-led (only numbers present in the source document)',
] as const;

const NEWSLETTER_STYLE_OPENINGS = [
  'open with a concrete pain from the document',
  'open with a surprising product capability from the document',
  'open with a short scene of the customer using the product',
  'open with a clear promise tied to a documented benefit',
  'open with a myth-bust based only on document facts',
  'open with a numbered agenda for this edition',
] as const;

const NEWSLETTER_STYLE_CTAS = [
  'soft invite to book a walkthrough',
  'invite to try the next step described in the document',
  'invite to reply with a question',
  'invite to share with a teammate who owns this problem',
  'invite to download / read the related resource if mentioned in the document',
  'invite to compare their current process to the documented approach',
] as const;

export type NewsletterStyleVariation = {
  index: number;
  angle: string;
  tone: string;
  opening: string;
  ctaStyle: string;
  label: string;
};

export function newsletterStyleVariationAt(index: number): NewsletterStyleVariation {
  const i = Math.max(0, Math.floor(index));
  const angle = NEWSLETTER_STYLE_ANGLES[i % NEWSLETTER_STYLE_ANGLES.length]!;
  const tone = NEWSLETTER_STYLE_TONES[Math.floor(i / NEWSLETTER_STYLE_ANGLES.length) % NEWSLETTER_STYLE_TONES.length]!;
  const opening =
    NEWSLETTER_STYLE_OPENINGS[
      Math.floor(i / (NEWSLETTER_STYLE_ANGLES.length * NEWSLETTER_STYLE_TONES.length)) %
        NEWSLETTER_STYLE_OPENINGS.length
    ]!;
  const ctaStyle =
    NEWSLETTER_STYLE_CTAS[
      Math.floor(
        i /
          (NEWSLETTER_STYLE_ANGLES.length *
            NEWSLETTER_STYLE_TONES.length *
            NEWSLETTER_STYLE_OPENINGS.length),
      ) % NEWSLETTER_STYLE_CTAS.length
    ]!;
  return {
    index: i,
    angle,
    tone,
    opening,
    ctaStyle,
    label: `#${i + 1}: ${angle} · ${tone}`,
  };
}

/** Total unique style combos from the four axes above. */
export const NEWSLETTER_STYLE_VARIATION_COUNT =
  NEWSLETTER_STYLE_ANGLES.length *
  NEWSLETTER_STYLE_TONES.length *
  NEWSLETTER_STYLE_OPENINGS.length *
  NEWSLETTER_STYLE_CTAS.length;

async function pickNewsletterStyleVariation(
  tenantId: string,
  libraryItemId: string | null,
): Promise<NewsletterStyleVariation> {
  const prior = await prisma.generatedContent.count({
    where: {
      tenantId,
      engine: ContentEngine.NEWSLETTER,
      ...(libraryItemId ? { libraryItemId } : {}),
    },
  });
  return newsletterStyleVariationAt(prior % NEWSLETTER_STYLE_VARIATION_COUNT);
}

function styleVariationPromptBlock(style: NewsletterStyleVariation): string {
  return `NEWSLETTER STYLE VARIATION ${style.label} (must feel different from prior editions; facts still ONLY from the source document):
- Editorial angle: ${style.angle}
- Tone: ${style.tone}
- Opening approach: ${style.opening}
- CTA style: ${style.ctaStyle}
Do NOT invent features, metrics, customers, or claims absent from the source document. Vary structure, emphasis, and wording — not the product truth.`;
}

function asString(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  return String(v).trim();
}

function asPeekItems(raw: unknown): Array<{ title: string; text: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const title = asString(row.title);
      const text = asString(row.text || row.body || row.description);
      if (!title || !text) return null;
      return { title, text };
    })
    .filter((x): x is { title: string; text: string } => Boolean(x))
    .slice(0, 4);
}

/**
 * Product Newsletter — content strictly from uploaded product/tech documents when present.
 * Visual: Placid/Brand Studio dynamic layers OR a multi-section editorial newsletter page.
 */
export class NewsletterEngine {
  async generate(tenantId: string, contentId: string, opts: NewsletterGenerateOpts = {}): Promise<void> {
    const start = Date.now();
    await assertGenerationActive(contentId);
    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'newsletter:select',
      engine: ContentEngine.NEWSLETTER,
    });

    const brandSettings = await prisma.brandSettings.findUnique({ where: { tenantId } });
    const llm = await LLMService.forTenant(tenantId);

    let libraryItem =
      opts.libraryItemId
        ? await prisma.contentLibraryItem.findFirst({
            where: { id: opts.libraryItemId, tenantId, deletedAt: null, isActive: true },
          })
        : null;
    if (!libraryItem) {
      libraryItem = await selectNextLibraryItem(tenantId, opts.libraryItemIds);
    }

    let formatTemplate =
      opts.newsletterTemplateId
        ? await prisma.newsletterTemplate.findFirst({
            where: { id: opts.newsletterTemplateId, tenantId, deletedAt: null, isActive: true },
          })
        : null;
    if (!formatTemplate && !opts.freeform) {
      formatTemplate = await selectNextNewsletterTemplate(tenantId);
    }

    if (!libraryItem && !formatTemplate) {
      throw new Error(
        'Add a product/tech document on the Newsletter page (or enable a format in Settings for auto mode).',
      );
    }

    const docText = (libraryItem?.extractedText || '').trim();
    if (libraryItem && !docText) {
      throw new Error(
        `Document “${libraryItem.title}” has no extracted text. Re-upload as PDF or TXT.`,
      );
    }

    const styleVariation = await pickNewsletterStyleVariation(tenantId, libraryItem?.id ?? null);
    const styleBlock = styleVariationPromptBlock(styleVariation);

    const operatorInstructions = (opts.generationRules || '').trim();
    const rules = [
      operatorInstructions
        ? `OPERATOR INSTRUCTIONS (follow EXACTLY — override defaults when they conflict):\n${operatorInstructions}`
        : '',
      !opts.freeform ? libraryItem?.generationRules?.trim() : '',
      !opts.freeform ? formatTemplate?.generationRules?.trim() : '',
      !opts.freeform ? formatTemplate?.productContext?.trim() : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const docBlock = libraryItem
      ? `SOURCE DOCUMENT (use ONLY facts from this text — do not invent product claims):\nTitle: ${libraryItem.title}\nCategory: ${libraryItem.category || 'general'}\n---\n${docText.slice(0, 14000)}\n---`
      : 'No document attached — use brand voice and the format template only.';

    const monthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'newsletter:generate',
      engine: ContentEngine.NEWSLETTER,
      message: `Doc=${libraryItem?.title || 'none'} · Format=${formatTemplate?.name || 'editorial page'} · Style=${styleVariation.label}`,
    });

    // Brand / Placid path still uses slot fill when a visual template is selected
    const useBrand = Boolean(opts.useBrandTemplate);
    let brandTemplate =
      useBrand && opts.brandTemplateId
        ? await prisma.brandTemplate.findFirst({
            where: {
              id: opts.brandTemplateId,
              tenantId,
              deletedAt: null,
              isActive: true,
            },
          })
        : null;
    if (useBrand && !brandTemplate) {
      brandTemplate = await selectNextBrandTemplate(tenantId, opts.brandTemplateIds);
    }

    let fillJson: Record<string, unknown> = {};
    if (brandTemplate && formatTemplate) {
      const allowedZones = parseFillZones(formatTemplate.fillZones);
      const discovered = extractSlotsFromTemplate(
        `${formatTemplate.headlineTemplate}\n${formatTemplate.bodyTemplate}`,
      );
      const zones = allowedZones.length
        ? allowedZones.filter(
            (z) => discovered.includes(z) || ['hashtags', 'cta', 'imagePrompt'].includes(z),
          )
        : discovered.length
          ? discovered
          : ['headline', 'body', 'cta', 'hashtags', 'imagePrompt'];

      fillJson = await llm.generateRawJson({
        systemPrompt: `${buildSystemPrompt(
          brandSettings ?? {
            brandVoice: '',
            imageStyle: '',
            hashtagStrategy: '',
            contentGuidelines: '',
            targetAudience: '',
          },
        )}

You fill ONLY newsletter slots for a Placid/Brand Studio visual.
CRITICAL: When a SOURCE DOCUMENT is provided, every factual claim must come from that document.
Return JSON only. hashtags = string array. imagePrompt = photography only (no text/logos).`,
        userPrompt: `${docBlock}

${styleBlock}

GENERATION RULES:
${rules || '(brand voice; concise product newsletter)'}

${
  formatTemplate
    ? `Format: ${formatTemplate.name}
Headline template: ${formatTemplate.headlineTemplate}
Body template: ${formatTemplate.bodyTemplate}`
    : 'No format template — follow the operator instructions and source document only.'
}
Allowed keys: ${JSON.stringify(zones)}`,
      });
    } else {
      fillJson = await llm.generateRawJson({
        systemPrompt: `${buildSystemPrompt(
          brandSettings ?? {
            brandVoice: '',
            imageStyle: '',
            hashtagStrategy: '',
            contentGuidelines: '',
            targetAudience: '',
          },
        )}

You write a REAL multi-section B2B product newsletter page (like a branded email / PDF newsletter), NOT a social media tile and NOT a poster.
CRITICAL: When a SOURCE DOCUMENT is provided, every factual claim must come from that document. Do not invent specs or features.
Each run must apply a distinct editorial STYLE VARIATION while keeping product facts identical to the source document.
LAYOUT: two distinct articles side by side, then a feature column + an "in this edition" agenda. Each article needs its OWN heading. Complete sentences only — never trail off, never use ellipsis, never cut a word mid-way.
Return JSON with EXACTLY these keys:
- headline (string, masthead title, 6–12 words)
- intro (string, 2–3 complete sentences: welcome + what this edition covers)
- sectionTitle (string, left-column article heading, 3–7 words)
- sectionBodyLeft (string, 55–75 words, complete paragraphs for the left article)
- sectionTitleRight (string, right-column article heading, 3–7 words — different topic from the left)
- sectionBodyRight (string, 55–75 words, complete paragraphs for the right article)
- featureTitle (string, deeper-dive heading, 3–7 words)
- featureBody (string, 60–90 words, complete paragraphs)
- sneakPeek (array of exactly 3 objects: { title (3–6 words), text (18–30 words, complete sentence) })
- closing (string, 2 complete sentences, thank-you + how to engage)
- cta (string, 2–5 words)
- hashtags (string array)
- imagePrompt (string) — one editorial photo for the newsletter hero. No readable text, logos, posters, or UI.`,
        userPrompt: `${docBlock}

${styleBlock}

Company: ${brandSettings?.companyName || 'the brand'}
Product: ${brandSettings?.productName || ''}
Edition month: ${monthLabel}

OPERATOR / CHAT INSTRUCTIONS (follow EXACTLY — structure, tone, length, CTA, do/don’t lists):
${rules || '(professional B2B newsletter; clear sections; concrete product value from the document)'}

Write finished newsletter copy: two titled articles + one feature + three agenda items. Every block must end on a complete sentence. Facts must come from the source document; the STYLE VARIATION controls how you shape them.

${
  formatTemplate && !opts.freeform
    ? `Optional format notes from "${formatTemplate.name}": ${formatTemplate.productContext || formatTemplate.generationRules || '(none)'}`
    : 'Build a complete editorial newsletter from the document and the operator instructions above.'
}`,
      });
    }

    const slots: Record<string, string> = {};
    for (const [k, v] of Object.entries(fillJson)) {
      if (k === 'hashtags' || k === 'sneakPeek') continue;
      if (typeof v === 'string') slots[k] = v;
      else if (v != null) slots[k] = String(v);
    }

    const headline = brandTemplate && formatTemplate
      ? applyTemplateSlots(formatTemplate.headlineTemplate, slots)
      : asString(fillJson.headline) || slots.headline || 'Product update';

    const intro = asString(fillJson.intro) || asString(fillJson.body) || '';
    const sectionTitle = asString(fillJson.sectionTitle) || 'This edition';
    const sectionTitleRight = asString(fillJson.sectionTitleRight) || 'Also in this issue';
    const sectionBodyLeft =
      asString(fillJson.sectionBodyLeft) || intro.slice(0, 420) || asString(fillJson.body).slice(0, 420);
    const sectionBodyRight =
      asString(fillJson.sectionBodyRight) || asString(fillJson.body).slice(420, 840) || sectionBodyLeft;
    const featureTitle = asString(fillJson.featureTitle) || 'Product spotlight';
    const featureBody = asString(fillJson.featureBody) || intro || asString(fillJson.body);
    const sneakPeek = asPeekItems(fillJson.sneakPeek);
    const closing =
      asString(fillJson.closing) ||
      'Thank you for reading. Reach out if you want a walkthrough tailored to your sites.';
    const cta = asString(fillJson.cta) || 'Learn more';

    const body = brandTemplate && formatTemplate
      ? applyTemplateSlots(formatTemplate.bodyTemplate, slots)
      : [
          intro,
          `${sectionTitle}: ${sectionBodyLeft}`,
          `${sectionTitleRight}: ${sectionBodyRight}`,
          `${featureTitle}: ${featureBody}`,
          sneakPeek.map((p) => `${p.title}: ${p.text}`).join('\n'),
          closing,
        ]
          .filter(Boolean)
          .join('\n\n');

    let hashtags: string[] = [];
    if (Array.isArray(fillJson.hashtags)) {
      hashtags = fillJson.hashtags.map(String);
    } else if (typeof fillJson.hashtags === 'string') {
      hashtags = fillJson.hashtags.split(/[\s,]+/).filter(Boolean);
    }

    const imagePrompt =
      typeof fillJson.imagePrompt === 'string'
        ? `Editorial newsletter photo only (no text/logos/layout): ${fillJson.imagePrompt}`
        : `Editorial newsletter photo of the product theme for: ${headline}. Photorealistic, no text or logos.`;

    let templateSlots: Record<string, string> = {};

    let imageUrl: string | null = null;
    await assertGenerationActive(contentId);

    if (brandTemplate) {
      await executionLogService.log({
        tenantId,
        contentId,
        workflowStep: 'newsletter:brand_template',
        engine: ContentEngine.NEWSLETTER,
        message: `Fill DYNAMIC layers only on ${brandTemplate.provider} template ${brandTemplate.name}. Fixed layers stay as designed.`,
      });

      try {
        const { renderBrandTemplateWithAiArt } = await import('../services/content-template.service');
        const rendered = await renderBrandTemplateWithAiArt({
          tenantId,
          contentId,
          brandTemplateId: brandTemplate.id,
          slots: {},
          imagePrompt,
          prefix: 'newsletter',
          slotFillStyles: opts.slotFillStyles,
          context: {
            topic: libraryItem?.title || formatTemplate?.name || 'newsletter',
            headline,
            body,
            callToAction: cta,
            extra: `${docBlock.slice(0, 2500)}\n\nRules:\n${rules}\n\nWrite COMPLETE professional lines for every dynamic text zone. Do not output one-word stubs. Never rewrite logos, footer contacts, or any layer marked fixed/static.`.slice(0, 4500),
          },
        });
        imageUrl = rendered.imageUrl;
        templateSlots = rendered.slots;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await executionLogService.log({
          tenantId,
          contentId,
          workflowStep: 'newsletter:brand_template_fallback',
          engine: ContentEngine.NEWSLETTER,
          message: msg,
        });
      }
    }

    const { buildPlatformCaptionsFromIntent, normalizeHashtags } = await import(
      '../services/platform-captions'
    );
    const normalizedHashtags = normalizeHashtags(hashtags || []);
    const platformCaptions = buildPlatformCaptionsFromIntent(
      {},
      {
        headline,
        body,
        hashtags: normalizedHashtags,
        callToAction: cta ?? null,
      },
    );

    const edition: NewsletterEditionContent = {
      volumeLabel: `Volume ${String((Date.now() % 12) + 1).padStart(2, '0')}`,
      dateLabel: monthLabel,
      headline,
      intro: intro || body.slice(0, 280),
      sectionTitle,
      sectionTitleRight,
      sectionBodyLeft,
      sectionBodyRight,
      featureTitle,
      featureBody,
      sneakPeek:
        sneakPeek.length > 0
          ? sneakPeek
          : [
              { title: 'Product', text: featureBody.slice(0, 180) || headline },
              { title: 'Why it matters', text: sectionBodyLeft.slice(0, 180) || intro },
              { title: 'How to engage', text: closing || cta },
            ],
      closing,
      cta,
      websiteUrl: brandSettings?.websiteUrl || '',
      contactEmail: '',
      contactPhone: '',
    };

    const sourceBits = [
      libraryItem ? `Doc: ${libraryItem.title}` : null,
      formatTemplate ? `Format: ${formatTemplate.name}` : null,
      brandTemplate ? `Visual: ${brandTemplate.name}` : 'Visual: editorial newsletter page',
    ].filter(Boolean);

    await prisma.generatedContent.update({
      where: { id: contentId },
      data: {
        headline,
        body,
        hashtags: normalizedHashtags,
        callToAction: cta,
        platformCaptions,
        imagePrompt: imagePrompt ?? null,
        sourceReference: sourceBits.join(' · '),
        newsletterTemplateId: formatTemplate?.id ?? null,
        libraryItemId: libraryItem?.id ?? null,
        brandTemplateId: brandTemplate?.id ?? null,
        templateSlots: brandTemplate
          ? templateSlots
          : ({ newsletterEdition: edition } as object),
        ...(imageUrl ? { imageUrl } : {}),
        ...(opts.platforms?.length ? { targetPlatforms: opts.platforms } : {}),
        status: 'generating',
      },
    });

    if (!brandTemplate) {
      const includeLogo = opts.includeLogo !== false;
      if (opts.visualMode === 'ai_baked_layout') {
        const { attachBakedPosterForContent } = await import('../services/baked-poster.service');
        await attachBakedPosterForContent({
          tenantId,
          contentId,
          companyName: brandSettings?.companyName || 'Brand',
          headline,
          body,
          callToAction: cta,
          topic: libraryItem?.title || 'Newsletter',
          visualStyleId: 'professional_photo',
          brandImageStyle: brandSettings?.imageStyle,
          format: 'instagram_portrait',
          playId: 'announcement',
        });
      } else {
        const { attachGeneratedImage } = await import('../services/image-attach.service');
        await attachGeneratedImage(tenantId, contentId, imagePrompt, {
          brandImageStyle: brandSettings?.imageStyle,
          companyName: brandSettings?.companyName,
          logoUrl: includeLogo
            ? preferOriginalLogoUrl(brandSettings?.logoUrl) || brandSettings?.logoUrl || null
            : null,
          creativeType: 'newsletter',
          format: 'instagram_portrait',
          newsletterEdition: edition,
          headerText: headline,
          bodyText: body,
          footerCta: cta,
          contentBrief: `${headline}. ${featureBody.slice(0, 400)}`,
          overlay: { overlaysEnabled: true },
        });
      }
    }

    const { applyGenerationOutcome } = await import('../services/generation-outcome.service');
    const outcome = await applyGenerationOutcome(tenantId, contentId, {
      platforms: opts.platforms,
      requireApproval: opts.requireApproval,
    });

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'newsletter:complete',
      engine: ContentEngine.NEWSLETTER,
      status: ExecutionStatus.SUCCESS,
      durationMs: Date.now() - start,
      message: outcome === 'publishing' ? 'Auto-publishing' : 'Ready for approval',
    });
  }
}
