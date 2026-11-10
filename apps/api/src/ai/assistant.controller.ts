import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UnprocessableEntityException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Position } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertCampaignAccess, notFound } from '../common/scope';
import { TasksService } from '../tasks/tasks.service';
import { AiToolsService } from './ai-tools';
import { AiService, POSITION_LABEL } from './ai.service';
import { AGENT_NAME } from './builtin-skills';

class ChatDto {
  @IsOptional() @IsUUID() conversationId?: string;
  @IsString() @Length(1, 4000) message: string;
  @IsOptional() @IsEnum(Position) position?: Position;
}
class AcceptDraftDto {
  @IsOptional() @IsUUID() boardId?: string;
}

const MESSAGE_SELECT = { id: true, role: true, content: true, toolCalls: true, toolName: true, toolCallId: true, skillKeys: true, modelId: true, createdAt: true } as const;

@ApiTags('ai-assistant')
@Controller('ai')
export class AssistantController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly tools: AiToolsService,
    private readonly tasks: TasksService,
  ) {}

  /** Ringkasan workspace AI pengguna: jabatan, model efektif, budget terpakai, skill & tool aktif. */
  @Get('workspace')
  @RequirePermissions('ai.use')
  async workspace(@Org() org: OrgContext, @Query('position') positionQ?: string) {
    if (!org.membershipId) throw new ForbiddenException({ code: 'NOT_MEMBER', message: 'AI Assistant hanya untuk anggota organisasi' });
    const positions = (await this.prisma.membershipPosition.findMany({ where: { membershipId: org.membershipId }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] })).map((p) => p.position);
    const position = positions.includes(positionQ as Position) ? (positionQ as Position) : positions[0];
    const spent = await this.ai.spent(org.organizationId, org.membershipId);
    if (!position) return { positions: [], position: null, ready: false, reason: 'NO_POSITION', spent };
    const cfg = await this.ai.resolveConfig(org.organizationId, org.membershipId, position);
    const skills = await this.ai.activeSkills(org.organizationId, org.membershipId, position);
    const tools = cfg.model?.supportsTools ? this.tools.toolsFor(org, skills.flatMap((s) => s.tools)).map((t) => t.function.name) : [];
    const reason = !cfg.orgEnabled ? 'AI_DISABLED' : !cfg.hasKey ? 'AI_NOT_CONFIGURED' : !cfg.aiEnabled ? 'AI_MEMBER_DISABLED' : !cfg.model ? 'AI_NO_MODEL' : null;
    return {
      positions: positions.map((p) => ({ key: p, label: POSITION_LABEL[p], agent: AGENT_NAME[p] })),
      position,
      agent: AGENT_NAME[position],
      ready: !reason,
      reason,
      model: cfg.model ? { modelId: cfg.model.modelId, name: cfg.model.name, supportsTools: cfg.model.supportsTools } : null,
      fallback: cfg.fallback ? { modelId: cfg.fallback.modelId, name: cfg.fallback.name } : null,
      limits: cfg.limits,
      spent,
      skills: skills.map((s) => ({ key: s.key, name: s.name, version: s.version })),
      tools,
    };
  }

  @Get('conversations')
  @RequirePermissions('ai.use')
  conversations(@Org() org: OrgContext) {
    if (!org.membershipId) return [];
    return this.prisma.aiConversation.findMany({
      where: { membershipId: org.membershipId },
      select: { id: true, title: true, position: true, updatedAt: true, _count: { select: { drafts: { where: { status: 'PENDING' } } } } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  @Get('conversations/:id')
  @RequirePermissions('ai.use')
  async conversation(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.aiConversation.findFirst({
      where: { id, membershipId: org.membershipId ?? '' },
      include: { messages: { select: MESSAGE_SELECT, orderBy: { createdAt: 'asc' } }, drafts: { orderBy: { createdAt: 'asc' } } },
    });
    if (!c) notFound('Percakapan');
    return c;
  }

  @Delete('conversations/:id')
  @RequirePermissions('ai.use')
  async remove(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.aiConversation.deleteMany({ where: { id, membershipId: org.membershipId ?? '' } });
    if (!r.count) notFound('Percakapan');
    return { ok: true };
  }

  @Post('chat')
  @RequirePermissions('ai.use')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  async chat(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: ChatDto) {
    const r = await this.ai.send(org, user, { conversationId: dto.conversationId, message: dto.message.trim(), position: dto.position });
    return this.conversation(org, r.conversationId);
  }

  /** Draft AI → kartu Kanban (source AI). Validasi ulang cakupan campaign saat diterima. */
  @Post('drafts/:id/accept')
  @RequirePermissions('ai.use', 'tasks.write')
  @HttpCode(200)
  async accept(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcceptDraftDto) {
    const d = await this.prisma.aiTaskDraft.findFirst({ where: { id, membershipId: org.membershipId ?? '' } });
    if (!d) notFound('Draft');
    if (d.status !== 'PENDING') throw new UnprocessableEntityException({ code: 'DRAFT_DECIDED', message: 'Draft sudah diputuskan' });
    if (d.campaignId) assertCampaignAccess(org, d.campaignId);
    const card = await this.prisma.$transaction(async (tx) => {
      const board = dto.boardId ? await tx.board.findFirst({ where: { id: dto.boardId, organizationId: org.organizationId, archivedAt: null } }) : await this.tasks.defaultBoard(tx, org.organizationId);
      if (!board) notFound('Board');
      const c = await this.tasks.createCard(
        tx,
        org.organizationId,
        { boardId: board.id, title: d.title, description: d.description, priority: d.priority, campaignId: d.campaignId, dueDate: d.dueDate, ownerMembershipId: org.membershipId, source: 'AI' },
        user.id,
      );
      const upd = await tx.aiTaskDraft.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'ACCEPTED', cardId: c.id, decidedAt: new Date() } });
      if (!upd.count) throw new UnprocessableEntityException({ code: 'DRAFT_DECIDED', message: 'Draft sudah diputuskan' });
      return c;
    });
    await this.tasks.publish(org.organizationId, { type: 'card.created', boardId: card.boardId, cardId: card.id, actorUserId: user.id });
    return { ok: true, cardId: card.id, boardId: card.boardId, number: card.number };
  }

  @Post('drafts/:id/dismiss')
  @RequirePermissions('ai.use')
  @HttpCode(200)
  async dismiss(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.prisma.aiTaskDraft.updateMany({ where: { id, membershipId: org.membershipId ?? '', status: 'PENDING' }, data: { status: 'DISMISSED', decidedAt: new Date() } });
    if (!r.count) notFound('Draft');
    return { ok: true };
  }
}
