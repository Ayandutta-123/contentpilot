import { prisma } from '../lib/prisma';
import { encrypt, decrypt } from '../lib/encryption';
import { config } from '../config';
import {
  OPENAI_MODELS,
  CLAUDE_MODELS,
  FAL_IMAGE_MODELS,
  OPENAI_IMAGE_MODELS,
  resolveClaudeModelId,
} from '@contentpilot/shared';

export interface ResolvedProviders {
  llmProvider: 'openai' | 'claude';
  llmModel: string;
  openaiApiKey?: string;
  claudeApiKey?: string;
  claudeWorkspaceId?: string;
  imageProvider: 'fal' | 'openai';
  falModel: string;
  falApiKey?: string;
  /** auto = Smart Router; manual = pin falModel */
  imageRoutingMode: 'auto' | 'manual';
  searchProvider: 'tavily' | 'serpapi';
  tavilyApiKey?: string;
  serpapiApiKey?: string;
  scrapingProvider: 'apify';
  apifyApiToken?: string;
  placidApiKey?: string;
  notificationProvider: string;
  slackWebhookUrl?: string;
  teamsWebhookUrl?: string;
  resendApiKey?: string;
  notificationEmail?: string;
  soundAlertsEnabled: boolean;
  trendsMode: 'manual' | 'auto';
  competitorMode: 'manual' | 'auto';
  /** new_topic = fresh AI art; near_mirror = exact scraped photo (no AI image) */
  competitorImageMode: 'new_topic' | 'near_mirror';
  newsletterMode: 'manual' | 'auto';
}

function mask(value: string | null | undefined): boolean {
  return Boolean(value && value.length > 0);
}

type ProviderRow = NonNullable<Awaited<ReturnType<typeof prisma.providerSettings.findUnique>>>;

function providerHasSecrets(row: ProviderRow | null | undefined): boolean {
  if (!row) return false;
  return Boolean(
    row.openaiApiKey ||
      row.claudeApiKey ||
      row.falApiKey ||
      row.tavilyApiKey ||
      row.serpapiApiKey ||
      row.apifyApiToken ||
      row.placidApiKey ||
      row.slackWebhookUrl ||
      row.teamsWebhookUrl ||
      row.resendApiKey,
  );
}

/** Clone integrations from one company to another (encrypted fields stay as-is). */
export async function copyProviderSettings(fromTenantId: string, toTenantId: string) {
  if (fromTenantId === toTenantId) return null;
  const source = await prisma.providerSettings.findUnique({ where: { tenantId: fromTenantId } });
  if (!source) return null;

  const data = {
    llmProvider: source.llmProvider,
    llmModel: source.llmModel,
    openaiApiKey: source.openaiApiKey,
    claudeApiKey: source.claudeApiKey,
    claudeWorkspaceId: source.claudeWorkspaceId,
    imageProvider: source.imageProvider,
    falModel: source.falModel,
    falApiKey: source.falApiKey,
    imageRoutingMode: source.imageRoutingMode,
    searchProvider: source.searchProvider,
    tavilyApiKey: source.tavilyApiKey,
    serpapiApiKey: source.serpapiApiKey,
    scrapingProvider: source.scrapingProvider,
    apifyApiToken: source.apifyApiToken,
    placidApiKey: source.placidApiKey,
    notificationProvider: source.notificationProvider,
    slackWebhookUrl: source.slackWebhookUrl,
    teamsWebhookUrl: source.teamsWebhookUrl,
    resendApiKey: source.resendApiKey,
    notificationEmail: source.notificationEmail,
    soundAlertsEnabled: source.soundAlertsEnabled,
    trendsMode: source.trendsMode,
    competitorMode: source.competitorMode,
    competitorImageMode: source.competitorImageMode,
    newsletterMode: source.newsletterMode,
  };

  return prisma.providerSettings.upsert({
    where: { tenantId: toTenantId },
    create: { tenantId: toTenantId, ...data },
    update: data,
  });
}

/**
 * Keep Integrations identical across every company this user belongs to.
 * Password stays on the User account; brand data stays per-tenant.
 */
export async function syncProviderSettingsAcrossUserCompanies(
  userId: string,
  sourceTenantId: string,
) {
  const memberships = await prisma.tenantMembership.findMany({
    where: { userId },
    select: { tenantId: true },
  });
  for (const m of memberships) {
    if (m.tenantId === sourceTenantId) continue;
    await copyProviderSettings(sourceTenantId, m.tenantId);
  }
}

/**
 * Prefer this tenant's provider row; if empty, borrow (and heal) from another
 * company the same user(s) belong to — so new brands inherit account Integrations.
 */
export async function resolveProviderSettingsRow(tenantId: string): Promise<ProviderRow | null> {
  const local = await prisma.providerSettings.findUnique({ where: { tenantId } });
  if (providerHasSecrets(local)) return local;

  const members = await prisma.tenantMembership.findMany({
    where: { tenantId },
    select: { userId: true },
  });
  for (const member of members) {
    const siblings = await prisma.tenantMembership.findMany({
      where: { userId: member.userId },
      select: { tenantId: true },
    });
    for (const s of siblings) {
      if (s.tenantId === tenantId) continue;
      const other = await prisma.providerSettings.findUnique({ where: { tenantId: s.tenantId } });
      if (!providerHasSecrets(other)) continue;
      await copyProviderSettings(s.tenantId, tenantId);
      return prisma.providerSettings.findUnique({ where: { tenantId } });
    }
  }
  return local;
}

/** Strip paste junk so secrets are safe in HTTP Authorization headers (Latin-1 only). */
export function sanitizeApiSecret(raw: string | null | undefined): string {
  if (!raw) return '';
  let v = String(raw).trim();
  // Common paste mistakes
  v = v.replace(/^Bearer\s+/i, '');
  v = v.replace(/^["']|["']$/g, '');
  v = v.replace(/[\u200B-\u200D\uFEFF]/g, ''); // zero-width
  v = v.replace(/[\u2010-\u2015\u2212]/g, '-'); // fancy dashes → ASCII
  v = v.replace(/[→←⇒⇐‣•]/g, ''); // arrows / bullets from UI copy
  v = v.replace(/\s+/g, '');
  // HTTP headers must be ByteString (char codes ≤ 255)
  if ([...v].some((ch) => ch.charCodeAt(0) > 255)) {
    throw new Error(
      'API token contains invalid characters. Paste only the token from Placid > Project > API Tokens (no arrows or fancy dashes).',
    );
  }
  return v;
}

function decryptMaybe(v: string | null | undefined) {
  if (!v) return undefined;
  try {
    return decrypt(v);
  } catch {
    return v;
  }
}

export async function getProviderSettingsPublic(tenantId: string) {
  const row = await resolveProviderSettingsRow(tenantId);
  // *Set = saved on this account (shared across companies).
  // Env fallbacks still work at runtime via resolveProviders, but do not fake "Saved".
  return {
    llmProvider: row?.llmProvider ?? config.LLM_PROVIDER,
    llmModel: (() => {
      const raw = row?.llmModel ?? config.LLM_MODEL;
      const provider = row?.llmProvider ?? config.LLM_PROVIDER;
      return provider === 'claude' ? resolveClaudeModelId(raw) : raw;
    })(),
    openaiApiKeySet: mask(row?.openaiApiKey),
    claudeApiKeySet: mask(row?.claudeApiKey),
    claudeWorkspaceId: row?.claudeWorkspaceId || config.ANTHROPIC_WORKSPACE_ID || '',
    claudeWorkspaceIdSet: mask(row?.claudeWorkspaceId) || mask(config.ANTHROPIC_WORKSPACE_ID),
    imageProvider: row?.imageProvider ?? config.IMAGE_PROVIDER,
    falModel: row?.falModel ?? config.FAL_MODEL,
    falApiKeySet: mask(row?.falApiKey),
    imageRoutingMode: (row?.imageRoutingMode === 'manual' ? 'manual' : 'auto') as 'manual' | 'auto',
    searchProvider: row?.searchProvider ?? config.SEARCH_PROVIDER,
    tavilyApiKeySet: mask(row?.tavilyApiKey),
    serpapiApiKeySet: mask(row?.serpapiApiKey),
    scrapingProvider: row?.scrapingProvider ?? config.SCRAPING_PROVIDER,
    apifyApiTokenSet: mask(row?.apifyApiToken),
    placidApiKeySet: mask(row?.placidApiKey),
    notificationProvider: row?.notificationProvider ?? config.NOTIFICATION_PROVIDER,
    slackWebhookUrlSet: mask(row?.slackWebhookUrl),
    teamsWebhookUrlSet: mask(row?.teamsWebhookUrl),
    resendApiKeySet: mask(row?.resendApiKey) || mask(config.RESEND_API_KEY),
    notificationEmail: row?.notificationEmail || config.NOTIFICATION_TO_EMAIL || '',
    soundAlertsEnabled: row?.soundAlertsEnabled ?? true,
    trendsMode: (row?.trendsMode === 'auto' ? 'auto' : 'manual') as 'manual' | 'auto',
    competitorMode: (row?.competitorMode === 'auto' ? 'auto' : 'manual') as 'manual' | 'auto',
    competitorImageMode: (row?.competitorImageMode === 'near_mirror' ? 'near_mirror' : 'new_topic') as
      | 'new_topic'
      | 'near_mirror',
    newsletterMode: (row?.newsletterMode === 'auto' ? 'auto' : 'manual') as 'manual' | 'auto',
    sharedAcrossCompanies: true,
    catalogs: {
      openaiModels: OPENAI_MODELS,
      claudeModels: CLAUDE_MODELS,
      falImageModels: FAL_IMAGE_MODELS,
      openaiImageModels: OPENAI_IMAGE_MODELS,
    },
  };
}

export async function resolveProviders(tenantId: string): Promise<ResolvedProviders> {
  const row = await resolveProviderSettingsRow(tenantId);

  return {
    llmProvider: (row?.llmProvider as 'openai' | 'claude') || config.LLM_PROVIDER,
    llmModel: (() => {
      const raw = row?.llmModel || config.LLM_MODEL;
      const provider = (row?.llmProvider as string) || config.LLM_PROVIDER;
      return provider === 'claude' ? resolveClaudeModelId(raw) : raw;
    })(),
    openaiApiKey: (() => {
      try {
        return sanitizeApiSecret(decryptMaybe(row?.openaiApiKey) || config.OPENAI_API_KEY) || undefined;
      } catch {
        return undefined;
      }
    })(),
    claudeApiKey: (() => {
      try {
        return sanitizeApiSecret(decryptMaybe(row?.claudeApiKey) || config.ANTHROPIC_API_KEY) || undefined;
      } catch {
        return undefined;
      }
    })(),
    claudeWorkspaceId: row?.claudeWorkspaceId || config.ANTHROPIC_WORKSPACE_ID || undefined,
    imageProvider: (row?.imageProvider as 'fal' | 'openai') || config.IMAGE_PROVIDER,
    falModel: row?.falModel || config.FAL_MODEL,
    imageRoutingMode: (row?.imageRoutingMode === 'manual' ? 'manual' : 'auto') as 'auto' | 'manual',
    falApiKey: (() => {
      try {
        return sanitizeApiSecret(decryptMaybe(row?.falApiKey) || config.FAL_API_KEY) || undefined;
      } catch {
        return undefined;
      }
    })(),
    searchProvider: (row?.searchProvider as 'tavily' | 'serpapi') || config.SEARCH_PROVIDER,
    tavilyApiKey: (() => {
      try {
        return sanitizeApiSecret(decryptMaybe(row?.tavilyApiKey) || config.TAVILY_API_KEY) || undefined;
      } catch {
        return undefined;
      }
    })(),
    serpapiApiKey: (() => {
      try {
        return sanitizeApiSecret(decryptMaybe(row?.serpapiApiKey) || config.SERPAPI_API_KEY) || undefined;
      } catch {
        return undefined;
      }
    })(),
    scrapingProvider: 'apify',
    apifyApiToken: (() => {
      try {
        return sanitizeApiSecret(decryptMaybe(row?.apifyApiToken) || config.APIFY_API_TOKEN) || undefined;
      } catch {
        return undefined;
      }
    })(),
    placidApiKey: (() => {
      try {
        return sanitizeApiSecret(decryptMaybe(row?.placidApiKey) || config.PLACID_API_KEY) || undefined;
      } catch {
        return undefined;
      }
    })(),
    notificationProvider: row?.notificationProvider || config.NOTIFICATION_PROVIDER,
    slackWebhookUrl: decryptMaybe(row?.slackWebhookUrl) || config.SLACK_WEBHOOK_URL,
    teamsWebhookUrl: decryptMaybe(row?.teamsWebhookUrl) || config.TEAMS_WEBHOOK_URL,
    resendApiKey: (() => {
      try {
        return sanitizeApiSecret(decryptMaybe(row?.resendApiKey) || config.RESEND_API_KEY) || undefined;
      } catch {
        return undefined;
      }
    })(),
    notificationEmail: row?.notificationEmail || config.NOTIFICATION_TO_EMAIL || undefined,
    soundAlertsEnabled: row?.soundAlertsEnabled ?? true,
    trendsMode: row?.trendsMode === 'auto' ? 'auto' : 'manual',
    competitorMode: row?.competitorMode === 'auto' ? 'auto' : 'manual',
    competitorImageMode: row?.competitorImageMode === 'near_mirror' ? 'near_mirror' : 'new_topic',
    newsletterMode: row?.newsletterMode === 'auto' ? 'auto' : 'manual',
  };
}

export async function upsertProviderSettings(
  tenantId: string,
  input: {
    llmProvider?: string;
    llmModel?: string;
    openaiApiKey?: string;
    claudeApiKey?: string;
    claudeWorkspaceId?: string | null;
    imageProvider?: string;
    falModel?: string;
    falApiKey?: string;
    imageRoutingMode?: 'manual' | 'auto';
    searchProvider?: string;
    tavilyApiKey?: string;
    serpapiApiKey?: string;
    apifyApiToken?: string;
    placidApiKey?: string;
    notificationProvider?: string;
    slackWebhookUrl?: string;
    teamsWebhookUrl?: string;
    resendApiKey?: string;
    notificationEmail?: string;
    soundAlertsEnabled?: boolean;
    trendsMode?: 'manual' | 'auto';
    competitorMode?: 'manual' | 'auto';
    competitorImageMode?: 'new_topic' | 'near_mirror';
    newsletterMode?: 'manual' | 'auto';
  },
) {
  const encryptIfPresent = (v?: string) => {
    if (!v || !String(v).trim()) return undefined;
    return encrypt(sanitizeApiSecret(v));
  };
  const encryptUrlIfPresent = (v?: string) => {
    if (!v || !String(v).trim()) return undefined;
    return encrypt(String(v).trim());
  };

  const existing = await prisma.providerSettings.findUnique({ where: { tenantId } });

  const raw: Record<string, unknown> = {
    llmProvider: input.llmProvider,
    llmModel: input.llmModel,
    imageProvider: input.imageProvider,
    falModel: input.falModel,
    imageRoutingMode: input.imageRoutingMode,
    searchProvider: input.searchProvider,
    scrapingProvider: 'apify',
    notificationProvider: input.notificationProvider,
    soundAlertsEnabled: input.soundAlertsEnabled,
    trendsMode: input.trendsMode,
    competitorMode: input.competitorMode,
    competitorImageMode: input.competitorImageMode,
    newsletterMode: input.newsletterMode,
  };

  if (input.openaiApiKey !== undefined) {
    raw.openaiApiKey = encryptIfPresent(input.openaiApiKey) ?? null;
  }
  if (input.claudeApiKey !== undefined) {
    raw.claudeApiKey = encryptIfPresent(input.claudeApiKey) ?? null;
  }
  if (input.claudeWorkspaceId !== undefined) {
    const wid = (input.claudeWorkspaceId || '').trim();
    raw.claudeWorkspaceId = wid || null;
  }
  if (input.falApiKey !== undefined) {
    raw.falApiKey = encryptIfPresent(input.falApiKey) ?? null;
  }
  if (input.tavilyApiKey !== undefined) {
    raw.tavilyApiKey = encryptIfPresent(input.tavilyApiKey) ?? null;
  }
  if (input.serpapiApiKey !== undefined) {
    raw.serpapiApiKey = encryptIfPresent(input.serpapiApiKey) ?? null;
  }
  if (input.apifyApiToken !== undefined) {
    raw.apifyApiToken = encryptIfPresent(input.apifyApiToken) ?? null;
  }
  if (input.placidApiKey !== undefined) {
    raw.placidApiKey = encryptIfPresent(input.placidApiKey) ?? null;
  }
  if (input.slackWebhookUrl !== undefined) {
    raw.slackWebhookUrl = encryptUrlIfPresent(input.slackWebhookUrl) ?? null;
  }
  if (input.teamsWebhookUrl !== undefined) {
    raw.teamsWebhookUrl = encryptUrlIfPresent(input.teamsWebhookUrl) ?? null;
  }
  if (input.resendApiKey !== undefined) {
    raw.resendApiKey = encryptIfPresent(input.resendApiKey) ?? null;
  }
  if (input.notificationEmail !== undefined) {
    const email = String(input.notificationEmail || '').trim();
    raw.notificationEmail = email || null;
  }

  // Drop undefined so Prisma does not wipe unset columns
  const data = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined),
  );

  if (existing) {
    return prisma.providerSettings.update({ where: { tenantId }, data });
  }
  return prisma.providerSettings.create({
    data: { tenantId, ...data },
  });
}
