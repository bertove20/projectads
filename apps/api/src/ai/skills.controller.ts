import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Position, Prisma, SkillRisk } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsOptional, IsString, Length, MaxLength, ValidateIf } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertFullScope, notFound } from '../common/scope';
import { parseSkillMd, SKILL_MD_MAX } from './ai-core';
import { AiToolsService } from './ai-tools';
import { AiService } from './ai.service';

class CreateSkillDto {
  @IsString() @MaxLength(SKILL_MD_MAX) skillMd: string;
  @IsString() @Length(2, 40) category: string;
  @IsArray() @ArrayMaxSize(8) @IsEnum(Position, { each: true }) positions: Position[];
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tools: string[];
  @IsEnum(SkillRisk) riskClass: SkillRisk;
  /** IMPORTED = berasal dari luar (repository/rujukan) → untrusted sampai direview */
  @IsIn(['CUSTOM', 'IMPORTED']) source: 'CUSTOM' | 'IMPORTED';
  @IsOptional() @IsArray() @ArrayMaxSize(30) testCases?: unknown[];
}
class VersionDto {
  @IsString() @MaxLength(SKILL_MD_MAX) skillMd: string;
  @IsOptional() @IsString() @MaxLength(1000) changelog?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) testCases?: unknown[];
}
class ReviewDto {
  @IsIn(['APPROVE', 'REJECT']) decision: 'APPROVE' | 'REJECT';
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
class UpdateSkillDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @Length(2, 40) category?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsEnum(Position, { each: true }) positions?: Position[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tools?: string[];
  @IsOptional() @IsEnum(SkillRisk) riskClass?: SkillRisk;
}
class AssignDto {
  /** true/false = override; null = ikut jabatan */
  @ValidateIf((_o, v) => v !== null) @IsBoolean() enabled: boolean | null;
}

@ApiTags('ai-skills')
@Controller('ai')
export class SkillsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly tools: AiToolsService,
    private readonly audit: AuditService,
  ) {}

  @Get('skills')
  @RequirePermissions('ai.use')
  async list(@Org() org: OrgContext) {
    await this.ai.ensureBuiltins(org.organizationId);
    const rows = await this.prisma.aiSkill.findMany({
      where: { organizationId: org.organizationId },
      include: { activeVersion: { select: { version: true, reviewedAt: true } }, versions: { select: { id: true, version: true, review: true, createdAt: true }, orderBy: { version: 'desc' }, take: 1 }, _count: { select: { assignments: true } } },
      orderBy: [{ source: 'asc' }, { name: 'asc' }],
    });
    return rows.map(({ versions, _count, ...s }) => ({ ...s, latestVersion: versions[0] ?? null, overrides: _count.assignments }));
  }

  @Get('skills/:id')
  @RequirePermissions('ai.use')
  async get(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    const s = await this.prisma.aiSkill.findFirst({
      where: { id, organizationId: org.organizationId },
      include: { versions: { orderBy: { version: 'desc' } }, assignments: { include: { membership: { select: { id: true, user: { select: { name: true } } } } } } },
    });
    if (!s) notFound('Skill');
    return { ...s, assignments: s.assignments.map((a) => ({ membershipId: a.membershipId, name: a.membership.user.name, enabled: a.enabled })), availableTools: Object.keys(this.tools.defs) };
  }

  @Post('skills')
  @RequirePermissions('ai.manage')
  async create(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: CreateSkillDto) {
    assertFullScope(org);
    const meta = parseSkillMd(dto.skillMd);
    if ('error' in meta) throw new BadRequestException({ code: 'BAD_SKILL_MD', message: meta.error });
    this.assertTools(dto.tools);
    if (await this.prisma.aiSkill.count({ where: { organizationId: org.organizationId, key: meta.name } })) {
      throw new BadRequestException({ code: 'SKILL_EXISTS', message: `Skill "${meta.name}" sudah ada — buat versi baru` });
    }
    const skill = await this.prisma.$transaction(async (tx) => {
      const s = await tx.aiSkill.create({
        data: {
          organizationId: org.organizationId,
          key: meta.name,
          name: meta.name.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
          description: meta.description,
          category: dto.category.trim(),
          positions: [...new Set(dto.positions)],
          tools: [...new Set(dto.tools)],
          riskClass: dto.riskClass,
          source: dto.source,
          enabled: true,
        },
      });
      await tx.aiSkillVersion.create({ data: { skillId: s.id, version: 1, skillMd: dto.skillMd, testCases: dto.testCases as Prisma.InputJsonValue, changelog: 'Versi awal', createdById: user.id } });
      return s;
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.skill.create', entityType: 'ai_skill', entityId: skill.id, after: { key: skill.key, source: dto.source, tools: dto.tools, riskClass: dto.riskClass } });
    return skill;
  }

  /** Versi baru selalu PENDING_REVIEW; AI tetap memakai versi aktif sampai versi baru disetujui. */
  @Post('skills/:id/versions')
  @RequirePermissions('ai.manage')
  async newVersion(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionDto) {
    assertFullScope(org);
    const s = await this.prisma.aiSkill.findFirst({ where: { id, organizationId: org.organizationId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!s) notFound('Skill');
    const meta = parseSkillMd(dto.skillMd);
    if ('error' in meta) throw new BadRequestException({ code: 'BAD_SKILL_MD', message: meta.error });
    if (meta.name !== s.key) throw new BadRequestException({ code: 'NAME_MISMATCH', message: `Frontmatter name harus "${s.key}"` });
    const v = await this.prisma.aiSkillVersion.create({
      data: { skillId: id, version: (s.versions[0]?.version ?? 0) + 1, skillMd: dto.skillMd, changelog: dto.changelog, testCases: dto.testCases as Prisma.InputJsonValue, createdById: user.id },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.skill.version', entityType: 'ai_skill', entityId: id, after: { version: v.version } });
    return v;
  }

  @Post('skill-versions/:id/review')
  @RequirePermissions('ai.manage')
  @HttpCode(200)
  async review(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    assertFullScope(org);
    const v = await this.prisma.aiSkillVersion.findFirst({ where: { id, skill: { organizationId: org.organizationId } }, include: { skill: true } });
    if (!v) notFound('Versi skill');
    if (v.review !== 'PENDING_REVIEW') throw new BadRequestException({ code: 'ALREADY_REVIEWED', message: 'Versi ini sudah direview' });
    // Skill dari luar wajib ditinjau orang lain (empat mata) dan disertai catatan review.
    if (dto.decision === 'APPROVE' && v.skill.source === 'IMPORTED') {
      if (v.createdById === user.id && !org.isSuperAdmin) throw new ForbiddenException({ code: 'FOUR_EYES', message: 'Skill impor harus disetujui oleh admin lain' });
      if (!dto.note?.trim()) throw new BadRequestException({ code: 'NOTE_REQUIRED', message: 'Tulis catatan review untuk skill impor' });
    }
    const meta = parseSkillMd(v.skillMd);
    await this.prisma.$transaction(async (tx) => {
      await tx.aiSkillVersion.update({ where: { id }, data: { review: dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewedById: user.id, reviewedAt: new Date(), reviewNote: dto.note } });
      if (dto.decision === 'APPROVE') {
        await tx.aiSkill.update({ where: { id: v.skillId }, data: { activeVersionId: id, ...('error' in meta ? {} : { description: meta.description }) } });
      }
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: `ai.skill.${dto.decision.toLowerCase()}`, entityType: 'ai_skill', entityId: v.skillId, after: { version: v.version, note: dto.note } });
    return { ok: true };
  }

  @Patch('skills/:id')
  @RequirePermissions('ai.manage')
  async update(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSkillDto) {
    assertFullScope(org);
    const s = await this.prisma.aiSkill.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!s) notFound('Skill');
    if (dto.tools) this.assertTools(dto.tools);
    const updated = await this.prisma.aiSkill.update({
      where: { id },
      data: { enabled: dto.enabled, category: dto.category, positions: dto.positions ? [...new Set(dto.positions)] : undefined, tools: dto.tools ? [...new Set(dto.tools)] : undefined, riskClass: dto.riskClass },
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.skill.update', entityType: 'ai_skill', entityId: id, before: { enabled: s.enabled, positions: s.positions, tools: s.tools }, after: dto });
    return updated;
  }

  @Put('skills/:id/assignments/:membershipId')
  @RequirePermissions('ai.manage')
  async assign(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('membershipId', ParseUUIDPipe) membershipId: string, @Body() dto: AssignDto) {
    assertFullScope(org);
    if (!(await this.prisma.aiSkill.count({ where: { id, organizationId: org.organizationId } }))) notFound('Skill');
    if (!(await this.prisma.membership.count({ where: { id: membershipId, organizationId: org.organizationId } }))) notFound('Anggota');
    if (dto.enabled === null) await this.prisma.aiSkillAssignment.deleteMany({ where: { skillId: id, membershipId } });
    else await this.prisma.aiSkillAssignment.upsert({ where: { skillId_membershipId: { skillId: id, membershipId } }, create: { skillId: id, membershipId, enabled: dto.enabled }, update: { enabled: dto.enabled } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.skill.assign', entityType: 'ai_skill', entityId: id, after: { membershipId, enabled: dto.enabled } });
    return { ok: true };
  }

  private assertTools(tools: string[]) {
    const unknown = tools.filter((t) => !(t in this.tools.defs));
    if (unknown.length) throw new BadRequestException({ code: 'BAD_TOOL', message: `Tool tidak dikenal: ${unknown.join(', ')}` });
  }
}
