import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { resolveProviders } from './providers.service';
import {
  ProviderCreditError,
  buildProviderCreditAlert,
  isCreditFailureText,
  type CreditTool,
} from '../lib/provider-credits';

const MAX_EXTRACT_CHARS = 12000;

const IMAGE_CONTENT_PROMPT = `You are helping build a social media carousel from this attached image (ChatGPT/Claude style).

Extract ALL useful content for writing carousel slides. Return plain text (not JSON) covering:
- Any readable headlines, body copy, stats, prices, dates, CTAs, product names
- Key claims and proof points visible in the image
- Suggested slide outline if the image is itself a multi-panel / tip list
- Visual subject only if there is little readable text (what the photo shows)

Be factual. Do NOT invent offers, stats, or brand claims that are not visible.
Keep it under 800 words.`;

function throwVisionFailure(tool: CreditTool, label: string, status: number, errText: string): never {
  if (isCreditFailureText(`${errText} ${tool}`, status)) {
    throw new ProviderCreditError(buildProviderCreditAlert(tool, 'caption'));
  }
  throw new Error(`${label} (${status}): ${errText.slice(0, 240)}`);
}

function truncate(text: string, max = MAX_EXTRACT_CHARS): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

async function visionDescribeImage(tenantId: string, mime: string, buffer: Buffer): Promise<string> {
  const providers = await resolveProviders(tenantId);
  const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;

  if (providers.llmProvider === 'claude' && providers.claudeApiKey) {
    return visionClaude(providers.claudeApiKey, providers.llmModel, dataUri);
  }
  if (providers.openaiApiKey) {
    return visionOpenAI(providers.openaiApiKey, dataUri);
  }
  if (providers.claudeApiKey) {
    return visionClaude(
      providers.claudeApiKey,
      providers.llmModel || 'claude-sonnet-4-20250514',
      dataUri,
    );
  }
  throw new Error(
    'No text-model API key available to read images. Add OpenAI or Claude in Settings → Integrations.',
  );
}

async function visionOpenAI(apiKey: string, dataUri: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: IMAGE_CONTENT_PROMPT },
            { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throwVisionFailure('openai', 'Image parse failed', res.status, await res.text());
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Image parse returned empty');
  return text;
}

async function visionClaude(apiKey: string, model: string, dataUri: string): Promise<string> {
  const m = dataUri.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid image data');
  const mediaType = m[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model.includes('claude') ? model : 'claude-sonnet-4-20250514',
      max_tokens: 1200,
      temperature: 0.2,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: m[2] },
            },
            { type: 'text', text: IMAGE_CONTENT_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    throwVisionFailure('claude', 'Image parse failed', res.status, await res.text());
  }
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = data.content?.find((c) => c.type === 'text')?.text?.trim();
  if (!text) throw new Error('Image parse returned empty');
  return text;
}

function extractSpreadsheet(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const parts: string[] = [];
  for (const name of wb.SheetNames.slice(0, 6)) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet);
    if (csv.trim()) parts.push(`Sheet “${name}”:\n${csv.trim()}`);
  }
  return parts.join('\n\n');
}

export type CarouselAttachmentKind = 'pdf' | 'text' | 'image' | 'spreadsheet';

export type CarouselAttachmentParseResult = {
  fileName: string;
  mimeType: string;
  kind: CarouselAttachmentKind;
  extractedText: string;
  charCount: number;
};

export async function parseCarouselAttachment(opts: {
  tenantId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<CarouselAttachmentParseResult> {
  const name = (opts.fileName || 'attachment').slice(0, 180);
  const mime = (opts.mimeType || '').toLowerCase();
  const lower = name.toLowerCase();

  let kind: CarouselAttachmentKind;
  let raw = '';

  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    kind = 'pdf';
    const parsed = await pdfParse(opts.buffer);
    raw = parsed.text || '';
    if (!raw.trim()) {
      throw new Error('PDF had no extractable text. Try a text-based PDF or paste key points as the topic.');
    }
  } else if (
    mime.startsWith('text/') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.csv')
  ) {
    kind = 'text';
    raw = opts.buffer.toString('utf-8');
  } else if (
    mime.includes('sheet') ||
    mime.includes('excel') ||
    lower.endsWith('.xlsx') ||
    lower.endsWith('.xls')
  ) {
    kind = 'spreadsheet';
    raw = extractSpreadsheet(opts.buffer);
    if (!raw.trim()) throw new Error('Spreadsheet was empty');
  } else if (mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(lower)) {
    kind = 'image';
    const imageMime = mime.startsWith('image/')
      ? mime.split(';')[0]
      : lower.endsWith('.png')
        ? 'image/png'
        : lower.endsWith('.webp')
          ? 'image/webp'
          : lower.endsWith('.gif')
            ? 'image/gif'
            : 'image/jpeg';
    raw = await visionDescribeImage(opts.tenantId, imageMime, opts.buffer);
  } else if (
    mime === 'application/msword' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.doc') ||
    lower.endsWith('.docx')
  ) {
    throw new Error('Word docs are not supported yet — upload PDF, TXT, CSV/XLSX, or an image.');
  } else {
    throw new Error('Unsupported file. Use PDF, TXT, CSV/XLSX, PNG, JPG, or WebP.');
  }

  const extractedText = truncate(raw);
  if (!extractedText) throw new Error('Could not extract usable content from that file');

  return {
    fileName: name,
    mimeType: mime || 'application/octet-stream',
    kind,
    extractedText,
    charCount: extractedText.length,
  };
}
