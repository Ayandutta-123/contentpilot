import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  clearNotifications,
  deleteNotificationsByIds,
} from '../services/app-notification.service';

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireAuth }, async (request) => {
    const unreadOnly = (request.query as { unread?: string }).unread === '1';
    const items = await listNotifications(request.session.tenantId!, { unreadOnly });
    const unreadCount = items.filter((n) => !n.readAt).length;
    return { success: true, data: { items, unreadCount } };
  });

  app.post('/read-all', { preHandler: requireAuth }, async (request) => {
    await markAllNotificationsRead(request.session.tenantId!);
    return { success: true };
  });

  app.post('/bulk-delete', { preHandler: requireAuth }, async (request) => {
    const body = z.object({
      ids: z.array(z.string().min(1)).min(1).max(200),
    }).parse(request.body);
    const serverIds = body.ids.filter((id) => !id.startsWith('local-'));
    const result = await deleteNotificationsByIds(request.session.tenantId!, serverIds);
    return { success: true, data: result };
  });

  app.delete('/', { preHandler: requireAuth }, async (request) => {
    await clearNotifications(request.session.tenantId!);
    return { success: true, data: { cleared: true } };
  });

  app.post('/:id/read', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    await markNotificationRead(request.session.tenantId!, id);
    return { success: true };
  });
}
