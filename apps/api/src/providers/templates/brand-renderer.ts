import fs from 'fs';
import path from 'path';
import { config } from '../../config';

export type BrandFillType =
  | 'headline'
  | 'subheadline'
  | 'body'
  | 'cta'
  | 'hashtag'
  | 'date'
  | 'offer'
  | 'custom_text'
  | 'json'
  | 'image_prompt'
  | 'image_url';

export const BRAND_FILL_TYPES: Array<{
  id: BrandFillType;
  label: string;
  hint: string;
  for: Array<'text' | 'image'>;
}> = [
  { id: 'headline', label: 'Headline', hint: 'Short punchy title', for: ['text'] },
  { id: 'subheadline', label: 'Subheadline', hint: 'Supporting line under headline', for: ['text'] },
  { id: 'body', label: 'Body / caption', hint: 'Longer post body text', for: ['text'] },
  { id: 'cta', label: 'Call to action', hint: 'e.g. Shop now, Learn more', for: ['text'] },
  { id: 'hashtag', label: 'Hashtags', hint: 'Space-separated hashtags', for: ['text'] },
  { id: 'date', label: 'Date / occasion', hint: 'Festival or event date text', for: ['text'] },
  { id: 'offer', label: 'Offer / promo', hint: 'Discount or deal line', for: ['text'] },
  { id: 'custom_text', label: 'Custom text', hint: 'Free-form text (use fill hint)', for: ['text'] },
  { id: 'json', label: 'JSON object', hint: 'Structured JSON for this zone', for: ['text'] },
  { id: 'image_prompt', label: 'AI image (prompt)', hint: 'LLM writes a prompt; image is generated', for: ['image'] },
  { id: 'image_url', label: 'Image URL', hint: 'LLM or pipeline supplies an image URL', for: ['image'] },
];

/** Predefined post layouts — exact dynamic line counts Claude must follow. */
export type BrandPostPreset = {
  id: string;
  label: string;
  description: string;
  /** Exact on-image lines for each dynamic text zone */
  zones: Array<{
    slot: string;
    fillType: BrandFillType;
    lineCount: number;
    fillHint: string;
    /** Roles / instructions for each body line (drives jsonSchema) */
    lineRoles?: string[];
  }>;
};

export const BRAND_POST_PRESETS: BrandPostPreset[] = [
  {
    id: 'festival',
    label: 'Festival / greeting',
    description: '1 headline + 2 body lines (wish / brand tie-in)',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Exactly 1 short greeting headline' },
      {
        slot: 'body',
        fillType: 'json',
        lineCount: 2,
        fillHint: 'Exactly 2 on-image body lines as JSON',
        lineRoles: ['Warm festival wish (max ~45 chars)', 'Brand tie-in or soft CTA (max ~50 chars)'],
      },
    ],
  },
  {
    id: 'product_launch',
    label: 'Product launch',
    description: '1 headline + 3 body lines (what / why / CTA)',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Exactly 1 product name / launch headline' },
      {
        slot: 'body',
        fillType: 'json',
        lineCount: 3,
        fillHint: 'Exactly 3 on-image body lines as JSON',
        lineRoles: ['What we launched', 'Key benefit or proof', 'Clear call to action'],
      },
    ],
  },
  {
    id: 'offer',
    label: 'Offer / promo',
    description: '1 headline + 2 body lines + 1 offer line',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Exactly 1 promo headline' },
      {
        slot: 'body',
        fillType: 'json',
        lineCount: 2,
        fillHint: 'Exactly 2 supporting body lines as JSON',
        lineRoles: ['Offer context', 'Urgency or eligibility'],
      },
      { slot: 'offer', fillType: 'offer', lineCount: 1, fillHint: 'Exactly 1 discount / deal line' },
    ],
  },
  {
    id: 'thought_leadership',
    label: 'Thought leadership',
    description: '1 headline + 4 body lines (insight thread)',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Exactly 1 insight headline' },
      {
        slot: 'body',
        fillType: 'json',
        lineCount: 4,
        fillHint: 'Exactly 4 on-image body lines as JSON',
        lineRoles: ['Hook / problem', 'Insight', 'Implication', 'Soft CTA or takeaway'],
      },
    ],
  },
  {
    id: 'announcement',
    label: 'Announcement',
    description: '1 headline + 2 body lines',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Exactly 1 announcement headline' },
      {
        slot: 'body',
        fillType: 'json',
        lineCount: 2,
        fillHint: 'Exactly 2 body lines as JSON',
        lineRoles: ['What is new', 'Why it matters / next step'],
      },
    ],
  },
  {
    id: 'countdown',
    label: 'Countdown',
    description: '1 big countdown headline + 2 body lines (event / CTA)',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Exactly 1 countdown line e.g. 2 days left' },
      {
        slot: 'body',
        fillType: 'json',
        lineCount: 2,
        fillHint: 'Exactly 2 on-image body lines as JSON',
        lineRoles: ['What is launching / happening', 'Soft CTA with date if known'],
      },
    ],
  },
  {
    id: 'update',
    label: 'Product update',
    description: '1 headline + 3 changelog-style body lines',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Exactly 1 “What’s new” style headline' },
      {
        slot: 'body',
        fillType: 'json',
        lineCount: 3,
        fillHint: 'Exactly 3 update lines as JSON',
        lineRoles: ['Change 1', 'Change 2', 'Benefit or how to try'],
      },
    ],
  },
  {
    id: 'aesthetic',
    label: 'Aesthetic mood',
    description: 'Minimal on-image text — 1 short line only',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'At most 1 short mood line (or brand name)' },
      {
        slot: 'body',
        fillType: 'json',
        lineCount: 1,
        fillHint: 'Optional tiny secondary line — keep nearly empty for aesthetic posts',
        lineRoles: ['Optional whisper line (max ~30 chars) or leave very short'],
      },
    ],
  },
  {
    id: 'meme_safe',
    label: 'Brand-safe meme',
    description: '2-panel setup / punchline (original layout only)',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Setup / panel 1 text' },
      {
        slot: 'body',
        fillType: 'json',
        lineCount: 2,
        fillHint: 'Punchline lines as JSON',
        lineRoles: ['Panel 2 punchline', 'Optional brand wink (soft)'],
      },
    ],
  },
  {
    id: 'custom',
    label: 'Custom (blank plate)',
    description: 'Default headline + subtext — configure zones yourself',
    zones: [
      { slot: 'headline', fillType: 'headline', lineCount: 1, fillHint: 'Short campaign headline' },
      { slot: 'subtext', fillType: 'subheadline', lineCount: 1, fillHint: 'One supporting sentence' },
    ],
  },
];

export function getBrandPostPreset(id?: string | null): BrandPostPreset {
  return BRAND_POST_PRESETS.find((p) => p.id === id) || BRAND_POST_PRESETS.find((p) => p.id === 'custom')!;
}

export function bodyJsonSchemaForLines(lineCount: number, lineRoles?: string[]): string {
  const roles =
    lineRoles && lineRoles.length === lineCount
      ? lineRoles
      : Array.from({ length: lineCount }, (_, i) => `Line ${i + 1}`);
  return JSON.stringify(
    {
      lines: roles.map((role, i) => ({
        index: i + 1,
        role,
        value: 'string — write this line only; keep short for the plate',
      })),
      _rules: [
        `Return EXACTLY ${lineCount} items in "lines"`,
        'Do not add or remove lines',
        'Each value is one on-image line (no mid-line wrapping)',
      ],
    },
    null,
    2,
  );
}

export type BrandCanvas = {
  width?: number;
  height?: number;
  background?: { type: 'color' | 'image'; value: string };
  /** Whole-canvas background: static fixed image/color, or AI-generated */
  backgroundMode?: 'static' | 'dynamic';
  backgroundFit?: 'cover' | 'contain' | 'stretch';
  backgroundFillType?: BrandFillType;
  /** Selected predefined post type (controls default line counts) */
  postType?: string;
  /** Where the design was authored: placid editor vs in-house cloze canvas */
  designSource?: 'placid' | 'inhouse';
  layers?: BrandLayer[];
};

export type BrandLayer = {
  id: string;
  type: 'text' | 'image' | 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius for rect / image clipping */
  radius?: number;
  /** Shape gradient fill (overrides `fill` when both stops set) */
  gradientFrom?: string;
  gradientTo?: string;
  gradientAngle?: number;
  strokeColor?: string;
  strokeWidth?: number;
  /** Typography extras */
  fontStyle?: 'normal' | 'italic';
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  valign?: 'top' | 'middle' | 'bottom';
  /** Text outline */
  textStrokeColor?: string;
  textStrokeWidth?: number;
  /** Drop shadow */
  shadow?: boolean;
  shadowColor?: string;
  shadowBlur?: number;
  shadowX?: number;
  shadowY?: number;
  /** Highlight box behind text */
  highlight?: string;
  highlightPadding?: number;
  highlightRadius?: number;
  /** Dynamic slot name — filled by AI when mode is dynamic */
  slot?: string;
  /** Static text / fallback */
  text?: string;
  src?: string;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  color?: string;
  align?: 'left' | 'center' | 'right';
  fill?: string;
  /** @deprecated prefer fillMode */
  editable?: boolean;
  /** static = never changed by AI; dynamic = filled per fillType */
  fillMode?: 'static' | 'dynamic';
  /** What the LLM should produce for this zone */
  fillType?: BrandFillType;
  /** Extra instruction passed to the LLM for this zone */
  fillHint?: string;
  /** When fillType=json — describe expected keys/shape */
  jsonSchema?: string;
  /** Exact number of on-image lines Claude must produce for this zone */
  lineCount?: number;
  /** Original Placid layer type when synced from Placid */
  placidType?: string;
  /** Design-stage controls shared with the in-house editor */
  hidden?: boolean;
  locked?: boolean;
  opacity?: number;
  rotation?: number;
  textFit?: 'wrap' | 'fit' | 'single_line';
  imageFit?: 'cover' | 'contain';
};

/** Turn AI slot payload into display lines (respects JSON lines[] and lineCount). */
export function resolveSlotLines(raw: string, lineCount?: number): string[] {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return [];

  let lines: string[] = [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        lines = parsed.map((v) => {
          if (typeof v === 'string') return v;
          if (v && typeof v === 'object' && 'value' in v) return String((v as { value: unknown }).value ?? '');
          return String(v ?? '');
        });
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.lines)) {
          lines = obj.lines.map((v) => {
            if (typeof v === 'string') return v;
            if (v && typeof v === 'object' && 'value' in v) {
              return String((v as { value: unknown }).value ?? '');
            }
            return String(v ?? '');
          });
        } else {
          lines = [trimmed];
        }
      }
    } catch {
      lines = trimmed.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    }
  } else {
    lines = trimmed.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  }

  lines = lines.map((l) => l.trim()).filter(Boolean);
  if (lineCount && lineCount > 0) {
    if (lines.length > lineCount) lines = lines.slice(0, lineCount);
    while (lines.length < lineCount) lines.push('');
  }
  return lines;
}

export function isLayerDynamic(layer: BrandLayer): boolean {
  if (layer.fillMode) return layer.fillMode === 'dynamic';
  return layer.editable !== false && Boolean(layer.slot || layer.type === 'image');
}

export function layerFillType(layer: BrandLayer): BrandFillType {
  if (layer.fillType) return layer.fillType;
  if (layer.type === 'image' || layer.placidType === 'picture' || layer.placidType === 'browserframe') {
    return 'image_url';
  }
  const slot = (layer.slot || layer.id || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (slot === 'headline' || /(^|_)(title|heading)(_|$)/.test(slot)) return 'headline';
  if (slot === 'subtext' || slot === 'subheadline' || /(subtitle|tagline)/.test(slot)) return 'subheadline';
  if (slot === 'body' || /(caption|description)/.test(slot)) return layer.jsonSchema ? 'json' : 'body';
  if (slot === 'cta' || /call_to_action/.test(slot)) return 'cta';
  if (slot === 'offer' || /(promo|deal)/.test(slot)) return 'offer';
  if (slot === 'hashtags' || slot === 'hashtag') return 'hashtag';
  if (slot === 'date' || /occasion/.test(slot)) return 'date';
  return 'custom_text';
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const limit = Math.max(4, maxCharsPerLine);
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    // Hard-break ultra-long tokens so they cannot blow past the box
    if (w.length > limit) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      for (let i = 0; i < w.length; i += limit) {
        lines.push(w.slice(i, i + limit));
      }
      continue;
    }
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > limit && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 12);
}

/** Average glyph width as a fraction of font-size (bold headlines are wider). */
function estimateCharWidthFactor(layer: BrandLayer): number {
  const weight = Number.parseInt(String(layer.fontWeight || '600'), 10);
  const bold = Number.isFinite(weight) ? weight >= 600 : true;
  const tracking = Math.max(0, layer.letterSpacing || 0);
  // Empirically, 0.55 was too narrow → fitted font stayed too large → side crop.
  const base = bold ? 0.68 : 0.58;
  return base + tracking / Math.max(12, layer.fontSize || 36);
}

/**
 * Layout text inside a layer box.
 * - wrap: break lines to width at configured size (may overflow height)
 * - fit: wrap up to maxLines, then shrink font until width+height both fit
 * - single_line: never wrap; only shrink
 */
function layoutTextInBox(
  raw: string,
  layer: BrandLayer,
  textFit: 'wrap' | 'fit' | 'single_line',
): { lines: string[]; fontSize: number } {
  const configuredFontSize = Math.max(8, layer.fontSize || 36);
  const lineHeightRatio = layer.lineHeight && layer.lineHeight > 0 ? layer.lineHeight : 1.25;
  // Keep a little inset so glyphs/strokes don't kiss the frame edge
  const boxW = Math.max(24, layer.w * 0.96);
  const boxH = Math.max(16, layer.h);
  const maxLines =
    textFit === 'single_line'
      ? 1
      : Math.max(1, Math.min(12, layer.lineCount && layer.lineCount > 0 ? layer.lineCount : 6));

  const cleaned = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return { lines: [''], fontSize: configuredFontSize };

  if (textFit === 'single_line') {
    const factor = estimateCharWidthFactor(layer);
    const needed = cleaned.length * factor;
    const fontSize = Math.max(8, Math.min(configuredFontSize, boxW / Math.max(1, needed)));
    return { lines: [cleaned], fontSize };
  }

  if (textFit === 'wrap') {
    const factor = estimateCharWidthFactor(layer);
    const maxChars = Math.max(4, Math.floor(boxW / (configuredFontSize * factor)));
    let lines = wrapText(cleaned, maxChars);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      const last = lines[maxLines - 1] || '';
      lines[maxLines - 1] = last.length > 3 ? `${last.slice(0, Math.max(3, last.length - 1))}…` : last;
    }
    return { lines, fontSize: configuredFontSize };
  }

  // fit — try from configured size down until the block fits the box
  let fontSize = configuredFontSize;
  let lines: string[] = [cleaned];
  for (; fontSize >= 8; fontSize -= 0.5) {
    const factor = estimateCharWidthFactor({ ...layer, fontSize });
    const maxChars = Math.max(4, Math.floor(boxW / (fontSize * factor)));
    lines = wrapText(cleaned, maxChars);
    if (lines.length > maxLines) {
      // Too many lines at this size — keep shrinking so wrap produces fewer lines
      continue;
    }
    const longest = Math.max(1, ...lines.map((l) => l.length));
    const widthOk = longest * factor * fontSize <= boxW + 0.5;
    const heightOk = lines.length * fontSize * lineHeightRatio <= boxH + 0.5;
    if (widthOk && heightOk) {
      return { lines, fontSize: Math.round(fontSize * 10) / 10 };
    }
  }

  // Absolute fallback at 8px: force maxLines and ellipsize
  const factor = estimateCharWidthFactor({ ...layer, fontSize: 8 });
  const maxChars = Math.max(4, Math.floor(boxW / (8 * factor)));
  lines = wrapText(cleaned, maxChars).slice(0, maxLines);
  if (lines.length === maxLines && wrapText(cleaned, maxChars).length > maxLines) {
    const last = lines[maxLines - 1] || '';
    lines[maxLines - 1] = `${last.replace(/\s+\S*$/, '').slice(0, Math.max(3, maxChars - 1))}…`;
  }
  return { lines, fontSize: 8 };
}

/** Resolve /uploads/... URLs to disk paths under UPLOAD_DIR */
export function resolveUploadPath(urlOrPath: string): string | null {
  if (!urlOrPath) return null;
  if (urlOrPath.startsWith('data:')) return null;
  if (fs.existsSync(urlOrPath)) return urlOrPath;
  const cleaned = urlOrPath.replace(/^\/uploads\//, '');
  const full = path.resolve(config.UPLOAD_DIR, cleaned);
  return fs.existsSync(full) ? full : null;
}

function fileToDataUri(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.webp'
        ? 'image/webp'
        : ext === '.gif'
          ? 'image/gif'
          : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function resolveImageHref(src: string): string {
  if (!src) return '';
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://')) {
    return src;
  }
  const disk = resolveUploadPath(src);
  if (disk) return fileToDataUri(disk);
  return src;
}

async function resolveImageHrefForSvg(src: string): Promise<string> {
  if (!/^https?:\/\//i.test(src)) return resolveImageHref(src);
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Could not download template image (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0];
  const mime = contentType.startsWith('image/') ? contentType : 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/**
 * Placid-style editable plate: header, logo, headline, body, hero image, footer.
 * All zones are positioned for drag/resize; Fixed vs Dynamic is set per layer.
 */
export function scaffoldEditablePlateLayout(opts?: {
  companyName?: string;
  logoUrl?: string | null;
  backgroundUrl?: string;
  primaryColor?: string;
  width?: number;
  height?: number;
  postType?: string;
}): BrandCanvas {
  const width = Math.max(240, Math.round(opts?.width || 1080));
  const height = Math.max(240, Math.round(opts?.height || 1080));
  const company = (opts?.companyName || 'Your Brand').trim() || 'Your Brand';
  const preset = getBrandPostPreset(opts?.postType);
  const pad = Math.round(width * 0.06);
  const contentW = width - pad * 2;
  const headerH = Math.round(height * 0.1);
  const footerH = Math.round(height * 0.08);
  const logoSize = Math.round(Math.min(width, height) * 0.08);
  const headlineH = Math.round(height * 0.09);
  const subH = Math.round(height * 0.05);
  const heroH = Math.round(height * 0.32);
  const bodyLines = preset.zones.find((z) => z.slot === 'body')?.lineCount || 2;
  const bodyH = Math.max(Math.round(height * 0.1), bodyLines * Math.round(height * 0.035) + 20);

  let y = Math.round(headerH + height * 0.03);

  const layers: BrandLayer[] = [
    {
      id: 'header_bar',
      type: 'rect',
      x: 0,
      y: 0,
      w: width,
      h: headerH,
      fill: 'rgba(15,23,42,0.55)',
      fillMode: 'static',
      editable: false,
      opacity: 100,
      locked: false,
    },
    {
      id: 'logo',
      type: 'image',
      x: pad,
      y: Math.round((headerH - logoSize) / 2),
      w: logoSize,
      h: logoSize,
      slot: 'logo',
      src: opts?.logoUrl || '',
      fillMode: 'static',
      editable: false,
      fillType: 'image_url',
      fillHint: 'Brand logo — keep Static unless you want AI to swap it',
      opacity: 100,
      imageFit: 'contain',
    },
    {
      id: 'brand_name',
      type: 'text',
      x: pad + logoSize + Math.round(pad * 0.4),
      y: Math.round((headerH - Math.round(height * 0.04)) / 2),
      w: contentW - logoSize - pad,
      h: Math.round(height * 0.045),
      text: company,
      fontSize: Math.max(18, Math.round(height * 0.028)),
      fontWeight: '600',
      color: '#f8fafc',
      align: 'left',
      fillMode: 'static',
      editable: false,
      opacity: 100,
      textFit: 'fit',
    },
    {
      id: 'headline',
      type: 'text',
      x: pad,
      y,
      w: contentW,
      h: headlineH,
      slot: 'headline',
      text: 'Your headline here',
      fontSize: Math.max(28, Math.round(height * 0.048)),
      fontWeight: '700',
      color: '#ffffff',
      align: 'center',
      fillMode: 'dynamic',
      editable: true,
      fillType: 'headline',
      fillHint: preset.zones.find((z) => z.slot === 'headline')?.fillHint || 'Short punchy headline',
      lineCount: 1,
      opacity: 100,
      textFit: 'fit',
    },
  ];

  y += headlineH + Math.round(height * 0.012);

  layers.push({
    id: 'subheadline',
    type: 'text',
    x: pad,
    y,
    w: contentW,
    h: subH,
    slot: 'subheadline',
    text: 'Supporting line',
    fontSize: Math.max(16, Math.round(height * 0.024)),
    fontWeight: '400',
    color: '#e2e8f0',
    align: 'center',
    fillMode: 'dynamic',
    editable: true,
    fillType: 'subheadline',
    fillHint: 'One supporting sentence',
    lineCount: 1,
    opacity: 100,
    textFit: 'fit',
  });

  y += subH + Math.round(height * 0.02);

  layers.push({
    id: 'hero_image',
    type: 'image',
    x: pad,
    y,
    w: contentW,
    h: heroH,
    slot: 'hero_image',
    src: '',
    fillMode: 'dynamic',
    editable: true,
    fillType: 'image_prompt',
    fillHint: 'Main visual for this post — product, festival, or campaign art',
    opacity: 100,
    imageFit: 'cover',
  });

  y += heroH + Math.round(height * 0.025);

  const bodyZone = preset.zones.find((z) => z.slot === 'body');
  layers.push({
    id: 'body',
    type: 'text',
    x: pad,
    y: Math.min(y, height - footerH - bodyH - pad),
    w: contentW,
    h: bodyH,
    slot: 'body',
    text: Array.from({ length: bodyLines }, (_, i) => `Body line ${i + 1}`).join('\n'),
    fontSize: Math.max(16, Math.round(height * 0.022)),
    fontWeight: '400',
    color: '#cbd5e1',
    align: 'center',
    fillMode: 'dynamic',
    editable: true,
    fillType: 'json',
    fillHint: bodyZone?.fillHint || `Exactly ${bodyLines} on-image body lines`,
    lineCount: bodyLines,
    jsonSchema: bodyJsonSchemaForLines(bodyLines, bodyZone?.lineRoles),
    opacity: 100,
    textFit: 'wrap',
  });

  layers.push(
    {
      id: 'footer_bar',
      type: 'rect',
      x: 0,
      y: height - footerH,
      w: width,
      h: footerH,
      fill: 'rgba(15,23,42,0.65)',
      fillMode: 'static',
      editable: false,
      opacity: 100,
    },
    {
      id: 'footer',
      type: 'text',
      x: pad,
      y: height - footerH + Math.round(footerH * 0.25),
      w: contentW,
      h: Math.round(footerH * 0.5),
      text: company,
      fontSize: Math.max(14, Math.round(height * 0.02)),
      fontWeight: '500',
      color: '#94a3b8',
      align: 'center',
      fillMode: 'static',
      editable: false,
      opacity: 100,
      textFit: 'fit',
    },
  );

  // Optional offer line from preset
  const offerZone = preset.zones.find((z) => z.slot === 'offer');
  if (offerZone) {
    layers.splice(layers.length - 2, 0, {
      id: 'offer',
      type: 'text',
      x: pad,
      y: Math.max(pad, height - footerH - Math.round(height * 0.06) - 8),
      w: contentW,
      h: Math.round(height * 0.05),
      slot: 'offer',
      text: 'Offer line',
      fontSize: Math.max(18, Math.round(height * 0.028)),
      fontWeight: '700',
      color: '#fbbf24',
      align: 'center',
      fillMode: 'dynamic',
      editable: true,
      fillType: 'offer',
      fillHint: offerZone.fillHint,
      lineCount: 1,
      opacity: 100,
      textFit: 'fit',
    });
  }

  return {
    width,
    height,
    background: opts?.backgroundUrl
      ? { type: 'image', value: opts.backgroundUrl }
      : { type: 'color', value: opts?.primaryColor || '#0f172a' },
    backgroundMode: 'static',
    backgroundFit: 'cover',
    postType: preset.id,
    designSource: 'inhouse',
    layers,
  };
}

export function defaultBrandCanvas(opts?: {
  companyName?: string;
  primaryColor?: string;
  backgroundUrl?: string;
  logoUrl?: string | null;
  postType?: string;
  width?: number;
  height?: number;
}): BrandCanvas {
  return scaffoldEditablePlateLayout(opts);
}

/** Re-apply a post-type preset onto an existing canvas (keeps background + size). */
export function applyPostTypeToCanvas(canvas: BrandCanvas, postType: string, companyName?: string, logoUrl?: string | null): BrandCanvas {
  return scaffoldEditablePlateLayout({
    companyName,
    logoUrl,
    backgroundUrl: canvas.background?.type === 'image' ? canvas.background.value : undefined,
    primaryColor: canvas.background?.type === 'color' ? canvas.background.value : undefined,
    postType,
    width: canvas.width,
    height: canvas.height,
  });
}

/**
 * Free in-house template engine — renders SVG (no paid API).
 * Flexible layers (editable=true) use slot values; static layers keep authored text.
 */
export async function renderBrandCanvasSvg(
  canvas: BrandCanvas,
  slots: Record<string, string>,
): Promise<string> {
  const width = canvas.width || 1080;
  const height = canvas.height || 1080;
  const bg = canvas.background || { type: 'color' as const, value: '#0f172a' };

  let bgEl = '';
  if (bg.type === 'image' && bg.value) {
    const href = await resolveImageHrefForSvg(bg.value);
    const fit =
      canvas.backgroundFit === 'stretch'
        ? 'none'
        : canvas.backgroundFit === 'cover'
          ? 'xMidYMid slice'
          : 'xMidYMid meet';
    bgEl = `<image href="${escapeXml(href)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="${fit}"/>`;
  } else {
    bgEl = `<rect width="${width}" height="${height}" fill="${escapeXml(bg.value || '#0f172a')}"/>`;
  }

  const layers = canvas.layers || [];
  const defs: string[] = [];

  const shapePaint = (layer: BrandLayer, index: number): string => {
    if (layer.gradientFrom && layer.gradientTo) {
      const id = `grad_${index}`;
      const angle = ((layer.gradientAngle ?? 90) * Math.PI) / 180;
      const x2 = (0.5 + Math.cos(angle) / 2).toFixed(4);
      const y2 = (0.5 + Math.sin(angle) / 2).toFixed(4);
      const x1 = (0.5 - Math.cos(angle) / 2).toFixed(4);
      const y1 = (0.5 - Math.sin(angle) / 2).toFixed(4);
      defs.push(
        `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
          `<stop offset="0%" stop-color="${escapeXml(layer.gradientFrom)}"/>` +
          `<stop offset="100%" stop-color="${escapeXml(layer.gradientTo)}"/>` +
          `</linearGradient>`,
      );
      return `url(#${id})`;
    }
    return escapeXml(layer.fill || '#6366f1');
  };

  const shadowFilter = (layer: BrandLayer, index: number): string => {
    if (!layer.shadow) return '';
    const id = `shadow_${index}`;
    defs.push(
      `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%">` +
        `<feDropShadow dx="${layer.shadowX ?? 0}" dy="${layer.shadowY ?? 4}" stdDeviation="${layer.shadowBlur ?? 6}" flood-color="${escapeXml(layer.shadowColor || '#000000')}" flood-opacity="0.45"/>` +
        `</filter>`,
    );
    return ` filter="url(#${id})"`;
  };

  const strokeAttrs = (layer: BrandLayer): string =>
    layer.strokeColor && (layer.strokeWidth ?? 0) > 0
      ? ` stroke="${escapeXml(layer.strokeColor)}" stroke-width="${layer.strokeWidth}"`
      : '';

  const applyTransform = (text: string, transform?: BrandLayer['textTransform']): string => {
    if (transform === 'uppercase') return text.toUpperCase();
    if (transform === 'lowercase') return text.toLowerCase();
    if (transform === 'capitalize') {
      return text.replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
    }
    return text;
  };

  const layerEls = await Promise.all(layers.map(async (layer, index) => {
    if (layer.hidden) return '';
    const opacity = Math.max(0, Math.min(100, layer.opacity ?? 100)) / 100;
    const centerX = layer.x + layer.w / 2;
    const centerY = layer.y + layer.h / 2;
    const transform = layer.rotation
      ? ` transform="rotate(${layer.rotation} ${centerX} ${centerY})"`
      : '';
    const openGroup = `<g opacity="${opacity}"${transform}>`;
    const closeGroup = '</g>';

    if (layer.type === 'rect' || layer.type === 'ellipse') {
      const paint = shapePaint(layer, index);
      const filter = shadowFilter(layer, index);
      if (layer.type === 'ellipse') {
        return `${openGroup}<ellipse cx="${centerX}" cy="${centerY}" rx="${layer.w / 2}" ry="${layer.h / 2}" fill="${paint}"${strokeAttrs(layer)}${filter}/>${closeGroup}`;
      }
      const rx = layer.radius ? ` rx="${layer.radius}"` : '';
      return `${openGroup}<rect x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}"${rx} fill="${paint}"${strokeAttrs(layer)}${filter}/>${closeGroup}`;
    }
    if (layer.type === 'image') {
      const src = isLayerDynamic(layer)
        ? (layer.slot ? slots[layer.slot] : '') || layer.src || ''
        : layer.src || '';
      if (!src) return '';
      const href = await resolveImageHrefForSvg(src);
      const fit = layer.imageFit === 'contain' ? 'meet' : 'slice';
      const filter = shadowFilter(layer, index);
      let clip = '';
      if (layer.radius) {
        const clipId = `clip_${index}`;
        defs.push(
          `<clipPath id="${clipId}"><rect x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}" rx="${layer.radius}"/></clipPath>`,
        );
        clip = ` clip-path="url(#${clipId})"`;
      }
      return `${openGroup}<image href="${escapeXml(href)}" x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}" preserveAspectRatio="xMidYMid ${fit}"${clip}${filter}/>${closeGroup}`;
    }
    if (layer.type === 'text') {
      // Static layers never take AI slots
      const raw = !isLayerDynamic(layer)
        ? (layer.text ?? '')
        : (layer.slot && slots[layer.slot] != null ? slots[layer.slot] : null) ??
          layer.text ??
          '';
      const textFit = layer.textFit || 'fit';
      // Prefer explicit multi-line JSON contracts when present; otherwise layout to the box.
      const structured = isLayerDynamic(layer)
        ? resolveSlotLines(String(raw), layer.lineCount)
        : [];
      const useStructured =
        structured.length > 0 &&
        Boolean(layer.lineCount || layer.fillType === 'json') &&
        textFit !== 'wrap';

      let lines: string[];
      let fontSize: number;
      if (useStructured && textFit === 'single_line') {
        lines = [structured.filter(Boolean).join(' ') || String(raw)];
        const laid = layoutTextInBox(lines[0] || '', layer, 'single_line');
        lines = laid.lines.map((line) => applyTransform(line, layer.textTransform));
        fontSize = laid.fontSize;
      } else if (useStructured && textFit === 'fit') {
        // Keep author-intended line breaks when they already fit; otherwise re-layout
        // into the box (may wrap past lineCount so long headlines are not side-cropped).
        lines = structured.map((line) => applyTransform(line, layer.textTransform));
        const lineHeightRatio = layer.lineHeight && layer.lineHeight > 0 ? layer.lineHeight : 1.25;
        const boxW = Math.max(24, layer.w * 0.96);
        const boxH = Math.max(16, layer.h);
        const configuredFontSize = Math.max(8, layer.fontSize || 36);
        fontSize = configuredFontSize;
        for (; fontSize >= Math.max(8, configuredFontSize * 0.72); fontSize -= 0.5) {
          const factor = estimateCharWidthFactor({ ...layer, fontSize });
          const longest = Math.max(1, ...lines.map((l) => l.length));
          const widthOk = longest * factor * fontSize <= boxW + 0.5;
          const heightOk = lines.length * fontSize * lineHeightRatio <= boxH + 0.5;
          if (widthOk && heightOk) break;
        }
        fontSize = Math.round(Math.max(8, fontSize) * 10) / 10;
        const factor = estimateCharWidthFactor({ ...layer, fontSize });
        const longest = Math.max(1, ...lines.map((l) => l.length));
        const stillWide = longest * factor * fontSize > boxW;
        const tooSmall = fontSize < configuredFontSize * 0.72;
        if (stillWide || tooSmall) {
          const laid = layoutTextInBox(structured.filter(Boolean).join(' ') || String(raw), {
            ...layer,
            // Allow wrapping when a forced single line would become unreadably small
            lineCount: Math.max(
              layer.lineCount || 1,
              Math.min(4, Math.max(1, Math.floor(boxH / (configuredFontSize * 0.9 * lineHeightRatio)))),
            ),
          }, 'fit');
          lines = laid.lines.map((line) => applyTransform(line, layer.textTransform));
          fontSize = laid.fontSize;
        }
      } else {
        const laid = layoutTextInBox(String(raw), layer, textFit);
        lines = laid.lines.map((line) => applyTransform(line, layer.textTransform));
        fontSize = laid.fontSize;
      }

      const lineHeightRatio = layer.lineHeight && layer.lineHeight > 0 ? layer.lineHeight : 1.25;
      const anchor =
        layer.align === 'center' ? 'middle' : layer.align === 'right' ? 'end' : 'start';
      const tx =
        layer.align === 'center'
          ? layer.x + layer.w / 2
          : layer.align === 'right'
            ? layer.x + layer.w
            : layer.x;
      const lineHeight = fontSize * lineHeightRatio;
      const blockHeight = lines.length * lineHeight;
      const valign = layer.valign || 'top';
      const blockTop =
        valign === 'middle'
          ? layer.y + (layer.h - blockHeight) / 2
          : valign === 'bottom'
            ? layer.y + layer.h - blockHeight
            : layer.y;
      const startY = blockTop + fontSize;
      const tspans = lines
        .map(
          (line, i) =>
            `<tspan x="${tx}" y="${startY + i * lineHeight}">${escapeXml(line)}</tspan>`,
        )
        .join('');

      let highlightEl = '';
      if (layer.highlight) {
        const pad = layer.highlightPadding ?? Math.round(fontSize * 0.25);
        highlightEl =
          `<rect x="${layer.x - pad}" y="${blockTop - pad}" width="${layer.w + pad * 2}" height="${blockHeight + pad * 2}"` +
          (layer.highlightRadius ? ` rx="${layer.highlightRadius}"` : '') +
          ` fill="${escapeXml(layer.highlight)}"/>`;
      }

      const outline =
        layer.textStrokeColor && (layer.textStrokeWidth ?? 0) > 0
          ? ` stroke="${escapeXml(layer.textStrokeColor)}" stroke-width="${layer.textStrokeWidth}" paint-order="stroke"`
          : '';
      const spacing = layer.letterSpacing ? ` letter-spacing="${layer.letterSpacing}"` : '';
      const style = layer.fontStyle === 'italic' ? ' font-style="italic"' : '';
      const filter = shadowFilter(layer, index);
      // Clip to layer box so any residual overflow never crops past the frame
      const clipId = `text_clip_${index}`;
      defs.push(
        `<clipPath id="${clipId}"><rect x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}"/></clipPath>`,
      );

      return `${openGroup}<g clip-path="url(#${clipId})">${highlightEl}<text font-family="${escapeXml(layer.fontFamily || 'system-ui,Segoe UI,sans-serif')}" font-size="${fontSize}" font-weight="${layer.fontWeight || '600'}" fill="${escapeXml(layer.color || '#ffffff')}" text-anchor="${anchor}"${spacing}${style}${outline}${filter}>${tspans}</text></g>${closeGroup}`;
    }
    return '';
  }));

  const defsBlock = defs.length ? `<defs>${defs.join('')}</defs>` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
${defsBlock}
${bgEl}
${layerEls.join('\n')}
</svg>`;
}

export async function saveRenderedSvg(
  tenantId: string,
  svg: string,
  filenamePrefix = 'brand',
): Promise<{ filePath: string; publicUrl: string }> {
  const dir = path.resolve(config.UPLOAD_DIR, tenantId, 'brand-renders');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${filenamePrefix}-${Date.now()}.svg`;
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, svg, 'utf8');
  const publicUrl = `/uploads/${tenantId}/brand-renders/${name}`;
  return { filePath, publicUrl };
}

export async function renderWithPlacid(opts: {
  templateId: string;
  layers: Record<string, { text?: string; image?: string }>;
  apiKey: string;
  width?: number | null;
  height?: number | null;
}): Promise<string> {
  const { renderPlacidImage } = await import('./placid.client');
  return renderPlacidImage({
    apiKey: opts.apiKey,
    templateUuid: opts.templateId,
    layers: opts.layers,
    quality: 'high',
    width: opts.width,
    height: opts.height,
  });
}
