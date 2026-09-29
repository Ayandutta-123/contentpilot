import { FastifyRequest, FastifyReply } from 'fastify';
import { UserRole } from '@contentpilot/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

declare module 'fastify' {
  interface Session {
    userId?: string;
    tenantId?: string;
    role?: UserRole;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.session.userId || !request.session.tenantId) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }
}

export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply);
    if (reply.sent) return;

    if (!request.session.role || !roles.includes(request.session.role)) {
      return reply.status(403).send({ success: false, error: 'Insufficient permissions' });
    }
  };
}

export async function logSecurityEvent(
  tenantId: string | null | undefined,
  event: string,
  userId?: string | null,
  details?: Prisma.InputJsonValue,
  ipAddress?: string,
) {
  try {
    // Unknown-tenant attempts must not use fake IDs (breaks FK). Log to console only.
    if (!tenantId || tenantId === 'unknown') {
      console.warn('[security-log]', event, { tenantId: null, userId, details, ipAddress });
      return;
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) {
      console.warn('[security-log]', event, { tenantId: 'missing', details, ipAddress });
      return;
    }

    let validUserId: string | null = null;
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      validUserId = user?.id ?? null;
    }

    await prisma.securityLog.create({
      data: {
        tenantId: tenant.id,
        userId: validUserId,
        event,
        details: details ?? undefined,
        ipAddress,
      },
    });
  } catch (err) {
    // Never let audit logging break auth flows
    console.error('[security-log]', err instanceof Error ? err.message : err);
  }
}
