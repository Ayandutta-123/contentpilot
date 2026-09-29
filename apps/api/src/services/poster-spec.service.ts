import { prisma } from '../lib/prisma';
import { LLMService, buildSystemPrompt } from './llm.service';
import { POSTER_ICON_IDS, POSTER_LAYOUTS, type PosterLayoutId, type PosterSpec } from '../providers/images/poster-frame';
import {
  applyTemplateContract,
  getPosterTemplate,
  templateContractPrompt,
  type PosterTemplate,
} from './poster-template-catalog';
import { resolvePosterTemplate } from './play-poster-templates.service';

/**
 * Art direction the image model must obey for a designed poster: the artwork is
 * only the hero layer behind/beside the type, so it must be a believable scene
 * with calm space — never a cluttered "AI tech" collage.
 */
export const POSTER_ART_NEGATIVE = [
  'text, letters, words, captions, headlines, watermarks, signage, UI labels, numbers',
  'fake logos, logo placeholders, empty framed boxes, dashed rectangles',
  'outdoor or rooftop server racks, holographic wireframe buildings, floating digital-twin overlays',
  'glowing brains, robot mascots, cyborg faces, hexagon HUDs, circuit-board wallpaper',
  'handshakes, teams huddled around a laptop, generic stock-photo poses',
  'neon cyberpunk clutter, lens flare spam, warped architecture, extra limbs, deformed hands',
  'collage of many small elements, busy edges, low-resolution artifacts',
].join(', ');

const ART_RULES = [
  'The artwork sits BEHIND and BESIDE the typography, so it must have calm, uncluttered areas.',
  'Describe ONE believable real-world scene (interior, city view through glass, stage, workspace, product close-up, macro detail).',
  'Name the subject, setting, camera angle/lens feel, lighting direction, and a restrained 3-colour palette that matches the brand.',
  'Photoreal editorial quality, shallow depth of field, deliberate negative space on one side.',
  'Absolutely no text, no logos, no signage, no UI screens with readable words.',
].join(' ');

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

/** Keep the accent phrase usable: it must actually appear inside the headline. */
function resolveAccent(headline: string, accent: string): string {
  const h = headline.toLowerCase();
  const a = accent.trim();
  if (a && h.includes(a.toLowerCase())) return a;
  // Fall back to the most "quotable" chunk: a number, or the last 2 words.
  const num = headline.match(/#?\d[\d.,%]*\+?/);
  if (num?.[0]) return num[0];
  const words = headline.split(/\s+/).filter(Boolean);
  return words.length > 2 ? words.slice(-2).join(' ') : '';
}

function normalizePillars(raw: unknown): PosterSpec['pillars'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 3)
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const row = item as Record<string, unknown>;
      const title = asString(row.title);
      const text = asString(row.text);
      if (!title && !text) return null;
      const icon = asString(row.icon, 'spark');
      return {
        icon: POSTER_ICON_IDS.includes(icon as never) ? icon : 'spark',
        title: title || 'Why it matters',
        text,
      };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
}

/**
 * Coerce raw LLM JSON into a renderable PosterSpec. Shared by the single-post
 * generator and the carousel outline (one call returns every slide's layout).
 */
export function posterSpecFromJson(
  raw: Record<string, unknown>,
  fallback: { headline: string; subhead?: string; closingLine?: string; artPrompt?: string },
): PosterSpec {
  const headline = asString(raw.headline, fallback.headline);
  const statValue = asString(raw.statValue);
  return {
    eyebrow: asString(raw.eyebrow),
    headline,
    headlineAccent: resolveAccent(headline, asString(raw.headlineAccent)),
    subhead: asString(raw.subhead, fallback.subhead || ''),
    pillars: normalizePillars(raw.pillars),
    statValue,
    statLabel: statValue ? asString(raw.statLabel) : '',
    calloutTitle: asString(raw.calloutTitle),
    calloutBody: asString(raw.calloutBody),
    closingLine: asString(raw.closingLine, fallback.closingLine || ''),
    footerNote: asString(raw.footerNote),
    artPrompt: asString(raw.artPrompt, fallback.artPrompt || ''),
    artNegativePrompt: [asString(raw.artNegativePrompt), POSTER_ART_NEGATIVE].filter(Boolean).join(', '),
  };
}

export type PosterSpecInput = {
  tenantId: string;
  /** Calendar title / event name. */
  topic: string;
  /** Theme, notes, guidelines for this exact entry. */
  brief?: string | null;
  headline: string;
  body: string;
  callToAction?: string | null;
  /** Carousel context so slides stay part of one story. */
  slide?: { index: number; total: number } | null;
  /**
   * Compositor layout this spec will be framed with. When set, copy density and
   * art negative-space match that geometry (avoids always writing a 3-pillar capabilities poster).
   */
  layout?: PosterLayoutId | null;
};

/**
 * Ask the copy model for a poster layout brief matched to the chosen geometry.
 */
export async function generatePosterSpec(input: PosterSpecInput): Promise<PosterSpec> {
  const brand = await prisma.brandSettings.findUnique({ where: { tenantId: input.tenantId } });
  const company = brand?.companyName?.trim() || 'the brand';
  const isB2c = String(brand?.brandType || 'b2b').toLowerCase() === 'b2c';

  const { layoutPhotoComposition, layoutCopyDirection, layoutPillarBudget, pickSinglePosterLayout, finalizeArtPrompt, LAYOUT_LABELS } =
    await import('./poster-layout-pick');
  const layout: PosterLayoutId =
    input.layout && input.layout in POSTER_LAYOUTS
      ? input.layout
      : pickSinglePosterLayout(`${input.tenantId}:${input.topic}:${input.headline}`);
  const maxPillars = layoutPillarBudget(layout);

  const fallback: PosterSpec = {
    eyebrow: input.topic.slice(0, 40),
    headline: input.headline,
    headlineAccent: resolveAccent(input.headline, ''),
    subhead: input.body.split(/(?<=[.!?])\s+/)[0]?.slice(0, 160) || '',
    pillars: [],
    closingLine: input.callToAction || '',
    artPrompt: finalizeArtPrompt(
      `Photoreal editorial ${isB2c ? 'lifestyle' : 'business'} scene for: ${input.topic}. Restrained palette, shallow depth of field, no text or logos in frame.`,
      layout,
    ),
    artNegativePrompt: POSTER_ART_NEGATIVE,
  };

  try {
    const llm = await LLMService.forTenant(input.tenantId);
    const slideLine = input.slide
      ? `\nThis is slide ${input.slide.index} of ${input.slide.total} in ONE carousel — keep it a chapter of the same story, not a new topic.`
      : '';

    const pillarRule =
      maxPillars === 0
        ? '- Use an EMPTY pillars array. This layout is claim/CTA focused — no icon cards.'
        : `- At most ${maxPillars} pillars (0–${maxPillars}). Prefer fewer when a stat or callout is used. Never pad to force cards.`;

    const raw = await llm.generateRawJson({
      systemPrompt: `${buildSystemPrompt({
        companyName: brand?.companyName || '',
        productName: brand?.productName || '',
        productTagline: brand?.productTagline || '',
        industry: brand?.industry || '',
        brandType: brand?.brandType || 'b2b',
        brandVoice: brand?.brandVoice || '',
        imageStyle: brand?.imageStyle || '',
        hashtagStrategy: brand?.hashtagStrategy || '',
        contentGuidelines: brand?.contentGuidelines || '',
        targetAudience: brand?.targetAudience || '',
        targetCountries: brand?.targetCountries || [],
      })}

You are the ART DIRECTOR + COPYWRITER for a designed ${isB2c ? 'social' : 'B2B LinkedIn'} POSTER.

TWO SEPARATE OUTPUTS (critical):
1) Copy blocks → rendered by our SVG layout engine (layout id is already chosen).
2) artPrompt → PHOTO ONLY for an image model (fal). NEVER mention typography, type columns, headlines, cards, "negative space for text", left/right for type, or layout names inside artPrompt.

LOCKED LAYOUT (compositor — do not put this wording in artPrompt): "${layout}" (${LAYOUT_LABELS[layout] || layout})
Copy density for this layout: ${layoutCopyDirection(layout)}
Photo composition hint (you may paraphrase softly into artPrompt, never as layout jargon): ${layoutPhotoComposition(layout)}

Return JSON ONLY:
{
  "eyebrow": "2-4 word category label, or empty string",
  "headline": "8-16 words, specific claim",
  "headlineAccent": "EXACT substring of headline (2-4 words or a number)",
  "subhead": "one supporting sentence, max 22 words — or empty",
  "pillars": [ { "icon": "allowed icon", "title": "2-4 words", "text": "8-16 words" } ],
  "statValue": "short metric — omit if no honest number",
  "statLabel": "4-8 words",
  "calloutTitle": "3-6 words or empty",
  "calloutBody": "one insight or empty",
  "closingLine": "6-12 word takeaway or CTA",
  "footerNote": "optional, max 20 words",
  "artPrompt": "2-4 sentences: subject, setting, camera, lighting, palette — PHOTO ONLY",
  "artNegativePrompt": "comma separated bans"
}

CONTENT RULES
${pillarRule}
- Real substance from the brief. No filler.
- Never invent stats/awards/names not in the brief.
- Allowed icons: ${POSTER_ICON_IDS.join(', ')}.
- Premium social feel — sparse, not a crowded brochure.

ART RULES (artPrompt only)
- ${ART_RULES}
- Do NOT write layout/compositor instructions into artPrompt.
- artNegativePrompt must include: ${POSTER_ART_NEGATIVE}`,
      userPrompt: `Company: ${company}
Poster topic: ${input.topic}
Compositor layout id (store separately — do not paste into artPrompt): ${layout}
${input.brief ? `Brief / theme / notes (obey this exactly):\n${input.brief.slice(0, 12000)}\n` : ''}
Approved caption headline: ${input.headline}
Approved caption body:
${input.body.slice(0, 1200)}
${input.callToAction ? `Call to action: ${input.callToAction}` : ''}${slideLine}

Return JSON now. artPrompt = photography only.`,
    });

    const spec = posterSpecFromJson(raw, {
      headline: input.headline,
      subhead: fallback.subhead,
      closingLine: input.callToAction || '',
      artPrompt: fallback.artPrompt,
    });
    if ((spec.pillars?.length || 0) > maxPillars) {
      spec.pillars = (spec.pillars || []).slice(0, maxPillars);
    }
    spec.artPrompt = finalizeArtPrompt(spec.artPrompt || fallback.artPrompt || '', layout);
    return { ...spec, eyebrow: spec.eyebrow || fallback.eyebrow };
  } catch {
    return { ...fallback, artPrompt: finalizeArtPrompt(fallback.artPrompt || '', layout) };
  }
}

export type TemplatePosterSpecInput = PosterSpecInput & {
  template: PosterTemplate;
  /** Extra art direction from the play / reference style lock. */
  artHint?: string | null;
};

/**
 * Poster spec for a user-chosen template. Same art-director call as
 * `generatePosterSpec`, but the JSON shape is dictated by the template's block
 * contract and the result is clamped to it — so the rendered poster always
 * matches the layout the user picked, even if the model improvises.
 */
export async function generateTemplatePosterSpec(
  input: TemplatePosterSpecInput,
): Promise<PosterSpec> {
  const t = input.template;
  const brand = await prisma.brandSettings.findUnique({ where: { tenantId: input.tenantId } });
  const company = brand?.companyName?.trim() || 'the brand';
  const isB2c = String(brand?.brandType || 'b2b').toLowerCase() === 'b2c';

  const baseArt = [
    t.artDirection,
    input.artHint?.trim() || '',
    `Subject: ${input.topic}.`,
    `Photoreal ${isB2c ? 'lifestyle' : 'editorial business'} quality, restrained palette, no text of any kind.`,
  ]
    .filter(Boolean)
    .join(' ');

  const fallback: PosterSpec = applyTemplateContract(
    {
      eyebrow: input.topic.slice(0, 40),
      headline: input.headline,
      headlineAccent: resolveAccent(input.headline, ''),
      subhead: input.body.split(/(?<=[.!?])\s+/)[0]?.slice(0, 160) || '',
      pillars: [],
      closingLine: input.callToAction || '',
      artPrompt: baseArt,
      artNegativePrompt: POSTER_ART_NEGATIVE,
    },
    t,
  );

  try {
    const llm = await LLMService.forTenant(input.tenantId);
    const slideLine = input.slide
      ? `\nThis is slide ${input.slide.index} of ${input.slide.total} in ONE carousel — keep it a chapter of the same story, and keep the template treatment identical across slides.`
      : '';

    const raw = await llm.generateRawJson({
      systemPrompt: `${buildSystemPrompt({
        companyName: brand?.companyName || '',
        productName: brand?.productName || '',
        productTagline: brand?.productTagline || '',
        industry: brand?.industry || '',
        brandType: brand?.brandType || 'b2b',
        brandVoice: brand?.brandVoice || '',
        imageStyle: brand?.imageStyle || '',
        hashtagStrategy: brand?.hashtagStrategy || '',
        contentGuidelines: brand?.contentGuidelines || '',
        targetAudience: brand?.targetAudience || '',
        targetCountries: brand?.targetCountries || [],
      })}

You are the ART DIRECTOR + COPYWRITER filling a FIXED poster template for a ${isB2c ? 'social' : 'B2B'} post.
The layout, colours and fonts are already decided — colours and type come from the tenant's Brand Kit. Your only job is the copy blocks and the hero art direction.

${templateContractPrompt(t)}

Return JSON ONLY with exactly these keys:
{
  "eyebrow": "", "headline": "", "headlineAccent": "", "subhead": "",
  "pillars": [{ "icon": "", "title": "", "text": "" }],
  "statValue": "", "statLabel": "", "calloutTitle": "", "calloutBody": "",
  "closingLine": "", "footerNote": "",
  "artPrompt": "2-4 sentences of hero art direction",
  "artNegativePrompt": "comma separated list of things the image model must not draw"
}

GLOBAL RULES
- Blocks marked "MUST be an empty string" are rendered nowhere — returning text for them is a failure.
- Never invent statistics, prices, discounts, dates, awards, rankings or customer names that are not in the brief. Leave the block empty instead.
- Allowed pillar icons: ${POSTER_ICON_IDS.join(', ')}. Pick the icon that matches each pillar's meaning.
- artPrompt must obey the template art direction above and contain no text, logos, signage or UI copy.
- artNegativePrompt must include: ${POSTER_ART_NEGATIVE}`,
      userPrompt: `Company: ${company}
Poster topic: ${input.topic}
${input.brief ? `Brief / facts from the user (the ONLY source of truth):\n${input.brief.slice(0, 12000)}\n` : ''}
Approved caption headline: ${input.headline}
Approved caption body:
${input.body.slice(0, 1200)}
${input.callToAction ? `Call to action: ${input.callToAction}` : ''}${slideLine}

Fill the "${t.label}" template now.`,
    });

    const spec = posterSpecFromJson(raw, {
      headline: input.headline,
      subhead: fallback.subhead,
      closingLine: input.callToAction || '',
      artPrompt: baseArt,
    });

    const locked = applyTemplateContract(
      {
        ...spec,
        // The template's art direction is not negotiable.
        artPrompt: [spec.artPrompt, t.artDirection].filter(Boolean).join(' '),
      },
      t,
    );
    return {
      ...locked,
      eyebrow: locked.eyebrow || (t.blocks.eyebrow === 'omit' ? '' : fallback.eyebrow),
    };
  } catch {
    return fallback;
  }
}

/**
 * Approvals / reframe path: if the draft was generated on a locked ContentPilot
 * template, refill THAT contract. Otherwise use the unconstrained art-director.
 */
export async function generatePosterSpecRespectingTemplate(
  input: PosterSpecInput & { posterTemplateId?: string | null; artHint?: string | null },
): Promise<{ spec: PosterSpec; template?: PosterTemplate; layout?: PosterLayoutId }> {
  const template =
    (await resolvePosterTemplate(input.tenantId, input.posterTemplateId)) ||
    getPosterTemplate(input.posterTemplateId);
  if (template) {
    const spec = await generateTemplatePosterSpec({ ...input, template });
    return { spec, template, layout: template.layout };
  }
  return { spec: await generatePosterSpec(input) };
}
