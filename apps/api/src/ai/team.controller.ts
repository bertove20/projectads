import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UnprocessableEntityException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { GoalMetric, GoalPeriod, Position, Prisma, ProposalStatus } from '@prisma/client';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { notFound } from '../common/scope';
import { periodStarts } from './ai-core';
import { POSITION_LABEL } from './ai.service';
import { ACTION_LABEL, ACTION_RULES, SUPERVISOR_KEY } from './team-core';
import { AiTeamService, OwnerDecision } from './team.service';

class TeamSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() meetingEnabled?: boolean;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) meetingTime?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber() @Min(0) @Max(100_000) dailyBudgetUsd?: number | null;
  @IsOptional() @IsNumber() @Min(0.01) @Max(1000) runBudgetUsd?: number;
}
class StopDto {
  @IsBoolean() paused: boolean;
}
class AgentDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() modelId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Length(0, 2000) instructions?: string | null;
}
const METRICS = Object.values(GoalMetric);
const PERIODS = Object.values(GoalPeriod);
class GoalDto {
  @IsString() @Length(2, 120) title: string;
  @IsIn(METRICS) metric: GoalMetric;
  @IsNumber() @Min(-1_000_000_000) @Max(1_000_000_000) target: number;
  @IsIn(PERIODS) period: GoalPeriod;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() campaignId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
class GoalPatchDto {
  @IsOptional() @IsString() @Length(2, 120) title?: string;
  @IsOptional() @IsNumber() @Min(-1_000_000_000) @Max(1_000_000_000) target?: number;
  @IsOptional() @IsIn(PERIODS) period?: GoalPeriod;
  @IsOptional() @IsBoolean() active?: boolean;
}
class DirectiveDto {
  @IsString() @Length(5, 4000) text: string;
}
class DecideDto {
  @IsIn(['APPROVE', 'REJECT', 'REVISION']) decision: OwnerDecision;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
}

const AGENT_MODEL = { select: { id: true, modelId: true, name: true, enabled: true, available: true, supportsTools: true } } as const;
const PROPOSAL_STATUSES = Object.values(ProposalStatus);

/** Tim AI otonom (read.md Bagian 23): pengaturan, goal, sesi rapat/perintah, Approval Center, transparansi. */
@ApiTags('ai-team')
@Controller('ai')
export class TeamController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly team: AiTeamService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── tim ─────────────

  @Get('team')
  @RequirePermissions('ai.supervise')
  async overview(@Org() org: OrgContext) {
    const settings = await this.team.settings(org.organizationId);
    await this.team.ensureAgents(org.organizationId);
    const { day } = periodStarts();
    const [rows, usage, pending, lastRun, positions] = await Promise.all([
      this.prisma.aiAgent.findMany({ where: { organizationId: org.organizationId }, include: { model: AGENT_MODEL } }),
      this.prisma.aiUsageLog.groupBy({ by: ['agentId'], where: { organizationId: org.organizationId, agentId: { not: null }, createdAt: { gte: day } }, _sum: { costUsd: true }, _count: true }),
      this.prisma.aiProposal.count({ where: { organizationId: org.organizationId, status: 'PENDING_OWNER' } }),
      this.prisma.aiRun.findFirst({ where: { organizationId: org.organizationId }, orderBy: { createdAt: 'desc' }, select: { id: true, kind: true, status: true, title: true, stage: true, createdAt: true } }),
      this.prisma.aiPositionConfig.findMany({ where: { organizationId: org.organizationId }, include: { model: AGENT_MODEL } }),
    ]);
    const byAgent = new Map(usage.map((u) => [u.agentId, u]));
    const posModel = new Map(positions.map((p) => [p.position, p.model]));
    const ok = (m: { enabled: boolean; available: boolean; supportsTools: boolean } | null | undefined) => !!m && m.enabled && m.available && m.supportsTools;
    const order = (k: string) => (k === SUPERVISOR_KEY ? -1 : Object.keys(POSITION_LABEL).indexOf(k));
    return {
      settings: { ...settings, dailyBudgetUsd: settings.dailyBudgetUsd == null ? null : Number(settings.dailyBudgetUsd), runBudgetUsd: Number(settings.runBudgetUsd) },
      pendingApprovals: pending,
      lastRun,
      spentToday: usage.reduce((s, u) => s + Number(u._sum.costUsd ?? 0), 0),
      agents: rows
        .sort((a, b) => order(a.key) - order(b.key))
        .map((a) => {
          const inherited = posModel.get(a.position ?? 'ADS_MANAGER') ?? null;
          const effective = ok(a.model) ? a.model : ok(inherited) ? inherited : null;
          return {
            id: a.id,
            key: a.key,
            role: a.role,
            position: a.position,
            positionLabel: a.position ? POSITION_LABEL[a.position] : 'Atasan tim AI',
            name: a.name,
            enabled: a.enabled,
            instructions: a.instructions,
            modelOverride: a.model,
            model: effective ? { modelId: effective.modelId, name: effective.name, inherited: effective !== a.model } : null,
            allowedActions: a.position ? ACTION_RULES[a.position].map((x) => ({ key: x, label: ACTION_LABEL[x] })) : [],
            today: { requests: byAgent.get(a.id)?._count ?? 0, costUsd: Number(byAgent.get(a.id)?._sum.costUsd ?? 0) },
          };
        }),
    };
  }

  @Patch('team/settings')
  @RequirePermissions('ai.supervise')
  async updateSettings(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: TeamSettingsDto) {
    const before = await this.team.settings(org.organizationId);
    const s = await this.prisma.aiTeamSettings.update({ where: { organizationId: org.organizationId }, data: dto });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.team.settings', entityType: 'ai_team', entityId: org.organizationId, before, after: s });
    return { ok: true };
  }

  @Post('team/emergency-stop')
  @RequirePermissions('ai.supervise')
  @HttpCode(200)
  async stop(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: StopDto) {
    const s = await this.team.setPaused(org, user.id, dto.paused);
    return { paused: s.paused };
  }

  @Patch('team/agents/:id')
  @RequirePermissions('ai.supervise')
  async updateAgent(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AgentDto) {
    const a = await this.prisma.aiAgent.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!a) notFound('Agent');
    if (dto.modelId) {
      const m = await this.prisma.aiModel.findFirst({ where: { id: dto.modelId, organizationId: org.organizationId, enabled: true, available: true } });
      if (!m) throw new UnprocessableEntityException({ code: 'MODEL_NOT_ENABLED', message: 'Model belum diaktifkan' });
      if (!m.supportsTools) throw new UnprocessableEntityException({ code: 'MODEL_NO_TOOLS', message: 'Karyawan AI butuh model yang mendukung tool calling' });
    }
    const upd = await this.prisma.aiAgent.update({ where: { id }, data: { enabled: dto.enabled, modelId: dto.modelId, instructions: dto.instructions === undefined ? undefined : dto.instructions?.trim() || null } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.agent.update', entityType: 'ai_agent', entityId: id, before: { enabled: a.enabled, modelId: a.modelId, instructions: a.instructions }, after: { enabled: upd.enabled, modelId: upd.modelId, instructions: upd.instructions } });
    return { ok: true };
  }

  // ───────────── goal ─────────────

  @Get('goals')
  @RequirePermissions('ai.supervise')
  goals(@Org() org: OrgContext) {
    return this.prisma.aiGoal
      .findMany({ where: { organizationId: org.organizationId }, include: { campaign: { select: { id: true, name: true } } }, orderBy: [{ active: 'desc' }, { createdAt: 'asc' }] })
      .then((rows) => rows.map((g) => ({ ...g, target: Number(g.target) })));
  }

  @Post('goals')
  @RequirePermissions('ai.supervise')
  async createGoal(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: GoalDto) {
    if (dto.campaignId && !(await this.prisma.campaign.count({ where: { id: dto.campaignId, organizationId: org.organizationId } }))) notFound('Campaign');
    const g = await this.prisma.aiGoal.create({ data: { organizationId: org.organizationId, title: dto.title.trim(), metric: dto.metric, target: dto.target, period: dto.period, campaignId: dto.campaignId ?? null, active: dto.active ?? true, createdById: user.id } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.goal.create', entityType: 'ai_goal', entityId: g.id, after: { title: g.title, metric: g.metric, target: dto.target, period: g.period } });
    return { ...g, target: Number(g.target) };
  }

  @Patch('goals/:id')
  @RequirePermissions('ai.supervise')
  async updateGoal(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GoalPatchDto) {
    const r = await this.prisma.aiGoal.updateMany({ where: { id, organizationId: org.organizationId }, data: { ...dto, title: dto.title?.trim() } });
    if (!r.count) notFound('Goal');
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.goal.update', entityType: 'ai_goal', entityId: id, after: { ...dto } });
    return { ok: true };
  }

  @Delete('goals/:id')
  @RequirePermissions('ai.supervise')
  async deleteGoal(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.aiGoal.deleteMany({ where: { id, organizationId: org.organizationId } });
    if (!r.count) notFound('Goal');
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.goal.delete', entityType: 'ai_goal', entityId: id });
    return { ok: true };
  }

  // ───────────── sesi rapat & perintah ─────────────

  @Post('team/meetings')
  @RequirePermissions('ai.supervise')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async meetingNow(@Org() org: OrgContext, @CurrentUser() user: AuthUser) {
    const run = await this.team.startMeeting(org.organizationId, user.id, true);
    return { runId: run!.id };
  }

  @Post('team/directives')
  @RequirePermissions('ai.supervise')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async directive(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: DirectiveDto) {
    const run = await this.team.startDirective(org.organizationId, user.id, dto.text);
    return { runId: run.id };
  }

  @Get('team/runs')
  @RequirePermissions('ai.supervise')
  async runs(@Org() org: OrgContext, @Query('kind') kind?: string) {
    const rows = await this.prisma.aiRun.findMany({
      where: { organizationId: org.organizationId, ...(kind === 'MEETING' || kind === 'DIRECTIVE' ? { kind } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, kind: true, status: true, title: true, stage: true, meetingDate: true, costUsd: true, createdAt: true, finishedAt: true, error: true, _count: { select: { proposals: true } } },
    });
    const pending = await this.prisma.aiProposal.groupBy({ by: ['runId'], where: { organizationId: org.organizationId, status: 'PENDING_OWNER', runId: { in: rows.map((r) => r.id) } }, _count: true });
    const p = new Map(pending.map((x) => [x.runId, x._count]));
    return rows.map((r) => ({ ...r, costUsd: Number(r.costUsd), proposals: r._count.proposals, pendingOwner: p.get(r.id) ?? 0, _count: undefined }));
  }

  @Get('team/runs/:id')
  @RequirePermissions('ai.supervise')
  async run(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    const run = await this.prisma.aiRun.findFirst({
      where: { id, organizationId: org.organizationId },
      include: {
        messages: { orderBy: { createdAt: 'asc' }, include: { agent: { select: { id: true, name: true, key: true, position: true, role: true } } } },
        proposals: { orderBy: { createdAt: 'asc' }, include: { agent: { select: { id: true, name: true, position: true } } } },
      },
    });
    if (!run) notFound('Sesi');
    const authorIds = [...new Set(run.messages.map((m) => m.authorId).filter((x): x is string => !!x))];
    const authors = await this.prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } });
    const live = run.status === 'RUNNING' || run.status === 'QUEUED' ? await this.prisma.aiUsageLog.aggregate({ where: { runId: id }, _sum: { costUsd: true } }) : null;
    return {
      ...run,
      costUsd: live ? Number(live._sum.costUsd ?? 0) : Number(run.costUsd),
      authors,
      proposals: await Promise.all(run.proposals.map(async (p) => ({ ...p, actionLabel: ACTION_LABEL[p.action], preview: p.status === 'PENDING_OWNER' ? await this.team.preview(p) : null }))),
    };
  }

  @Post('team/runs/:id/cancel')
  @RequirePermissions('ai.supervise')
  @HttpCode(200)
  async cancel(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.aiRun.updateMany({ where: { id, organizationId: org.organizationId, status: 'QUEUED' }, data: { status: 'CANCELLED', error: 'Dibatalkan owner', finishedAt: new Date() } });
    if (!r.count) throw new UnprocessableEntityException({ code: 'RUN_NOT_QUEUED', message: 'Hanya sesi yang belum berjalan yang bisa dibatalkan; gunakan tombol darurat untuk menghentikan sesi berjalan' });
    return { ok: true };
  }

  // ───────────── Approval Center ─────────────

  @Get('approvals')
  @RequirePermissions('ai.supervise')
  async approvals(@Org() org: OrgContext, @Query('status') status?: string) {
    const statuses = (status ?? 'PENDING_OWNER').split(',').filter((s): s is ProposalStatus => PROPOSAL_STATUSES.includes(s as ProposalStatus));
    const rows = await this.prisma.aiProposal.findMany({
      where: { organizationId: org.organizationId, status: { in: statuses.length ? statuses : ['PENDING_OWNER'] } },
      include: { agent: { select: { id: true, name: true, position: true } }, run: { select: { id: true, title: true, kind: true, createdAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const campaigns = await this.prisma.campaign.findMany({ where: { id: { in: rows.map((r) => r.campaignId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    const cname = new Map(campaigns.map((c) => [c.id, c.name]));
    return Promise.all(
      rows.map(async (p) => ({ ...p, actionLabel: ACTION_LABEL[p.action], campaignName: p.campaignId ? (cname.get(p.campaignId) ?? null) : null, preview: p.status === 'PENDING_OWNER' ? await this.team.preview(p) : null })),
    );
  }

  @Post('approvals/:id/decide')
  @RequirePermissions('ai.approve')
  @HttpCode(200)
  decide(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDto) {
    return this.team.decide(org, user.id, id, dto.decision, dto.note);
  }

  /** Bukti (hasil tool) yang dirujuk sebuah sesi — untuk ditampilkan di Approval Center. */
  @Get('team/runs/:id/evidence/:evidenceId')
  @RequirePermissions('ai.supervise')
  async evidence(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Param('evidenceId') evidenceId: string) {
    const m = await this.prisma.aiRunMessage.findFirst({ where: { runId: id, evidenceId: evidenceId.toUpperCase(), run: { organizationId: org.organizationId } }, include: { agent: { select: { name: true } } } });
    if (!m) notFound('Bukti');
    return m;
  }

  // ───────────── transparansi percakapan AI Assistant karyawan ─────────────

  @Get('oversight/conversations')
  @RequirePermissions('ai.supervise')
  async oversight(@Org() org: OrgContext, @Query('membershipId') membershipId?: string, @Query('position') position?: string) {
    const where: Prisma.AiConversationWhereInput = {
      organizationId: org.organizationId,
      ...(membershipId && /^[0-9a-f-]{36}$/i.test(membershipId) ? { membershipId } : {}),
      ...(position && position in POSITION_LABEL ? { position: position as Position } : {}),
    };
    const rows = await this.prisma.aiConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { membership: { select: { id: true, user: { select: { name: true } } } }, _count: { select: { messages: true, drafts: true } } },
    });
    return rows.map((c) => ({ id: c.id, title: c.title, position: c.position, updatedAt: c.updatedAt, createdAt: c.createdAt, member: { id: c.membership.id, name: c.membership.user.name }, messages: c._count.messages, drafts: c._count.drafts }));
  }

  /** Membuka percakapan karyawan dicatat di audit log (transparansi dua arah, read.md 23.6). */
  @Get('oversight/conversations/:id')
  @RequirePermissions('ai.supervise')
  async oversightOne(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.aiConversation.findFirst({
      where: { id, organizationId: org.organizationId },
      include: { membership: { select: { id: true, user: { select: { name: true } } } }, messages: { orderBy: { createdAt: 'asc' } }, drafts: { orderBy: { createdAt: 'asc' } } },
    });
    if (!c) notFound('Percakapan');
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.conversation.view', entityType: 'ai_conversation', entityId: id, after: { memberId: c.membership.id } });
    return { ...c, member: { id: c.membership.id, name: c.membership.user.name }, membership: undefined };
  }
}
