import { ContentEngine } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';

export type AutomationScheduleType = 'once' | 'weekly';
export type AutomationJobType = 'newsletter' | 'competitor' | 'trends' | 'meme' | 'calendar';
export type AutomationTemplateMode = 'existing' | 'random' | 'none' | 'rotate';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function isValidTimeZone(tz: string): boolean {
  if (!tz?.trim()) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/** Normalize "9:00" / "09:00:00" → "09:00". */
export function normalizeWeeklyTime(weeklyTime: string): string {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(weeklyTime.trim());
  if (!match) return weeklyTime.trim();
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return weeklyTime.trim();
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Convert a naive wall-clock datetime (YYYY-MM-DDTHH:mm[:ss]) in an IANA zone to a UTC Date.
 * Uses Intl offset probing (no luxon dependency).
 */
export function zonedLocalToUtc(localDatetime: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(localDatetime.trim());
  if (!match) throw new Error('Invalid local datetime');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    throw new Error('Invalid local datetime');
  }

  const tz = timeZone?.trim() || 'UTC';
  if (!isValidTimeZone(tz)) throw new Error(`Unknown timezone: ${tz}`);

  // Treat desired wall clock as if it were UTC, then correct by the zone's offset.
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, second);
    guess += desired - asUtc;
  }
  return new Date(guess);
}

/**
 * Parse runAt: absolute ISO (Z / offset) as-is, or naive local datetime in `timezone`.
 */
export function parseRunAt(runAt: string | Date, timezone?: string | null): Date | null {
  if (runAt instanceof Date) {
    return Number.isNaN(runAt.getTime()) ? null : runAt;
  }
  const s = String(runAt).trim();
  if (!s) return null;

  // Absolute instant
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Naive wall clock → interpret in timezone
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(s)) {
    try {
      return zonedLocalToUtc(s, timezone || 'UTC');
    } catch {
      return null;
    }
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatInZone(date: Date, timeZone: string): string {
  const tz = timeZone?.trim() || 'UTC';
  try {
    const formatted = new Intl.DateTimeFormat('en-GB', {
      timeZone: isValidTimeZone(tz) ? tz : 'UTC',
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23',
    }).format(date);
    return `${formatted} (${isValidTimeZone(tz) ? tz : 'UTC'})`;
  } catch {
    return date.toISOString();
  }
}

/** Next weekly occurrence of weekday + HH:mm in IANA timezone (fallback UTC). */
export function computeNextWeeklyRunAt(
  weeklyDay: number,
  weeklyTime: string,
  timezone: string,
  after: Date = new Date(),
): Date {
  const normalized = normalizeWeeklyTime(weeklyTime);
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (!match) throw new Error('weeklyTime must be HH:mm');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59 || weeklyDay < 0 || weeklyDay > 6) {
    throw new Error('Invalid weekly day or time');
  }

  const tz = timezone?.trim() || 'UTC';
  if (!isValidTimeZone(tz)) throw new Error(`Unknown timezone: ${tz}`);

  // Search forward in 1-minute steps (bounded) until wall-clock matches
  const start = new Date(after.getTime() + 60_000);
  start.setUTCSeconds(0, 0);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    const probe = new Date(start.getTime() + i * 60_000);
    const parts = zonedParts(probe, tz);
    if (parts.weekday === weeklyDay && parts.hour === hour && parts.minute === minute) {
      return probe;
    }
  }
  throw new Error('Could not compute next weekly run');
}

function zonedParts(date: Date, timeZone: string): { weekday: number; hour: number; minute: number } {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const map = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(map.weekday || 'Sun');
    return {
      weekday: wd < 0 ? 0 : wd,
      hour: Number(map.hour || 0),
      minute: Number(map.minute || 0),
    };
  } catch {
    return {
      weekday: date.getUTCDay(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
    };
  }
}

export function computeNextRunAt(input: {
  scheduleType: AutomationScheduleType;
  runAt?: Date | string | null;
  weeklyDay?: number | null;
  weeklyTime?: string | null;
  timezone?: string | null;
  after?: Date;
}): Date | null {
  if (input.scheduleType === 'once') {
    if (!input.runAt) return null;
    return parseRunAt(input.runAt, input.timezone);
  }
  if (input.weeklyDay == null || !input.weeklyTime) return null;
  return computeNextWeeklyRunAt(
    input.weeklyDay,
    input.weeklyTime,
    input.timezone || 'UTC',
    input.after || new Date(),
  );
}

export function summarizeSchedule(row: {
  scheduleType: string;
  runAt?: Date | null;
  weeklyDay?: number | null;
  weeklyTime?: string | null;
  timezone?: string | null;
}): string {
  const tz = row.timezone || 'UTC';
  if (row.scheduleType === 'once') {
    return row.runAt ? `Once · ${formatInZone(row.runAt, tz)}` : 'Once · unset';
  }
  const day = row.weeklyDay != null ? DAY_NAMES[row.weeklyDay] || String(row.weeklyDay) : '?';
  return `Weekly · ${day} ${row.weeklyTime || '??:??'} (${tz})`;
}

function asIdArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/** Sentinel in brandTemplateIds — rotate through full AI image generation (no Brand Studio plate). */
export const ROTATE_AI_SLOT = '__ai__';

async function resolveBrandTemplateId(
  tenantId: string,
  templateMode: AutomationTemplateMode,
  brandTemplateId: string | null | undefined,
  brandTemplateIds?: unknown,
  rotateCursor = 0,
): Promise<{
  useBrandTemplate: boolean;
  brandTemplateId?: string;
  brandTemplateIds?: string[];
  nextRotateCursor?: number;
}> {
  if (templateMode === 'none') {
    return { useBrandTemplate: false };
  }

  if (templateMode === 'existing') {
    if (!brandTemplateId) return { useBrandTemplate: false };
    const found = await prisma.brandTemplate.findFirst({
      where: { id: brandTemplateId, tenantId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!found) throw new Error('Selected brand template is missing or inactive');
    return { useBrandTemplate: true, brandTemplateId: found.id };
  }

  const pool = asIdArray(brandTemplateIds);

  if (templateMode === 'rotate') {
    let slots = pool.length
      ? pool
      : (
          await prisma.brandTemplate.findMany({
            where: { tenantId, deletedAt: null, isActive: true },
            select: { id: true },
            orderBy: [{ rotationOrder: 'asc' }, { createdAt: 'asc' }],
          })
        ).map((t) => t.id);

    if (!slots.length) {
      return { useBrandTemplate: false, brandTemplateIds: slots, nextRotateCursor: rotateCursor };
    }

    // Skip stale template IDs (deleted) while preserving __ai__ and order
    const realIds = slots.filter((id) => id !== ROTATE_AI_SLOT);
    const live = realIds.length
      ? new Set(
          (
            await prisma.brandTemplate.findMany({
              where: {
                tenantId,
                deletedAt: null,
                isActive: true,
                id: { in: realIds },
              },
              select: { id: true },
            })
          ).map((t) => t.id),
        )
      : new Set<string>();
    slots = slots.filter((id) => id === ROTATE_AI_SLOT || live.has(id));
    if (!slots.length) {
      throw new Error(
        'Rotate pool is empty — pick at least one saved template and/or Entire AI generation',
      );
    }

    const idx = ((rotateCursor % slots.length) + slots.length) % slots.length;
    const pick = slots[idx]!;
    const nextRotateCursor = rotateCursor + 1;
    if (pick === ROTATE_AI_SLOT) {
      return {
        useBrandTemplate: false,
        brandTemplateIds: slots,
        nextRotateCursor,
      };
    }
    return {
      useBrandTemplate: true,
      brandTemplateId: pick,
      brandTemplateIds: slots,
      nextRotateCursor,
    };
  }

  // random — optional pool; empty = all active
  const eligible = await prisma.brandTemplate.findMany({
    where: {
      tenantId,
      deletedAt: null,
      isActive: true,
      ...(pool.filter((id) => id !== ROTATE_AI_SLOT).length
        ? { id: { in: pool.filter((id) => id !== ROTATE_AI_SLOT) } }
        : {}),
    },
    select: { id: true },
  });
  if (!eligible.length) return { useBrandTemplate: false };
  const pick = eligible[Math.floor(Math.random() * eligible.length)]!;
  return { useBrandTemplate: true, brandTemplateId: pick.id, brandTemplateIds: pool };
}

async function resolveNewsletterDocument(
  tenantId: string,
  documentMode: string | null | undefined,
  libraryItemId: string | null | undefined,
  libraryItemIds: unknown,
): Promise<{ libraryItemId: string; libraryItemIds?: string[] }> {
  // Legacy automations may still store "none" — treat as rotate (always require a product doc).
  const mode = documentMode === 'none' || !documentMode ? 'rotate' : documentMode;
  const pool = asIdArray(libraryItemIds);

  if (mode === 'fixed') {
    if (!libraryItemId) {
      throw new Error('Fixed product document mode requires a selected Newsletter document.');
    }
    const found = await prisma.contentLibraryItem.findFirst({
      where: { id: libraryItemId, tenantId, deletedAt: null, isActive: true },
      select: { id: true, title: true },
    });
    if (!found) {
      throw new Error(
        'The selected product document is missing or inactive. Pick another document in Settings → Automation.',
      );
    }
    return { libraryItemId: found.id, libraryItemIds: pool };
  }

  const { selectNextLibraryItem } = await import('./rotation.service');
  const next = await selectNextLibraryItem(tenantId, pool);
  if (!next) {
    throw new Error(
      'No active product documents to rotate. Upload documents on the Newsletter page.',
    );
  }
  return {
    libraryItemId: next.id,
    libraryItemIds: pool,
  };
}

function ymdInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta));
  return dt.toISOString().slice(0, 10);
}

export type AutomationCalendarMode =
  | 'saved_plan'
  | 'ai_plan'
  | 'uploaded_plan'
  | 'festival';

export type CalendarFestivalFilters = {
  regions?: string[];
  categories?: string[];
};

/**
 * Pick what a Content Calendar automation run should generate:
 * - saved_plan → next idea from any saved calendar plan (AI or upload)
 * - ai_plan / uploaded_plan → legacy scoped plan modes
 * - festival → Universal festival catalog (optional region/category filters)
 */
export async function resolveCalendarAutomationTarget(
  tenantId: string,
  timeZone = 'UTC',
  calendarMode: AutomationCalendarMode = 'festival',
  calendarFilters: CalendarFestivalFilters = {},
  contentCalendarPlanId?: string | null,
): Promise<{
  eventId?: string;
  eventYear?: number;
  customPlan?: {
    id: string;
    title: string;
    date: string;
    theme?: string;
    notes?: string;
    hashtags?: string[];
  };
  planEntryId?: string;
  visualStyleId?: string | null;
  planBrandTemplateId?: string | null;
  planUseBrandTemplate?: boolean;
}> {
  const today = ymdInTimeZone(new Date(), timeZone);
  const from = addDaysYmd(today, -2);
  const to = addDaysYmd(today, 21);
  const mode = calendarMode || 'festival';

  if (mode === 'festival') {
    const { listFestivalEvents, CALENDAR_REGIONS, CALENDAR_CATEGORIES } = await import(
      '../data/festival-calendar'
    );
    type CalendarRegion = (typeof CALENDAR_REGIONS)[number]['id'];
    type EventCategory = (typeof CALENDAR_CATEGORIES)[number]['id'];

    const allRegions = CALENDAR_REGIONS.map((r) => r.id);
    const allCategories = CALENDAR_CATEGORIES.map((c) => c.id);
    const regions = (
      calendarFilters.regions?.length ? calendarFilters.regions : allRegions
    ).filter((r): r is CalendarRegion => allRegions.includes(r as CalendarRegion));
    const categories = (
      calendarFilters.categories?.length ? calendarFilters.categories : allCategories
    ).filter((c): c is EventCategory => allCategories.includes(c as EventCategory));

    const year = Number(today.slice(0, 4));
    const festivals = [
      ...listFestivalEvents({ year, regions, categories }),
      ...listFestivalEvents({ year: year + 1, regions, categories }),
    ].filter((e) => e.date >= today && e.date <= to);

    const pick = festivals[0];
    if (!pick) {
      const regionLabel = regions.length ? regions.join(', ') : 'all markets';
      const typeLabel = categories.length ? categories.join(', ') : 'all types';
      throw new Error(
        `No upcoming festival in the next 3 weeks for ${regionLabel} / ${typeLabel}. Widen filters or try again closer to an observance.`,
      );
    }
    return {
      eventId: pick.id,
      eventYear: Number(pick.date.slice(0, 4)),
    };
  }

  // Plan-backed modes
  if (mode === 'saved_plan') {
    if (!contentCalendarPlanId?.trim()) {
      throw new Error(
        'Pick a saved content calendar in the automation wizard (My content calendar).',
      );
    }
    const plan = await prisma.contentCalendarPlan.findFirst({
      where: {
        id: contentCalendarPlanId,
        tenantId,
        deletedAt: null,
        status: 'active',
      },
      select: { id: true, name: true },
    });
    if (!plan) {
      throw new Error(
        'Selected content calendar was not found or is archived. Pick another saved calendar.',
      );
    }
  }

  const planWhere =
    mode === 'ai_plan'
      ? {
          tenantId,
          deletedAt: null,
          status: 'active' as const,
          OR: [{ source: 'ai' }, { name: { startsWith: 'AI plan' } }],
        }
      : mode === 'uploaded_plan'
        ? {
            tenantId,
            deletedAt: null,
            status: 'active' as const,
            source: 'upload',
            NOT: { name: { startsWith: 'AI plan' } },
          }
        : mode === 'saved_plan' && contentCalendarPlanId
          ? {
              tenantId,
              deletedAt: null,
              status: 'active' as const,
              id: contentCalendarPlanId,
            }
          : {
              tenantId,
              deletedAt: null,
              status: 'active' as const,
            };

  const planEntry = await prisma.contentCalendarPlanEntry.findFirst({
    where: {
      plan: planWhere,
      status: { in: ['manual', 'failed'] },
      date: { gte: from, lte: to },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    include: {
      plan: {
        select: {
          visualMode: true,
          visualStyleId: true,
          brandTemplateId: true,
          source: true,
          name: true,
        },
      },
    },
  });

  if (planEntry) {
    const claimed = await prisma.contentCalendarPlanEntry.updateMany({
      where: { id: planEntry.id, status: planEntry.status },
      data: { status: 'generating', errorMessage: null },
    });
    if (claimed.count) {
      return {
        customPlan: {
          id: planEntry.id,
          title: planEntry.title,
          date: planEntry.date,
          theme: planEntry.theme || undefined,
          notes: planEntry.notes || undefined,
          hashtags: planEntry.hashtags || [],
        },
        planEntryId: planEntry.id,
        visualStyleId: planEntry.plan.visualStyleId,
        planBrandTemplateId: planEntry.plan.brandTemplateId,
        planUseBrandTemplate: planEntry.plan.visualMode === 'existing_template',
      };
    }
  }

  if (mode === 'ai_plan') {
    throw new Error(
      'No AI content-calendar ideas ready. Open Content Calendar → “Create a content calendar”, save a plan (manual or with failed items), then run this automation again.',
    );
  }
  if (mode === 'uploaded_plan') {
    throw new Error(
      'No uploaded content-plan ideas ready. Open Content Calendar → “My content plans”, upload/save ideas as manual (or fix failed ones), then run again.',
    );
  }
  if (mode === 'saved_plan') {
    throw new Error(
      'No ready ideas in the selected content calendar (need manual/failed entries in the next ~3 weeks). Open Content Calendar, fix or add ideas, then run again.',
    );
  }
  throw new Error(
    'No saved content-calendar ideas ready. Open Content Calendar, save a plan (AI or upload) with manual/failed ideas, then run again.',
  );
}

/** Enqueue generation for a saved automation (does not mutate schedule fields). */
/**
 * Pick the hottest trending meme that actually has an image, so a scheduled run
 * gets the same layout lock the user gets by clicking a meme in the UI.
 * Best-effort — a run without a reference still produces a catalog-format meme.
 */
async function discoverAutomationMemeReference(tenantId: string): Promise<{
  imageUrl: string;
  suggestedFormatId?: string;
  signal: { title: string; url?: string; snippet?: string; imageUrl?: string; postText?: string };
} | null> {
  try {
    const { discoverMemeCandidates } = await import('./meme-discover.service');
    const res = await discoverMemeCandidates(tenantId, { limit: 12 });
    if (res.candidates.length) {
      const { persistMemeCandidates } = await import('./discover-scrape-store.service');
      await persistMemeCandidates(tenantId, res.candidates, {
        providersTried: res.providersTried,
        primaryProvider: res.primaryProvider,
      }).catch(() => undefined);
    }
    const pick = res.candidates.find((c) => c.imageUrl || c.imageUrls?.[0]);
    const imageUrl = pick?.imageUrl || pick?.imageUrls?.[0];
    if (!pick || !imageUrl) return null;
    return {
      imageUrl,
      suggestedFormatId: pick.suggestedFormatId,
      signal: {
        title: pick.title,
        url: pick.url || undefined,
        snippet: pick.snippet || '',
        imageUrl,
        postText: pick.postText || pick.title,
      },
    };
  } catch {
    return null;
  }
}

export async function executeAutomationJob(workflowId: string): Promise<string> {
  const workflow = await prisma.automationWorkflow.findFirst({
    where: { id: workflowId, deletedAt: null },
  });
  if (!workflow) throw new Error('Automation not found');

  const template = await resolveBrandTemplateId(
    workflow.tenantId,
    workflow.templateMode as AutomationTemplateMode,
    workflow.brandTemplateId,
    workflow.brandTemplateIds,
    workflow.rotateCursor ?? 0,
  );

  if (typeof template.nextRotateCursor === 'number') {
    await prisma.automationWorkflow.update({
      where: { id: workflow.id },
      data: { rotateCursor: template.nextRotateCursor },
    });
  }

  const platforms = (workflow.channels || []) as Array<
    'instagram' | 'linkedin' | 'facebook' | 'twitter'
  >;
  const outcome = {
    platforms,
    requireApproval: workflow.requireApproval,
  };

  const { enqueueContentGeneration } = await import('../workers');

  let engine: ContentEngine;
  let trends: Parameters<typeof enqueueContentGeneration>[2];
  let competitor: Parameters<typeof enqueueContentGeneration>[3];
  let calendar: Parameters<typeof enqueueContentGeneration>[4];
  let newsletter: Parameters<typeof enqueueContentGeneration>[5];
  let meme: Parameters<typeof enqueueContentGeneration>[6];

  if (workflow.jobType === 'trends') {
    engine = ContentEngine.TRENDS;
    trends = {
      useBrandTemplate: template.useBrandTemplate,
      brandTemplateId: template.brandTemplateId,
      ...outcome,
    };
  } else if (workflow.jobType === 'competitor') {
    engine = ContentEngine.COMPETITOR;
    competitor = {
      refreshScrape: true,
      useBrandTemplate: template.useBrandTemplate,
      brandTemplateId: template.brandTemplateId,
      ...outcome,
    };
  } else if (workflow.jobType === 'newsletter') {
    engine = ContentEngine.NEWSLETTER;
    const doc = await resolveNewsletterDocument(
      workflow.tenantId,
      workflow.documentMode,
      workflow.libraryItemId,
      workflow.libraryItemIds,
    );
    newsletter = {
      useBrandTemplate: template.useBrandTemplate,
      brandTemplateId: template.brandTemplateId,
      brandTemplateIds: template.brandTemplateIds,
      libraryItemId: doc.libraryItemId,
      libraryItemIds: doc.libraryItemIds,
      includeLogo: true,
      ...outcome,
    };
  } else if (workflow.jobType === 'meme') {
    engine = ContentEngine.MEME;
    const contentSource = (
      ['product', 'brand', 'both'].includes(workflow.contentSource || '')
        ? workflow.contentSource
        : 'both'
    ) as 'product' | 'brand' | 'both';
    const doc =
      contentSource === 'brand'
        ? { libraryItemId: undefined, libraryItemIds: undefined }
        : await resolveNewsletterDocument(
            workflow.tenantId,
            workflow.documentMode || 'rotate',
            workflow.libraryItemId,
            workflow.libraryItemIds,
          );

    // Scheduled runs pick their own trending meme so the format lock applies
    // exactly like the manual Memes page flow.
    const reference = await discoverAutomationMemeReference(workflow.tenantId);

    // A chosen brand template wins; otherwise honour the saved AI creative mode.
    const visualMode = template.useBrandTemplate
      ? ('existing_template' as const)
      : workflow.visualMode === 'ai_baked_layout'
        ? ('ai_baked_layout' as const)
        : ('ai' as const);

    meme = {
      useBrandTemplate: template.useBrandTemplate,
      brandTemplateId: template.brandTemplateId,
      brandTemplateIds: template.brandTemplateIds,
      libraryItemId: doc.libraryItemId,
      libraryItemIds: doc.libraryItemIds,
      includeLogo: true,
      visualMode,
      contentSource,
      preferredFormatId: workflow.preferredFormatId || reference?.suggestedFormatId || undefined,
      referenceImageUrl: reference?.imageUrl,
      selectedSignals: reference ? [reference.signal] : undefined,
      ...outcome,
    };
  } else if (workflow.jobType === 'calendar') {
    engine = ContentEngine.CALENDAR;
    const calendarMode = (
      ['saved_plan', 'ai_plan', 'uploaded_plan', 'festival'].includes(workflow.calendarMode || '')
        ? workflow.calendarMode
        : 'festival'
    ) as AutomationCalendarMode;
    const rawFilters =
      workflow.calendarFilters &&
      typeof workflow.calendarFilters === 'object' &&
      !Array.isArray(workflow.calendarFilters)
        ? (workflow.calendarFilters as CalendarFestivalFilters)
        : {};
    const target = await resolveCalendarAutomationTarget(
      workflow.tenantId,
      workflow.timezone || 'UTC',
      calendarMode,
      {
        regions: Array.isArray(rawFilters.regions) ? rawFilters.regions.map(String) : undefined,
        categories: Array.isArray(rawFilters.categories)
          ? rawFilters.categories.map(String)
          : undefined,
      },
      workflow.contentCalendarPlanId,
    );
    const useBrand =
      template.useBrandTemplate || Boolean(target.planUseBrandTemplate);
    const brandTemplateId =
      template.brandTemplateId || target.planBrandTemplateId || undefined;
    calendar = {
      eventId: target.eventId,
      eventYear: target.eventYear,
      customPlan: target.customPlan,
      planEntryId: target.planEntryId,
      visualStyleId: target.visualStyleId,
      useBrandTemplate: useBrand,
      brandTemplateId,
      platforms,
      publishNow: !workflow.requireApproval && platforms.length > 0,
    };
  } else {
    throw new Error(`Unknown automation jobType: ${workflow.jobType}`);
  }

  return enqueueContentGeneration(
    workflow.tenantId,
    engine,
    trends,
    competitor,
    calendar,
    newsletter,
    meme,
  );
}

/** Claim and run due automations (called from schedule poller). */
export async function processDueAutomations(): Promise<number> {
  // Guard: during tsx/prisma client reloads the model can briefly be missing
  if (!prisma.automationWorkflow?.findMany) return 0;

  const now = new Date();
  const due = await prisma.automationWorkflow.findMany({
    where: {
      deletedAt: null,
      enabled: true,
      nextRunAt: { lte: now },
    },
    orderBy: { nextRunAt: 'asc' },
    take: 10,
  });

  let ran = 0;
  for (const row of due) {
    const nextWeekly =
      row.scheduleType === 'weekly'
        ? computeNextRunAt({
            scheduleType: 'weekly',
            weeklyDay: row.weeklyDay,
            weeklyTime: row.weeklyTime,
            timezone: row.timezone,
            after: now,
          })
        : null;

    // Claim so concurrent pollers skip this row
    const claimed = await prisma.automationWorkflow.updateMany({
      where: {
        id: row.id,
        enabled: true,
        nextRunAt: row.nextRunAt,
        deletedAt: null,
      },
      data: {
        lastRunAt: now,
        nextRunAt: nextWeekly,
        ...(row.scheduleType === 'once' ? { enabled: false } : {}),
      },
    });
    if (claimed.count === 0) continue;

    try {
      await executeAutomationJob(row.id);
      ran += 1;
    } catch (err) {
      console.error('[automation]', row.id, err);
    }
  }
  return ran;
}
