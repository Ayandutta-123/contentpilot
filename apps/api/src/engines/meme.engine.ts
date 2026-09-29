import { ContentEngine, ExecutionStatus } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { LLMService, buildSystemPrompt } from '../services/llm.service';
import { executionLogService } from '../services/execution-log.service';
import { assertGenerationActive } from '../services/generation-abort.service';
import { selectNextLibraryItem } from '../services/rotation.service';
import { getPlay } from '../services/content-playbook.service';
import { generateRawArtUrl } from '../services/image-attach.service';
import { preferOriginalLogoUrl } from '../lib/store-upload';
import {
  memeSocialFrame,
  type MemePanelCaption,
} from '../providers/images/social-frame';
import {
  planTrendingBrandMeme,
  type MemeFormat,
} from '../services/meme-trend.service';
import {
  defaultBrandCanvas,
  renderBrandCanvasSvg,
  saveRenderedSvg,
  type BrandCanvas,
} from '../providers/templates/brand-renderer';

export type MemeGenerateOpts = {
  useBrandTemplate?: boolean;
  brandTemplateId?: string;
  brandTemplateIds?: string[];
  libraryItemId?: string;
  libraryItemIds?: string[];
  generationRules?: string;
  includeLogo?: boolean;
  visualMode?: 'existing_template' | 'ai' | 'ai_baked_layout';
  platforms?: Array<'instagram' | 'linkedin' | 'facebook' | 'twitter'>;
  requireApproval?: boolean;
  /** Pre-selected Memes-tab scrape hits */
  selectedSignals?: Array<{
    title: string;
    url?: string;
    snippet?: string;
    imageUrl?: string;
    postText?: string;
  }>;
  preferredFormatId?: string;
  /** Visual meme the user picked — style + structure lock */
  referenceImageUrl?: string | null;
  /**
   * Where the joke's facts come from:
   * product = uploaded product document, brand = website/brand context saved in
   * Settings → Company, both = document plus brand context. Defaults to `both`.
   */
  contentSource?: 'product' | 'brand' | 'both';
};

function layoutForFormat(format: MemeFormat): 'split_v' | 'split_h' | 'impact' | 'stacked' {
  switch (format.id) {
    case 'expectation_vs_reality':
    case 'waiting':
    case 'distracted_choice':
    case 'trade_offer':
      return 'split_v';
    case 'reject_approve':
    case 'this_is_fine':
    case 'one_does_not_simply':
      return 'split_h';
    case 'expanding_brain':
      return 'stacked';
    default:
      return 'impact';
  }
}

async function cacheRemoteMemeRef(
  tenantId: string,
  remoteUrl: string,
): Promise<string> {
  const res = await fetch(remoteUrl, {
    headers: { 'User-Agent': 'ContentPilotMemeBot/1.0' },
  });
  if (!res.ok) throw new Error(`Could not download meme reference (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const fs = await import('fs');
  const path = await import('path');
  const { config } = await import('../config');
  const dir = path.resolve(config.UPLOAD_DIR, tenantId, 'meme-refs');
  fs.mkdirSync(dir, { recursive: true });
  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  const ext = ctype.includes('png')
    ? 'png'
    : ctype.includes('webp')
      ? 'webp'
      : ctype.includes('gif')
        ? 'gif'
        : 'jpg';
  const filename = `ref-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), buf);
  return `/uploads/${tenantId}/meme-refs/${filename}`;
}

/**
 * Trending meme FORMAT → brand blend → meme-native visual.
 * Discovers what’s culturally hot, maps onto safe archetypes (never scrapes copyrighted JPEG templates).
 */
export class MemeEngine {
  async generate(tenantId: string, contentId: string, opts: MemeGenerateOpts = {}): Promise<void> {
    const start = Date.now();
    await assertGenerationActive(contentId);

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'meme:select',
      engine: ContentEngine.MEME,
    });

    const brandSettings = await prisma.brandSettings.findUnique({ where: { tenantId } });
    const llm = await LLMService.forTenant(tenantId);
    const play = getPlay('meme')!;
    const company = brandSettings?.companyName || 'our brand';

    const contentSource = opts.contentSource || 'both';

    // brand-only runs intentionally skip product docs (no rotation fallback)
    let libraryItem =
      contentSource === 'brand'
        ? null
        : opts.libraryItemId
          ? await prisma.contentLibraryItem.findFirst({
              where: { id: opts.libraryItemId, tenantId, deletedAt: null, isActive: true },
            })
          : null;
    if (!libraryItem && contentSource !== 'brand') {
      libraryItem = await selectNextLibraryItem(tenantId, opts.libraryItemIds);
    }
    if (contentSource === 'product' && opts.libraryItemId && !libraryItem) {
      throw new Error('The selected product document is missing or inactive.');
    }

    const useBrand = Boolean(opts.useBrandTemplate && opts.brandTemplateId);
    const brandTemplate = useBrand
      ? await prisma.brandTemplate.findFirst({
          where: {
            id: opts.brandTemplateId!,
            tenantId,
            deletedAt: null,
            isActive: true,
          },
        })
      : null;

    const brandContextText = [
      brandSettings?.contentGuidelines || '',
      brandSettings?.targetAudience || '',
      brandSettings?.brandVoice || '',
      brandSettings?.websiteUrl ? `Website: ${brandSettings.websiteUrl}` : '',
      brandSettings?.productName ? `Product: ${brandSettings.productName}` : '',
      brandSettings?.productTagline ? `Tagline: ${brandSettings.productTagline}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const sourceText = [
      contentSource === 'product'
        ? `PRIMARY SOURCE — base the joke on this product document only.`
        : contentSource === 'brand'
          ? `PRIMARY SOURCE — base the joke on the brand/website context below.`
          : '',
      libraryItem?.extractedText?.slice(0, 6000) || '',
      libraryItem?.title ? `Document: ${libraryItem.title}` : '',
      opts.generationRules?.trim() || '',
      brandContextText,
      brandSettings?.companyName ? `Company: ${brandSettings.companyName}` : '',
      brandSettings?.industry ? `Industry: ${brandSettings.industry}` : '',
      Array.isArray(brandSettings?.targetCountries) && brandSettings.targetCountries.length
        ? `Markets: ${brandSettings.targetCountries.join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    if (!sourceText.trim()) {
      throw new Error(
        'Meme automation needs brand guidelines (Settings → Company) or a product document to stay on-brand.',
      );
    }
    if (contentSource === 'brand' && !brandContextText.trim()) {
      throw new Error(
        'No website/brand context saved yet. Run Settings → Company → scrape your website, or pick a product document instead.',
      );
    }

    // ── 1) Discover market meme trends → pick format archetype ─────────────
    await assertGenerationActive(contentId);
    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'meme:trend_discover',
      engine: ContentEngine.MEME,
      message: opts.referenceImageUrl
        ? 'Locking to selected meme visual + structure'
        : 'Searching trending meme formats in market',
    });

    let styleBrief = '';
    let structureBrief: {
      layout: 'split_v' | 'split_h' | 'impact' | 'stacked';
      panelCount: number;
      captionStyle: string;
      structureNotes: string;
      visualRecipe: string;
      suggestedFormatId?: string;
    } | null = null;
    let localRefUrl: string | null = null;

    const primarySignal = opts.selectedSignals?.[0];
    const refRemote =
      opts.referenceImageUrl?.trim() ||
      primarySignal?.imageUrl?.trim() ||
      '';

    if (refRemote) {
      try {
        localRefUrl = refRemote.startsWith('/uploads/')
          ? refRemote
          : await cacheRemoteMemeRef(tenantId, refRemote);
        const {
          describeBrandReferenceStyle,
          describeMemeReferenceStructure,
        } = await import('../services/reference-style.service');
        const [style, structure] = await Promise.all([
          describeBrandReferenceStyle(tenantId, localRefUrl).catch(() => ''),
          describeMemeReferenceStructure(tenantId, localRefUrl).catch(() => null),
        ]);
        styleBrief = style;
        structureBrief = structure;
        await executionLogService.log({
          tenantId,
          contentId,
          workflowStep: 'meme:vision_lock',
          engine: ContentEngine.MEME,
          message: structureBrief
            ? `layout=${structureBrief.layout} · ${structureBrief.captionStyle.slice(0, 80)}`
            : 'style brief only',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await executionLogService.log({
          tenantId,
          contentId,
          workflowStep: 'meme:vision_lock_skip',
          engine: ContentEngine.MEME,
          message: msg.slice(0, 200),
        });
      }
    }

    const preferredFromVision =
      structureBrief?.suggestedFormatId &&
      structureBrief.suggestedFormatId !== 'other'
        ? structureBrief.suggestedFormatId
        : undefined;

    const plan = await planTrendingBrandMeme({
      tenantId,
      brandContext: sourceText.slice(0, 4000),
      selectedSignals: opts.selectedSignals,
      preferredFormatId: opts.preferredFormatId || preferredFromVision,
      llmPick: async ({ formats, trends, brandContext, countries }) => {
        const picked = await llm.generateRawJson({
          systemPrompt: `You map culturally hot meme TRENDS onto safe FORMAT ARCHETYPES for brand marketing.
Markets in focus: ${countries}.
${structureBrief ? `User selected a visual meme — prefer format matching its structure: ${structureBrief.structureNotes} (layout ${structureBrief.layout}).` : ''}
Never recommend downloading or copying copyrighted meme JPEGs or celebrity faces.
Pick the ONE format id from the catalog that best matches current market energy AND fits this brand.
Return JSON ONLY.`,
          userPrompt: `Brand context:
${brandContext.slice(0, 3500)}

Markets: ${countries}
${primarySignal ? `\nSelected meme title/caption: ${primarySignal.postText || primarySignal.title}\n${primarySignal.snippet || ''}` : ''}

Trending signals (titles/snippets from the web — use as cultural cues, not as assets to copy):
${
  trends.length
    ? trends
        .map((t, i) => `${i + 1}. ${t.title}${t.snippet ? ` — ${t.snippet.slice(0, 120)}` : ''}`)
        .join('\n')
    : '(No live search results — pick the highest-engagement format that fits this brand pain.)'
}

Safe format catalog:
${formats.map((f) => `- ${f.id}: ${f.label} | ${f.structure} | useWhen: ${f.useWhen}`).join('\n')}

Return:
{
  "formatId": "one_id_from_catalog",
  "trendHook": "1 short line: what is hot / why this format fits the moment",
  "whyThisFormat": "1 short line: why this format for THIS brand"
}`,
        });
        return {
          formatId: String(picked.formatId || ''),
          trendHook: String(picked.trendHook || ''),
          whyThisFormat: String(picked.whyThisFormat || ''),
        };
      },
    });

    const format = plan.format;
    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'meme:format_picked',
      engine: ContentEngine.MEME,
      message: `${format.label} · ${plan.trendHook.slice(0, 120)}`,
    });

    // ── 2) Brand-blend copy into that exact format ──────────────────────────
    await assertGenerationActive(contentId);
    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'meme:generate',
      engine: ContentEngine.MEME,
      message: libraryItem?.title || format.label,
    });

    const intent = await llm.generateRawJson({
      systemPrompt: `${buildSystemPrompt(
        brandSettings ?? {
          brandVoice: '',
          imageStyle: '',
          hashtagStrategy: '',
          contentGuidelines: '',
          targetAudience: '',
        },
      )}

You create ONE brand meme for ${company} using this EXACT market format:
Format: ${format.label} (${format.id})
Structure: ${format.structure}
Panels: ${format.panels.join(' / ')}
Trend hook: ${plan.trendHook}
Why: ${plan.whyThisFormat}
Visual recipe (art only): ${structureBrief?.visualRecipe || format.imageRecipe}
${structureBrief ? `SELECTED MEME STRUCTURE LOCK: ${structureBrief.structureNotes}. Caption style: ${structureBrief.captionStyle}. Layout: ${structureBrief.layout}. Match this joke pacing in your panels.` : ''}
${primarySignal ? `Selected meme cue: ${primarySignal.postText || primarySignal.title}` : ''}
Copy recipe: ${play.copyRecipe}

HARD RULES:
- Fit the joke INTO this format's panels — mirror the selected meme's content structure (setup/punchline rhythm), with brand-safe copy.
- Ground in brand voice + source — do not invent features, discounts, or stats.
- Witty, shareable, on-brand; never punch down.
- Panel text must be SHORT (meme captions, not LinkedIn paragraphs).
- Return JSON ONLY.`,
      userPrompt: `Source / brand context:
${sourceText.slice(0, 8000)}

Return:
{
  "panels": [
    { "label": "${format.panels[0] || 'A'}", "text": "short meme caption for panel 1" },
    { "label": "${format.panels[1] || 'B'}", "text": "short meme caption for panel 2" }
  ],
  "setup": "feed-facing setup line",
  "punchline": "feed-facing punchline",
  "headline": "short social title",
  "body": "platform caption that explains the joke lightly + soft CTA",
  "hashtags": ["Tag1", "Tag2", "Tag3"],
  "callToAction": "optional soft CTA",
  "imagePrompt": "ORIGINAL meme comic art matching format recipe — describe scenes only, NO text, NO logos, NO celebrities"
}`,
    });

    const { buildPlatformCaptionsFromIntent, normalizeHashtags } = await import(
      '../services/platform-captions'
    );

    const panelsRaw = Array.isArray(intent.panels) ? intent.panels : [];
    const panels: MemePanelCaption[] = panelsRaw
      .map((p: unknown, i: number) => {
        const row = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
        return {
          label: String(row.label || format.panels[i] || `Panel ${i + 1}`).slice(0, 40),
          text: String(row.text || '').trim().slice(0, 90),
        };
      })
      .filter((p) => p.text);

    if (panels.length < 2) {
      panels.push(
        { label: format.panels[0] || 'Setup', text: String(intent.setup || 'The old way').slice(0, 90) },
        {
          label: format.panels[1] || 'Punchline',
          text: String(intent.punchline || company).slice(0, 90),
        },
      );
    }

    const headline = String(intent.headline || intent.setup || `${format.label} — ${company}`);
    const body = String(
      intent.body ||
        [intent.setup, intent.punchline, `Format: ${format.label}`].filter(Boolean).join('\n\n') ||
        '',
    );
    const hashtags = normalizeHashtags(
      Array.isArray(intent.hashtags)
        ? intent.hashtags
        : typeof intent.hashtags === 'string'
          ? intent.hashtags
          : [],
    );
    const cta = typeof intent.callToAction === 'string' ? intent.callToAction : undefined;
    const platformCaptions = buildPlatformCaptionsFromIntent(intent as Record<string, unknown>, {
      headline,
      body,
      hashtags,
      callToAction: cta ?? null,
    });

    let slots: Record<string, string> = {
      headline: panels[0]?.text || String(intent.setup || headline),
      body: panels[1]?.text || String(intent.punchline || body.slice(0, 200)),
      subtext: cta || '',
    };

    const imagePrompt = [
      structureBrief?.visualRecipe || format.imageRecipe,
      styleBrief ? `STYLE LOCK from selected meme: ${styleBrief}` : '',
      typeof intent.imagePrompt === 'string' ? intent.imagePrompt.trim() : '',
      `Brand metaphor for ${company}. Panel labels (do not paint as text): ${panels.map((p) => p.label).join(' / ')}.`,
      'Recreate the SAME layout energy as the selected meme with ORIGINAL art — anonymous silhouettes only.',
      'ZERO readable text, logos, watermarks, or celebrity faces in the artwork.',
    ]
      .filter(Boolean)
      .join(' ');

    const sourceReference = [
      `Trending meme format: ${format.label}`,
      `Markets: ${plan.countryLabels}`,
      plan.trendHook ? `Hook: ${plan.trendHook}` : '',
      libraryItem?.title ? `Doc: ${libraryItem.title}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    // ── 3) Render meme-native visual (not professional photo) ───────────────
    let imageUrl: string | null = null;
    let rawImageUrl: string | null = null;

    // Reference lock is resolved ONCE so every creative mode (brand template,
    // AI painter, AI photo) reproduces the selected meme's layout — previously
    // only the AI-photo branch honoured it.
    let artPrompt = imagePrompt;
    let refForModel: string | null = null;
    if (localRefUrl) {
      try {
        const {
          buildReferenceLockedImagePrompt,
          resolveReferencePublicUrl,
          resolveReferenceDataUri,
        } = await import('../services/reference-style.service');
        artPrompt = buildReferenceLockedImagePrompt({
          chatSubject: `${format.label}: ${panels.map((p) => p.text).join(' / ')}. ${structureBrief?.visualRecipe || format.imageRecipe}`,
          styleBrief:
            styleBrief ||
            'Match the selected meme’s layout, panel split, color energy, and comic finish.',
          companyName: company,
          brandImageStyle: null,
        });
        const publicUrl = resolveReferencePublicUrl(localRefUrl);
        if (/localhost|127\.0\.0\.1/.test(publicUrl)) {
          refForModel = await resolveReferenceDataUri(localRefUrl);
        } else {
          refForModel = publicUrl;
        }
      } catch {
        artPrompt = imagePrompt;
        refForModel = null;
      }
    }

    await assertGenerationActive(contentId);
    if (brandTemplate) {
      await executionLogService.log({
        tenantId,
        contentId,
        workflowStep: 'meme:brand_template',
        engine: ContentEngine.MEME,
        message: `${brandTemplate.name}${localRefUrl ? ' · reference-locked art' : ''}`,
      });
      try {
        const { renderBrandTemplateWithAiArt } = await import('../services/content-template.service');
        const rendered = await renderBrandTemplateWithAiArt({
          tenantId,
          contentId,
          brandTemplateId: brandTemplate.id,
          slots,
          imagePrompt: artPrompt,
          prefix: 'meme',
          referenceImageUrl: refForModel,
        });
        imageUrl = rendered.imageUrl;
        slots = rendered.slots;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await executionLogService.log({
          tenantId,
          contentId,
          workflowStep: 'meme:brand_template_fallback',
          engine: ContentEngine.MEME,
          message: msg,
        });
        const canvas = (
          brandTemplate.canvas && typeof brandTemplate.canvas === 'object'
            ? structuredClone(brandTemplate.canvas)
            : defaultBrandCanvas({
                companyName: company,
                backgroundUrl: brandTemplate.backgroundUrl || undefined,
              })
        ) as BrandCanvas;
        if (brandTemplate.backgroundUrl) {
          canvas.background = { type: 'image', value: brandTemplate.backgroundUrl };
        }
        const svg = await renderBrandCanvasSvg(canvas, slots);
        const saved = await saveRenderedSvg(tenantId, svg, 'meme');
        imageUrl = saved.publicUrl;
      }
    } else if (opts.visualMode === 'ai_baked_layout') {
      await executionLogService.log({
        tenantId,
        contentId,
        workflowStep: 'meme:baked_poster',
        engine: ContentEngine.MEME,
        message: localRefUrl
          ? 'AI painted meme poster locked to selected meme layout'
          : 'AI painted meme poster (text in image + real logo stamp)',
      });
      const { attachBakedPosterForContent } = await import('../services/baked-poster.service');
      const baked = await attachBakedPosterForContent({
        tenantId,
        contentId,
        companyName: company,
        headline,
        body,
        callToAction: cta,
        topic: format.label,
        visualStyleId: localRefUrl ? 'custom' : 'meme_comic',
        brandImageStyle: brandSettings?.imageStyle,
        playId: 'meme',
        referenceImageUrl: refForModel,
        referenceStyleBrief: styleBrief || null,
        referenceStructureNotes: structureBrief
          ? `${format.label} · layout ${structureBrief.layout} · panels ${structureBrief.panelCount} · captions ${structureBrief.captionStyle}`
          : null,
      });
      imageUrl = baked?.imageUrl || null;
      rawImageUrl = baked?.imageUrl || null;
    } else {
      await executionLogService.log({
        tenantId,
        contentId,
        workflowStep: 'meme:image',
        engine: ContentEngine.MEME,
        message: localRefUrl ? 'reference-locked meme_comic + caption frame' : 'meme_comic + caption frame',
      });

      rawImageUrl = await generateRawArtUrl(tenantId, contentId, artPrompt, {
        format: 'instagram_square',
        exact: Boolean(styleBrief || localRefUrl),
        visualStyleId: localRefUrl ? 'custom' : 'meme_comic',
        brandImageStyle: null,
        contentBrief: null,
        throwOnError: true,
        referenceImageUrl: refForModel,
      });

      const framed = await memeSocialFrame({
        tenantId,
        imageUrl: rawImageUrl,
        companyName: company,
        logoUrl:
          opts.includeLogo === false
            ? null
            : preferOriginalLogoUrl(brandSettings?.logoUrl) || brandSettings?.logoUrl || null,
        layout: structureBrief?.layout || layoutForFormat(format),
        panels,
        formatLabel: format.label,
      });
      imageUrl = framed.publicUrl;
    }

    const requireApproval = opts.requireApproval !== false;
    await prisma.generatedContent.update({
      where: { id: contentId },
      data: {
        headline,
        body,
        hashtags,
        callToAction: cta ?? null,
        platformCaptions,
        imagePrompt,
        sourceReference,
        libraryItemId: libraryItem?.id ?? null,
        brandTemplateId: brandTemplate?.id ?? null,
        targetPlatforms: opts.platforms?.length ? opts.platforms : [],
        templateSlots: {
          playId: 'meme',
          memeFormatId: format.id,
          memeFormatLabel: format.label,
          trendHook: plan.trendHook,
          whyThisFormat: plan.whyThisFormat,
          markets: plan.countryLabels,
          visualStyleId: localRefUrl ? 'custom' : 'meme_comic',
          referenceImageUrl: localRefUrl || '',
          setup: String(intent.setup || ''),
          punchline: String(intent.punchline || ''),
          panel1: panels[0]?.text || '',
          panel2: panels[1]?.text || '',
          ...slots,
        } as object,
        status: requireApproval ? 'pending_approval' : 'approved',
        ...(imageUrl ? { imageUrl } : {}),
        ...(rawImageUrl ? { rawImageUrl } : {}),
      },
    });

    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'meme:complete',
      engine: ContentEngine.MEME,
      status: ExecutionStatus.SUCCESS,
      durationMs: Date.now() - start,
      message: format.label,
    });
  }
}
