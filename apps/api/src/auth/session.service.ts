import { Inject, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { ENV, Env } from '../config/env';
import { CryptoService } from '../common/crypto/crypto.service';
import { PrismaService } from '../common/prisma/prisma.service';

export const SESSION_COOKIE = 'eaip_session';
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(userId: string, mfaVerified: boolean, ip?: string, userAgent?: string) {
    const token = this.crypto.randomToken(32);
    const expiresAt = new Date(Date.now() + this.env.SESSION_ABSOLUTE_DAYS * 86400_000);
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: this.crypto.sha256(token),
        mfaVerified,
        ip: this.crypto.hashIp(ip),
        userAgent: userAgent?.slice(0, 300),
        expiresAt,
      },
    });
    return { token, session };
  }

  /** Mengembalikan session aktif beserta user, atau null. */
  async resolve(token: string | undefined) {
    if (!token || token.length > 128) return null;
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: this.crypto.sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt) return null;
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) return null;
    if (session.lastSeenAt.getTime() + this.env.SESSION_TTL_HOURS * 3600_000 <= now) return null;
    if (session.user.status !== 'ACTIVE') return null;
    if (session.createdAt < session.user.passwordChangedAt) return null;

    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return session;
  }

  async markMfaVerified(sessionId: string) {
    await this.prisma.session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
  }

  async revoke(sessionId: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string) {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  setCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      maxAge: this.env.SESSION_ABSOLUTE_DAYS * 86400_000,
    });
  }

  clearCookie(res: Response) {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: this.env.COOKIE_SECURE, sameSite: 'lax', path: '/' });
  }
}
