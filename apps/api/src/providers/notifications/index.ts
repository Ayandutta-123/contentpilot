import { config as appConfig } from '../../config';
import { resolveProviders } from '../../services/providers.service';
import { prisma } from '../../lib/prisma';
import { asStringArray } from '../../lib/json';
import { toPublicMediaUrl } from '../../lib/public-media-url';

export interface NotificationAction {
  label: string;
  url: string;
  /** Slack button style */
  style?: 'primary' | 'danger';
}

export interface NotificationPayload {
  title: string;
  body: string;
  imageUrl?: string;
  /** @deprecated Prefer `actions` — kept for callers that only need one link */
  actionUrl?: string;
  actions?: NotificationAction[];
  metadata?: Record<string, string>;
}

export interface NotificationProvider {
  readonly name: string;
  send(payload: NotificationPayload): Promise<void>;
  sendAlert(payload: NotificationPayload & { severity: 'error' | 'warning' | 'info' }): Promise<void>;
}

function resolveActions(payload: NotificationPayload): NotificationAction[] {
  if (payload.actions?.length) return payload.actions;
  if (payload.actionUrl) return [{ label: 'Review Content', url: payload.actionUrl }];
  return [];
}

function truncateSlackHeader(title: string): string {
  return title.length > 150 ? `${title.slice(0, 147)}…` : title;
}

export class SlackNotificationProvider implements NotificationProvider {
  readonly name = 'slack';

  constructor(private readonly webhookUrl?: string) {}

  async send(payload: NotificationPayload): Promise<void> {
    const url = this.webhookUrl || appConfig.SLACK_WEBHOOK_URL;
    if (!url) {
      console.warn('[Notification] Slack webhook not configured, skipping');
      return;
    }

    const blocks: Record<string, unknown>[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: truncateSlackHeader(payload.title), emoji: true },
      },
      { type: 'section', text: { type: 'mrkdwn', text: payload.body } },
    ];

    if (payload.imageUrl) {
      blocks.push({
        type: 'image',
        image_url: payload.imageUrl,
        alt_text: 'Post preview',
      });
    }

    const actions = resolveActions(payload);
    if (actions.length) {
      blocks.push({
        type: 'actions',
        elements: actions.slice(0, 5).map((a) => ({
          type: 'button',
          text: { type: 'plain_text', text: a.label.slice(0, 75) },
          url: a.url,
          ...(a.style ? { style: a.style } : {}),
        })),
      });
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: payload.title,
        blocks,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[Notification] Slack webhook failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }

  async sendAlert(payload: NotificationPayload & { severity: 'error' | 'warning' | 'info' }): Promise<void> {
    const emoji = { error: '🚨', warning: '⚠️', info: 'ℹ️' }[payload.severity];
    await this.send({
      ...payload,
      title: `${emoji} ${payload.title}`,
    });
  }
}

/** Microsoft Teams Incoming Webhook / Workflows connector (MessageCard). */
export class TeamsNotificationProvider implements NotificationProvider {
  readonly name = 'teams';

  constructor(private readonly webhookUrl?: string) {}

  async send(payload: NotificationPayload): Promise<void> {
    const url = this.webhookUrl || appConfig.TEAMS_WEBHOOK_URL;
    if (!url) {
      console.warn('[Notification] Teams webhook not configured, skipping');
      return;
    }

    const sections: Record<string, unknown>[] = [
      {
        activityTitle: payload.title,
        text: payload.body.replace(/\*/g, '**'),
      },
    ];

    if (payload.imageUrl) {
      sections.push({
        images: [{ image: payload.imageUrl, title: 'Preview' }],
      });
    }

    const card: Record<string, unknown> = {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: payload.title,
      themeColor: '6264A7',
      title: payload.title,
      sections,
    };

    const actions = resolveActions(payload);
    if (actions.length) {
      card.potentialAction = actions.map((a) => ({
        '@type': 'OpenUri',
        name: a.label,
        targets: [{ os: 'default', uri: a.url }],
      }));
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[Notification] Teams webhook failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }

  async sendAlert(payload: NotificationPayload & { severity: 'error' | 'warning' | 'info' }): Promise<void> {
    const themeColor = { error: 'D13438', warning: 'FFB900', info: '0078D4' }[payload.severity];
    const emoji = { error: '🚨', warning: '⚠️', info: 'ℹ️' }[payload.severity];
    const url = this.webhookUrl || appConfig.TEAMS_WEBHOOK_URL;
    if (!url) {
      console.warn('[Notification] Teams webhook not configured, skipping');
      return;
    }

    const card: Record<string, unknown> = {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: payload.title,
      themeColor,
      title: `${emoji} ${payload.title}`,
      sections: [{ text: payload.body.replace(/\*/g, '**') }],
    };

    const actions = resolveActions(payload);
    if (actions.length) {
      card.potentialAction = actions.map((a) => ({
        '@type': 'OpenUri',
        name: a.label,
        targets: [{ os: 'default', uri: a.url }],
      }));
    } else if (payload.actionUrl) {
      card.potentialAction = [
        {
          '@type': 'OpenUri',
          name: 'View Logs',
          targets: [{ os: 'default', uri: payload.actionUrl }],
        },
      ];
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[Notification] Teams webhook failed (${res.status}): ${text.slice(0, 200)}`);
    }
  }
}

class EmailNotificationProvider implements NotificationProvider {
  readonly name = 'email';

  constructor(
    private readonly opts: {
      resendApiKey?: string;
      fromEmail?: string;
      toEmail?: string;
    } = {},
  ) {}

  private resolveFrom(): string {
    const from = (this.opts.fromEmail || appConfig.NOTIFICATION_FROM_EMAIL || '').trim();
    // Resend allows beth.t@example.com for free tests (deliver only to your Resend account email)
    return from || 'ContentPilot <beth.t@example.com>';
  }

  private resolveTo(): string | null {
    const to = (this.opts.toEmail || appConfig.NOTIFICATION_TO_EMAIL || '').trim();
    return to || null;
  }

  private resolveApiKey(): string | null {
    const key = (this.opts.resendApiKey || appConfig.RESEND_API_KEY || '').trim();
    return key || null;
  }

  async send(payload: NotificationPayload): Promise<void> {
    const apiKey = this.resolveApiKey();
    const to = this.resolveTo();
    if (!apiKey) {
      console.warn('[Notification] Resend API key not configured — email skipped');
      return;
    }
    if (!to) {
      console.warn('[Notification] No alert email configured — set Settings → Alerts email or NOTIFICATION_TO_EMAIL');
      return;
    }

    const actions = resolveActions(payload);
    const actionHtml = actions.length
      ? `<p style="margin:20px 0 0">${actions
          .map(
            (a) =>
              `<a href="${escapeHtml(a.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;background:#4F46E5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(a.label)}</a>`,
          )
          .join('')}</p>`
      : '';
    const imageHtml = payload.imageUrl
      ? `<p style="margin:16px 0"><img src="${escapeHtml(payload.imageUrl)}" alt="Preview" style="max-width:100%;border-radius:12px"/></p>`
      : '';
    const bodyHtml = escapeHtml(payload.body)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>');

    const html = `<!doctype html><html><body style="font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#1e293b;border-radius:16px;padding:24px;border:1px solid #334155">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#94a3b8">ContentPilot</p>
    <h1 style="margin:0 0 12px;font-size:20px;color:#f8fafc">${escapeHtml(payload.title)}</h1>
    <div style="font-size:14px;line-height:1.55;color:#cbd5e1">${bodyHtml}</div>
    ${imageHtml}
    ${actionHtml}
  </div>
</body></html>`;

    const text = [
      payload.title,
      '',
      payload.body.replace(/\*\*/g, ''),
      '',
      ...actions.map((a) => `${a.label}: ${a.url}`),
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const { Resend } = await import('resend');
      const resend = new Resend(apiKey);
      const result = await resend.emails.send({
        from: this.resolveFrom(),
        to: [to],
        subject: payload.title.slice(0, 200),
        html,
        text,
      });
      if (result.error) {
        console.warn(`[Notification] Resend failed: ${result.error.message}`);
        throw new Error(result.error.message);
      }
      console.log(`[Notification] Resend ok id=${result.data?.id || 'unknown'} to=${to.replace(/(^.).*(@.*$)/, '$1***$2')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Notification] Email send failed: ${msg.slice(0, 200)}`);
      throw err;
    }
  }

  async sendAlert(payload: NotificationPayload & { severity: 'error' | 'warning' | 'info' }): Promise<void> {
    const emoji = { error: '🚨', warning: '⚠️', info: 'ℹ️' }[payload.severity];
    await this.send({
      ...payload,
      title: `${emoji} ${payload.title}`,
    });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function createNotificationProvider(
  providerName?: string,
  webhooks?: {
    slackWebhookUrl?: string;
    teamsWebhookUrl?: string;
    resendApiKey?: string;
    notificationEmail?: string;
  },
): NotificationProvider {
  const name = providerName || appConfig.NOTIFICATION_PROVIDER;
  switch (name) {
    case 'teams':
      return new TeamsNotificationProvider(webhooks?.teamsWebhookUrl);
    case 'email':
      return new EmailNotificationProvider({
        resendApiKey: webhooks?.resendApiKey,
        toEmail: webhooks?.notificationEmail,
        fromEmail: appConfig.NOTIFICATION_FROM_EMAIL,
      });
    case 'slack':
    default:
      return new SlackNotificationProvider(webhooks?.slackWebhookUrl);
  }
}

async function resolveNotifier(tenantId?: string): Promise<NotificationProvider> {
  if (!tenantId) {
    return createNotificationProvider();
  }
  try {
    const providers = await resolveProviders(tenantId);
    return createNotificationProvider(providers.notificationProvider, {
      slackWebhookUrl: providers.slackWebhookUrl,
      teamsWebhookUrl: providers.teamsWebhookUrl,
      resendApiKey: providers.resendApiKey,
      notificationEmail: providers.notificationEmail,
    });
  } catch (err) {
    console.warn('[Notification] Failed to resolve tenant providers, using env defaults', err);
    return createNotificationProvider();
  }
}

/** Fan-out to every configured chat webhook (Slack and/or Teams). */
async function sendChatNotification(
  tenantId: string | undefined,
  payload: NotificationPayload,
): Promise<void> {
  const jobs: Promise<void>[] = [];

  try {
    const providers = tenantId ? await resolveProviders(tenantId) : null;
    const slackUrl = providers?.slackWebhookUrl || appConfig.SLACK_WEBHOOK_URL;
    const teamsUrl = providers?.teamsWebhookUrl || appConfig.TEAMS_WEBHOOK_URL;
    const preferEmail = (providers?.notificationProvider || appConfig.NOTIFICATION_PROVIDER) === 'email';

    if (preferEmail) {
      const email = createNotificationProvider('email', {
        resendApiKey: providers?.resendApiKey,
        notificationEmail: providers?.notificationEmail,
      });
      await email.send(payload);
      return;
    }

    if (slackUrl) jobs.push(new SlackNotificationProvider(slackUrl).send(payload));
    if (teamsUrl) jobs.push(new TeamsNotificationProvider(teamsUrl).send(payload));

    if (!jobs.length) {
      // Email / preferred provider when no chat webhooks are saved
      const notifier = await resolveNotifier(tenantId);
      await notifier.send(payload);
      return;
    }

    await Promise.allSettled(jobs);
  } catch (err) {
    console.warn('[Notification] Chat notify failed', err);
  }
}

async function resolveCompanyName(tenantId?: string): Promise<string> {
  if (!tenantId) return 'ContentPilot';
  try {
    const brand = await prisma.brandSettings.findUnique({
      where: { tenantId },
      select: { companyName: true },
    });
    const name = brand?.companyName?.trim();
    return name || 'ContentPilot';
  } catch {
    return 'ContentPilot';
  }
}

function formatHashtags(raw: unknown): string {
  const tags = asStringArray(raw)
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => (h.startsWith('#') ? h : `#${h}`));
  return tags.length ? tags.join(' ') : '_None_';
}

function formatCaption(headline: string, body: string, max = 1200): string {
  const head = (headline || '').trim();
  const text = (body || '').trim();
  let caption = head && text ? `${head}\n\n${text}` : head || text || '_No caption_';
  if (caption.length > max) caption = `${caption.slice(0, max - 1)}…`;
  return caption;
}

function absolutePreviewUrl(imageUrl?: string | null): string | undefined {
  if (!imageUrl?.trim()) return undefined;
  const publicUrl = toPublicMediaUrl(imageUrl);
  if (publicUrl) return publicUrl;
  const raw = imageUrl.trim();
  if (raw.startsWith('/uploads/')) {
    const base = (appConfig.WEB_URL || appConfig.API_URL || '').replace(/\/$/, '');
    if (base) return `${base}${raw}`;
  }
  if (/^https?:\/\//i.test(raw) && !/localhost|127\.0\.0\.1/i.test(raw)) return raw;
  return undefined;
}

function formatPostedAt(date: Date, timeZone = 'Asia/Kolkata'): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** Best-effort public URL for a published post. */
export function buildPlatformPostUrl(
  platform: string,
  platformPostId?: string | null,
  accountId?: string | null,
): string | null {
  const id = (platformPostId || '').trim();
  if (!id) return null;

  switch (platform) {
    case 'linkedin': {
      // LinkedIn resolves /feed/update/<urn> only with the colons left raw —
      // percent-encoding them returns a "page doesn't exist" screen.
      if (id.startsWith('urn:li:')) {
        return `https://www.linkedin.com/feed/update/${id}`;
      }
      if (id.includes('ugcPost') || id.includes('share')) {
        return `https://www.linkedin.com/feed/update/${id}`;
      }
      return `https://www.linkedin.com/feed/update/urn:li:share:${id}`;
    }
    case 'facebook': {
      if (id.includes('_')) {
        const [pageId, postId] = id.split('_');
        if (pageId && postId) return `https://www.facebook.com/${pageId}/posts/${postId}`;
      }
      if (accountId) return `https://www.facebook.com/${accountId}/posts/${id}`;
      return `https://www.facebook.com/${id}`;
    }
    case 'instagram': {
      // Prefer Graph permalink (fetched after publish). Numeric media IDs are not public URLs.
      if (id.startsWith('http')) return id;
      return null;
    }
    default:
      return null;
  }
}

export async function notifyApprovalPending(content: {
  id: string;
  tenantId?: string;
  headline: string;
  body: string;
  hashtags?: unknown;
  imageUrl?: string | null;
}): Promise<void> {
  const company = await resolveCompanyName(content.tenantId);
  const base = `${appConfig.WEB_URL}/approvals/${content.id}`;
  const caption = formatCaption(content.headline, content.body);
  const hashtags = formatHashtags(content.hashtags);

  const body = [
    `*${company}*`,
    '',
    '*Caption*',
    caption,
    '',
    '*Hashtags*',
    hashtags,
  ].join('\n');

  await sendChatNotification(content.tenantId, {
    title: `${company} · Ready for review`,
    body,
    imageUrl: absolutePreviewUrl(content.imageUrl),
    actions: [
      { label: 'Post to social', url: `${base}?action=post`, style: 'primary' },
      { label: 'Reject', url: `${base}?action=reject`, style: 'danger' },
      { label: 'Open in Approvals', url: base },
    ],
    metadata: { contentId: content.id, company },
  });
}

export async function notifyPublished(input: {
  tenantId: string;
  contentId: string;
  headline: string;
  body: string;
  hashtags?: unknown;
  imageUrl?: string | null;
  publishedAt: Date;
  posts: Array<{
    platform: string;
    platformPostId?: string | null;
    postUrl?: string | null;
    accountId?: string | null;
    accountName?: string | null;
  }>;
}): Promise<void> {
  const company = await resolveCompanyName(input.tenantId);
  const caption = formatCaption(input.headline, input.body, 800);
  const hashtags = formatHashtags(input.hashtags);
  const when = formatPostedAt(input.publishedAt);

  const linkLines = input.posts.map((p) => {
    const label = p.platform.charAt(0).toUpperCase() + p.platform.slice(1);
    const url =
      p.postUrl ||
      buildPlatformPostUrl(p.platform, p.platformPostId, p.accountId) ||
      null;
    const account = p.accountName ? ` (${p.accountName})` : '';
    if (url) return `• *${label}*${account}: ${url}`;
    if (p.platformPostId) return `• *${label}*${account}: post id \`${p.platformPostId}\``;
    return `• *${label}*${account}: posted`;
  });

  const body = [
    `*${company}*`,
    '',
    '*Caption*',
    caption,
    '',
    '*Hashtags*',
    hashtags,
    '',
    `*Posted at:* ${when}`,
    '',
    '*Links*',
    linkLines.length ? linkLines.join('\n') : '_No platform links recorded_',
  ].join('\n');

  await sendChatNotification(input.tenantId, {
    title: `${company} · Posted successfully`,
    body,
    imageUrl: absolutePreviewUrl(input.imageUrl),
    actions: [
      {
        label: 'Open in ContentPilot',
        url: `${appConfig.WEB_URL}/approvals/${input.contentId}`,
      },
      {
        label: 'Dashboard',
        url: `${appConfig.WEB_URL}/dashboard`,
      },
    ],
    metadata: { contentId: input.contentId, company },
  });
}

/** Send a one-off Resend connectivity email (Settings → Test). */
export async function sendTestEmailAlert(
  tenantId: string,
  overrideTo?: string,
): Promise<{ ok: true; id?: string; to: string } | { ok: false; error: string }> {
  try {
    const providers = await resolveProviders(tenantId);
    const to = (overrideTo || providers.notificationEmail || appConfig.NOTIFICATION_TO_EMAIL || '').trim();
    const key = (providers.resendApiKey || appConfig.RESEND_API_KEY || '').trim();
    if (!key) {
      return {
        ok: false,
        error: 'Add a Resend API key in Settings → Alerts (or RESEND_API_KEY in .env).',
      };
    }
    if (!to) {
      return {
        ok: false,
        error: 'Set an alert email address in Settings → Alerts (or NOTIFICATION_TO_EMAIL).',
      };
    }
    const provider = new EmailNotificationProvider({
      resendApiKey: key,
      toEmail: to,
      fromEmail: appConfig.NOTIFICATION_FROM_EMAIL,
    });
    await provider.send({
      title: 'ContentPilot — Resend email test',
      body: `Connectivity check at ${new Date().toISOString()}.\n\nIf you received this, Resend email alerts are working.`,
      actions: [{ label: 'Open ContentPilot', url: `${appConfig.WEB_URL}/settings` }],
    });
    return { ok: true, to };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function notifyWorkflowFailure(
  step: string,
  error: string,
  contentId?: string,
  isTransient = false,
  tenantId?: string,
): Promise<void> {
  const company = await resolveCompanyName(tenantId);
  const notifier = await resolveNotifier(tenantId);
  const logUrl = contentId
    ? `${appConfig.WEB_URL}/logs?contentId=${contentId}`
    : `${appConfig.WEB_URL}/logs`;

  await notifier.sendAlert({
    title: isTransient
      ? `${company} · Transient failure (will retry)`
      : `${company} · Workflow failure`,
    body: `*${company}*\n\n*Step:* ${step}\n*Error:* ${error}\n*Content ID:* ${contentId ?? 'N/A'}`,
    actionUrl: logUrl,
    severity: isTransient ? 'warning' : 'error',
  });
}
