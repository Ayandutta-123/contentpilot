import { randomUUID } from 'crypto';
import * as XLSX from 'xlsx';
import { parseCarouselSlideCount } from '../lib/carousel-parse';

export type CustomPlanEntry = {
  id: string;
  date: string;
  title: string;
  theme: string;
  notes: string;
  hashtags: string[];
  /** Set when theme/format/notes/title ask for a carousel with N slides */
  carouselSlideCount?: number | null;
};

const MAX_ENTRIES = 200;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

function expandTwoDigitYear(yy: number): number {
  return yy >= 70 ? 1900 + yy : 2000 + yy;
}

/** Excel serial day → ISO date (1900 date system). */
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80000) return null;
  // Excel incorrectly treats 1900 as leap year; SheetJS serial aligns with this.
  const utc = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  const d = new Date(utc);
  return toIsoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function parseFlexibleDate(
  raw: unknown,
  fallbackYear: number,
  fallbackMonth?: number,
  requireExplicitYear = false,
): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return toIsoDate(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  }
  if (typeof raw === 'number') {
    return excelSerialToIso(raw);
  }

  const original = String(raw ?? '').trim();
  if (!original) return null;

  if (/^\d+(\.\d+)?$/.test(original)) {
    const n = Number(original);
    if (n > 20000) return excelSerialToIso(n);
  }

  // Strip weekday prefixes: "Tue 08-Sep-26", "Tuesday, 8 Sep 2026"
  let s = original
    .replace(
      /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)[, ]+/i,
      '',
    )
    .trim()
    .replace(/[./]/g, '-');

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) return toIsoDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  // 08-Sep-26 / 8-Sep-2026
  const dMonY = s.match(
    /^(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)-(\d{2}|\d{4})$/i,
  );
  if (dMonY) {
    const month = MONTHS[dMonY[2]!.toLowerCase()];
    const yRaw = Number(dMonY[3]);
    const year = dMonY[3]!.length === 2 ? expandTwoDigitYear(yRaw) : yRaw;
    return month ? toIsoDate(year, month, Number(dMonY[1])) : null;
  }

  // Sep-08-26 / Sep-8-2026
  const monDY = s.match(
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)-(\d{1,2})-(\d{2}|\d{4})$/i,
  );
  if (monDY) {
    const month = MONTHS[monDY[1]!.toLowerCase()];
    const yRaw = Number(monDY[3]);
    const year = monDY[3]!.length === 2 ? expandTwoDigitYear(yRaw) : yRaw;
    return month ? toIsoDate(year, month, Number(monDY[2])) : null;
  }

  const md = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (md && !requireExplicitYear) {
    return toIsoDate(fallbackYear, Number(md[1]), Number(md[2]));
  }

  const named = s.match(
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(\d{2}|\d{4}))?$/i,
  );
  if (named) {
    if (requireExplicitYear && !named[3]) return null;
    const m = MONTHS[named[1]!.toLowerCase()];
    const day = Number(named[2]);
    const year = named[3]
      ? named[3].length === 2
        ? expandTwoDigitYear(Number(named[3]))
        : Number(named[3])
      : fallbackYear;
    return m ? toIsoDate(year, m, day) : null;
  }

  const dNamed = s.match(
    /^(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s*(\d{2}|\d{4}))?$/i,
  );
  if (dNamed) {
    if (requireExplicitYear && !dNamed[3]) return null;
    return parseFlexibleDate(
      `${dNamed[2]} ${dNamed[1]}${dNamed[3] ? ` ${dNamed[3]}` : ''}`,
      fallbackYear,
      fallbackMonth,
      requireExplicitYear,
    );
  }

  if (!requireExplicitYear && fallbackMonth && /^\d{1,2}$/.test(s)) {
    return toIsoDate(fallbackYear, fallbackMonth, Number(s));
  }

  return null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if ((ch === ',' || ch === '\t') && !inQuotes) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseHashtags(raw?: unknown): string[] {
  const s = String(raw ?? '').trim();
  if (!s) return [];
  return s
    .split(/[,#\s]+/)
    .map((t) => t.replace(/^#/, '').trim())
    .filter((t) => t.length >= 2)
    .slice(0, 12);
}

function cellStr(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[_/\\()[\].:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickCol(headers: string[], aliases: string[]): number {
  const lower = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    const exact = lower.findIndex((h) => h === a);
    if (exact >= 0) return exact;
  }
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    if (a.length < 4) continue;
    const described = lower.findIndex((h) => h.startsWith(`${a} `));
    if (described >= 0) return described;
  }
  return -1;
}

function looksLikeHeader(cols: string[]): boolean {
  const joined = cols.map(normalizeHeader).join(' ');
  return (
    joined.includes('date') &&
    (joined.includes('title') ||
      joined.includes('topic') ||
      joined.includes('idea') ||
      joined.includes('theme') ||
      joined.includes('pillar') ||
      joined.includes('hook') ||
      joined.includes('angle'))
  );
}

function makeEntry(partial: {
  date: string;
  title: string;
  theme?: string;
  notes?: string;
  hashtags?: string[];
}): CustomPlanEntry {
  const title = partial.title.trim().slice(0, 180);
  const theme = (partial.theme || '').trim().slice(0, 240);
  const notes = (partial.notes || '').trim().slice(0, 12000);
  return {
    id: `custom-${randomUUID()}`,
    date: partial.date,
    title,
    theme,
    notes,
    hashtags: partial.hashtags || [],
    carouselSlideCount: parseCarouselSlideCount(title, theme, notes),
  };
}

function buildNotes(parts: Array<string | undefined>): string {
  return parts
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 12000);
}

type ColMap = {
  date: number;
  title: number;
  theme: number;
  notes: number;
  hook: number;
  angle: number;
  cta: number;
  tags: number;
  format: number;
};

function mapHeaders(headers: string[]): ColMap {
  return {
    date: pickCol(headers, ['date', 'publish date', 'post date', 'scheduled date']),
    title: pickCol(headers, [
      'working title',
      'title',
      'topic',
      'idea',
      'post',
      'content',
      'headline',
    ]),
    theme: pickCol(headers, ['theme', 'pillar', 'type', 'category']),
    notes: pickCol(headers, ['notes', 'brief', 'description', 'caption', 'body']),
    hook: pickCol(headers, ['opening hook', 'hook', 'opener']),
    angle: pickCol(headers, ['angle / what to actually say', 'angle', 'what to actually say', 'message']),
    cta: pickCol(headers, ['cta', 'call to action', 'call-to-action']),
    tags: pickCol(headers, ['hashtag', 'hashtags', 'tags', 'keywords']),
    format: pickCol(headers, ['format']),
  };
}

function entryFromCols(
  cols: unknown[],
  map: ColMap,
  fallbackYear: number,
  fallbackMonth?: number,
  requireExplicitYear = false,
  headers?: string[],
): CustomPlanEntry | null {
  if (map.date < 0) return null;
  const date = parseFlexibleDate(
    cols[map.date],
    fallbackYear,
    fallbackMonth,
    requireExplicitYear,
  );
  const titleIdx = map.title >= 0 ? map.title : map.date === 0 ? 1 : 0;
  const title = cellStr(cols[titleIdx]);
  if (!date || !title) return null;

  const themeParts = [
    map.theme >= 0 ? cellStr(cols[map.theme]) : '',
    map.format >= 0 ? cellStr(cols[map.format]) : '',
  ].filter(Boolean);

  const mapped = new Set(
    [
      map.date,
      map.title,
      map.theme,
      map.notes,
      map.hook,
      map.angle,
      map.cta,
      map.tags,
      map.format,
    ].filter((index) => index >= 0),
  );
  const extraFields = headers
    ? headers.flatMap((header, index) => {
        const value = cellStr(cols[index]);
        if (!value || mapped.has(index)) return [];
        return [`${header || `Column ${index + 1}`}: ${value}`];
      })
    : [];

  const notes = buildNotes([
    map.hook >= 0 ? (cellStr(cols[map.hook]) ? `Hook: ${cellStr(cols[map.hook])}` : '') : '',
    map.angle >= 0
      ? cellStr(cols[map.angle])
        ? `Angle: ${cellStr(cols[map.angle])}`
        : ''
      : '',
    map.notes >= 0 ? cellStr(cols[map.notes]) : '',
    map.cta >= 0 ? (cellStr(cols[map.cta]) ? `CTA: ${cellStr(cols[map.cta])}` : '') : '',
    ...extraFields,
  ]);

  return makeEntry({
    date,
    title,
    theme: themeParts.join(' · '),
    notes,
    hashtags: map.tags >= 0 ? parseHashtags(cols[map.tags]) : [],
  });
}

function finalize(
  entries: CustomPlanEntry[],
  warnings: string[],
): { entries: CustomPlanEntry[]; warnings: string[] } {
  const seen = new Set<string>();
  const unique: CustomPlanEntry[] = [];
  for (const e of entries) {
    const key = `${e.date}|${e.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
    if (unique.length >= MAX_ENTRIES) {
      warnings.push(`Stopped at ${MAX_ENTRIES} entries (max per batch).`);
      break;
    }
  }
  if (!unique.length && !warnings.length) {
    warnings.push(
      'Could not parse any dated calendar ideas. Use Excel/CSV with date + title columns.',
    );
  }
  return { entries: unique, warnings };
}

/**
 * Parse a pasted or uploaded content-calendar plan into dated entries.
 * Supports CSV/TSV with headers, pipe-separated lines, or "DATE - title" lines.
 */
export function parseCalendarPlanText(
  raw: string,
  opts?: { year?: number; month?: number },
): { entries: CustomPlanEntry[]; warnings: string[] } {
  const fallbackYear = opts?.year || new Date().getFullYear();
  const fallbackMonth = opts?.month;
  const warnings: string[] = [];
  const entries: CustomPlanEntry[] = [];

  const text = (raw || '').replace(/^\uFEFF/, '').trim();
  if (!text) return { entries: [], warnings: ['Paste or upload a plan with dates and topics.'] };

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));

  if (!lines.length) return { entries: [], warnings: ['No usable lines found in the plan.'] };

  const firstCols = splitCsvLine(lines[0]!);
  const isCsv =
    firstCols.length >= 2 &&
    (looksLikeHeader(firstCols) || lines[0]!.includes(',') || lines[0]!.includes('\t'));

  let startIdx = 0;
  let map: ColMap = {
    date: 0,
    title: 1,
    theme: 2,
    notes: 3,
    hook: -1,
    angle: -1,
    cta: -1,
    tags: 4,
    format: -1,
  };

  if (isCsv && looksLikeHeader(firstCols)) {
    startIdx = 1;
    map = mapHeaders(firstCols);
    if (map.title < 0) map.title = map.date === 0 ? 1 : 0;
  }

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i]!;
    let entry: CustomPlanEntry | null = null;

    if (line.includes('|') && (line.match(/\|/g) || []).length >= 1 && !line.includes(',')) {
      const parts = line.split('|').map((p) => p.trim());
      const date = parseFlexibleDate(parts[0] || '', fallbackYear, fallbackMonth);
      if (date && parts[1]) {
        entry = makeEntry({
          date,
          title: parts[1],
          theme: parts[2] || '',
          notes: parts.slice(3).join(' | '),
        });
      }
    } else if (isCsv || line.includes(',') || line.includes('\t')) {
      entry = entryFromCols(
        splitCsvLine(line),
        map,
        fallbackYear,
        fallbackMonth,
        false,
        startIdx === 1 ? firstCols : undefined,
      );
    } else if (line.includes('|')) {
      const parts = line.split('|').map((p) => p.trim());
      const date = parseFlexibleDate(parts[0] || '', fallbackYear, fallbackMonth);
      if (date && parts[1]) {
        entry = makeEntry({
          date,
          title: parts[1],
          theme: parts[2] || '',
          notes: parts.slice(3).join(' | '),
        });
      }
    } else {
      const m =
        line.match(/^(\d{4}-\d{1,2}-\d{1,2})\s+(?:[-–—]\s*)?(.+)$/) ||
        line.match(/^(.+?)\s+[–—-]\s+(.+)$/) ||
        line.match(/^(.+?)[:：]\s*(.+)$/) ||
        line.match(/^(.+?)\s*[–—]\s*(.+)$/);
      if (m) {
        let date = parseFlexibleDate(m[1]!, fallbackYear, fallbackMonth);
        let title = m[2]!.trim();
        if (!date) {
          const flipped = parseFlexibleDate(m[2]!, fallbackYear, fallbackMonth);
          if (flipped) {
            date = flipped;
            title = m[1]!.trim();
          }
        }
        if (date && title) entry = makeEntry({ date, title });
      }
    }

    if (!entry) {
      warnings.push(`Skipped line ${i + 1}: need a date and title.`);
      continue;
    }
    entries.push(entry);
  }

  return finalize(entries, warnings);
}

/** Parse .xlsx / .xls workbook buffer into calendar entries. */
export function parseCalendarPlanWorkbook(
  buffer: Buffer,
  opts?: { year?: number; month?: number },
): { entries: CustomPlanEntry[]; warnings: string[]; sheetName?: string } {
  const fallbackYear = opts?.year || new Date().getFullYear();
  const fallbackMonth = opts?.month;
  const warnings: string[] = [];

  let wb: XLSX.WorkBook;
  try {
    // Keep native Excel dates as timezone-free serial numbers. Converting them
    // to JS Date here can move the calendar day backward/forward by timezone.
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: false, raw: true });
  } catch {
    return { entries: [], warnings: ['Could not read that Excel file. Save as .xlsx and try again.'] };
  }

  const entries: CustomPlanEntry[] = [];
  const parsedSheets: string[] = [];

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
      header: 1,
      defval: '',
      raw: true,
      blankrows: true,
    });
    if (!matrix.length) continue;

    // Real-world workbooks often put a title or instructions above the table.
    const headerIndex = matrix
      .slice(0, 30)
      .findIndex((row) => looksLikeHeader((row || []).map((c) => cellStr(c))));
    if (headerIndex < 0) {
      warnings.push(`Skipped sheet "${sheetName}": no date + title header row found.`);
      continue;
    }

    const headers = (matrix[headerIndex] || []).map((c) => cellStr(c));
    const map = mapHeaders(headers);
    if (map.date < 0 || map.title < 0) {
      warnings.push(`Skipped sheet "${sheetName}": exact date and title columns are required.`);
      continue;
    }

    parsedSheets.push(sheetName);
    for (let i = headerIndex + 1; i < matrix.length; i++) {
      const row = matrix[i] || [];
      if (!row.some((c) => cellStr(c))) continue;
      const rawDate = cellStr(row[map.date]);
      const rawTitle = cellStr(row[map.title]);
      const entry = entryFromCols(row, map, fallbackYear, fallbackMonth, true, headers);
      if (!entry) {
        warnings.push(
          `Skipped ${sheetName} row ${i + 1}: ${!rawDate ? 'date is empty' : !rawTitle ? 'title is empty' : 'date must include an exact year'}.`,
        );
        continue;
      }
      entries.push(entry);
    }
  }

  if (!parsedSheets.length && !warnings.length) {
    warnings.push('No usable calendar sheet found.');
  }
  return {
    ...finalize(entries, warnings),
    sheetName: parsedSheets.join(', ') || undefined,
  };
}

export function filterPlanForMonth(
  entries: CustomPlanEntry[],
  year: number,
  month: number,
): CustomPlanEntry[] {
  const prefix = `${year}-${pad(month)}-`;
  return entries.filter((e) => e.date.startsWith(prefix));
}

/** Downloadable Excel template matching the supported column layout. */
export function buildCalendarPlanTemplateBuffer(opts?: {
  year?: number;
  month?: number;
}): Buffer {
  const year = opts?.year || new Date().getFullYear();
  const month = opts?.month || new Date().getMonth() + 1;
  const d1 = `${year}-${pad(month)}-05`;
  const d2 = `${year}-${pad(month)}-12`;

  const rows = [
    ['date', 'title', 'theme', 'notes', 'hashtags', 'opening hook', 'angle', 'cta', 'format'],
    [
      d1,
      'What we actually mean when we say native AI',
      'P1 Thesis & Market POV',
      '',
      'AI, NativeAI, B2B',
      "Most decks we open say 'AI-powered'. Almost none of them are.",
      'Explain native AI vs bolted-on AI with 3 anonymised pipeline examples.',
      "Comment 'ROOM' and I'll send the template",
      'Article (Newsletter)',
    ],
    [
      d2,
      'The 20-minute diligence room',
      'P3 Operator Playbook',
      '',
      'Diligence, Playbook',
      'A clean room layout makes diligence faster than another slide deck.',
      'Show left vs right room layout and what partners check first.',
      "Comment 'ROOM'",
      'Carousel (9 slides)',
    ],
  ];

  return workbookFromRows(rows);
}

/** Export a filled plan workbook from draft/saved calendar entries. */
export function buildCalendarPlanExportBuffer(
  entries: Array<{
    date: string;
    title: string;
    theme?: string;
    notes?: string;
    hashtags?: string[];
    carouselSlideCount?: number | null;
  }>,
): Buffer {
  const rows: string[][] = [
    ['date', 'title', 'theme', 'notes', 'hashtags', 'opening hook', 'angle', 'cta', 'format'],
  ];
  for (const e of entries) {
    const format = e.carouselSlideCount
      ? `Carousel (${e.carouselSlideCount} slides)`
      : /carousel/i.test(e.notes || '')
        ? 'Carousel'
        : 'Single image';
    rows.push([
      e.date,
      e.title,
      e.theme || '',
      e.notes || '',
      (e.hashtags || []).join(', '),
      '',
      '',
      '',
      format,
    ]);
  }
  if (rows.length === 1) {
    rows.push(['', '', '', '', '', '', '', '', '']);
  }
  return workbookFromRows(rows);
}

function workbookFromRows(rows: (string | number)[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 12 },
    { wch: 42 },
    { wch: 24 },
    { wch: 36 },
    { wch: 18 },
    { wch: 28 },
    { wch: 28 },
    { wch: 22 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Content Calendar');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
