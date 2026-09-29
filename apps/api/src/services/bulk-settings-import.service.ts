import * as XLSX from 'xlsx';

export type BulkTopicRow = {
  name: string;
  searchKeywords: string;
};

export type BulkCompetitorRow = {
  name: string;
  platform: 'instagram' | 'linkedin' | 'facebook' | 'twitter';
  socialUrls: Record<string, string>;
};

const TOPIC_LIMIT = 200;
const COMPETITOR_LIMIT = 100;

const PLATFORM_KEYS = [
  'instagram',
  'facebook',
  'linkedin',
  'twitter',
  'youtube',
  'tiktok',
  'website',
] as const;

function normHeader(h: unknown): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function splitCsvish(text: string): string[] {
  return text
    .split(/[\n\r;]+/)
    .flatMap((line) => line.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
}

function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^(www\.)?(instagram|facebook|linkedin|x|twitter|tiktok|youtube)\./i.test(t)) return true;
  if (/instagram\.com|facebook\.com|linkedin\.com|x\.com|twitter\.com|tiktok\.com|youtube\.com/i.test(t)) {
    return true;
  }
  return false;
}

function ensureUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const url = v.includes('://') ? v : `https://${v}`;
    // eslint-disable-next-line no-new
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

function platformFromUrl(url: string): 'instagram' | 'linkedin' | 'facebook' | 'twitter' | null {
  const u = url.toLowerCase();
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('linkedin.com')) return 'linkedin';
  if (u.includes('facebook.com') || u.includes('fb.com')) return 'facebook';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  return null;
}

function socialKeyFromUrl(url: string): (typeof PLATFORM_KEYS)[number] | null {
  const u = url.toLowerCase();
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('facebook.com') || u.includes('fb.com')) return 'facebook';
  if (u.includes('linkedin.com')) return 'linkedin';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('tiktok.com')) return 'tiktok';
  return 'website';
}

function nameFromUrl(url: string): string {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'company' || parts[0] === 'in' || parts[0] === 'school') {
      return decodeURIComponent(parts[1] || parts[0]).replace(/[-_]/g, ' ');
    }
    const handle = (parts[0] || '').replace(/^@/, '');
    return handle.replace(/[-_]/g, ' ') || u.hostname;
  } catch {
    return 'Competitor';
  }
}

/** Comma / newline / semicolon separated trend keywords → topic rows. */
export function parseTopicsBulkText(text: string): { rows: BulkTopicRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const rows: BulkTopicRow[] = [];

  for (const raw of splitCsvish(text)) {
    const name = raw.replace(/^["']|["']$/g, '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`Skipped duplicate “${name}”.`);
      continue;
    }
    seen.add(key);
    rows.push({ name, searchKeywords: name });
    if (rows.length >= TOPIC_LIMIT) {
      warnings.push(`Stopped at ${TOPIC_LIMIT} topics.`);
      break;
    }
  }

  return { rows, warnings };
}

export function parseTopicsBulkWorkbook(buffer: Buffer): { rows: BulkTopicRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], warnings: ['Workbook has no sheets.'] };

  const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown as Array<Array<string | number | null>>;

  if (!matrix.length) return { rows: [], warnings: ['Sheet is empty.'] };

  const header = (matrix[0] || []).map(normHeader);
  const hasHeader =
    header.includes('name') ||
    header.includes('topic') ||
    header.includes('keyword') ||
    header.includes('keywords') ||
    header.includes('searchkeywords');

  let nameIdx = 0;
  let kwIdx = -1;
  let start = 0;
  if (hasHeader) {
    nameIdx = Math.max(
      0,
      header.findIndex((h) => ['name', 'topic', 'keyword', 'keywords'].includes(h)),
    );
    kwIdx = header.findIndex((h) => ['searchkeywords', 'keywords', 'search', 'terms'].includes(h));
    if (kwIdx === nameIdx) kwIdx = header.findIndex((h, i) => i !== nameIdx && ['searchkeywords', 'keywords', 'search', 'terms'].includes(h));
    start = 1;
  }

  const seen = new Set<string>();
  const rows: BulkTopicRow[] = [];
  for (let r = start; r < matrix.length; r++) {
    const line = matrix[r] || [];
    const name = String(line[nameIdx] ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) {
      warnings.push(`Skipped duplicate “${name}”.`);
      continue;
    }
    seen.add(key);
    const kw =
      kwIdx >= 0 ? String(line[kwIdx] ?? '').trim() : String(line[1] ?? '').trim();
    rows.push({ name, searchKeywords: kw || name });
    if (rows.length >= TOPIC_LIMIT) {
      warnings.push(`Stopped at ${TOPIC_LIMIT} topics.`);
      break;
    }
  }

  return { rows, warnings };
}

export function buildTopicsBulkTemplateBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['name', 'searchKeywords'],
    ['AI infrastructure', 'AI infra, GPU cloud, LLM ops'],
    ['IoT platforms', 'IoT, edge computing'],
    ['Fintech payments', ''],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Topics');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * Competitor bulk text — one entry per line:
 *   Name, https://instagram.com/brand
 *   Name, instagram, https://instagram.com/brand
 *   Name, https://instagram.com/a, https://linkedin.com/company/a
 * Or comma-separated profile URLs on one/multiple lines (name derived from handle).
 */
export function parseCompetitorsBulkText(text: string): {
  rows: BulkCompetitorRow[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const rows: BulkCompetitorRow[] = [];
  const seen = new Set<string>();

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  // Single-line comma-separated URLs only
  if (lines.length === 1 && lines[0].includes(',') && !looksLikeUrl(lines[0].split(',')[0].trim())) {
    // fall through to per-line parsing
  } else if (lines.length === 1) {
    const parts = lines[0].split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1 && parts.every(looksLikeUrl)) {
      for (const p of parts) {
        const url = ensureUrl(p);
        if (!url) continue;
        const key = url.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const sk = socialKeyFromUrl(url) || 'website';
        const platform = platformFromUrl(url) || 'instagram';
        rows.push({
          name: nameFromUrl(url),
          platform,
          socialUrls: { [sk]: url },
        });
      }
      return { rows: rows.slice(0, COMPETITOR_LIMIT), warnings };
    }
  }

  for (const line of lines) {
    if (rows.length >= COMPETITOR_LIMIT) {
      warnings.push(`Stopped at ${COMPETITOR_LIMIT} competitors.`);
      break;
    }

    // CSV-ish: split commas but keep URLs intact
    const parts = line.split(',').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;

    const platformToken = parts.find((p) =>
      ['instagram', 'linkedin', 'facebook', 'twitter', 'x'].includes(p.toLowerCase()),
    );
    const urlParts = parts.filter((p) => looksLikeUrl(p));
    const nameParts = parts.filter(
      (p) =>
        !looksLikeUrl(p) &&
        !['instagram', 'linkedin', 'facebook', 'twitter', 'x'].includes(p.toLowerCase()),
    );

    if (urlParts.length === 0) {
      warnings.push(`Skipped “${line.slice(0, 60)}” — need at least one profile URL.`);
      continue;
    }

    // Multiple URLs with no name → one competitor per URL
    if (!nameParts.length && urlParts.length > 1) {
      for (const raw of urlParts) {
        if (rows.length >= COMPETITOR_LIMIT) break;
        const url = ensureUrl(raw);
        if (!url) continue;
        const sk = socialKeyFromUrl(url) || 'website';
        const platform = platformFromUrl(url) || 'instagram';
        const name = nameFromUrl(url);
        const dedupeKey = `${name.toLowerCase()}|${url.toLowerCase()}`;
        if (seen.has(dedupeKey) || seen.has(url.toLowerCase())) {
          warnings.push(`Skipped duplicate “${name}”.`);
          continue;
        }
        seen.add(dedupeKey);
        seen.add(url.toLowerCase());
        rows.push({ name, platform, socialUrls: { [sk]: url } });
      }
      continue;
    }

    let platform: BulkCompetitorRow['platform'] = 'instagram';
    if (platformToken) {
      const p = platformToken.toLowerCase();
      platform = (p === 'x' ? 'twitter' : p) as BulkCompetitorRow['platform'];
    }

    const socialUrls: Record<string, string> = {};
    const name = nameParts.join(' ').trim() || nameFromUrl(ensureUrl(urlParts[0]) || urlParts[0]);

    for (const raw of urlParts) {
      const url = ensureUrl(raw);
      if (!url) {
        warnings.push(`Invalid URL skipped: ${raw}`);
        continue;
      }
      const sk = socialKeyFromUrl(url) || 'website';
      socialUrls[sk] = url;
      const detected = platformFromUrl(url);
      if (detected && !platformToken) platform = detected;
    }

    if (!Object.keys(socialUrls).length) {
      warnings.push(`Skipped “${name}” — no valid URLs.`);
      continue;
    }

    const dedupeKey = `${name.toLowerCase()}|${Object.values(socialUrls)[0].toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      warnings.push(`Skipped duplicate “${name}”.`);
      continue;
    }
    seen.add(dedupeKey);
    rows.push({ name, platform, socialUrls });
  }

  return { rows, warnings };
}

export function parseCompetitorsBulkWorkbook(buffer: Buffer): {
  rows: BulkCompetitorRow[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], warnings: ['Workbook has no sheets.'] };

  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
  if (!json.length) {
    // fallback headerless: name, platform, url
    const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as unknown as Array<Array<string | number | null>>;
    const text = matrix
      .map((row) => row.map((c) => String(c ?? '').trim()).filter(Boolean).join(', '))
      .filter(Boolean)
      .join('\n');
    return parseCompetitorsBulkText(text);
  }

  const seen = new Set<string>();
  const rows: BulkCompetitorRow[] = [];

  for (const raw of json) {
    if (rows.length >= COMPETITOR_LIMIT) {
      warnings.push(`Stopped at ${COMPETITOR_LIMIT} competitors.`);
      break;
    }
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      map[normHeader(k)] = String(v ?? '').trim();
    }

    const name = map.name || map.competitor || map.brand || map.company || '';
    const platformRaw = (map.platform || map.primaryplatform || 'instagram').toLowerCase();
    let platform: BulkCompetitorRow['platform'] =
      platformRaw === 'x' ? 'twitter' : (platformRaw as BulkCompetitorRow['platform']);
    if (!['instagram', 'linkedin', 'facebook', 'twitter'].includes(platform)) {
      platform = 'instagram';
    }

    const socialUrls: Record<string, string> = {};
    for (const key of PLATFORM_KEYS) {
      const val = map[key] || map[`${key}url`] || map[`${key}profile`];
      if (!val) continue;
      const url = ensureUrl(val);
      if (url) socialUrls[key] = url;
    }

    // Generic url / profileurl column
    const generic = map.url || map.profileurl || map.profile || map.link;
    if (generic) {
      const url = ensureUrl(generic);
      if (url) {
        const sk = socialKeyFromUrl(url) || 'website';
        if (!socialUrls[sk]) socialUrls[sk] = url;
        const detected = platformFromUrl(url);
        if (detected) platform = detected;
      }
    }

    if (!name && !Object.keys(socialUrls).length) continue;
    if (!Object.keys(socialUrls).length) {
      warnings.push(`Skipped “${name || 'row'}” — need at least one profile URL.`);
      continue;
    }

    const finalName = name || nameFromUrl(Object.values(socialUrls)[0]);
    const dedupeKey = `${finalName.toLowerCase()}|${Object.values(socialUrls)[0].toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      warnings.push(`Skipped duplicate “${finalName}”.`);
      continue;
    }
    seen.add(dedupeKey);
    rows.push({ name: finalName, platform, socialUrls });
  }

  return { rows, warnings };
}

export function buildCompetitorsBulkTemplateBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['name', 'platform', 'instagram', 'linkedin', 'facebook', 'twitter', 'website'],
    [
      'Acme Cloud',
      'instagram',
      'https://instagram.com/acmecloud',
      'https://linkedin.com/company/acmecloud',
      '',
      '',
      'https://acme.example',
    ],
    ['Beta Labs', 'linkedin', '', 'https://linkedin.com/company/betalabs', '', '', ''],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Competitors');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
