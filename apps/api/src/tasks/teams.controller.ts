import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Position } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsEnum, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateIf } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertFullScope, notFound } from '../common/scope';

/** Label & fokus kerja tiap jabatan (read.md 19.1) — dipakai dashboard & AI Assistant (Phase 5). */
export const POSITIONS: Record<Position, { label: string; focus: string }> = {
  ADS_MANAGER: { label: 'Ads Manager', focus: 'Strategi, budget, approval, dan performa tim' },
  MEDIA_BUYER: { label: 'Media Buyer', focus: 'Eksekusi campaign, bid, budget harian, zone/placement' },
  ADS_ANALYST: { label: 'Ads Analyst', focus: 'Analisis performa, laporan, rekomendasi optimasi' },
  TRACKING_SPECIALIST: { label: 'Tracking Specialist', focus: 'Tracking, postback, domain, rekonsiliasi konversi' },
  FRAUD_ANALYST: { label: 'Fraud Analyst', focus: 'Traffic tidak valid, zone mencurigakan, blacklist' },
  CREATIVE_SPECIALIST: { label: 'Creative Specialist', focus: 'Materi iklan, variasi creative, CTR' },
  LANDING_PAGE_SPECIALIST: { label: 'Landing Page Specialist', focus: 'Landing page, split test, kecepatan, funnel' },
  AUTOMATION_SPECIALIST: { label: 'Automation Specialist', focus: 'Aturan otomatis, integrasi, alert' },
};

class TeamDto {
  @IsString() @Length(2, 80) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() leadMembershipId?: string | null;
}
class UpdateTeamDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() leadMembershipId?: string | null;
}
class TeamMembersDto {
  @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) membershipIds: string[];
}
class PositionsDto {
  @IsArray() @ArrayMaxSize(8) @IsEnum(Position, { each: true }) positions: Position[];
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsEnum(Position) primary?: Position | null;
}

@ApiTags('teams')
@Controller()
export class TeamsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('positions')
  @RequirePermissions('tasks.read')
  positions() {
    return Object.entries(POSITIONS).map(([key, v]) => ({ key, ...v }));
  }

  /**
   * Direktori anggota untuk memilih owner/assignee/mention. Hanya nama, role, jabatan, dan tim —
   * tanpa email (detail kontak tetap di balik members.read).
   */
  @Get('people')
  @RequirePermissions('tasks.read')
  async people(@Org() org: OrgContext) {
    const rows = await this.prisma.membership.findMany({
      where: { organizationId: org.organizationId, status: 'ACTIVE' },
      select: {
        id: true,
        user: { select: { name: true } },
        role: { select: { key: true, name: true } },
        positions: { select: { position: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        teams: { select: { team: { select: { id: true, name: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      id: m.id,
      name: m.user.name,
      role: m.role,
      positions: m.positions.map((p) => p.position),
      primaryPosition: m.positions.find((p) => p.isPrimary)?.position ?? null,
      teams: m.teams.map((t) => t.team),
      isMe: m.id === org.membershipId,
    }));
  }

  @Put('people/:id/positions')
  @RequirePermissions('teams.manage')
  async setPositions(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PositionsDto) {
    assertFullScope(org);
    const m = await this.prisma.membership.findFirst({ where: { id, organizationId: org.organizationId }, include: { positions: true } });
    if (!m) notFound('Anggota');
    const positions = [...new Set(dto.positions)];
    const primary = dto.primary ?? positions[0] ?? null;
    if (primary && !positions.includes(primary)) throw new BadRequestException({ code: 'BAD_PRIMARY', message: 'Jabatan utama harus termasuk dalam daftar jabatan' });
    await this.prisma.$transaction(async (tx) => {
      await tx.membershipPosition.deleteMany({ where: { membershipId: id } });
      if (positions.length) await tx.membershipPosition.createMany({ data: positions.map((position) => ({ membershipId: id, position, isPrimary: position === primary })) });
      await this.audit.log(
        { organizationId: org.organizationId, actorUserId: user.id, action: 'member.positions', entityType: 'membership', entityId: id, before: { positions: m.positions.map((p) => p.position) }, after: { positions, primary } },
        tx,
      );
    });
    return { ok: true, positions, primary };
  }

  @Get('teams')
  @RequirePermissions('tasks.read')
  async teams(@Org() org: OrgContext) {
    const teams = await this.prisma.team.findMany({
      where: { organizationId: org.organizationId },
      include: {
        lead: { select: { id: true, user: { select: { name: true } } } },
        members: { select: { membership: { select: { id: true, user: { select: { name: true } } } } } },
        _count: { select: { boards: true } },
      },
      orderBy: { name: 'asc' },
    });
    return teams.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      lead: t.lead ? { id: t.lead.id, name: t.lead.user.name } : null,
      members: t.members.map((m) => ({ id: m.membership.id, name: m.membership.user.name })),
      boards: t._count.boards,
    }));
  }

  @Post('teams')
  @RequirePermissions('teams.manage')
  async createTeam(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: TeamDto) {
    assertFullScope(org);
    if (dto.leadMembershipId) await this.assertMembers(org, [dto.leadMembershipId]);
    const name = dto.name.trim();
    if (await this.prisma.team.count({ where: { organizationId: org.organizationId, name } })) {
      throw new BadRequestException({ code: 'TEAM_EXISTS', message: 'Nama tim sudah dipakai' });
    }
    const team = await this.prisma.team.create({
      data: {
        organizationId: org.organizationId,
        name,
        description: dto.description,
        leadMembershipId: dto.leadMembershipId,
        // Ketua otomatis menjadi anggota tim.
        members: dto.leadMembershipId ? { create: { membershipId: dto.leadMembershipId } } : undefined,
      },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'team.create', entityType: 'team', entityId: team.id, after: { name } });
    return team;
  }

  @Patch('teams/:id')
  @RequirePermissions('teams.manage')
  async updateTeam(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeamDto) {
    assertFullScope(org);
    const t = await this.prisma.team.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!t) notFound('Tim');
    if (dto.leadMembershipId) await this.assertMembers(org, [dto.leadMembershipId]);
    const name = dto.name?.trim();
    if (name && name !== t.name && (await this.prisma.team.count({ where: { organizationId: org.organizationId, name } }))) {
      throw new BadRequestException({ code: 'TEAM_EXISTS', message: 'Nama tim sudah dipakai' });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.team.update({ where: { id }, data: { name, description: dto.description, leadMembershipId: dto.leadMembershipId } });
      if (dto.leadMembershipId) {
        await tx.teamMember.upsert({ where: { teamId_membershipId: { teamId: id, membershipId: dto.leadMembershipId } }, create: { teamId: id, membershipId: dto.leadMembershipId }, update: {} });
      }
      return u;
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'team.update', entityType: 'team', entityId: id, before: { name: t.name, leadMembershipId: t.leadMembershipId }, after: dto });
    return updated;
  }

  @Put('teams/:id/members')
  @RequirePermissions('teams.manage')
  async setMembers(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TeamMembersDto) {
    assertFullScope(org);
    const t = await this.prisma.team.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!t) notFound('Tim');
    const ids = [...new Set(dto.membershipIds)];
    if (t.leadMembershipId && !ids.includes(t.leadMembershipId)) ids.push(t.leadMembershipId);
    await this.assertMembers(org, ids);
    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({ where: { teamId: id, membershipId: { notIn: ids } } });
      if (ids.length) await tx.teamMember.createMany({ data: ids.map((membershipId) => ({ teamId: id, membershipId })), skipDuplicates: true });
      await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'team.members', entityType: 'team', entityId: id, after: { count: ids.length } }, tx);
    });
    return { ok: true, count: ids.length };
  }

  @Delete('teams/:id')
  @RequirePermissions('teams.manage')
  async deleteTeam(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    assertFullScope(org);
    const t = await this.prisma.team.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!t) notFound('Tim');
    // Board & kartu milik tim tetap ada (teamId → null).
    await this.prisma.team.delete({ where: { id } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'team.delete', entityType: 'team', entityId: id, before: { name: t.name } });
    return { ok: true };
  }

  private async assertMembers(org: OrgContext, ids: string[]) {
    if (!ids.length) return;
    const n = await this.prisma.membership.count({ where: { id: { in: ids }, organizationId: org.organizationId } });
    if (n !== ids.length) throw new BadRequestException({ code: 'BAD_MEMBER', message: 'Ada anggota yang bukan milik organisasi ini' });
  }
}
