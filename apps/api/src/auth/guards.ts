import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENV, Env } from '../config/env';
import {
  ALLOW_MFA_PENDING,
  AppRequest,
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
} from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { ADMIN_ROLE_KEYS, ALL_PERMISSIONS } from '../rbac/permissions';
import { SESSION_COOKIE, SessionService } from './session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guard global #1: autentikasi session, status MFA, dan pemeriksaan Origin (CSRF).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    this.checkOrigin(req);

    const session = await this.sessions.resolve(req.cookies?.[SESSION_COOKIE]);
    if (!session) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Silakan login' });

    const { user } = session;
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperAdmin: user.isSuperAdmin,
      mfaEnabled: user.mfaEnabled,
      sessionId: session.id,
      mfaVerified: session.mfaVerified,
    };

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_PENDING, [ctx.getHandler(), ctx.getClass()]);
    if (allowPending) return true;

    if (user.mfaEnabled && !session.mfaVerified) {
      throw new UnauthorizedException({ code: 'MFA_REQUIRED', message: 'Verifikasi MFA diperlukan' });
    }
    if (!user.mfaEnabled && this.env.MFA_ENFORCE_ADMIN && (await this.isAdmin(user.id, user.isSuperAdmin))) {
      throw new ForbiddenException({ code: 'MFA_SETUP_REQUIRED', message: 'Administrator wajib mengaktifkan MFA' });
    }
    return true;
  }

  private checkOrigin(req: AppRequest) {
    if (SAFE_METHODS.has(req.method)) return;
    const origin = req.headers.origin;
    // Browser selalu mengirim Origin pada request non-GET lintas situs; klien non-browser boleh tanpa Origin.
    if (origin && origin !== this.env.DASHBOARD_ORIGIN) {
      throw new ForbiddenException({ code: 'BAD_ORIGIN', message: 'Origin tidak diizinkan' });
    }
  }

  async isAdmin(userId: string, isSuperAdmin: boolean): Promise<boolean> {
    if (isSuperAdmin) return true;
    const count = await this.prisma.membership.count({
      where: { userId, status: 'ACTIVE', role: { key: { in: ADMIN_ROLE_KEYS } } },
    });
    return count > 0;
  }
}

/**
 * Guard global #2: konteks organisasi (header X-Organization-Id), permission, dan cakupan data.
 * Hanya aktif pada endpoint yang memakai @RequirePermissions().
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const user = req.user;
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Silakan login' });

    const orgId = req.header('x-organization-id');
    if (!orgId || !UUID_RE.test(orgId)) {
      throw new BadRequestException({ code: 'ORG_REQUIRED', message: 'Header X-Organization-Id wajib diisi' });
    }

    if (user.isSuperAdmin) {
      const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } });
      if (!org) throw new ForbiddenException({ code: 'ORG_FORBIDDEN', message: 'Organisasi tidak ditemukan' });
      // Super Admin bisa sekaligus anggota organisasi (owner kartu, catatan waktu, "Tugas saya").
      const own = await this.prisma.membership.findUnique({
        where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
        select: { id: true, status: true },
      });
      req.org = {
        organizationId: orgId,
        membershipId: own?.status === 'ACTIVE' ? own.id : null,
        roleKey: 'SUPER_ADMIN',
        permissions: new Set(ALL_PERMISSIONS),
        campaignIds: null,
        isSuperAdmin: true,
      };
      return true;
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: orgId } },
      include: {
        organization: { select: { status: true } },
        role: { include: { permissions: { include: { permission: true } } } },
        assignments: { where: { resourceType: 'CAMPAIGN' }, select: { resourceId: true } },
      },
    });
    // Respons sama untuk "bukan anggota" dan "tidak ada" agar tidak membocorkan keberadaan organisasi.
    if (!membership || membership.status !== 'ACTIVE' || membership.organization.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ORG_FORBIDDEN', message: 'Tidak memiliki akses ke organisasi ini' });
    }

    const permissions = new Set(membership.role.permissions.map((rp) => rp.permission.key));
    const missing = required.filter((p) => !permissions.has(p));
    if (missing.length) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: 'Tidak memiliki izin', missing });
    }

    req.org = {
      organizationId: orgId,
      membershipId: membership.id,
      roleKey: membership.role.key,
      permissions,
      campaignIds: membership.dataScope === 'ALL' ? null : membership.assignments.map((a) => a.resourceId),
      isSuperAdmin: false,
    };
    return true;
  }
}
