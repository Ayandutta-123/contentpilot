import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { LLMService, buildSystemPrompt } from './llm.service';
import {
  type CustomPlanEntry,
  filterPlanForMonth,
} from './calendar-plan.service';
import { listFestivalEvents } from '../data/festival-calendar';
import { countryLabels, normalizeTargetCountries } from '../lib/market-countries';

export type CalendarAiPrefs = {
  year: number;
  month: number;
  /** Free-text suggestions from the user */
  suggestions: string;
  /** Selected content types, e.g. thought_leadership, carousel, offer */
  contentTypes: string[];
  /** Target posts for the month (approx) */
  postsPerMonth: number;
  /** How many of those should be carousels */
  carouselCount: number;
  /** Preferred carousel slide count */
  carouselSlides: number;
  /** Preferred weekdays 0=Sun … 6=Sat; empty = any */
  preferredWeekdays: number[];
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  thought_leadership: 'Thought leadership / POV',
  carousel: 'Educational carousel',
  offer: 'Offer / CTA',
  product: 'Product / feature highlight',
  culture: 'Culture / behind the scenes',
  festival: 'Festival / seasonal',
  competitor_response: 'Market / competitor-informed angle',
  newsletter_teaser: 'Newsletter / long-form teaser',
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

async function loadPlannerContext(tenantId: string, year: number, month: number) {
  const [brand, topics, competitors, scraped] = await Promise.all([
    prisma.brandSettings.findUnique({ where: { tenantId } }),
    prisma.topic.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      orderBy: { rotationOrder: 'asc' },
      take: 20,
      select: { name: true, searchKeywords: true },
    }),
    prisma.competitor.findMany({
      where: { tenantId, deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
      take: 12,
      select: { name: true, handle: true, platform: true },
    }),
    prisma.scrapedCompetitorPost.findMany({
      where: { competitor: { tenantId, deletedAt: null, isActive: true } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        content: true,
        platform: true,
        competitor: { select: { name: true } },
      },
    }),
  ]);

  if (!brand?.companyName?.trim()) {
    throw new Error('Set company name in Settings → Company before creating an AI calendar.');
  }

  const festivals = listFestivalEvents({ year, month })
    .slice(0, 10)
    .map((f) => ({
      date: f.date,
      name: f.name,
      region: f.region,
      category: f.category,
      hint: f.promptHints.slice(0, 80),
    }));

  const markets = normalizeTargetCountries(brand.targetCountries);
  const scrapedLines = scraped.map((p) => {
    const snippet = (p.content || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    return `- ${p.competitor.name} (${p.platform}): ${snippet || '(media post)'}`;
  });

  return {
    brand,
    markets,
    topics,
    competitors,
    scrapedLines,
    festivals,
    systemPrompt: buildSystemPrompt({
      companyName: brand.companyName,
      productName: brand.productName || undefined,
      productTagline: brand.productTagline || undefined,
      industry: brand.industry || undefined,
      brandType: brand.brandType || undefined,
      brandVoice: brand.brandVoice || '',
      imageStyle: brand.imageStyle || '',
      hashtagStrategy: brand.hashtagStrategy || '',
      contentGuidelines: brand.contentGuidelines || '',
      targetAudience: brand.targetAudience || '',
      targetCountries: brand.targetCountries as string[] | null,
    }),
  };
}

function normalizeEntries(
  raw: unknown,
  year: number,
  month: number,
): CustomPlanEntry[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: CustomPlanEntry[] = [];
  const prefix = `${year}-${pad(month)}-`;
  const maxDay = daysInMonth(year, month);

  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    let date = String(r.date || '').trim();
    if (/^\d{1,2}$/.test(date)) {
      const day = Number(date);
      if (day >= 1 && day <= maxDay) date = `${prefix}${pad(day)}`;
    }
    if (!date.startsWith(prefix)) continue;
    const day = Number(date.slice(8, 10));
    if (!Number.isFinite(day) || day < 1 || day > maxDay) continue;

    const title = String(r.title || '').trim().slice(0, 180);
    if (title.length < 2) continue;

    const theme = String(r.theme || '').trim().slice(0, 240);
    const notes = String(r.notes || '').trim().slice(0, 4000);
    const hashtags = Array.isArray(r.hashtags)
      ? r.hashtags.map((h) => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 12)
      : String(r.hashtags || '')
          .split(/[,\s]+/)
          .map((h) => h.replace(/^#/, '').trim())
          .filter(Boolean)
          .slice(0, 12);

    let carouselSlideCount: number | null = null;
    const format = String(r.format || '').trim();
    const slidesRaw = r.carouselSlideCount ?? r.slides;
    if (typeof slidesRaw === 'number' && slidesRaw >= 3 && slidesRaw <= 12) {
      carouselSlideCount = Math.round(slidesRaw);
    } else if (/carousel/i.test(format) || /carousel/i.test(theme) || /carousel/i.test(notes)) {
      const m = format.match(/(\d+)\s*slides?/i) || notes.match(/(\d+)\s*slides?/i);
      carouselSlideCount = m ? Math.min(12, Math.max(3, Number(m[1]))) : 6;
    }

    const formatNote = format
      ? `Format: ${format}${carouselSlideCount ? ` (${carouselSlideCount} slides)` : ''}.`
      : carouselSlideCount
        ? `Format: Carousel (${carouselSlideCount} slides).`
        : '';

    out.push({
      id: randomUUID(),
      date,
      title,
      theme,
      notes: [notes, formatNote].filter(Boolean).join('\n').trim(),
      hashtags,
      carouselSlideCount,
    });
  }

  return filterPlanForMonth(out, year, month).sort((a, b) => a.date.localeCompare(b.date));
}

function prefsBlock(prefs: CalendarAiPrefs): string {
  const types =
    prefs.contentTypes.length > 0
      ? prefs.contentTypes.map((t) => CONTENT_TYPE_LABELS[t] || t).join(', ')
      : 'mixed professional social posts';
  const days =
    prefs.preferredWeekdays.length > 0
      ? prefs.preferredWeekdays
          .map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d] || String(d))
          .join(', ')
      : 'any weekday that fits the brand';
  return `
PLANNING PREFERENCES (must obey):
- Month: ${prefs.year}-${pad(prefs.month)}
- Target about ${prefs.postsPerMonth} posts this month (may be ±2 if needed for quality)
- About ${prefs.carouselCount} of them must be carousels with ~${prefs.carouselSlides} slides each
- Content mix focus: ${types}
- Prefer posting on: ${days}
- User suggestions: ${prefs.suggestions.trim() || '(none — invent a strong professional mix from brand + topics only)'}
`;
}

function contextBlock(ctx: Awaited<ReturnType<typeof loadPlannerContext>>): string {
  const topicLines = ctx.topics.length
    ? ctx.topics
        .map((t) => `- ${t.name}${t.searchKeywords ? ` (${String(t.searchKeywords).slice(0, 60)})` : ''}`)
        .join('\n')
    : '- (no active topics in Settings)';
  const compLines = ctx.competitors.length
    ? ctx.competitors.map((c) => `- ${c.name} @${c.handle} (${c.platform})`).join('\n')
    : '- (no active competitors in Settings)';
  const festLines = ctx.festivals.length
    ? ctx.festivals.map((f) => `- ${f.date}: ${f.name}`).join('\n')
    : '- (no catalog festivals this month)';
  const scrape = ctx.scrapedLines.length
    ? ctx.scrapedLines.join('\n')
    : '- (no recent scraped competitor posts)';

  return `
GROUNDED DATA (do NOT invent company facts):
- Company: ${ctx.brand.companyName}
- Product: ${ctx.brand.productName || '—'}
- Industry: ${ctx.brand.industry || '—'}
- Markets: ${countryLabels(ctx.markets) || 'worldwide'}
- Audience: ${(ctx.brand.targetAudience || '').slice(0, 220) || '—'}
- Voice: ${(ctx.brand.brandVoice || '').slice(0, 220) || '—'}
- Guidelines: ${(ctx.brand.contentGuidelines || '').slice(0, 280) || '—'}

TOPICS:
${topicLines}

COMPETITORS:
${compLines}

COMPETITOR SNIPPETS (inspiration only):
${scrape}

FESTIVALS THIS MONTH (optional):
${festLines}
`;
}

export async function generateAiCalendarPlan(
  tenantId: string,
  prefs: CalendarAiPrefs,
): Promise<{ entries: CustomPlanEntry[]; summary: string }> {
  const ctx = await loadPlannerContext(tenantId, prefs.year, prefs.month);
  const llm = await LLMService.forTenant(tenantId);

  // Keep output compact so the model does not truncate mid-JSON (common with 12+ long notes).
  const targetPosts = Math.min(Math.max(prefs.postsPerMonth, 4), 24);
  const carousels = Math.min(prefs.carouselCount, targetPosts);

  const userPrompt = `Create a month content calendar. Return ONE compact JSON object only.

${prefsBlock({ ...prefs, postsPerMonth: targetPosts, carouselCount: carousels })}
${contextBlock(ctx)}

Schema:
{"summary":"short overview","entries":[{"date":"YYYY-MM-DD","title":"max 70 chars","theme":"max 40 chars","notes":"max 100 chars","hashtags":["Tag"],"format":"Single image|Carousel (N slides)","carouselSlideCount":null}]}

HARD LIMITS (prevent truncated JSON):
- Exactly ${targetPosts} entries (±1 ok)
- title ≤ 70 characters, theme ≤ 40, notes ≤ 100
- hashtags: 2–4 short tags, no #
- No newlines inside strings; no markdown
- Dates must be in ${prefs.year}-${pad(prefs.month)}
- Spread across the month; ~${carousels} carousels with carouselSlideCount=${prefs.carouselSlides}
- Ground facts in data above only
`;

  const json = await llm.generateRawJson({
    systemPrompt: `You plan monthly social calendars for ${ctx.brand.companyName || 'the brand'}.
Output valid compact JSON only. Prefer short fields so the response never truncates.`,
    userPrompt,
    job: 'caption',
    maxTokens: 8192,
    maxRetries: 3,
  });

  const entries = normalizeEntries(json.entries, prefs.year, prefs.month);
  if (entries.length === 0) {
    throw new Error('AI returned no valid calendar rows for this month. Try again with clearer preferences.');
  }

  return {
    entries,
    summary: String(json.summary || `Draft calendar with ${entries.length} ideas.`).slice(0, 400),
  };
}

export async function reviseAiCalendarPlan(
  tenantId: string,
  opts: {
    year: number;
    month: number;
    entries: CustomPlanEntry[];
    instruction: string;
    prefs?: Partial<CalendarAiPrefs>;
  },
): Promise<{ entries: CustomPlanEntry[]; summary: string }> {
  const instruction = opts.instruction.trim();
  if (instruction.length < 2) {
    throw new Error('Tell the assistant what to change.');
  }
  const ctx = await loadPlannerContext(tenantId, opts.year, opts.month);
  const llm = await LLMService.forTenant(tenantId);

  const current = opts.entries.map((e) => ({
    date: e.date,
    title: e.title.slice(0, 70),
    theme: (e.theme || '').slice(0, 40),
    notes: (e.notes || '').slice(0, 100),
    hashtags: (e.hashtags || []).slice(0, 4),
    carouselSlideCount: e.carouselSlideCount ?? null,
  }));

  const userPrompt = `Revise this content calendar. Return ONE compact JSON object only.

Month: ${opts.year}-${pad(opts.month)}
Instruction: ${instruction.slice(0, 800)}

Current entries (JSON):
${JSON.stringify(current)}

${contextBlock(ctx)}

Schema: {"summary":"what changed","entries":[{"date","title","theme","notes","hashtags","format","carouselSlideCount"}]}
HARD LIMITS: title≤70, theme≤40, notes≤100, 2–4 hashtags, no newlines in strings, no markdown.
Keep dates in ${opts.year}-${pad(opts.month)}. Ground facts in data above only.
`;

  const json = await llm.generateRawJson({
    systemPrompt: `You revise monthly social calendars. Output valid compact JSON only.`,
    userPrompt,
    job: 'caption',
    maxTokens: 8192,
    maxRetries: 3,
  });

  const entries = normalizeEntries(json.entries, opts.year, opts.month);
  if (entries.length === 0) {
    throw new Error('Revision produced no valid rows. Try a clearer instruction.');
  }

  return {
    entries,
    summary: String(json.summary || 'Calendar updated.').slice(0, 400),
  };
}

export { CONTENT_TYPE_LABELS };
