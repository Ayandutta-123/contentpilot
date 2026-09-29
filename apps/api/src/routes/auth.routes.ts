import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { UserRole } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole, logSecurityEvent } from '../middleware/auth';
import {
  backfillMemberships,
  ensureMembership,
  getMembership,
  listCompaniesForUser,
  uniqueTenantSlug,
} from '../services/tenant-membership.service';

const RegisterSchema = z.object({
  tenantName: z.string().min(1).max(100),
  tenantSlug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/).optional(),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  /** Optional — if omitted, picks the user's company (or returns a chooser list). */
  tenantSlug: z.string().optional(),
  /** Optional — switch into this company after password check. */
  tenantId: z.string().uuid().optional(),
});

function saveSession(request: { session: { save: (cb: (err?: Error) => void) => void } }): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((err) => (err ? reject(err) : resolve()));
  });
}

function destroySession(request: { session: { destroy: (cb?: (err?: Error) => void) => void } }): Promise<void> {
  return new Promise((resolve) => {
    try {
      request.session.destroy((err) => {
        if (err) console.warn('[auth] session destroy:', err.message);
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

async function findUserByEmailPassword(email: string, password: string) {
  const candidates = await prisma.user.findMany({
    where: { email: email.toLowerCase(), deletedAt: null, isActive: true },
  });
  for (const user of candidates) {
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (valid) return user;
  }
  return null;
}

function sessionUserPayload(
  user: { id: string; email: string; name: string },
  tenantId: string,
  role: UserRole | string,
  extra?: Record<string, unknown>,
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
    tenantId,
    ...extra,
  };
}

export async function authRoutes(app: FastifyInstance) {
  // Best-effort backfill when auth routes load
  backfillMemberships().catch((err) =>
    console.warn('[memberships] backfill:', err instanceof Error ? err.message : err),
  );

  app.post('/register', async (request, reply) => {
    const body = RegisterSchema.parse(request.body);
    const email = body.email.toLowerCase();
    const slug =
      body.tenantSlug?.trim() ||
      (await uniqueTenantSlug(body.tenantName));

    const existing = await prisma.tenant.findUnique({ where: { slug } });
    if (existing) {
      return reply.status(409).send({ success: false, error: 'Company slug already taken' });
    }

    // If this email already exists, add them as admin of the new company instead of a second user row
    const existingUser = await prisma.user.findFirst({
      where: { email, deletedAt: null, isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const passwordHash = existingUser
      ? existingUser.passwordHash
      : await bcrypt.hash(body.password, 12);

    if (existingUser) {
      const valid = await bcrypt.compare(body.password, existingUser.passwordHash);
      if (!valid) {
        return reply.status(401).send({
          success: false,
          error: 'An account with this email exists. Use the correct password to add a company, or log in and use Add company.',
        });
      }
    }

    const tenant = await prisma.tenant.create({
      data: {
        name: body.tenantName,
        slug,
        brandSettings: {
          create: { companyName: body.tenantName },
        },
        providerSettings: { create: {} },
        ...(existingUser
          ? {}
          : {
              users: {
                create: {
                  email,
                  passwordHash,
                  name: body.name,
                  role: 'admin',
                },
              },
            }),
      },
      include: { users: true },
    });

    const user =
      existingUser ||
      tenant.users[0] ||
      (await prisma.user.findFirstOrThrow({ where: { email, deletedAt: null } }));

    // If we reused an existing user, they still need home tenantId — keep original; only add membership
    if (!existingUser && user.tenantId !== tenant.id) {
      // created via nested create — already on this tenant
    }

    await ensureMembership(user.id, tenant.id, UserRole.ADMIN);

    request.session.userId = user.id;
    request.session.tenantId = tenant.id;
    request.session.role = UserRole.ADMIN;
    await saveSession(request);

    const companies = await listCompaniesForUser(user.id);

    return {
      success: true,
      data: sessionUserPayload(user, tenant.id, UserRole.ADMIN, {
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        companies,
        needsCompanyChoice: false,
      }),
    };
  });

  app.post('/login', async (request, reply) => {
    const body = LoginSchema.parse(request.body);
    const email = body.email.toLowerCase();

    // Legacy path: explicit tenant slug
    if (body.tenantSlug?.trim()) {
      const tenant = await prisma.tenant.findUnique({ where: { slug: body.tenantSlug.trim() } });
      if (!tenant || tenant.deletedAt) {
        await logSecurityEvent(null, 'auth:login_failed', undefined, { email, tenantSlug: body.tenantSlug }, request.ip);
        return reply.status(401).send({ success: false, error: 'Invalid credentials' });
      }

      const user = await prisma.user.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email } },
      });

      // Also allow home-user + membership for this tenant
      let resolved = user;
      if (!resolved || !resolved.isActive || resolved.deletedAt) {
        const byEmail = await findUserByEmailPassword(email, body.password);
        if (!byEmail) {
          await logSecurityEvent(tenant.id, 'auth:login_failed', undefined, { email }, request.ip);
          return reply.status(401).send({ success: false, error: 'Invalid credentials' });
        }
        const mem = await getMembership(byEmail.id, tenant.id);
        if (!mem) {
          await logSecurityEvent(tenant.id, 'auth:login_failed', byEmail.id, { email, reason: 'no_membership' }, request.ip);
          return reply.status(401).send({ success: false, error: 'Invalid credentials' });
        }
        resolved = byEmail;
        const role = mem.role as UserRole;
        await ensureMembership(resolved.id, tenant.id, role);
        request.session.userId = resolved.id;
        request.session.tenantId = tenant.id;
        request.session.role = role;
        await saveSession(request);
        const companies = await listCompaniesForUser(resolved.id);
        return {
          success: true,
          data: sessionUserPayload(resolved, tenant.id, role, {
            tenantName: tenant.name,
            tenantSlug: tenant.slug,
            companies,
            needsCompanyChoice: false,
          }),
        };
      }

      const valid = await bcrypt.compare(body.password, resolved.passwordHash);
      if (!valid) {
        await logSecurityEvent(tenant.id, 'auth:login_failed', resolved.id, {}, request.ip);
        return reply.status(401).send({ success: false, error: 'Invalid credentials' });
      }

      await ensureMembership(resolved.id, tenant.id, resolved.role);
      const mem = await getMembership(resolved.id, tenant.id);
      const role = (mem?.role || resolved.role) as UserRole;

      request.session.userId = resolved.id;
      request.session.tenantId = tenant.id;
      request.session.role = role;
      await saveSession(request);

      const companies = await listCompaniesForUser(resolved.id);
      return {
        success: true,
        data: sessionUserPayload(resolved, tenant.id, role, {
          tenantName: tenant.name,
          tenantSlug: tenant.slug,
          companies,
          needsCompanyChoice: false,
        }),
      };
    }

    // Modern path: email + password → list companies
    const user = await findUserByEmailPassword(email, body.password);
    if (!user) {
      await logSecurityEvent(null, 'auth:login_failed', undefined, { email }, request.ip);
      return reply.status(401).send({ success: false, error: 'Invalid credentials' });
    }

    await ensureMembership(user.id, user.tenantId, user.role);
    const companies = await listCompaniesForUser(user.id);

    if (body.tenantId) {
      const mem = await getMembership(user.id, body.tenantId);
      if (!mem || mem.tenant.deletedAt || !mem.tenant.isActive) {
        return reply.status(403).send({ success: false, error: 'You do not have access to that company' });
      }
      request.session.userId = user.id;
      request.session.tenantId = mem.tenantId;
      request.session.role = mem.role as UserRole;
      await saveSession(request);
      return {
        success: true,
        data: sessionUserPayload(user, mem.tenantId, mem.role, {
          tenantName: mem.tenant.name,
          tenantSlug: mem.tenant.slug,
          companies,
          needsCompanyChoice: false,
        }),
      };
    }

    if (companies.length === 0) {
      return reply.status(403).send({ success: false, error: 'No company access for this account' });
    }

    if (companies.length === 1) {
      const only = companies[0];
      request.session.userId = user.id;
      request.session.tenantId = only.id;
      request.session.role = only.role;
      await saveSession(request);
      return {
        success: true,
        data: sessionUserPayload(user, only.id, only.role, {
          tenantName: only.name,
          tenantSlug: only.slug,
          companies,
          needsCompanyChoice: false,
        }),
      };
    }

    // Multiple companies — authenticate session without binding a tenant yet? 
    // Safer: bind first company temporarily but flag chooser. Better: set userId only.
    // App requireAuth needs tenantId — so return chooser WITHOUT full session, client calls switch after pick.
    // Use a pending session with userId but no tenant — requireAuth would fail.
    // Instead: set session userId + first tenant, return needsCompanyChoice so UI forces picker.
    request.session.userId = user.id;
    request.session.tenantId = companies[0].id;
    request.session.role = companies[0].role;
    await saveSession(request);

    return {
      success: true,
      data: sessionUserPayload(user, companies[0].id, companies[0].role, {
        tenantName: companies[0].name,
        tenantSlug: companies[0].slug,
        companies,
        needsCompanyChoice: true,
      }),
    };
  });

  app.post('/logout', async (request) => {
    await destroySession(request);
    return { success: true };
  });

  app.get('/me', { preHandler: requireAuth }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.session.userId! },
      select: { id: true, email: true, name: true, role: true, tenantId: true },
    });

    await ensureMembership(user.id, user.tenantId, user.role);
    const companies = await listCompaniesForUser(user.id);
    const activeId = request.session.tenantId!;
    const active = companies.find((c) => c.id === activeId);
    const mem = active ? await getMembership(user.id, activeId) : null;
    const role = (mem?.role || request.session.role || user.role) as UserRole;

    if (mem && request.session.role !== role) {
      request.session.role = role;
      await saveSession(request);
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: activeId },
      include: { brandSettings: { select: { companyName: true } } },
    });

    return {
      success: true,
      data: {
            id: user.id,
            email: user.email,
            name: user.name,
            role,
            tenantId: activeId,
        tenantName: tenant?.name || active?.name || '',
        tenantSlug: tenant?.slug || active?.slug || '',
        companyName: tenant?.brandSettings?.companyName || tenant?.name || active?.companyName || '',
        companies,
        needsCompanyChoice: false,
      },
    };
  });

  app.get('/companies', { preHandler: requireAuth }, async (request) => {
    const companies = await listCompaniesForUser(request.session.userId!);
    return {
      success: true,
      data: {
        activeTenantId: request.session.tenantId,
        companies,
      },
    };
  });

  app.post('/switch-company', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({ tenantId: z.string().uuid() }).parse(request.body);
    const mem = await getMembership(request.session.userId!, body.tenantId);
    if (!mem || mem.tenant.deletedAt || !mem.tenant.isActive) {
      return reply.status(403).send({ success: false, error: 'You do not have access to that company' });
    }

    request.session.tenantId = mem.tenantId;
    request.session.role = mem.role as UserRole;
    await saveSession(request);

    await logSecurityEvent(
      mem.tenantId,
      'auth:switch_company',
      request.session.userId,
      { tenantId: mem.tenantId, slug: mem.tenant.slug },
      request.ip,
    );

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: request.session.userId! },
      select: { id: true, email: true, name: true },
    });
    const companies = await listCompaniesForUser(user.id);
    const brand = await prisma.brandSettings.findUnique({
      where: { tenantId: mem.tenantId },
      select: { companyName: true },
    });

    return {
      success: true,
      data: sessionUserPayload(user, mem.tenantId, mem.role, {
        tenantName: mem.tenant.name,
        tenantSlug: mem.tenant.slug,
        companyName: brand?.companyName || mem.tenant.name,
        companies,
        needsCompanyChoice: false,
      }),
    };
  });

  app.post('/companies', { preHandler: requireAuth }, async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(100),
        slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/).optional(),
      })
      .parse(request.body);

    const user = await prisma.user.findFirst({
      where: { id: request.session.userId!, deletedAt: null, isActive: true },
    });
    if (!user) {
      return reply.status(401).send({ success: false, error: 'Not authenticated' });
    }

    const slug = body.slug?.trim() || (await uniqueTenantSlug(body.name));
    const taken = await prisma.tenant.findUnique({ where: { slug } });
    if (taken) {
      return reply.status(409).send({ success: false, error: 'Company slug already taken' });
    }

    const sourceTenantId = request.session.tenantId!;
    const tenant = await prisma.tenant.create({
      data: {
        name: body.name.trim(),
        slug,
        brandSettings: { create: { companyName: body.name.trim() } },
        providerSettings: { create: {} },
      },
    });

    await ensureMembership(user.id, tenant.id, UserRole.ADMIN);

    // Integrations are account-wide — copy keys from the company you were on
    const { copyProviderSettings, syncProviderSettingsAcrossUserCompanies } = await import(
      '../services/providers.service'
    );
    await copyProviderSettings(sourceTenantId, tenant.id);
    await syncProviderSettingsAcrossUserCompanies(user.id, sourceTenantId);

    request.session.tenantId = tenant.id;
    request.session.role = UserRole.ADMIN;
    await saveSession(request);

    await logSecurityEvent(
      tenant.id,
      'auth:create_company',
      user.id,
      { slug: tenant.slug, name: tenant.name },
      request.ip,
    );

    const companies = await listCompaniesForUser(user.id);
    return {
      success: true,
      data: sessionUserPayload(user, tenant.id, UserRole.ADMIN, {
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        companyName: body.name.trim(),
        companies,
        needsCompanyChoice: false,
      }),
    };
  });

  app.post('/change-password', { preHandler: requireAuth }, async (request, reply) => {
    const body = z
      .object({
        currentPassword: z.string().min(1, 'Current password is required'),
        newPassword: z.string().min(8, 'New password must be at least 8 characters'),
        confirmPassword: z.string().min(1, 'Confirm your new password'),
      })
      .refine((v) => v.newPassword === v.confirmPassword, {
        message: 'New password and confirmation do not match',
        path: ['confirmPassword'],
      })
      .refine((v) => v.currentPassword !== v.newPassword, {
        message: 'New password must be different from the current password',
        path: ['newPassword'],
      })
      .parse(request.body);

    const user = await prisma.user.findFirst({
      where: {
        id: request.session.userId!,
        deletedAt: null,
        isActive: true,
      },
    });
    if (!user) {
      return reply.status(401).send({ success: false, error: 'Not authenticated' });
    }

    const valid = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!valid) {
      await logSecurityEvent(
        request.session.tenantId!,
        'auth:change_password_failed',
        user.id,
        { reason: 'bad_current' },
        request.ip,
      );
      return reply.status(400).send({ success: false, error: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await logSecurityEvent(
      request.session.tenantId!,
      'auth:password_changed',
      user.id,
      {},
      request.ip,
    );

    return { success: true, data: { changed: true } };
  });
}

export async function userRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireRole(UserRole.ADMIN) }, async (request) => {
    const memberships = await prisma.tenantMembership.findMany({
      where: { tenantId: request.session.tenantId! },
      include: {
        user: {
          select: { id: true, email: true, name: true, isActive: true, createdAt: true, deletedAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const users = memberships
      .filter((m) => m.user && !m.user.deletedAt)
      .map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        role: m.role,
        isActive: m.user.isActive,
        createdAt: m.user.createdAt,
      }));

    return { success: true, data: users };
  });

  app.patch('/:id/role', { preHandler: requireRole(UserRole.ADMIN) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { role } = request.body as { role: UserRole };
    const tenantId = request.session.tenantId!;

    const mem = await prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: id, tenantId } },
    });
    if (!mem) {
      return reply.status(404).send({ success: false, error: 'User is not a member of this company' });
    }

    const updated = await prisma.tenantMembership.update({
      where: { id: mem.id },
      data: { role },
    });

    // Keep home-user role in sync when this is their home tenant
    await prisma.user.updateMany({
      where: { id, tenantId },
      data: { role },
    });

    await logSecurityEvent(
      tenantId,
      'user:role_changed',
      request.session.userId,
      { targetUserId: id, newRole: role },
      request.ip,
    );

    return { success: true, data: { id, role: updated.role } };
  });
}
