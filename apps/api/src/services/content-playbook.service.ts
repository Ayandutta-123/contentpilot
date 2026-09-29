/**
 * Social post "plays" — formats the AI Assistant can suggest and generate.
 * Filtered by B2B / B2C brand type from Settings → Company.
 */

export type PlayRisk = 'low' | 'medium' | 'high';
export type PlayFormat =
  | 'single_image'
  | 'story'
  | 'carousel'
  | 'thread'
  | 'meme'
  | 'minimal_text';

export type ContentPlay = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  why: string;
  format: PlayFormat;
  /** Maps to Brand Studio postType preset when filling a plate */
  postType: string;
  channels: Array<'instagram' | 'linkedin' | 'twitter'>;
  brandTypes: Array<'b2b' | 'b2c' | 'both'>;
  risk: PlayRisk;
  /** Prefer new_poster vs existing_template when user hasn't locked a mode */
  preferredVisualMode: 'new_poster' | 'existing_template' | 'either';
  /** Extra art-direction for imagePrompt / captions */
  visualRecipe: string;
  copyRecipe: string;
  starterPrompt: string;
  needsDate?: boolean;
  /** Must collect real facts from the user before generate — never invent */
  requiresBrief?: boolean;
  /** Shown in UI intake + assistant clarify message */
  briefPrompt?: string;
  caveat?: string;
};

export const CONTENT_PLAYBOOK: ContentPlay[] = [
  {
    id: 'countdown',
    label: 'Countdown',
    shortLabel: 'Countdown',
    description: 'T‑minus urgency for a launch, sale, or event',
    why: 'Builds anticipation without a hard sell',
    format: 'story',
    postType: 'countdown',
    channels: ['instagram', 'linkedin'],
    brandTypes: ['both'],
    risk: 'low',
    preferredVisualMode: 'new_poster',
    visualRecipe:
      'Large bold numeral or day count as hero; clean space; date lockup; minimal supporting text; premium campaign poster quality',
    copyRecipe: 'Lead with time left; one product benefit; soft CTA. Avoid fake scarcity.',
    starterPrompt: 'Create a countdown post for our upcoming launch',
    needsDate: true,
    requiresBrief: true,
    briefPrompt:
      'What are we counting down to, and what is the exact date/time? (Optional: upload a product or event image.)',
  },
  {
    id: 'launch',
    label: 'Product launch',
    shortLabel: 'Launch',
    description: 'Ship-day announcement with clear benefit + CTA',
    why: 'Classic go-live post for awareness and clicks',
    format: 'single_image',
    postType: 'product_launch',
    channels: ['instagram', 'linkedin', 'twitter'],
    brandTypes: ['both'],
    risk: 'low',
    preferredVisualMode: 'either',
    visualRecipe: 'Hero product or UI moment; confident headline; polished lighting; no clutter',
    copyRecipe: 'What launched → why it matters → clear CTA',
    starterPrompt: 'Create a product launch announcement post',
    requiresBrief: true,
    briefPrompt:
      'What product/feature launched, and what is the one key benefit or CTA? (Optional: upload a screenshot or product image.)',
  },
  {
    id: 'update',
    label: 'Product update',
    shortLabel: 'Update',
    description: 'Changelog-style “what’s new” post',
    why: 'Keeps customers informed; strong for B2B SaaS',
    format: 'single_image',
    postType: 'update',
    channels: ['linkedin', 'twitter', 'instagram'],
    brandTypes: ['both'],
    risk: 'low',
    preferredVisualMode: 'either',
    visualRecipe: 'Clean typographic update card; optional before/after energy; professional',
    copyRecipe: '2–3 concrete changes; no fluff; invite to try or read more',
    starterPrompt: 'Create a product update / what’s new post',
    requiresBrief: true,
    briefPrompt:
      'List the real changes (2–3 bullets). Do not invent features. (Optional: upload a changelog or screenshot.)',
  },
  {
    id: 'announcement',
    label: 'Announcement',
    shortLabel: 'Announce',
    description: 'News, partnership, hiring, or milestone',
    why: 'Straightforward brand news for any channel',
    format: 'single_image',
    postType: 'announcement',
    channels: ['linkedin', 'instagram', 'twitter'],
    brandTypes: ['both'],
    risk: 'low',
    preferredVisualMode: 'either',
    visualRecipe: 'Bold headline plate; calm professional composition',
    copyRecipe: 'What happened → why it matters → next step',
    starterPrompt: 'Create a company announcement post',
    requiresBrief: true,
    briefPrompt:
      'What are we announcing, and why does it matter? (Optional: upload a related image.)',
  },
  {
    id: 'aesthetic',
    label: 'Aesthetic mood',
    shortLabel: 'Aesthetic',
    description: 'Lifestyle / mood visual with light on-image text',
    why: 'Feed-native for B2C; brand feel over hard sell',
    format: 'minimal_text',
    postType: 'aesthetic',
    channels: ['instagram'],
    brandTypes: ['b2c', 'both'],
    risk: 'low',
    preferredVisualMode: 'new_poster',
    visualRecipe:
      'Magazine-quality lifestyle or product-in-context photo; soft light; brand palette; almost no on-image copy (logo optional); caption carries the message',
    copyRecipe: 'Short evocative IG caption; light CTA; hashtags that fit lifestyle',
    starterPrompt: 'Create an aesthetic mood / lifestyle post for Instagram',
    requiresBrief: true,
    briefPrompt:
      'What is the subject or mood (product, color story, season)? Optional: upload a reference photo to match.',
  },
  {
    id: 'meme',
    label: 'On-brand meme',
    shortLabel: 'Meme',
    description: 'Trending meme FORMAT from market → brand-blended joke (IP-safe recreation)',
    why: 'Reach and shares when humor rides a format people already recognize',
    format: 'meme',
    postType: 'meme_safe',
    channels: ['instagram', 'twitter'],
    brandTypes: ['b2c', 'both'],
    risk: 'medium',
    preferredVisualMode: 'new_poster',
    visualRecipe:
      'Discover what’s culturally hot → pick a safe format archetype (expectation vs reality, reject/approve, waiting, etc.) → ORIGINAL comic-meme art for that structure + Impact-style captions. NEVER download copyrighted viral JPEGs or celebrity faces. NOT corporate photography.',
    copyRecipe:
      'Panel captions short enough for a meme; brand pain → brand win; never punch down; always Approvals',
    starterPrompt: 'Create a brand-safe meme using a currently trending format',
    requiresBrief: true,
    briefPrompt:
      'Optional: product/pain to ground the joke. We still pick a hot market format and blend your brand into it.',
    caveat:
      'Medium risk — review before publish. We recreate formats, we do not scrape or reuse copyrighted meme images.',
  },
  {
    id: 'offer',
    label: 'Offer / promo',
    shortLabel: 'Offer',
    description: 'Discount, bundle, or limited promo',
    why: 'Drives short-term conversion',
    format: 'single_image',
    postType: 'offer',
    channels: ['instagram', 'linkedin'],
    brandTypes: ['both'],
    risk: 'low',
    preferredVisualMode: 'either',
    visualRecipe: 'Clear offer lockup; high contrast deal line; trustworthy not spammy',
    copyRecipe: 'Offer + eligibility + urgency without false claims',
    starterPrompt: 'Create a promo / offer post',
    requiresBrief: true,
    briefPrompt:
      'What is the exact offer? Include discount/price/terms if any, product name, and end date if it has one. I will not invent % off or deals. (Optional: upload offer art or product image.)',
  },
  {
    id: 'thought_leadership',
    label: 'Thought leadership',
    shortLabel: 'Insight',
    description: 'Insight / POV post for professionals',
    why: 'Builds authority on LinkedIn',
    format: 'single_image',
    postType: 'thought_leadership',
    channels: ['linkedin', 'twitter'],
    brandTypes: ['b2b', 'both'],
    risk: 'low',
    preferredVisualMode: 'either',
    visualRecipe: 'Strong typographic quote or insight card; restrained palette',
    copyRecipe: 'Hook → insight → implication → soft CTA',
    starterPrompt: 'Create a thought-leadership insight post for LinkedIn',
    requiresBrief: true,
    briefPrompt:
      'What insight or POV should we lead with? (One sentence is enough — I will not invent industry claims.)',
  },
  {
    id: 'insight_report',
    label: 'Insight report poster',
    shortLabel: 'Report',
    description:
      'Professional multi-block social poster: big claim, 3 reasons, callout, AI background — like agency report creatives',
    why: 'Closest to complicated B2B LinkedIn/Facebook report posts without a Brand Studio template',
    format: 'single_image',
    postType: 'thought_leadership',
    channels: ['linkedin', 'instagram'],
    brandTypes: ['both'],
    risk: 'low',
    preferredVisualMode: 'new_poster',
    visualRecipe:
      'Photorealistic editorial BACKGROUND only (city, infrastructure, abstract tech metaphor). Zero readable text in the photo — typography is composited in a designed layout.',
    copyRecipe:
      'Headline with optional accent phrase → subhead → exactly 3 short points → summary → callout title/body. Captions separate for IG/LinkedIn. Never invent rankings or stats not in the user brief.',
    starterPrompt:
      'Create a professional insight report poster (multi-section graphic + captions) from my brief',
    requiresBrief: true,
    briefPrompt:
      'Paste the exact claim/stat, source if any, and 2–3 reasons why it matters. I will not invent rankings or numbers. Optional: upload a reference mood image.',
  },
  {
    id: 'festival',
    label: 'Festival / greeting',
    shortLabel: 'Greeting',
    description: 'Seasonal or cultural greeting',
    why: 'Warm brand presence on calendar moments',
    format: 'single_image',
    postType: 'festival',
    channels: ['instagram', 'linkedin'],
    brandTypes: ['both'],
    risk: 'low',
    preferredVisualMode: 'either',
    visualRecipe: 'Warm festive mood; respectful cultural cues; brand tie-in soft',
    copyRecipe: 'Sincere wish + light brand line; avoid forced sales',
    starterPrompt: 'Suggest a festival greeting post for this month',
    requiresBrief: true,
    briefPrompt:
      'Which festival or occasion, and any brand line you want included?',
  },
  {
    id: 'carousel_tips',
    label: 'Tips carousel',
    shortLabel: 'Carousel',
    description: 'Multi-slide educational swipe (outline-ready)',
    why: 'Saves & shares; great for education',
    format: 'carousel',
    postType: 'thought_leadership',
    channels: ['instagram', 'linkedin'],
    brandTypes: ['both'],
    risk: 'low',
    preferredVisualMode: 'new_poster',
    visualRecipe: 'Consistent slide system; hook slide first; CTA slide last; one idea per slide',
    copyRecipe: 'Outline 5–8 slides with titles; IG + LinkedIn captions',
    starterPrompt: 'Suggest a tips carousel outline we can post',
    requiresBrief: true,
    briefPrompt:
      'What topic should the carousel teach, and any must-include tips?',
  },
];

export type PlaySuggestion = {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  why: string;
  format: PlayFormat;
  channels: string[];
  risk: PlayRisk;
  preferredVisualMode: ContentPlay['preferredVisualMode'];
  postType: string;
  starterPrompt: string;
  caveat?: string;
  needsDate?: boolean;
  requiresBrief?: boolean;
  briefPrompt?: string;
};

export function normalizeBrandType(raw?: string | null): 'b2b' | 'b2c' {
  return String(raw || 'b2b').toLowerCase() === 'b2c' ? 'b2c' : 'b2b';
}

export function playsForBrandType(brandType?: string | null): ContentPlay[] {
  const bt = normalizeBrandType(brandType);
  return CONTENT_PLAYBOOK.filter(
    (p) => p.brandTypes.includes('both') || p.brandTypes.includes(bt),
  );
}

export function getPlay(id?: string | null): ContentPlay | undefined {
  if (!id) return undefined;
  return CONTENT_PLAYBOOK.find((p) => p.id === id || p.postType === id);
}

export function playbookPromptBlock(brandType?: string | null): string {
  const plays = playsForBrandType(brandType);
  return plays
    .map(
      (p) =>
        `- id=${p.id} | ${p.label} | format=${p.format} | risk=${p.risk} | channels=${p.channels.join(',')} | postType=${p.postType} | preferMode=${p.preferredVisualMode} | requiresBrief=${p.requiresBrief ? 'yes' : 'no'} | ${p.description}${p.briefPrompt ? ` | ask: ${p.briefPrompt}` : ''}${p.caveat ? ` | caveat: ${p.caveat}` : ''}`,
    )
    .join('\n');
}

export function toSuggestion(play: ContentPlay): PlaySuggestion {
  return {
    id: play.id,
    label: play.label,
    shortLabel: play.shortLabel,
    description: play.description,
    why: play.why,
    format: play.format,
    channels: play.channels,
    risk: play.risk,
    preferredVisualMode: play.preferredVisualMode,
    postType: play.postType,
    starterPrompt: play.starterPrompt,
    caveat: play.caveat,
    needsDate: play.needsDate,
    requiresBrief: play.requiresBrief,
    briefPrompt: play.briefPrompt,
  };
}

/** True when the user already gave enough real facts to generate (not just "make an offer"). */
export function playHasEnoughBrief(
  play: ContentPlay | undefined,
  message: string,
  history?: Array<{ role: string; content: string }>,
): boolean {
  if (!play?.requiresBrief) return true;
  const blob = [
    message,
    ...(history || []).slice(-8).map((m) => m.content),
  ]
    .join('\n')
    .toLowerCase();

  // Generic click / empty starters are never enough
  const genericOnly =
    /^(create|make|generate|suggest|do|run)\b.{0,80}(post|offer|promo|launch|update|countdown|meme|aesthetic|announcement|carousel)?\s*$/i.test(
      message.trim(),
    ) || message.trim().length < 24;

  if (play.id === 'offer') {
    const hasDeal =
      /\b(\d+\s*%|\d+\s*percent|off|discount|free|trial|bundle|deal|₹|\$|rs\.?\s*\d+|save\s+\d+|buy\s*1|bogo|promo\s*code|coupon)\b/i.test(
        blob,
      );
    const hasProduct = blob.length > 40 && !genericOnly;
    return hasDeal || (hasProduct && /\b(offer|promo|sale|pricing|price|plan)\b/i.test(blob) && message.trim().length > 40);
  }

  if (play.id === 'countdown') {
    return /\b(20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|tomorrow|friday|monday|tuesday|wednesday|thursday|saturday|sunday|\d+\s*days?|launch\s+on|goes\s+live)\b/i.test(
      blob,
    ) && message.trim().length > 20;
  }

  if (play.id === 'launch' || play.id === 'update' || play.id === 'announcement') {
    return message.trim().length >= 40 && !genericOnly;
  }

  if (play.id === 'meme' || play.id === 'aesthetic' || play.id === 'thought_leadership' || play.id === 'festival' || play.id === 'carousel_tips' || play.id === 'insight_report') {
    return message.trim().length >= 36 && !genericOnly;
  }

  return message.trim().length >= 40 && !genericOnly;
}

export function suggestionsForBrand(brandType?: string | null): PlaySuggestion[] {
  return playsForBrandType(brandType).map(toSuggestion);
}

/** Prefer 4–6 contextual picks; fall back to full filtered list */
export function resolveSuggestions(
  brandType: string | null | undefined,
  idsFromLlm: unknown,
): PlaySuggestion[] {
  const allowed = playsForBrandType(brandType);
  const byId = new Map(allowed.map((p) => [p.id, p]));
  const ids = Array.isArray(idsFromLlm)
    ? idsFromLlm
        .map((x) => {
          if (typeof x === 'string') return x;
          if (x && typeof x === 'object' && 'id' in x) return String((x as { id: unknown }).id);
          return '';
        })
        .filter(Boolean)
    : [];

  const picked: ContentPlay[] = [];
  for (const id of ids) {
    const p = byId.get(id);
    if (p && !picked.find((x) => x.id === p.id)) picked.push(p);
  }

  if (picked.length >= 3) return picked.slice(0, 6).map(toSuggestion);

  // Fill from defaults: prioritize by brand type
  const bt = normalizeBrandType(brandType);
  const preferredOrder =
    bt === 'b2c'
      ? ['aesthetic', 'countdown', 'launch', 'meme', 'offer', 'insight_report', 'carousel_tips', 'festival', 'update']
      : ['insight_report', 'launch', 'update', 'thought_leadership', 'announcement', 'countdown', 'carousel_tips', 'offer', 'festival'];

  for (const id of preferredOrder) {
    const p = byId.get(id);
    if (p && !picked.find((x) => x.id === p.id)) picked.push(p);
    if (picked.length >= 5) break;
  }
  return picked.map(toSuggestion);
}
