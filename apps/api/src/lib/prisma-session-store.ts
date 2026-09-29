import type { SessionStore } from '@fastify/session';
import type { Session } from 'fastify';
import { prisma } from './prisma';

type Callback = (err?: Error) => void;
type GetCallback = (err: Error | null, session?: Session | null) => void;

/**
 * Postgres-backed session store so logins survive API restarts / hot reload.
 * Default MemoryStore loses every session whenever tsx watch reloads.
 */
export class PrismaSessionStore implements SessionStore {
  set(sessionId: string, session: Session, callback: Callback): void {
    const expiresAt = extractExpiry(session) ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const data = JSON.stringify(session);
    prisma.authSession
      .upsert({
        where: { sid: sessionId },
        create: { sid: sessionId, data, expiresAt },
        update: { data, expiresAt },
      })
      .then(() => callback())
      .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
  }

  get(sessionId: string, callback: GetCallback): void {
    prisma.authSession
      .findUnique({ where: { sid: sessionId } })
      .then(async (row) => {
        if (!row) {
          callback(null, null);
          return;
        }
        if (row.expiresAt.getTime() < Date.now()) {
          await prisma.authSession.delete({ where: { sid: sessionId } }).catch(() => undefined);
          callback(null, null);
          return;
        }
        callback(null, JSON.parse(row.data) as Session);
      })
      .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
  }

  destroy(sessionId: string, callback: Callback): void {
    prisma.authSession
      .deleteMany({ where: { sid: sessionId } })
      .then(() => callback())
      .catch((err) => callback(err instanceof Error ? err : new Error(String(err))));
  }
}

function extractExpiry(session: Session): Date | null {
  const cookie = (session as Session & { cookie?: { expires?: string | Date; maxAge?: number } }).cookie;
  if (!cookie) return null;
  if (cookie.expires) return new Date(cookie.expires);
  if (typeof cookie.maxAge === 'number') return new Date(Date.now() + cookie.maxAge);
  return null;
}

/** Occasional cleanup of expired rows */
export async function purgeExpiredSessions(): Promise<void> {
  try {
    await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch {
    // ignore
  }
}
