/**
 * Placid REST API client — exact Creative Automation flow.
 * Design happens in Placid's editor; we only sync dynamic layers and fill them.
 * Docs: https://placid.app/docs/2.0/rest/templates
 *       https://placid.app/docs/2.0/rest/generate-images
 *       https://placid.app/docs/2.0/rest/layers
 */

import { storeOriginalImage } from '../../lib/store-upload';
import {
  buildProviderCreditAlert,
  isCreditFailureText,
  ProviderCreditError,
  type CreditJob,
} from '../../lib/provider-credits';

/**
 * Throw ProviderCreditError when Placid refuses for billing / subscription.
 * Auth failures stay plain Errors so the UI can ask for a fresh token.
 */
async function assertPlacidResponseOk(
  res: Response,
  action: string,
  job: CreditJob = 'generation',
): Promise<void> {
  if (res.ok) return;
  const body = (await res.text()).slice(0, 500);
  if (isCreditFailureText(body, res.status)) {
    throw new ProviderCreditError(buildProviderCreditAlert('placid', job));
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'Design library rejected this API token. Copy a fresh token and save it again in Brand Studio or Settings → Integrations.',
    );
  }
  throw new Error(`Placid ${action} failed (${res.status}): ${body.slice(0, 300)}`);
}

export type PlacidLayerType =
  | 'text'
  | 'picture'
  | 'rectangle'
  | 'browserframe'
  | 'barcode'
  | 'rating'
  | 'ellipse'
  | 'shape'
  | string;

export type PlacidLayerMeta = {
  name: string;
  type: PlacidLayerType;
};

export type PlacidTemplate = {
  uuid: string;
  title: string;
  thumbnail?: string | null;
  width?: number | null;
  height?: number | null;
  tags?: string[];
  layers: PlacidLayerMeta[];
};

type PlacidTemplatesListResponse = {
  data?: Array<
    PlacidTemplate & {
      width?: number | null;
      height?: number | null;
    }
  >;
  links?: { next?: string | null };
};

/**
 * Placid catalog thumbnails are often Spatie “image-thumbnail” conversions
 * (small/lossy). Prefer the parent original media URL when present.
 */
export function upgradePlacidPreviewUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const candidates: string[] = [];
  const push = (u: string) => {
    if (u && !candidates.includes(u)) candidates.push(u);
  };
  push(trimmed);

  // …/conversions/image-thumbnail.png → …/image.png (common Spatie pattern)
  push(
    trimmed.replace(
      /\/conversions\/(?:image-)?thumbnail(?:-(?:sm|md|lg|thumb))?\.(png|jpe?g|webp)$/i,
      '/image.$1',
    ),
  );
  // …/conversions/foo-thumbnail.jpg → …/foo.jpg
  push(trimmed.replace(/\/conversions\/(.+)-thumbnail\.(png|jpe?g|webp)$/i, '/$1.$2'));
  // Drop /conversions/ segment: …/conversions/file.png → …/file.png
  push(trimmed.replace(/\/conversions\//i, '/'));
  // Strip query size params
  push(
    trimmed
      .replace(/([?&])(w|h|width|height|fit|q|quality)=\d+/gi, '$1')
      .replace(/[?&]$/, '')
      .replace(/\?&/, '?')
      .replace(/\?$/, ''),
  );

  // Prefer non-conversion / non-thumbnail first
  const preferred =
    candidates.find((c) => !/\/conversions\//i.test(c) && !/thumbnail/i.test(c)) ||
    candidates.find((c) => !/\/conversions\//i.test(c)) ||
    candidates[0];
  return preferred || trimmed;
}

function normalizePlacidTemplate(t: PlacidTemplate & { width?: number | null; height?: number | null }): PlacidTemplate {
  return {
    uuid: t.uuid,
    title: t.title,
    thumbnail: upgradePlacidPreviewUrl(t.thumbnail) ?? t.thumbnail ?? null,
    width: typeof t.width === 'number' && t.width > 0 ? t.width : null,
    height: typeof t.height === 'number' && t.height > 0 ? t.height : null,
    tags: t.tags || [],
    layers: (t.layers || []).map((l) => ({ name: l.name, type: l.type })),
  };
}

function normalizePlacidToken(apiKey: string): string {
  // Headers must be Latin-1 ByteStrings — strip accidental UI paste junk
  const token = apiKey
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[→←⇒⇐]/g, '')
    .replace(/\s+/g, '');
  if (!token) {
    throw new Error('Design-library API token is empty. Paste the token from Settings → Integrations.');
  }
  if ([...token].some((ch) => ch.charCodeAt(0) > 255)) {
    throw new Error(
      'Design-library API token has invalid characters. Re-paste only the token in Brand Studio or Settings → Integrations.',
    );
  }
  return token;
}

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${normalizePlacidToken(apiKey)}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function authBearerOnly(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${normalizePlacidToken(apiKey)}`,
    Accept: 'application/json',
  };
}

/**
 * Upload a local/binary image to Placid temporary storage so picture layers
 * can use a URL Placid's servers can fetch (localhost /uploads will not work).
 * Docs: https://placid.app/docs/2.0/rest/media
 */
export async function uploadPlacidMedia(opts: {
  apiKey: string;
  buffer: Buffer;
  filename: string;
  mimetype?: string;
}): Promise<string> {
  const form = new FormData();
  const type = opts.mimetype || 'image/jpeg';
  const blob = new Blob([new Uint8Array(opts.buffer)], { type });
  form.append('file', blob, opts.filename || 'image.jpg');

  const res = await fetch('https://api.placid.app/api/rest/media', {
    method: 'POST',
    headers: authBearerOnly(opts.apiKey),
    body: form,
  });
  if (!res.ok) {
    await assertPlacidResponseOk(res, 'media upload', 'image');
  }
  const data = (await res.json()) as {
    media?: Array<{ file_key?: string; file_id?: string }>;
  };
  const url = data.media?.find((m) => m.file_id)?.file_id?.trim();
  if (!url || !/^https:\/\//i.test(url)) {
    throw new Error('Placid media upload returned no file URL');
  }
  return url;
}

export async function listPlacidTemplates(apiKey: string): Promise<PlacidTemplate[]> {
  const out: PlacidTemplate[] = [];
  let url: string | null = 'https://api.placid.app/api/rest/templates';

  while (url) {
    let res: Response;
    try {
      res = await fetch(url, { headers: authHeaders(apiKey) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/ByteString|8594|greater than 255/i.test(msg)) {
        throw new Error(
          'Design-library token is invalid. Delete it and paste only the API token from Settings → Integrations.',
        );
      }
      throw new Error(`Could not reach design library: ${msg}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'Design library rejected this API token. Copy a fresh token and save it again in Brand Studio or Settings → Integrations.',
      );
    }
    if (!res.ok) {
      await assertPlacidResponseOk(res, 'list templates', 'generation');
    }
    const body = (await res.json()) as PlacidTemplatesListResponse;
    for (const t of body.data || []) {
      out.push(normalizePlacidTemplate(t));
    }
    url = body.links?.next || null;
    if (out.length > 200) break;
  }
  return out;
}

export async function getPlacidTemplate(apiKey: string, templateUuid: string): Promise<PlacidTemplate> {
  const uuid = templateUuid.trim();
  let res: Response;
  try {
    res = await fetch(`https://api.placid.app/api/rest/templates/${encodeURIComponent(uuid)}`, {
      headers: authHeaders(apiKey),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ByteString|8594|greater than 255/i.test(msg)) {
      throw new Error(
        'Design-library token is invalid. Delete it and paste only the API token from Settings → Integrations.',
      );
    }
    throw new Error(`Could not reach design library: ${msg}`);
  }
  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    if (isCreditFailureText(body, res.status)) {
      throw new ProviderCreditError(buildProviderCreditAlert('placid', 'generation'));
    }
    if (res.status === 404) {
      // Placid occasionally lists a template in the project catalog while its
      // single-template endpoint returns 404. The catalog payload already
      // contains the title, thumbnail and dynamic layers we need, so use that
      // authoritative project-scoped result instead of blocking import/sync.
      const catalog = await listPlacidTemplates(apiKey);
      const catalogTemplate = catalog.find((template) => template.uuid.trim() === uuid);
      if (catalogTemplate) return catalogTemplate;

      const available = catalog
        .slice(0, 8)
        .map((t) => `“${t.title}” (${t.uuid})`)
        .join(', ');
      throw new Error(
        `Design library could not find template “${uuid}” for this API token (404). ` +
          (available
            ? `Templates available in this project: ${available}. `
            : 'This design project has no templates yet. ') +
          'Open the design library in the same project as your token, copy a live template UUID from the catalog, then import again. ' +
          'Deleted or other-project templates cannot be imported.',
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'Design library rejected this API token. Copy a fresh token and save it again in Brand Studio or Settings → Integrations.',
      );
    }
    throw new Error(`Design library get template failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const raw = (await res.json()) as PlacidTemplate | { data: PlacidTemplate };
  const t = 'data' in raw && raw.data && !('uuid' in raw) ? raw.data : (raw as PlacidTemplate);
  if (!t?.uuid) {
    const nested = (raw as { data?: PlacidTemplate }).data;
    if (nested?.uuid) return normalizePlacidTemplate(nested);
    throw new Error('Design library returned no template');
  }
  return normalizePlacidTemplate(t);
}

/**
 * Map Placid dynamic layer list → Brand Studio canvas layers.
 * Only dynamic layers are returned by Placid's templates API — static stay locked in Placid.
 */
export function placidLayersToCanvas(opts: {
  placid: PlacidTemplate;
  companyName?: string;
}): {
  width: number;
  height: number;
  postType: 'placid';
  designSource: 'placid';
  backgroundMode: 'static';
  layers: Array<Record<string, unknown>>;
} {
  const layers = opts.placid.layers.map((l, i) => {
    const isPicture = l.type === 'picture' || l.type === 'browserframe';
    const y = 120 + i * 100;
    const name = l.name;
    const lower = name.toLowerCase().replace(/[\s-]+/g, '_');
    let fillType: string = isPicture ? 'image_url' : 'custom_text';
    let fillHint = isPicture
      ? `Picture layer "${name}" — supply image URL only; the template sizes and places it`
      : `Text layer "${name}" — fill text only; do not redesign layout`;
    if (!isPicture) {
      if (/(^|_)(title|headline|heading)(_|$)/.test(lower)) {
        fillType = 'headline';
        fillHint = 'Short punchy headline (text only)';
      } else if (/(subheadline|subtitle|subtext|tagline)/.test(lower)) {
        fillType = 'subheadline';
        fillHint = 'One supporting sentence (text only)';
      } else if (/(cta|call_to_action)/.test(lower)) {
        fillType = 'cta';
        fillHint = 'Short call to action (text only)';
      } else if (/(body|caption|desc)/.test(lower)) {
        fillType = 'body';
        fillHint = 'Short body copy for this zone (text only)';
      } else if (/(offer|promo|deal)/.test(lower)) {
        fillType = 'offer';
        fillHint = 'Offer / promo line (text only)';
      }
    }
    return {
      id: l.name,
      type: isPicture ? 'image' : 'text',
      x: 80,
      y,
      w: 920,
      h: isPicture ? 200 : 80,
      slot: l.name,
      text: isPicture ? undefined : `[${l.name}]`,
      src: '',
      fillMode: 'dynamic',
      editable: true,
      fillType,
      fillHint,
      lineCount: isPicture ? undefined : 1,
      placidType: l.type,
      fontSize: 36,
      fontWeight: '600',
      color: '#f8fafc',
      align: 'center',
    };
  });

  const width =
    typeof opts.placid.width === 'number' && opts.placid.width > 0 ? opts.placid.width : 1080;
  const height =
    typeof opts.placid.height === 'number' && opts.placid.height > 0 ? opts.placid.height : 1080;

  return {
    width,
    height,
    postType: 'placid',
    designSource: 'placid',
    backgroundMode: 'static',
    layers: [
      {
        id: '_placid_note',
        type: 'text',
        x: 40,
        y: 40,
        w: 1000,
        h: 40,
        text: `Imported template: ${opts.placid.title} (${opts.placid.uuid})`,
        fillMode: 'static',
        editable: false,
        fontSize: 18,
        color: '#94a3b8',
      },
      ...layers,
    ],
  };
}

export type PlacidLayerFill = {
  text?: string;
  image?: string;
  hide?: boolean;
};

/**
 * Create image from a Placid template by filling dynamic layers only.
 * Endpoint: POST https://api.placid.app/api/rest/{template_uuid}
 */
export async function renderPlacidImage(opts: {
  apiKey: string;
  templateUuid: string;
  layers: Record<string, PlacidLayerFill>;
  createNow?: boolean;
  /** Prefer png + full template size for crisp previews / exports */
  quality?: 'default' | 'high';
  width?: number | null;
  height?: number | null;
}): Promise<string> {
  const modifications: Record<string, string | number> = {};
  if (opts.quality === 'high') {
    modifications.image_format = 'png';
    if (opts.width && opts.width > 0) modifications.width = Math.round(opts.width);
    if (opts.height && opts.height > 0) modifications.height = Math.round(opts.height);
  }

  const res = await fetch(
    `https://api.placid.app/api/rest/${encodeURIComponent(opts.templateUuid)}`,
    {
      method: 'POST',
      headers: authHeaders(opts.apiKey),
      body: JSON.stringify({
        create_now: opts.createNow !== false,
        layers: opts.layers,
        ...(Object.keys(modifications).length ? { modifications } : {}),
      }),
    },
  );
  if (!res.ok) {
    await assertPlacidResponseOk(res, 'template render', 'image');
  }

  const data = (await res.json()) as {
    image_url?: string | null;
    polling_url?: string | null;
    status?: string;
  };

  if (data.image_url) return data.image_url;

  if (data.polling_url) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch(data.polling_url, { headers: authHeaders(opts.apiKey) });
      const body = (await poll.json()) as {
        image_url?: string | null;
        status?: string;
      };
      if (body.image_url) return body.image_url;
      if (body.status === 'error') throw new Error('Template polling reported error');
      if (body.status === 'finished' && !body.image_url) {
        throw new Error('Template finished without image');
      }
    }
  }

  throw new Error('Template returned no image URL');
}

async function downloadImageBuffer(url: string): Promise<{ buffer: Buffer; mimetype: string; filename: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'image/*,*/*' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
      return null;
    }
    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);
    if (buffer.length < 256) return null;

    let mimetype = contentType.startsWith('image/') ? contentType : 'image/png';
    const pathPart = url.split('?')[0];
    const base = pathPart.split('/').pop() || 'placid-preview.png';
    let filename = base.replace(/[^a-zA-Z0-9._-]+/g, '_');
    if (!/\.(png|jpe?g|webp|gif)$/i.test(filename)) {
      const ext =
        mimetype === 'image/jpeg' ? 'jpg' : mimetype === 'image/webp' ? 'webp' : mimetype === 'image/gif' ? 'gif' : 'png';
      filename = `${filename}.${ext}`;
      if (mimetype === 'application/octet-stream') mimetype = 'image/png';
    }
    return { buffer, mimetype, filename };
  } catch {
    return null;
  }
}

/**
 * Build a high-quality local preview for an imported Placid template.
 * 1) Render full-size PNG via Placid (empty layers = template defaults)
 * 2) Else download upgraded catalog preview (non-thumbnail when possible)
 * 3) Else return remote upgraded URL
 */
export async function cachePlacidHqPreview(opts: {
  apiKey: string;
  tenantId: string;
  placid: PlacidTemplate;
}): Promise<string | null> {
  const { apiKey, tenantId, placid } = opts;
  const uuid = placid.uuid.trim();

  // 1) Full render at template size as PNG
  try {
    const imageUrl = await renderPlacidImage({
      apiKey,
      templateUuid: uuid,
      layers: {},
      quality: 'high',
      width: placid.width ?? 1080,
      height: placid.height ?? 1080,
    });
    const downloaded = await downloadImageBuffer(imageUrl);
    if (downloaded) {
      const stored = await storeOriginalImage({
        tenantId,
        subdir: 'brand-templates',
        buffer: downloaded.buffer,
        originalFilename: `placid-${uuid.slice(0, 8)}-hq.png`,
        mimetype: downloaded.mimetype,
        logLabel: 'placid-hq-preview',
      });
      return stored.publicUrl;
    }
    if (imageUrl) return imageUrl;
  } catch (err) {
    console.warn(
      `[placid] HQ render preview failed for ${uuid}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // 2) Download best available catalog image (upgraded thumbnail → original)
  const remoteCandidates = [
    upgradePlacidPreviewUrl(placid.thumbnail),
    placid.thumbnail,
  ].filter((u): u is string => Boolean(u));

  for (const remote of remoteCandidates) {
    const downloaded = await downloadImageBuffer(remote);
    if (!downloaded) continue;
    try {
      const stored = await storeOriginalImage({
        tenantId,
        subdir: 'brand-templates',
        buffer: downloaded.buffer,
        originalFilename: downloaded.filename || `placid-${uuid.slice(0, 8)}.png`,
        mimetype: downloaded.mimetype,
        logLabel: 'placid-preview',
      });
      return stored.publicUrl;
    } catch (err) {
      console.warn(
        `[placid] store preview failed for ${uuid}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return remoteCandidates[0] || null;
}
