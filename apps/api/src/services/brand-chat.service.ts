import { ContentEngine, ExecutionStatus } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { LLMService, buildSystemPrompt } from '../services/llm.service';
import { executionLogService } from '../services/execution-log.service';
import {
  defaultBrandCanvas,
  renderBrandCanvasSvg,
  renderWithPlacid,
  saveRenderedSvg,
  isLayerDynamic,
  layerFillType,
  getBrandPostPreset,
  resolveSlotLines,
  type BrandCanvas,
  type BrandLayer,
} from '../providers/templates/brand-renderer';
import { generateContentImage } from '../providers/images/fal.provider';
import { resolveProviders } from './providers.service';
import { attachGeneratedImage } from './image-attach.service';
import { preferOriginalLogoUrl } from '../lib/store-upload';
import { PROFESSIONAL_POSTER_GUARDRAILS, insightSocialFrame, type InsightReportContent } from '../providers/images/social-frame';
import {
  getPlay,
  playbookPromptBlock,
  playHasEnoughBrief,
  resolveSuggestions,
  type PlaySuggestion,
} from './content-playbook.service';
import {
  templateCaptionHint,
  templateNeedsStat,
  type PosterTemplate,
} from './poster-template-catalog';
import {
  effectivePosterLayout,
  resolvePosterTemplate,
} from './play-poster-templates.service';

function describeZone(layer: BrandLayer): string {
  const mode = isLayerDynamic(layer) ? 'dynamic' : 'static';
  const ft = layerFillType(layer);
  const parts = [
    `id=${layer.id}`,
    `type=${layer.type}`,
    `mode=${mode}`,
    layer.slot ? `slot=${layer.slot}` : null,
    mode === 'dynamic' ? `fillType=${ft}` : null,
    mode === 'dynamic' && layer.lineCount
      ? `EXACT_LINE_COUNT=${layer.lineCount}`
      : null,
    layer.fillHint ? `hint="${layer.fillHint}"` : null,
    mode === 'dynamic' && (ft === 'json' || layer.jsonSchema) && layer.jsonSchema
      ? `bodyJsonContract=${layer.jsonSchema}`
      : null,
    mode === 'static' && layer.text ? `fixedText="${layer.text}"` : null,
    mode === 'static' && layer.src ? `fixedImage=${layer.src}` : null,
  ].filter(Boolean);
  return `{ ${parts.join(', ')} }`;
}

function lineContractBlock(layers: BrandLayer[]): string {
  const dynamic = layers.filter((l) => isLayerDynamic(l) && l.type === 'text');
  if (!dynamic.length) return '';
  return `
STRICT ON-IMAGE LINE CONTRACT (must obey when action=generate_post + visualMode=existing_template):
${dynamic
  .map((l) => {
    const key = l.slot || l.id;
    const n = l.lineCount;
    const ft = layerFillType(l);
    if (ft === 'json' || l.jsonSchema) {
      return `- slots["${key}"]: return a JSON object matching bodyJsonContract with EXACTLY ${n || '?'} lines. Example shape: {"lines":[{"index":1,"role":"...","value":"..."}, ...]}. Use the "value" fields for the actual text. Do NOT invent extra lines.`;
    }
    if (n && n > 1) {
      return `- slots["${key}"]: EXACTLY ${n} lines separated by \\n (no more, no fewer).`;
    }
    if (n === 1) {
      return `- slots["${key}"]: EXACTLY 1 line (no line breaks).`;
    }
    return `- slots["${key}"]: short string for fillType=${ft}`;
  })
  .join('\n')}
`;
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type VisualMode = 'existing_template' | 'new_poster';

export type BrandChatResult = {
  assistantMessage: string;
  action: 'reply' | 'generate_post' | 'suggest_formats';
  visualMode?: VisualMode | null;
  contentId?: string;
  /** Claude-like format suggestions when action=suggest_formats */
  suggestions?: PlaySuggestion[];
  /** Play id used for this generation */
  playId?: string | null;
  /** Poster template the visual was rendered with, when one was chosen */
  posterTemplateId?: string | null;
  preview?: {
    headline: string;
    body: string;
    hashtags: string[];
    callToAction?: string;
    imageUrl?: string | null;
    captions?: {
      instagram?: { headline: string; body: string; hashtags: string[]; callToAction?: string | null };
      linkedin?: { headline: string; body: string; hashtags: string[]; callToAction?: string | null };
    };
  };
};

function inferVisualModeFromHistory(
  preferred: VisualMode | null | undefined,
  history: ChatMessage[] | undefined,
  message: string,
): VisualMode | null {
  if (preferred === 'existing_template' || preferred === 'new_poster') return preferred;

  const blob = [...(history || []).map((m) => m.content), message].join('\n').toLowerCase();
  if (
    /\b(existing template|brand template|saved template|use template|on (the )?template|fill (the )?zones|cloze)\b/.test(
      blob,
    )
  ) {
    return 'existing_template';
  }
  if (
    /\b(new poster|brand new|from scratch|entirely new|fresh design|ai poster|generate (a )?new (image|poster|visual))\b/.test(
      blob,
    )
  ) {
    return 'new_poster';
  }
  return null;
}

const LINK_CTA_RE = /\b(link in comments|check comments|see comments|link below|swipe up)\b/i;
const EXPLICIT_LINK_RE = /\bhttps?:\/\/\S+|www\.\S+|linktr\.ee\/\S+|bit\.ly\/\S+\b/i;

function sanitizeGeneratedCta(raw: unknown, contextText: string): string | undefined {
  const cta = typeof raw === 'string' ? raw.trim() : '';
  if (!cta) return undefined;
  if (!LINK_CTA_RE.test(cta)) return cta;
  if (EXPLICIT_LINK_RE.test(contextText)) return cta;
  return 'Learn more on our website.';
}

function isWeakImagePrompt(raw: unknown): boolean {
  const p = typeof raw === 'string' ? raw.trim() : '';
  if (!p || p.length < 110) return true;
  if (/^(premium|professional)\s+.*(social|poster)/i.test(p) && p.length < 180) return true;
  if (!/\b(scene|lighting|composition|subject|camera|environment|materials?)\b/i.test(p)) return true;
  return false;
}

function extractAnniversaryYears(text: string): number | null {
  const m = text.match(/\b(\d{1,3})\s*(?:st|nd|rd|th)?\s*(?:year|years)\s*(?:anniversary)?\b/i);
  if (!m) return null;
  const years = Number(m[1]);
  if (!Number.isFinite(years) || years <= 0) return null;
  return years;
}

function buildGroundedPosterPrompt(opts: {
  userMessage: string;
  headline: string;
  body: string;
  company: string;
  brandImageStyle?: string | null;
  visualRecipe?: string | null;
}): string {
  const years = extractAnniversaryYears(opts.userMessage);
  const topicLock = opts.userMessage.trim().replace(/\s+/g, ' ').slice(0, 420);
  const lines = [
    `Topic lock from user request (must be exact): ${topicLock}.`,
    years
      ? `Create a premium ${years}-year anniversary campaign poster for ${opts.company}.`
      : `Create a premium campaign poster for ${opts.company}.`,
    `Headline intent: ${opts.headline}.`,
    opts.body ? `Caption context: ${opts.body.slice(0, 260)}.` : '',
    opts.visualRecipe ? `Creative direction: ${opts.visualRecipe}.` : '',
    opts.brandImageStyle ? `Brand visual style: ${opts.brandImageStyle}.` : '',
    'Use one central hero scene with believable real-world details, cinematic but clean lighting, refined composition, and premium ad-photography finish.',
    'No stock-photo cliches, no fake UI panels, no lorem ipsum, no random unrelated concepts.',
    'Do not draw logos, watermarks, or readable text in the artwork; keep the top-left corner visually calm for logo compositing.',
  ];
  return lines.filter(Boolean).join(' ');
}

/**
 * Multi-turn Brand Studio / AI Assistant.
 * - reply: clarify / brainstorm / ask existing vs new
 * - suggest_formats: Claude-like menu of post variations (countdown, launch, meme…)
 * - generate_post + existing_template: cloze-fill only dynamic zones on saved plate
 * - generate_post + new_poster: caption + full AI poster using Settings brand + logo
 */
export async function runBrandAssistant(opts: {
  tenantId: string;
  brandTemplateId?: string | null;
  message: string;
  history?: ChatMessage[];
  /** Explicit UI choice — preferred over LLM inference */
  visualMode?: VisualMode | null;
  /** Attach Settings logo on new posters (default true) */
  includeLogo?: boolean;
  /** Optional brand reference artwork uploaded in AI Assistant */
  referenceImageUrl?: string | null;
  /** Social canvas size */
  imageFormat?: 'instagram_square' | 'instagram_portrait' | 'linkedin' | 'story';
  /** When user clicks a suggestion card */
  preferredPlay?: string | null;
  /** ContentPilot poster template the user picked for this format (new_poster only) */
  posterTemplateId?: string | null;
}): Promise<BrandChatResult> {
  const brandSettings = await prisma.brandSettings.findUnique({
    where: { tenantId: opts.tenantId },
  });
  const llm = await LLMService.forTenant(opts.tenantId);
  const brandType = (brandSettings as { brandType?: string } | null)?.brandType || 'b2b';
  let selectedPlay = getPlay(opts.preferredPlay);

  // A chosen poster template implies its format, so the user can pick a
  // template straight from a suggestion card without re-selecting the play.
  const posterTemplate: PosterTemplate | undefined = await resolvePosterTemplate(
    opts.tenantId,
    opts.posterTemplateId,
  );
  if (posterTemplate && !selectedPlay) selectedPlay = getPlay(posterTemplate.playId);

  // Map “make a post like that / infographic / professional report” → insight report engine
  if (!selectedPlay) {
    const ask = opts.message.toLowerCase();
    if (
      /\b(insight report|report poster|infographic|multi[-\s]?section|complicated post|professional (social )?post|agency[-\s]?style|like (this|that) (post|creative)|report[-\s]?style)\b/i.test(
        ask,
      )
    ) {
      selectedPlay = getPlay('insight_report');
    }
  }

  const template = opts.brandTemplateId
    ? await prisma.brandTemplate.findFirst({
        where: {
          id: opts.brandTemplateId,
          tenantId: opts.tenantId,
          deletedAt: null,
          isActive: true,
        },
      })
    : null;

  if (opts.brandTemplateId && !template) {
    throw new Error('Brand template not found. Create or select one in Brand Studio.');
  }

  const canvas = (template?.canvas && typeof template.canvas === 'object'
    ? (template.canvas as BrandCanvas)
    : defaultBrandCanvas({
        companyName: brandSettings?.companyName,
        backgroundUrl: template?.backgroundUrl || undefined,
      })) as BrandCanvas;

  if (template?.backgroundUrl) {
    canvas.background = { type: 'image', value: template.backgroundUrl };
  }

  const flexible = (canvas.layers || []).filter(
    (l) => isLayerDynamic(l) && !l.hidden && l.id !== '_placid_note',
  );
  const staticLayers = (canvas.layers || []).filter(
    (l) => !isLayerDynamic(l) && l.type !== 'rect' && l.type !== 'ellipse' && l.id !== '_placid_note',
  );
  const isPlacid =
    template?.provider === 'placid' ||
    canvas.designSource === 'placid' ||
    canvas.postType === 'placid';
  const preset = isPlacid
    ? {
        id: 'placid',
        label: 'Imported template (cloze fill)',
        description:
          'Design is locked in the source app. Only fill dynamic layers by exact layer name. Never invent layout or new visuals.',
      }
    : getBrandPostPreset(canvas.postType);

  const hasPlateBackground =
    Boolean(template?.backgroundUrl) ||
    (canvas.background?.type === 'image' && Boolean(canvas.background.value));

  const historyBlock = (opts.history || [])
    .slice(-12)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  const forcedMode = inferVisualModeFromHistory(opts.visualMode, opts.history, opts.message);
  const playPreferredMode: VisualMode | null =
    selectedPlay?.preferredVisualMode === 'new_poster'
      ? 'new_poster'
      : selectedPlay?.preferredVisualMode === 'existing_template'
        ? 'existing_template'
        : null;

  const zoneSpec = !template
    ? `
No Brand Studio template selected.
Only visualMode=new_poster is available (full AI poster from Settings brand guidelines + logo).
`
    : isPlacid
      ? `
PLACID DESIGN-STAGE CONTRACT (exact Placid workflow) — for visualMode=existing_template ONLY:
- Static layers (logo, brand marks, decorations) are LOCKED in Placid — never change them.
- DYNAMIC layers below are the only fillable slots.
- Do NOT invent a new design or background for existing_template mode.

DYNAMIC LAYERS TO FILL:
${flexible.map(describeZone).join('\n') || '(none — sync the imported template first)'}

Template: ${template.name}
Placid UUID: ${template.placidTemplateId || '(missing)'}
`
      : `
POST TYPE PRESET: ${preset.label} (id=${preset.id})
${preset.description}
Template: ${template.name}
Plate background image: ${hasPlateBackground ? 'YES — this is a finished brand plate. Logos/header/footer/baked-in marketing copy are already in the image.' : 'no'}

DYNAMIC ZONES (existing_template mode — AI may fill ONLY these; logos/header/footer stay static):
${flexible.map(describeZone).join('\n') || '(none marked dynamic)'}

STATIC ZONES (never rewrite):
${staticLayers.map(describeZone).join('\n') || '(none / baked into plate image)'}

Background mode: ${canvas.backgroundMode || 'static'}
${lineContractBlock(canvas.layers || [])}

CRITICAL existing_template rule:
- Keep the plate, logos, header, footer, and any baked-in design EXACTLY as-is.
- Only change DYNAMIC zone text/images.
- If the user wants a completely different campaign topic than what the plate was designed for
  (e.g. festival greeting on an ROI-calculator plate), do NOT generate_post on the plate —
  reply and tell them to choose "New poster" instead, unless they explicitly insist on existing_template.
`;

  const playBlock = selectedPlay
    ? `
SELECTED PLAY (user clicked a suggestion — generate this format):
- id=${selectedPlay.id}
- label=${selectedPlay.label}
- postType=${selectedPlay.postType}
- format=${selectedPlay.format}
- risk=${selectedPlay.risk}
- visualRecipe: ${selectedPlay.visualRecipe}
- copyRecipe: ${selectedPlay.copyRecipe}
${selectedPlay.caveat ? `- caveat: ${selectedPlay.caveat}` : ''}
Prefer visualMode=${selectedPlay.preferredVisualMode === 'either' ? 'respect UI choice' : selectedPlay.preferredVisualMode}.
If the user has NOT provided concrete facts yet, set action=reply and ask for them (${selectedPlay.briefPrompt || 'ask for details'}). Do NOT invent. Only generate_post after they give real details.
${selectedPlay.id === 'insight_report' && !posterTemplate ? 'For insight_report you MUST fill insightReport (headline, 3 points, summary, callout, backgroundPrompt) and use visualMode=new_poster.' : ''}
`
    : '';

  const posterTemplateBlock = posterTemplate
    ? `
LOCKED POSTER TEMPLATE (the user picked this design — visualMode is new_poster):
- id=${posterTemplate.id} | ${posterTemplate.label} | layout=${posterTemplate.layout}
- ${templateCaptionHint(posterTemplate)}
A separate art-director pass writes the on-image copy for this template. Your job here is the CAPTIONS, hashtags and CTA.
Do NOT return insightReport for this request.
${
  templateNeedsStat(posterTemplate)
    ? `This template renders a hard number (discount, metric, date). If the user's brief does not contain one, set action=reply and ask for it — never invent it.`
    : ''
}
`
    : '';

  const intent = await llm.generateRawJson({
    systemPrompt: `${buildSystemPrompt(brandSettings ?? {
      brandVoice: '', imageStyle: '', hashtagStrategy: '', contentGuidelines: '', targetAudience: '',
    })}

You are ContentPilot's AI Assistant — like a sharp creative strategist: suggest options first when exploring, then generate when the user commits.

Brand type: ${brandType.toUpperCase()} (adapt tone and which formats you recommend).

THREE ACTIONS:
1) suggest_formats — when user asks for ideas, variations, "what should we post", brainstorms, or open-ended campaign help.
   Return 4–6 play ids from the PLAYBOOK below. Explain briefly in assistantMessage.
2) generate_post — when user clearly wants a finished post OR picked a play card, AND visualMode is known (or play prefers new_poster).
3) reply — clarifying questions only.

PLAYBOOK (only suggest ids from this list):
${playbookPromptBlock(brandType)}

TWO VISUAL MODES for generate_post:
1) existing_template — fill ONLY dynamic zones on the saved Brand Studio / Placid plate. Never redesign it.
2) new_poster — create a brand-new poster. If a LOCKED POSTER TEMPLATE is listed below, the layout is FIXED: captions only here; a later pass fills the template blocks. If no template is locked, the art-director may design freely from Settings brand guidelines.

Do not invent a layout when a template is locked. Do not fill Brand Studio zones when visualMode is new_poster.

${zoneSpec}
${playBlock}
${posterTemplateBlock}

${
  forcedMode || (playPreferredMode && selectedPlay)
    ? `Preferred visualMode="${forcedMode || playPreferredMode}". Respect when generating.`
    : `If generating without a mode, ask existing vs new. Exception: suggest_formats does NOT need visualMode.`
}

Company: ${brandSettings?.companyName || '(not set)'}
Logo in Settings: ${brandSettings?.logoUrl ? 'yes' : 'no'}
Brand reference image: ${opts.referenceImageUrl ? 'YES — style-lock to reference' : 'no'}
Image format: ${opts.imageFormat || 'instagram_square'}

Return JSON ONLY:
{
  "action": "reply" | "suggest_formats" | "generate_post",
  "visualMode": "existing_template" | "new_poster" | null,
  "suggestionIds": ["countdown", "launch"],
  "playId": "countdown or null",
  "assistantMessage": "friendly helpful message shown in chat",
  "headline": "shared short title (fallback)",
  "subtext": "optional",
  "body": "fallback caption if captions missing",
  "hashtags": ["fallbackTag"],
  "callToAction": "optional",
  "captions": {
    "instagram": {
      "headline": "short punchy IG title",
      "body": "Instagram caption",
      "hashtags": ["Tag1", "Tag2", "Tag3", "Tag4", "Tag5"],
      "callToAction": "short CTA"
    },
    "linkedin": {
      "headline": "professional LinkedIn hook",
      "body": "LinkedIn caption",
      "hashtags": ["Tag1", "Tag2", "Tag3"],
      "callToAction": "professional CTA"
    }
  },
  "slots": { "<slotName>": "value or json object with lines" },
  "imagePrompt": "detailed art direction matching the selected play visualRecipe",
  "backgroundImagePrompt": "only if backgroundMode=dynamic on existing_template",
  "insightReport": {
    "headline": "Big claim with optional #rank",
    "headlineAccent": "#2",
    "subheadline": "Why it matters…",
    "points": [
      { "title": "Short label", "text": "One tight reason" },
      { "title": "Short label", "text": "One tight reason" },
      { "title": "Short label", "text": "One tight reason" }
    ],
    "summary": "2–3 sentence takeaway",
    "calloutTitle": "Callout headline",
    "calloutBody": "Supporting callout paragraph",
    "backgroundPrompt": "Photorealistic background scene ONLY — no text, logos, or UI"
  }
}

Rules:
- Prefer suggest_formats when exploring (ideas, variations, open briefs).
- When a preferred play is selected BUT the user has not given real facts (offer %, product, date, insight), set action=reply and ask using that play's brief questions. NEVER invent discounts, prices, features, or dates.
- Only generate_post when the user provided concrete details (or attached a reference that supplies them).
- Never invent company names not in the brand profile.
- Meme: original layouts only; no copyrighted meme templates or celebrity faces.
- Aesthetic: minimal on-image text; caption carries the message.
- Countdown: if no date/event in the message, reply to ask — don't invent fake dates.
- Offer/promo: never invent % off, coupons, or pricing — ask first.
- insight_report / professional multi-block posts: ALWAYS return insightReport object (headline, headlineAccent, subheadline, points[3], summary, calloutTitle, calloutBody, backgroundPrompt). Never invent rankings/stats not in the user brief. backgroundPrompt = pure photo scene, zero text.
- ALWAYS include captions.instagram AND captions.linkedin on generate_post.
- For new_poster imagePrompt: finished campaign visual; ban placeholder/mockup/wireframe.
- Keep assistantMessage concise and human.`,
    userPrompt: `Conversation so far:
${historyBlock || '(new chat)'}

USER: ${opts.message}`,
  });

  let visualMode: VisualMode | null =
    forcedMode ||
    (intent.visualMode === 'existing_template' || intent.visualMode === 'new_poster'
      ? intent.visualMode
      : null);

  if (opts.visualMode === 'existing_template' || opts.visualMode === 'new_poster') {
    visualMode = opts.visualMode;
  } else if (!visualMode && playPreferredMode) {
    visualMode = playPreferredMode;
  }

  // A ContentPilot poster template is always rendered as a new poster.
  if (posterTemplate) visualMode = 'new_poster';

  let action: BrandChatResult['action'] =
    intent.action === 'generate_post'
      ? 'generate_post'
      : intent.action === 'suggest_formats'
        ? 'suggest_formats'
        : 'reply';

  // Hard gate: never generate a play without a real user brief (stops random offers)
  const briefReady = playHasEnoughBrief(selectedPlay, opts.message, opts.history);
  if (selectedPlay?.requiresBrief && !briefReady) {
    action = 'reply';
    return {
      assistantMessage: String(
        intent.assistantMessage &&
          /ask|need|tell|what|share|provide|upload/i.test(String(intent.assistantMessage))
          ? intent.assistantMessage
          : selectedPlay.briefPrompt ||
            `Before I generate a ${selectedPlay.label.toLowerCase()} post, tell me the real details — I won’t invent them. You can also upload a reference image.`,
      ),
      action: 'reply',
      visualMode: visualMode || playPreferredMode,
      playId: selectedPlay.id,
      posterTemplateId: posterTemplate?.id ?? null,
      suggestions: undefined,
    };
  }

  if (action === 'suggest_formats') {
    const suggestions = resolveSuggestions(brandType, intent.suggestionIds);
    return {
      assistantMessage: String(
        intent.assistantMessage ||
          `Here are post formats that fit a ${String(brandType).toUpperCase()} brand — pick one to generate.`,
      ),
      action: 'suggest_formats',
      visualMode,
      suggestions,
      playId: null,
    };
  }

  if (action === 'generate_post' && !visualMode) {
    if (playPreferredMode === 'new_poster' || !template) {
      visualMode = 'new_poster';
    } else {
      action = 'reply';
      visualMode = null;
    }
  }

  if (action === 'generate_post' && visualMode === 'existing_template' && !template) {
    return {
      assistantMessage:
        'Pick a Brand Studio template on the left first, or choose “New poster” to generate from Settings brand guidelines.',
      action: 'reply',
      visualMode: null,
    };
  }

  const playId =
    selectedPlay?.id ||
    (typeof intent.playId === 'string' ? intent.playId : null) ||
    null;
  const activePlay = getPlay(playId) || selectedPlay;

  // Enrich image prompt with play recipe when generating
  if (activePlay && typeof intent.imagePrompt === 'string') {
    intent.imagePrompt = `${intent.imagePrompt}\n\nPlay (${activePlay.label}): ${activePlay.visualRecipe}`;
  } else if (activePlay && action === 'generate_post') {
    (intent as Record<string, unknown>).imagePrompt = `Premium ${activePlay.label} social post for ${brandSettings?.companyName || 'the brand'}. ${activePlay.visualRecipe}`;
  }

  const assistantMessage = String(
    intent.assistantMessage ||
      (action === 'generate_post'
        ? visualMode === 'new_poster'
          ? posterTemplate
            ? `I built this on the “${posterTemplate.label}” template, in your brand colours and fonts.`
            : activePlay
            ? `I created a ${activePlay.label.toLowerCase()} poster from your brand guidelines.`
            : 'I created a new poster from your brand guidelines.'
          : 'I filled your brand template dynamic zones.'
        : !visualMode
          ? 'Should I (A) fill your existing brand template, or (B) create a new poster? You can also ask me to suggest post format ideas first.'
          : 'How can I help with your brand post? Ask me to suggest formats anytime.'),
  );

  if (action === 'reply') {
    return {
      assistantMessage,
      action: 'reply',
      visualMode,
      playId,
      posterTemplateId: posterTemplate?.id ?? null,
    };
  }

  const start = Date.now();
  const created = await prisma.generatedContent.create({
    data: {
      tenantId: opts.tenantId,
      engine: 'brand_chat',
      status: 'generating',
      brandTemplateId: visualMode === 'existing_template' ? template?.id ?? null : null,
    },
  });

  await executionLogService.log({
    tenantId: opts.tenantId,
    contentId: created.id,
    workflowStep: `brand_chat:generate:${visualMode}`,
    engine: ContentEngine.BRAND_CHAT,
    message: opts.message.slice(0, 200),
  });

  try {
    const headline = String(intent.headline || 'New post');
    const body = String(intent.body || '');
    const { buildPlatformCaptionsFromIntent, normalizeHashtags } = await import('./platform-captions');
    const hashtags = normalizeHashtags(
      Array.isArray(intent.hashtags)
        ? intent.hashtags
        : typeof intent.hashtags === 'string'
          ? intent.hashtags
          : [],
    );
    const conversationContext = [
      opts.message,
      ...(opts.history || []).map((h) => h.content),
      body,
      headline,
    ]
      .filter(Boolean)
      .join('\n');
    const cta = sanitizeGeneratedCta(intent.callToAction, conversationContext);

    const platformCaptions = buildPlatformCaptionsFromIntent(intent as Record<string, unknown>, {
      headline,
      body,
      hashtags,
      callToAction: cta ?? null,
    });
    // Primary fields default to LinkedIn (B2B), with Instagram stored in platformCaptions
    const primary = platformCaptions.linkedin || {
      headline,
      body,
      hashtags,
      callToAction: cta ?? null,
    };

    let imageUrl: string | null = null;

    if (visualMode === 'new_poster') {
      const includeLogo = opts.includeLogo !== false;
      const format = opts.imageFormat || 'instagram_square';
      const company = brandSettings?.companyName || 'the brand';
      const useInsightReport =
        !posterTemplate &&
        (activePlay?.id === 'insight_report' ||
          (intent.insightReport && typeof intent.insightReport === 'object'));

      if (posterTemplate) {
        // ---- locked template: art-direct the copy into the template's blocks
        const { generateTemplatePosterSpec } = await import('./poster-spec.service');
        const brief = [opts.message, ...(opts.history || []).slice(-6).map((m) => m.content)]
          .filter(Boolean)
          .join('\n')
          .slice(0, 8000);

        const spec = await generateTemplatePosterSpec({
          tenantId: opts.tenantId,
          template: posterTemplate,
          topic: primary.headline || opts.message.slice(0, 120),
          brief,
          headline: primary.headline,
          body: primary.body,
          callToAction: primary.callToAction,
          artHint: [
            activePlay?.visualRecipe || '',
            brandSettings?.imageStyle ? `Brand visual style: ${brandSettings.imageStyle}` : '',
          ]
            .filter(Boolean)
            .join(' '),
        });

        await executionLogService.log({
          tenantId: opts.tenantId,
          contentId: created.id,
          workflowStep: `brand_chat:poster_template:${posterTemplate.id}`,
          engine: ContentEngine.BRAND_CHAT,
          message: `${posterTemplate.label} · layout=${posterTemplate.layout} · pillars=${spec.pillars?.length ?? 0}`,
        });

        await prisma.generatedContent.update({
          where: { id: created.id },
          data: {
            headline: primary.headline,
            body: primary.body,
            hashtags: primary.hashtags,
            callToAction: primary.callToAction,
            platformCaptions,
            imagePrompt: spec.artPrompt || '',
            sourceReference: `Template poster (${posterTemplate.label}): ${opts.message.slice(0, 110)}`,
            status: 'generating',
            // Stored so Approvals → reframe re-renders the same template.
            templateSlots: {
              playId: activePlay?.id || posterTemplate.playId,
              posterTemplateId: posterTemplate.id,
              posterLayout: posterTemplate.layout,
              fillLayout: effectivePosterLayout(posterTemplate),
              sourceImageUrl: posterTemplate.sourceImageUrl || null,
              posterSpec: spec,
            } as object,
          },
        });

        const attached = await attachGeneratedImage(
          opts.tenantId,
          created.id,
          spec.artPrompt || primary.headline,
          {
            brandImageStyle: brandSettings?.imageStyle,
            companyName: brandSettings?.companyName,
            logoUrl: includeLogo
              ? preferOriginalLogoUrl(brandSettings?.logoUrl) || brandSettings?.logoUrl || null
              : null,
            format,
            throwOnError: true,
            savePrompt: true,
            creativeType: 'poster',
            posterSpec: spec,
            posterLayout: posterTemplate.layout,
            fillLayout: effectivePosterLayout(posterTemplate),
            sourceImageUrl: posterTemplate.sourceImageUrl || null,
            playId: activePlay?.id || posterTemplate.playId,
            posterTemplateId: posterTemplate.id,
            designSource: 'template',
            artRole: 'hero_under_svg',
            negativePrompt: spec.artNegativePrompt || null,
            // The poster frame composites all type — the art must stay text-free.
            exact: true,
            rawOnly: false,
            contentBrief: null,
            visualStyleId:
              String(brandSettings?.brandType || 'b2b').toLowerCase() === 'b2c'
                ? 'cinematic_photo'
                : 'professional_photo',
          },
        );
        imageUrl = attached?.imageUrl ?? null;

        await prisma.generatedContent.update({
          where: { id: created.id },
          data: { status: 'assistant_draft', imageUrl },
        });
      } else if (useInsightReport) {
        const raw = (intent.insightReport || {}) as Record<string, unknown>;
        const pointsRaw = Array.isArray(raw.points) ? raw.points : [];
        const report: InsightReportContent = {
          headline: String(raw.headline || primary.headline || 'Key insight'),
          headlineAccent: typeof raw.headlineAccent === 'string' ? raw.headlineAccent : undefined,
          subheadline: String(raw.subheadline || ''),
          points: pointsRaw
            .map((p) => {
              if (!p || typeof p !== 'object') return null;
              const row = p as Record<string, unknown>;
              return {
                title: String(row.title || ''),
                text: String(row.text || row.body || ''),
              };
            })
            .filter((p): p is { title: string; text: string } => Boolean(p && p.text))
            .slice(0, 3),
          summary: String(raw.summary || primary.body?.slice(0, 280) || ''),
          calloutTitle: String(raw.calloutTitle || 'Key takeaway'),
          calloutBody: String(raw.calloutBody || ''),
        };
        while (report.points.length < 3) {
          report.points.push({ title: '', text: 'Add a supporting point from your brief.' });
        }

        const bgPrompt = [
          typeof raw.backgroundPrompt === 'string' && raw.backgroundPrompt.trim()
            ? raw.backgroundPrompt.trim()
            : typeof intent.imagePrompt === 'string' && intent.imagePrompt.trim()
              ? intent.imagePrompt.trim()
              : `Photorealistic editorial background for: ${report.headline}. Cinematic lighting, premium B2B campaign still.`,
          activePlay?.visualRecipe || '',
          brandSettings?.imageStyle ? `Brand visual style: ${brandSettings.imageStyle}` : '',
          'PURE BACKGROUND PHOTO ONLY — zero readable text, logos, charts with numbers, or UI chrome.',
        ]
          .filter(Boolean)
          .join(' ');

        await prisma.generatedContent.update({
          where: { id: created.id },
          data: {
            headline: primary.headline || report.headline,
            body: primary.body,
            hashtags: primary.hashtags,
            callToAction: primary.callToAction,
            platformCaptions,
            imagePrompt: bgPrompt,
            sourceReference: `Insight report poster: ${opts.message.slice(0, 120)}`,
            status: 'generating',
            templateSlots: { playId: 'insight_report', insightReport: report } as object,
          },
        });

        const attached = await attachGeneratedImage(opts.tenantId, created.id, bgPrompt, {
          brandImageStyle: brandSettings?.imageStyle,
          companyName: brandSettings?.companyName,
          logoUrl: null,
          format: format === 'linkedin' ? 'linkedin' : 'instagram_portrait',
          throwOnError: true,
          savePrompt: true,
          rawOnly: true,
          exact: true,
          contentBrief: null,
          playId: 'insight_report',
          artRole: 'hero_under_svg',
        });

        const rawArt = attached?.imageUrl;
        if (!rawArt) throw new Error('Insight report background image failed to generate');

        const framed = await insightSocialFrame({
          tenantId: opts.tenantId,
          imageUrl: rawArt,
          companyName: brandSettings?.companyName,
          logoUrl: includeLogo
            ? preferOriginalLogoUrl(brandSettings?.logoUrl) || brandSettings?.logoUrl
            : null,
          brandImageStyle: brandSettings?.imageStyle,
          report,
          width: format === 'linkedin' ? 1200 : 1080,
          height: format === 'linkedin' ? 627 : 1350,
        });
        imageUrl = framed.publicUrl;

        await prisma.generatedContent.update({
          where: { id: created.id },
          data: {
            status: 'assistant_draft',
            imageUrl,
            rawImageUrl: rawArt,
          },
        });
      } else {
      const chatSubject = [
        primary.headline,
        primary.body ? primary.body.slice(0, 280) : '',
        opts.message.slice(0, 600),
      ]
        .filter(Boolean)
        .join(' — ');

      let styleBrief = '';
      let referenceForModel: string | null = null;
      let lockedPrompt: string | null = null;
      if (opts.referenceImageUrl) {
        try {
          const {
            describeBrandReferenceStyle,
            buildReferenceLockedImagePrompt,
            resolveReferenceDataUri,
            resolveReferencePublicUrl,
          } = await import('./reference-style.service');
          styleBrief = await describeBrandReferenceStyle(opts.tenantId, opts.referenceImageUrl);
          // fal cannot fetch localhost — prefer data URI; otherwise public API URL
          const publicUrl = resolveReferencePublicUrl(opts.referenceImageUrl);
          if (/localhost|127\.0\.0\.1/.test(publicUrl)) {
            referenceForModel = await resolveReferenceDataUri(opts.referenceImageUrl);
          } else {
            referenceForModel = publicUrl;
          }
          await executionLogService.log({
            tenantId: opts.tenantId,
            contentId: created.id,
            workflowStep: 'brand_chat:reference_style',
            engine: ContentEngine.BRAND_CHAT,
            message: styleBrief.slice(0, 240),
          });

          lockedPrompt = buildReferenceLockedImagePrompt({
            chatSubject,
            styleBrief,
            companyName: company,
            brandImageStyle: brandSettings?.imageStyle,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await executionLogService.log({
            tenantId: opts.tenantId,
            contentId: created.id,
            workflowStep: 'brand_chat:reference_style_failed',
            engine: ContentEngine.BRAND_CHAT,
            message: msg.slice(0, 300),
          });
        }
      }

      const groundedPrompt = buildGroundedPosterPrompt({
        userMessage: opts.message,
        headline: primary.headline || headline,
        body: primary.body || body,
        company,
        brandImageStyle: brandSettings?.imageStyle,
        visualRecipe: activePlay?.visualRecipe || null,
      });

      const baseArt =
        lockedPrompt ||
        (!isWeakImagePrompt(intent.imagePrompt)
          ? String(intent.imagePrompt).trim()
          : groundedPrompt);

      const imagePrompt = [
        groundedPrompt,
        baseArt,
        !styleBrief && opts.referenceImageUrl
          ? 'Match the attached brand reference look as closely as possible (same medium, palette, lighting, layout energy). Change only the subject to match the chat.'
          : '',
        PROFESSIONAL_POSTER_GUARDRAILS,
        includeLogo
          ? 'Leave the top-left corner lightly calm for a real transparent brand logo overlay — do not draw company logos, footer bars, white squares, or brand name watermarks in the artwork.'
          : 'Full-bleed finished artwork with no footer chrome.',
      ]
        .filter(Boolean)
        .join(' ');

      await prisma.generatedContent.update({
        where: { id: created.id },
        data: {
          headline: primary.headline,
          body: primary.body,
          hashtags: primary.hashtags,
          callToAction: primary.callToAction,
          platformCaptions,
          imagePrompt,
          sourceReference: [
            'AI new poster:',
            opts.message.slice(0, 100),
            opts.referenceImageUrl ? `| ref:${opts.referenceImageUrl}` : '',
            styleBrief ? `| style:${styleBrief.slice(0, 120)}` : '',
          ]
            .filter(Boolean)
            .join(' '),
          status: 'generating',
        },
      });

      const attached = await attachGeneratedImage(opts.tenantId, created.id, imagePrompt, {
        brandImageStyle: brandSettings?.imageStyle,
        companyName: brandSettings?.companyName,
        logoUrl: includeLogo
          ? preferOriginalLogoUrl(brandSettings?.logoUrl) || brandSettings?.logoUrl || null
          : null,
        format,
        throwOnError: true,
        savePrompt: true,
        creativeType: 'social',
        playId: activePlay?.id || playId,
        designSource: 'ai',
        artRole: 'hero_under_svg',
        chatHistory: opts.history?.map((h) => ({ role: h.role, content: h.content })),
        headerText: primary.headline,
        footerCta: primary.callToAction || null,
        overlay: { overlaysEnabled: includeLogo !== false },
        visualStyleId:
          String(brandSettings?.brandType || 'b2b').toLowerCase() === 'b2c'
            ? 'cinematic_photo'
            : 'professional_photo',
        posterQuality: true,
        // Skip content-lock to post headline when we already style-locked to reference + chat
        contentBrief: styleBrief ? null : chatSubject,
        referenceImageUrl: referenceForModel,
        exact: Boolean(lockedPrompt),
      });
      imageUrl = attached?.imageUrl ?? null;

      await prisma.generatedContent.update({
        where: { id: created.id },
        data: {
          status: 'assistant_draft',
          imageUrl,
        },
      });
      }
    } else {
      // existing_template cloze fill
      const slots: Record<string, string> = {};
      if (intent.slots && typeof intent.slots === 'object' && !Array.isArray(intent.slots)) {
        for (const [k, v] of Object.entries(intent.slots as Record<string, unknown>)) {
          if (typeof v === 'object' && v != null) slots[k] = JSON.stringify(v);
          else slots[k] = String(v ?? '');
        }
      }
      if (typeof intent.headline === 'string') slots.headline = slots.headline || intent.headline;
      if (typeof intent.subtext === 'string') slots.subtext = slots.subtext || intent.subtext;

      for (const layer of canvas.layers || []) {
        if (!isLayerDynamic(layer) || layer.hidden) {
          if (layer.slot) delete slots[layer.slot];
          continue;
        }
        const ft = layerFillType(layer);
        const key = layer.slot || layer.id;
        if (!slots[key]) continue;

        if (ft === 'json' || layer.jsonSchema || layer.lineCount) {
          const lines = resolveSlotLines(slots[key], layer.lineCount);
          if (ft === 'json' || layer.jsonSchema) {
            slots[key] = JSON.stringify({
              lines: lines.map((value, i) => ({ index: i + 1, value })),
            });
          } else if (layer.lineCount && layer.lineCount > 1) {
            slots[key] = lines.join('\n');
          } else if (layer.lineCount === 1) {
            slots[key] = lines[0] || slots[key].split('\n')[0] || slots[key];
          }
        }
      }

      const providers = await resolveProviders(opts.tenantId);
      const { routeForGeneration } = await import('./smart-image-router.service');
      for (const layer of canvas.layers || []) {
        if (layer.type !== 'image' || !isLayerDynamic(layer) || layer.hidden) continue;
        const ft = layerFillType(layer);
        const key = layer.slot || layer.id;
        if (ft === 'image_prompt') {
          const prompt = slots[key] || String(intent.headline || opts.message);
          const { providers: routed } = routeForGeneration(
            {
              prompt,
              artRole: 'hero_under_svg',
              designSource: 'brand_template',
              routingMode: providers.imageRoutingMode || 'auto',
            },
            providers,
          );
          const img = await generateContentImage(routed, prompt, brandSettings?.imageStyle);
          if (img?.url) slots[key] = img.url;
        }
      }

      if (canvas.backgroundMode === 'dynamic' && !isPlacid) {
        const bgPrompt =
          typeof intent.backgroundImagePrompt === 'string'
            ? intent.backgroundImagePrompt
            : String(intent.headline || opts.message);
        const { providers: routed } = routeForGeneration(
          {
            prompt: bgPrompt,
            artRole: 'hero_under_svg',
            designSource: 'brand_template',
            routingMode: providers.imageRoutingMode || 'auto',
          },
          providers,
        );
        const bgImg = await generateContentImage(routed, bgPrompt, brandSettings?.imageStyle);
        if (bgImg?.url) {
          canvas.background = { type: 'image', value: bgImg.url };
        }
      }

      if (template?.provider === 'placid' && template.placidTemplateId && providers.placidApiKey) {
        const layers: Record<string, { text?: string; image?: string }> = {};
        for (const layer of canvas.layers || []) {
          if (!isLayerDynamic(layer) || layer.id === '_placid_note') continue;
          const key = layer.slot || layer.id;
          const raw = slots[key];
          if (!raw?.trim()) continue;
          const placidType = layer.placidType || (layer.type === 'image' ? 'picture' : 'text');
          if (placidType === 'picture' || placidType === 'browserframe' || layer.type === 'image') {
            if (/^https?:\/\//i.test(raw.trim())) layers[key] = { image: raw.trim() };
          } else {
            const text = resolveSlotLines(raw, layer.lineCount).filter(Boolean).join('\n') || raw;
            layers[key] = { text };
          }
        }
        imageUrl = await renderWithPlacid({
          templateId: template.placidTemplateId,
          layers,
          apiKey: providers.placidApiKey,
          width: canvas.width || null,
          height: canvas.height || null,
        });
      } else {
        const svg = await renderBrandCanvasSvg(canvas, slots);
        const saved = await saveRenderedSvg(opts.tenantId, svg, 'post');
        imageUrl = saved.publicUrl;
      }

      await prisma.generatedContent.update({
        where: { id: created.id },
        data: {
          headline: primary.headline,
          body: primary.body,
          hashtags: primary.hashtags,
          callToAction: primary.callToAction,
          platformCaptions,
          imageUrl,
          sourceReference: `Brand template fill: ${opts.message.slice(0, 120)}`,
          brandTemplateId: template?.id ?? null,
          status: 'assistant_draft',
        },
      });
    }

    await executionLogService.log({
      tenantId: opts.tenantId,
      contentId: created.id,
      workflowStep: 'brand_chat:complete',
      engine: ContentEngine.BRAND_CHAT,
      status: ExecutionStatus.SUCCESS,
      durationMs: Date.now() - start,
    });

    return {
      assistantMessage:
        assistantMessage +
        '\n\nCaptions ready: Instagram + LinkedIn variants (with hashtags). In Approvals, pick channels and each platform gets its own caption.',
      action: 'generate_post',
      visualMode,
      contentId: created.id,
      playId,
      posterTemplateId: posterTemplate?.id ?? null,
      preview: {
        headline: primary.headline,
        body: primary.body,
        hashtags: primary.hashtags,
        callToAction: primary.callToAction || undefined,
        imageUrl,
        captions: platformCaptions,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.generatedContent.update({
      where: { id: created.id },
      data: { status: 'failed', publishError: msg },
    });
    throw err;
  }
}

/** @deprecated use runBrandAssistant */
export async function generateBrandChatPost(opts: {
  tenantId: string;
  brandTemplateId: string;
  userMessage: string;
  contentId?: string;
}): Promise<{ contentId: string }> {
  const result = await runBrandAssistant({
    tenantId: opts.tenantId,
    brandTemplateId: opts.brandTemplateId,
    message: opts.userMessage,
    visualMode: 'existing_template',
  });
  if (!result.contentId) {
    const forced = await runBrandAssistant({
      tenantId: opts.tenantId,
      brandTemplateId: opts.brandTemplateId,
      message: `Please generate the social post now for: ${opts.userMessage}`,
      history: [{ role: 'user', content: opts.userMessage }],
      visualMode: 'existing_template',
    });
    if (!forced.contentId) throw new Error(forced.assistantMessage || 'Could not generate post');
    return { contentId: forced.contentId };
  }
  return { contentId: result.contentId };
}
