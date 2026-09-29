import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { QUEUE_NAMES, ContentEngine, ExecutionStatus } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { TrendsEngine } from '../engines/trends.engine';
import { CompetitorEngine } from '../engines/competitor.engine';
import { NewsletterEngine } from '../engines/newsletter.engine';
import { LibraryEngine } from '../engines/library.engine';
import { CalendarEngine } from '../engines/calendar.engine';
import { MemeEngine } from '../engines/meme.engine';
import { CarouselEngine } from '../engines/carousel.engine';
import { publishingService } from '../services/publishing.service';
import { notifyApprovalPending, notifyWorkflowFailure } from '../providers/notifications';
import { executionLogService } from '../services/execution-log.service';
import { notifySuccess, notifyError } from '../services/app-notification.service';
import { processDueAutomations } from '../services/automation.service';
import { processDueCalendarPlanEntries } from '../services/calendar-plan-schedule.service';
import { isGenerationAbortedError } from '../services/generation-abort.service';

let redisAvailable = false;
let contentGenerationQueue: Queue | null = null;
let contentPublishingQueue: Queue | null = null;
let connection: IORedis | null = null;
let schedulePoller: ReturnType<typeof setInterval> | null = null;

type OutcomePlatforms = Array<'instagram' | 'linkedin' | 'facebook' | 'twitter'>;

interface GenerationJobData {
  contentId: string;
  tenantId: string;
  engine: ContentEngine;
  trends?: {
    topicId?: string;
    sources?: Array<{ title: string; url: string; snippet: string; publishedDate?: string }>;
    useBrandTemplate?: boolean;
    brandTemplateId?: string;
    visualMode?: 'existing_template' | 'ai' | 'ai_baked_layout';
    platforms?: OutcomePlatforms;
    requireApproval?: boolean;
  };
  competitor?: {
    scrapedPostId?: string;
    competitorId?: string;
    refreshScrape?: boolean;
    useBrandTemplate?: boolean;
    brandTemplateId?: string;
    visualMode?: 'existing_template' | 'ai' | 'ai_baked_layout';
    competitorImageMode?: 'new_topic' | 'near_mirror';
    platforms?: OutcomePlatforms;
    requireApproval?: boolean;
  };
  newsletter?: {
    useBrandTemplate?: boolean;
    brandTemplateId?: string;
    brandTemplateIds?: string[];
    newsletterTemplateId?: string;
    libraryItemId?: string;
    libraryItemIds?: string[];
    generationRules?: string;
    freeform?: boolean;
    includeLogo?: boolean;
    visualMode?: 'existing_template' | 'ai' | 'ai_baked_layout';
    platforms?: OutcomePlatforms;
    requireApproval?: boolean;
  };
  meme?: {
    useBrandTemplate?: boolean;
    brandTemplateId?: string;
    brandTemplateIds?: string[];
    libraryItemId?: string;
    libraryItemIds?: string[];
    generationRules?: string;
    includeLogo?: boolean;
    visualMode?: 'existing_template' | 'ai' | 'ai_baked_layout';
    platforms?: OutcomePlatforms;
    requireApproval?: boolean;
    selectedSignals?: Array<{
      title: string;
      url?: string;
      snippet?: string;
      imageUrl?: string;
      postText?: string;
    }>;
    preferredFormatId?: string;
    referenceImageUrl?: string;
    contentSource?: 'product' | 'brand' | 'both';
  };
  carousel?: {
    topic: string;
    brief?: string;
    slideCount?: number;
    platforms?: OutcomePlatforms;
    visualStyleId?: string | null;
    callToActionHint?: string;
    hashtags?: string[];
    heroImageUrls?: Array<string | null | undefined>;
  };
  calendar?: {
    eventId?: string;
    eventYear?: number;
    customPlan?: {
      id?: string;
      title: string;
      date: string;
      theme?: string;
      notes?: string;
      hashtags?: string[];
    };
    /** Links GeneratedContent back to ContentCalendarPlanEntry */
    planEntryId?: string;
    scheduledAt?: string | null;
    platforms?: OutcomePlatforms;
    publishNow?: boolean;
    useBrandTemplate?: boolean;
    brandTemplateId?: string;
    visualMode?: 'existing_template' | 'ai' | 'ai_baked_layout';
    /** Visual style preset chosen on the calendar plan */
    visualStyleId?: string | null;
  };
}

interface PublishingJobData {
  contentId: string;
  tenantId: string;
  platforms: string[];
}

async function runGeneration(data: GenerationJobData): Promise<void> {
  const { contentId, tenantId, engine, trends, competitor, newsletter, calendar, meme, carousel } =
    data;
  const trendsEngine = new TrendsEngine();
  const competitorEngine = new CompetitorEngine();
  const newsletterEngine = new NewsletterEngine();
  const memeEngine = new MemeEngine();
  const carouselEngine = new CarouselEngine();
  const libraryEngine = new LibraryEngine();
  const calendarEngine = new CalendarEngine();

  try {
    const before = await prisma.generatedContent.findFirst({
      where: { id: contentId, deletedAt: null },
      select: { status: true },
    });
    if (!before || before.status !== 'generating') {
      console.log(`[generate] skip ${contentId} — status=${before?.status ?? 'missing'}`);
      return;
    }

    switch (engine) {
      case ContentEngine.TRENDS:
        await trendsEngine.generate(tenantId, contentId, trends || {});
        break;
      case ContentEngine.COMPETITOR:
        await competitorEngine.generate(tenantId, contentId, competitor || {});
        break;
      case ContentEngine.NEWSLETTER:
        await newsletterEngine.generate(tenantId, contentId, newsletter || {});
        break;
      case ContentEngine.MEME:
        await memeEngine.generate(tenantId, contentId, meme || {});
        break;
      case ContentEngine.CAROUSEL:
        if (!carousel?.topic?.trim()) {
          throw new Error('Carousel generation requires a topic');
        }
        await carouselEngine.generate(tenantId, contentId, carousel);
        break;
      case ContentEngine.LIBRARY:
        await libraryEngine.generate(tenantId, contentId);
        break;
      case ContentEngine.CALENDAR:
        if (!calendar?.eventId && !calendar?.customPlan?.title) {
          throw new Error('Calendar generation requires eventId or customPlan');
        }
        await calendarEngine.generate(tenantId, contentId, calendar);
        break;
      case ContentEngine.BRAND_CHAT:
        throw new Error('Brand chat posts are created via Brand Studio chatbot, not the generate queue.');
    }
    const content = await prisma.generatedContent.findUniqueOrThrow({ where: { id: contentId } });
    if (calendar?.planEntryId || calendar?.customPlan?.id) {
      const { markPlanEntryFromGeneration } = await import(
        '../services/calendar-plan-schedule.service'
      );
      await markPlanEntryFromGeneration(
        calendar.planEntryId || calendar.customPlan?.id,
        contentId,
        'ready',
      );
    }
    if (content.status === 'pending_approval') {
      await notifyApprovalPending(content);
      await notifySuccess(
        tenantId,
        'Content ready for review',
        content.headline || 'New post generated',
        `/approvals/${contentId}`,
      );
    } else if (content.status === 'scheduled') {
      await notifySuccess(
        tenantId,
        'Post scheduled',
        `${content.headline || 'Calendar post'} · ${content.scheduledAt?.toISOString() || ''}`,
        `/calendar`,
      );
    }
  } catch (error) {
    if (isGenerationAbortedError(error)) {
      console.log(`[generate] aborted ${contentId}`);
      if (calendar?.planEntryId || calendar?.customPlan?.id) {
        const { markPlanEntryFromGeneration } = await import(
          '../services/calendar-plan-schedule.service'
        );
        await markPlanEntryFromGeneration(
          calendar.planEntryId || calendar.customPlan?.id,
          contentId,
          'failed',
          'Generation was aborted. Generate again from the calendar.',
        ).catch(() => undefined);
      }
      return;
    }
    const current = await prisma.generatedContent.findFirst({
      where: { id: contentId },
      select: { status: true },
    });
    if (current?.status === 'rejected') {
      console.log(`[generate] skipped failure write — already rejected ${contentId}`);
      return;
    }
    const msg = error instanceof Error ? error.message : String(error);
    if (calendar?.planEntryId || calendar?.customPlan?.id) {
      const { markPlanEntryFromGeneration } = await import(
        '../services/calendar-plan-schedule.service'
      );
      await markPlanEntryFromGeneration(
        calendar.planEntryId || calendar.customPlan?.id,
        contentId,
        'failed',
        msg,
      ).catch(() => undefined);
    }
    await prisma.generatedContent.update({
      where: { id: contentId },
      data: { status: 'failed', publishError: msg.slice(0, 500) },
    });
    await executionLogService.log({
      tenantId,
      contentId,
      workflowStep: 'generate:failed',
      engine,
      status: ExecutionStatus.HARD_FAILURE,
      message: msg,
    });
    const { reportIfCreditError } = await import('../services/provider-credit-alert.service');
    const credit = await reportIfCreditError(tenantId, error, 'generation');
    if (credit) {
      await prisma.generatedContent.update({
        where: { id: contentId },
        data: { publishError: credit.message.slice(0, 500) },
      });
    } else {
      await notifyWorkflowFailure('generate', msg, contentId, false, tenantId);
      await notifyError(tenantId, 'Generation failed', msg, `/approvals/${contentId}`);
    }
    throw error;
  }
}

/** Drop waiting/delayed Bull jobs for this content; active jobs bail via status checks. */
export async function cancelQueuedGeneration(contentId: string): Promise<void> {
  if (!contentGenerationQueue) return;
  try {
    const jobs = await contentGenerationQueue.getJobs(['waiting', 'delayed', 'paused', 'prioritized']);
    for (const job of jobs) {
      const data = job.data as GenerationJobData | undefined;
      if (data?.contentId !== contentId) continue;
      try {
        await job.remove();
      } catch (err) {
        console.warn(`[generate] could not remove job ${job.id}`, err);
      }
    }
  } catch (err) {
    console.warn('[generate] cancelQueuedGeneration failed', err);
  }
}

export async function enqueueContentGeneration(
  tenantId: string,
  engine: ContentEngine,
  trends?: GenerationJobData['trends'],
  competitor?: GenerationJobData['competitor'],
  calendar?: GenerationJobData['calendar'],
  newsletter?: GenerationJobData['newsletter'],
  meme?: GenerationJobData['meme'],
  carousel?: GenerationJobData['carousel'],
): Promise<string> {
  const brandTemplateId =
    trends?.brandTemplateId ||
    competitor?.brandTemplateId ||
    newsletter?.brandTemplateId ||
    meme?.brandTemplateId ||
    calendar?.brandTemplateId;
  const platforms =
    calendar?.platforms?.length
      ? calendar.platforms
      : trends?.platforms?.length
        ? trends.platforms
        : competitor?.platforms?.length
          ? competitor.platforms
          : newsletter?.platforms?.length
            ? newsletter.platforms
            : meme?.platforms?.length
              ? meme.platforms
              : carousel?.platforms?.length
                ? carousel.platforms
                : undefined;

  const content = await prisma.generatedContent.create({
    data: {
      tenantId,
      engine,
      status: 'generating',
      ...(trends?.topicId ? { topicId: trends.topicId } : {}),
      ...(brandTemplateId ? { brandTemplateId } : {}),
      ...(competitor?.competitorId ? { competitorId: competitor.competitorId } : {}),
      ...(newsletter?.libraryItemId
        ? { libraryItemId: newsletter.libraryItemId }
        : meme?.libraryItemId
          ? { libraryItemId: meme.libraryItemId }
          : {}),
      ...(newsletter?.newsletterTemplateId
        ? { newsletterTemplateId: newsletter.newsletterTemplateId }
        : {}),
      ...(platforms?.length ? { targetPlatforms: platforms } : {}),
      ...(calendar?.scheduledAt ? { scheduledAt: new Date(calendar.scheduledAt) } : {}),
    },
  });

  const job: GenerationJobData = {
    contentId: content.id,
    tenantId,
    engine,
    trends,
    competitor,
    newsletter,
    meme,
    carousel,
    calendar,
  };

  if (redisAvailable && contentGenerationQueue) {
    await contentGenerationQueue.add('generate', job);
  } else {
    setImmediate(() => {
      runGeneration(job).catch((err) => console.error('[inline-generate]', err));
    });
  }

  return content.id;
}

export async function enqueuePublishing(
  contentId: string,
  tenantId: string,
  platforms: string[],
  opts?: { runAt?: Date },
): Promise<void> {
  const job: PublishingJobData = { contentId, tenantId, platforms };
  const runAt = opts?.runAt;
  const delayMs =
    runAt && !Number.isNaN(runAt.getTime()) ? Math.max(0, runAt.getTime() - Date.now()) : 0;

  if (redisAvailable && contentPublishingQueue) {
    await contentPublishingQueue.add('publish', job, delayMs > 0 ? { delay: delayMs } : undefined);
    return;
  }

  if (delayMs > 0) {
    // Inline delayed publish (no Redis) — timer in-process
    setTimeout(() => {
      void publishDueContent(contentId, tenantId, platforms);
    }, delayMs);
    return;
  }

  setImmediate(() => {
    publishingService.publishToAll(job).catch((err) => console.error('[inline-publish]', err));
  });
}

async function publishDueContent(contentId: string, tenantId: string, platforms: string[]) {
  const row = await prisma.generatedContent.findFirst({
    where: { id: contentId, tenantId, deletedAt: null },
  });
  if (!row) return;
  if (row.status === 'published' || row.status === 'publishing') return;
  await publishingService
    .publishToAll({ contentId, tenantId, platforms })
    .catch((err) => console.error('[delayed-publish]', err));
}

/** Pick up scheduled posts whose time has passed (covers restarts / missed timers). */
export async function processDueScheduledPosts(): Promise<number> {
  const due = await prisma.generatedContent.findMany({
    where: {
      deletedAt: null,
      status: 'scheduled',
      scheduledAt: { lte: new Date() },
    },
    take: 20,
  });
  for (const row of due) {
    const platforms = (row.targetPlatforms || []) as string[];
    if (!platforms.length) {
      await prisma.generatedContent.update({
        where: { id: row.id },
        data: { status: 'pending_approval', publishError: 'Scheduled but no channels selected' },
      });
      continue;
    }
    await prisma.generatedContent.update({
      where: { id: row.id },
      data: { status: 'approved' },
    });
    await enqueuePublishing(row.id, row.tenantId, platforms);
  }
  return due.length;
}

function startSchedulePoller() {
  if (schedulePoller) return;
  const tick = () => {
    void processDueScheduledPosts().catch((err) =>
      console.error('[schedule-poller]', err),
    );
    void processDueAutomations().catch((err) =>
      console.error('[automation-poller]', err),
    );
    void processDueCalendarPlanEntries().catch((err) =>
      console.error('[calendar-plan-poller]', err),
    );
  };
  schedulePoller = setInterval(tick, 60_000);
  // Run once shortly after boot
  setTimeout(tick, 5_000);
}

export function startWorkers(): void {
  startSchedulePoller();

  if (!config.REDIS_URL) {
    console.log('[Workers] REDIS_URL unset — using inline job runner (deploy-friendly without Redis)');
    return;
  }

  try {
    const redis = new IORedis(config.REDIS_URL, {
      maxRetriesPerRequest: null,
      connectTimeout: 2000,
      lazyConnect: true,
      // Redis is optional locally — never keep retrying / crashing the process
      retryStrategy: () => null,
      enableOfflineQueue: false,
      showFriendlyErrorStack: false,
    });
    connection = redis;
    // Prevent "[ioredis] Unhandled error event" spam when Redis isn't running
    redis.on('error', () => {
      redisAvailable = false;
    });

    redis
      .connect()
      .then(() => {
        redisAvailable = true;
        contentGenerationQueue = new Queue(QUEUE_NAMES.CONTENT_GENERATION, { connection: redis });
        contentPublishingQueue = new Queue(QUEUE_NAMES.CONTENT_PUBLISHING, { connection: redis });

        new Worker<GenerationJobData>(
          QUEUE_NAMES.CONTENT_GENERATION,
          async (job: Job<GenerationJobData>) => runGeneration(job.data),
          { connection: redis, concurrency: 2 },
        );

        new Worker<PublishingJobData>(
          QUEUE_NAMES.CONTENT_PUBLISHING,
          async (job: Job<PublishingJobData>) => publishingService.publishToAll(job.data),
          { connection: redis, concurrency: 1 },
        );

        console.log('[Workers] Redis connected — queue workers active');
      })
      .catch(() => {
        redisAvailable = false;
        try {
          redis.disconnect();
        } catch {
          /* ignore */
        }
        connection = null;
        console.warn('[Workers] Redis unavailable — using inline job execution');
      });
  } catch {
    redisAvailable = false;
    console.warn('[Workers] Redis unavailable — using inline job execution');
  }
}
