import { ContentEngine } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { wallClockInZoneToUtc, isValidTimeHm } from '../lib/timezone-wallclock';
import { VISUAL_STYLE_PRESETS } from '../providers/images/social-frame';

const DEFAULT_VISUAL_STYLE_ID = 'professional_photo';

function resolveVisualStyleId(styleId?: string | null): string {
  const id = (styleId || '').trim();
  return VISUAL_STYLE_PRESETS.some((p) => p.id === id) ? id : DEFAULT_VISUAL_STYLE_ID;
}

export type PlanEntryInput = {
  id?: string;
  date: string;
  title: string;
  theme?: string;
  notes?: string;
  hashtags?: string[];
};

function ymdTodayInZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Persist an uploaded month plan. Generation runs later on each entry's date at runTime.
 */
export async function saveContentCalendarPlan(opts: {
  tenantId: string;
  year: number;
  month: number;
  name?: string;
  /** ai | upload — Content Calendar workflow that created this plan */
  source?: 'ai' | 'upload';
  runTime: string;
  timezone: string;
  executionMode: 'automatic' | 'manual';
  visualMode: 'ai' | 'existing_template' | 'ai_baked_layout';
  visualStyleId?: string | null;
  brandTemplateId?: string | null;
  entries: PlanEntryInput[];
}) {
  const runTime = opts.runTime.trim();
  if (!isValidTimeHm(runTime)) {
    throw new Error('runTime must be HH:mm (24h), e.g. 09:00');
  }
  const timezone = opts.timezone.trim() || 'Asia/Kolkata';
  try {
    // Validate IANA zone early
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`);
  }

  const today = ymdTodayInZone(timezone);
  const now = new Date();
  const expectedPrefix = `${opts.year}-${String(opts.month).padStart(2, '0')}-`;
  const mismatched = opts.entries.find((entry) => !entry.date.startsWith(expectedPrefix));
  if (mismatched) {
    throw new Error(
      `Entry "${mismatched.title}" has date ${mismatched.date}, outside ${opts.year}-${String(opts.month).padStart(2, '0')}.`,
    );
  }

  const entryRows = opts.entries.map((e) => {
    let runAt: Date;
    let status = opts.executionMode === 'manual' ? 'manual' : 'pending';
    let errorMessage: string | null = null;

    if (opts.executionMode === 'automatic' && e.date < today) {
      status = 'skipped';
      errorMessage = 'Date already passed when plan was saved';
      runAt = wallClockInZoneToUtc(e.date, runTime, timezone);
    } else {
      runAt = wallClockInZoneToUtc(e.date, runTime, timezone);
      if (e.date === today && runAt.getTime() <= now.getTime()) {
        // Same day but wall-clock time already passed — start on next poll
        runAt = new Date(now.getTime() + 15_000);
      }
    }

    return {
      date: e.date,
      title: e.title.trim(),
      theme: (e.theme || '').trim(),
      notes: (e.notes || '').trim(),
      hashtags: e.hashtags || [],
      runAt,
      status,
      errorMessage,
    };
  });

  const plan = await prisma.contentCalendarPlan.create({
    data: {
      tenantId: opts.tenantId,
      name: opts.name?.trim() || `Plan ${opts.year}-${String(opts.month).padStart(2, '0')}`,
      source: opts.source === 'ai' ? 'ai' : 'upload',
      year: opts.year,
      month: opts.month,
      runTime,
      timezone,
      executionMode: opts.executionMode,
      visualMode: opts.visualMode,
      visualStyleId: resolveVisualStyleId(opts.visualStyleId),
      brandTemplateId: opts.visualMode === 'existing_template' ? opts.brandTemplateId || null : null,
      status: 'active',
      entries: {
        create: entryRows,
      },
    },
    include: {
      entries: {
        orderBy: { date: 'asc' },
        select: {
          id: true,
          date: true,
          title: true,
          theme: true,
          notes: true,
          hashtags: true,
          runAt: true,
          status: true,
          contentId: true,
          errorMessage: true,
        },
      },
    },
  });

  return plan;
}

export async function listContentCalendarPlans(tenantId: string, year?: number, month?: number) {
  await reconcilePlanEntriesForTenant(tenantId);
  return prisma.contentCalendarPlan.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(year ? { year } : {}),
      ...(month ? { month } : {}),
    },
    orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
    include: {
      entries: {
        orderBy: { date: 'asc' },
        select: {
          id: true,
          date: true,
          title: true,
          theme: true,
          status: true,
          runAt: true,
          contentId: true,
          errorMessage: true,
        },
      },
      _count: { select: { entries: true } },
    },
  });
}

export async function getActivePlanForMonth(tenantId: string, year: number, month: number) {
  return prisma.contentCalendarPlan.findFirst({
    where: {
      tenantId,
      year,
      month,
      deletedAt: null,
      status: 'active',
    },
    orderBy: { createdAt: 'desc' },
    include: {
      entries: {
        orderBy: { date: 'asc' },
      },
    },
  });
}

const GONE_DRAFT_STATUSES = new Set(['rejected', 'failed']);

function draftGoneMessage(reason: 'aborted' | 'deleted' | 'missing') {
  if (reason === 'deleted') {
    return 'Draft was deleted from Approvals. Generate again from the calendar.';
  }
  if (reason === 'aborted') {
    return 'Generation was aborted. Generate again from the calendar.';
  }
  return 'Draft is no longer in Approvals. Generate again from the calendar.';
}

export type CalendarDraftLookup = {
  planId: string;
  entryId: string;
  title: string;
  date: string;
  year: number;
  month: number;
  executionMode: string;
};

export async function findPlanEntryByContentId(
  tenantId: string,
  contentId: string,
): Promise<CalendarDraftLookup | null> {
  const entry = await prisma.contentCalendarPlanEntry.findFirst({
    where: {
      contentId,
      plan: { tenantId, deletedAt: null },
    },
    include: {
      plan: { select: { id: true, year: true, month: true, executionMode: true } },
    },
  });
  if (!entry) return null;
  return {
    planId: entry.plan.id,
    entryId: entry.id,
    title: entry.title,
    date: entry.date,
    year: entry.plan.year,
    month: entry.plan.month,
    executionMode: entry.plan.executionMode,
  };
}

/** After abort/delete, keep the calendar row and make it regenerable. */
export async function releasePlanEntriesForContent(
  contentId: string,
  reason: 'aborted' | 'deleted',
): Promise<CalendarDraftLookup | null> {
  const entry = await prisma.contentCalendarPlanEntry.findFirst({
    where: { contentId },
    include: {
      plan: { select: { id: true, year: true, month: true, executionMode: true, tenantId: true } },
    },
  });
  if (!entry) return null;

  await prisma.contentCalendarPlanEntry.update({
    where: { id: entry.id },
    data: {
      status: 'failed',
      errorMessage: draftGoneMessage(reason),
      processedAt: new Date(),
      // Clear so hard-deleting the content row leaves no dangling pointer.
      contentId: null,
    },
  });

  return {
    planId: entry.plan.id,
    entryId: entry.id,
    title: entry.title,
    date: entry.date,
    year: entry.plan.year,
    month: entry.plan.month,
    executionMode: entry.plan.executionMode,
  };
}

export async function reconcilePlanEntriesForTenant(tenantId: string) {
  const entries = await prisma.contentCalendarPlanEntry.findMany({
    where: {
      contentId: { not: null },
      status: { in: ['ready', 'generating'] },
      plan: { tenantId, deletedAt: null },
    },
    select: { id: true, contentId: true },
  });
  if (!entries.length) return;

  const contentIds = entries.map((e) => e.contentId!).filter(Boolean);
  const rows = await prisma.generatedContent.findMany({
    where: { id: { in: contentIds } },
    select: { id: true, deletedAt: true, status: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const stale = entries.filter((e) => {
    const content = e.contentId ? byId.get(e.contentId) : null;
    return !content || content.deletedAt || GONE_DRAFT_STATUSES.has(content.status);
  });
  if (!stale.length) return;

  await prisma.contentCalendarPlanEntry.updateMany({
    where: { id: { in: stale.map((e) => e.id) } },
    data: {
      status: 'failed',
      errorMessage: draftGoneMessage('missing'),
      processedAt: new Date(),
      contentId: null,
    },
  });
}

export async function generateManualPlanEntry(
  tenantId: string,
  planId: string,
  entryId: string,
  opts?: {
    visualMode?: 'ai' | 'existing_template' | 'ai_baked_layout';
    brandTemplateId?: string | null;
  },
): Promise<string> {
  const entry = await prisma.contentCalendarPlanEntry.findFirst({
    where: {
      id: entryId,
      planId,
      plan: {
        tenantId,
        deletedAt: null,
        status: 'active',
      },
    },
    include: { plan: true },
  });
  if (!entry) {
    throw new Error('This calendar idea is not available to generate.');
  }

  const linked = entry.contentId
    ? await prisma.generatedContent.findFirst({
        where: { id: entry.contentId },
        select: { id: true, deletedAt: true, status: true },
      })
    : null;
  const linkedGone =
    !linked || Boolean(linked.deletedAt) || GONE_DRAFT_STATUSES.has(linked.status);

  const regenerable =
    ['manual', 'failed'].includes(entry.status) ||
    (['ready', 'generating'].includes(entry.status) && linkedGone);

  if (!regenerable) {
    if (entry.status === 'ready' && entry.contentId && !linkedGone) {
      throw new Error('This idea already has a draft in Approvals.');
    }
    if (entry.status === 'generating' && !linkedGone) {
      throw new Error('This idea is already generating.');
    }
    if (entry.status === 'pending') {
      throw new Error('This idea is scheduled. Wait for its date, or it will generate automatically.');
    }
    throw new Error('This entry is not available for generation.');
  }

  const claimed = await prisma.contentCalendarPlanEntry.updateMany({
    where: { id: entry.id, status: entry.status },
    data: { status: 'generating', errorMessage: null },
  });
  if (!claimed.count) throw new Error('This entry is already being generated.');

  try {
    const brand = await prisma.brandSettings.findUnique({
      where: { tenantId },
      select: { companyName: true },
    });
    if (!brand?.companyName?.trim()) {
      throw new Error('Company name missing in Brand settings.');
    }

    const visualMode =
      opts?.visualMode === 'existing_template' ||
      opts?.visualMode === 'ai' ||
      opts?.visualMode === 'ai_baked_layout'
        ? opts.visualMode
        : entry.plan.visualMode === 'existing_template'
          ? 'existing_template'
          : entry.plan.visualMode === 'ai_baked_layout'
            ? 'ai_baked_layout'
            : 'ai';
    const brandTemplateId =
      visualMode === 'existing_template'
        ? opts?.brandTemplateId || entry.plan.brandTemplateId || null
        : null;
    if (visualMode === 'existing_template' && !brandTemplateId) {
      throw new Error('Pick a Brand Studio template, or choose AI photo + LLM layout / AI painted poster.');
    }

    const { enqueueContentGeneration } = await import('../workers');
    const useBrandTemplate = visualMode === 'existing_template';
    const contentId = await enqueueContentGeneration(
      tenantId,
      ContentEngine.CALENDAR,
      undefined,
      undefined,
      {
        customPlan: {
          id: entry.id,
          title: entry.title,
          date: entry.date,
          theme: entry.theme,
          notes: entry.notes,
          hashtags: entry.hashtags,
        },
        platforms: [],
        publishNow: false,
        scheduledAt: null,
        useBrandTemplate,
        brandTemplateId: useBrandTemplate ? brandTemplateId || undefined : undefined,
        visualMode,
        visualStyleId: resolveVisualStyleId(entry.plan.visualStyleId),
        planEntryId: entry.id,
      },
    );
    await prisma.contentCalendarPlanEntry.update({
      where: { id: entry.id },
      data: { contentId },
    });
    return contentId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.contentCalendarPlanEntry.update({
      where: { id: entry.id },
      data: {
        status: 'failed',
        errorMessage: message.slice(0, 500),
        processedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function deleteContentCalendarPlan(tenantId: string, planId: string) {
  const plan = await prisma.contentCalendarPlan.findFirst({
    where: { id: planId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!plan) return false;

  const unfinished = await prisma.contentCalendarPlanEntry.findMany({
    where: {
      planId,
      status: { in: ['pending', 'generating'] },
      contentId: { not: null },
    },
    select: { contentId: true },
  });
  const contentIds = unfinished.flatMap((entry) =>
    entry.contentId ? [entry.contentId] : [],
  );

  await prisma.$transaction([
    ...(contentIds.length
      ? [
          prisma.generatedContent.updateMany({
            where: {
              id: { in: contentIds },
              tenantId,
              status: 'generating',
            },
            data: {
              status: 'rejected' as const,
              publishError: 'Calendar plan deleted',
            },
          }),
        ]
      : []),
    prisma.contentCalendarPlanEntry.updateMany({
      where: { planId, status: { in: ['pending', 'generating'] } },
      data: {
        status: 'skipped',
        errorMessage: 'Calendar plan deleted',
        processedAt: new Date(),
      },
    }),
    prisma.contentCalendarPlan.update({
      where: { id: planId },
      data: { deletedAt: new Date(), status: 'archived' },
    }),
  ]);
  return true;
}

/**
 * Enqueue generation for plan entries whose runAt has arrived.
 * Returns number of jobs started.
 */
export async function processDueCalendarPlanEntries(limit = 5): Promise<number> {
  const due = await prisma.contentCalendarPlanEntry.findMany({
    where: {
      status: 'pending',
      runAt: { lte: new Date() },
      plan: {
        deletedAt: null,
        status: 'active',
        executionMode: 'automatic',
      },
    },
    take: limit,
    orderBy: { runAt: 'asc' },
    include: {
      plan: true,
    },
  });

  if (!due.length) return 0;

  const { enqueueContentGeneration } = await import('../workers');
  let started = 0;

  for (const entry of due) {
    // Claim row so concurrent pollers don't double-fire
    const claimed = await prisma.contentCalendarPlanEntry.updateMany({
      where: { id: entry.id, status: 'pending' },
      data: { status: 'generating' },
    });
    if (!claimed.count) continue;

    try {
      const brand = await prisma.brandSettings.findUnique({
        where: { tenantId: entry.plan.tenantId },
        select: { companyName: true },
      });
      if (!brand?.companyName?.trim()) {
        await prisma.contentCalendarPlanEntry.update({
          where: { id: entry.id },
          data: {
            status: 'failed',
            errorMessage: 'Company name missing in Brand settings',
            processedAt: new Date(),
          },
        });
        continue;
      }

      const useBrandTemplate = entry.plan.visualMode === 'existing_template';
      const visualMode =
        entry.plan.visualMode === 'existing_template'
          ? 'existing_template'
          : entry.plan.visualMode === 'ai_baked_layout'
            ? 'ai_baked_layout'
            : 'ai';
      const contentId = await enqueueContentGeneration(
        entry.plan.tenantId,
        ContentEngine.CALENDAR,
        undefined,
        undefined,
        {
          customPlan: {
            id: entry.id,
            title: entry.title,
            date: entry.date,
            theme: entry.theme,
            notes: entry.notes,
            hashtags: entry.hashtags,
          },
          platforms: [],
          publishNow: false,
          scheduledAt: null,
          useBrandTemplate,
          brandTemplateId: useBrandTemplate ? entry.plan.brandTemplateId || undefined : undefined,
          visualMode,
          visualStyleId: resolveVisualStyleId(entry.plan.visualStyleId),
          planEntryId: entry.id,
        },
      );

      await prisma.contentCalendarPlanEntry.update({
        where: { id: entry.id },
        data: { contentId },
      });
      started += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await prisma.contentCalendarPlanEntry.update({
        where: { id: entry.id },
        data: {
          status: 'failed',
          errorMessage: msg.slice(0, 500),
          processedAt: new Date(),
        },
      });
    }
  }

  return started;
}

export async function markPlanEntryFromGeneration(
  planEntryId: string | undefined,
  contentId: string,
  outcome: 'ready' | 'failed',
  errorMessage?: string,
) {
  if (!planEntryId) return;
  await prisma.contentCalendarPlanEntry.updateMany({
    where: { id: planEntryId },
    data: {
      status: outcome,
      contentId,
      processedAt: new Date(),
      ...(outcome === 'failed'
        ? { errorMessage: (errorMessage || 'Generation failed').slice(0, 500) }
        : { errorMessage: null }),
    },
  });
}
