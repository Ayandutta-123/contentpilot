/** Template slot helpers — AI only fills {{slot}} zones; everything else stays static. */

const SLOT_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function extractSlotsFromTemplate(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(SLOT_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    found.add(m[1]);
  }
  return [...found];
}

export function parseFillZones(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

export function applyTemplateSlots(
  template: string,
  slots: Record<string, string>,
): string {
  return template.replace(SLOT_RE, (_full, key: string) => {
    if (Object.prototype.hasOwnProperty.call(slots, key)) {
      return slots[key] ?? '';
    }
    // Leave unknown slots as-is so static/missing areas stay visible for review
    return `{{${key}}}`;
  });
}
