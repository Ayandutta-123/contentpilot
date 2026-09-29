import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ContentEngine, ExecutionStatus, ApprovalAction, UserRole } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { enqueueContentGeneration, enqueuePublishing } from '../workers';
import { approvalService } from '../services/approval.service';
import { getRotationStatus } from '../services/rotation.service';
import { executionLogService } from '../services/execution-log.service';
import { asStringArray } from '../lib/json';

export async function contentRoutes(app: FastifyInstance) {
  app.post('/trends/discover', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    try {
      const body = z
        .object({
          days: z.number().int().min(1).max(30).optional(),
          perTopic: z.number().int().min(1).max(10).optional(),
        })
        .parse(request.body ?? {});
      const { startTrendsDiscoverJob } = await import('../services/trends-discover-job.service');
      const job = startTrendsDiscoverJob(request.session.tenantId!, body);
      return {
        success: true,
        data: {
          jobId: job.id,
          status: job.status,
          message: job.message,
          days: job.days,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Discover failed to start';
      return reply.status(502).send({ success: false, error: msg });
    }
  });

  app.get('/trends/discover/:jobId', { preHandler: requireAuth }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { getTrendsDiscoverJob } = await import('../services/trends-discover-job.service');
    const job = getTrendsDiscoverJob(request.session.tenantId!, jobId);
    if (!job) {
      return reply.status(404).send({ success: false, error: 'Discover job not found (it may have expired).' });
    }
    return {
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        message: job.message,
        days: job.days,
        completedTopics: job.completedTopics,
        totalTopics: job.totalTopics,
        currentTopicName: job.currentTopicName,
        candidates: job.candidates,
        topicErrors: job.topicErrors,
        error: job.error,
        creditAlert: job.creditAlert,
      },
      ...(job.creditAlert
        ? {
            meta: {
              code: 'PROVIDER_CREDITS',
              creditAlert: job.creditAlert,
            },
          }
        : {}),
    };
  });

  app.post('/trends/discover/:jobId/cancel', { preHandler: requireAuth }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { cancelTrendsDiscoverJob } = await import('../services/trends-discover-job.service');
    const job = cancelTrendsDiscoverJob(request.session.tenantId!, jobId);
    if (!job) {
      return reply.status(404).send({ success: false, error: 'Discover job not found (it may have expired).' });
    }
    return {
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        message: job.message,
        candidates: job.candidates,
      },
    };
  });

  app.get('/newsletter/meta', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const [providers, templates, formats, documents] = await Promise.all([
      import('../services/providers.service').then((m) => m.getProviderSettingsPublic(tenantId)),
      prisma.brandTemplate.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          provider: true,
          backgroundUrl: true,
          previewUrl: true,
          canvas: true,
        },
      }),
      prisma.newsletterTemplate.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: { rotationOrder: 'asc' },
        select: {
          id: true,
          name: true,
          productContext: true,
          generationRules: true,
          fillZones: true,
          lastUsedAt: true,
        },
      }),
      prisma.contentLibraryItem.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: { rotationOrder: 'asc' },
        select: {
          id: true,
          title: true,
          category: true,
          fileType: true,
          generationRules: true,
          lastUsedAt: true,
          extractedText: true,
        },
      }),
    ]);

    return {
      success: true,
      data: {
        newsletterMode: providers.newsletterMode,
        templates: templates.map((t) => {
          const canvas = t.canvas as { layers?: Array<{ fillMode?: string; editable?: boolean; type?: string; slot?: string; id?: string; fillType?: string; fillHint?: string; placidType?: string }> } | null;
          const dynamicLayers = (canvas?.layers || [])
            .filter((l) => l.fillMode === 'dynamic')
            .map((l) => ({
              id: l.slot || l.id || '',
              type: l.type || 'text',
              fillType: l.fillType || null,
              fillHint: l.fillHint || null,
              lineCount: typeof (l as { lineCount?: number }).lineCount === 'number'
                ? (l as { lineCount?: number }).lineCount
                : null,
              placidType: l.placidType || null,
            }));
          return {
            id: t.id,
            name: t.name,
            provider: t.provider,
            backgroundUrl: t.backgroundUrl,
            previewUrl: t.previewUrl,
            dynamicLayers,
          };
        }),
        formats,
        documents: documents.map(({ extractedText, ...d }) => ({
          ...d,
          textLength: extractedText?.length || 0,
          excerpt: (extractedText || '').slice(0, 220),
        })),
        llmProvider: providers.llmProvider,
        imageProvider: providers.imageProvider,
        hasLogo: Boolean(
          (
            await prisma.brandSettings.findUnique({
              where: { tenantId },
              select: { logoUrl: true },
            })
          )?.logoUrl,
        ),
      },
    };
  });

  app.get('/trends/meta', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const [providers, templates, topics] = await Promise.all([
      import('../services/providers.service').then((m) => m.getProviderSettingsPublic(tenantId)),
      prisma.brandTemplate.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, backgroundUrl: true, previewUrl: true },
      }),
      prisma.topic.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: { rotationOrder: 'asc' },
        select: { id: true, name: true, searchKeywords: true },
      }),
    ]);
    return {
      success: true,
      data: {
        trendsMode: providers.trendsMode,
        templates,
        topics,
        llmProvider: providers.llmProvider,
        imageProvider: providers.imageProvider,
        searchProvider: providers.searchProvider,
      },
    };
  });

  app.get('/memes/meta', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const [providers, templates, brand, documents] = await Promise.all([
      import('../services/providers.service').then((m) => m.getProviderSettingsPublic(tenantId)),
      prisma.brandTemplate.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          provider: true,
          backgroundUrl: true,
          previewUrl: true,
        },
      }),
      prisma.brandSettings.findUnique({
        where: { tenantId },
        select: {
          targetCountries: true,
          industry: true,
          companyName: true,
          websiteUrl: true,
          brandVoice: true,
          contentGuidelines: true,
        },
      }),
      prisma.contentLibraryItem.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: { updatedAt: 'desc' },
        take: 40,
        select: { id: true, title: true },
      }),
    ]);
    const { normalizeTargetCountries, countryLabels, MARKET_COUNTRIES } = await import(
      '../lib/market-countries'
    );
    const { MEME_FORMAT_CATALOG } = await import('../services/meme-format-catalog');
    const countries = normalizeTargetCountries(brand?.targetCountries);
    return {
      success: true,
      data: {
        templates,
        documents,
        countries,
        countryLabels: countryLabels(brand?.targetCountries),
        countryOptions: MARKET_COUNTRIES.map((c) => ({ code: c.code, label: c.label })),
        formats: MEME_FORMAT_CATALOG.map((f) => ({
          id: f.id,
          label: f.label,
          structure: f.structure,
          heat: f.heat,
        })),
        llmProvider: providers.llmProvider,
        imageProvider: providers.imageProvider,
        searchProvider: providers.searchProvider,
        hasApify: Boolean(providers.apifyApiTokenSet),
        industry: brand?.industry || '',
        companyName: brand?.companyName || '',
        websiteUrl: brand?.websiteUrl || '',
        // Whether Settings → Company already holds scraped website context
        hasBrandContext: Boolean(
          (brand?.brandVoice || '').trim() || (brand?.contentGuidelines || '').trim(),
        ),
      },
    };
  });

  app.get('/carousel/meta', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const [providers, brand] = await Promise.all([
      import('../services/providers.service').then((m) => m.getProviderSettingsPublic(tenantId)),
      prisma.brandSettings.findUnique({
        where: { tenantId },
        select: { companyName: true, industry: true, brandType: true },
      }),
    ]);
    const { CAROUSEL_MIN_SLIDES, CAROUSEL_MAX_SLIDES } = await import('../lib/carousel-parse');
    return {
      success: true,
      data: {
        companyName: brand?.companyName || '',
        industry: brand?.industry || '',
        brandType: brand?.brandType || 'b2b',
        minSlides: CAROUSEL_MIN_SLIDES,
        maxSlides: CAROUSEL_MAX_SLIDES,
        defaultSlides: 3,
        llmProvider: providers.llmProvider,
        imageProvider: providers.imageProvider,
        note: 'Multi-image publish works on Instagram. LinkedIn/Facebook receive the cover slide.',
      },
    };
  });

  /** Parse PDF / image / spreadsheet / text so the carousel hub can feed it to the LLM like ChatGPT. */
  app.post(
    '/carousel/parse-attachment',
    { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) },
    async (request, reply) => {
      const data = await request.file();
      if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });

      const buffer = await data.toBuffer();
      if (buffer.length > 12 * 1024 * 1024) {
        return reply.status(400).send({ success: false, error: 'File too large (max 12MB)' });
      }

      try {
        const { parseCarouselAttachment } = await import('../services/carousel-attachment.service');
        const parsed = await parseCarouselAttachment({
          tenantId: request.session.tenantId!,
          fileName: data.filename || 'attachment',
          mimeType: data.mimetype || '',
          buffer,
        });
        return { success: true, data: parsed };
      } catch (err) {
        const { toProviderCreditError } = await import('../lib/provider-credits');
        const credit = toProviderCreditError(err, undefined, 'caption');
        if (credit) {
          return reply.status(402).send({
            success: false,
            error: credit.message,
            code: 'PROVIDER_CREDITS',
            data: credit.toJSON(),
          });
        }
        const message = err instanceof Error ? err.message : 'Failed to parse attachment';
        return reply.status(400).send({ success: false, error: message });
      }
    },
  );

  /** Upload an optional exact hero image to use on a carousel slide during generation. */
  app.post(
    '/carousel/upload-hero',
    { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) },
    async (request, reply) => {
      const data = await request.file();
      if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });
      if (!data.mimetype.startsWith('image/')) {
        return reply.status(400).send({ success: false, error: 'Please upload an image' });
      }
      const buffer = await data.toBuffer();
      if (buffer.length > 12 * 1024 * 1024) {
        return reply.status(400).send({ success: false, error: 'Image too large (max 12MB)' });
      }
      const { storeOriginalImage } = await import('../lib/store-upload');
      const stored = await storeOriginalImage({
        tenantId: request.session.tenantId!,
        subdir: 'carousel-heroes',
        buffer,
        originalFilename: data.filename || 'hero.png',
        mimetype: data.mimetype,
        logLabel: 'carousel-hero',
      });
      return { success: true, data: { publicUrl: stored.publicUrl } };
    },
  );

  app.post('/memes/discover', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    try {
      const body = z
        .object({
          limit: z.number().int().min(5).max(40).optional(),
        })
        .parse(request.body ?? {});
      const tenantId = request.session.tenantId!;
      const { discoverMemeCandidates } = await import('../services/meme-discover.service');
      const data = await discoverMemeCandidates(tenantId, body);
      // Retain like competitor scrapes so a reload still shows the last discover.
      if (data.candidates.length) {
        const { persistMemeCandidates } = await import('../services/discover-scrape-store.service');
        await persistMemeCandidates(tenantId, data.candidates, {
          providersTried: data.providersTried,
          primaryProvider: data.primaryProvider,
        }).catch((err) => request.log.warn({ err }, 'meme scrape persist failed'));
      }
      return { success: true, data };
    } catch (err) {
      const { replyProviderCredit } = await import('../services/provider-credit-alert.service');
      if (await replyProviderCredit(reply, request.session.tenantId, err, 'search')) return;
      const msg = err instanceof Error ? err.message : 'Meme discover failed';
      return reply.status(502).send({ success: false, error: msg });
    }
  });

  app.get('/memes/scraped', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const query = request.query as { limit?: string };
    const { listScrapedMemeCandidates } = await import('../services/discover-scrape-store.service');
    const data = await listScrapedMemeCandidates(tenantId, {
      limit: query.limit ? parseInt(query.limit, 10) : 80,
    });
    return { success: true, data };
  });

  app.get('/trends/scraped', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const query = request.query as { limit?: string };
    const { listScrapedTrendCandidates } = await import('../services/discover-scrape-store.service');
    const { candidates, scrapedAt } = await listScrapedTrendCandidates(tenantId, {
      limit: query.limit ? parseInt(query.limit, 10) : 80,
    });
    return { success: true, data: { candidates, scrapedAt } };
  });

  app.get('/competitors/meta', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const [providers, templates, competitors] = await Promise.all([
      import('../services/providers.service').then((m) => m.getProviderSettingsPublic(tenantId)),
      prisma.brandTemplate.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, backgroundUrl: true, previewUrl: true },
      }),
      prisma.competitor.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          handle: true,
          platform: true,
          profileUrl: true,
          socialUrls: true,
          lastUsedAt: true,
        },
      }),
    ]);
    return {
      success: true,
      data: {
        competitorMode: providers.competitorMode,
        competitorImageMode: providers.competitorImageMode,
        templates,
        competitors,
        llmProvider: providers.llmProvider,
        imageProvider: providers.imageProvider,
        scrapingProvider: providers.scrapingProvider,
        apifyConfigured: providers.apifyApiTokenSet,
      },
    };
  });

  app.get('/competitors/posts', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const query = request.query as { competitorId?: string; limit?: string; platforms?: string };
    const { listScrapedCompetitorPosts } = await import('../services/competitor-monitor.service');
    const platforms = (query.platforms || '')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter((p) => ['instagram', 'linkedin', 'facebook', 'twitter'].includes(p));
    const posts = await listScrapedCompetitorPosts(tenantId, {
      competitorId: query.competitorId || undefined,
      platforms: platforms.length ? platforms : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 50,
    });
    return { success: true, data: { posts } };
  });

  /**
   * Proxy Instagram / social CDN images so Competitor Monitor thumbnails are not
   * blocked by hotlink / referrer checks in the browser.
   */
  app.get('/image-proxy', { preHandler: requireAuth }, async (request, reply) => {
    const raw = String((request.query as { url?: string }).url || '').trim();
    if (!raw) return reply.status(400).send({ success: false, error: 'url required' });

    const {
      isAllowedMediaHost,
      isRemoteHttpUrl,
      fetchImageBytes,
      storeCachedImageBuffer,
    } = await import('../lib/cache-remote-image');
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    if (!isRemoteHttpUrl(decoded) || !isAllowedMediaHost(decoded)) {
      return reply.status(400).send({ success: false, error: 'Unsupported image host' });
    }

    try {
      const fetched = await fetchImageBytes(decoded);
      if (!fetched) {
        return reply.status(502).send({
          success: false,
          error: 'Upstream image failed',
        });
      }
      const tenantId = request.session.tenantId;
      if (tenantId) {
        try {
          storeCachedImageBuffer(tenantId, decoded, fetched.buf, fetched.ctype);
        } catch {
          /* non-fatal */
        }
      }
      const ctype = fetched.ctype.startsWith('image/') ? fetched.ctype : 'image/jpeg';
      reply.header('Content-Type', ctype);
      reply.header('Cache-Control', 'private, max-age=3600');
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      return reply.send(fetched.buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Proxy failed';
      return reply.status(502).send({ success: false, error: msg });
    }
  });

  app.post('/competitors/scrape', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    try {
      const body = z
        .object({
          competitorId: z.string().uuid().optional(),
          /** Only scrape these networks (must match saved competitor URLs). Empty = all saved. */
          platforms: z
            .array(z.enum(['instagram', 'linkedin', 'facebook', 'twitter']))
            .optional(),
        })
        .parse(request.body ?? {});
      const { startCompetitorScrapeJob } = await import('../services/competitor-scrape-job.service');
      const job = startCompetitorScrapeJob(request.session.tenantId!, {
        competitorId: body.competitorId,
        platforms: body.platforms,
      });
      return {
        success: true,
        data: {
          jobId: job.id,
          status: job.status,
          message: job.message,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Scrape failed to start';
      return reply.status(502).send({ success: false, error: msg });
    }
  });

  app.get('/competitors/scrape/:jobId', { preHandler: requireAuth }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const { getScrapeJob } = await import('../services/competitor-scrape-job.service');
    const job = getScrapeJob(request.session.tenantId!, jobId);
    if (!job) {
      return reply.status(404).send({ success: false, error: 'Scrape job not found (it may have expired).' });
    }
    return {
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        message: job.message,
        scraped: job.scraped,
        competitors: job.competitors,
        errors: job.errors,
        error: job.error,
        posts: job.posts,
        creditAlert: job.creditAlert,
      },
      ...(job.creditAlert
        ? {
            meta: {
              code: 'PROVIDER_CREDITS',
              creditAlert: job.creditAlert,
            },
          }
        : {}),
    };
  });

  app.get('/calendar/events', { preHandler: requireAuth }, async (request) => {
    const query = request.query as {
      year?: string;
      month?: string;
      regions?: string;
      categories?: string;
    };
    const year = parseInt(query.year || String(new Date().getFullYear()), 10);
    const month = query.month ? parseInt(query.month, 10) : undefined;
    const regions = (query.regions || '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean) as Array<'india' | 'gcc' | 'europe' | 'usa' | 'global'>;
    const categories = (query.categories || '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean) as Array<'tech' | 'festival' | 'national' | 'observance'>;

    const { listFestivalEvents, CALENDAR_REGIONS, CALENDAR_CATEGORIES, countCatalogEntries } =
      await import('../data/festival-calendar');
    const events = listFestivalEvents({
      year,
      month: month && month >= 1 && month <= 12 ? month : undefined,
      regions: regions.length ? regions : undefined,
      categories: categories.length ? categories : undefined,
    });

    const scheduled = await prisma.generatedContent.findMany({
      where: {
        tenantId: request.session.tenantId!,
        deletedAt: null,
        engine: 'calendar',
        OR: [
          { status: 'scheduled' },
          {
            status: { in: ['pending_approval', 'generating', 'publishing', 'published'] },
            sourceReference: { startsWith: 'calendar:' },
          },
        ],
      },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
      select: {
        id: true,
        headline: true,
        status: true,
        scheduledAt: true,
        targetPlatforms: true,
        sourceReference: true,
        createdAt: true,
        imageUrl: true,
      },
    });

    return {
      success: true,
      data: {
        year,
        month: month || null,
        regions: CALENDAR_REGIONS,
        categories: CALENDAR_CATEGORIES,
        catalogSize: countCatalogEntries(),
        events,
        scheduledPosts: scheduled,
      },
    };
  });

  app.get('/calendar/meta', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const [connections, templates] = await Promise.all([
      prisma.platformConnection.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        select: { id: true, platform: true, accountName: true },
        orderBy: { platform: 'asc' },
      }),
      // Slim list only — full /brand/templates payloads (canvas) are too heavy for this picker
      prisma.brandTemplate.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, provider: true, isActive: true, previewUrl: true },
      }),
    ]);
    const { CALENDAR_REGIONS, CALENDAR_CATEGORIES, countCatalogEntries } = await import(
      '../data/festival-calendar'
    );
    return {
      success: true,
      data: {
        regions: CALENDAR_REGIONS,
        categories: CALENDAR_CATEGORIES,
        catalogSize: countCatalogEntries(),
        platforms: connections,
        templates,
      },
    };
  });

  app.post('/calendar/plan/parse', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request) => {
    const body = z
      .object({
        text: z.string().min(1).max(100_000),
        year: z.number().int().min(2024).max(2035).optional(),
        month: z.number().int().min(1).max(12).optional(),
        monthOnly: z.boolean().optional().default(true),
      })
      .parse(request.body ?? {});

    const { parseCalendarPlanText, filterPlanForMonth } = await import(
      '../services/calendar-plan.service'
    );
    const year = body.year || new Date().getFullYear();
    const month = body.month || new Date().getMonth() + 1;
    const parsed = parseCalendarPlanText(body.text, { year, month });
    const entries = body.monthOnly ? filterPlanForMonth(parsed.entries, year, month) : parsed.entries;
    const warnings = [...parsed.warnings];
    const outsideMonth = body.monthOnly ? parsed.entries.length - entries.length : 0;
    if (outsideMonth > 0) {
      warnings.unshift(
        `${outsideMonth} exact dated row(s) belong to another month and were not added to ${year}-${String(month).padStart(2, '0')}. Switch the calendar month to import them.`,
      );
    }
    if (body.monthOnly && parsed.entries.length && !entries.length) {
      warnings.push(
        `Parsed ${parsed.entries.length} idea(s), but none fall in ${year}-${String(month).padStart(2, '0')}. Check dates or change the month.`,
      );
    }

    const brand = await prisma.brandSettings.findUnique({
      where: { tenantId: request.session.tenantId! },
      select: { companyName: true },
    });

    return {
      success: true,
      data: {
        year,
        month,
        companyName: brand?.companyName || '',
        entries,
        warnings,
        totalParsed: parsed.entries.length,
      },
    };
  });

  app.post('/calendar/plan/upload', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ success: false, error: 'Attach an Excel or CSV file.' });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) {
      return reply.status(400).send({ success: false, error: 'Uploaded file is empty.' });
    }

    const q = request.query as { year?: string; month?: string; monthOnly?: string };
    const year = parseInt(q.year || String(new Date().getFullYear()), 10);
    const month = parseInt(q.month || String(new Date().getMonth() + 1), 10);
    const monthOnly = q.monthOnly !== 'false';

    const name = (file.filename || '').toLowerCase();
    const {
      parseCalendarPlanText,
      parseCalendarPlanWorkbook,
      filterPlanForMonth,
    } = await import('../services/calendar-plan.service');

    const isExcel = /\.xlsx?$/.test(name) || /sheet|excel|spreadsheet/.test(file.mimetype || '');
    const parsed = isExcel
      ? parseCalendarPlanWorkbook(buffer, { year, month })
      : parseCalendarPlanText(buffer.toString('utf8'), { year, month });

    const entries = monthOnly ? filterPlanForMonth(parsed.entries, year, month) : parsed.entries;
    const warnings = [...parsed.warnings];
    const outsideMonth = monthOnly ? parsed.entries.length - entries.length : 0;
    if (outsideMonth > 0) {
      warnings.unshift(
        `${outsideMonth} exact dated row(s) belong to another month and were not added to ${year}-${String(month).padStart(2, '0')}. Switch the calendar month to import them.`,
      );
    }
    if (monthOnly && parsed.entries.length && !entries.length) {
      warnings.push(
        `Parsed ${parsed.entries.length} idea(s), but none fall in ${year}-${String(month).padStart(2, '0')}. Check dates or change the month.`,
      );
    }

    const brand = await prisma.brandSettings.findUnique({
      where: { tenantId: request.session.tenantId! },
      select: { companyName: true },
    });

    return {
      success: true,
      data: {
        year,
        month,
        companyName: brand?.companyName || '',
        entries,
        warnings,
        totalParsed: parsed.entries.length,
        fileName: file.filename,
        format: isExcel ? 'excel' : 'text',
      },
    };
  });

  app.get('/calendar/plan/template.xlsx', { preHandler: requireAuth }, async (request, reply) => {
    const q = request.query as { year?: string; month?: string };
    const year = parseInt(q.year || String(new Date().getFullYear()), 10);
    const month = parseInt(q.month || String(new Date().getMonth() + 1), 10);
    const { buildCalendarPlanTemplateBuffer } = await import('../services/calendar-plan.service');
    const buf = buildCalendarPlanTemplateBuffer({ year, month });
    reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .header(
        'Content-Disposition',
        `attachment; filename="content-calendar-template-${year}-${String(month).padStart(2, '0')}.xlsx"`,
      )
      .send(buf);
  });

  app.post('/calendar/plan/ai/generate', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    try {
      const body = z
        .object({
          year: z.number().int().min(2024).max(2035),
          month: z.number().int().min(1).max(12),
          suggestions: z.string().max(4000).optional().default(''),
          contentTypes: z.array(z.string().max(60)).max(12).optional().default([]),
          postsPerMonth: z.number().int().min(4).max(60).optional().default(12),
          carouselCount: z.number().int().min(0).max(30).optional().default(3),
          carouselSlides: z.number().int().min(3).max(12).optional().default(6),
          preferredWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional().default([]),
        })
        .parse(request.body ?? {});
      const { generateAiCalendarPlan } = await import('../services/calendar-plan-ai.service');
      const data = await generateAiCalendarPlan(request.session.tenantId!, {
        ...body,
        carouselCount: Math.min(body.carouselCount, body.postsPerMonth),
      });
      return { success: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI calendar failed';
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.post('/calendar/plan/ai/revise', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    try {
      const body = z
        .object({
          year: z.number().int().min(2024).max(2035),
          month: z.number().int().min(1).max(12),
          instruction: z.string().min(2).max(4000),
          entries: z
            .array(
              z.object({
                id: z.string().optional(),
                date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
                title: z.string().min(2).max(180),
                theme: z.string().max(240).optional().default(''),
                notes: z.string().max(12_000).optional().default(''),
                hashtags: z.array(z.string()).optional().default([]),
                carouselSlideCount: z.number().int().min(3).max(12).nullable().optional(),
              }),
            )
            .min(1)
            .max(200),
        })
        .parse(request.body ?? {});
      const { reviseAiCalendarPlan } = await import('../services/calendar-plan-ai.service');
      const data = await reviseAiCalendarPlan(request.session.tenantId!, {
        year: body.year,
        month: body.month,
        instruction: body.instruction,
        entries: body.entries.map((e) => ({
          id: e.id || crypto.randomUUID(),
          date: e.date,
          title: e.title,
          theme: e.theme,
          notes: e.notes,
          hashtags: e.hashtags,
          carouselSlideCount: e.carouselSlideCount ?? null,
        })),
      });
      return { success: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Revision failed';
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.post('/calendar/plan/export.xlsx', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const body = z
        .object({
          entries: z
            .array(
              z.object({
                date: z.string(),
                title: z.string(),
                theme: z.string().optional().default(''),
                notes: z.string().optional().default(''),
                hashtags: z.array(z.string()).optional().default([]),
                carouselSlideCount: z.number().nullable().optional(),
              }),
            )
            .min(1)
            .max(200),
        })
        .parse(request.body ?? {});
      const { buildCalendarPlanExportBuffer } = await import('../services/calendar-plan.service');
      const buf = buildCalendarPlanExportBuffer(body.entries);
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header(
          'Content-Disposition',
          `attachment; filename="content-calendar-${body.entries[0]!.date.slice(0, 7)}.xlsx"`,
        )
        .send(buf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.get('/calendar/plan/saved', { preHandler: requireAuth }, async (request) => {
    const q = z
      .object({
        year: z.coerce.number().int().min(2024).max(2035).optional(),
        month: z.coerce.number().int().min(1).max(12).optional(),
      })
      .parse(request.query ?? {});
    const { listContentCalendarPlans, getActivePlanForMonth } = await import(
      '../services/calendar-plan-schedule.service'
    );
    const { COMMON_TIMEZONES } = await import('../lib/timezone-wallclock');
    const { VISUAL_STYLE_PRESETS } = await import('../providers/images/social-frame');
    const plans = await listContentCalendarPlans(
      request.session.tenantId!,
      q.year,
      q.month,
    );
    const active =
      q.year && q.month
        ? await getActivePlanForMonth(request.session.tenantId!, q.year, q.month)
        : null;
    return {
      success: true,
      data: {
        plans,
        active,
        timezones: COMMON_TIMEZONES,
        visualStyles: VISUAL_STYLE_PRESETS.filter((p) => p.id !== 'custom').map((p) => ({
          id: p.id,
          label: p.label,
        })),
      },
    };
  });

  app.delete('/calendar/plan/saved/:planId', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { planId } = z
      .object({ planId: z.string().uuid() })
      .parse(request.params);
    const { deleteContentCalendarPlan } = await import(
      '../services/calendar-plan-schedule.service'
    );
    const deleted = await deleteContentCalendarPlan(request.session.tenantId!, planId);
    if (!deleted) {
      return reply.status(404).send({ success: false, error: 'Saved calendar not found.' });
    }
    return {
      success: true,
      data: { id: planId, message: 'Saved calendar deleted.' },
    };
  });

  app.post('/calendar/plan/saved/:planId/entries/:entryId/generate', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { planId, entryId } = z
      .object({
        planId: z.string().uuid(),
        entryId: z.string().uuid(),
      })
      .parse(request.params);
    const body = z
      .object({
        visualMode: z.enum(['existing_template', 'ai', 'ai_baked_layout']).optional(),
        brandTemplateId: z.string().uuid().optional().nullable(),
      })
      .parse(request.body ?? {});
    if (body.visualMode === 'existing_template' && !body.brandTemplateId) {
      return reply.status(400).send({
        success: false,
        error: 'Pick a Brand Studio template, or choose AI photo + LLM layout / AI painted poster.',
      });
    }
    const { generateManualPlanEntry } = await import(
      '../services/calendar-plan-schedule.service'
    );
    try {
      const contentId = await generateManualPlanEntry(
        request.session.tenantId!,
        planId,
        entryId,
        {
          visualMode: body.visualMode,
          brandTemplateId: body.brandTemplateId,
        },
      );
      return {
        success: true,
        data: {
          contentId,
          message: 'Generation started. Opening Approvals when ready…',
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not generate entry';
      return reply.status(400).send({ success: false, error: message });
    }
  });

  app.post('/calendar/plan/save', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const body = z
      .object({
        year: z.number().int().min(2024).max(2035),
        month: z.number().int().min(1).max(12),
        name: z.string().max(120).optional(),
        source: z.enum(['ai', 'upload']).optional().default('upload'),
        runTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        timezone: z.string().min(1).max(80),
        executionMode: z.enum(['automatic', 'manual']).optional().default('automatic'),
        visualMode: z.enum(['existing_template', 'ai', 'ai_baked_layout']).optional().default('ai'),
        visualStyleId: z.string().max(60).optional(),
        brandTemplateId: z.string().uuid().optional().nullable(),
        entries: z
          .array(
            z.object({
              id: z.string().optional(),
              date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              title: z.string().min(2).max(180),
              theme: z.string().max(240).optional().default(''),
              notes: z.string().max(12_000).optional().default(''),
              hashtags: z.array(z.string()).optional().default([]),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(request.body ?? {});

    const useBrandTemplate = body.visualMode === 'existing_template';
    if (useBrandTemplate && !body.brandTemplateId) {
      return reply.status(400).send({
        success: false,
        error: 'Pick a Brand Studio template, or choose AI photo + LLM layout / AI painted poster.',
      });
    }

    const brand = await prisma.brandSettings.findUnique({
      where: { tenantId: request.session.tenantId! },
      select: { companyName: true },
    });
    if (!brand?.companyName?.trim()) {
      return reply.status(400).send({
        success: false,
        error: 'Set company name in Settings → Brand before saving a calendar plan.',
      });
    }

    const { saveContentCalendarPlan } = await import('../services/calendar-plan-schedule.service');
    try {
      const entriesByMonth = new Map<string, typeof body.entries>();
      for (const entry of body.entries) {
        const entryYear = Number(entry.date.slice(0, 4));
        const entryMonth = Number(entry.date.slice(5, 7));
        if (entryYear < 2024 || entryYear > 2035 || entryMonth < 1 || entryMonth > 12) {
          throw new Error(`Entry "${entry.title}" has an unsupported date: ${entry.date}.`);
        }
        const key = `${entryYear}-${String(entryMonth).padStart(2, '0')}`;
        const group = entriesByMonth.get(key) || [];
        group.push(entry);
        entriesByMonth.set(key, group);
      }

      const plans: Awaited<ReturnType<typeof saveContentCalendarPlan>>[] = [];
      for (const [key, entries] of entriesByMonth) {
        const [entryYear, entryMonth] = key.split('-').map(Number);
        const monthName = new Date(entryYear!, entryMonth! - 1, 1).toLocaleString('en', {
          month: 'short',
          year: 'numeric',
        });
        const groupedName =
          entriesByMonth.size > 1
            ? `${body.name?.trim() || 'Uploaded plan'} · ${monthName}`.slice(0, 120)
            : body.name;
        plans.push(
          await saveContentCalendarPlan({
            tenantId: request.session.tenantId!,
            year: entryYear!,
            month: entryMonth!,
            name: groupedName,
            source: body.source === 'ai' ? 'ai' : 'upload',
            runTime: body.runTime,
            timezone: body.timezone,
            executionMode: body.executionMode,
            visualMode: body.visualMode,
            visualStyleId: body.visualStyleId,
            brandTemplateId: body.brandTemplateId,
            entries,
          }),
        );
      }

      const allEntries = plans.flatMap((plan) => plan.entries);
      const pending = allEntries.filter((entry) => entry.status === 'pending').length;
      const manual = allEntries.filter((entry) => entry.status === 'manual').length;
      const skipped = allEntries.filter((entry) => entry.status === 'skipped').length;

      return {
        success: true,
        data: {
          plan: plans[0],
          plans,
          companyName: brand.companyName,
          message:
            body.executionMode === 'manual'
              ? `Saved ${manual} idea(s) across ${plans.length} month calendar(s) in calendar-only mode.`
              : `Saved ${allEntries.length} idea(s) across ${plans.length} month calendar(s). ${pending} scheduled for ${body.runTime} (${body.timezone})${skipped ? ` · ${skipped} past date(s) skipped` : ''}.`,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not save plan';
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.post('/calendar/plan/generate', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const body = z
      .object({
        entries: z
          .array(
            z.object({
              id: z.string().optional(),
              date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              title: z.string().min(2).max(180),
              theme: z.string().max(240).optional().default(''),
              notes: z.string().max(12_000).optional().default(''),
              hashtags: z.array(z.string()).optional().default([]),
            }),
          )
          .min(1)
          .max(200),
        visualMode: z.enum(['existing_template', 'ai', 'ai_baked_layout']).optional().default('ai'),
        brandTemplateId: z.string().uuid().optional().nullable(),
        useBrandTemplate: z.boolean().optional(),
      })
      .parse(request.body ?? {});

    const useBrandTemplate =
      body.useBrandTemplate ?? body.visualMode === 'existing_template';
    if (useBrandTemplate && !body.brandTemplateId) {
      return reply.status(400).send({
        success: false,
        error: 'Pick a Brand Studio template, or choose Generate entire by AI.',
      });
    }

    const brand = await prisma.brandSettings.findUnique({
      where: { tenantId: request.session.tenantId! },
      select: { companyName: true },
    });
    if (!brand?.companyName?.trim()) {
      return reply.status(400).send({
        success: false,
        error: 'Set company name in Settings → Brand before generating calendar content.',
      });
    }

    const tenantId = request.session.tenantId!;
    const contentIds: string[] = [];

    for (const entry of body.entries) {
      const contentId = await enqueueContentGeneration(
        tenantId,
        ContentEngine.CALENDAR,
        undefined,
        undefined,
        {
          customPlan: {
            id: entry.id || undefined,
            title: entry.title,
            date: entry.date,
            theme: entry.theme,
            notes: entry.notes,
            hashtags: entry.hashtags,
          },
          // Always human approval — no auto-publish for uploaded plans
          platforms: [],
          publishNow: false,
          scheduledAt: null,
          useBrandTemplate,
          brandTemplateId: useBrandTemplate ? body.brandTemplateId || undefined : undefined,
          visualMode: body.visualMode,
        },
      );
      contentIds.push(contentId);
    }

    return {
      success: true,
      data: {
        contentIds,
        count: contentIds.length,
        companyName: brand.companyName,
        message: `${contentIds.length} calendar post(s) queued for Approvals.`,
      },
    };
  });

  app.post('/calendar/generate', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const body = z
      .object({
        eventId: z.string().min(1),
        eventYear: z.number().int().min(2024).max(2035).optional(),
        mode: z.enum(['now', 'scheduled']),
        /** When mode=now: review | publish immediately */
        publishMode: z.enum(['review', 'publish']).optional().default('review'),
        scheduledAt: z.string().min(1).optional().nullable(),
        /** Optional for review-only; required when publishing or scheduling publish */
        platforms: z
          .array(z.enum(['instagram', 'linkedin', 'facebook', 'twitter']))
          .optional()
          .default([]),
        /** existing_template = Brand Studio plate; ai = full AI image */
        visualMode: z.enum(['existing_template', 'ai', 'ai_baked_layout']).optional().default('ai'),
        brandTemplateId: z.string().uuid().optional().nullable(),
        useBrandTemplate: z.boolean().optional(),
      })
      .parse(request.body ?? {});

    const publishNow = body.mode === 'now' && body.publishMode === 'publish';
    const needsChannels = publishNow || body.mode === 'scheduled';
    if (needsChannels && !body.platforms.length) {
      return reply.status(400).send({
        success: false,
        error: 'Select at least one connected channel to publish or schedule.',
      });
    }

    if (body.mode === 'scheduled') {
      if (!body.scheduledAt) {
        return reply.status(400).send({ success: false, error: 'Pick a date/time to schedule.' });
      }
      const when = new Date(body.scheduledAt);
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now() - 60_000) {
        return reply.status(400).send({ success: false, error: 'Schedule time must be in the future.' });
      }
    }

    const useBrandTemplate =
      body.useBrandTemplate ?? body.visualMode === 'existing_template';
    if (useBrandTemplate && !body.brandTemplateId) {
      return reply.status(400).send({
        success: false,
        error: 'Pick a Brand Studio template, or choose Generate entire by AI.',
      });
    }

    const { getFestivalById } = await import('../data/festival-calendar');
    const event = getFestivalById(body.eventId, body.eventYear);
    if (!event) {
      return reply.status(404).send({ success: false, error: 'Festival / event not found.' });
    }

    const contentId = await enqueueContentGeneration(
      request.session.tenantId!,
      ContentEngine.CALENDAR,
      undefined,
      undefined,
      {
        eventId: body.eventId,
        eventYear: body.eventYear ?? new Date(event.date).getFullYear(),
        scheduledAt: body.mode === 'scheduled' ? body.scheduledAt : null,
        platforms: body.platforms,
        publishNow,
        useBrandTemplate,
        brandTemplateId: useBrandTemplate ? body.brandTemplateId || undefined : undefined,
        visualMode: body.visualMode,
      },
    );

    return {
      success: true,
      data: {
        contentId,
        event,
        mode: body.mode,
        publishMode: body.publishMode,
        visualMode: body.visualMode,
      },
    };
  });

  app.post('/generate', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request) => {
    const body = z
      .object({
        engine: z.nativeEnum(ContentEngine),
        topicId: z.string().uuid().optional(),
        useBrandTemplate: z.boolean().optional(),
        brandTemplateId: z.string().uuid().optional().nullable(),
        brandTemplateIds: z.array(z.string().uuid()).optional(),
        scrapedPostId: z.string().uuid().optional(),
        competitorId: z.string().uuid().optional(),
        refreshScrape: z.boolean().optional(),
        /** Override Settings → competitor image mode for this run */
        competitorImageMode: z.enum(['new_topic', 'near_mirror']).optional(),
        newsletterTemplateId: z.string().uuid().optional().nullable(),
        libraryItemId: z.string().uuid().optional().nullable(),
        libraryItemIds: z.array(z.string().uuid()).optional(),
        generationRules: z.string().max(8000).optional(),
        /** Per dynamic text slot: professional | headline | bullets | paragraph | keep */
        slotFillStyles: z.record(z.string().max(80), z.enum(['professional', 'headline', 'bullets', 'paragraph', 'keep'])).optional(),
        freeform: z.boolean().optional(),
        includeLogo: z.boolean().optional(),
        visualMode: z.enum(['existing_template', 'ai', 'ai_baked_layout']).optional(),
        sources: z
          .array(
            z.object({
              title: z.string(),
              url: z.string().optional().default(''),
              snippet: z.string().optional().default(''),
              publishedDate: z.string().optional(),
              topicId: z.string().optional(),
              topicName: z.string().optional(),
              suggestedFormatId: z.string().optional(),
              imageUrl: z.string().optional(),
              imageUrls: z.array(z.string()).optional(),
              postText: z.string().optional(),
            }),
          )
          .optional(),
        preferredFormatId: z.string().optional(),
        referenceImageUrl: z.string().optional().nullable(),
        contentSource: z.enum(['product', 'brand', 'both']).optional(),
        /** Dedicated carousel hub */
        topic: z.string().min(2).max(300).optional(),
        brief: z.string().max(16000).optional(),
        slideCount: z.number().int().min(2).max(10).optional(),
        callToActionHint: z.string().max(200).optional(),
        hashtags: z.array(z.string().max(60)).max(12).optional(),
        platforms: z
          .array(z.enum(['instagram', 'linkedin', 'facebook', 'twitter']))
          .max(4)
          .optional(),
        visualStyleId: z.string().max(80).optional().nullable(),
        /** Optional exact hero images per slide (carousel). */
        heroImageUrls: z.array(z.string().max(800).nullable()).max(10).optional(),
      })
      .parse(request.body);

    const trends =
      body.engine === ContentEngine.TRENDS
        ? {
            topicId: body.topicId || body.sources?.[0]?.topicId,
            sources: body.sources?.map((s) => {
              const imageUrl = (s.imageUrl || s.imageUrls?.[0] || '').trim() || undefined;
              return {
                title: s.title,
                url: s.url || '',
                snippet: s.snippet || '',
                publishedDate: s.publishedDate,
                ...(imageUrl ? { imageUrl } : {}),
              };
            }),
            useBrandTemplate: body.useBrandTemplate,
            brandTemplateId: body.brandTemplateId || undefined,
            visualMode: body.visualMode,
          }
        : undefined;

    const competitor =
      body.engine === ContentEngine.COMPETITOR
        ? {
            scrapedPostId: body.scrapedPostId,
            competitorId: body.competitorId,
            refreshScrape: body.refreshScrape ?? !body.scrapedPostId,
            useBrandTemplate: body.useBrandTemplate,
            brandTemplateId: body.brandTemplateId || undefined,
            visualMode: body.visualMode,
            competitorImageMode: body.competitorImageMode,
            platforms: body.platforms,
          }
        : undefined;

    const newsletter =
      body.engine === ContentEngine.NEWSLETTER
        ? {
            useBrandTemplate: body.useBrandTemplate,
            brandTemplateId: body.brandTemplateId || undefined,
            brandTemplateIds: body.brandTemplateIds,
            newsletterTemplateId: body.newsletterTemplateId || undefined,
            libraryItemId: body.libraryItemId || undefined,
            libraryItemIds: body.libraryItemIds,
            generationRules: body.generationRules,
            slotFillStyles: body.slotFillStyles,
            freeform: body.freeform,
            includeLogo: body.includeLogo,
            visualMode: body.visualMode,
          }
        : undefined;

    const meme =
      body.engine === ContentEngine.MEME
        ? {
            useBrandTemplate: body.useBrandTemplate,
            brandTemplateId: body.brandTemplateId || undefined,
            brandTemplateIds: body.brandTemplateIds,
            libraryItemId: body.libraryItemId || undefined,
            libraryItemIds: body.libraryItemIds,
            generationRules: body.generationRules,
            includeLogo: body.includeLogo,
            visualMode: body.visualMode,
            contentSource: body.contentSource,
            preferredFormatId:
              body.preferredFormatId ||
              body.sources?.find((s) => s.suggestedFormatId)?.suggestedFormatId,
            referenceImageUrl:
              body.referenceImageUrl ||
              body.sources?.find((s) => s.imageUrl)?.imageUrl ||
              body.sources?.find((s) => s.imageUrls?.length)?.imageUrls?.[0] ||
              undefined,
            selectedSignals: body.sources?.map((s) => ({
              title: s.title,
              url: s.url || undefined,
              snippet: s.snippet || '',
              imageUrl: s.imageUrl || s.imageUrls?.[0],
              postText: s.postText || s.title,
            })),
          }
        : undefined;

    const carousel =
      body.engine === ContentEngine.CAROUSEL
        ? {
            topic: (body.topic || body.sources?.[0]?.title || '').trim(),
            brief: body.brief || body.sources?.[0]?.snippet || undefined,
            slideCount: body.slideCount ?? 3,
            platforms: body.platforms,
            visualStyleId: body.visualStyleId,
            callToActionHint: body.callToActionHint,
            hashtags: body.hashtags,
            heroImageUrls: body.heroImageUrls,
          }
        : undefined;

    if (body.engine === ContentEngine.CAROUSEL && !carousel?.topic) {
      throw Object.assign(new Error('Carousel requires a topic'), { statusCode: 400 });
    }

    const contentId = await enqueueContentGeneration(
      request.session.tenantId!,
      body.engine,
      trends,
      competitor,
      undefined,
      newsletter,
      meme,
      carousel,
    );
    return { success: true, data: { contentId } };
  });

  app.get('/pending', { preHandler: requireAuth }, async (request) => {
    const items = await approvalService.getPendingApprovals(request.session.tenantId!);
    return { success: true, data: items };
  });

  app.post('/pending/clear', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request) => {
    const result = await approvalService.clearApprovalQueue({
      tenantId: request.session.tenantId!,
      reviewerId: request.session.userId!,
    });
    return { success: true, data: result };
  });

  app.post('/:id/abort', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({ reason: z.string().max(500).optional() })
      .parse(request.body ?? {});
    try {
      const data = await approvalService.abortContent({
        tenantId: request.session.tenantId!,
        contentId: id,
        reviewerId: request.session.userId!,
        reason: body.reason,
      });
      return { success: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Abort failed';
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.delete('/:id', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const data = await approvalService.deleteContent({
        tenantId: request.session.tenantId!,
        contentId: id,
        reviewerId: request.session.userId!,
      });
      return { success: true, data };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.get('/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const content = await approvalService.getContentForReview(request.session.tenantId!, id);
    if (!content) {
      const { findPlanEntryByContentId } = await import(
        '../services/calendar-plan-schedule.service'
      );
      const calendarEntry = await findPlanEntryByContentId(request.session.tenantId!, id);
      if (calendarEntry) {
        return reply.status(410).send({
          success: false,
          error: 'This draft was deleted or aborted. Generate it again from the content calendar.',
          code: 'CALENDAR_DRAFT_GONE',
          data: calendarEntry,
        });
      }
      return reply.status(404).send({ success: false, error: 'Content not found' });
    }
    return { success: true, data: content };
  });

  /** Save caption / dynamic template slots and re-render brand image when applicable. */
  app.post('/:id/revise', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const captionVariantSchema = z.object({
      headline: z.string(),
      body: z.string(),
      hashtags: z.array(z.string()),
      callToAction: z.string().optional().nullable(),
    });
    const body = z
      .object({
        headline: z.string().optional(),
        body: z.string().optional(),
        hashtags: z.array(z.string()).optional(),
        callToAction: z.string().optional().nullable(),
        platformCaptions: z
          .object({
            instagram: captionVariantSchema.optional(),
            linkedin: captionVariantSchema.optional(),
            facebook: captionVariantSchema.optional(),
            twitter: captionVariantSchema.optional(),
          })
          .optional(),
        templateSlots: z.record(z.string()).optional(),
        rerender: z.boolean().optional(),
      })
      .parse(request.body ?? {});

    const tenantId = request.session.tenantId!;
    const content = await prisma.generatedContent.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!content) return reply.status(404).send({ success: false, error: 'Content not found' });
    if (!['pending_approval', 'manual_intervention', 'generating'].includes(content.status)) {
      return reply.status(400).send({ success: false, error: 'This post can no longer be edited.' });
    }

    // Prefer LinkedIn variant as primary fields for backward compatibility
    const { normalizeHashtags } = await import('../services/platform-captions');
    const normalizeVariant = (
      v:
        | {
            headline: string;
            body: string;
            hashtags: string[];
            callToAction?: string | null;
          }
        | undefined,
    ) =>
      v
        ? {
            ...v,
            hashtags: normalizeHashtags(v.hashtags),
            callToAction: v.callToAction ?? null,
          }
        : undefined;

    const platformCaptions = body.platformCaptions
      ? {
          instagram: normalizeVariant(body.platformCaptions.instagram),
          linkedin: normalizeVariant(body.platformCaptions.linkedin),
          facebook: normalizeVariant(body.platformCaptions.facebook),
          twitter: normalizeVariant(body.platformCaptions.twitter),
        }
      : undefined;

    const primaryFromCaptions = platformCaptions?.linkedin;
    const headline = primaryFromCaptions?.headline ?? body.headline;
    const captionBody = primaryFromCaptions?.body ?? body.body;
    const hashtags =
      primaryFromCaptions?.hashtags ??
      (body.hashtags !== undefined ? normalizeHashtags(body.hashtags) : undefined);
    const callToAction =
      primaryFromCaptions?.callToAction !== undefined
        ? primaryFromCaptions.callToAction
        : body.callToAction;

    const { slotsFromJson, renderContentFromTemplate } = await import('../services/content-template.service');
    const { mergeTemplateSlots } = await import('../lib/carousel-parse');
    const userSlots = body.templateSlots || {};
    const slots = {
      ...slotsFromJson(content.templateSlots),
      ...userSlots,
    };

    // Caption fields must NOT overwrite Dynamic on-image text the reviewer just edited.
    // Only backfill empty plate aliases when the client did not send templateSlots
    // (legacy callers) — Approvals always sends the editor map.
    if (!body.templateSlots) {
      if (headline) {
        slots.headline = headline;
        slots.title = headline;
      }
      if (callToAction) {
        slots.subheadline = callToAction;
        slots.subtitle = callToAction;
        slots.offer = callToAction;
        slots.cta = callToAction;
      }
      if (captionBody) {
        slots.body = captionBody.slice(0, 280);
        if (!slots.subtitle) slots.subtitle = captionBody.split(/[.!?]/)[0]?.trim() || captionBody.slice(0, 120);
        if (!slots.subheadline) slots.subheadline = slots.subtitle;
      }
    }

    let imageUrl = content.imageUrl;
    const shouldRender = body.rerender !== false && Boolean(content.brandTemplateId);
    if (shouldRender && content.brandTemplateId) {
      try {
        const rendered = await renderContentFromTemplate({
          tenantId,
          brandTemplateId: content.brandTemplateId,
          slots,
          prefix: 'approval-revise',
          lockProvidedSlots: true,
        });
        imageUrl = rendered.imageUrl;
        // Persist exact slot map Placid/SVG used (incl. hosted picture URLs)
        Object.assign(slots, rendered.slots);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Template re-render failed';
        return reply.status(400).send({ success: false, error: msg });
      }
    }

    await prisma.generatedContent.update({
      where: { id },
      data: {
        ...(headline !== undefined ? { headline } : {}),
        ...(captionBody !== undefined ? { body: captionBody } : {}),
        ...(hashtags !== undefined ? { hashtags } : {}),
        ...(callToAction !== undefined ? { callToAction } : {}),
        ...(body.platformCaptions !== undefined ? { platformCaptions } : {}),
        templateSlots: mergeTemplateSlots(content.templateSlots, slots) as object,
        ...(imageUrl ? { imageUrl } : {}),
        status: 'pending_approval',
        revisionCount: { increment: 1 },
      },
    });

    const updated = await approvalService.getContentForReview(tenantId, id);
    return { success: true, data: updated };
  });

  /** Upload an image into a dynamic template image slot and re-render. */
  app.post('/:id/upload-slot-image', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = await request.file();
    if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });
    if (!data.mimetype.startsWith('image/')) {
      return reply.status(400).send({ success: false, error: 'Please upload an image' });
    }

    const readField = (name: string): string => {
      const fields = data.fields as Record<string, unknown> | undefined;
      if (!fields) return '';
      const raw = fields[name];
      if (typeof raw === 'string') return raw;
      if (raw && typeof raw === 'object' && 'value' in raw) return String((raw as { value: unknown }).value || '');
      return '';
    };
    const query = request.query as { slot?: string };
    const slotName = (readField('slot') || query.slot || '').trim();
    if (!slotName) {
      return reply.status(400).send({ success: false, error: 'Missing image slot name (slot).' });
    }

    const buffer = await data.toBuffer();
    if (buffer.length > 20 * 1024 * 1024) {
      return reply.status(400).send({ success: false, error: 'Image too large (max 20MB)' });
    }

    const tenantId = request.session.tenantId!;
    const content = await prisma.generatedContent.findFirst({
      where: { id, tenantId, deletedAt: null },
    });
    if (!content) return reply.status(404).send({ success: false, error: 'Content not found' });
    if (!content.brandTemplateId) {
      return reply.status(400).send({
        success: false,
        error: 'This post has no Brand Studio template — use Regenerate image instead.',
      });
    }

    const { storeOriginalImage } = await import('../lib/store-upload');
    const stored = await storeOriginalImage({
      tenantId,
      subdir: 'content-slots',
      buffer,
      originalFilename: data.filename || 'slot.png',
      mimetype: data.mimetype,
      logLabel: 'content-slot',
    });
    const publicUrl = stored.publicUrl;

    const { slotsFromJson, renderContentFromTemplate } = await import('../services/content-template.service');
    const slots = { ...slotsFromJson(content.templateSlots), [slotName]: publicUrl };
    const rendered = await renderContentFromTemplate({
      tenantId,
      brandTemplateId: content.brandTemplateId,
      slots,
      prefix: 'approval-slot',
      lockProvidedSlots: true,
    });

    await prisma.generatedContent.update({
      where: { id },
      data: {
        templateSlots: slots,
        imageUrl: rendered.imageUrl,
        status: 'pending_approval',
        revisionCount: { increment: 1 },
      },
    });

    const updated = await approvalService.getContentForReview(tenantId, id);
    return { success: true, data: updated };
  });

  /** Replace one carousel slide's hero photo (upload from laptop); keeps typography. */
  app.post(
    '/:id/carousel-slide/:slideIndex/replace-image',
    { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) },
    async (request, reply) => {
      const { id, slideIndex } = request.params as { id: string; slideIndex: string };
      const idx = Number(slideIndex);
      if (!Number.isInteger(idx) || idx < 0) {
        return reply.status(400).send({ success: false, error: 'Invalid slide index' });
      }
      const data = await request.file();
      if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });
      if (!data.mimetype.startsWith('image/')) {
        return reply.status(400).send({ success: false, error: 'Please upload an image' });
      }
      const buffer = await data.toBuffer();
      if (buffer.length > 12 * 1024 * 1024) {
        return reply.status(400).send({ success: false, error: 'Image too large (max 12MB)' });
      }
      try {
        const { replaceCarouselSlideImage } = await import('../services/carousel-slide.service');
        await replaceCarouselSlideImage({
          tenantId: request.session.tenantId!,
          contentId: id,
          slideIndex: idx,
          buffer,
          filename: data.filename || 'slide.png',
          mimetype: data.mimetype,
        });
        const updated = await approvalService.getContentForReview(request.session.tenantId!, id);
        return { success: true, data: updated };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Replace failed';
        return reply.status(400).send({ success: false, error: message });
      }
    },
  );

  /** Regenerate ONLY the hero art for one carousel slide via prompt. */
  app.post(
    '/:id/carousel-slide/:slideIndex/regenerate-art',
    { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) },
    async (request, reply) => {
      const { id, slideIndex } = request.params as { id: string; slideIndex: string };
      const idx = Number(slideIndex);
      if (!Number.isInteger(idx) || idx < 0) {
        return reply.status(400).send({ success: false, error: 'Invalid slide index' });
      }
      const body = z
        .object({
          prompt: z.string().min(4).max(4000),
          exact: z.boolean().optional(),
        })
        .parse(request.body ?? {});
      try {
        const { regenerateCarouselSlideArt } = await import('../services/carousel-slide.service');
        await regenerateCarouselSlideArt({
          tenantId: request.session.tenantId!,
          contentId: id,
          slideIndex: idx,
          prompt: body.prompt,
          exact: body.exact === true,
        });
        const updated = await approvalService.getContentForReview(request.session.tenantId!, id);
        return { success: true, data: updated };
      } catch (err) {
        const { toProviderCreditError } = await import('../lib/provider-credits');
        const credit = toProviderCreditError(err, undefined, 'image');
        if (credit) {
          return reply.status(402).send({
            success: false,
            error: credit.message,
            code: 'PROVIDER_CREDITS',
            data: credit.toJSON(),
          });
        }
        const message = err instanceof Error ? err.message : 'Regenerate failed';
        return reply.status(400).send({ success: false, error: message });
      }
    },
  );

  app.post('/:id/regenerate-image', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        prompt: z.string().min(1).optional(),
        format: z
          .enum(['instagram_square', 'instagram_portrait', 'linkedin', 'story'])
          .optional(),
        exact: z.boolean().optional(),
        /** When false, strip Brand Studio template and generate a full AI social image */
        useBrandTemplate: z.boolean().optional(),
        visualStyleId: z
          .enum([
            'professional_photo',
            'cinematic_photo',
            'illustration',
            'vector_flat',
            '3d_render',
            'watercolor',
            'line_art',
            'editorial_collage',
            'meme_comic',
            'custom',
          ])
          .optional(),
        logoPlacement: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
        headerText: z.string().max(200).optional().nullable(),
        footerCta: z.string().max(200).optional().nullable(),
        overlaysEnabled: z.boolean().optional(),
        visualMode: z.enum(['ai', 'ai_baked_layout']).optional(),
        headerFontSize: z.number().int().min(18).max(96).optional(),
        footerFontSize: z.number().int().min(14).max(64).optional(),
        headerFont: z.enum(['serif', 'sans', 'display', 'modern']).optional(),
        footerFont: z.enum(['serif', 'sans', 'display', 'modern']).optional(),
      })
      .parse(request.body ?? {});

    const content = await prisma.generatedContent.findFirst({
      where: { id, tenantId: request.session.tenantId!, deletedAt: null },
    });
    if (!content) return reply.status(404).send({ success: false, error: 'Content not found' });

    const brand = await prisma.brandSettings.findUnique({
      where: { tenantId: request.session.tenantId! },
    });

    const contentBrief = [content.headline, content.body?.slice(0, 220), content.callToAction]
      .filter(Boolean)
      .join(' — ');

    const { resolveGenerationImagePrompt } = await import('../lib/image-prompt-sanitize');
    // Exact = ONLY the user's AI image prompt. Otherwise style + post grounding still apply,
    // but never send poisoned "Reference photo / metadata only" competitor prompts to fal.
    const prompt = resolveGenerationImagePrompt({
      userPrompt: body.prompt,
      storedPrompt: content.imagePrompt,
      headline: content.headline,
      body: content.body,
      brandType: brand?.brandType,
      imageStyle: brand?.imageStyle,
      exact: body.exact === true,
    });

    const slots =
      content.templateSlots && typeof content.templateSlots === 'object' && !Array.isArray(content.templateSlots)
        ? (content.templateSlots as Record<string, unknown>)
        : {};

    const wantTemplate =
      body.useBrandTemplate !== false && Boolean(content.brandTemplateId);

    const wantBaked =
      body.visualMode === 'ai_baked_layout' ||
      (slots.creativeMode === 'ai_baked_layout' && body.visualMode !== 'ai');

    // Explicitly drop template when user asks for a full AI image
    if ((body.useBrandTemplate === false || wantBaked) && content.brandTemplateId) {
      await prisma.generatedContent.update({
        where: { id },
        data: { brandTemplateId: null },
      });
    }

    if (wantBaked && !wantTemplate) {
      const { attachBakedPosterForContent } = await import('../services/baked-poster.service');
      await attachBakedPosterForContent({
        tenantId: request.session.tenantId!,
        contentId: id,
        companyName: brand?.companyName || 'Brand',
        headline: body.headerText || content.headline,
        body: content.body,
        callToAction: body.footerCta || content.callToAction,
        visualStyleId: body.visualStyleId || (slots.visualStyleId as string) || 'professional_photo',
        brandImageStyle: brand?.imageStyle,
        logoPlacement: body.logoPlacement,
        format: body.format || 'instagram_square',
        playId: 'announcement',
      });
      const updated = await prisma.generatedContent.findUniqueOrThrow({ where: { id } });
      return { success: true, data: updated };
    }

    const insightReport =
      slots.playId === 'insight_report' && slots.insightReport && typeof slots.insightReport === 'object'
        ? (slots.insightReport as import('../providers/images/social-frame').InsightReportContent)
        : null;

    const overlaysEnabled = body.overlaysEnabled !== false;
    const storedPosterSpec =
      slots.posterSpec && typeof slots.posterSpec === 'object' && !Array.isArray(slots.posterSpec)
        ? (slots.posterSpec as import('../providers/images/poster-frame').PosterSpec)
        : null;
    // Designed posters must regenerate as posters — and pick up any copy edits.
    const wantPoster = Boolean(storedPosterSpec) && !insightReport && !wantTemplate && overlaysEnabled;
    let posterSpec: import('../providers/images/poster-frame').PosterSpec | null = null;
    if (wantPoster) {
      const { generatePosterSpecRespectingTemplate } = await import('../services/poster-spec.service');
      const locked = await generatePosterSpecRespectingTemplate({
        tenantId: request.session.tenantId!,
        posterTemplateId: typeof slots.posterTemplateId === 'string' ? slots.posterTemplateId : null,
        topic: content.headline,
        brief: body.exact ? null : body.prompt?.trim() || null,
        headline: body.headerText?.trim() || content.headline,
        body: content.body,
        callToAction: body.footerCta ?? content.callToAction,
        // Keep stored geometry when no template; templates override via locked.layout
        layout:
          typeof slots.posterLayout === 'string'
            ? (slots.posterLayout as import('../providers/images/poster-frame').PosterLayoutId)
            : null,
      });
      posterSpec = locked.spec;
      if (locked.layout) slots.posterLayout = locked.layout;
      if (locked.template) slots.posterTemplateId = locked.template.id;
    }

    const frameOpts = {
      format: (body.format || (insightReport ? 'instagram_portrait' : 'instagram_square')) as
        | 'instagram_square'
        | 'instagram_portrait'
        | 'linkedin'
        | 'story',
      exact: body.exact === true,
      brandImageStyle: brand?.imageStyle,
      companyName: brand?.companyName,
      // Overlays off = clean photo — no logo watermark either
      logoUrl: overlaysEnabled ? brand?.logoUrl ?? null : null,
      visualStyleId:
        body.visualStyleId ||
        (brand?.brandType === 'b2c' ? 'cinematic_photo' : 'professional_photo'),
      logoPlacement: body.logoPlacement || ('top-left' as const),
      headerText: overlaysEnabled ? body.headerText ?? content.headline ?? null : null,
      footerCta: overlaysEnabled ? body.footerCta ?? content.callToAction ?? null : null,
      creativeType: insightReport
        ? ('insight' as const)
        : wantPoster && posterSpec
          ? ('poster' as const)
          : content.engine === ContentEngine.NEWSLETTER && !wantTemplate
            ? ('newsletter' as const)
            : ('social' as const),
      insightReport,
      posterSpec,
      posterLayout:
        typeof slots.posterLayout === 'string'
          ? (slots.posterLayout as import('../providers/images/poster-frame').PosterLayoutId)
          : undefined,
      negativePrompt: posterSpec?.artNegativePrompt ?? null,
      posterQuality: true as const,
      bodyText:
        content.engine === ContentEngine.NEWSLETTER && !wantTemplate
          ? content.body
          : null,
      eyebrow:
        content.engine === ContentEngine.NEWSLETTER && !wantTemplate
          ? 'Product newsletter'
          : null,
      newsletterEdition:
        content.engine === ContentEngine.NEWSLETTER && !wantTemplate
          ? ((content.templateSlots as { newsletterEdition?: import('../providers/images/social-frame').NewsletterEditionContent } | null)
              ?.newsletterEdition ?? null)
          : null,
      // Never force post topic when user asked for exact prompt
      contentBrief: body.exact ? null : contentBrief,
      overlay: {
        overlaysEnabled,
        headerFontSize: body.headerFontSize,
        footerFontSize: body.footerFontSize,
        headerFont: body.headerFont,
        footerFont: body.footerFont,
      },
      savePrompt: true as const,
      throwOnError: true as const,
    };

    const { attachGeneratedImage, generateRawArtUrl } = await import('../services/image-attach.service');
    try {
      if (wantTemplate && content.brandTemplateId) {
        const { slotsFromJson, renderContentFromTemplate, loadBrandCanvas, describeTemplateLayers } =
          await import('../services/content-template.service');
        const loaded = await loadBrandCanvas(request.session.tenantId!, content.brandTemplateId);
        const imageSlots = loaded
          ? describeTemplateLayers(loaded.canvas).filter(
              (l) => l.type === 'image' && l.editable,
            )
          : [];
        const artUrl = await generateRawArtUrl(request.session.tenantId!, id, prompt, {
          ...frameOpts,
          logoUrl: null,
          headerText: null,
          footerCta: null,
          overlay: { overlaysEnabled: false },
          visualStyleId: undefined,
        });
        const slots = { ...slotsFromJson(content.templateSlots) };
        if (imageSlots.length === 0) {
          slots.hero_image = artUrl;
        } else {
          for (const layer of imageSlots) slots[layer.slot] = artUrl;
        }
        const rendered = await renderContentFromTemplate({
          tenantId: request.session.tenantId!,
          brandTemplateId: content.brandTemplateId,
          slots,
          prefix: 'approval-ai-slot',
          lockProvidedSlots: true,
        });
        await prisma.generatedContent.update({
          where: { id },
          data: {
            templateSlots: slots,
            imageUrl: rendered.imageUrl,
            // Keep clean AI art so "overlays off" / leave-template can reframe without plate logos
            rawImageUrl: artUrl,
            imagePrompt: prompt,
            revisionCount: { increment: 1 },
          },
        });
      } else {
        const { extractCarouselPayload, clampSlideCount } = await import('../lib/carousel-parse');
        const existingCarousel = extractCarouselPayload(content.templateSlots);
        if (existingCarousel && existingCarousel.slides.length >= 2 && !wantTemplate) {
          const slideCount = clampSlideCount(existingCarousel.slideCount);
          const slides = [];
          for (let i = 0; i < slideCount; i++) {
            const prev = existingCarousel.slides[i];
            const headline =
              body.headerText?.trim() && i === 0
                ? body.headerText.trim()
                : prev?.headline || content.headline || `Slide ${i + 1}`;
            // Keep each slide's own layout brief; only the headline follows edits.
            const slideSpec = posterSpec
              ? {
                  ...((prev?.posterSpec as import('../providers/images/poster-frame').PosterSpec | null) ||
                    posterSpec),
                  headline,
                }
              : null;
            const imagePrompt =
              i === 0
                ? slideSpec && !body.exact
                  ? slideSpec.artPrompt || prompt
                  : prompt
                : slideSpec && !body.exact
                  ? slideSpec.artPrompt ||
                    `${prompt}. Slide ${i + 1} of ${slideCount} — continue the same visual story, distinct composition.`
                  : `${prompt}. Slide ${i + 1} of ${slideCount} — continue the same visual story, distinct composition.`;
            const attached = await attachGeneratedImage(request.session.tenantId!, id, imagePrompt, {
              ...frameOpts,
              posterSpec: slideSpec,
              posterLayout:
                (typeof prev?.posterLayout === 'string' && prev.posterLayout
                  ? (prev.posterLayout as import('../providers/images/poster-frame').PosterLayoutId)
                  : null) ||
                (typeof slots.posterLayout === 'string'
                  ? (slots.posterLayout as import('../providers/images/poster-frame').PosterLayoutId)
                  : undefined) ||
                'hero_right',
              slideLabel: slideSpec ? `${i + 1} / ${slideCount}` : null,
              headerText: overlaysEnabled ? headline : null,
              footerCta: overlaysEnabled
                ? i === slideCount - 1
                  ? body.footerCta ?? content.callToAction ?? null
                  : `Slide ${i + 1} / ${slideCount}`
                : null,
              savePrompt: false,
              skipPersist: true,
            });
            if (!attached?.imageUrl) {
              return reply.status(502).send({
                success: false,
                error: `Carousel slide ${i + 1} failed to generate`,
              });
            }
            slides.push({
              index: i + 1,
              headline,
              imagePrompt,
              imageUrl: attached.imageUrl,
              rawImageUrl: attached.rawImageUrl || null,
              posterLayout: prev?.posterLayout || slots.posterLayout || null,
              ...(slideSpec
                ? { posterSpec: slideSpec as unknown as Record<string, unknown> }
                : {}),
            });
          }
          const cover = slides[0];
          await prisma.generatedContent.update({
            where: { id },
            data: {
              brandTemplateId: null,
              imageUrl: cover.imageUrl,
              rawImageUrl: cover.rawImageUrl || null,
              imagePrompt: cover.imagePrompt,
              templateSlots: {
                ...slots,
                format: 'carousel',
                ...(posterSpec
                  ? { posterSpec: posterSpec as unknown as Record<string, unknown> }
                  : {}),
                carousel: { slideCount: slides.length, slides },
              } as object,
              revisionCount: { increment: 1 },
            },
          });
        } else {
          // Full AI social image with style + logo placement + header/footer overlays
          const artPrompt =
            posterSpec && !body.exact ? posterSpec.artPrompt || prompt : prompt;
          await attachGeneratedImage(request.session.tenantId!, id, artPrompt, frameOpts);
          await prisma.generatedContent.update({
            where: { id },
            data: {
              brandTemplateId: null,
              revisionCount: { increment: 1 },
              ...(posterSpec
                ? {
                    templateSlots: {
                      ...slots,
                      posterSpec: posterSpec as unknown as Record<string, unknown>,
                    } as object,
                  }
                : {}),
            },
          });
        }
      }
    } catch (err) {
      const { replyProviderCredit } = await import('../services/provider-credit-alert.service');
      if (await replyProviderCredit(reply, request.session.tenantId, err, 'image')) return;
      const msg = err instanceof Error ? err.message : 'Image generation failed';
      return reply.status(502).send({ success: false, error: msg });
    }

    const updated = await approvalService.getContentForReview(request.session.tenantId!, id);
    if (!updated?.imageUrl) {
      return reply.status(502).send({
        success: false,
        error:
          'Image generation failed. Check image API keys in Settings and use a text-to-image model.',
      });
    }
    return { success: true, data: updated };
  });

  /** Re-apply logo + text overlays without regenerating AI art */
  app.post('/:id/reframe-image', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        format: z.enum(['instagram_square', 'instagram_portrait', 'linkedin', 'story']).optional(),
        logoPlacement: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
        headerText: z.string().max(200).optional().nullable(),
        footerCta: z.string().max(200).optional().nullable(),
        overlaysEnabled: z.boolean().optional(),
        headerFontSize: z.number().int().min(18).max(96).optional(),
        footerFontSize: z.number().int().min(14).max(64).optional(),
        headerFont: z.enum(['serif', 'sans', 'display', 'modern']).optional(),
        footerFont: z.enum(['serif', 'sans', 'display', 'modern']).optional(),
      })
      .parse(request.body ?? {});

    const content = await prisma.generatedContent.findFirst({
      where: { id, tenantId: request.session.tenantId!, deletedAt: null },
    });
    if (!content) return reply.status(404).send({ success: false, error: 'Content not found' });

    if (content.brandTemplateId) {
      return reply.status(400).send({
        success: false,
        error:
          'Logo position and on-image text overlays cannot be applied to Brand Studio / Placid template posts. Edit template layers instead, or turn off “Keep Brand Studio template” and regenerate as full AI.',
      });
    }

    const overlaysEnabled = body.overlaysEnabled !== false;
    try {
      const { reframeExistingImage } = await import('../services/image-attach.service');
      await reframeExistingImage(request.session.tenantId!, id, {
        format: body.format || 'instagram_square',
        logoPlacement: body.logoPlacement || 'top-left',
        headerText: overlaysEnabled ? body.headerText ?? null : null,
        footerCta: overlaysEnabled ? body.footerCta ?? null : null,
        overlay: {
          overlaysEnabled,
          headerFontSize: body.headerFontSize,
          footerFontSize: body.footerFontSize,
          headerFont: body.headerFont,
          footerFont: body.footerFont,
        },
        throwOnError: true,
      });
    } catch (err) {
      const { replyProviderCredit } = await import('../services/provider-credit-alert.service');
      if (await replyProviderCredit(reply, request.session.tenantId, err, 'image')) return;
      const msg = err instanceof Error ? err.message : 'Reframe failed';
      return reply.status(502).send({ success: false, error: msg });
    }

    const updated = await approvalService.getContentForReview(request.session.tenantId!, id);
    return { success: true, data: updated };
  });

  app.post('/:id/approve', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      action: z.nativeEnum(ApprovalAction),
      feedback: z.string().optional(),
      editedContent: z.object({
        headline: z.string().optional(),
        body: z.string().optional(),
        hashtags: z.array(z.string()).optional(),
        callToAction: z.string().optional(),
      }).optional(),
      platforms: z.array(z.enum(['instagram', 'linkedin', 'facebook', 'twitter'])).optional(),
    }).parse(request.body);

    const tenantId = request.session.tenantId!;

    // Only allow platforms that are actually connected for this tenant
    let platforms = body.platforms ?? [];
    if (body.action === ApprovalAction.APPROVE) {
      const connections = await prisma.platformConnection.findMany({
        where: { tenantId, isActive: true },
        select: { platform: true },
      });
      const allowed = new Set(connections.map((c) => c.platform));
      platforms = platforms.filter((p) => allowed.has(p as 'instagram' | 'linkedin' | 'facebook' | 'twitter'));
      if (!platforms.length) {
        return reply.status(400).send({
          success: false,
          error: 'Select at least one connected channel to post.',
        });
      }
    }

    const result = await approvalService.processDecision({
      contentId: id,
      reviewerId: request.session.userId!,
      action: body.action,
      feedback: body.feedback,
      editedContent: body.editedContent,
      platforms,
    });

    if (result.nextAction === 'publish') {
      const content = await prisma.generatedContent.findUniqueOrThrow({ where: { id } });
      const { executionLogService } = await import('../services/execution-log.service');
      await executionLogService.log({
        tenantId,
        contentId: id,
        workflowStep: 'publish:enqueue',
        message: `channels=${platforms.join(',')} image=${Boolean(content.imageUrl)} captionChars=${(content.body || '').length}`,
      });
      await enqueuePublishing(id, tenantId, platforms);
    }

    return { success: true, data: result };
  });

  app.get('/', { preHandler: requireAuth }, async (request) => {
    const query = request.query as { status?: string; page?: string; pageSize?: string };
    const page = parseInt(query.page ?? '1', 10);
    const pageSize = parseInt(query.pageSize ?? '20', 10);

    const where = {
      tenantId: request.session.tenantId!,
      ...(query.status && { status: query.status as 'published' | 'failed' | 'pending_approval' }),
    };

    const [items, total] = await Promise.all([
      prisma.generatedContent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.generatedContent.count({ where }),
    ]);

    return { success: true, data: { items, total, page, pageSize } };
  });
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/stats', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;

    // Older Instagram posts stored only a media ID; resolve their permalinks once.
    const { publishingService } = await import('../services/publishing.service');
    await publishingService
      .backfillMissingPostUrls(tenantId)
      .catch((err) => request.log.warn({ err }, 'post url backfill failed'));

    const [published, publishedRows, connections] = await Promise.all([
      prisma.generatedContent.count({ where: { tenantId, status: 'published', deletedAt: null } }),
      prisma.generatedContent.findMany({
        where: { tenantId, status: 'published', deletedAt: null },
        orderBy: { publishedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          headline: true,
          body: true,
          hashtags: true,
          callToAction: true,
          platformCaptions: true,
          targetPlatforms: true,
          imageUrl: true,
          engine: true,
          createdAt: true,
          publishedAt: true,
          publishLogs: {
            where: { status: 'success' },
            orderBy: { createdAt: 'asc' },
            select: {
              platform: true,
              platformPostId: true,
              postUrl: true,
              createdAt: true,
            },
          },
        },
      }),
      prisma.platformConnection.findMany({
        where: { tenantId },
        select: { platform: true, accountId: true, accountName: true },
      }),
    ]);

    const { captionForPlatform } = await import('../services/platform-captions');
    const { buildPlatformPostUrl } = await import('../providers/notifications');
    const accountByPlatform = new Map(connections.map((c) => [c.platform as string, c]));

    // Posts published before post_url existed still have a platformPostId we can
    // rebuild a permalink from (Instagram excepted — its media IDs are not URLs).
    const resolvePostUrl = (log: {
      platform: string;
      platformPostId: string | null;
      postUrl: string | null;
    }): string | null =>
      log.postUrl ||
      buildPlatformPostUrl(
        log.platform,
        log.platformPostId,
        accountByPlatform.get(log.platform)?.accountId ?? null,
      );
    const publishedContent = publishedRows.map((item) => {
      const platforms = [
        ...new Set(
          item.publishLogs.length
            ? item.publishLogs.map((log) => log.platform)
            : asStringArray(item.targetPlatforms),
        ),
      ];
      const primaryPlatform = platforms[0] || 'instagram';
      const captionSource = {
        headline: item.headline,
        body: item.body,
        hashtags: asStringArray(item.hashtags),
        callToAction: item.callToAction,
        platformCaptions: item.platformCaptions,
      };
      return {
        id: item.id,
        engine: item.engine,
        imageUrl: item.imageUrl,
        publishedAt: item.publishedAt,
        platforms,
        publishLogs: item.publishLogs,
        links: item.publishLogs.map((log) => ({
          platform: log.platform as string,
          url: resolvePostUrl(log),
          platformPostId: log.platformPostId,
          accountName: accountByPlatform.get(log.platform as string)?.accountName ?? null,
        })),
        caption: captionForPlatform(primaryPlatform, captionSource),
        captions: platforms.map((platform) => ({
          platform,
          ...captionForPlatform(platform, captionSource),
        })),
      };
    });

    return {
      success: true,
      data: { published, publishedContent },
    };
  });

  app.get('/rotation', { preHandler: requireAuth }, async (request) => {
    const status = await getRotationStatus(request.session.tenantId!);
    return { success: true, data: status };
  });

  app.get('/logs', { preHandler: requireAuth }, async (request) => {
    const query = request.query as { status?: string; engine?: string; page?: string };
    const logs = await executionLogService.query(request.session.tenantId!, {
      status: query.status as ExecutionStatus | undefined,
      engine: query.engine as ContentEngine | undefined,
      page: parseInt(query.page ?? '1', 10),
    });
    return { success: true, data: logs };
  });

  app.delete('/logs', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request) => {
    const query = request.query as { status?: string };
    const status = query.status as ExecutionStatus | undefined;
    const result = await executionLogService.clear(request.session.tenantId!, {
      ...(status ? { status } : {}),
    });
    return {
      success: true,
      data: result,
      message:
        result.deletedCount === 0
          ? 'No logs to clear'
          : `Cleared ${result.deletedCount} log${result.deletedCount === 1 ? '' : 's'}`,
    };
  });
}
