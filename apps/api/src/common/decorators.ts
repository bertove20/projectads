import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { PermissionKey } from '../rbac/permissions';

export const IS_PUBLIC = 'isPublic';
/** Endpoint tanpa login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_MFA_PENDING = 'allowMfaPending';
/** Endpoint yang boleh diakses sebelum MFA diverifikasi / disiapkan (alur login & setup MFA). */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);

export const REQUIRED_PERMISSIONS = 'requiredPermissions';
/** Endpoint organisasi: wajib header X-Organization-Id dan permission berikut. */
export const RequirePermissions = (...perms: PermissionKey[]) => SetMetadata(REQUIRED_PERMISSIONS, perms);

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  mfaEnabled: boolean;
  sessionId: string;
  mfaVerified: boolean;
}

export interface OrgContext {
  organizationId: string;
  membershipId: string | null;
  roleKey: string | null;
  permissions: Set<string>;
  /** null = semua resource; selain itu daftar ID campaign yang boleh diakses */
  campaignIds: string[] | null;
  isSuperAdmin: boolean;
}

export interface AppRequest extends Request {
  user?: AuthUser;
  org?: OrgContext;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return req.user!;
});

export const Org = createParamDecorator((_: unknown, ctx: ExecutionContext): OrgContext => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  return req.org!;
});

export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.ip;
});
