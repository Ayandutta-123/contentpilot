import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UserRole } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  defaultBrandCanvas,
  scaffoldEditablePlateLayout,
  BRAND_FILL_TYPES,
  BRAND_POST_PRESETS,
  applyPostTypeToCanvas,
  type BrandCanvas,
} from '../providers/templates/brand-renderer';
import {
  cachePlacidHqPreview,
  getPlacidTemplate,
  listPlacidTemplates,
  placidLayersToCanvas,
} from '../providers/templates/placid.client';
import {
  runAssistantWorkspaceTurn,
  submitAssistantDraftForApproval,
} from '../services/assistant-workspace.service';
import { suggestionsForBrand } from '../services/content-playbook.service';
import {
  installUploadedTemplates,
  listUploadedTemplates,
  resolvePlayId,
  resolvedAllTemplates,
  resolvedTemplatesByPlay,
  resolvedTemplatesForPlay,
  softDeleteUploadedTemplate,
} from '../services/play-poster-templates.service';
import { brandKitFromSettings } from '../lib/brand-kit';
import { resolveProviders } from '../services/providers.service';
import {
  imageDimensions,
  preferOriginalLogoUrl,
  storeOriginalImage,
} from '../lib/store-upload';
import { CONTENT_PLAYBOOK } from '../services/content-playbook.service';

const SoftDelete = { deletedAt: new Date() };

/** Fix layer.src that still points at legacy knockout derivatives. */
function healCanvasLogoSrcs(canvas: BrandCanvas | null | undefined): BrandCanvas | null | undefined {
  if (!canvas?.layers?.length) return canvas;
  let changed = false;
  const layers = canvas.layers.map((layer) => {
    if (layer.type !== 'image' || !layer.src) return layer;
    const healed = preferOriginalLogoUrl(layer.src);
    if (healed && healed !== layer.src) {
      changed = true;
      return { ...layer, src: healed };
    }
    return layer;
  });
  return changed ? { ...canvas, layers } : canvas;
}

function fieldValue(fields: Record<string, unknown> | undefined, name: string): string | undefined {
  if (!fields) return undefined;
  const raw = fields[name];
  if (raw == null) return undefined;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object' && 'value' in first) {
      return String((first as { value: unknown }).value);
    }
  }
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    return String((raw as { value: unknown }).value);
  }
  return undefined;
}

export async function brandRoutes(app: FastifyInstance) {
  app.get('/templates', { preHandler: requireAuth }, async (request) => {
    const includeDeleted = (request.query as { includeDeleted?: string }).includeDeleted === '1';
    const items = await prisma.brandTemplate.findMany({
      where: {
        tenantId: request.session.tenantId!,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: { createdAt: 'desc' },
    });
    const providers = await resolveProviders(request.session.tenantId!);
    const data = items.map((item) => {
      const canvas = healCanvasLogoSrcs(
        item.canvas && typeof item.canvas === 'object' ? (item.canvas as BrandCanvas) : null,
      );
      return canvas && canvas !== item.canvas ? { ...item, canvas } : item;
    });
    return {
      success: true,
      data,
      meta: {
        inhouseFree: true,
        placidConfigured: Boolean(providers.placidApiKey),
        fillTypes: BRAND_FILL_TYPES,
        postPresets: BRAND_POST_PRESETS,
      },
    };
  });

  app.get('/templates/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = await prisma.brandTemplate.findFirst({
      where: { id, tenantId: request.session.tenantId!, deletedAt: null },
    });
    if (!item) return reply.status(404).send({ success: false, error: 'Template not found' });
    const canvas = healCanvasLogoSrcs(
      item.canvas && typeof item.canvas === 'object' ? (item.canvas as BrandCanvas) : null,
    );
    return {
      success: true,
      data: canvas && canvas !== item.canvas ? { ...item, canvas } : item,
    };
  });

  app.post('/templates', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const body = z.object({
      name: z.string().min(1),
      provider: z.enum(['inhouse', 'placid']).default('inhouse'),
      placidTemplateId: z.string().optional(),
      canvas: z.any().optional(),
      useDefaultCanvas: z.boolean().optional(),
      postType: z.string().optional(),
    }).parse(request.body);

    const brand = await prisma.brandSettings.findUnique({
      where: { tenantId: request.session.tenantId! },
    });
    const providers = await resolveProviders(request.session.tenantId!);
    const placidKey = providers.placidApiKey;

    if (body.provider === 'placid' && !placidKey) {
      return reply.status(400).send({
        success: false,
        error:
          'Design-library API key not set. Add it in Settings → Integrations or Brand Studio.',
      });
    }

    let canvas: BrandCanvas =
      (body.canvas as BrandCanvas) ||
      defaultBrandCanvas({
        companyName: brand?.companyName || body.name,
        postType: body.postType || 'custom',
      });

    // Exact Placid design-stage handoff: template must already be designed in Placid editor
    if (body.provider === 'placid' && body.placidTemplateId && placidKey) {
      try {
        const placid = await getPlacidTemplate(placidKey, body.placidTemplateId.trim());
        canvas = placidLayersToCanvas({
          placid,
          companyName: brand?.companyName,
        }) as BrandCanvas;
      } catch (err) {
        const { replyProviderCredit } = await import('../services/provider-credit-alert.service');
        if (await replyProviderCredit(reply, request.session.tenantId, err, 'generation')) return;
        const message = err instanceof Error ? err.message : 'Template import failed';
        const status = /401|403|token|Unauthenticated/i.test(message) ? 401 : 502;
        return reply.status(status).send({ success: false, error: message });
      }
    }

    const item = await prisma.brandTemplate.create({
      data: {
        tenantId: request.session.tenantId!,
        name: body.name,
        provider: body.provider,
        placidTemplateId: body.placidTemplateId?.trim() || null,
        canvas: canvas as object,
      },
    });

    // Attach high-quality Placid preview (full render / original media, not catalog thumbnail)
    if (body.provider === 'placid' && body.placidTemplateId && placidKey) {
      try {
        const placid = await getPlacidTemplate(placidKey, body.placidTemplateId.trim());
        const hqUrl = await cachePlacidHqPreview({
          apiKey: placidKey,
          tenantId: request.session.tenantId!,
          placid,
        });
        if (hqUrl) {
          const updated = await prisma.brandTemplate.update({
            where: { id: item.id },
            data: { previewUrl: hqUrl, backgroundUrl: hqUrl },
          });
          return { success: true, data: updated };
        }
      } catch (err) {
        const { reportIfCreditError } = await import('../services/provider-credit-alert.service');
        await reportIfCreditError(request.session.tenantId!, err, 'image').catch(() => undefined);
        // keep created item even if HQ preview fails
      }
    }

    return { success: true, data: item };
  });

  /** Import several Placid templates in one request (same logic as single create). */
  app.post(
    '/templates/import-placid-bulk',
    { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) },
    async (request, reply) => {
      const body = z
        .object({
          uuids: z.array(z.string().min(1)).min(1).max(40),
        })
        .parse(request.body ?? {});

      const tenantId = request.session.tenantId!;
      const brand = await prisma.brandSettings.findUnique({ where: { tenantId } });
      const providers = await resolveProviders(tenantId);
      const placidKey = providers.placidApiKey;
      if (!placidKey) {
        return reply.status(400).send({
          success: false,
          error:
            'Design-library API key not set. Add it in Settings → Integrations or Brand Studio.',
        });
      }

      const imported: Array<{ id: string; name: string; placidTemplateId: string | null }> = [];
      const errors: Array<{ uuid: string; error: string }> = [];

      for (const raw of body.uuids) {
        const uuid = raw.trim();
        if (!uuid) continue;
        try {
          const placid = await getPlacidTemplate(placidKey, uuid);
          const canvas = placidLayersToCanvas({
            placid,
            companyName: brand?.companyName,
          });
          const hqUrl = await cachePlacidHqPreview({
            apiKey: placidKey,
            tenantId,
            placid,
          });
          const item = await prisma.brandTemplate.create({
            data: {
              tenantId,
              name: placid.title || `Template ${uuid.slice(0, 8)}`,
              provider: 'placid',
              placidTemplateId: uuid,
              canvas: canvas as object,
              previewUrl: hqUrl,
              backgroundUrl: hqUrl,
            },
          });
          imported.push({
            id: item.id,
            name: item.name,
            placidTemplateId: item.placidTemplateId,
          });
        } catch (err) {
          const { replyProviderCredit, reportIfCreditError } = await import(
            '../services/provider-credit-alert.service'
          );
          if (await replyProviderCredit(reply, tenantId, err, 'generation')) return;
          await reportIfCreditError(tenantId, err, 'generation').catch(() => undefined);
          errors.push({
            uuid,
            error: err instanceof Error ? err.message : 'Import failed',
          });
        }
      }

      return {
        success: true,
        data: {
          imported,
          errors,
          importedCount: imported.length,
          failedCount: errors.length,
        },
      };
    },
  );

  /** List templates from the linked Placid project (design happens in Placid). */
  app.get('/placid/templates', { preHandler: requireAuth }, async (request, reply) => {
    const providers = await resolveProviders(request.session.tenantId!);
    if (!providers.placidApiKey) {
      return reply.status(400).send({
        success: false,
        error:
          'Design-library API key not set. Add it in Settings → Integrations.',
      });
    }
    try {
      const templates = await listPlacidTemplates(providers.placidApiKey);
      return { success: true, data: templates };
    } catch (err) {
      const { replyProviderCredit } = await import('../services/provider-credit-alert.service');
      if (await replyProviderCredit(reply, request.session.tenantId, err, 'generation')) return;
      const message = err instanceof Error ? err.message : 'Could not list design templates';
      const status = /401|403|token|Unauthenticated/i.test(message) ? 401 : 502;
      return reply.status(status).send({ success: false, error: message });
    }
  });

  /** Re-sync dynamic layers from Placid after editing the design in Placid.app */
  app.post(
    '/templates/:id/sync-placid',
    { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) },
    async (request, reply) => {
      const providers = await resolveProviders(request.session.tenantId!);
      if (!providers.placidApiKey) {
        return reply.status(400).send({
          success: false,
          error: 'Design-library API key not set. Add it in Settings → Integrations.',
        });
      }
      const { id } = request.params as { id: string };
      const body = z
        .object({ placidTemplateId: z.string().min(1).optional() })
        .parse(request.body ?? {});

      const existing = await prisma.brandTemplate.findFirst({
        where: { id, tenantId: request.session.tenantId!, deletedAt: null },
      });
      if (!existing) return reply.status(404).send({ success: false, error: 'Not found' });

      const uuid = (body.placidTemplateId || existing.placidTemplateId || '').trim();
      if (!uuid) {
        return reply.status(400).send({
          success: false,
          error: 'Missing template UUID. Design the template in the source app first, then paste its UUID.',
        });
      }

      const brand = await prisma.brandSettings.findUnique({
        where: { tenantId: request.session.tenantId! },
      });
      try {
        const placid = await getPlacidTemplate(providers.placidApiKey, uuid);
        const canvas = placidLayersToCanvas({
          placid,
          companyName: brand?.companyName,
        });
        const hqUrl =
          (await cachePlacidHqPreview({
            apiKey: providers.placidApiKey,
            tenantId: request.session.tenantId!,
            placid,
          })) ||
          existing.previewUrl ||
          null;

        const updated = await prisma.brandTemplate.update({
          where: { id },
          data: {
            provider: 'placid',
            placidTemplateId: uuid,
            name: existing.name || placid.title,
            canvas: canvas as object,
            previewUrl: hqUrl,
            backgroundUrl: hqUrl || existing.backgroundUrl,
          },
        });

        return {
          success: true,
          data: updated,
          meta: {
            placidTitle: placid.title,
            dynamicLayers: placid.layers,
            note: 'Only dynamic layers are listed. Static layers stay locked in the source design.',
          },
        };
      } catch (err) {
        const { replyProviderCredit } = await import('../services/provider-credit-alert.service');
        if (await replyProviderCredit(reply, request.session.tenantId, err, 'generation')) return;
        throw err;
      }
    },
  );

  app.post(
    '/templates/upload-layer-image',
    { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) },
    async (request, reply) => {
      const data = await request.file();
      if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });
      if (!data.mimetype.startsWith('image/')) {
        return reply.status(400).send({ success: false, error: 'Please upload an image' });
      }
      const buffer = await data.toBuffer();
      if (buffer.length > 20 * 1024 * 1024) {
        return reply.status(400).send({ success: false, error: 'Image too large (max 20MB)' });
      }
      const stored = await storeOriginalImage({
        tenantId: request.session.tenantId!,
        subdir: 'brand-assets',
        buffer,
        originalFilename: data.filename || 'layer.png',
        mimetype: data.mimetype,
        logLabel: 'layer-image',
      });
      return {
        success: true,
        data: { publicUrl: stored.publicUrl },
      };
    },
  );

  app.post(
    '/templates/upload-background',
    { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) },
    async (request, reply) => {
      const data = await request.file();
      if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });
      if (!data.mimetype.startsWith('image/')) {
        return reply.status(400).send({ success: false, error: 'Please upload an image (PNG/JPG/WebP)' });
      }

      const tenantId = request.session.tenantId!;
      const buffer = await data.toBuffer();
      if (buffer.length > 20 * 1024 * 1024) {
        return reply.status(400).send({ success: false, error: 'Image too large (max 20MB)' });
      }

      const stored = await storeOriginalImage({
        tenantId,
        subdir: 'brand-bg',
        buffer,
        originalFilename: data.filename || 'plate.png',
        mimetype: data.mimetype,
        logLabel: 'plate',
      });
      const publicUrl = stored.publicUrl;

      const templateId = fieldValue(data.fields as Record<string, unknown>, 'templateId');
      if (!templateId) {
        return reply.status(400).send({ success: false, error: 'templateId is required' });
      }

      const existing = await prisma.brandTemplate.findFirst({
        where: { id: templateId, tenantId, deletedAt: null },
      });
      if (!existing) {
        return reply.status(404).send({ success: false, error: 'Template not found' });
      }

      const brand = await prisma.brandSettings.findUnique({ where: { tenantId } });
      const logoUrl = preferOriginalLogoUrl(brand?.logoUrl) || brand?.logoUrl;
      const formWidth = Number(fieldValue(data.fields as Record<string, unknown>, 'canvasWidth'));
      const formHeight = Number(fieldValue(data.fields as Record<string, unknown>, 'canvasHeight'));
      const { width, height, nativeWidth, nativeHeight } = await imageDimensions(
        buffer,
        formWidth,
        formHeight,
      );
      const keepLayout = fieldValue(data.fields as Record<string, unknown>, 'keepLayout') === '1';

      if (
        (nativeWidth && nativeWidth !== width) ||
        (nativeHeight && nativeHeight !== height)
      ) {
        console.log(
          `[upload:plate] canvas layout clamped ${nativeWidth}x${nativeHeight} → ${width}x${height} (file unchanged)`,
        );
      }

      const existingCanvas = (
        existing.canvas && typeof existing.canvas === 'object' ? existing.canvas : null
      ) as BrandCanvas | null;
      const postType = existingCanvas?.postType || 'festival';

      let canvas: BrandCanvas;
      if (keepLayout && existingCanvas?.layers?.length) {
        // Scale existing zones onto the new plate size (plate URL stays full-res)
        canvas = structuredClone(existingCanvas) as BrandCanvas;
        const oldWidth = canvas.width || 1080;
        const oldHeight = canvas.height || 1080;
        const scaleX = width / oldWidth;
        const scaleY = height / oldHeight;
        canvas.layers = (canvas.layers || []).map((layer) => ({
          ...layer,
          x: Math.round(layer.x * scaleX),
          y: Math.round(layer.y * scaleY),
          w: Math.round(layer.w * scaleX),
          h: Math.round(layer.h * scaleY),
          ...(layer.fontSize
            ? { fontSize: Math.max(8, Math.round(layer.fontSize * Math.min(scaleX, scaleY))) }
            : {}),
        }));
        canvas.width = width;
        canvas.height = height;
        canvas.background = { type: 'image', value: publicUrl };
        canvas.backgroundFit = canvas.backgroundFit || 'cover';
        canvas.designSource = 'inhouse';
      } else {
        // Fresh Placid-style editable layout: logo, header, headline, hero, body, footer
        canvas = scaffoldEditablePlateLayout({
          companyName: brand?.companyName || existing.name,
          logoUrl,
          backgroundUrl: publicUrl,
          width,
          height,
          postType,
        });
      }

      const updated = await prisma.brandTemplate.update({
        where: { id: templateId },
        data: {
          backgroundUrl: publicUrl,
          canvas: canvas as object,
          previewUrl: publicUrl,
          provider: existing.provider === 'placid' ? 'inhouse' : existing.provider,
        },
      });

      return {
        success: true,
        data: updated,
        meta: {
          scaffolded: !keepLayout,
          bytes: stored.bytes,
          nativeWidth,
          nativeHeight,
          canvasWidth: width,
          canvasHeight: height,
          note: keepLayout
            ? 'Plate replaced at full resolution; existing zones scaled.'
            : 'Editable layout created (logo, header, headline, hero, body, footer). Mark Fixed vs Dynamic, then Save.',
        },
      };
    },
  );

  app.patch('/templates/:id', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      name: z.string().optional(),
      provider: z.enum(['inhouse', 'placid']).optional(),
      placidTemplateId: z.string().nullable().optional(),
      canvas: z.any().optional(),
      backgroundUrl: z.string().nullable().optional(),
      isActive: z.boolean().optional(),
      postType: z.string().optional(),
      scaffoldLayout: z.boolean().optional(),
    }).parse(request.body);

    const existing = await prisma.brandTemplate.findFirst({
      where: { id, tenantId: request.session.tenantId!, deletedAt: null },
    });
    if (!existing) return reply.status(404).send({ success: false, error: 'Not found' });

    const brand = await prisma.brandSettings.findUnique({
      where: { tenantId: request.session.tenantId! },
    });
    const logoUrl = preferOriginalLogoUrl(brand?.logoUrl) || brand?.logoUrl;

    let canvas = body.canvas as BrandCanvas | undefined;
    if (body.postType) {
      const base = (canvas || existing.canvas || {}) as BrandCanvas;
      canvas = applyPostTypeToCanvas(
        base,
        body.postType,
        brand?.companyName || existing.name,
        logoUrl,
      );
    }
    if (body.scaffoldLayout) {
      const base = (canvas || existing.canvas || {}) as BrandCanvas;
      canvas = scaffoldEditablePlateLayout({
        companyName: brand?.companyName || existing.name,
        logoUrl,
        backgroundUrl:
          body.backgroundUrl ||
          existing.backgroundUrl ||
          (base.background?.type === 'image' ? base.background.value : undefined) ||
          undefined,
        width: base.width,
        height: base.height,
        postType: body.postType || base.postType || 'festival',
      });
    }

    const updated = await prisma.brandTemplate.update({
      where: { id },
      data: {
        ...(body.name != null ? { name: body.name } : {}),
        ...(body.provider != null ? { provider: body.provider } : {}),
        ...(body.placidTemplateId !== undefined ? { placidTemplateId: body.placidTemplateId } : {}),
        ...(canvas != null ? { canvas } : {}),
        ...(body.backgroundUrl !== undefined ? { backgroundUrl: body.backgroundUrl } : {}),
        ...(body.isActive != null ? { isActive: body.isActive } : {}),
      },
    });
    return { success: true, data: updated };
  });

  app.delete('/templates/:id', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const { id } = request.params as { id: string };
    await prisma.brandTemplate.updateMany({
      where: { id, tenantId: request.session.tenantId! },
      data: SoftDelete,
    });
    return { success: true };
  });

  /** Playbook formats for AI Assistant (filtered by B2B/B2C) */
  app.get('/playbook', { preHandler: requireAuth }, async (request) => {
    const brand = await prisma.brandSettings.findUnique({
      where: { tenantId: request.session.tenantId! },
      select: { brandType: true },
    });
    const brandType = brand?.brandType || 'b2b';
    return {
      success: true,
      data: {
        brandType,
        plays: suggestionsForBrand(brandType),
      },
    };
  });

  /**
   * Designed poster templates (3 per playbook format), merged with tenant
   * uploaded masters. When uploads exist for a play, builtins for that play
   * are hidden. Colours/fonts always come from the Brand Kit.
   */
  app.get('/poster-templates', { preHandler: requireAuth }, async (request) => {
    const { playId } = z
      .object({ playId: z.string().max(64).optional() })
      .parse(request.query ?? {});

    const settings = await prisma.brandSettings.findUnique({
      where: { tenantId: request.session.tenantId! },
    });
    const kit = brandKitFromSettings(settings);
    const tenantId = request.session.tenantId!;

    return {
      success: true,
      data: {
        templates: playId
          ? await resolvedTemplatesForPlay(tenantId, playId)
          : await resolvedAllTemplates(tenantId),
        byPlay: await resolvedTemplatesByPlay(tenantId),
        brandKit: kit,
      },
    };
  });

  /** Resolve a typed category/play id before the installer unlocks upload. */
  app.get('/poster-templates/resolve-play', { preHandler: requireAuth }, async (request, reply) => {
    const { category } = z
      .object({ category: z.string().max(64) })
      .parse(request.query ?? {});
    const resolved = resolvePlayId(category);
    if ('error' in resolved) {
      return reply.status(400).send({ success: false, error: resolved.error });
    }
    const play = CONTENT_PLAYBOOK.find((p) => p.id === resolved.playId)!;
    const existing = await listUploadedTemplates(request.session.tenantId!, resolved.playId);
    return {
      success: true,
      data: {
        playId: play.id,
        label: play.label,
        shortLabel: play.shortLabel,
        existingCount: existing.length,
        existing,
      },
    };
  });

  /** List installed uploaded masters for a play (installer panel). */
  app.get('/poster-templates/uploads', { preHandler: requireAuth }, async (request, reply) => {
    const { playId: raw } = z
      .object({ playId: z.string().max(64) })
      .parse(request.query ?? {});
    const resolved = resolvePlayId(raw);
    if ('error' in resolved) {
      return reply.status(400).send({ success: false, error: resolved.error });
    }
    const existing = await listUploadedTemplates(request.session.tenantId!, resolved.playId);
    return { success: true, data: { playId: resolved.playId, templates: existing } };
  });

  /**
   * Install / replace uploaded finished posters for a category.
   * Multipart: category (or playId), mode=replace|append, files[], optional labels[].
   */
  app.post(
    '/poster-templates/install',
    { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) },
    async (request, reply) => {
      const parts = request.parts();
      let category = '';
      let mode: 'replace' | 'append' = 'replace';
      const files: Array<{
        buffer: Buffer;
        filename: string;
        mimetype: string;
        label?: string;
      }> = [];
      const labels: string[] = [];

      for await (const part of parts) {
        if (part.type === 'file') {
          const buffer = await part.toBuffer();
          if (buffer.length > 25 * 1024 * 1024) {
            return reply.status(400).send({ success: false, error: 'Image too large (max 25MB)' });
          }
          files.push({
            buffer,
            filename: part.filename || `template-${files.length + 1}.png`,
            mimetype: part.mimetype || 'application/octet-stream',
          });
        } else {
          const value = String(part.value || '').trim();
          if (part.fieldname === 'category' || part.fieldname === 'playId') category = value;
          else if (part.fieldname === 'mode' && (value === 'append' || value === 'replace')) {
            mode = value;
          } else if (part.fieldname === 'labels' || part.fieldname.startsWith('label')) {
            labels.push(value);
          }
        }
      }

      const resolved = resolvePlayId(category);
      if ('error' in resolved) {
        return reply.status(400).send({ success: false, error: resolved.error });
      }
      if (!files.length) {
        return reply.status(400).send({
          success: false,
          error: 'Upload at least one JPG, PNG, or WebP image.',
        });
      }

      for (let i = 0; i < files.length; i++) {
        if (labels[i]) files[i]!.label = labels[i];
      }

      try {
        const result = await installUploadedTemplates({
          tenantId: request.session.tenantId!,
          playId: resolved.playId,
          mode,
          files,
        });
        return {
          success: true,
          data: {
            playId: resolved.playId,
            installed: result.installed,
            mode,
            templates: result.templates,
            message: `Installed ${result.installed} templates for ${resolved.playId}. Open AI Assistant → ${resolved.playId} to see them.`,
          },
        };
      } catch (e) {
        return reply.status(400).send({
          success: false,
          error: e instanceof Error ? e.message : 'Install failed',
        });
      }
    },
  );

  app.delete(
    '/poster-templates/uploads/:id',
    { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) },
    async (request, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const ok = await softDeleteUploadedTemplate(request.session.tenantId!, id);
      if (!ok) return reply.status(404).send({ success: false, error: 'Template not found' });
      return { success: true, data: { id } };
    },
  );

  app.get('/chat/conversations', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const conversations = await prisma.assistantConversation.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    return { success: true, data: conversations };
  });

  app.post('/chat/conversations', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request) => {
    const tenantId = request.session.tenantId!;
    const body = z.object({ title: z.string().max(100).optional() }).parse(request.body ?? {});
    const conversation = await prisma.assistantConversation.create({
      data: { tenantId, title: body.title?.trim() || 'New conversation' },
    });
    return { success: true, data: conversation };
  });

  app.get('/chat/conversations/:id', { preHandler: requireAuth }, async (request, reply) => {
    const tenantId = request.session.tenantId!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const conversation = await prisma.assistantConversation.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) return reply.status(404).send({ success: false, error: 'Conversation not found' });
    const contentIds = conversation.messages
      .map((message) => message.contentId)
      .filter((contentId): contentId is string => Boolean(contentId));
    const statuses = contentIds.length
      ? await prisma.generatedContent.findMany({
          where: { tenantId, id: { in: contentIds } },
          select: { id: true, status: true },
        })
      : [];
    const statusById = new Map(statuses.map((content) => [content.id, content.status]));
    return {
      success: true,
      data: {
        ...conversation,
        messages: conversation.messages.map((message) => ({
          ...message,
          metadata: {
            ...(message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
              ? message.metadata
              : {}),
            approvalStatus: message.contentId ? statusById.get(message.contentId) || null : null,
          },
        })),
      },
    };
  });

  app.delete('/chat/conversations/:id', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const tenantId = request.session.tenantId!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const conversation = await prisma.assistantConversation.findFirst({
      where: { id, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!conversation) return reply.status(404).send({ success: false, error: 'Conversation not found' });
    await prisma.assistantConversation.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'archived' },
    });
    return { success: true, data: { id } };
  });

  app.get('/chat/memory', { preHandler: requireAuth }, async (request) => {
    const tenantId = request.session.tenantId!;
    const [settings, memories] = await Promise.all([
      prisma.brandSettings.findUnique({
        where: { tenantId },
        select: { assistantMemoryEnabled: true },
      }),
      prisma.assistantMemory.findMany({
        where: { tenantId, isActive: true },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);
    return {
      success: true,
      data: { enabled: settings?.assistantMemoryEnabled === true, memories },
    };
  });

  app.put('/chat/memory', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request) => {
    const tenantId = request.session.tenantId!;
    const body = z.object({ enabled: z.boolean() }).parse(request.body);
    const settings = await prisma.brandSettings.upsert({
      where: { tenantId },
      create: { tenantId, assistantMemoryEnabled: body.enabled },
      update: { assistantMemoryEnabled: body.enabled },
      select: { assistantMemoryEnabled: true },
    });
    return { success: true, data: { enabled: settings.assistantMemoryEnabled } };
  });

  app.delete('/chat/memory/:id', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request, reply) => {
    const tenantId = request.session.tenantId!;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const memory = await prisma.assistantMemory.findFirst({ where: { id, tenantId } });
    if (!memory) return reply.status(404).send({ success: false, error: 'Memory not found' });
    await prisma.assistantMemory.update({ where: { id }, data: { isActive: false } });
    return { success: true, data: { id } };
  });

  app.delete('/chat/memory', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request) => {
    const tenantId = request.session.tenantId!;
    const result = await prisma.assistantMemory.updateMany({
      where: { tenantId, isActive: true },
      data: { isActive: false },
    });
    return { success: true, data: { cleared: result.count } };
  });

  app.post('/chat/:contentId/send-to-approvals', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request) => {
    const { contentId } = z.object({ contentId: z.string().uuid() }).parse(request.params);
    const content = await submitAssistantDraftForApproval(request.session.tenantId!, contentId);
    return { success: true, data: content };
  });

  /** Persistent multi-turn AI assistant: text, images, exact edits, and drafts. */
  app.post('/chat', { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) }, async (request) => {
    const body = z.object({
      conversationId: z.string().uuid().optional().nullable(),
      activeContentId: z.string().uuid().optional().nullable(),
      brandTemplateId: z.string().uuid().optional().nullable(),
      message: z.string().min(1).max(12000),
      visualMode: z.enum(['existing_template', 'new_poster']).optional().nullable(),
      includeLogo: z.boolean().optional(),
      referenceImageUrl: z.string().max(2000).optional().nullable(),
      attachmentRole: z.enum(['edit', 'style', 'asset']).optional().nullable(),
      outputMode: z.enum(['auto', 'text', 'image']).optional().default('auto'),
      preferredPlay: z.string().max(64).optional().nullable(),
      posterTemplateId: z.string().max(64).optional().nullable(),
      imageFormat: z
        .enum(['instagram_square', 'instagram_portrait', 'linkedin', 'story'])
        .optional(),
      history: z
        .array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string(),
          }),
        )
        .max(40)
        .optional(),
    }).parse(request.body);

    const result = await runAssistantWorkspaceTurn({
      tenantId: request.session.tenantId!,
      conversationId: body.conversationId,
      activeContentId: body.activeContentId,
      brandTemplateId: body.brandTemplateId,
      message: body.message,
      visualMode: body.visualMode,
      includeLogo: body.includeLogo,
      attachmentUrl: body.referenceImageUrl,
      attachmentRole: body.attachmentRole,
      outputMode: body.outputMode,
      imageFormat: body.imageFormat,
      preferredPlay: body.preferredPlay,
      posterTemplateId: body.posterTemplateId,
    });

    return { success: true, data: result };
  });

  /** Upload a brand reference image for AI Assistant (style / layout guide) */
  app.post(
    '/chat/upload-reference',
    { preHandler: requireRole(UserRole.ADMIN, UserRole.REVIEWER) },
    async (request, reply) => {
      const data = await request.file();
      if (!data) return reply.status(400).send({ success: false, error: 'No file uploaded' });
      if (!data.mimetype.startsWith('image/')) {
        return reply.status(400).send({ success: false, error: 'Please upload an image' });
      }
      const buffer = await data.toBuffer();
      if (buffer.length > 20 * 1024 * 1024) {
        return reply.status(400).send({ success: false, error: 'Image too large (max 20MB)' });
      }
      const stored = await storeOriginalImage({
        tenantId: request.session.tenantId!,
        subdir: 'chat-references',
        buffer,
        originalFilename: data.filename || 'reference.png',
        mimetype: data.mimetype,
        logLabel: 'chat-reference',
      });
      return {
        success: true,
        data: { publicUrl: stored.publicUrl },
      };
    },
  );
}
