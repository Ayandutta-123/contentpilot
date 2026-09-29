import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { LLMService } from './llm.service';
import {
  SOCIAL_IMAGE_FORMATS,
  type LogoPlacement,
  type SocialImageFormat,
  type VisualStyleId,
} from '../providers/images/social-frame';
import { preferOriginalLogoUrl } from '../lib/store-upload';

export const VISUAL_MODES = ['existing_template', 'ai', 'ai_baked_layout'] as const;
export type VisualCreativeMode = (typeof VISUAL_MODES)[number];

export function parseVisualMode(
  raw?: string | null,
  fallback: VisualCreativeMode = 'ai',
): VisualCreativeMode {
  if (raw === 'existing_template' || raw === 'ai' || raw === 'ai_baked_layout') return raw;
  return fallback;
}

export type BakeBrief = {
  onImageHeadline: string;
  onImageSubhead: string;
  onImageCta: string;
  layoutHint: string;
  logoPlacement: LogoPlacement;
  bakedArtPrompt: string;
};

const BakeBriefSchema = z.object({
  onImageHeadline: z.string().min(1).max(72),
  onImageSubhead: z.string().max(110).optional().default(''),
  onImageCta: z.string().max(36).optional().default(''),
  layoutHint: z.string().max(80).optional().default('center_stage'),
  logoPlacement: z
    .enum(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
    .optional()
    .default('top-left'),
  bakedArtPrompt: z.string().min(40).max(2800),
});

/** On-image CTA — never paint mid-word ellipsis; max words + chars. */
function shortOnImageCta(raw: string | null | undefined, fallback = 'Learn more'): string {
  const base = (raw || fallback).trim().replace(/\s+/g, ' ').replace(/[.…]+$/g, '');
  const words = base.split(' ').filter(Boolean).slice(0, 5);
  let out = words.join(' ');
  if (out.length > 36) {
    out = out.slice(0, 36).replace(/\s+\S*$/, '').trim();
  }
  return out || fallback;
}

function shortOnImageLine(raw: string, maxWords: number, maxChars: number): string {
  const words = raw.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean).slice(0, maxWords);
  let out = words.join(' ');
  if (out.length > maxChars) {
    out = out.slice(0, maxChars).replace(/\s+\S*$/, '').trim();
  }
  return out.replace(/[.…]+$/g, '').trim();
}

/**
 * LLM writes short on-image copy + designer art direction for typography models
 * (Ideogram / GPT Image). Logo is stamped afterwards — never invented by the model.
 */
export async function generateBakeBrief(opts: {
  tenantId: string;
  companyName: string;
  headline: string;
  body: string;
  callToAction?: string | null;
  topic?: string | null;
  visualStyleId?: string | null;
  logoPlacement?: LogoPlacement;
  /** Vision description of a user-selected reference (e.g. a scraped meme). */
  referenceStyleBrief?: string | null;
  /** Layout/panel/caption structure the poster must reproduce. */
  referenceStructureNotes?: string | null;
}): Promise<BakeBrief> {
  const llm = await LLMService.forTenant(opts.tenantId);
  const placement = opts.logoPlacement || 'top-left';

  let raw: Record<string, unknown> = {};
  try {
    raw = await llm.generateRawJson({
      systemPrompt: [
        'You are a senior art director writing briefs for Ideogram / GPT Image poster models.',
        'Return JSON only: onImageHeadline, onImageSubhead, onImageCta, layoutHint, logoPlacement, bakedArtPrompt.',
        'onImageHeadline: ≤10 words, punchy, PERFECT spelling — this exact string will be painted on the poster.',
        'onImageSubhead: ≤14 words supporting line (or empty).',
        'onImageCta: ≤5 words button CTA (or empty).',
        'logoPlacement: top-left|top-right|bottom-left|bottom-right.',
        'bakedArtPrompt: 120–220 words describing ONE finished agency LinkedIn/Instagram poster:',
        '  composition (where type sits), scene, lighting, color palette, typography hierarchy (weight/size), white-space.',
        '  MUST say the model will render the exact quoted headline/subhead/CTA as crisp professional lettering.',
        '  MUST say: leave the logo corner calm and empty — do NOT draw any logo, wordmark, icon, or brand mark.',
        '  Aesthetic bar: Stripe / Linear / McKinsey creative quality — clean, premium, not cluttered, not meme, not stock collage.',
        'Never invent company logos. Never ask for dashed logo boxes.',
        opts.referenceStructureNotes || opts.referenceStyleBrief
          ? 'A REFERENCE LAYOUT is supplied: bakedArtPrompt MUST reproduce its panel split, caption placement, and visual energy with ORIGINAL art (no copied characters, faces, or watermarks). Override the default premium-poster aesthetic when it conflicts with the reference.'
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      userPrompt: [
        `Company (for tone only — do not invent its logo): ${opts.companyName}`,
        opts.topic ? `Topic: ${opts.topic}` : '',
        `Feed headline: ${opts.headline}`,
        `Feed body: ${opts.body.slice(0, 500)}`,
        opts.callToAction ? `CTA idea: ${opts.callToAction}` : '',
        `Logo corner to leave empty: ${placement}`,
        opts.visualStyleId ? `Style preset id: ${opts.visualStyleId}` : '',
        opts.referenceStructureNotes
          ? `REFERENCE STRUCTURE to reproduce: ${opts.referenceStructureNotes}`
          : '',
        opts.referenceStyleBrief
          ? `REFERENCE LOOK to match (original art only): ${opts.referenceStyleBrief.slice(0, 900)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    });
  } catch {
    raw = {};
  }

  const parsed = BakeBriefSchema.safeParse({
    onImageHeadline: shortOnImageLine(String(raw.onImageHeadline || opts.headline), 10, 72),
    onImageSubhead: shortOnImageLine(
      String(raw.onImageSubhead || opts.body.split(/[.!?]/)[0] || ''),
      14,
      110,
    ),
    onImageCta: shortOnImageCta(String(raw.onImageCta || opts.callToAction || 'Learn more')),
    layoutHint: raw.layoutHint || 'center_stage',
    logoPlacement: raw.logoPlacement || placement,
    bakedArtPrompt:
      typeof raw.bakedArtPrompt === 'string' && raw.bakedArtPrompt.trim().length > 40
        ? raw.bakedArtPrompt
        : '',
  });

  if (parsed.success && parsed.data.bakedArtPrompt.trim().length > 40) {
    return {
      onImageHeadline: shortOnImageLine(parsed.data.onImageHeadline, 10, 72),
      onImageSubhead: shortOnImageLine(parsed.data.onImageSubhead || '', 14, 110),
      onImageCta: shortOnImageCta(parsed.data.onImageCta),
      layoutHint: parsed.data.layoutHint || 'center_stage',
      logoPlacement: parsed.data.logoPlacement,
      bakedArtPrompt: parsed.data.bakedArtPrompt.trim(),
    };
  }

  const onImageHeadline = shortOnImageLine(opts.headline, 10, 72);
  const onImageSubhead = shortOnImageLine(opts.body.split(/[.!?]/)[0] || opts.body, 14, 110);
  const onImageCta = shortOnImageCta(opts.callToAction || 'Learn more');
  return {
    onImageHeadline,
    onImageSubhead,
    onImageCta,
    layoutHint: 'center_stage',
    logoPlacement: placement,
    bakedArtPrompt: [
      `Premium B2B LinkedIn square poster for ${opts.companyName}.`,
      `Clean editorial scene related to: ${opts.headline}.`,
      'Large crisp sans-serif headline on a calm dark or light panel with strong hierarchy, generous whitespace, restrained palette.',
      `Leave the ${placement} corner empty and uncluttered for a real logo badge — draw no logo, icon, or wordmark.`,
      'Agency finish like Stripe marketing — not cluttered, not sci-fi HUD collage.',
    ].join(' '),
  };
}

/**
 * Final fal prompt. Typography instructions first so they survive truncation.
 * Never asks the model to invent a brand logo.
 */
export function buildBakedPosterPrompt(opts: {
  companyName: string;
  brief: BakeBrief;
  visualStyleId?: string | null;
  brandImageStyle?: string | null;
  format?: SocialImageFormat;
}): string {
  const format = opts.format || 'instagram_square';
  const { width, height, label } = SOCIAL_IMAGE_FORMATS[format];
  const b = opts.brief;
  const corner = b.logoPlacement || 'top-left';

  const typographyBlock = [
    'TYPOGRAPHY (mandatory, perfect spelling, crisp agency lettering):',
    `Headline exactly: "${b.onImageHeadline}"`,
    b.onImageSubhead ? `Subhead exactly: "${b.onImageSubhead}"` : '',
    b.onImageCta ? `CTA exactly: "${b.onImageCta}"` : '',
    'High contrast, professional kerning, no garbled letters, no misspellings, no watermarks, no hashtags on the art.',
  ]
    .filter(Boolean)
    .join(' ');

  const logoBan = [
    `LOGO BAN: Leave the ${corner} corner calm and empty (soft blur / solid calm area).`,
    `Do NOT draw any logo, icon, wordmark, monogram, or brand mark for "${opts.companyName}" or any other company.`,
    'No dashed boxes, no LOGO placeholders, no fake badges.',
  ].join(' ');

  const scene = (b.bakedArtPrompt || '').trim().slice(0, 900);

  return [
    'Finished premium LinkedIn/Instagram marketing poster with embedded typography (poster with text, embedded text, write the words).',
    typographyBlock,
    logoBan,
    `Layout: ${b.layoutHint}. Brand tone: ${opts.companyName}.`,
    scene,
    opts.brandImageStyle ? `Brand mood (colors/feel only): ${opts.brandImageStyle.slice(0, 180)}` : '',
    `Full-bleed ${label} ${width}×${height}. Single cohesive designed poster — not a collage of tiny cards.`,
    'Aesthetic: top creative-agency B2B (Stripe / Linear quality). Clean hierarchy, intentional whitespace, no clutter.',
  ]
    .filter(Boolean)
    .join(' ');
}

export async function resolveBrandLogoUrl(tenantId: string): Promise<string | null> {
  const row = await prisma.brandSettings.findUnique({
    where: { tenantId },
    select: { logoUrl: true },
  });
  return preferOriginalLogoUrl(row?.logoUrl) || row?.logoUrl || null;
}

function resolveUploadAbsPath(publicOrRel: string): string | null {
  const cleaned = publicOrRel.replace(/^\/uploads\//, '').replace(/^\//, '');
  const full = path.resolve(config.UPLOAD_DIR, cleaned);
  if (!full.startsWith(path.resolve(config.UPLOAD_DIR))) return null;
  return fs.existsSync(full) ? full : null;
}

/**
 * Stamp the real Brand logo onto a baked poster (logo only — text stays in fal pixels).
 */
export async function stampRealLogoOnBakedPoster(opts: {
  tenantId: string;
  imagePublicUrl: string;
  logoUrl: string;
  placement?: LogoPlacement;
  format?: SocialImageFormat;
}): Promise<string> {
  const format = opts.format || 'instagram_square';
  const { width, height } = SOCIAL_IMAGE_FORMATS[format];
  const placement = opts.placement || 'top-left';

  const abs = resolveUploadAbsPath(opts.imagePublicUrl);
  if (!abs) return opts.imagePublicUrl;

  const { prepareLogoForOverlay } = await import('../providers/images/logo-prepare');
  let logoBuf: Buffer;
  try {
    const prepared = await prepareLogoForOverlay(opts.logoUrl, opts.tenantId);
    if (prepared.startsWith('data:image')) {
      const b64 = prepared.split('base64,')[1];
      logoBuf = Buffer.from(b64 || '', 'base64');
    } else if (prepared.startsWith('/uploads/')) {
      const p = resolveUploadAbsPath(prepared);
      if (!p) return opts.imagePublicUrl;
      logoBuf = fs.readFileSync(p);
    } else {
      return opts.imagePublicUrl;
    }
  } catch {
    return opts.imagePublicUrl;
  }

  if (!logoBuf.length) return opts.imagePublicUrl;

  const pad = Math.round(Math.min(width, height) * 0.04);
  const logoMaxW = Math.round(width * 0.28);
  const logoMaxH = Math.round(height * 0.11);
  const resized = await sharp(logoBuf)
    .resize({
      width: logoMaxW,
      height: logoMaxH,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });

  // Light badge so dark wordmarks stay readable on cinematic skies
  const badgePadX = Math.max(10, Math.round(resized.info.width * 0.12));
  const badgePadY = Math.max(8, Math.round(resized.info.height * 0.18));
  const badgeW = resized.info.width + badgePadX * 2;
  const badgeH = resized.info.height + badgePadY * 2;
  const radius = Math.max(8, Math.round(Math.min(badgeW, badgeH) * 0.18));
  const badgeSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeW}" height="${badgeH}">
      <rect x="0" y="0" width="${badgeW}" height="${badgeH}" rx="${radius}" ry="${radius}" fill="rgb(255,255,255)" fill-opacity="0.92"/>
    </svg>`,
  );
  const badge = await sharp(badgeSvg).png().toBuffer();

  const top = placement === 'top-left' || placement === 'top-right';
  const left = placement === 'top-left' || placement === 'bottom-left';
  const badgeLeft = left ? pad : width - pad - badgeW;
  const badgeTop = top ? pad : height - pad - badgeH;
  const logoLeft = badgeLeft + badgePadX;
  const logoTop = badgeTop + badgePadY;

  const base = sharp(abs).resize(width, height, { fit: 'cover' });
  const out = await base
    .composite([
      { input: badge, left: badgeLeft, top: badgeTop },
      { input: resized.data, left: logoLeft, top: logoTop },
    ])
    .png()
    .toBuffer();

  const dir = path.resolve(config.UPLOAD_DIR, opts.tenantId, 'ai-art');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `baked-logo-${Date.now()}.png`;
  fs.writeFileSync(path.join(dir, filename), out);
  return `/uploads/${opts.tenantId}/ai-art/${filename}`;
}

export function bakeSlotsPayload(
  brief: BakeBrief,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    creativeMode: 'ai_baked_layout',
    bakeBrief: brief,
    visualStyleId: extras?.visualStyleId ?? null,
    ...extras,
  };
}

export function isBakedCreativeMode(mode?: string | null): boolean {
  return mode === 'ai_baked_layout';
}

/** Generate bake brief + typography fal poster + real logo stamp. */
export async function attachBakedPosterForContent(opts: {
  tenantId: string;
  contentId: string;
  companyName: string;
  headline: string;
  body: string;
  callToAction?: string | null;
  topic?: string | null;
  visualStyleId?: string | null;
  brandImageStyle?: string | null;
  logoPlacement?: LogoPlacement;
  format?: SocialImageFormat;
  playId?: string | null;
  throwOnError?: boolean;
  /** Selected reference image (meme pick) the painted poster must match. */
  referenceImageUrl?: string | null;
  referenceStyleBrief?: string | null;
  referenceStructureNotes?: string | null;
}): Promise<{ imageUrl: string; bakeBrief: BakeBrief } | null> {
  const brief = await generateBakeBrief({
    tenantId: opts.tenantId,
    companyName: opts.companyName,
    headline: opts.headline,
    body: opts.body,
    callToAction: opts.callToAction,
    topic: opts.topic,
    visualStyleId: opts.visualStyleId,
    logoPlacement: opts.logoPlacement,
    referenceStyleBrief: opts.referenceStyleBrief,
    referenceStructureNotes: opts.referenceStructureNotes,
  });

  const logoUrl = await resolveBrandLogoUrl(opts.tenantId);
  const { attachGeneratedImage } = await import('./image-attach.service');
  const attached = await attachGeneratedImage(
    opts.tenantId,
    opts.contentId,
    brief.bakedArtPrompt,
    {
      creativeType: 'fal_full_poster',
      bakeBrief: brief,
      companyName: opts.companyName,
      brandImageStyle: opts.brandImageStyle,
      logoUrl,
      visualStyleId: opts.visualStyleId,
      logoPlacement: brief.logoPlacement,
      format: opts.format || 'instagram_square',
      playId: opts.playId || 'announcement',
      artRole: 'final_with_text',
      posterQuality: true,
      throwOnError: opts.throwOnError !== false,
      // Never pass the logo as a reference — it corrupts composition & invents marks.
      // A user-selected reference (e.g. the scraped meme) is safe and wanted.
      referenceImageUrl: opts.referenceImageUrl || null,
    },
  );

  if (!attached?.imageUrl) return null;
  // Ensure raw is on the row even if attach skipped persist edge-cases
  if (attached.rawImageUrl) {
    await prisma.generatedContent.update({
      where: { id: opts.contentId },
      data: {
        rawImageUrl: attached.rawImageUrl,
        imageUrl: attached.imageUrl,
      },
    });
  }
  return { imageUrl: attached.imageUrl, bakeBrief: brief };
}

export type { VisualStyleId };
