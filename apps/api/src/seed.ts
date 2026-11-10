/**
 * Seed idempoten: sinkronisasi permission & role sistem, lalu (opsional) membuat
 * Super Admin + organisasi pertama dari SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 * Aman dijalankan berulang kali (setiap deploy).
 */
import { PrismaClient } from '@prisma/client';
import { hashPassword, validatePasswordStrength } from './auth/password';
import { loadEnv } from './config/env';
import { PERMISSIONS, SYSTEM_ROLES } from './rbac/permissions';

async function main() {
  const env = loadEnv();
  const prisma = new PrismaClient();
  try {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await prisma.permission.upsert({ where: { key }, create: { key, description }, update: { description } });
    }
    const perms = await prisma.permission.findMany();
    const permId = new Map(perms.map((p) => [p.key, p.id]));

    for (const def of SYSTEM_ROLES) {
      const existing = await prisma.role.findFirst({ where: { organizationId: null, key: def.key } });
      const role = existing
        ? await prisma.role.update({ where: { id: existing.id }, data: { name: def.name, description: def.description, isSystem: true } })
        : await prisma.role.create({ data: { key: def.key, name: def.name, description: def.description, isSystem: true } });
      await prisma.$transaction([
        prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
        prisma.rolePermission.createMany({ data: def.permissions.map((k) => ({ roleId: role.id, permissionId: permId.get(k)! })) }),
      ]);
    }
    console.log(`✓ ${perms.length} permission, ${SYSTEM_ROLES.length} role sistem`);

    if (env.SEED_ADMIN_EMAIL && env.SEED_ADMIN_PASSWORD) {
      const email = env.SEED_ADMIN_EMAIL.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        console.log(`• Super Admin ${email} sudah ada — tidak diubah`);
      } else {
        const weak = validatePasswordStrength(env.SEED_ADMIN_PASSWORD);
        if (weak) throw new Error(`SEED_ADMIN_PASSWORD: ${weak}`);
        const owner = await prisma.role.findFirstOrThrow({ where: { organizationId: null, key: 'OWNER' } });
        const slug = env.SEED_ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'org';
        await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { email, name: 'Super Admin', isSuperAdmin: true, passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD!) },
          });
          const org = await tx.organization.upsert({ where: { slug }, create: { name: env.SEED_ORG_NAME, slug }, update: {} });
          await tx.membership.create({ data: { userId: user.id, organizationId: org.id, roleId: owner.id, dataScope: 'ALL' } });
          await tx.auditLog.create({ data: { organizationId: org.id, actorUserId: user.id, action: 'seed.super_admin', entityType: 'user', entityId: user.id } });
        });
        console.log(`✓ Super Admin ${email} dan organisasi "${env.SEED_ORG_NAME}" dibuat. Hapus SEED_ADMIN_PASSWORD dari .env setelah login pertama.`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
