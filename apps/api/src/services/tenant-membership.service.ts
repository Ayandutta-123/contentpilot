import { UserRole } from '@contentpilot/shared';
import { prisma } from '../lib/prisma';

export type CompanySummary = {
  id: string;
  name: string;
  slug: string;
  role: UserRole;
  companyName: string;
  isActive: boolean;
};

/** Ensure every user has a membership for their home tenant (idempotent). */
export async function backfillMemberships(): Promise<number> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, tenantId: true, role: true },
  });
  let created = 0;
  for (const u of users) {
    const existing = await prisma.tenantMembership.findUnique({
      where: { userId_tenantId: { userId: u.id, tenantId: u.tenantId } },
    });
    if (existing) continue;
    await prisma.tenantMembership.create({
      data: {
        userId: u.id,
        tenantId: u.tenantId,
        role: u.role,
      },
    });
    created += 1;
  }
  return created;
}

export async function ensureMembership(
  userId: string,
  tenantId: string,
  role: UserRole | string = UserRole.ADMIN,
) {
  return prisma.tenantMembership.upsert({
    where: { userId_tenantId: { userId, tenantId } },
    create: { userId, tenantId, role: role as UserRole },
    update: {},
  });
}

export async function listCompaniesForUser(userId: string): Promise<CompanySummary[]> {
  const rows = await prisma.tenantMembership.findMany({
    where: {
      userId,
      tenant: { deletedAt: null, isActive: true },
    },
    include: {
      tenant: {
        include: {
          brandSettings: { select: { companyName: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((m) => ({
    id: m.tenantId,
    name: m.tenant.name,
    slug: m.tenant.slug,
    role: m.role as UserRole,
    companyName: m.tenant.brandSettings?.companyName?.trim() || m.tenant.name,
    isActive: m.tenant.isActive,
  }));
}

export async function getMembership(userId: string, tenantId: string) {
  return prisma.tenantMembership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: { tenant: true },
  });
}

export function slugifyCompanyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'company';
}

export async function uniqueTenantSlug(base: string): Promise<string> {
  let slug = slugifyCompanyName(base);
  let n = 0;
  while (true) {
    const candidate = n === 0 ? slug : `${slug.slice(0, 40)}-${n}`;
    const exists = await prisma.tenant.findUnique({ where: { slug: candidate } });
    if (!exists) return candidate;
    n += 1;
    if (n > 50) throw new Error('Could not allocate a unique company slug');
  }
}
