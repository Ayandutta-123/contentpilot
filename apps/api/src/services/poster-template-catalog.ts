/**
 * Poster templates — three designed layouts per playbook format.
 *
 * A template is a hard contract, not a hint: it fixes the render layout, which
 * copy blocks may exist, and how long each one is. The LLM is told the contract
 * in the prompt AND the result is clamped to it afterwards, so a chosen
 * template always produces the layout the user picked in the UI.
 *
 * Colours and fonts are never part of a template — those always come from the
 * Brand Kit in Settings, so the same template looks like each tenant's brand.
 */

import type { PosterLayoutId, PosterPillar, PosterSpec } from '../providers/images/poster-frame';
import { CONTENT_PLAYBOOK } from './content-playbook.service';

/** required = must be written, optional = write only if the brief supports it, omit = never render. */
export type PosterBlockRule = 'required' | 'optional' | 'omit';

export type PosterTemplateBlocks = {
  eyebrow: PosterBlockRule;
  subhead: PosterBlockRule;
  /** Exact number of icon pillars this layout renders. 0 = none. */
  pillars: 0 | 2 | 3;
  stat: PosterBlockRule;
  callout: PosterBlockRule;
  closing: PosterBlockRule;
  footer: PosterBlockRule;
};

export type PosterTemplate = {
  id: string;
  /** Playbook format this template belongs to (content-playbook.service). */
  playId: string;
  label: string;
  tagline: string;
  layout: PosterLayoutId;
  /**
   * When layout is uploaded_master, which engine fills the plate
   * (sale_circles / sale_split / uploaded_master composite).
   */
  fillLayout?: PosterLayoutId;
  blocks: PosterTemplateBlocks;
  /** Headline length budget, in words. */
  headlineWords: [number, number];
  /** Copy rules injected verbatim into the art-director prompt. */
  copyRules: string[];
  /** Hero art direction injected verbatim into the image prompt. */
  artDirection: string;
  /** Which block the accent colour should carry — drives the UI thumbnail. */
  accentRole: 'stat' | 'headline' | 'band' | 'rule';
  /** Exact uploaded master preview (picker shows this image). */
  previewUrl?: string;
  /** Same as preview for uploads — base plate for generation. */
  sourceImageUrl?: string;
  origin?: 'upload' | 'builtin';
};

const EMPTY: PosterTemplateBlocks = {
  eyebrow: 'omit',
  subhead: 'omit',
  pillars: 0,
  stat: 'omit',
  callout: 'omit',
  closing: 'omit',
  footer: 'omit',
};

function blocks(overrides: Partial<PosterTemplateBlocks>): PosterTemplateBlocks {
  return { ...EMPTY, ...overrides };
}

export const POSTER_TEMPLATES: PosterTemplate[] = [
  // ---------------------------------------------------------------- countdown
  {
    id: 'countdown_ticker',
    playId: 'countdown',
    label: 'Ticker',
    tagline: 'Giant day count centred over full-bleed art',
    layout: 'center_stage',
    blocks: blocks({ eyebrow: 'required', stat: 'required', closing: 'required' }),
    headlineWords: [4, 9],
    copyRules: [
      'statValue is the countdown itself — "3 DAYS", "48 HRS", or the launch date. Never invent a date the brief did not give.',
      'statLabel names what is being counted down to, max 6 words.',
      'eyebrow is the campaign or product name in caps, 2-4 words.',
      'closingLine is a soft CTA — no fake scarcity, no "hurry now".',
    ],
    artDirection:
      'One dramatic, uncluttered hero scene with a dark calm centre so large centred type stays readable. Cinematic single light source, deep negative space, no props crowding the middle.',
    accentRole: 'stat',
  },
  {
    id: 'countdown_datecard',
    playId: 'countdown',
    label: 'Date card',
    tagline: 'Hard split: art on top, date block beneath an accent keyline',
    layout: 'split_band',
    blocks: blocks({
      eyebrow: 'required',
      subhead: 'required',
      stat: 'required',
      closing: 'optional',
    }),
    headlineWords: [5, 11],
    copyRules: [
      'statValue is the exact date or day count from the brief, written short ("12 MAR", "T-5").',
      'subhead says what happens on that date in one concrete sentence.',
      'Do not promise features or pricing the brief did not state.',
    ],
    artDirection:
      'Editorial product or event photography that reads well cropped to a wide top band. Clean horizon, subject slightly off-centre, no text or signage.',
    accentRole: 'band',
  },
  {
    id: 'countdown_agenda',
    playId: 'countdown',
    label: 'Agenda',
    tagline: 'Art column left, date plus three "what is coming" points right',
    layout: 'editorial_left',
    blocks: blocks({
      eyebrow: 'required',
      subhead: 'required',
      pillars: 3,
      closing: 'optional',
    }),
    headlineWords: [5, 12],
    copyRules: [
      'The three pillars are what the audience gets on launch day — one concrete item each, never restating the headline.',
      'eyebrow carries the date or day count.',
      'Every pillar must come from the brief. If the brief only supports two real items, repeat nothing — write a narrower third from the same facts.',
    ],
    artDirection:
      'Vertical-friendly hero image: a single subject filling a tall left column, shallow depth of field, calm right edge so it can fade into the brand ground.',
    accentRole: 'rule',
  },

  // ------------------------------------------------------------------- launch
  {
    id: 'launch_feature_hero',
    playId: 'launch',
    label: 'Feature hero',
    tagline: 'Hero art right, headline plus three feature pillars left',
    layout: 'hero_right',
    blocks: blocks({
      eyebrow: 'required',
      subhead: 'required',
      pillars: 3,
      closing: 'optional',
    }),
    headlineWords: [6, 14],
    copyRules: [
      'Each pillar is one real capability that shipped, written as a benefit — never marketing filler.',
      'eyebrow is the product or release name.',
      'Never invent features, integrations, or availability dates that are not in the brief.',
    ],
    artDirection:
      'Hero product or interface moment photographed in context, lit like a launch film still. Calm left side, no readable UI text, no mockup frames.',
    accentRole: 'headline',
  },
  {
    id: 'launch_spotlight',
    playId: 'launch',
    label: 'Spotlight',
    tagline: 'Full-bleed art, one centred claim and a CTA',
    layout: 'center_stage',
    blocks: blocks({ eyebrow: 'required', subhead: 'required', closing: 'required' }),
    headlineWords: [4, 10],
    copyRules: [
      'One claim only. If the brief lists several features, pick the strongest and drop the rest.',
      'subhead is a single supporting sentence, max 18 words.',
      'closingLine is the CTA, 3-7 words.',
    ],
    artDirection:
      'Single hero subject, centred composition, dramatic rim lighting against a deep background. Nothing in the middle third that competes with centred type.',
    accentRole: 'headline',
  },
  {
    id: 'launch_dossier',
    playId: 'launch',
    label: 'Dossier',
    tagline: 'Magazine split with a proof stat and a callout',
    layout: 'editorial_left',
    blocks: blocks({
      eyebrow: 'required',
      subhead: 'required',
      stat: 'optional',
      callout: 'required',
      closing: 'optional',
    }),
    headlineWords: [6, 14],
    copyRules: [
      'calloutTitle + calloutBody carry the "why it matters" argument, not a feature list.',
      'Only fill statValue when the brief contains a real number. Leave it empty otherwise — never invent a metric.',
    ],
    artDirection:
      'Tall editorial photograph of the product in real use, natural light, documentary feel. Subject on the left, right side quiet.',
    accentRole: 'rule',
  },

  // ------------------------------------------------------------------- update
  {
    id: 'update_changelog',
    playId: 'update',
    label: 'Changelog',
    tagline: 'Art band on top, three shipped changes underneath',
    layout: 'hero_top',
    blocks: blocks({
      eyebrow: 'required',
      subhead: 'optional',
      pillars: 3,
      footer: 'optional',
    }),
    headlineWords: [4, 10],
    copyRules: [
      'Exactly three pillars, each one real change from the brief, phrased as "what changed → what it unlocks".',
      'eyebrow is the release label ("Release 2.4", "March update").',
      'Never pad with invented changes. Reuse the brief only.',
    ],
    artDirection:
      'Abstract but believable scene suggesting progress or craft — workshop detail, layered materials, studio light. Reads well as a wide top band, no text.',
    accentRole: 'rule',
  },
  {
    id: 'update_ledger',
    playId: 'update',
    label: 'Ledger',
    tagline: 'Art column left, itemised change list right',
    layout: 'editorial_left',
    blocks: blocks({ eyebrow: 'required', pillars: 3, footer: 'optional' }),
    headlineWords: [4, 10],
    copyRules: [
      'Three pillars, terse and technical. Title = the area changed, text = the concrete change.',
      'footerNote can point to docs or a changelog if the brief mentions one, otherwise leave it empty.',
    ],
    artDirection:
      'Quiet macro detail — machined surface, layered paper, structured grid of real objects. Tall crop, calm right edge, no text.',
    accentRole: 'rule',
  },
  {
    id: 'update_headline',
    playId: 'update',
    label: 'Headline card',
    tagline: 'Split card for a single notable change',
    layout: 'split_band',
    blocks: blocks({ eyebrow: 'required', subhead: 'required', closing: 'optional' }),
    headlineWords: [5, 12],
    copyRules: [
      'Use this for ONE change only. Name it in the headline and explain the impact in the subhead.',
      'No bullet lists, no feature roll-ups.',
    ],
    artDirection:
      'Clean product-in-context photo with a strong horizontal composition. Subject in the upper half, nothing important near the bottom edge.',
    accentRole: 'band',
  },

  // ------------------------------------------------------------- announcement
  {
    id: 'announce_banner',
    playId: 'announcement',
    label: 'Banner',
    tagline: 'Wide art band over a bold announcement plate',
    layout: 'split_band',
    blocks: blocks({ eyebrow: 'required', subhead: 'required', closing: 'required' }),
    headlineWords: [5, 13],
    copyRules: [
      'Headline states the news plainly — who, what. No teasing.',
      'subhead gives the one reason it matters to the reader.',
      'closingLine is the next step (read more, join, apply).',
    ],
    artDirection:
      'Confident corporate-editorial scene: real people or real place, natural light, documentary framing. Strong upper composition, no signage or logos.',
    accentRole: 'band',
  },
  {
    id: 'announce_stage',
    playId: 'announcement',
    label: 'Stage',
    tagline: 'Full-bleed art with the news centred',
    layout: 'center_stage',
    blocks: blocks({ eyebrow: 'required', subhead: 'required', closing: 'optional' }),
    headlineWords: [4, 10],
    copyRules: [
      'Short and ceremonial. The headline is the announcement itself.',
      'Never dramatise beyond the facts in the brief.',
    ],
    artDirection:
      'Cinematic wide scene with a calm centre — venue interior, skyline, or open workspace. Deep background, one light direction, no text.',
    accentRole: 'headline',
  },
  {
    id: 'announce_brief',
    playId: 'announcement',
    label: 'Brief',
    tagline: 'Hero art right, statement plus context callout left',
    layout: 'hero_right',
    blocks: blocks({
      eyebrow: 'required',
      subhead: 'required',
      callout: 'required',
      footer: 'optional',
    }),
    headlineWords: [6, 14],
    copyRules: [
      'calloutTitle + calloutBody give the background or quote-style context for the news.',
      'footerNote can hold the date or a source line if the brief supplies one.',
    ],
    artDirection:
      'Editorial photograph of the subject of the news — place, team, or object — in warm natural light. Right-weighted composition, left side calm.',
    accentRole: 'headline',
  },

  // ---------------------------------------------------------------- aesthetic
  {
    id: 'aesthetic_whisper',
    playId: 'aesthetic',
    label: 'Whisper',
    tagline: 'Almost no type — the photograph carries the post',
    layout: 'center_stage',
    blocks: blocks({ closing: 'optional' }),
    headlineWords: [2, 6],
    copyRules: [
      'Headline is 2-6 words of mood, not a sales line.',
      'Write no subhead, no stat, no pillars — the caption carries the message.',
      'closingLine, if used, is a single quiet phrase of 2-5 words.',
    ],
    artDirection:
      'Magazine-quality lifestyle photograph: soft directional daylight, film grain, muted palette, generous empty space. The image is the post.',
    accentRole: 'headline',
  },
  {
    id: 'aesthetic_frame',
    playId: 'aesthetic',
    label: 'Frame',
    tagline: 'Tall image left, quiet editorial caption right',
    layout: 'editorial_left',
    blocks: blocks({ eyebrow: 'required', subhead: 'required' }),
    headlineWords: [3, 8],
    copyRules: [
      'eyebrow is a one-word mood or collection label.',
      'subhead is one evocative sentence, max 16 words. No CTA, no hashtags on the image.',
    ],
    artDirection:
      'Tall lifestyle still with a single subject and painterly light. Shallow depth of field, calm right edge, no props near the fade.',
    accentRole: 'rule',
  },
  {
    id: 'aesthetic_band',
    playId: 'aesthetic',
    label: 'Band',
    tagline: 'Image band on top, one line of mood beneath',
    layout: 'hero_top',
    blocks: blocks({ subhead: 'optional', closing: 'optional' }),
    headlineWords: [3, 8],
    copyRules: [
      'Keep all on-image copy under 20 words total across every block.',
      'No product claims, no pricing, no urgency language.',
    ],
    artDirection:
      'Wide lifestyle or texture photograph with a horizon or strong horizontal rhythm. Soft light, restrained colour, no text.',
    accentRole: 'rule',
  },

  // --------------------------------------------------------------------- meme
  {
    id: 'meme_setup_punch',
    playId: 'meme',
    label: 'Setup / punch',
    tagline: 'Centred setup line over the art, punchline below',
    layout: 'center_stage',
    blocks: blocks({ closing: 'required' }),
    headlineWords: [3, 12],
    copyRules: [
      'headline is the setup, closingLine is the punchline. Both short enough to read at a glance.',
      'Original joke and original art only — never reference a copyrighted meme image or a real person.',
      'Never punch down. The brand is the butt of the joke, not the customer.',
    ],
    artDirection:
      'Original illustrated comic-style scene built for this joke — flat shapes, expressive characters, bold colour blocking. Not stock photography, not a recreated viral image, no celebrity likeness, no text in the art.',
    accentRole: 'headline',
  },
  {
    id: 'meme_caption_band',
    playId: 'meme',
    label: 'Caption band',
    tagline: 'Comic panel on top, caption plate underneath',
    layout: 'hero_top',
    blocks: blocks({ eyebrow: 'required', subhead: 'required' }),
    headlineWords: [4, 12],
    copyRules: [
      'eyebrow labels the situation ("Every sprint review").',
      'headline is the joke, subhead is the brand turn — one line, no hard sell.',
      'Original art and original wording only.',
    ],
    artDirection:
      'Original comic panel illustration, thick outlines, saturated flat colour, clear single gag readable as a wide band. No text drawn in the art.',
    accentRole: 'band',
  },
  {
    id: 'meme_split_takes',
    playId: 'meme',
    label: 'Two takes',
    tagline: 'Split plate for an expectation-versus-reality beat',
    layout: 'split_band',
    blocks: blocks({ subhead: 'required', closing: 'optional' }),
    headlineWords: [3, 10],
    copyRules: [
      'headline is the expectation, subhead is the reality. Keep both under 12 words.',
      'Original format recreation only — no copyrighted template art, no real faces.',
    ],
    artDirection:
      'Original illustrated scene with an obvious contrast built into the composition. Flat graphic style, bold colour, no lettering.',
    accentRole: 'band',
  },

  // -------------------------------------------------------------------- offer
  {
    id: 'offer_sale_circles',
    playId: 'offer',
    label: 'Circle cutouts',
    tagline: 'Exact Magnific layout — SALE lockup, mustard arc, circular photos, Brand Kit colours',
    layout: 'sale_circles',
    blocks: blocks({
      eyebrow: 'required',
      stat: 'required',
      subhead: 'required',
      closing: 'required',
      footer: 'required',
    }),
    headlineWords: [2, 5],
    copyRules: [
      'eyebrow is the kicker word only — SALE, DEAL, or OFFER — never a sentence.',
      'headline is a short product or collection name, 2-5 words max ("New Collections", "AI Video Studio"). Never a long sentence.',
      'statValue is the exact offer number from the brief ("25%", "₹999"). If the brief has no number, this template must not be used — say so instead of inventing one.',
      'statLabel is empty or a short bonus line ("Sale Bonus") — never repeat OFF.',
      'subhead is one short supporting sentence (max ~18 words) about what the offer applies to.',
      'closingLine is a short CTA of 1-3 words ("Shop Now", "Get Offer"). Never a full sentence.',
      'footerNote is the website or handle, no invented URL.',
      'No invented urgency, no fake original prices.',
    ],
    artDirection:
      'Retail fashion or product photography of people or items, bright even light, uncluttered background, no lettering, no logos, no price tags. Faces and products must crop cleanly inside a circle.',
    accentRole: 'stat',
  },
  {
    id: 'offer_sale_split',
    playId: 'offer',
    label: 'Split offer',
    tagline: 'Exact Magnific layout — type left, shopper photo right, framed in Brand Kit accent',
    layout: 'sale_split',
    blocks: blocks({
      eyebrow: 'optional',
      stat: 'required',
      callout: 'optional',
      closing: 'required',
      footer: 'required',
    }),
    headlineWords: [3, 8],
    copyRules: [
      'headline is the offer name with the deal word inside it ("Big Sale Offer"). headlineAccent is that deal word (Sale / Deal / Off).',
      'eyebrow is the brand tagline if the brief has one, else empty.',
      'statValue is the exact offer number from the brief ("75%"). If the brief has no number, this template must not be used.',
      'closingLine is the CTA ("Order Now").',
      'calloutBody is a real phone number only if the brief supplied one, else empty.',
      'footerNote is the website or handle from the brief or Brand Kit, never invented.',
      'Never state a discount percentage that is not in the brief.',
    ],
    artDirection:
      'Lifestyle shopper or product in a real store or studio, vertical crop, subject on the right third, soft retail lighting, no lettering, no logos, no price tags.',
    accentRole: 'headline',
  },
  {
    id: 'offer_stage',
    playId: 'offer',
    label: 'Stage',
    tagline: 'Full-bleed art with the offer centred',
    layout: 'center_stage',
    blocks: blocks({ stat: 'required', closing: 'required', footer: 'optional' }),
    headlineWords: [3, 9],
    copyRules: [
      'statValue is the offer, headline is what it applies to, closingLine is the CTA.',
      'Keep total on-image copy under 25 words.',
      'footerNote holds terms if the brief gave any.',
    ],
    artDirection:
      'Single hero product centred against a deep gradient background, studio lighting, strong reflection or shadow. Nothing else in frame, no text.',
    accentRole: 'stat',
  },

  // ------------------------------------------------------- thought_leadership
  {
    id: 'insight_quote',
    playId: 'thought_leadership',
    label: 'Quote',
    tagline: 'One strong POV centred over full-bleed art',
    layout: 'center_stage',
    blocks: blocks({ eyebrow: 'required', closing: 'optional', footer: 'optional' }),
    headlineWords: [8, 18],
    copyRules: [
      'The headline IS the opinion — a complete, arguable sentence, not a topic label.',
      'eyebrow is the subject area, 2-4 words.',
      'footerNote may hold an attribution if the brief names a person.',
      'Never invent industry statistics.',
    ],
    artDirection:
      'Restrained abstract or architectural photograph with deep shadow and a calm centre. Monochrome-leaning palette, one light direction, no text.',
    accentRole: 'headline',
  },
  {
    id: 'insight_three_reasons',
    playId: 'thought_leadership',
    label: 'Three reasons',
    tagline: 'Hero art right, argument broken into three pillars',
    layout: 'hero_right',
    blocks: blocks({
      eyebrow: 'required',
      subhead: 'required',
      pillars: 3,
      closing: 'optional',
    }),
    headlineWords: [7, 15],
    copyRules: [
      'Exactly three pillars, each a distinct reason that advances the argument. No pillar may restate the headline.',
      'subhead frames the tension the post resolves.',
      'No invented numbers, rankings, or customer names.',
    ],
    artDirection:
      'Editorial business photography with real depth — glass, structure, or workspace at a distance. Calm left third, no readable screens or signage.',
    accentRole: 'headline',
  },
  {
    id: 'insight_column',
    playId: 'thought_leadership',
    label: 'Column',
    tagline: 'Magazine split: argument left in art, analysis right',
    layout: 'editorial_left',
    blocks: blocks({
      eyebrow: 'required',
      subhead: 'required',
      callout: 'required',
      closing: 'optional',
    }),
    headlineWords: [7, 16],
    copyRules: [
      'calloutTitle + calloutBody carry the implication — what the reader should do differently.',
      'Write like an analyst, not a marketer. No adjective stacking.',
    ],
    artDirection:
      'Tall architectural or documentary photograph, high contrast, disciplined composition. Quiet right edge, no text.',
    accentRole: 'rule',
  },

  // ----------------------------------------------------------- insight_report
  {
    id: 'report_dossier',
    playId: 'insight_report',
    label: 'Dossier',
    tagline: 'The full agency layout: claim, three points, stat and callout',
    layout: 'hero_right',
    blocks: blocks({
      eyebrow: 'required',
      subhead: 'required',
      pillars: 3,
      stat: 'optional',
      callout: 'required',
    }),
    headlineWords: [8, 16],
    copyRules: [
      'Exactly three pillars, each adding new evidence.',
      'statValue only when the brief contains a real figure — otherwise leave it empty.',
      'calloutTitle + calloutBody are the takeaway, not a summary of the pillars.',
      'Never invent rankings, awards, or percentages.',
    ],
    artDirection:
      'Photoreal editorial background — city infrastructure, data centre exterior, or abstract industrial metaphor. Deep negative space on the left, zero readable text.',
    accentRole: 'headline',
  },
  {
    id: 'report_topline',
    playId: 'insight_report',
    label: 'Topline',
    tagline: 'Wide art band, headline metric, then three supporting points',
    layout: 'hero_top',
    blocks: blocks({
      eyebrow: 'required',
      pillars: 3,
      stat: 'required',
      footer: 'optional',
    }),
    headlineWords: [6, 14],
    copyRules: [
      'statValue is the single headline metric from the brief. Do not use this template without a real number.',
      'statLabel explains the metric in 4-8 words.',
      'footerNote carries the source if the brief names one.',
    ],
    artDirection:
      'Wide photoreal establishing shot with strong horizontal structure and calm sky or ceiling space. No charts, no numbers, no text.',
    accentRole: 'stat',
  },
  {
    id: 'report_column',
    playId: 'insight_report',
    label: 'Column',
    tagline: 'Tall art left, findings stacked in a right-hand column',
    layout: 'editorial_left',
    blocks: blocks({
      eyebrow: 'required',
      subhead: 'required',
      pillars: 3,
      closing: 'optional',
    }),
    headlineWords: [7, 15],
    copyRules: [
      'Three pillars, each one finding. Titles are labels, texts are the evidence.',
      'closingLine is the so-what in 6-12 words.',
      'Never invent data that is not in the brief.',
    ],
    artDirection:
      'Tall photoreal scene with vertical rhythm — facade, corridor, or stacked structure. Quiet right edge, no text.',
    accentRole: 'rule',
  },

  // ----------------------------------------------------------------- festival
  {
    id: 'festival_stage',
    playId: 'festival',
    label: 'Stage',
    tagline: 'Warm full-bleed scene with a centred greeting',
    layout: 'center_stage',
    blocks: blocks({ eyebrow: 'required', closing: 'required' }),
    headlineWords: [3, 9],
    copyRules: [
      'headline is the greeting itself. eyebrow is the occasion name.',
      'closingLine is one warm brand line — never a sales pitch.',
      'Respect the cultural meaning of the occasion. No stereotypes, no religious claims.',
    ],
    artDirection:
      'Warm festive scene with authentic cultural detail and soft golden light. Calm centre, no text, no religious symbols used decoratively.',
    accentRole: 'headline',
  },
  {
    id: 'festival_card',
    playId: 'festival',
    label: 'Greeting card',
    tagline: 'Festive art band over a clean greeting plate',
    layout: 'split_band',
    blocks: blocks({ eyebrow: 'required', subhead: 'required', closing: 'optional' }),
    headlineWords: [3, 10],
    copyRules: [
      'subhead is a sincere one-line wish, max 16 words.',
      'At most one soft brand mention. No offers unless the brief includes one.',
    ],
    artDirection:
      'Festive still life or decorated setting photographed in warm light, composed for a wide top band. Authentic details, no text.',
    accentRole: 'band',
  },
  {
    id: 'festival_editorial',
    playId: 'festival',
    label: 'Editorial',
    tagline: 'Tall festive image left, message column right',
    layout: 'editorial_left',
    blocks: blocks({ eyebrow: 'required', subhead: 'required', footer: 'optional' }),
    headlineWords: [4, 11],
    copyRules: [
      'Write the greeting as brand voice, not a generic template wish.',
      'footerNote may carry the company sign-off line.',
    ],
    artDirection:
      'Tall documentary photograph of an authentic celebration moment, warm natural light, respectful framing. Quiet right edge, no text.',
    accentRole: 'rule',
  },

  // ------------------------------------------------------------ carousel_tips
  {
    id: 'carousel_numbered',
    playId: 'carousel_tips',
    label: 'Numbered',
    tagline: 'Art band on top, numbered slide title beneath',
    layout: 'hero_top',
    blocks: blocks({ eyebrow: 'required', subhead: 'required' }),
    headlineWords: [4, 11],
    copyRules: [
      'One idea per slide. eyebrow carries the slide number or section label.',
      'subhead is the single takeaway for this slide, max 20 words.',
      'Slides must read as chapters of one story, never as separate posts.',
    ],
    artDirection:
      'Consistent visual system across slides: same lighting, palette, and camera distance. Wide band composition, no text.',
    accentRole: 'rule',
  },
  {
    id: 'carousel_bold',
    playId: 'carousel_tips',
    label: 'Bold',
    tagline: 'Full-bleed art, one big centred idea per slide',
    layout: 'center_stage',
    blocks: blocks({ closing: 'optional' }),
    headlineWords: [3, 9],
    copyRules: [
      'Headline only — the slide is one statement.',
      'closingLine may carry the swipe cue on the first and last slides.',
    ],
    artDirection:
      'Bold single-subject imagery with a calm centre, consistent palette across all slides. Cinematic light, no text.',
    accentRole: 'headline',
  },
  {
    id: 'carousel_column',
    playId: 'carousel_tips',
    label: 'Column',
    tagline: 'Art column left, tip plus three details right',
    layout: 'editorial_left',
    blocks: blocks({ eyebrow: 'required', subhead: 'required', pillars: 3 }),
    headlineWords: [4, 12],
    copyRules: [
      'Three pillars break the slide tip into concrete steps or examples.',
      'Keep the same pillar rhythm across every slide in the set.',
    ],
    artDirection:
      'Tall consistent imagery — same subject family and palette on each slide. Quiet right edge, no text.',
    accentRole: 'rule',
  },
];

export function templatesForPlay(playId?: string | null): PosterTemplate[] {
  if (!playId) return [];
  return POSTER_TEMPLATES.filter((t) => t.playId === playId);
}

export function getPosterTemplate(id?: string | null): PosterTemplate | undefined {
  if (!id) return undefined;
  return POSTER_TEMPLATES.find((t) => t.id === id);
}

/** Every playbook format must ship with exactly three layouts. */
export function assertThreeTemplatesPerPlay(): string[] {
  const missing: string[] = [];
  for (const play of CONTENT_PLAYBOOK) {
    const n = templatesForPlay(play.id).length;
    if (n !== 3) missing.push(`${play.id} has ${n} templates, expected 3`);
  }
  const unknown = [...new Set(POSTER_TEMPLATES.map((t) => t.playId))].filter(
    (id) => !CONTENT_PLAYBOOK.some((p) => p.id === id),
  );
  for (const id of unknown) missing.push(`${id} is in the catalog but not in the playbook`);
  return missing;
}

/** All templates grouped by play — powers the AI Assistant template picker. */
export function posterTemplatesByPlay(): Array<{ playId: string; templates: PosterTemplate[] }> {
  const order: string[] = [];
  for (const t of POSTER_TEMPLATES) if (!order.includes(t.playId)) order.push(t.playId);
  return order.map((playId) => ({ playId, templates: templatesForPlay(playId) }));
}

function ruleLine(name: string, rule: PosterBlockRule, spec: string): string {
  if (rule === 'omit') return `- "${name}": MUST be an empty string. This layout does not render it.`;
  if (rule === 'required') return `- "${name}": REQUIRED. ${spec}`;
  return `- "${name}": optional — only if the brief genuinely supports it, else empty string. ${spec}`;
}

/**
 * The template contract as prompt text. Paired with `applyTemplateContract`,
 * which enforces the same rules on the result whether or not the model complied.
 */
export function templateContractPrompt(t: PosterTemplate): string {
  const b = t.blocks;
  const lines = [
    `TEMPLATE LOCK — "${t.label}" (${t.id}). The user picked this template. Follow it exactly; do not redesign it.`,
    `Layout: ${t.layout}. ${t.tagline}.`,
    '',
    'BLOCK CONTRACT — every key below must appear in your JSON with exactly this treatment:',
    ruleLine('eyebrow', b.eyebrow, '2-4 words, no punctuation.'),
    `- "headline": REQUIRED, ${t.headlineWords[0]}-${t.headlineWords[1]} words.`,
    '- "headlineAccent": REQUIRED, an exact substring of headline (2-4 words or a number) to paint in the brand accent colour.',
    ruleLine('subhead', b.subhead, 'One sentence, max 22 words.'),
    b.pillars === 0
      ? '- "pillars": MUST be an empty array. This layout renders no pillars.'
      : `- "pillars": REQUIRED, exactly ${b.pillars} items, each { icon, title (2-4 words), text (12-24 words of new substance) }. No pillar may restate the headline.`,
    ruleLine('statValue', b.stat, 'Short metric only: "62%", "#2", "3 DAYS", "₹999".'),
    ruleLine('statLabel', b.stat, '4-8 words explaining the metric.'),
    ruleLine('calloutTitle', b.callout, '3-6 words.'),
    ruleLine('calloutBody', b.callout, 'One sentence, max 22 words.'),
    ruleLine('closingLine', b.closing, 'Punchy 3-12 word takeaway or CTA.'),
    ruleLine('footerNote', b.footer, 'One sober line, max 20 words.'),
    '',
    'TEMPLATE COPY RULES:',
    ...t.copyRules.map((r) => `- ${r}`),
    '',
    `TEMPLATE ART DIRECTION (fold into artPrompt): ${t.artDirection}`,
  ];
  return lines.filter((l) => l !== undefined).join('\n');
}

/** Short version for the caption/intent pass, which does not write the poster. */
export function templateCaptionHint(t: PosterTemplate): string {
  return [
    `The visual will be rendered with the "${t.label}" template (${t.tagline}).`,
    t.blocks.pillars
      ? `It shows ${t.blocks.pillars} short supporting points, so the caption should not repeat them verbatim.`
      : 'It carries very little on-image copy, so the caption must carry the message.',
    t.blocks.stat === 'required'
      ? 'It requires a real number from the brief — if the user gave none, ask instead of generating.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function clamp(value: string | undefined, rule: PosterBlockRule): string {
  if (rule === 'omit') return '';
  return (value || '').trim();
}

function clampWordCount(text: string, max: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return words.slice(0, max).join(' ');
}

const PAD_ICONS = ['bolt', 'shield', 'spark'] as const;

/** Keep the layout geometry even if the model returned too few pillars. */
function enforcePillars(
  pillars: PosterPillar[] | undefined,
  count: 0 | 2 | 3,
  spec: PosterSpec,
): PosterPillar[] {
  if (count === 0) return [];
  const kept = (pillars || [])
    .filter((p) => (p.title || '').trim() || (p.text || '').trim())
    .slice(0, count);
  if (kept.length >= count) return kept;

  const seeds = [spec.subhead, spec.calloutBody, spec.calloutTitle, spec.closingLine, spec.headline]
    .map((s) => (s || '').trim())
    .filter(Boolean);
  const used = new Set(kept.map((p) => p.title.trim().toLowerCase()));

  while (kept.length < count) {
    const i = kept.length;
    const source = seeds.find((s) => !used.has(s.split(/\s+/).slice(0, 3).join(' ').toLowerCase())) || seeds[0] || spec.headline;
    const words = source.split(/\s+/).filter(Boolean);
    const title = words.slice(0, 3).join(' ') || `Point ${i + 1}`;
    used.add(title.toLowerCase());
    kept.push({
      icon: PAD_ICONS[i] || 'spark',
      title,
      text: words.length > 3 ? words.slice(3, 22).join(' ') : source,
    });
  }
  return kept;
}

/**
 * Hard enforcement: strip blocks the template does not render and force the
 * exact pillar count, so a chosen template always renders as designed even when
 * the model returns extra or missing fields.
 */
export function applyTemplateContract(spec: PosterSpec, t: PosterTemplate): PosterSpec {
  const b = t.blocks;
  const headline = clampWordCount(spec.headline || '', t.headlineWords[1]);
  const accent = (spec.headlineAccent || '').trim();
  const statValue = clamp(spec.statValue, b.stat);

  return {
    ...spec,
    headline,
    headlineAccent:
      accent && headline.toLowerCase().includes(accent.toLowerCase()) ? accent : spec.headlineAccent,
    eyebrow: clamp(spec.eyebrow, b.eyebrow),
    subhead: clamp(spec.subhead, b.subhead),
    pillars: enforcePillars(spec.pillars, b.pillars, spec),
    statValue,
    // A stat label without a value renders as an orphan line.
    statLabel: statValue ? clamp(spec.statLabel, b.stat) : '',
    calloutTitle: clamp(spec.calloutTitle, b.callout),
    calloutBody: clamp(spec.calloutBody, b.callout),
    closingLine: clamp(spec.closingLine, b.closing),
    footerNote: clamp(spec.footerNote, b.footer),
  };
}

/** True when the template needs a hard number the brief did not supply. */
export function templateNeedsStat(t: PosterTemplate): boolean {
  return t.blocks.stat === 'required';
}
