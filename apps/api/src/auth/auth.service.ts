import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type Redis from 'ioredis';
import { authenticator } from 'otplib';
import { AuditService } from '../common/audit/audit.service';
import { REDIS } from '../common/core.module';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { ENV, Env } from '../config/env';
import { AuthGuard } from './guards';
import { getDummyHash, hashPassword, validatePasswordStrength, verifyPassword } from './password';
import { SessionService } from './session.service';

const MAX_FAILED = 10;
const LOCK_MINUTES = 15;
const MFA_ISSUER = 'EAIP';

authenticator.options = { window: 1 };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly authGuard: AuthGuard,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(email: string, password: string, ip?: string, userAgent?: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    const invalid = () => new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Email atau password salah' });

    if (!user) {
      await verifyPassword(await getDummyHash(), password);
      throw invalid();
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException({ code: 'ACCOUNT_LOCKED', message: 'Akun dikunci sementara. Coba lagi nanti.' });
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok || user.status !== 'ACTIVE') {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
        },
      });
      await this.audit.log({
        actorUserId: user.id,
        action: failed >= MAX_FAILED ? 'auth.locked' : 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        ipHash: this.crypto.hashIp(ip),
      });
      throw invalid();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const { token } = await this.sessions.create(user.id, false, ip, userAgent);
    await this.audit.log({ actorUserId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id, ipHash: this.crypto.hashIp(ip) });

    return {
      token,
      mfaRequired: user.mfaEnabled,
      mfaSetupRequired: !user.mfaEnabled && this.env.MFA_ENFORCE_ADMIN && (await this.authGuard.isAdmin(user.id, user.isSuperAdmin)),
    };
  }

  async me(userId: string, sessionMfaVerified: boolean) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: 'ACTIVE', organization: { status: 'ACTIVE' } },
          include: {
            organization: { select: { id: true, name: true, slug: true, timezone: true, currency: true } },
            role: { include: { permissions: { include: { permission: true } } } },
          },
        },
      },
    });
    const organizations = user.isSuperAdmin
      ? (await this.prisma.organization.findMany({ orderBy: { name: 'asc' } })).map((o) => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          timezone: o.timezone,
          currency: o.currency,
          role: { key: 'SUPER_ADMIN', name: 'Super Admin' },
          dataScope: 'ALL',
          permissions: ['*'],
        }))
      : user.memberships.map((m) => ({
          ...m.organization,
          role: { key: m.role.key, name: m.role.name },
          dataScope: m.dataScope,
          permissions: m.role.permissions.map((rp) => rp.permission.key),
        }));

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
      mfaEnabled: user.mfaEnabled,
      mfaRequired: user.mfaEnabled && !sessionMfaVerified,
      mfaSetupRequired: !user.mfaEnabled && this.env.MFA_ENFORCE_ADMIN && (await this.authGuard.isAdmin(user.id, user.isSuperAdmin)),
      organizations,
    };
  }

  async beginMfaSetup(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) throw new BadRequestException({ code: 'MFA_ALREADY_ENABLED', message: 'MFA sudah aktif' });
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecretEnc: this.crypto.encrypt(secret) } });
    return { secret, otpauthUrl: authenticator.keyuri(user.email, MFA_ISSUER, secret) };
  }

  async enableMfa(userId: string, sessionId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) throw new BadRequestException({ code: 'MFA_ALREADY_ENABLED', message: 'MFA sudah aktif' });
    if (!user.mfaSecretEnc) throw new BadRequestException({ code: 'MFA_NOT_STARTED', message: 'Mulai setup MFA terlebih dahulu' });
    await this.assertTotp(user.id, this.crypto.decrypt(user.mfaSecretEnc), code);
    await this.prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
    await this.sessions.markMfaVerified(sessionId);
    await this.sessions.revokeAllForUser(userId, sessionId);
    await this.audit.log({ actorUserId: userId, action: 'auth.mfa_enabled', entityType: 'user', entityId: userId });
  }

  async verifyMfa(userId: string, sessionId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabled || !user.mfaSecretEnc) {
      throw new BadRequestException({ code: 'MFA_NOT_ENABLED', message: 'MFA belum aktif' });
    }
    await this.assertTotp(user.id, this.crypto.decrypt(user.mfaSecretEnc), code);
    await this.sessions.markMfaVerified(sessionId);
    await this.audit.log({ actorUserId: userId, action: 'auth.mfa_verified', entityType: 'user', entityId: userId });
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, current))) {
      throw new BadRequestException({ code: 'INVALID_PASSWORD', message: 'Password saat ini salah' });
    }
    const weak = validatePasswordStrength(next);
    if (weak) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: weak });
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
    await this.sessions.revokeAllForUser(userId, sessionId);
    await this.audit.log({ actorUserId: userId, action: 'auth.password_changed', entityType: 'user', entityId: userId });
  }

  /** Verifikasi TOTP dengan perlindungan replay (kode yang sama tidak bisa dipakai dua kali). */
  private async assertTotp(userId: string, secret: string, code: string) {
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean) || !authenticator.verify({ token: clean, secret })) {
      throw new UnauthorizedException({ code: 'INVALID_MFA_CODE', message: 'Kode MFA salah' });
    }
    const fresh = await this.redis.set(`mfa:used:${userId}:${clean}`, '1', 'EX', 120, 'NX');
    if (fresh !== 'OK') throw new UnauthorizedException({ code: 'MFA_CODE_REUSED', message: 'Kode MFA sudah dipakai' });
  }
}
