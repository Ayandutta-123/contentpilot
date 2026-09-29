import type { FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import {
  PROVIDER_CREDITS_CODE,
  ProviderCreditError,
  toProviderCreditError,
  type CreditJob,
  type ProviderCreditAlert,
} from '../lib/provider-credits';
import { createAppNotification } from './app-notification.service';
import {
  SlackNotificationProvider,
  TeamsNotificationProvider,
  createNotificationProvider,
} from '../providers/notifications';
import { resolveProviders } from './providers.service';

const DEDUPE_MS = 10 * 60 * 1000;
const lastSent = new Map<string, number>();

function dedupeKey(tenantId: string, tool: string) {
  return `${tenantId}:${tool}`;
}

/**
 * In-app warning + Slack/Teams (whichever webhooks are saved).
 * Deduped per tenant+tool for 10 minutes so a failed batch does not spam.
 */
export async function reportProviderCreditFailure(opts: {
  tenantId: string;
  alert: ProviderCreditAlert;
}): Promise<ProviderCreditAlert> {
  const { tenantId, alert } = opts;
  const key = dedupeKey(tenantId, alert.tool);
  const now = Date.now();
  const prev = lastSent.get(key) || 0;
  if (now - prev < DEDUPE_MS) return alert;
  lastSent.set(key, now);

  const recent = await prisma.appNotification.findFirst({
    where: {
      tenantId,
      deletedAt: null,
      title: alert.title,
      createdAt: { gte: new Date(now - DEDUPE_MS) },
    },
    select: { id: true },
  });
  if (recent) return alert;

  await createAppNotification({
    tenantId,
    kind: 'warning',
    title: alert.title,
    message: alert.message,
    href: alert.billingUrl,
  });

  try {
    const providers = await resolveProviders(tenantId);
    const body = `${alert.message}\n\nAdd money here: ${alert.billingUrl}`;
    const payload = {
      title: alert.title,
      body,
      actionUrl: alert.billingUrl,
      severity: 'warning' as const,
    };
    const sent: Promise<void>[] = [];
    if (providers.slackWebhookUrl) {
      sent.push(new SlackNotificationProvider(providers.slackWebhookUrl).sendAlert(payload));
    }
    if (providers.teamsWebhookUrl) {
      sent.push(new TeamsNotificationProvider(providers.teamsWebhookUrl).sendAlert(payload));
    }
    if (!sent.length || providers.notificationProvider === 'email') {
      const fallback = createNotificationProvider(providers.notificationProvider, {
        slackWebhookUrl: providers.slackWebhookUrl,
        teamsWebhookUrl: providers.teamsWebhookUrl,
        resendApiKey: providers.resendApiKey,
        notificationEmail: providers.notificationEmail,
      });
      if (providers.notificationProvider === 'email' || !sent.length) {
        sent.push(fallback.sendAlert(payload));
      }
    }
    await Promise.allSettled(sent);
  } catch (err) {
    console.warn('[credits] Slack/Teams notify failed', err);
  }

  return alert;
}

/** Send a 402 JSON body the UI uses to pop the OK dialog. */
export async function replyProviderCredit(
  reply: FastifyReply,
  tenantId: string | undefined,
  err: unknown,
  job?: CreditJob,
): Promise<boolean> {
  const credit = toProviderCreditError(err, undefined, job);
  if (!credit) return false;
  if (tenantId) {
    await reportProviderCreditFailure({ tenantId, alert: credit.toJSON() }).catch(() => undefined);
  }
  await reply.status(402).send({
    success: false,
    error: credit.message,
    code: PROVIDER_CREDITS_CODE,
    data: credit.toJSON(),
  });
  return true;
}

export async function reportIfCreditError(
  tenantId: string | undefined,
  err: unknown,
  job?: CreditJob,
): Promise<ProviderCreditError | null> {
  const credit = toProviderCreditError(err, undefined, job);
  if (!credit || !tenantId) return credit;
  await reportProviderCreditFailure({ tenantId, alert: credit.toJSON() }).catch(() => undefined);
  return credit;
}
