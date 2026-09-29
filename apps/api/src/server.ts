import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { authRoutes, userRoutes } from './routes/auth.routes';
import { contentRoutes, dashboardRoutes } from './routes/content.routes';
import { settingsRoutes } from './routes/settings.routes';
import { notificationRoutes } from './routes/notification.routes';
import { brandRoutes } from './routes/brand.routes';
import { automationRoutes } from './routes/automations.routes';
import { startWorkers } from './workers';
import { PrismaSessionStore, purgeExpiredSessions } from './lib/prisma-session-store';

export async function startApp() {
  const app = Fastify({
    logger: true,
    trustProxy: config.TRUST_PROXY,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX_REQUESTS,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    allowList: (request) => {
      const url = request.url.split('?')[0];
      return (
        url === '/health' ||
        url === '/api/notifications' ||
        url.startsWith('/api/auth/me') ||
        // Competitor thumbs + brand assets — many parallel <img> loads must not 429.
        url.startsWith('/uploads/') ||
        url.startsWith('/api/content/image-proxy')
      );
    },
  });
  await app.register(cookie);

  // Persist sessions in Postgres so hot-reload / redeploys do not log everyone out
  const sessionStore = new PrismaSessionStore();
  await app.register(session, {
    secret: config.SESSION_SECRET,
    store: sessionStore,
    cookieName: config.COOKIE_NAME,
    rolling: true,
    saveUninitialized: false,
    cookie: {
      // Never force Secure on plain http://localhost — browsers drop the cookie
      secure: config.COOKIE_SECURE,
      httpOnly: true,
      sameSite: config.COOKIE_SAME_SITE,
      domain: config.COOKIE_DOMAIN || undefined,
      maxAge: config.SESSION_MAX_AGE_MS,
      path: '/',
    },
  });

  setInterval(() => {
    purgeExpiredSessions().catch(() => undefined);
  }, 60 * 60 * 1000).unref?.();
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });
  await app.register(websocket);

  const uploadRoot = path.resolve(config.UPLOAD_DIR);
  fs.mkdirSync(uploadRoot, { recursive: true });
  console.log(`[uploads] Serving files from ${uploadRoot}`);
  await app.register(fastifyStatic, {
    root: uploadRoot,
    prefix: '/uploads/',
    decorateReply: false,
    // Serve original bytes with correct type — never recompress on read
    setHeaders(res, filePath) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      // Allow <img> loads even if the browser hits the API origin directly.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (/\.svg$/i.test(filePath)) res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    },
  });

  app.get('/health', async () => ({
    status: 'ok',
    app: config.APP_NAME,
    timestamp: new Date().toISOString(),
    database: 'postgresql',
  }));

  app.register(async (wsApp) => {
    wsApp.get('/ws', { websocket: true }, (socket) => {
      socket.on('message', (message: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const data = JSON.parse(message.toString());
          if (data.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch { /* ignore */ }
      });
    });
  });

  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(userRoutes, { prefix: '/api/users' });
  app.register(contentRoutes, { prefix: '/api/content' });
  app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  app.register(settingsRoutes, { prefix: '/api/settings' });
  app.register(notificationRoutes, { prefix: '/api/notifications' });
  app.register(brandRoutes, { prefix: '/api/brand' });
  app.register(automationRoutes, { prefix: '/api/automations' });

  app.setErrorHandler(async (error: Error & { statusCode?: number; code?: string }, request, reply) => {
    if (reply.sent) return reply;
    // Zod validation → 400 with readable message
    if (error.name === 'ZodError' || error.code === 'FST_ERR_VALIDATION') {
      const zodIssues = (error as Error & { issues?: Array<{ path: (string | number)[]; message: string }> }).issues;
      const details = zodIssues?.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      const message = details || error.message || 'Invalid request';
      request.log.warn({ err: error }, message);
      return reply.status(400).send({ success: false, error: message });
    }

    const { replyProviderCredit } = await import('./services/provider-credit-alert.service');
    if (await replyProviderCredit(reply, request.session?.tenantId, error)) {
      return reply;
    }

    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const message = error.message || 'Internal Server Error';
    if (status >= 500) {
      request.log.error({ err: error }, message);
    } else {
      request.log.warn({ err: error }, message);
    }
    return reply.status(status).send({ success: false, error: message });
  });

  startWorkers();

  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  console.log(`${config.APP_NAME} API listening on ${config.API_HOST}:${config.API_PORT}`);
  return app;
}
