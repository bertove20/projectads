import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataScope, MembershipStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { notFound } from '../common/scope';
import { hashPassword, validatePasswordStrength } from '../auth/password';
import { SYSTEM_ROLES } from '../rbac/permissions';

const ROLE_KEYS = SYSTEM_ROLES.map((r) => r.key);

class CreateOrgDto {
  @IsString() @Length(2, 100) name: string;
  @Matches(/^[a-z0-9-]{2,50}$/) slug: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
}

class UpdateOrgDto {
  @IsOptional() @IsString() @Length(2, 100) name?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
}

class CreateMemberDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(2, 100) name: string;
  /** Wajib bila email belum terdaftar sebagai user. */
  @IsOptional() @IsString() @Length(12, 256) password?: string;
  @IsIn(ROLE_KEYS) roleKey: string;
  @IsEnum(DataScope) dataScope: DataScope;
}

class UpdateMemberDto {
  @IsOptional() @IsIn(ROLE_KEYS) roleKey?: string;
  @IsOptional() @IsEnum(DataScope) dataScope?: DataScope;
  @IsOptional() @IsEnum(MembershipStatus) status?: MembershipStatus;
}

class AssignmentsDto {
  @IsArray() @ArrayMaxSize(1000) @IsUUID('all', { each: true }) @Type(() => String) campaignIds: string[];
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
  ) {}

  /** Membuat organisasi baru (Super Admin saja). Pembuat menjadi Owner. */
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrgDto) {
    if (!user.isSuperAdmin) throw new ForbiddenException({ code: 'SUPER_ADMIN_ONLY', message: 'Hanya Super Admin' });
    if (dto.timezone && !isValidTimezone(dto.timezone)) throw new BadRequestException({ code: 'BAD_TIMEZONE', message: 'Timezone tidak valid' });
    const owner = await this.prisma.role.findFirstOrThrow({ where: { organizationId: null, key: 'OWNER' } });
    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name: dto.name, slug: dto.slug, timezone: dto.timezone ?? 'UTC', currency: dto.currency ?? 'USD' },
      });
      await tx.membership.create({
        data: { userId: user.id, organizationId: created.id, roleId: owner.id, dataScope: 'ALL' },
      });
      await this.audit.log({ organizationId: created.id, actorUserId: user.id, action: 'org.create', entityType: 'organization', entityId: created.id, after: created }, tx);
      return created;
    });
    return org;
  }

  @Get('current')
  @RequirePermissions('org.read')
  async current(@Org() org: OrgContext) {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } });
  }

  @Patch('current')
  @RequirePermissions('org.manage')
  async update(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: UpdateOrgDto) {
    if (dto.timezone && !isValidTimezone(dto.timezone)) throw new BadRequestException({ code: 'BAD_TIMEZONE', message: 'Timezone tidak valid' });
    const before = await this.prisma.organization.findUniqueOrThrow({ where: { id: org.organizationId } });
    const after = await this.prisma.organization.update({ where: { id: org.organizationId }, data: dto });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'org.update', entityType: 'organization', entityId: org.organizationId, before, after });
    return after;
  }

  @Get('current/roles')
  @RequirePermissions('members.read')
  async roles() {
    return this.prisma.role.findMany({
      where: { organizationId: null, isSystem: true },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
      orderBy: { name: 'asc' },
    }).then((roles) =>
      roles.map((r) => ({ key: r.key, name: r.name, description: r.description, permissions: r.permissions.map((p) => p.permission.key) })),
    );
  }

  @Get('current/members')
  @RequirePermissions('members.read')
  async members(@Org() org: OrgContext) {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId: org.organizationId },
      include: {
        user: { select: { id: true, email: true, name: true, mfaEnabled: true, lastLoginAt: true, status: true } },
        role: { select: { key: true, name: true } },
        assignments: { where: { resourceType: 'CAMPAIGN' }, select: { resourceId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      id: m.id,
      user: m.user,
      role: m.role,
      dataScope: m.dataScope,
      status: m.status,
      campaignIds: m.assignments.map((a) => a.resourceId),
      createdAt: m.createdAt,
    }));
  }

  @Post('current/members')
  @RequirePermissions('members.manage')
  async addMember(@Org() org: OrgContext, @CurrentUser() actor: AuthUser, @Body() dto: CreateMemberDto) {
    await this.assertCanGrantRole(org, dto.roleKey);
    const email = dto.email.trim().toLowerCase();
    const role = await this.prisma.role.findFirstOrThrow({ where: { organizationId: null, key: dto.roleKey } });

    return this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email } });
      if (!user) {
        if (!dto.password) throw new BadRequestException({ code: 'PASSWORD_REQUIRED', message: 'Password awal wajib untuk user baru' });
        const weak = validatePasswordStrength(dto.password);
        if (weak) throw new BadRequestException({ code: 'WEAK_PASSWORD', message: weak });
        user = await tx.user.create({ data: { email, name: dto.name, passwordHash: await hashPassword(dto.password) } });
      }
      const exists = await tx.membership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId: org.organizationId } } });
      if (exists) throw new BadRequestException({ code: 'ALREADY_MEMBER', message: 'User sudah menjadi anggota' });
      const membership = await tx.membership.create({
        data: { userId: user.id, organizationId: org.organizationId, roleId: role.id, dataScope: dto.dataScope },
      });
      await this.audit.log({ organizationId: org.organizationId, actorUserId: actor.id, action: 'member.add', entityType: 'membership', entityId: membership.id, after: { email, roleKey: dto.roleKey, dataScope: dto.dataScope } }, tx);
      return { id: membership.id, userId: user.id };
    });
  }

  @Patch('current/members/:id')
  @RequirePermissions('members.manage')
  async updateMember(
    @Org() org: OrgContext,
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ) {
    const m = await this.prisma.membership.findFirst({ where: { id, organizationId: org.organizationId }, include: { role: true } });
    if (!m) notFound('Anggota');
    if (m.userId === actor.id) throw new BadRequestException({ code: 'SELF_EDIT', message: 'Tidak dapat mengubah keanggotaan sendiri' });
    await this.assertCanGrantRole(org, m.role.key);
    let roleId: string | undefined;
    if (dto.roleKey) {
      await this.assertCanGrantRole(org, dto.roleKey);
      roleId = (await this.prisma.role.findFirstOrThrow({ where: { organizationId: null, key: dto.roleKey } })).id;
    }
    const updated = await this.prisma.membership.update({
      where: { id },
      data: { roleId, dataScope: dto.dataScope, status: dto.status },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: actor.id, action: 'member.update', entityType: 'membership', entityId: id, before: { roleKey: m.role.key, dataScope: m.dataScope, status: m.status }, after: dto });
    return updated;
  }

  /** Menetapkan daftar campaign untuk anggota dengan cakupan ASSIGNED (menggantikan daftar lama). */
  @Put('current/members/:id/campaigns')
  @RequirePermissions('members.manage')
  async setAssignments(
    @Org() org: OrgContext,
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignmentsDto,
  ) {
    const m = await this.prisma.membership.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!m) notFound('Anggota');
    const ids = [...new Set(dto.campaignIds)];
    const valid = await this.prisma.campaign.count({ where: { organizationId: org.organizationId, id: { in: ids } } });
    if (valid !== ids.length) throw new BadRequestException({ code: 'BAD_CAMPAIGN', message: 'Ada campaign yang bukan milik organisasi ini' });
    await this.prisma.$transaction(async (tx) => {
      await tx.resourceAssignment.deleteMany({ where: { membershipId: id, resourceType: 'CAMPAIGN' } });
      if (ids.length) {
        await tx.resourceAssignment.createMany({ data: ids.map((resourceId) => ({ membershipId: id, resourceType: 'CAMPAIGN' as const, resourceId })) });
      }
      await this.audit.log({ organizationId: org.organizationId, actorUserId: actor.id, action: 'member.assign_campaigns', entityType: 'membership', entityId: id, after: { campaignIds: ids } }, tx);
    });
    return { ok: true, count: ids.length };
  }

  /** Hanya Owner/Super Admin yang dapat memberi atau mencabut role Owner. */
  private async assertCanGrantRole(org: OrgContext, roleKey: string) {
    if (roleKey === 'OWNER' && !org.isSuperAdmin && org.roleKey !== 'OWNER') {
      throw new ForbiddenException({ code: 'ROLE_FORBIDDEN', message: 'Hanya Owner yang dapat mengelola role Owner' });
    }
  }
}
