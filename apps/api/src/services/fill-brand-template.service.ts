import { prisma } from '../lib/prisma';
import { resolveProviders } from './providers.service';
import {
  BRAND_FILL_TYPES,
  isLayerDynamic,
  layerFillType,
  renderWithPlacid,
  resolveSlotLines,
  type BrandCanvas,
  type BrandFillType,
  type BrandLayer,
} from '../providers/templates/brand-renderer';
import { type TemplateSlotMap } from './content-template.service';

function guessFillTypeFromName(name: string, kind: 'text' | 'image'): BrandFillType {
  const n = name.toLowerCase().replace(/[\s-]+/g, '_');
  if (kind === 'image') return 'image_url';
  if (/(^|_)(title|headline|heading)(_|$)/.test(n)) return 'headline';
  if (/(subheadline|subtitle|subtext|tagline)/.test(n)) return 'subheadline';
  if (/(cta|call_to_action|button)/.test(n)) return 'cta';
  if (/(offer|promo|discount|deal)/.test(n)) return 'offer';
  if (/(hashtag)/.test(n)) return 'hashtag';
  if (/(date|occasion)/.test(n)) return 'date';
  if (/(body|caption|desc|description|copy)/.test(n)) return 'body';
  return 'custom_text';
}

export function enrichPlacidLayerDefaults(layer: BrandLayer): BrandLayer {
  if (layer.id === '_placid_note') return layer;
  const kind = layer.type === 'image' || layer.placidType === 'picture' ? 'image' : 'text';
  const fillType = layer.fillType || guessFillTypeFromName(layer.slot || layer.id, kind);
  const catalog = BRAND_FILL_TYPES.find((t) => t.id === fillType);
  return {
    ...layer,
    fillMode: layer.fillMode || 'dynamic',
    editable: true,
    fillType,
    fillHint:
      layer.fillHint ||
      catalog?.hint ||
      (kind === 'image'
        ? `Picture layer "${layer.slot || layer.id}" — supply image URL only; Placid sizes/places it`
        : `Text only for "${layer.slot || layer.id}"`),
  };
}

function dynamicLayers(canvas: BrandCanvas): BrandLayer[] {
  return (canvas.layers || []).filter((l) => l.id !== '_placid_note' && isLayerDynamic(l));
}

function textLayers(canvas: BrandCanvas): BrandLayer[] {
  return dynamicLayers(canvas).filter(
    (l) => l.type === 'text' && l.placidType !== 'picture' && l.placidType !== 'browserframe',
  );
}

/** True for Placid picture / browserframe / in-house image layers (ignores fillMode). */
export function isPictureBrandLayer(layer: BrandLayer): boolean {
  if (layer.id === '_placid_note' || layer.hidden) return false;
  return (
    layer.type === 'image' ||
    layer.placidType === 'picture' ||
    layer.placidType === 'browserframe'
  );
}

function isLikelyFixedLogoLayer(layer: BrandLayer): boolean {
  const n = `${layer.slot || ''} ${layer.id || ''}`.toLowerCase().replace(/[\s-]+/g, '_');
  if (/(^|_)(logo|watermark|icon|badge|brand_mark)(_|$)/.test(n)) return true;
  // Static image that already has art and isn't a named photo/hero slot → leave alone
  if (
    layer.fillMode === 'static' &&
    Boolean(layer.src?.trim()) &&
    !/(photo|image|picture|hero|bg|background|media)/.test(n)
  ) {
    return true;
  }
  return false;
}

/**
 * Picture layers that accept photo fills.
 * Exact-scraped mode also includes mis-tagged static picture zones (except logos).
 */
export function pictureLayersForFill(
  canvas: BrandCanvas,
  opts?: { exactMode?: boolean },
): BrandLayer[] {
  const layers = (canvas.layers || []).filter(isPictureBrandLayer);
  if (opts?.exactMode) {
    return layers.filter((l) => !isLikelyFixedLogoLayer(l));
  }
  return layers.filter((l) => isLayerDynamic(l));
}

function imageLayers(canvas: BrandCanvas, exactMode = false): BrandLayer[] {
  return pictureLayersForFill(canvas, { exactMode });
}

function isUsableImageSlotValue(val: string | null | undefined): boolean {
  const v = (val || '').trim();
  return Boolean(v && /^(\/uploads\/|https?:\/\/|data:)/i.test(v));
}

/** Propagate one exact photo URL into every empty picture slot (+ common aliases). */
export function applyExactImageToSlots(
  canvas: BrandCanvas,
  slots: TemplateSlotMap,
  exactUrl: string,
): { slots: TemplateSlotMap; filled: number } {
  const next = { ...slots };
  const url = (exactUrl || '').trim();
  if (!url) return { slots: next, filled: 0 };
  let filled = 0;
  for (const layer of pictureLayersForFill(canvas, { exactMode: true })) {
    const key = layer.slot || layer.id;
    next[key] = url;
    filled += 1;
  }
  // Aliases so older plates / mismatched names still receive the photo
  for (const alias of ['image', 'photo', 'picture', 'hero', 'background', 'bg']) {
    if (!next[alias]?.trim()) next[alias] = url;
  }
  return { slots: next, filled: Math.max(filled, 1) };
}

function styleInstruction(
  style: string | undefined,
  layer: BrandLayer,
): string {
  const lines = Math.max(1, layer.lineCount || (style === 'bullets' ? 4 : style === 'paragraph' ? 3 : 1));
  switch (style) {
    case 'keep':
      return 'DO NOT CHANGE — omit this key entirely so the designed text stays.';
    case 'headline':
      return 'Exactly 1 strong professional title (6–12 words). Specific to the source. Not a stub.';
    case 'bullets':
      return `Exactly ${lines} separate lines. Each line is ONE complete benefit or fact (8–16 words), grounded in the source. No one-word labels. Separate lines with \\n.`;
    case 'paragraph':
      return `Exactly ${Math.min(lines, 4)} complete sentences as separate lines (\\n). Professional product copy, not a slogan fragment.`;
    default:
      if ((layer.lineCount || 0) > 1 || layer.fillType === 'body' || layer.fillType === 'json') {
        return `Write EXACTLY ${Math.max(layer.lineCount || 3, 2)} complete professional lines separated by \\n. Each line is a full phrase (8–16 words) from the source document — never a 1–3 word stub.`;
      }
      if (layer.fillType === 'headline') {
        return 'Exactly 1 specific professional headline (6–12 words) from the source. Not a generic edition label.';
      }
      if (layer.fillType === 'subheadline') {
        return '1–2 complete supporting lines (\\n if two). Specific to the product in the source — never “Studio Launch Edition” filler.';
      }
      if (layer.fillType === 'cta') {
        return 'Exactly 1 clear call to action (2–6 words), e.g. Book a free demo.';
      }
      return 'Complete professional phrase grounded in the source. No one-word stubs.';
  }
}

function fillPromptForLayer(layer: BrandLayer, style?: string): string {
  const key = layer.slot || layer.id;
  const ft = layerFillType(layer);
  const catalog = BRAND_FILL_TYPES.find((t) => t.id === ft);
  return `- "${key}" (${catalog?.label || ft}): ${styleInstruction(style, layer)} Hint: ${layer.fillHint || catalog?.hint || 'on-brand text'}. TEXT ONLY — never an image URL.`;
}

/**
 * Ask the LLM for exact dynamic text-layer values using each layer's fillType role.
 */
export async function generateTextSlotsForTemplate(opts: {
  tenantId: string;
  canvas: BrandCanvas;
  slotFillStyles?: Record<string, string>;
  context: {
    topic?: string;
    headline?: string;
    body?: string;
    callToAction?: string;
    extra?: string;
  };
}): Promise<TemplateSlotMap> {
  const styles = opts.slotFillStyles || {};
  const layers = textLayers(opts.canvas).filter((l) => styles[l.slot || l.id] !== 'keep');
  if (!layers.length) return {};

  const llm = await (await import('./llm.service')).LLMService.forTenant(opts.tenantId);
  const keys = layers.map((l) => l.slot || l.id);
  const roleBlock = layers.map((l) => fillPromptForLayer(l, styles[l.slot || l.id])).join('\n');

  const slotJson = await llm.generateRawJson({
    systemPrompt: `You fill ONLY dynamic TEXT layers on a finished brand plate.
Fixed / static layers (logos, footer contacts, designed chrome) must NEVER appear in your JSON.
Return JSON with EXACTLY these keys: ${JSON.stringify(keys)}.
Each value is plain text. Use \\n between lines when the role asks for multiple lines.
Every line must be a complete professional phrase from the source context — never a 1–3 word stub, never “Studio Launch Edition” unless the source says that.
Never invent image URLs.`,
    userPrompt: `Context
Topic: ${opts.context.topic || '—'}
Headline idea: ${opts.context.headline || '—'}
Body idea: ${(opts.context.body || '').slice(0, 1200)}
CTA idea: ${opts.context.callToAction || '—'}
${opts.context.extra ? `Source & rules:\n${opts.context.extra}` : ''}

Dynamic layers to fill (fixed layers are omitted on purpose):
${roleBlock}`,
  });

  const out: TemplateSlotMap = {};
  for (const layer of layers) {
    const key = layer.slot || layer.id;
    const raw = slotJson[key];
    let text = typeof raw === 'string' ? raw : raw != null ? String(raw) : '';
    const style = styles[key];
    if (!text.trim()) {
      const ft = layerFillType(layer);
      if (ft === 'headline') text = opts.context.headline || '';
      else if (ft === 'cta') text = opts.context.callToAction || '';
      else if (ft === 'body' || style === 'paragraph' || style === 'bullets') {
        text = (opts.context.body || '').slice(0, 280);
      }
    }
    const wanted =
      style === 'bullets' || style === 'paragraph'
        ? Math.max(layer.lineCount || (style === 'bullets' ? 4 : 3), 2)
        : layer.lineCount;
    if (wanted && wanted > 1) {
      text = resolveSlotLines(text, wanted).filter(Boolean).join('\n');
    }
    if (text.trim()) out[key] = text.trim();
  }
  return out;
}

async function absolutePublicUrl(tenantId: string, url: string): Promise<string> {
  if (/^https?:\/\//i.test(url)) return url;
  const { config } = await import('../config');
  const base = (config.API_URL || config.WEB_URL || '').replace(/\/$/, '');
  if (!base) {
    throw new Error(
      'API_URL (or WEB_URL) must be set so local uploads can be turned into absolute URLs for external services.',
    );
  }
  if (url.startsWith('/')) return `${base}${url}`;
  return `${base}/uploads/${tenantId}/${url}`;
}

/**
 * Placid (and similar hosts) must fetch image URLs themselves.
 * Local `/uploads` → `http://localhost:…` fails with 422 "Cant find image on URL".
 */
export function isExternallyFetchableImageUrl(url: string | null | undefined): boolean {
  const u = (url || '').trim();
  if (!/^https:\/\//i.test(u)) return false;
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(u)) return false;
  if (/^https:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u)) return false;
  return true;
}

function isPlacidStorageUrl(url: string): boolean {
  return /^https:\/\/storage\.placid\.app\//i.test(url.trim());
}

async function loadImageBytesForPlacid(
  tenantId: string,
  url: string,
): Promise<{ buffer: Buffer; filename: string; mimetype: string } | null> {
  const raw = (url || '').trim();
  if (!raw) return null;

  if (raw.startsWith('data:')) {
    const m = /^data:([^;]+);base64,(.+)$/i.exec(raw);
    if (!m) return null;
    const mimetype = m[1] || 'image/jpeg';
    const buffer = Buffer.from(m[2], 'base64');
    if (buffer.length < 64) return null;
    const ext =
      mimetype === 'image/png' ? 'png' : mimetype === 'image/webp' ? 'webp' : 'jpg';
    return { buffer, filename: `embed.${ext}`, mimetype };
  }

  const { resolveUploadPath } = await import('../providers/templates/brand-renderer');
  const disk = resolveUploadPath(raw);
  if (disk) {
    const fs = await import('fs/promises');
    const buffer = await fs.readFile(disk);
    if (buffer.length < 64) return null;
    const path = await import('path');
    const filename = path.basename(disk) || 'upload.jpg';
    const ext = path.extname(filename).toLowerCase();
    const mimetype =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.gif'
            ? 'image/gif'
            : 'image/jpeg';
    return { buffer, filename, mimetype };
  }

  const abs = /^https?:\/\//i.test(raw) ? raw : await absolutePublicUrl(tenantId, raw);
  if (!/^https?:\/\//i.test(abs) || /localhost|127\.0\.0\.1/i.test(abs)) {
    return null;
  }
  try {
    const res = await fetch(abs, {
      headers: { Accept: 'image/*,*/*' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 64) return null;
    const mimetype = contentType.startsWith('image/') ? contentType : 'image/jpeg';
    const pathPart = abs.split('?')[0];
    let filename = (pathPart.split('/').pop() || 'remote.jpg').replace(/[^a-zA-Z0-9._-]+/g, '_');
    if (!/\.(png|jpe?g|webp|gif)$/i.test(filename)) {
      filename += mimetype === 'image/png' ? '.png' : '.jpg';
    }
    return { buffer, filename, mimetype };
  } catch {
    return null;
  }
}

/**
 * Ensure every picture-slot URL is hosted where Placid can fetch it.
 * Local /uploads and fragile Instagram CDNs are uploaded to Placid media storage.
 */
async function ensurePlacidHostedImageSlots(opts: {
  tenantId: string;
  apiKey: string;
  canvas: BrandCanvas;
  slots: TemplateSlotMap;
  exactMode?: boolean;
}): Promise<TemplateSlotMap> {
  const { uploadPlacidMedia } = await import('../providers/templates/placid.client');
  const next = { ...opts.slots };
  const cache = new Map<string, string>();

  for (const layer of imageLayers(opts.canvas, Boolean(opts.exactMode))) {
    const key = layer.slot || layer.id;
    const raw = (next[key] || '').trim();
    if (!raw) continue;
    if (cache.has(raw)) {
      next[key] = cache.get(raw)!;
      continue;
    }
    if (isPlacidStorageUrl(raw)) {
      cache.set(raw, raw);
      continue;
    }

    const loaded = await loadImageBytesForPlacid(opts.tenantId, raw);
    if (!loaded) {
      // Keep public HTTPS as last resort (Placid may still fetch fal CDN etc.)
      if (isExternallyFetchableImageUrl(raw)) {
        cache.set(raw, raw);
        continue;
      }
      throw new Error(
        `Could not load picture for Placid layer "${key}" from ${raw.slice(0, 100)}. ` +
          'Exact scraped images must exist on disk (/uploads) or as a reachable HTTPS URL.',
      );
    }

    const hosted = await uploadPlacidMedia({
      apiKey: opts.apiKey,
      buffer: loaded.buffer,
      filename: loaded.filename,
      mimetype: loaded.mimetype,
    });
    cache.set(raw, hosted);
    next[key] = hosted;
  }
  return next;
}

/**
 * Render a brand template the correct way:
 * - Placid provider → Placid REST (exact layer size/position); picture=image URL, text=text only
 * - In-house → SVG composite
 */
export async function renderFilledBrandTemplate(opts: {
  tenantId: string;
  contentId: string;
  brandTemplateId: string;
  slots?: TemplateSlotMap;
  imagePrompt?: string;
  prefix?: string;
  context?: {
    topic?: string;
    headline?: string;
    body?: string;
    callToAction?: string;
    extra?: string;
  };
  /** When set, picture-layer art uses img2img from this scraped / reference URL */
  referenceImageUrl?: string | null;
  /**
   * Exact-scraped mode: never invent AI photography into picture slots.
   * Slots must already contain the scraped/upload image URLs.
   */
  forbidAiPictureFallback?: boolean;
  /**
   * Approvals save / re-render: use slot values exactly as provided.
   * Do not LLM-rewrite text or invent new AI photos into empty picture zones.
   */
  lockProvidedSlots?: boolean;
  /** Newsletter: how each dynamic text slot should be written. `keep` = do not touch. */
  slotFillStyles?: Record<string, string>;
}): Promise<{ imageUrl: string; slots: TemplateSlotMap }> {
  const template = await prisma.brandTemplate.findFirst({
    where: { id: opts.brandTemplateId, tenantId: opts.tenantId, deletedAt: null },
  });
  if (!template) throw new Error('Brand template not found');

  const canvas = (
    template.canvas && typeof template.canvas === 'object'
      ? structuredClone(template.canvas)
      : { width: 1080, height: 1080, layers: [] }
  ) as BrandCanvas;

  // Ensure Placid layers have text roles
  canvas.layers = (canvas.layers || []).map((l) =>
    template.provider === 'placid' ? enrichPlacidLayerDefaults(l) : l,
  );

  // Exact scraped: promote picture zones to dynamic + contain so the FULL photo fits
  // (in-house SVG). Placid keeps its own layer fit; we upload original bytes (no letterbox).
  if (opts.forbidAiPictureFallback) {
    canvas.layers = (canvas.layers || []).map((layer) => {
      if (!isPictureBrandLayer(layer) || isLikelyFixedLogoLayer(layer)) return layer;
      return {
        ...layer,
        fillMode: 'dynamic' as const,
        editable: true,
        imageFit: 'contain' as const,
        slot: layer.slot || layer.id,
      };
    });
  }

  let slots: TemplateSlotMap = { ...(opts.slots || {}) };

  // Exact mode safety net: if caller forgot a picture key, push the known photo into every zone
  if (opts.forbidAiPictureFallback) {
    const known =
      opts.referenceImageUrl ||
      slots.image ||
      slots.photo ||
      slots.picture ||
      slots.hero ||
      pictureLayersForFill(canvas, { exactMode: true })
        .map((l) => slots[l.slot || l.id])
        .find((v) => isUsableImageSlotValue(v)) ||
      null;
    if (known && isUsableImageSlotValue(known)) {
      const applied = applyExactImageToSlots(canvas, slots, known);
      slots = applied.slots;
    }
  }

  // Fill missing text slots from LLM using per-layer roles
  // Locked revise path: never invent copy over the editor's exact text.
  const neededText = opts.lockProvidedSlots
    ? []
    : textLayers(canvas).filter((l) => !slots[l.slot || l.id]?.trim());
  if (neededText.length) {
    try {
      const generated = await generateTextSlotsForTemplate({
        tenantId: opts.tenantId,
        canvas,
        slotFillStyles: opts.slotFillStyles,
        context: {
          topic: opts.context?.topic,
          headline: opts.context?.headline || slots.headline || slots.title,
          body: opts.context?.body,
          callToAction: opts.context?.callToAction || slots.cta,
          extra: opts.context?.extra,
        },
      });
      // Caller-provided slot text stays (exact image / approvals). Generated fills only missing keys.
      slots = { ...generated, ...slots };
      for (const [key, style] of Object.entries(opts.slotFillStyles || {})) {
        if (style === 'keep') delete slots[key];
      }
    } catch {
      // keep whatever we have
    }
  }

  // Alias common mismatches so older engines still help
  // Locked path: only fill aliases when the target key is empty — never clobber TITLE/SUBTITLE etc.
  if (!slots.title && slots.headline) slots.title = slots.headline;
  if (!slots.TITLE && slots.title) slots.TITLE = slots.title;
  if (!slots.subtitle && (slots.subheadline || slots.subtext)) {
    slots.subtitle = slots.subheadline || slots.subtext;
  }
  if (!slots.SUBTITLE && slots.subtitle) slots.SUBTITLE = slots.subtitle;
  if (!slots.headline && slots.title) slots.headline = slots.title;
  if (!slots.headline && slots.TITLE) slots.headline = slots.TITLE;

  const isPlacid = template.provider === 'placid' && Boolean(template.placidTemplateId);
  const exactMode = Boolean(opts.forbidAiPictureFallback || opts.lockProvidedSlots);

  const pics = imageLayers(canvas, exactMode);
  const picsNeedingArt = pics.filter((layer) => {
    const key = layer.slot || layer.id;
    // Already supplied (exact scraped URL, upload, or remote CDN) — do not regenerate.
    if (isUsableImageSlotValue(slots[key])) return false;
    return true;
  });
  if (picsNeedingArt.length) {
    if (opts.forbidAiPictureFallback || opts.lockProvidedSlots) {
      throw new Error(
        opts.lockProvidedSlots
          ? `Cannot re-render template: picture slot(s) ${picsNeedingArt
              .map((l) => l.slot || l.id)
              .join(', ')} are empty. Upload into the picture zone or regenerate the image first.`
          : `Exact scraped image mode: picture slot(s) ${picsNeedingArt
              .map((l) => l.slot || l.id)
              .join(', ')} are empty — refusing to generate AI art.`,
      );
    }
    const promptBase =
      opts.imagePrompt?.trim() ||
      `Photorealistic editorial photograph related to: ${opts.context?.headline || slots.headline || slots.title || 'business news'}.`;
    const noTextPrompt = [
      promptBase,
      opts.referenceImageUrl
        ? 'Match the composition, lighting, and visual mood of the attached reference image, but create a NEW original photograph (not a copy). Adapt for our brand; remove competitor logos, watermarks, and UI chrome.'
        : null,
      'NO typography, NO words, NO logos, NO watermarks, NO UI chrome — photography / illustration only.',
      'This image will be placed inside a designed template frame; leave subject clear and uncluttered.',
    ]
      .filter(Boolean)
      .join(' ');

    const { generateContentImage } = await import('../providers/images/fal.provider');
    const { routeForGeneration } = await import('./smart-image-router.service');
    const providers = await resolveProviders(opts.tenantId);
    const { providers: routed } = routeForGeneration(
      {
        prompt: noTextPrompt,
        artRole: 'hero_under_svg',
        designSource: 'brand_template',
        routingMode: providers.imageRoutingMode || 'auto',
        referenceImageUrl: opts.referenceImageUrl || undefined,
      },
      providers,
    );
    const image = await generateContentImage(routed, noTextPrompt, {
      format: 'instagram_square',
      exact: true,
      referenceImageUrl: opts.referenceImageUrl || undefined,
      referenceStrength: opts.referenceImageUrl ? 0.62 : undefined,
    });
    if (!image?.url) throw new Error('Image provider returned no URL for template picture layer.');

    for (const layer of picsNeedingArt) {
      slots[layer.slot || layer.id] = image.url;
    }
  }

  if (isPlacid) {
    const providers = await resolveProviders(opts.tenantId);
    if (!providers.placidApiKey) {
      throw new Error('Design-library API key not set. Connect it in Brand Studio or Settings → Integrations.');
    }

    // Host every picture on Placid storage so exact /uploads (and fragile CDNs) work.
    slots = await ensurePlacidHostedImageSlots({
      tenantId: opts.tenantId,
      apiKey: providers.placidApiKey,
      canvas,
      slots,
      exactMode,
    });

    const layers: Record<string, { text?: string; image?: string }> = {};
    // Text layers (dynamic)
    for (const layer of textLayers(canvas)) {
      const key = layer.slot || layer.id;
      const raw = slots[key];
      if (!raw?.trim()) continue;
      const text = resolveSlotLines(raw, layer.lineCount).filter(Boolean).join('\n') || raw;
      layers[key] = { text };
    }
    // Picture layers — exact mode includes mis-tagged static photo zones
    for (const layer of imageLayers(canvas, exactMode)) {
      const key = layer.slot || layer.id;
      const raw = (slots[key] || '').trim();
      if (!raw) continue;
      // After ensurePlacidHostedImageSlots every picture should be https (Placid storage)
      if (/^https:\/\//i.test(raw)) {
        layers[key] = { image: raw };
      } else {
        throw new Error(
          `Picture layer "${key}" is not a public HTTPS URL after Placid upload (${raw.slice(0, 80)}). ` +
            'Exact scraped images must upload to Placid media successfully.',
        );
      }
    }

    if (!Object.keys(layers).some((k) => Boolean(layers[k].image))) {
      const picKeys = imageLayers(canvas, exactMode).map((l) => l.slot || l.id);
      throw new Error(
        `No picture layers were sent to Placid (expected: ${picKeys.join(', ') || 'none'}). ` +
          'Check that the Brand Studio template has a picture layer and the scraped image was filled into that slot.',
      );
    }

    const imageUrl = await renderWithPlacid({
      templateId: template.placidTemplateId!,
      layers,
      apiKey: providers.placidApiKey,
      width: canvas.width || null,
      height: canvas.height || null,
    });
    return { imageUrl, slots };
  }

  // In-house SVG — render the prepared canvas (with contain fit when exact-scraped)
  const { renderBrandCanvasSvg, saveRenderedSvg } = await import('../providers/templates/brand-renderer');
  const svgCanvas: BrandCanvas = {
    ...canvas,
    layers: (canvas.layers || []).map((layer) => {
      if (!isPictureBrandLayer(layer)) return layer;
      const key = layer.slot || layer.id;
      const src = slots[key];
      if (src && /^(\/|https?:|data:)/.test(src)) {
        return { ...layer, src, fillMode: 'dynamic' as const, editable: true };
      }
      return layer;
    }),
  };
  // Exact mode must not render an empty picture box
  if (opts.forbidAiPictureFallback) {
    const missing = imageLayers(svgCanvas, true).filter((layer) => {
      const key = layer.slot || layer.id;
      const val = (slots[key] || layer.src || '').trim();
      return !val;
    });
    if (missing.length) {
      throw new Error(
        `Exact scraped image mode: picture slot(s) ${missing
          .map((l) => l.slot || l.id)
          .join(', ')} are empty before SVG render.`,
      );
    }
  }
  const svg = await renderBrandCanvasSvg(svgCanvas, slots);
  const saved = await saveRenderedSvg(opts.tenantId, svg, opts.prefix || 'brand');
  return { imageUrl: saved.publicUrl, slots };
}

/** Back-compat wrapper used by engines that previously called SVG+AI art only. */
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
  referenceImageUrl?: string | null;
  forbidAiPictureFallback?: boolean;
}) {
  return renderFilledBrandTemplate(opts);
}

export { type TemplateSlotMap };
