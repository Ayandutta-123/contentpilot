/**
 * Real Resend connectivity check.
 * Usage:
 *   RESEND_API_KEY=re_xxx NOTIFICATION_TO_EMAIL=you@domain.com npx tsx scripts/verify-resend.ts
 * Or with keys already in Settings / .env:
 *   npx tsx scripts/verify-resend.ts
 */
import { prisma } from '../src/lib/prisma';
import { config } from '../src/config';
import { resolveProviders } from '../src/services/providers.service';
import { sendTestEmailAlert } from '../src/providers/notifications';

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  if (!tenant) throw new Error('no tenant');

  const providers = await resolveProviders(tenant.id);
  const keySet = Boolean(providers.resendApiKey || config.RESEND_API_KEY);
  const to = providers.notificationEmail || config.NOTIFICATION_TO_EMAIL || '';
  console.log('tenant', tenant.name);
  console.log('resendApiKeyConfigured', keySet);
  console.log('notificationEmailConfigured', Boolean(to));
  console.log('from', config.NOTIFICATION_FROM_EMAIL || 'ContentPilot <beth.t@example.com> (default)');

  if (!keySet) {
    console.log('RESULT: FAIL — set RESEND_API_KEY in .env or Settings → Alerts');
    process.exit(2);
  }
  if (!to) {
    console.log('RESULT: FAIL — set NOTIFICATION_TO_EMAIL or Settings alert email');
    process.exit(2);
  }

  const result = await sendTestEmailAlert(tenant.id);
  if (!result.ok) {
    console.log('RESULT: FAIL —', result.error);
    process.exit(3);
  }
  console.log('RESULT: OK — Resend accepted test email for', result.to.replace(/(^.).*(@.*$)/, '$1***$2'));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
