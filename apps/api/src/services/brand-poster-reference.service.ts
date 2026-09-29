import { prisma } from '../lib/prisma';
import {
  resolveReferenceDataUri,
  resolveReferencePublicUrl,
} from './reference-style.service';

export const MAX_BRAND_POSTER_REFERENCES = 20;

export type PosterReferenceMode = 'off' | 'guide' | 'strong';

export function isPosterReferenceMode(value: unknown): value is PosterReferenceMode {
  return value === 'off' || value === 'guide' || value === 'strong';
}

function compactBrief(brief: string): string {
  return brief.replace(/\s+/g, ' ').trim().slice(0, 1800);
}

export function aggregatePosterStyleBriefs(
  references: Array<{ label?: string | null; styleBrief: string }>,
): string {
  const usable = references
    .map((reference) => ({
      label: reference.label?.trim() || 'Approved poster',
      brief: compactBrief(reference.styleBrief),
    }))
    .filter((reference) => reference.brief);

  if (!usable.length) return '';
  return [
    'VISUAL DNA FROM APPROVED BRAND POSTERS:',
    ...usable.slice(0, 8).map((reference, index) => `${index + 1}. ${reference.label}: ${reference.brief}`),
    'Keep the recurring visual system, but create an original composition for the current topic. Never copy old readable text.',
  ].join('\n');
}

export async function refreshPosterVisualProfile(tenantId: string): Promise<string> {
  const references = await prisma.brandPosterReference.findMany({
    where: { tenantId, isActive: true },
    select: { label: true, styleBrief: true },
    orderBy: { createdAt: 'desc' },
    take: MAX_BRAND_POSTER_REFERENCES,
  });
  const profile = aggregatePosterStyleBriefs(references);
  await prisma.brandSettings.update({
    where: { tenantId },
    data: { posterVisualProfile: profile },
  });
  return profile;
}

function stableIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % Math.max(1, length);
}

export async function resolvePosterVisualGuidance(opts: {
  tenantId: string;
  seed: string;
  /** Exact story/competitor/meme/user reference must remain authoritative. */
  hasExplicitReference?: boolean;
  /** Fixed template plates must never be modified by learned style. */
  designSource?: 'template' | 'brand_template' | 'ai' | null;
}): Promise<{
  mode: PosterReferenceMode;
  styleInstruction: string;
  referenceImageUrl: string | null;
  referenceStrength?: number;
}> {
  const settings = await prisma.brandSettings.findUnique({
    where: { tenantId: opts.tenantId },
    select: { posterReferenceMode: true, posterVisualProfile: true },
  });
  const mode = isPosterReferenceMode(settings?.posterReferenceMode)
    ? settings.posterReferenceMode
    : 'off';
  if (
    mode === 'off' ||
    opts.hasExplicitReference ||
    opts.designSource === 'template' ||
    opts.designSource === 'brand_template'
  ) {
    return { mode, styleInstruction: '', referenceImageUrl: null };
  }

  const styleInstruction = settings?.posterVisualProfile?.trim()
    ? `${settings.posterVisualProfile.trim()}\nMatch strength: ${
        mode === 'strong'
          ? 'STRONG — this must look like the next creative in the same campaign.'
          : 'GUIDE — preserve recognizable brand traits while allowing a fresh composition.'
      }`
    : '';

  if (mode !== 'strong' || opts.hasExplicitReference) {
    return { mode, styleInstruction, referenceImageUrl: null };
  }

  const references = await prisma.brandPosterReference.findMany({
    where: { tenantId: opts.tenantId, isActive: true },
    select: { imageUrl: true },
    orderBy: { createdAt: 'asc' },
    take: MAX_BRAND_POSTER_REFERENCES,
  });
  if (!references.length) return { mode, styleInstruction, referenceImageUrl: null };

  const selected = references[stableIndex(opts.seed, references.length)].imageUrl;
  const publicUrl = resolveReferencePublicUrl(selected);
  const referenceImageUrl = /localhost|127\.0\.0\.1/.test(publicUrl)
    ? await resolveReferenceDataUri(selected).catch(() => null)
    : publicUrl;
  return {
    mode,
    styleInstruction,
    referenceImageUrl,
    referenceStrength: referenceImageUrl ? 0.72 : undefined,
  };
}
