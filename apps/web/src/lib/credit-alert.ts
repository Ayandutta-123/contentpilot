export const PROVIDER_CREDITS_CODE = 'PROVIDER_CREDITS';

export type CreditAlertPayload = {
  tool: 'claude' | 'openai' | 'fal' | 'tavily' | 'apify' | 'placid';
  toolLabel: string;
  title: string;
  message: string;
  billingUrl: string;
  job?: string;
  notificationId?: string;
};

function displayToolLabel(tool: CreditAlertPayload['tool']): string {
  if (tool === 'fal') return 'Image model';
  if (tool === 'tavily') return 'Search credits';
  if (tool === 'apify') return 'Scraping credits';
  if (tool === 'placid') return 'Placid';
  return 'Text model';
}

function billingUrlFor(tool: CreditAlertPayload['tool']): string {
  switch (tool) {
    case 'claude':
      return 'https://console.anthropic.com/settings/billing';
    case 'fal':
      return 'https://fal.ai/dashboard/billing';
    case 'tavily':
      return 'https://app.tavily.com/';
    case 'apify':
      return 'https://console.apify.com/billing';
    case 'placid':
      return 'https://placid.app/account';
    default:
      return 'https://platform.openai.com/settings/organization/billing';
  }
}

function neutralizeAlert(payload: CreditAlertPayload): CreditAlertPayload {
  const toolLabel = displayToolLabel(payload.tool);
  return {
    ...payload,
    toolLabel,
    title: `Add money to ${toolLabel}`,
    message: payload.message
      .replace(/\bClaude\b/g, 'your text model')
      .replace(/\bOpenAI\b/g, 'your text model')
      .replace(/\bAnthropic\b/g, 'your text model')
      .replace(/\bfal\.ai\b/gi, 'your image model')
      .replace(/\bfal\b/gi, 'your image model')
      .replace(/\bTavily\b/g, 'your search credits')
      .replace(/\bApify\b/g, 'your scraping credits')
      // Keep "Placid" in messages — users know that product name from Design library
      ,
  };
}

const TOOLS = new Set(['claude', 'openai', 'fal', 'tavily', 'apify', 'placid']);

export function isCreditAlert(value: unknown): value is CreditAlertPayload {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.tool === 'string' &&
    TOOLS.has(row.tool) &&
    typeof row.message === 'string' &&
    typeof row.billingUrl === 'string'
  );
}

export function creditAlertFromNotification(n: {
  id: string;
  title: string;
  message: string;
  href?: string | null;
}): CreditAlertPayload | null {
  if (!n.title.startsWith('Add money to ') && !n.title.startsWith('Add credits')) return null;

  let tool: CreditAlertPayload['tool'] | null = null;
  if (/search credit|\btavily\b/i.test(n.title) || /tavily|search credit/i.test(n.message)) {
    tool = 'tavily';
  } else if (/scraping credit|\bapify\b/i.test(n.title) || /apify|scraping credit/i.test(n.message)) {
    tool = 'apify';
  } else if (/\bplacid\b|design library/i.test(n.title) || /\bplacid\b|design library/i.test(n.message)) {
    tool = 'placid';
  } else if (/image model|\bfal\b/i.test(n.title) || /fal|image model/i.test(n.message)) {
    tool = 'fal';
  } else if (/openai/i.test(n.title) || /openai/i.test(n.message)) {
    tool = 'openai';
  } else if (/claude|text model/i.test(n.title) || /claude|anthropic|text model/i.test(n.message)) {
    tool = 'claude';
  }
  if (!tool) return null;

  return neutralizeAlert({
    tool,
    toolLabel: displayToolLabel(tool),
    title: n.title,
    message: n.message,
    billingUrl: n.href || billingUrlFor(tool),
    notificationId: n.id,
  });
}

type Listener = (payload: CreditAlertPayload) => void;
let listener: Listener | null = null;

export function onCreditAlert(fn: Listener) {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function emitCreditAlert(payload: CreditAlertPayload) {
  listener?.(neutralizeAlert(payload));
}
