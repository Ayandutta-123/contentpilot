/**
 * Detect “out of credits / quota” failures from Claude, OpenAI, fal.ai,
 * Tavily, Apify, and Placid — and turn them into one plain-language warning.
 */

export type CreditTool = 'claude' | 'openai' | 'fal' | 'tavily' | 'apify' | 'placid';
export type CreditJob = 'caption' | 'image' | 'scrape' | 'search' | 'generation';

export type ProviderCreditAlert = {
  tool: CreditTool;
  toolLabel: string;
  title: string;
  message: string;
  billingUrl: string;
  job: CreditJob;
};

const TOOLS: Record<CreditTool, { label: string; billingUrl: string }> = {
  claude: {
    label: 'Text model',
    billingUrl: 'https://console.anthropic.com/settings/billing',
  },
  openai: {
    label: 'Text model',
    billingUrl: 'https://platform.openai.com/settings/organization/billing',
  },
  fal: {
    label: 'Image model',
    billingUrl: 'https://fal.ai/dashboard/billing',
  },
  tavily: {
    label: 'Search credits',
    billingUrl: 'https://app.tavily.com/',
  },
  apify: {
    label: 'Scraping credits',
    billingUrl: 'https://console.apify.com/billing',
  },
  placid: {
    label: 'Placid',
    billingUrl: 'https://placid.app/account',
  },
};

const CREDIT_RE =
  /insufficient[_\s-]?quota|insufficient[_\s-]?credit|credit balance is too low|billing_hard_limit|billing_not_active|payment[_\s-]?required|out of credits|exceeded your (current )?quota|quota.?exceeded|spend limit|usage limit|no remaining credits|balance is too low|account is locked|user is locked|has no credits|402 payment|monthly usage|soft[_\s-]?limit|hard[_\s-]?limit|not enough credit|credits?.{0,20}(exhausted|depleted|empty)|used all available credits|upgrade your plan|payment required|subscription.*(expired|inactive|ended|required)|plan.*(expired|limit|exceeded)|no active subscription|renew your (plan|subscription)/i;

export const PROVIDER_CREDITS_CODE = 'PROVIDER_CREDITS';

export class ProviderCreditError extends Error {
  readonly code = PROVIDER_CREDITS_CODE;
  statusCode = 402;
  tool: CreditTool;
  toolLabel: string;
  billingUrl: string;
  job: CreditJob;

  constructor(alert: ProviderCreditAlert) {
    super(alert.message);
    this.name = 'ProviderCreditError';
    this.tool = alert.tool;
    this.toolLabel = alert.toolLabel;
    this.billingUrl = alert.billingUrl;
    this.job = alert.job;
  }

  toJSON(): ProviderCreditAlert {
    return {
      tool: this.tool,
      toolLabel: this.toolLabel,
      title: `Add money to ${this.toolLabel}`,
      message: this.message,
      billingUrl: this.billingUrl,
      job: this.job,
    };
  }
}

function jobPhrase(job: CreditJob, tool: CreditTool): string {
  if (tool === 'placid') {
    return job === 'image' ? 'render the Placid template' : 'import or sync Placid templates';
  }
  switch (job) {
    case 'image':
      return 'create the image';
    case 'scrape':
      return tool === 'apify' ? 'scrape competitors' : 'read the website';
    case 'search':
      return 'search for news';
    case 'caption':
      return 'write the caption';
    default:
      return 'finish generation';
  }
}

export function buildProviderCreditAlert(
  tool: CreditTool,
  job: CreditJob = 'generation',
): ProviderCreditAlert {
  const meta = TOOLS[tool];
  if (tool === 'placid') {
    return {
      tool,
      toolLabel: meta.label,
      title: `Add money to ${meta.label}`,
      billingUrl: meta.billingUrl,
      job,
      message:
        'We could not use Placid because your subscription or credits ran out. Add money or renew in Placid billing, then try again.',
    };
  }
  return {
    tool,
    toolLabel: meta.label,
    title: `Add money to ${meta.label}`,
    billingUrl: meta.billingUrl,
    job,
    message:
      job === 'image'
        ? `We could not create the image because your ${meta.label.toLowerCase()} are out of credits. We did not fall back to a cheaper model. Add money in billing, then try again.`
        : `We could not ${jobPhrase(job, tool)} because your ${meta.label.toLowerCase()} are out of credits. Add money in billing, then try again.`,
  };
}

function inferTool(text: string, fallback?: CreditTool): CreditTool | null {
  const t = text.toLowerCase();
  if (/\btavily\b/.test(t)) return 'tavily';
  if (/\bapify\b|\bscraping service\b/.test(t)) return 'apify';
  if (/\bplacid\b|\bdesign.?library\b/.test(t)) return 'placid';
  if (/\banthropic\b|\bclaude\b/.test(t)) return 'claude';
  if (/\bfal\.ai\b|\bfal\b/.test(t)) return 'fal';
  if (/\bopenai\b|\bgpt-image\b|\bdall-?e\b/.test(t)) return 'openai';
  return fallback ?? null;
}

function statusOf(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const row = err as { status?: unknown; statusCode?: unknown };
  if (typeof row.status === 'number') return row.status;
  if (typeof row.statusCode === 'number') return row.statusCode;
  return null;
}

function codeOf(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const row = err as { code?: unknown; error?: { code?: unknown; type?: unknown } };
  return [row.code, row.error?.code, row.error?.type]
    .filter((v) => typeof v === 'string')
    .join(' ');
}

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message || '');
  }
  return String(err ?? '');
}

/** True when the vendor is refusing the call because the account needs money. */
export function isCreditFailureText(text: string, status?: number | null): boolean {
  if (status === 402) return true;
  // Tavily often uses 432 for payment / credit exhaustion
  if (status === 432) return true;
  if (CREDIT_RE.test(text)) return true;
  // 429 alone is usually rate-limit; only treat as credits when billing language is present.
  if (status === 429 && /quota|billing|credit|spend|payment|insufficient/i.test(text)) return true;
  return false;
}

export function classifyProviderCreditError(
  err: unknown,
  fallbackTool?: CreditTool,
  job: CreditJob = 'generation',
): ProviderCreditAlert | null {
  if (err instanceof ProviderCreditError) {
    return err.toJSON();
  }
  const text = `${messageOf(err)} ${codeOf(err)}`;
  const status = statusOf(err);
  if (!isCreditFailureText(text, status)) return null;
  const tool = inferTool(text, fallbackTool);
  if (!tool) return null;
  return buildProviderCreditAlert(tool, job);
}

export function toProviderCreditError(
  err: unknown,
  fallbackTool?: CreditTool,
  job: CreditJob = 'generation',
): ProviderCreditError | null {
  if (err instanceof ProviderCreditError) {
    if (job && err.job === 'generation' && job !== 'generation') {
      return new ProviderCreditError(buildProviderCreditAlert(err.tool, job));
    }
    return err;
  }
  const alert = classifyProviderCreditError(err, fallbackTool, job);
  return alert ? new ProviderCreditError(alert) : null;
}

export function isProviderCreditError(err: unknown): err is ProviderCreditError {
  return err instanceof ProviderCreditError || (err as { code?: string })?.code === PROVIDER_CREDITS_CODE;
}

/** Re-throw as ProviderCreditError when the vendor is out of credits; otherwise return. */
export function rethrowIfCreditError(
  err: unknown,
  fallbackTool?: CreditTool,
  job: CreditJob = 'generation',
): void {
  const credit = toProviderCreditError(err, fallbackTool, job);
  if (credit) throw credit;
}
