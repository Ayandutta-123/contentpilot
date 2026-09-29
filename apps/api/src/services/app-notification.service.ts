import { prisma } from '../lib/prisma';

export type NotifyKind = 'info' | 'success' | 'error' | 'warning';

export async function createAppNotification(input: {
  tenantId: string;
  userId?: string;
  kind: NotifyKind;
  title: string;
  message?: string;
  href?: string;
}) {
  return prisma.appNotification.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      kind: input.kind,
      title: input.title,
      message: input.message ?? '',
      href: input.href,
    },
  });
}

export async function listNotifications(tenantId: string, opts?: { unreadOnly?: boolean }) {
  return prisma.appNotification.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(opts?.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function markNotificationRead(tenantId: string, id: string) {
  await prisma.appNotification.updateMany({
    where: { id, tenantId, deletedAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(tenantId: string) {
  await prisma.appNotification.updateMany({
    where: { tenantId, deletedAt: null, readAt: null },
    data: { readAt: new Date() },
  });
}

/** Soft-clear all notifications for tenant (never hard-delete) */
export async function clearNotifications(tenantId: string) {
  await prisma.appNotification.updateMany({
    where: { tenantId, deletedAt: null },
    data: { deletedAt: new Date(), readAt: new Date() },
  });
}

/** Soft-delete selected notification IDs */
export async function deleteNotificationsByIds(tenantId: string, ids: string[]) {
  if (!ids.length) return { count: 0 };
  const result = await prisma.appNotification.updateMany({
    where: { tenantId, deletedAt: null, id: { in: ids } },
    data: { deletedAt: new Date(), readAt: new Date() },
  });
  return { count: result.count };
}

export async function notifySuccess(tenantId: string, title: string, message?: string, href?: string) {
  return createAppNotification({ tenantId, kind: 'success', title, message, href });
}

export async function notifyError(tenantId: string, title: string, message?: string, href?: string) {
  return createAppNotification({ tenantId, kind: 'error', title, message, href });
}
