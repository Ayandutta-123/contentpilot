export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String);
}

/**
 * Parse LLM JSON that may be truncated mid-string / mid-array.
 * Prefers a full JSON.parse; otherwise recovers complete objects from an "entries" array.
 */
export function parseJsonObjectLenient(raw: string): Record<string, unknown> {
  const cleaned = raw
    .replace(/^\uFEFF/, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through to repair */
  }

  const repaired = repairTruncatedJsonObject(cleaned);
  if (repaired) return repaired;

  throw new Error('Unterminated or invalid JSON from text model');
}

function repairTruncatedJsonObject(text: string): Record<string, unknown> | null {
  let s = text.trim();
  if (!s.startsWith('{')) {
    const start = s.indexOf('{');
    if (start < 0) return null;
    s = s.slice(start);
  }

  const closeString = (input: string): string => {
    let inStr = false;
    let esc = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i]!;
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === '\\') {
          esc = true;
          continue;
        }
        if (ch === '"') inStr = false;
      } else if (ch === '"') {
        inStr = true;
      }
    }
    return inStr ? `${input}"` : input;
  };

  const candidates: string[] = [];
  let base = closeString(s).replace(/,\s*$/, '');

  const openBraces = (base.match(/{/g) || []).length;
  const closeBraces = (base.match(/}/g) || []).length;
  const openBrackets = (base.match(/\[/g) || []).length;
  const closeBrackets = (base.match(/]/g) || []).length;

  let fixed = base;
  for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += ']';
  for (let i = 0; i < openBraces - closeBraces; i++) fixed += '}';
  candidates.push(fixed);

  // Recover complete entry objects even when the array/string was cut mid-way
  const entriesIdx = s.indexOf('"entries"');
  if (entriesIdx >= 0) {
    const arrStart = s.indexOf('[', entriesIdx);
    if (arrStart >= 0) {
      const objects: string[] = [];
      let depth = 0;
      let objStart = -1;
      let inStr = false;
      let esc = false;
      for (let i = arrStart + 1; i < s.length; i++) {
        const ch = s[i]!;
        if (inStr) {
          if (esc) {
            esc = false;
            continue;
          }
          if (ch === '\\') {
            esc = true;
            continue;
          }
          if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') {
          inStr = true;
          continue;
        }
        if (ch === '{') {
          if (depth === 0) objStart = i;
          depth += 1;
        } else if (ch === '}') {
          depth -= 1;
          if (depth === 0 && objStart >= 0) {
            objects.push(s.slice(objStart, i + 1));
            objStart = -1;
          }
        } else if (ch === ']' && depth === 0) {
          break;
        }
      }
      if (objects.length > 0) {
        const summaryMatch = s.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/);
        const summary = summaryMatch
          ? summaryMatch[1]
          : `Recovered ${objects.length} calendar ideas`;
        const entries = objects
          .map((o) => {
            try {
              return JSON.parse(o);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
        candidates.push(JSON.stringify({ summary, entries }));
      }
    }
  }

  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}
