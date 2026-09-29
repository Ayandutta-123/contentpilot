import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserRole } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  computeNextRunAt,
  executeAutomationJob,
  isValidTimeZone,
  normalizeWeeklyTime,
  parseRunAt,
  summarizeSchedule,
  type AutomationJobType,
  type AutomationScheduleType,
  type AutomationTemplateMode,
} from '../services/automation.service';

const PlatformEnum = z.enum(['instagram', 'linkedin', 'facebook', 'twitter']);

const CreateBody = z
  .object({
    name: z.string().max(120).optional().nullable(),
    scheduleType: z.enum(['once', 'weekly']),
    runAt: z.string().min(1).optional().nullable(),
    weeklyDay: z.number().int().min(0).max(6).optional().nullable(),
    weeklyTime: z
      .string()
      .regex(/^\d{1,2}:\d{2}(:\d{2})?$/, 'Time must be HH:mm')
      .optional()
      .nullable(),
    timezone: z.string().min(1).max(64).optional().default('UTC'),
    jobType: z.enum(['newsletter', 'competitor', 'trends', 'meme', 'calendar']),
    calendarMode: z
      .enum(['saved_plan', 'ai_plan', 'uploaded_plan', 'festival'])
      .optional()
      .default('festival'),
    calendarFilters: z
      .object({
        regions: z.array(z.enum(['india', 'gcc', 'europe', 'usa', 'global'])).optional(),
        categories: z.array(z.enum(['tech', 'festival', 'national', 'observance'])).optional(),
      })
      .optional()
      .default({}),
    contentCalendarPlanId: z.string().uuid().optional().nullable(),
    templateMode: z.enum(['existing', 'random', 'none', 'rotate']),
    brandTemplateId: z.string().uuid().optional().nullable(),
    brandTemplateIds: z
      .array(z.union([z.string().uuid(), z.literal('__ai__')]))
      .optional()
      .default([]),
    documentMode: z.enum(['fixed', 'rotate', 'none']).optional().default('rotate'),
    libraryItemId: z.string().uuid().optional().nullable(),
    libraryItemIds: z.array(z.string().uuid()).optional().default([]),
    visualMode: z.enum(['existing_template', 'ai', 'ai_baked_layout']).optional().default('ai'),
    preferredFormatId: z.string().optional().nullable(),
    contentSource: z.enum(['product', 'brand', 'both']).optional().default('both'),
    channels: z.array(PlatformEnum).default([]),
    requireApproval: z.boolean().default(true),
    enabled: z.boolean().optional().default(true),
  })
  .superRefine((body, ctx) => {
    if (body.timezone && !isValidTimeZone(body.timezone)) {
      ctx.addIssue({ code: 'custom', message: 'Unknown timezone', path: ['timezone'] });
    }
    if (body.scheduleType === 'once') {
      if (!body.runAt) {
        ctx.addIssue({ code: 'custom', message: 'Pick a date and time for one-time schedule', path: ['runAt'] });
      } else {
        const when = parseRunAt(body.runAt, body.timezone);
        if (!when) {
          ctx.addIssue({ code: 'custom', message: 'Invalid date/time', path: ['runAt'] });
        } else if (when.getTime() < Date.now() - 60_000) {
          ctx.addIssue({ code: 'custom', message: 'One-time schedule must be in the future', path: ['runAt'] });
        }
      }
    }
    if (body.scheduleType === 'weekly') {
      if (body.weeklyDay == null) {
        ctx.addIssue({ code: 'custom', message: 'Pick a day of week', path: ['weeklyDay'] });
      }
      if (!body.weeklyTime) {
        ctx.addIssue({ code: 'custom', message: 'Pick a weekly time', path: ['weeklyTime'] });
      }
    }
    if (body.jobType === 'calendar' && !body.calendarMode) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a Content Calendar workflow (My content calendar or Universal festival)',
        path: ['calendarMode'],
      });
    }
    if (
      body.jobType === 'calendar' &&
      body.calendarMode === 'festival' &&
      (!(body.calendarFilters?.regions?.length) || !(body.calendarFilters?.categories?.length))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick at least one country/market and one festival type for Universal festival calendar',
        path: ['calendarFilters'],
      });
    }
    if (
      body.jobType === 'calendar' &&
      body.calendarMode === 'saved_plan' &&
      !body.contentCalendarPlanId
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick one saved content calendar',
        path: ['contentCalendarPlanId'],
      });
    }
    if (body.templateMode === 'existing' && !body.brandTemplateId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Select a brand template, or choose None / Random / Rotate',
        path: ['brandTemplateId'],
      });
    }
    if (body.templateMode === 'rotate' && !(body.brandTemplateIds?.length)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Select at least one saved template and/or Entire AI generation for Rotate',
        path: ['brandTemplateIds'],
      });
    }
    if (
      (body.jobType === 'newsletter' ||
        (body.jobType === 'meme' && body.contentSource !== 'brand')) &&
      body.documentMode === 'fixed' &&
      !body.libraryItemId
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Pick a product document, or use Rotate product documents',
        path: ['libraryItemId'],
      });
    }
    if (!body.requireApproval && body.channels.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Select at least one channel when auto-publishing',
        path: ['channels'],
      });
    }
  });

function serialize(row: {
  id: string;
  tenantId: string;
  name: string | null;
  scheduleType: string;
  runAt: Date | null;
  weeklyDay: number | null;
  weeklyTime: string | null;
  timezone: string;
  jobType: string;
  calendarMode?: string | null;
  calendarFilters?: unknown;
  contentCalendarPlanId?: string | null;
  templateMode: string;
  brandTemplateId: string | null;
  brandTemplateIds?: unknown;
  rotateCursor?: number | null;
  channels: string[];
  requireApproval: boolean;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  brandTemplate?: { id: string; name: string; provider: string } | null;
}) {
  const filters =
    row.calendarFilters &&
    typeof row.calendarFilters === 'object' &&
    !Array.isArray(row.calendarFilters)
      ? (row.calendarFilters as { regions?: string[]; categories?: string[] })
      : {};
  const brandTemplateIds = Array.isArray(row.brandTemplateIds)
    ? row.brandTemplateIds.filter((x): x is string => typeof x === 'string')
    : [];
  return {
    ...row,
    calendarMode: row.calendarMode || 'festival',
    contentCalendarPlanId: row.contentCalendarPlanId || null,
    calendarFilters: {
      regions: Array.isArray(filters.regions) ? filters.regions : [],
      categories: Array.isArray(filters.categories) ? filters.categories : [],
    },
    brandTemplateIds,
    rotateIncludeAi: brandTemplateIds.includes('__ai__'),
    scheduleSummary: summarizeSchedule(row),
  };
}

export async function automationRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const rows = await prisma.automationWorkflow.findMany({
      where: { tenantId, deletedAt: null },
      include: {
        brandTemplate: { select: { id: true, name: true, provider: true } },
      },
      orderBy: [{ enabled: 'desc' }, { nextRunAt: 'asc' }, { createdAt: 'desc' }],
    });
    const planIds = [
      ...new Set(
        rows
          .map((r) => r.contentCalendarPlanId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const plans = planIds.length
      ? await prisma.contentCalendarPlan.findMany({
          where: { tenantId, id: { in: planIds }, deletedAt: null },
          select: { id: true, name: true },
        })
      : [];
    const planNameById = new Map(plans.map((p) => [p.id, p.name]));
    return {
      success: true,
      data: rows.map((row) => ({
        ...serialize(row),
        contentCalendarPlanName: row.contentCalendarPlanId
          ? planNameById.get(row.contentCalendarPlanId) || null
          : null,
      })),
    };
  });

  app.post('/', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const parsed = CreateBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || 'Invalid automation';
      return reply.status(400).send({ success: false, error: msg });
    }
    const body = parsed.data;
    const tenantId = request.session.tenantId!;
    const timezone = body.timezone || 'UTC';
    const weeklyTime =
      body.scheduleType === 'weekly' && body.weeklyTime
        ? normalizeWeeklyTime(body.weeklyTime)
        : null;

    if (body.templateMode === 'existing' && body.brandTemplateId) {
      const tpl = await prisma.brandTemplate.findFirst({
        where: { id: body.brandTemplateId, tenantId, deletedAt: null, isActive: true },
      });
      if (!tpl) {
        return reply.status(400).send({ success: false, error: 'Brand template not found' });
      }
    }

    if (body.templateMode === 'rotate') {
      const realIds = (body.brandTemplateIds || []).filter((id) => id !== '__ai__');
      if (realIds.length) {
        const found = await prisma.brandTemplate.findMany({
          where: {
            tenantId,
            deletedAt: null,
            isActive: true,
            id: { in: realIds },
          },
          select: { id: true },
        });
        if (found.length !== realIds.length) {
          return reply.status(400).send({
            success: false,
            error: 'One or more selected rotate templates are missing or inactive',
          });
        }
      }
    }

    // Meme runs sourced purely from website content don't need a product document.
    const needsProductDoc =
      body.jobType === 'newsletter' || (body.jobType === 'meme' && body.contentSource !== 'brand');
    if (needsProductDoc) {
      const activeDocs = await prisma.contentLibraryItem.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        select: { id: true },
        orderBy: [{ rotationOrder: 'asc' }, { createdAt: 'asc' }],
      });
      if (!activeDocs.length) {
        return reply.status(400).send({
          success: false,
          error: 'Upload at least one product document on the Newsletter page first',
        });
      }
      if (body.documentMode === 'fixed') {
        if (!body.libraryItemId || !activeDocs.some((d) => d.id === body.libraryItemId)) {
          return reply.status(400).send({
            success: false,
            error: 'Pick an active product document for Fixed product document mode',
          });
        }
      }
    }

    if (
      body.jobType === 'calendar' &&
      body.calendarMode === 'saved_plan' &&
      body.contentCalendarPlanId
    ) {
      const plan = await prisma.contentCalendarPlan.findFirst({
        where: {
          id: body.contentCalendarPlanId,
          tenantId,
          deletedAt: null,
          status: 'active',
        },
        select: { id: true, name: true },
      });
      if (!plan) {
        return reply.status(400).send({
          success: false,
          error: 'Selected content calendar not found or archived',
        });
      }
    }

    if (body.channels.length) {
      const connected = await prisma.platformConnection.findMany({
        where: {
          tenantId,
          deletedAt: null,
          isActive: true,
          platform: { in: body.channels },
        },
        select: { platform: true },
      });
      const ok = new Set(connected.map((c) => c.platform));
      const missing = body.channels.filter((c) => !ok.has(c));
      if (missing.length) {
        return reply.status(400).send({
          success: false,
          error: `Connect ${missing.join(', ')} in Settings → Publish first`,
        });
      }
    }

    let nextRunAt: Date | null;
    let runAtDate: Date | null = null;
    try {
      nextRunAt = computeNextRunAt({
        scheduleType: body.scheduleType as AutomationScheduleType,
        runAt: body.runAt,
        weeklyDay: body.weeklyDay,
        weeklyTime,
        timezone,
      });
      if (body.scheduleType === 'once' && body.runAt) {
        runAtDate = parseRunAt(body.runAt, timezone);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid schedule';
      return reply.status(400).send({ success: false, error: msg });
    }

    if (!nextRunAt) {
      return reply.status(400).send({ success: false, error: 'Could not determine next run time' });
    }

    const calendarMode =
      body.jobType === 'calendar' ? body.calendarMode || 'festival' : 'festival';
    const calendarFilters =
      body.jobType === 'calendar' && calendarMode === 'festival'
        ? {
            regions: body.calendarFilters?.regions || [],
            categories: body.calendarFilters?.categories || [],
          }
        : {};

    const modeLabel =
      body.jobType === 'calendar'
        ? calendarMode === 'festival'
          ? 'Festival calendar'
          : calendarMode === 'ai_plan'
            ? 'AI calendar'
            : calendarMode === 'uploaded_plan'
              ? 'My plans'
              : 'My content calendar'
        : body.jobType;

    const defaultName =
      body.name?.trim() ||
      `${modeLabel} · ${body.scheduleType === 'once' ? 'one-time' : 'weekly'}`;

    const row = await prisma.automationWorkflow.create({
      data: {
        tenantId,
        name: defaultName,
        scheduleType: body.scheduleType,
        runAt: body.scheduleType === 'once' ? runAtDate : null,
        weeklyDay: body.scheduleType === 'weekly' ? body.weeklyDay : null,
        weeklyTime: body.scheduleType === 'weekly' ? weeklyTime : null,
        timezone,
        jobType: body.jobType as AutomationJobType,
        calendarMode,
        calendarFilters,
        contentCalendarPlanId:
          body.jobType === 'calendar' && calendarMode === 'saved_plan'
            ? body.contentCalendarPlanId || null
            : null,
        templateMode: body.templateMode as AutomationTemplateMode,
        brandTemplateId: body.templateMode === 'existing' ? body.brandTemplateId : null,
        brandTemplateIds:
          body.templateMode === 'rotate' || body.templateMode === 'random'
            ? body.brandTemplateIds || []
            : [],
        rotateCursor: 0,
        documentMode: needsProductDoc
          ? body.documentMode === 'fixed'
            ? 'fixed'
            : 'rotate'
          : 'none',
        libraryItemId:
          needsProductDoc && body.documentMode === 'fixed' ? body.libraryItemId : null,
        libraryItemIds: needsProductDoc ? body.libraryItemIds || [] : [],
        visualMode: body.jobType === 'meme' ? body.visualMode : 'ai',
        preferredFormatId: body.jobType === 'meme' ? body.preferredFormatId || null : null,
        contentSource: body.jobType === 'meme' ? body.contentSource : 'both',
        channels: body.channels,
        requireApproval: body.requireApproval,
        enabled: body.enabled ?? true,
        nextRunAt,
      },
      include: {
        brandTemplate: { select: { id: true, name: true, provider: true } },
      },
    });

    return { success: true, data: serialize(row) };
  });

  app.patch('/:id', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        enabled: z.boolean().optional(),
        name: z.string().max(120).optional().nullable(),
      })
      .parse(request.body ?? {});

    const existing = await prisma.automationWorkflow.findFirst({
      where: { id, tenantId: request.session.tenantId!, deletedAt: null },
    });
    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Automation not found' });
    }

    const data: {
      enabled?: boolean;
      name?: string | null;
      nextRunAt?: Date | null;
    } = {};

    if (body.name !== undefined) data.name = body.name;
    if (body.enabled !== undefined) {
      data.enabled = body.enabled;
      if (body.enabled) {
        // Re-arm schedule when re-enabling
        try {
          data.nextRunAt = computeNextRunAt({
            scheduleType: existing.scheduleType as AutomationScheduleType,
            runAt: existing.runAt,
            weeklyDay: existing.weeklyDay,
            weeklyTime: existing.weeklyTime,
            timezone: existing.timezone,
            after: new Date(),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Invalid schedule';
          return reply.status(400).send({ success: false, error: msg });
        }
        if (existing.scheduleType === 'once' && data.nextRunAt && data.nextRunAt.getTime() < Date.now()) {
          return reply.status(400).send({
            success: false,
            error: 'One-time schedule is in the past — create a new automation',
          });
        }
      }
    }

    const row = await prisma.automationWorkflow.update({
      where: { id },
      data,
      include: {
        brandTemplate: { select: { id: true, name: true, provider: true } },
      },
    });
    return { success: true, data: serialize(row) };
  });

  app.post('/:id/run', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.automationWorkflow.findFirst({
      where: { id, tenantId: request.session.tenantId!, deletedAt: null },
    });
    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Automation not found' });
    }
    try {
      const contentId = await executeAutomationJob(id);
      await prisma.automationWorkflow.update({
        where: { id },
        data: { lastRunAt: new Date() },
      });
      return { success: true, data: { contentId, jobType: existing.jobType } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.delete('/:id', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.automationWorkflow.findFirst({
      where: { id, tenantId: request.session.tenantId!, deletedAt: null },
    });
    if (!existing) {
      return reply.status(404).send({ success: false, error: 'Automation not found' });
    }
    await prisma.automationWorkflow.update({
      where: { id },
      data: { deletedAt: new Date(), enabled: false, nextRunAt: null },
    });
    return { success: true, data: { id } };
  });
}
