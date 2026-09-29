import { prisma } from '../lib/prisma';
import {
  defaultBrandCanvas,
  renderBrandCanvasSvg,
  saveRenderedSvg,
  isLayerDynamic,
  type BrandCanvas,
  type BrandLayer,
} from '../providers/templates/brand-renderer';
import type { Prisma } from '@prisma/client';

export type TemplateSlotMap = Record<string, string>;

export function slotsFromJson(value: unknown): TemplateSlotMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: TemplateSlotMap = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    // Nested meta (carousel, insightReport, …) stays in raw JSON — never stringify to "[object Object]"
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

export async function loadBrandCanvas(
  tenantId: string,
  brandTemplateId: string | null | undefined,
): Promise<{ canvas: BrandCanvas; templateId: string; templateName: string } | null> {
  if (!brandTemplateId) return null;
  const template = await prisma.brandTemplate.findFirst({
    where: { id: brandTemplateId, tenantId, deletedAt: null },
  });
  if (!template) return null;

  const brand = await prisma.brandSettings.findUnique({ where: { tenantId } });
  const canvas = (
    template.canvas && typeof template.canvas === 'object'
      ? structuredClone(template.canvas)
      : defaultBrandCanvas({
          companyName: brand?.companyName || undefined,
          backgroundUrl: template.backgroundUrl || undefined,
          logoUrl: brand?.logoUrl,
        })
  ) as BrandCanvas;

  if (template.backgroundUrl) {
    canvas.background = { type: 'image', value: template.backgroundUrl };
  }

  return { canvas, templateId: template.id, templateName: template.name };
}

export function describeTemplateLayers(canvas: BrandCanvas) {
  return (canvas.layers || [])
    .filter((l) => l.id !== '_placid_note')
    .map((layer) => ({
      id: layer.id,
      type: layer.type,
      slot: layer.slot || layer.id,
      fillMode: layer.fillMode || (layer.editable ? 'dynamic' : 'static'),
      editable: isLayerDynamic(layer),
      fillType: layer.fillType || null,
      fillHint: layer.fillHint || null,
      label:
        layer.slot ||
        layer.id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    }));
}

/** Apply text/image slot values onto dynamic layers, then render (Placid REST or SVG). */
export async function renderContentFromTemplate(opts: {
  tenantId: string;
  brandTemplateId: string;
  slots: TemplateSlotMap;
  prefix?: string;
  /**
   * Approvals save: keep editor text + existing picture URLs exactly.
   * No LLM rewrite, no new AI photography.
   */
  lockProvidedSlots?: boolean;
}): Promise<{ imageUrl: string; slots: TemplateSlotMap }> {
  const template = await prisma.brandTemplate.findFirst({
    where: { id: opts.brandTemplateId, tenantId: opts.tenantId, deletedAt: null },
  });
  if (!template) throw new Error('Brand template not found');

  if (template.provider === 'placid' && template.placidTemplateId) {
    const { renderFilledBrandTemplate } = await import('./fill-brand-template.service');
    return renderFilledBrandTemplate({
      tenantId: opts.tenantId,
      contentId: opts.brandTemplateId, // content id unused when art already in slots
      brandTemplateId: opts.brandTemplateId,
      slots: opts.slots,
      prefix: opts.prefix,
      lockProvidedSlots: opts.lockProvidedSlots === true,
      forbidAiPictureFallback: opts.lockProvidedSlots === true,
      context: {
        headline: opts.slots.headline || opts.slots.title || opts.slots.TITLE,
        body: opts.slots.body || opts.slots.subtitle || opts.slots.SUBTITLE || opts.slots.subheadline,
        callToAction: opts.slots.cta || opts.slots.offer,
      },
    });
  }

  const loaded = await loadBrandCanvas(opts.tenantId, opts.brandTemplateId);
  if (!loaded) throw new Error('Brand template not found');

  const canvas = loaded.canvas;
  // Push uploaded image URLs into layer.src for static preview of image slots
  canvas.layers = (canvas.layers || []).map((layer: BrandLayer) => {
    if (layer.type !== 'image') return layer;
    const key = layer.slot || layer.id;
    const src = opts.slots[key];
    if (src && /^(\/|https?:|data:)/.test(src)) {
      return { ...layer, src };
    }
    return layer;
  });

  const svg = await renderBrandCanvasSvg(canvas, opts.slots);
  const saved = await saveRenderedSvg(opts.tenantId, svg, opts.prefix || 'approval');
  return { imageUrl: saved.publicUrl, slots: opts.slots };
}

/**
 * Generate real AI photography into every dynamic image slot, then composite on the brand template.
 * Placid templates are rendered via Placid REST (exact layer geometry); in-house uses SVG.
 */
export async function renderBrandTemplateWithAiArt(opts: {
  tenantId: string;
  contentId: string;
  brandTemplateId: string;
  slots: TemplateSlotMap;
  imagePrompt: string;
  prefix?: string;
  context?: {
    topic?: string;
    headline?: string;
    body?: string;
    callToAction?: string;
    extra?: string;
  };
  slotFillStyles?: Record<string, string>;
  referenceImageUrl?: string | null;
  forbidAiPictureFallback?: boolean;
}): Promise<{ imageUrl: string; slots: TemplateSlotMap }> {
  const { renderFilledBrandTemplate } = await import('./fill-brand-template.service');
  return renderFilledBrandTemplate(opts);
}

export async function persistTemplateSlots(
  contentId: string,
  slots: TemplateSlotMap,
  imageUrl?: string | null,
) {
  await prisma.generatedContent.update({
    where: { id: contentId },
    data: {
      templateSlots: slots as Prisma.InputJsonValue,
      ...(imageUrl ? { imageUrl } : {}),
    },
  });
}

