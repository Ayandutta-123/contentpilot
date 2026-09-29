import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserRole } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import { encrypt } from '../lib/encryption';
import fs from 'fs/promises';
import path from 'path';
import pdfParse from 'pdf-parse';
import { config } from '../config';
import { getProviderSettingsPublic, upsertProviderSettings } from '../services/providers.service';
import { preferOriginalLogoUrl, storeOriginalImage } from '../lib/store-upload';

const SoftDelete = { deletedAt: new Date() };

export async function settingsRoutes(app: FastifyInstance) {
  // ── Company / Brand Profile ──
  app.get('/brand', { preHandler: requireAuth }, async (request) => {
    const settings = await prisma.brandSettings.findUnique({
      where: { tenantId: request.session.tenantId! },
    });
    if (!settings) return { success: true, data: settings };

    // Heal legacy logoUrl that pointed at knockout derivatives (lossy / downscaled)
    const healed = preferOriginalLogoUrl(settings.logoUrl);
    if (healed && healed !== settings.logoUrl) {
      const updated = await prisma.brandSettings.update({
        where: { tenantId: request.session.tenantId! },
        data: { logoUrl: healed },
      });
      return { success: true, data: updated };
    }
    return { success: true, data: settings };
  });

  app.put('/brand', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const body = z
      .object({
        companyName: z.string().optional(),
        productName: z.string().optional(),
        productTagline: z.string().optional(),
        industry: z.string().optional(),
        websiteUrl: z.string().optional(),
        contactEmail: z.string().max(200).optional(),
        instagramUrl: z.string().max(400).optional(),
        facebookUrl: z.string().max(400).optional(),
        linkedinUrl: z.string().max(400).optional(),
        twitterUrl: z.string().max(400).optional(),
        brandType: z.enum(['b2b', 'b2c']).optional(),
        brandVoice: z.string().optional(),
        imageStyle: z.string().optional(),
        logoUrl: z.string().nullable().optional(),
        hashtagStrategy: z.string().optional(),
        contentGuidelines: z.string().optional(),
        targetAudience: z.string().optional(),
        targetCountries: z.array(z.string().min(1).max(32)).max(40).optional(),
        /** Brand Kit */
        brandKitMode: z.enum(['strict', 'mix', 'sometimes', 'off']).optional(),
        posterReferenceMode: z.enum(['off', 'guide', 'strong']).optional(),
        primaryColor: z.string().max(16).optional(),
        secondaryColor: z.string().max(16).optional(),
        accentColor: z.string().max(16).optional(),
        backgroundColor: z.string().max(16).optional(),
        textColor: z.string().max(16).optional(),
        headingFont: z.enum(['serif', 'sans', 'display', 'modern']).optional(),
        bodyFont: z.enum(['serif', 'sans', 'display', 'modern']).optional(),
        /** When true (default for B2B + website change), scrape site into voice/guidelines */
        scrapeWebsite: z.boolean().optional(),
      })
      .parse(request.body);

    const tenantId = request.session.tenantId!;
    const existing = await prisma.brandSettings.findUnique({ where: { tenantId } });

    const nextType = body.brandType ?? (existing?.brandType === 'b2c' ? 'b2c' : 'b2b');
    const nextWebsite = (body.websiteUrl ?? existing?.websiteUrl ?? '').trim();
    const websiteChanged =
      body.websiteUrl !== undefined &&
      nextWebsite.replace(/\/$/, '') !== (existing?.websiteUrl || '').trim().replace(/\/$/, '');
    const typeBecameB2b = body.brandType === 'b2b' && existing?.brandType !== 'b2b';
    const shouldScrape =
      nextType === 'b2b' &&
      Boolean(nextWebsite) &&
      (body.scrapeWebsite === true ||
        (body.scrapeWebsite !== false && (websiteChanged || typeBecameB2b || !existing?.websiteScrapedAt)));

    const { scrapeWebsite: _scrapeFlag, targetCountries: rawCountries, ...profileRaw } = body;
    void _scrapeFlag;

    const {
      normalizeHex,
      isBrandFontId,
      isBrandKitMode,
      defaultBrandKit,
    } = await import('../lib/brand-kit');
    const kitDefaults = defaultBrandKit();
    const profile = {
      ...profileRaw,
      ...(body.brandKitMode !== undefined
        ? { brandKitMode: isBrandKitMode(body.brandKitMode) ? body.brandKitMode : kitDefaults.mode }
        : {}),
      ...(body.primaryColor !== undefined
        ? { primaryColor: normalizeHex(body.primaryColor, kitDefaults.colors.primary) }
        : {}),
      ...(body.secondaryColor !== undefined
        ? { secondaryColor: normalizeHex(body.secondaryColor, kitDefaults.colors.secondary) }
        : {}),
      ...(body.accentColor !== undefined
        ? { accentColor: normalizeHex(body.accentColor, kitDefaults.colors.accent) }
        : {}),
      ...(body.backgroundColor !== undefined
        ? { backgroundColor: normalizeHex(body.backgroundColor, kitDefaults.colors.background) }
        : {}),
      ...(body.textColor !== undefined
        ? { textColor: normalizeHex(body.textColor, kitDefaults.colors.text) }
        : {}),
      ...(body.headingFont !== undefined
        ? { headingFont: isBrandFontId(body.headingFont) ? body.headingFont : kitDefaults.fonts.heading }
        : {}),
      ...(body.bodyFont !== undefined
        ? { bodyFont: isBrandFontId(body.bodyFont) ? body.bodyFont : kitDefaults.fonts.body }
        : {}),
    };

    let nextCountries: string[] | undefined;
    if (rawCountries !== undefined) {
      const { normalizeTargetCountries } = await import('../lib/market-countries');
      nextCountries = normalizeTargetCountries(rawCountries);
    }

    let settings = await prisma.brandSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ...profile,
        brandType: nextType,
        websiteUrl: nextWebsite,
        ...(nextCountries ? { targetCountries: nextCountries } : {}),
      },
      update: {
        ...profile,
        ...(body.brandType ? { brandType: nextType } : {}),
        ...(body.websiteUrl !== undefined ? { websiteUrl: nextWebsite } : {}),
        ...(nextCountries ? { targetCountries: nextCountries } : {}),
      },
    });

    let scraped: {
      pagesScraped: number;
      sourceUrls: string[];
      scrapeMethod?: string;
      llmProvider?: string;
      llmModel?: string;
    } | null = null;

    if (shouldScrape) {
      try {
        const { scrapeBrandWebsite } = await import('../services/brand-website-scrape.service');
        const profileFromSite = await scrapeBrandWebsite(tenantId, nextWebsite);
        settings = await prisma.brandSettings.update({
          where: { tenantId },
          data: {
            // Prefer scraped identity when existing fields are empty
            companyName: settings.companyName?.trim() || profileFromSite.companyName || settings.companyName,
            productName: settings.productName?.trim() || profileFromSite.productName || settings.productName,
            productTagline:
              settings.productTagline?.trim() ||
              profileFromSite.productTagline ||
              settings.productTagline,
            industry: profileFromSite.industry || settings.industry,
            brandVoice: profileFromSite.brandVoice || settings.brandVoice,
            contentGuidelines: profileFromSite.contentGuidelines || settings.contentGuidelines,
            targetAudience: profileFromSite.targetAudience || settings.targetAudience,
            imageStyle: profileFromSite.imageStyle || settings.imageStyle,
            hashtagStrategy: profileFromSite.hashtagStrategy || settings.hashtagStrategy,
            contactEmail: settings.contactEmail?.trim() || profileFromSite.contactEmail || '',
            instagramUrl: settings.instagramUrl?.trim() || profileFromSite.instagramUrl || '',
            facebookUrl: settings.facebookUrl?.trim() || profileFromSite.facebookUrl || '',
            linkedinUrl: settings.linkedinUrl?.trim() || profileFromSite.linkedinUrl || '',
            twitterUrl: settings.twitterUrl?.trim() || profileFromSite.twitterUrl || '',
            websiteScrapedAt: new Date(),
          },
        });
        scraped = {
          pagesScraped: profileFromSite.pagesScraped,
          sourceUrls: profileFromSite.sourceUrls,
          scrapeMethod: profileFromSite.scrapeMethod,
          llmProvider: profileFromSite.llmProvider,
          llmModel: profileFromSite.llmModel,
        };
      } catch (err) {
        const { toProviderCreditError } = await import('../lib/provider-credits');
        const { reportProviderCreditFailure } = await import('../services/provider-credit-alert.service');
        const credit = toProviderCreditError(err, undefined, 'scrape');
        if (credit) {
          await reportProviderCreditFailure({ tenantId, alert: credit.toJSON() }).catch(() => undefined);
        }
        const message = credit?.message || (err instanceof Error ? err.message : 'Website scrape failed');
        // Profile is already saved — return partial success with scrape error
        return reply.status(200).send({
          success: true,
          data: settings,
          meta: {
            scraped: false,
            scrapeError: message,
            ...(credit
              ? { code: 'PROVIDER_CREDITS', creditAlert: credit.toJSON() }
              : {}),
          },
        });
      }
    }

    return {
      success: true,
      data: settings,
      meta: scraped
        ? {
            scraped: true,
            pagesScraped: scraped.pagesScraped,
            sourceUrls: scraped.sourceUrls,
            scrapeMethod: scraped.scrapeMethod,
            llmProvider: scraped.llmProvider,
            llmModel: scraped.llmModel,
          }
        : { scraped: false },
    };
  });

  /** Re-scrape website into brand voice / sector / guidelines (B2B only). Does NOT change Brand Kit colours — use scrape-colors for that. */
  app.post('/brand/scrape-website', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const body = z
      .object({
        websiteUrl: z.string().optional(),
        /** When true, overwrite even if fields already have human edits */
        overwrite: z.boolean().optional().default(true),
      })
      .parse(request.body ?? {});

    const tenantId = request.session.tenantId!;
    const existing = await prisma.brandSettings.findUnique({ where: { tenantId } });
    if (!existing) {
      return reply.status(400).send({ success: false, error: 'Save company profile first' });
    }
    if (existing.brandType === 'b2c') {
      return reply.status(400).send({
        success: false,
        error: 'Website scrape runs for B2B brands only. Switch brand type to B2B first.',
      });
    }

    const websiteUrl = (body.websiteUrl || existing.websiteUrl || '').trim();
    if (!websiteUrl) {
      return reply.status(400).send({ success: false, error: 'Add a website URL first' });
    }

    try {
      const { scrapeBrandWebsite } = await import('../services/brand-website-scrape.service');
      const profileFromSite = await scrapeBrandWebsite(tenantId, websiteUrl);
      const overwrite = body.overwrite !== false;
      const pick = (current: string, next: string) =>
        overwrite ? next || current : current.trim() || next || current;

      const settings = await prisma.brandSettings.update({
        where: { tenantId },
        data: {
          websiteUrl,
          companyName: pick(existing.companyName, profileFromSite.companyName || ''),
          productName: pick(existing.productName, profileFromSite.productName || ''),
          productTagline: pick(existing.productTagline, profileFromSite.productTagline || ''),
          industry: pick(existing.industry, profileFromSite.industry),
          brandVoice: pick(existing.brandVoice, profileFromSite.brandVoice),
          contentGuidelines: pick(existing.contentGuidelines, profileFromSite.contentGuidelines),
          targetAudience: pick(existing.targetAudience, profileFromSite.targetAudience),
          imageStyle: pick(existing.imageStyle, profileFromSite.imageStyle),
          hashtagStrategy: pick(existing.hashtagStrategy, profileFromSite.hashtagStrategy),
          contactEmail: pick(existing.contactEmail || '', profileFromSite.contactEmail || ''),
          instagramUrl: pick(existing.instagramUrl || '', profileFromSite.instagramUrl || ''),
          facebookUrl: pick(existing.facebookUrl || '', profileFromSite.facebookUrl || ''),
          linkedinUrl: pick(existing.linkedinUrl || '', profileFromSite.linkedinUrl || ''),
          twitterUrl: pick(existing.twitterUrl || '', profileFromSite.twitterUrl || ''),
          websiteScrapedAt: new Date(),
        },
      });

      return {
        success: true,
        data: settings,
        meta: {
          pagesScraped: profileFromSite.pagesScraped,
          sourceUrls: profileFromSite.sourceUrls,
          scrapeMethod: profileFromSite.scrapeMethod,
          llmProvider: profileFromSite.llmProvider,
          llmModel: profileFromSite.llmModel,
        },
      };
    } catch (err) {
      const { replyProviderCredit } = await import('../services/provider-credit-alert.service');
      if (await replyProviderCredit(reply, request.session.tenantId, err, 'scrape')) return;
      const message = err instanceof Error ? err.message : 'Website scrape failed';
      return reply.status(502).send({ success: false, error: message });
    }
  });

  /**
   * Review-first Brand DNA analysis. Nothing is persisted until the user saves
   * the proposed fields from Settings.
   */
  app.post('/brand/analyze', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const body = z
      .object({ websiteUrl: z.string().min(3) })
      .parse(request.body ?? {});
    const tenantId = request.session.tenantId!;
    try {
      const [{ scrapeBrandWebsite }, { scrapeBrandColorsFromWebsite }] = await Promise.all([
        import('../services/brand-website-scrape.service'),
        import('../services/scrape-brand-colors.service'),
      ]);
      const [profile, palette] = await Promise.all([
        scrapeBrandWebsite(tenantId, body.websiteUrl),
        scrapeBrandColorsFromWebsite(body.websiteUrl),
      ]);
      const colors =
        palette.rolesFromVars >= profile.colorsDetected || profile.colorSource === 'fallback'
          ? palette.colors
          : profile.colors;
      return {
        success: true,
        data: {
          companyName: profile.companyName || '',
          productName: profile.productName || '',
          productTagline: profile.productTagline || '',
          industry: profile.industry,
          brandVoice: profile.brandVoice,
          contentGuidelines: profile.contentGuidelines,
          targetAudience: profile.targetAudience,
          imageStyle: profile.imageStyle,
          hashtagStrategy: profile.hashtagStrategy,
          contactEmail: profile.contactEmail || '',
          instagramUrl: profile.instagramUrl || '',
          facebookUrl: profile.facebookUrl || '',
          linkedinUrl: profile.linkedinUrl || '',
          twitterUrl: profile.twitterUrl || '',
          primaryColor: colors.primary,
          secondaryColor: colors.secondary,
          accentColor: colors.accent,
          backgroundColor: colors.background,
          textColor: colors.text,
        },
        meta: {
          sourceUrls: profile.sourceUrls,
          pagesScraped: profile.pagesScraped,
          scrapeMethod: profile.scrapeMethod,
          colorSource: palette.colorSource,
          colorsDetected: palette.colorsDetected,
          rolesFromVars: palette.rolesFromVars,
          notice:
            'Review every detected value before saving. Website themes often contain third-party utility colours.',
        },
      };
    } catch (err) {
      const { replyProviderCredit } = await import('../services/provider-credit-alert.service');
      if (await replyProviderCredit(reply, tenantId, err, 'scrape')) return;
      return reply.status(502).send({
        success: false,
        error: err instanceof Error ? err.message : 'Brand analysis failed',
      });
    }
  });

  /**
   * Scrape Brand Kit colours from the company website (CSS / theme tokens only).
   * Does not change fonts or copy. Pass save=true to persist immediately.
   */
  app.post('/brand/scrape-colors', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const body = z
      .object({
        websiteUrl: z.string().optional(),
        /** Persist colours to BrandSettings (default true). */
        save: z.boolean().optional().default(true),
      })
      .parse(request.body ?? {});

    const tenantId = request.session.tenantId!;
    const existing = await prisma.brandSettings.findUnique({ where: { tenantId } });
    if (!existing) {
      return reply.status(400).send({ success: false, error: 'Save company profile first' });
    }

    const websiteUrl = (body.websiteUrl || existing.websiteUrl || '').trim();
    if (!websiteUrl) {
      return reply.status(400).send({ success: false, error: 'Add a website URL first' });
    }

    try {
      const { scrapeBrandColorsFromWebsite } = await import('../services/scrape-brand-colors.service');
      const result = await scrapeBrandColorsFromWebsite(websiteUrl);

      let settings = existing;
      if (body.save !== false) {
        settings = await prisma.brandSettings.update({
          where: { tenantId },
          data: {
            primaryColor: result.colors.primary,
            secondaryColor: result.colors.secondary,
            accentColor: result.colors.accent,
            backgroundColor: result.colors.background,
            textColor: result.colors.text,
            // Fonts / imageStyle intentionally untouched
          },
        });
      }

      return {
        success: true,
        data: settings,
        meta: {
          saved: body.save !== false,
          colors: result.colors,
          colorSource: result.colorSource,
          colorsDetected: result.colorsDetected,
          rolesFromVars: result.rolesFromVars,
          stylesheetsFetched: result.stylesheetsFetched,
          sourceUrl: result.sourceUrl,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Colour scrape failed';
      return reply.status(502).send({ success: false, error: message });
    }
  });

  app.get('/brand/poster-references', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const [settings, references] = await Promise.all([
      prisma.brandSettings.findUnique({
        where: { tenantId },
        select: { posterReferenceMode: true, posterVisualProfile: true },
      }),
      prisma.brandPosterReference.findMany({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      success: true,
      data: {
        mode: settings?.posterReferenceMode || 'off',
        visualProfile: settings?.posterVisualProfile || '',
        references,
        max: 20,
      },
    };
  });

  app.post(
    '/brand/poster-references',
    { preHandler: requireRole(UserRole.ADMIN) },
    async (request, reply) => {
      const tenantId = request.session.tenantId!;
      const count = await prisma.brandPosterReference.count({
        where: { tenantId, isActive: true },
      });
      if (count >= 20) {
        return reply.status(409).send({
          success: false,
          error: 'You can keep up to 20 active brand poster references.',
        });
      }
      const data = await request.file();
      if (!data) return reply.status(400).send({ success: false, error: 'No poster uploaded' });
      if (!data.mimetype.startsWith('image/')) {
        return reply.status(400).send({ success: false, error: 'Please upload an image' });
      }
      const buffer = await data.toBuffer();
      if (buffer.length > 20 * 1024 * 1024) {
        return reply.status(400).send({ success: false, error: 'Image too large (max 20MB)' });
      }
      const stored = await storeOriginalImage({
        tenantId,
        subdir: 'brand-poster-references',
        buffer,
        originalFilename: data.filename || 'brand-poster.png',
        mimetype: data.mimetype,
        logLabel: 'brand-poster-reference',
      });
      try {
        const { describeBrandReferenceStyle } = await import('../services/reference-style.service');
        const styleBrief = await describeBrandReferenceStyle(tenantId, stored.publicUrl);
        const reference = await prisma.$transaction(
          async (tx) => {
            const activeCount = await tx.brandPosterReference.count({
              where: { tenantId, isActive: true },
            });
            if (activeCount >= 20) throw new Error('POSTER_REFERENCE_LIMIT');
            return tx.brandPosterReference.create({
              data: {
                tenantId,
                imageUrl: stored.publicUrl,
                label: (data.filename || `Brand poster ${activeCount + 1}`).slice(0, 160),
                styleBrief,
                width: stored.width,
                height: stored.height,
              },
            });
          },
          { isolationLevel: 'Serializable' },
        );
        const { refreshPosterVisualProfile } = await import(
          '../services/brand-poster-reference.service'
        );
        const visualProfile = await refreshPosterVisualProfile(tenantId);
        return { success: true, data: { reference, visualProfile } };
      } catch (err) {
        await fs.unlink(stored.absolutePath).catch(() => undefined);
        if (err instanceof Error && err.message === 'POSTER_REFERENCE_LIMIT') {
          return reply.status(409).send({
            success: false,
            error: 'You can keep up to 20 active brand poster references.',
          });
        }
        const { replyProviderCredit } = await import('../services/provider-credit-alert.service');
        if (await replyProviderCredit(reply, tenantId, err, 'caption')) return;
        return reply.status(502).send({
          success: false,
          error: `Poster analysis failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        });
      }
    },
  );

  app.delete(
    '/brand/poster-references/:id',
    { preHandler: requireRole(UserRole.ADMIN) },
    async (request, reply) => {
      const tenantId = request.session.tenantId!;
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const reference = await prisma.brandPosterReference.findFirst({
        where: { id, tenantId, isActive: true },
      });
      if (!reference) {
        return reply.status(404).send({ success: false, error: 'Poster reference not found' });
      }
      await prisma.brandPosterReference.update({
        where: { id },
        data: { isActive: false },
      });
      if (reference.imageUrl.startsWith('/uploads/')) {
        const relative = reference.imageUrl.replace(/^\/uploads\//, '');
        const absolute = path.resolve(config.UPLOAD_DIR, relative);
        if (absolute.startsWith(path.resolve(config.UPLOAD_DIR))) {
          await fs.unlink(absolute).catch(() => undefined);
        }
      }
      const { refreshPosterVisualProfile } = await import(
        '../services/brand-poster-reference.service'
      );
      const visualProfile = await refreshPosterVisualProfile(tenantId);
      return { success: true, data: { visualProfile } };
    },
  );

  app.post('/brand/logo', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });
    if (!data.mimetype.startsWith('image/')) {
      return reply.status(400).send({ success: false, error: 'Please upload an image (PNG/JPG/WebP/SVG)' });
    }

    const tenantId = request.session.tenantId!;
    const buffer = await data.toBuffer();
    if (buffer.length > 20 * 1024 * 1024) {
      return reply.status(400).send({ success: false, error: 'Logo too large (max 20MB)' });
    }

    // Always store byte-identical original as logoUrl — never replace with knockout.
    // Knockout (lossless PNG) is generated on demand for social overlays only.
    const stored = await storeOriginalImage({
      tenantId,
      subdir: 'brand-logo',
      buffer,
      originalFilename: data.filename || 'logo.png',
      mimetype: data.mimetype,
      logLabel: 'brand-logo',
    });
    const logoUrl = stored.publicUrl;

    // Warm overlay cache asynchronously — failure must not change stored original
    void import('../providers/images/logo-prepare')
      .then(({ prepareLogoForOverlay }) => prepareLogoForOverlay(logoUrl, tenantId))
      .catch((err) => console.warn('[upload:brand-logo] knockout cache skipped', err));

    const settings = await prisma.brandSettings.upsert({
      where: { tenantId },
      create: { tenantId, logoUrl },
      update: { logoUrl },
    });
    return { success: true, data: settings };
  });

  // ── Integrations (API keys — shared across all companies for this account) ──
  app.get('/providers', { preHandler: requireAuth }, async (request) => {
    const data = await getProviderSettingsPublic(request.session.tenantId!);
    return { success: true, data };
  });

  app.put('/providers', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const body = z.object({
      llmProvider: z.enum(['openai', 'claude']).optional(),
      llmModel: z.string().optional(),
      openaiApiKey: z.string().optional(),
      claudeApiKey: z.string().optional(),
      claudeWorkspaceId: z.string().optional().nullable(),
      imageProvider: z.enum(['fal', 'openai']).optional(),
      falModel: z.string().optional(),
      falApiKey: z.string().optional(),
      imageRoutingMode: z.enum(['auto', 'manual']).optional(),
      searchProvider: z.enum(['tavily', 'serpapi']).optional(),
      tavilyApiKey: z.string().optional(),
      serpapiApiKey: z.string().optional(),
      apifyApiToken: z.string().optional(),
      placidApiKey: z.string().optional(),
      notificationProvider: z.enum(['slack', 'teams', 'email']).optional(),
      slackWebhookUrl: z.string().optional(),
      teamsWebhookUrl: z.string().optional(),
      resendApiKey: z.string().optional(),
      notificationEmail: z.string().optional(),
      soundAlertsEnabled: z.boolean().optional(),
      trendsMode: z.enum(['manual', 'auto']).optional(),
      competitorMode: z.enum(['manual', 'auto']).optional(),
      competitorImageMode: z.enum(['new_topic', 'near_mirror']).optional(),
      newsletterMode: z.enum(['manual', 'auto']).optional(),
    }).parse(request.body);

    const tenantId = request.session.tenantId!;
    await upsertProviderSettings(tenantId, body);

    const { syncProviderSettingsAcrossUserCompanies } = await import('../services/providers.service');
    if (request.session.userId) {
      await syncProviderSettingsAcrossUserCompanies(request.session.userId, tenantId);
    }

    const data = await getProviderSettingsPublic(tenantId);
    return { success: true, data };
  });

  /** Send a real Resend test email to the configured alert address */
  app.post('/providers/test-email', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const body = z
      .object({
        to: z.string().email().optional(),
      })
      .parse(request.body ?? {});
    const { sendTestEmailAlert } = await import('../providers/notifications');
    const result = await sendTestEmailAlert(request.session.tenantId!, body.to);
    if (!result.ok) {
      return reply.status(400).send({ success: false, error: result.error });
    }
    return { success: true, data: { to: result.to, message: 'Test email sent via Resend' } };
  });

  // ── Topics (soft-delete) ──
  app.get('/topics', { preHandler: requireAuth }, async (request) => {
    const includeDeleted = (request.query as { includeDeleted?: string }).includeDeleted === '1';
    const topics = await prisma.topic.findMany({
      where: {
        tenantId: request.session.tenantId!,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: { rotationOrder: 'asc' },
    });
    return { success: true, data: topics };
  });

  app.post('/topics', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const body = z.object({
      name: z.string().min(1),
      searchKeywords: z.string().optional(),
      rotationOrder: z.number().optional(),
    }).parse(request.body);

    const topic = await prisma.topic.create({
      data: { tenantId: request.session.tenantId!, ...body },
    });
    return { success: true, data: topic };
  });

  app.post('/topics/bulk', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const tenantId = request.session.tenantId!;
    const {
      parseTopicsBulkText,
      parseTopicsBulkWorkbook,
    } = await import('../services/bulk-settings-import.service');

    let rows: Array<{ name: string; searchKeywords: string }> = [];
    let warnings: string[] = [];
    let source: 'text' | 'excel' | 'csv' = 'text';

    const isMultipart = Boolean(request.isMultipart?.());
    if (isMultipart) {
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
      const name = (file.filename || '').toLowerCase();
      const isExcel = /\.xlsx?$/.test(name) || /sheet|excel|spreadsheet/.test(file.mimetype || '');
      if (isExcel) {
        const parsed = parseTopicsBulkWorkbook(buffer);
        rows = parsed.rows;
        warnings = parsed.warnings;
        source = 'excel';
      } else {
        const parsed = parseTopicsBulkText(buffer.toString('utf8'));
        rows = parsed.rows;
        warnings = parsed.warnings;
        source = 'csv';
      }
    } else {
      const body = z
        .object({
          text: z.string().min(1).max(50_000),
        })
        .parse(request.body);
      const parsed = parseTopicsBulkText(body.text);
      rows = parsed.rows;
      warnings = parsed.warnings;
      source = 'text';
    }

    if (!rows.length) {
      return reply.status(400).send({
        success: false,
        error: 'No topics found. Use comma-separated keywords or an Excel with a name column.',
        data: { warnings },
      });
    }

    const existing = await prisma.topic.findMany({
      where: { tenantId, deletedAt: null },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((t) => t.name.trim().toLowerCase()));
    let created = 0;
    let skipped = 0;
    const maxOrder = await prisma.topic.aggregate({
      where: { tenantId },
      _max: { rotationOrder: true },
    });
    let nextOrder = (maxOrder._max.rotationOrder ?? 0) + 1;

    for (const row of rows) {
      const key = row.name.trim().toLowerCase();
      if (existingNames.has(key)) {
        skipped += 1;
        continue;
      }
      await prisma.topic.create({
        data: {
          tenantId,
          name: row.name.trim(),
          searchKeywords: (row.searchKeywords || row.name).trim(),
          rotationOrder: nextOrder++,
        },
      });
      existingNames.add(key);
      created += 1;
    }

    return {
      success: true,
      data: {
        created,
        skipped,
        totalParsed: rows.length,
        warnings,
        source,
      },
    };
  });

  app.get('/topics/bulk/template.xlsx', { preHandler: requireAuth }, async (_request, reply) => {
    const { buildTopicsBulkTemplateBuffer } = await import('../services/bulk-settings-import.service');
    const buf = buildTopicsBulkTemplateBuffer();
    reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .header('Content-Disposition', 'attachment; filename="trend-keywords-template.xlsx"')
      .send(buf);
  });

  app.post('/topics/auto', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const body = z
      .object({
        websiteUrl: z.string().max(400).optional(),
        limit: z.number().int().min(3).max(15).optional(),
      })
      .parse(request.body ?? {});
    try {
      const { autoDiscoverTopics } = await import('../services/auto-discover-settings.service');
      const result = await autoDiscoverTopics(request.session.tenantId!, body);
      return { success: true, data: result };
    } catch (err) {
      const { replyProviderCredit } = await import('../services/provider-credit-alert.service');
      if (await replyProviderCredit(reply, request.session.tenantId, err, 'search')) return;
      const msg = err instanceof Error ? err.message : 'Auto topic discovery failed';
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.patch('/topics/:id', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().optional(),
      searchKeywords: z.string().optional(),
      isActive: z.boolean().optional(),
      rotationOrder: z.number().optional(),
    }).parse(request.body);

    const topic = await prisma.topic.updateMany({
      where: { id, tenantId: request.session.tenantId!, deletedAt: null },
      data: body,
    });
    if (topic.count === 0) return { success: false, error: 'Not found' };
    return { success: true };
  });

  app.delete('/topics/:id', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.topic.updateMany({
      where: { id, tenantId: request.session.tenantId! },
      data: SoftDelete,
    });
    return { success: true, data: { softDeleted: true } };
  });

  app.post('/topics/:id/restore', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.topic.updateMany({
      where: { id, tenantId: request.session.tenantId! },
      data: { deletedAt: null, isActive: true },
    });
    return { success: true };
  });

  // ── Competitors ──
  const socialUrlsSchema = z
    .object({
      instagram: z.string().optional(),
      facebook: z.string().optional(),
      linkedin: z.string().optional(),
      twitter: z.string().optional(),
      youtube: z.string().optional(),
      tiktok: z.string().optional(),
      website: z.string().optional(),
    })
    .partial()
    .optional();

  function normalizeSocialUrls(
    input?: Record<string, string | undefined> | null,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    if (!input) return out;
    for (const [key, raw] of Object.entries(input)) {
      const v = (raw || '').trim();
      if (!v) continue;
      try {
        const url = v.includes('://') ? v : `https://${v}`;
        // eslint-disable-next-line no-new
        new URL(url);
        out[key] = url;
      } catch {
        // skip invalid
      }
    }
    return out;
  }

  function primaryProfileUrl(
    platform: string,
    socialUrls: Record<string, string>,
    profileUrl?: string | null,
  ): string | null {
    if (profileUrl && profileUrl.trim()) return profileUrl.trim();
    return socialUrls[platform] || Object.values(socialUrls)[0] || null;
  }

  /** Derive a scrape username from a profile URL when handle is not provided. */
  function handleFromSocialUrl(platform: string, url: string | null | undefined, fallbackName: string): string {
    if (!url) {
      return fallbackName.toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 64) || 'competitor';
    }
    try {
      const u = new URL(url.includes('://') ? url : `https://${url}`);
      const parts = u.pathname.split('/').filter(Boolean);
      if (platform === 'linkedin') {
        // /company/zoho or /in/person
        if (parts[0] === 'company' || parts[0] === 'in' || parts[0] === 'school') {
          return parts.slice(0, 2).join('/') || parts[0];
        }
      }
      const candidate = parts[0] || '';
      return candidate.replace(/^@/, '') || fallbackName.toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 64) || 'competitor';
    } catch {
      return fallbackName.toLowerCase().replace(/[^a-z0-9._-]+/g, '').slice(0, 64) || 'competitor';
    }
  }

  app.get('/competitors', { preHandler: requireAuth }, async (request) => {
    const includeDeleted = (request.query as { includeDeleted?: string }).includeDeleted === '1';
    const competitors = await prisma.competitor.findMany({
      where: {
        tenantId: request.session.tenantId!,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: { rotationOrder: 'asc' },
    });
    return { success: true, data: competitors };
  });

  app.post('/competitors', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1),
      handle: z.string().optional().or(z.literal('')),
      platform: z.enum(['instagram', 'linkedin', 'facebook', 'twitter']),
      profileUrl: z.string().optional().or(z.literal('')),
      socialUrls: socialUrlsSchema,
      rotationOrder: z.number().optional(),
    }).parse(request.body);

    const socialUrls = normalizeSocialUrls(body.socialUrls as Record<string, string | undefined> | undefined);
    const profileUrl = primaryProfileUrl(body.platform, socialUrls, body.profileUrl);
    if (!profileUrl && Object.keys(socialUrls).length === 0) {
      return reply.status(400).send({
        success: false,
        error: 'Add at least one social profile URL (Instagram, LinkedIn, etc.).',
      });
    }

    // Prefer the network that actually has a URL when primary is empty
    let platform = body.platform;
    if (!socialUrls[platform] && !body.profileUrl) {
      const firstKey = Object.keys(socialUrls)[0];
      if (firstKey && ['instagram', 'linkedin', 'facebook', 'twitter'].includes(firstKey)) {
        platform = firstKey as typeof platform;
      }
    }

    const scrapeUrl = primaryProfileUrl(platform, socialUrls, body.profileUrl);
    const handle =
      (body.handle || '').replace(/^@/, '').trim() ||
      handleFromSocialUrl(platform, scrapeUrl, body.name);

    const competitor = await prisma.competitor.create({
      data: {
        tenantId: request.session.tenantId!,
        name: body.name,
        handle,
        platform,
        profileUrl: scrapeUrl,
        socialUrls,
        rotationOrder: body.rotationOrder,
      },
    });
    return { success: true, data: competitor };
  });

  app.post('/competitors/bulk', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const tenantId = request.session.tenantId!;
    const {
      parseCompetitorsBulkText,
      parseCompetitorsBulkWorkbook,
    } = await import('../services/bulk-settings-import.service');

    let rows: Array<{
      name: string;
      platform: 'instagram' | 'linkedin' | 'facebook' | 'twitter';
      socialUrls: Record<string, string>;
    }> = [];
    let warnings: string[] = [];
    let source: 'text' | 'excel' | 'csv' = 'text';

    const isMultipart = Boolean(request.isMultipart?.());
    if (isMultipart) {
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
      const name = (file.filename || '').toLowerCase();
      const isExcel = /\.xlsx?$/.test(name) || /sheet|excel|spreadsheet/.test(file.mimetype || '');
      if (isExcel) {
        const parsed = parseCompetitorsBulkWorkbook(buffer);
        rows = parsed.rows;
        warnings = parsed.warnings;
        source = 'excel';
      } else {
        const parsed = parseCompetitorsBulkText(buffer.toString('utf8'));
        rows = parsed.rows;
        warnings = parsed.warnings;
        source = 'csv';
      }
    } else {
      const body = z
        .object({
          text: z.string().min(1).max(100_000),
        })
        .parse(request.body);
      const parsed = parseCompetitorsBulkText(body.text);
      rows = parsed.rows;
      warnings = parsed.warnings;
      source = 'text';
    }

    if (!rows.length) {
      return reply.status(400).send({
        success: false,
        error:
          'No competitors found. Use one per line: Name, https://instagram.com/… — or upload the Excel template.',
        data: { warnings },
      });
    }

    const existing = await prisma.competitor.findMany({
      where: { tenantId, deletedAt: null },
      select: { name: true, profileUrl: true, handle: true },
    });
    const existingKeys = new Set(
      existing.flatMap((c) =>
        [
          c.name.trim().toLowerCase(),
          (c.profileUrl || '').trim().toLowerCase(),
          (c.handle || '').trim().toLowerCase(),
        ].filter(Boolean),
      ),
    );

    const maxOrder = await prisma.competitor.aggregate({
      where: { tenantId },
      _max: { rotationOrder: true },
    });
    let nextOrder = (maxOrder._max.rotationOrder ?? 0) + 1;
    let created = 0;
    let skipped = 0;

    for (const row of rows) {
      const socialUrls = normalizeSocialUrls(row.socialUrls);
      let platform = row.platform;
      if (!socialUrls[platform]) {
        const firstKey = Object.keys(socialUrls)[0];
        if (firstKey && ['instagram', 'linkedin', 'facebook', 'twitter'].includes(firstKey)) {
          platform = firstKey as typeof platform;
        }
      }
      const scrapeUrl = primaryProfileUrl(platform, socialUrls, null);
      if (!scrapeUrl && !Object.keys(socialUrls).length) {
        skipped += 1;
        warnings.push(`Skipped “${row.name}” — no valid URLs.`);
        continue;
      }
      const handle = handleFromSocialUrl(platform, scrapeUrl, row.name);
      const keys = [
        row.name.trim().toLowerCase(),
        (scrapeUrl || '').toLowerCase(),
        handle.toLowerCase(),
      ].filter(Boolean);
      if (keys.some((k) => existingKeys.has(k))) {
        skipped += 1;
        continue;
      }

      await prisma.competitor.create({
        data: {
          tenantId,
          name: row.name.trim(),
          handle,
          platform,
          profileUrl: scrapeUrl,
          socialUrls,
          rotationOrder: nextOrder++,
        },
      });
      keys.forEach((k) => existingKeys.add(k));
      created += 1;
    }

    return {
      success: true,
      data: {
        created,
        skipped,
        totalParsed: rows.length,
        warnings,
        source,
      },
    };
  });

  app.get('/competitors/bulk/template.xlsx', { preHandler: requireAuth }, async (_request, reply) => {
    const { buildCompetitorsBulkTemplateBuffer } = await import(
      '../services/bulk-settings-import.service'
    );
    const buf = buildCompetitorsBulkTemplateBuffer();
    reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      )
      .header('Content-Disposition', 'attachment; filename="competitors-template.xlsx"')
      .send(buf);
  });

  app.post('/competitors/auto', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const body = z
      .object({
        websiteUrl: z.string().max(400).optional(),
        limit: z.number().int().min(3).max(12).optional(),
      })
      .parse(request.body ?? {});
    try {
      const { autoDiscoverCompetitors } = await import('../services/auto-discover-settings.service');
      const result = await autoDiscoverCompetitors(request.session.tenantId!, body);
      return { success: true, data: result };
    } catch (err) {
      const { replyProviderCredit } = await import('../services/provider-credit-alert.service');
      if (await replyProviderCredit(reply, request.session.tenantId, err, 'search')) return;
      const msg = err instanceof Error ? err.message : 'Auto competitor discovery failed';
      return reply.status(400).send({ success: false, error: msg });
    }
  });

  app.patch('/competitors/:id', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().optional(),
      handle: z.string().optional(),
      platform: z.enum(['instagram', 'linkedin', 'facebook', 'twitter']).optional(),
      profileUrl: z.string().optional().nullable(),
      socialUrls: socialUrlsSchema,
      isActive: z.boolean().optional(),
      rotationOrder: z.number().optional(),
    }).parse(request.body);

    const existing = await prisma.competitor.findFirst({
      where: { id, tenantId: request.session.tenantId!, deletedAt: null },
    });
    if (!existing) return { success: false, error: 'Not found' };

    const socialUrls =
      body.socialUrls !== undefined
        ? normalizeSocialUrls(body.socialUrls as Record<string, string | undefined>)
        : (existing.socialUrls as Record<string, string>) || {};
    const platform = body.platform || existing.platform;
    const profileUrl =
      body.profileUrl !== undefined || body.socialUrls !== undefined
        ? primaryProfileUrl(platform, socialUrls, body.profileUrl ?? existing.profileUrl)
        : undefined;

    await prisma.competitor.updateMany({
      where: { id, tenantId: request.session.tenantId!, deletedAt: null },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.handle !== undefined ? { handle: body.handle.replace(/^@/, '') } : {}),
        ...(body.platform !== undefined ? { platform: body.platform } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.rotationOrder !== undefined ? { rotationOrder: body.rotationOrder } : {}),
        ...(body.socialUrls !== undefined ? { socialUrls } : {}),
        ...(profileUrl !== undefined ? { profileUrl } : {}),
      },
    });
    return { success: true };
  });

  app.delete('/competitors/:id', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.competitor.updateMany({
      where: { id, tenantId: request.session.tenantId! },
      data: SoftDelete,
    });
    return { success: true, data: { softDeleted: true } };
  });

  app.post('/competitors/:id/restore', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.competitor.updateMany({
      where: { id, tenantId: request.session.tenantId! },
      data: { deletedAt: null, isActive: true },
    });
    return { success: true };
  });

  // ── Content Library ──
  app.get('/library', { preHandler: requireAuth }, async (request) => {
    const includeDeleted = (request.query as { includeDeleted?: string }).includeDeleted === '1';
    const items = await prisma.contentLibraryItem.findMany({
      where: {
        tenantId: request.session.tenantId!,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: [{ rotationOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        title: true,
        category: true,
        fileType: true,
        isActive: true,
        rotationOrder: true,
        lastUsedAt: true,
        createdAt: true,
        deletedAt: true,
        generationRules: true,
        extractedText: true,
      },
    });
    return {
      success: true,
      data: items.map(({ extractedText, ...item }) => ({
        ...item,
        textLength: extractedText?.length || 0,
        excerpt: (extractedText || '').slice(0, 280),
      })),
    };
  });

  app.post('/library/upload', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const data = await request.file();
    if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });

    const allowedTypes = [
      'application/pdf', 'text/plain', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (!allowedTypes.includes(data.mimetype)) {
      return reply.status(400).send({ success: false, error: 'Unsupported file type' });
    }

    const uploadDir = path.resolve(config.UPLOAD_DIR, request.session.tenantId!);
    await fs.mkdir(uploadDir, { recursive: true });

    const filename = `${Date.now()}-${data.filename}`;
    const filePath = path.join(uploadDir, filename);
    const buffer = await data.toBuffer();

    if (buffer.length > 10 * 1024 * 1024) {
      return reply.status(400).send({ success: false, error: 'File too large (max 10MB)' });
    }

    await fs.writeFile(filePath, buffer);

    let extractedText = '';
    if (data.mimetype === 'application/pdf') {
      const parsed = await pdfParse(buffer);
      extractedText = parsed.text;
    } else if (data.mimetype === 'text/plain') {
      extractedText = buffer.toString('utf-8');
    }

    const fields = data.fields as Record<string, { value: string }>;
    const title = fields.title?.value ?? data.filename ?? 'Untitled';
    const category = fields.category?.value ?? '';
    const generationRules = fields.generationRules?.value ?? '';

    const item = await prisma.contentLibraryItem.create({
      data: {
        tenantId: request.session.tenantId!,
        title,
        category,
        filePath,
        fileType: data.mimetype,
        extractedText,
        generationRules,
      },
    });

    return { success: true, data: { id: item.id, title: item.title, textLength: extractedText.length } };
  });

  app.patch('/library/:id', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      title: z.string().optional(),
      category: z.string().optional(),
      isActive: z.boolean().optional(),
      rotationOrder: z.number().optional(),
      generationRules: z.string().optional(),
    }).parse(request.body);

    await prisma.contentLibraryItem.updateMany({
      where: { id, tenantId: request.session.tenantId!, deletedAt: null },
      data: body,
    });
    return { success: true };
  });

  app.delete('/library/:id', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    // Soft-delete only — file stays on disk, row stays in DB
    await prisma.contentLibraryItem.updateMany({
      where: { id, tenantId: request.session.tenantId! },
      data: SoftDelete,
    });
    return { success: true, data: { softDeleted: true } };
  });

  app.post('/library/:id/restore', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.contentLibraryItem.updateMany({
      where: { id, tenantId: request.session.tenantId! },
      data: { deletedAt: null, isActive: true },
    });
    return { success: true };
  });

  // ── Product Newsletter templates (AI fills {{slots}} only) ──
  app.get('/newsletter', { preHandler: requireAuth }, async (request) => {
    const includeDeleted = (request.query as { includeDeleted?: string }).includeDeleted === '1';
    const items = await prisma.newsletterTemplate.findMany({
      where: {
        tenantId: request.session.tenantId!,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: { rotationOrder: 'asc' },
    });
    return { success: true, data: items };
  });

  app.post('/newsletter', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const body = z.object({
      name: z.string().min(1),
      bodyTemplate: z.string().min(1),
      headlineTemplate: z.string().default('{{headline}}'),
      fillZones: z.array(z.string()).default(['headline', 'body', 'cta', 'hashtags', 'imagePrompt']),
      productContext: z.string().optional(),
      generationRules: z.string().optional(),
    }).parse(request.body);

    const item = await prisma.newsletterTemplate.create({
      data: {
        tenantId: request.session.tenantId!,
        name: body.name,
        bodyTemplate: body.bodyTemplate,
        headlineTemplate: body.headlineTemplate,
        fillZones: body.fillZones,
        productContext: body.productContext || '',
        generationRules: body.generationRules || '',
      },
    });
    return { success: true, data: item };
  });

  app.patch('/newsletter/:id', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().optional(),
      bodyTemplate: z.string().optional(),
      headlineTemplate: z.string().optional(),
      fillZones: z.array(z.string()).optional(),
      productContext: z.string().optional(),
      generationRules: z.string().optional(),
      isActive: z.boolean().optional(),
      rotationOrder: z.number().optional(),
    }).parse(request.body);

    await prisma.newsletterTemplate.updateMany({
      where: { id, tenantId: request.session.tenantId!, deletedAt: null },
      data: {
        ...body,
        fillZones: body.fillZones,
      },
    });
    return { success: true };
  });

  app.delete('/newsletter/:id', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.newsletterTemplate.updateMany({
      where: { id, tenantId: request.session.tenantId! },
      data: SoftDelete,
    });
    return { success: true, data: { softDeleted: true } };
  });

  app.post('/newsletter/:id/restore', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.newsletterTemplate.updateMany({
      where: { id, tenantId: request.session.tenantId! },
      data: { deletedAt: null, isActive: true },
    });
    return { success: true };
  });

  // ── Platform Connections ──
  app.get('/platforms', { preHandler: requireAuth }, async (request) => {
    const connections = await prisma.platformConnection.findMany({
      where: { tenantId: request.session.tenantId!, deletedAt: null },
      select: {
        id: true, platform: true, accountName: true, accountId: true, isActive: true,
        tokenExpiresAt: true, createdAt: true,
      },
    });
    return { success: true, data: connections };
  });

  app.post('/platforms', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const body = z.object({
      platform: z.enum(['instagram', 'linkedin', 'facebook', 'twitter']),
      accountName: z.string().min(1),
      accessToken: z.string().min(1),
      refreshToken: z.string().optional(),
      accountId: z.string().optional().or(z.literal('')),
      tokenExpiresAt: z.string().datetime().optional(),
    }).parse(request.body);

    let accountId = body.accountId?.trim() || null;
    let accountName = body.accountName.trim();
    if (body.platform === 'instagram') {
      const { resolveInstagramPublishingAccount } = await import(
        '../services/instagram-account.service'
      );
      const resolved = await resolveInstagramPublishingAccount({
        accessToken: body.accessToken.trim(),
        requestedAccountId: accountId,
        accountName,
      });
      accountId = resolved.accountId;
      accountName = resolved.accountName;
    } else if (!accountId) {
      return reply.status(400).send({
        success: false,
        error: `Account ID is required for ${body.platform}.`,
      });
    }

    const connection = await prisma.platformConnection.create({
      data: {
        tenantId: request.session.tenantId!,
        platform: body.platform,
        accountName,
        accessToken: encrypt(body.accessToken.trim()),
        refreshToken: body.refreshToken ? encrypt(body.refreshToken) : null,
        accountId,
        tokenExpiresAt: body.tokenExpiresAt ? new Date(body.tokenExpiresAt) : null,
      },
    });

    return {
      success: true,
      data: {
        id: connection.id,
        platform: connection.platform,
        accountName: connection.accountName,
        accountId: connection.accountId,
      },
    };
  });

  app.delete('/platforms/:id', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.platformConnection.updateMany({
      where: { id, tenantId: request.session.tenantId! },
      data: SoftDelete,
    });
    return { success: true, data: { softDeleted: true } };
  });
}
