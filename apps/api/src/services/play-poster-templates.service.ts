/**
 * Tenant-scoped uploaded poster masters per playbook category (playId).
 * Source of truth for the AI Assistant picker when installs exist for a play.
 */

import { prisma } from '../lib/prisma';
import { storeOriginalImage } from '../lib/store-upload';
import { getPlay } from './content-playbook.service';
import {
  POSTER_TEMPLATES,
  templatesForPlay as builtinTemplatesForPlay,
  type PosterTemplate,
  type PosterTemplateBlocks,
} from './poster-template-catalog';
import type { PosterLayoutId } from '../providers/images/poster-frame';

const UPLOADED_BLOCKS: PosterTemplateBlocks = {
  eyebrow: 'optional',
  subhead: 'optional',
  pillars: 0,
  stat: 'optional',
  callout: 'optional',
  closing: 'optional',
  footer: 'optional',
};

const OFFER_CIRCLES_BLOCKS: PosterTemplateBlocks = {
  eyebrow: 'required',
  subhead: 'required',
  pillars: 0,
  stat: 'required',
  callout: 'omit',
  closing: 'required',
  footer: 'required',
};

const OFFER_SPLIT_BLOCKS: PosterTemplateBlocks = {
  eyebrow: 'optional',
  subhead: 'omit',
  pillars: 0,
  stat: 'required',
  callout: 'optional',
  closing: 'required',
  footer: 'required',
};

export type UploadedInstallMode = 'replace' | 'append';

export function resolvePlayId(raw: string): { playId: string } | { error: string } {
  const trimmed = (raw || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (!trimmed) return { error: 'Unknown category — use a valid play id.' };
  const play = getPlay(trimmed) || getPlay(raw.trim());
  if (!play) return { error: 'Unknown category — use a valid play id.' };
  return { playId: play.id };
}

function blocksForFill(fillLayout: string, playId: string): PosterTemplateBlocks {
  if (fillLayout === 'sale_circles') return OFFER_CIRCLES_BLOCKS;
  if (fillLayout === 'sale_split') return OFFER_SPLIT_BLOCKS;
  const builtin = builtinTemplatesForPlay(playId)[0];
  return builtin?.blocks || UPLOADED_BLOCKS;
}

function copyRulesForFill(fillLayout: string, playId: string): string[] {
  if (fillLayout === 'sale_circles' || fillLayout === 'sale_split') {
    const match = POSTER_TEMPLATES.find((t) => t.playId === playId && t.layout === fillLayout);
    if (match) return match.copyRules;
  }
  return [
    'Keep copy short — this plate already has a fixed composition.',
    'statValue is the offer number from the brief only — never invent a discount.',
    'footerNote is the website or handle from the brand or brief.',
    'closingLine is a short CTA (1-3 words).',
  ];
}

function artDirectionForFill(fillLayout: string, playId: string): string {
  if (fillLayout === 'sale_circles' || fillLayout === 'sale_split') {
    const match = POSTER_TEMPLATES.find((t) => t.playId === playId && t.layout === fillLayout);
    if (match) return match.artDirection;
  }
  return 'Photoreal product or lifestyle subject only — no lettering, logos, or UI. Fills photo cutouts on a locked plate.';
}

/** Guess fill engine from play + label + install index (0-based among this batch). */
export function guessFillLayout(opts: {
  playId: string;
  label: string;
  indexInBatch: number;
}): PosterLayoutId {
  const label = opts.label.toLowerCase();
  if (/\b(circle|circles|cutout)\b/.test(label)) return 'sale_circles';
  if (/\b(split|frame|panel)\b/.test(label)) return 'sale_split';
  if (opts.playId === 'offer') {
    if (opts.indexInBatch === 0) return 'sale_split';
    if (opts.indexInBatch === 1) return 'sale_circles';
  }
  return 'uploaded_master';
}

export function rowToPosterTemplate(row: {
  id: string;
  playId: string;
  label: string;
  tagline: string;
  layout: string;
  fillLayout: string;
  previewUrl: string;
  sourceImageUrl: string;
}): PosterTemplate {
  const fillLayout = (row.fillLayout || 'uploaded_master') as PosterLayoutId;
  return {
    id: row.id,
    playId: row.playId,
    label: row.label,
    tagline: row.tagline || 'Exact finished look — Brand Kit + your text fill this plate.',
    layout: 'uploaded_master',
    fillLayout,
    blocks: blocksForFill(fillLayout, row.playId),
    headlineWords: [2, 10],
    copyRules: copyRulesForFill(fillLayout, row.playId),
    artDirection: artDirectionForFill(fillLayout, row.playId),
    accentRole: fillLayout === 'sale_split' ? 'headline' : 'stat',
    previewUrl: row.previewUrl,
    sourceImageUrl: row.sourceImageUrl,
    origin: 'upload',
  };
}

export async function listUploadedTemplates(
  tenantId: string,
  playId?: string | null,
): Promise<PosterTemplate[]> {
  const rows = await prisma.playPosterTemplate.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(playId ? { playId } : {}),
    },
    orderBy: [{ playId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(rowToPosterTemplate);
}

/**
 * Templates shown in AI Assistant for a play.
 * If the tenant has uploads for that play, builtins are hidden.
 */
export async function resolvedTemplatesForPlay(
  tenantId: string,
  playId?: string | null,
): Promise<PosterTemplate[]> {
  if (!playId) return [];
  const uploaded = await listUploadedTemplates(tenantId, playId);
  if (uploaded.length) return uploaded;
  return builtinTemplatesForPlay(playId).map((t) => ({ ...t, origin: 'builtin' as const }));
}

export async function resolvedAllTemplates(tenantId: string): Promise<PosterTemplate[]> {
  const uploaded = await listUploadedTemplates(tenantId);
  const playsWithUploads = new Set(uploaded.map((t) => t.playId));
  const builtins = POSTER_TEMPLATES.filter((t) => !playsWithUploads.has(t.playId)).map((t) => ({
    ...t,
    origin: 'builtin' as const,
  }));
  return [...uploaded, ...builtins];
}

export async function resolvedTemplatesByPlay(
  tenantId: string,
): Promise<Array<{ playId: string; templates: PosterTemplate[] }>> {
  const all = await resolvedAllTemplates(tenantId);
  const order: string[] = [];
  for (const t of all) if (!order.includes(t.playId)) order.push(t.playId);
  return order.map((playId) => ({
    playId,
    templates: all.filter((t) => t.playId === playId),
  }));
}

export async function resolvePosterTemplate(
  tenantId: string,
  id?: string | null,
): Promise<PosterTemplate | undefined> {
  if (!id) return undefined;
  const row = await prisma.playPosterTemplate.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (row) return rowToPosterTemplate(row);
  const builtin = POSTER_TEMPLATES.find((t) => t.id === id);
  return builtin ? { ...builtin, origin: 'builtin' } : undefined;
}

/** Effective SVG/composite layout used by brandPosterFrame. */
export function effectivePosterLayout(t: PosterTemplate): PosterLayoutId {
  if (t.origin === 'upload' || t.layout === 'uploaded_master') {
    return (t.fillLayout || 'uploaded_master') as PosterLayoutId;
  }
  return t.layout;
}

export async function installUploadedTemplates(opts: {
  tenantId: string;
  playId: string;
  mode: UploadedInstallMode;
  files: Array<{
    buffer: Buffer;
    filename: string;
    mimetype: string;
    label?: string;
    fillLayout?: string;
  }>;
}): Promise<{ templates: PosterTemplate[]; installed: number }> {
  if (!opts.files.length) {
    throw new Error('Upload at least one JPG, PNG, or WebP image.');
  }

  if (opts.mode === 'replace') {
    await prisma.playPosterTemplate.updateMany({
      where: { tenantId: opts.tenantId, playId: opts.playId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  const existingMax = await prisma.playPosterTemplate.aggregate({
    where: { tenantId: opts.tenantId, playId: opts.playId, deletedAt: null },
    _max: { sortOrder: true },
  });
  let sortOrder = (existingMax._max.sortOrder ?? -1) + 1;

  const created: PosterTemplate[] = [];
  for (let i = 0; i < opts.files.length; i++) {
    const file = opts.files[i]!;
    if (!file.mimetype.startsWith('image/')) {
      throw new Error(`Not an image: ${file.filename}`);
    }
    const label =
      (file.label || '').trim() ||
      file.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() ||
      `Template ${i + 1}`;
    const fillLayout =
      (file.fillLayout as PosterLayoutId | undefined) ||
      guessFillLayout({ playId: opts.playId, label, indexInBatch: i });

    const stored = await storeOriginalImage({
      tenantId: opts.tenantId,
      subdir: `poster-templates/${opts.playId}`,
      buffer: file.buffer,
      originalFilename: file.filename || `template-${i + 1}.png`,
      mimetype: file.mimetype,
      logLabel: 'poster-template',
    });

    const row = await prisma.playPosterTemplate.create({
      data: {
        tenantId: opts.tenantId,
        playId: opts.playId,
        label,
        tagline: 'Exact finished look — Brand Kit + your text fill this plate.',
        layout: 'uploaded_master',
        fillLayout,
        previewUrl: stored.publicUrl,
        sourceImageUrl: stored.publicUrl,
        sortOrder: sortOrder++,
      },
    });
    created.push(rowToPosterTemplate(row));
  }

  return { templates: created, installed: created.length };
}

export async function softDeleteUploadedTemplate(
  tenantId: string,
  id: string,
): Promise<boolean> {
  const row = await prisma.playPosterTemplate.findFirst({
    where: { id, tenantId, deletedAt: null },
  });
  if (!row) return false;
  await prisma.playPosterTemplate.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  return true;
}
