import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Sse,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Prisma, TaskPriority } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Observable } from 'rxjs';
import { AuditService } from '../common/audit/audit.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertCampaignAccess, assertFullScope, notFound } from '../common/scope';
import { isDateString } from '../common/tz';
import { isHttpUrl } from '../common/url';
import { createsCycle, parseMentions } from './kanban';
import { TaskStreamService } from './task-stream.service';
import { cardScope, TasksService } from './tasks.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : new Date(`${v}T00:00:00Z`));

class BoardDto {
  @IsString() @Length(2, 80) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() teamId?: string | null;
}
class UpdateBoardDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() teamId?: string | null;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() archived?: boolean;
}
class ColumnDto {
  @IsString() @Length(1, 40) name: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(500) wipLimit?: number | null;
}
class UpdateColumnDto {
  @IsOptional() @IsString() @Length(1, 40) name?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(500) wipLimit?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100) position?: number;
}

class CardFields {
  @IsOptional() @IsString() @MaxLength(10_000) description?: string | null;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() ownerMembershipId?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) assigneeIds?: string[];
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() teamId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() campaignId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() networkAccountId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Matches(DATE_RE) startDate?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Matches(DATE_RE) dueDate?: string | null;
  @IsOptional() @IsBoolean() approvalRequired?: boolean;
}
class CreateCardDto extends CardFields {
  @IsUUID() boardId: string;
  @IsOptional() @IsUUID() columnId?: string;
  @IsString() @Length(2, 200) title: string;
}
class UpdateCardDto extends CardFields {
  @IsInt() version: number;
  @IsOptional() @IsString() @Length(2, 200) title?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(5000) completionEvidence?: string | null;
  @IsOptional() @IsBoolean() archived?: boolean;
}
class MoveDto {
  @IsUUID() columnId: string;
  @IsInt() @Min(0) @Max(100_000) index: number;
  @IsInt() version: number;
}
class ChecklistDto {
  @IsString() @Length(1, 300) text: string;
}
class UpdateChecklistDto {
  @IsOptional() @IsString() @Length(1, 300) text?: string;
  @IsOptional() @IsBoolean() done?: boolean;
}
class CommentDto {
  @IsString() @Length(1, 5000) body: string;
}
class LinkDto {
  @IsString() @Length(1, 120) title: string;
  @IsString() @MaxLength(2000) url: string;
}
class DependencyDto {
  @IsUUID() dependsOnCardId: string;
}
class TimeDto {
  @IsInt() @Min(1) @Max(1440) minutes: number;
  @Matches(DATE_RE) date: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
class ViewDto {
  @IsString() @Length(1, 60) name: string;
  @IsOptional() @IsUUID() boardId?: string;
  @IsObject() filters: Record<string, unknown>;
}

const MEMBER_SELECT = { id: true, user: { select: { name: true } } } as const;
const CARD_SUMMARY = {
  id: true,
  number: true,
  boardId: true,
  columnId: true,
  rank: true,
  title: true,
  priority: true,
  dueDate: true,
  startDate: true,
  approvalRequired: true,
  completionEvidence: true,
  source: true,
  alertId: true,
  completedAt: true,
  archivedAt: true,
  version: true,
  updatedAt: true,
  ownerMembershipId: true,
  teamId: true,
  owner: { select: MEMBER_SELECT },
  campaign: { select: { id: true, name: true } },
  networkAccount: { select: { id: true, name: true } },
  assignees: { select: { membership: { select: MEMBER_SELECT } } },
  checklist: { select: { done: true } },
  dependsOn: { select: { dependsOn: { select: { completedAt: true } } } },
  _count: { select: { comments: true, links: true } },
} satisfies Prisma.TaskCardSelect;

type CardRow = Prisma.TaskCardGetPayload<{ select: typeof CARD_SUMMARY }>;
const memberView = (m: { id: string; user: { name: string } } | null) => (m ? { id: m.id, name: m.user.name } : null);

function summarize(c: CardRow) {
  const { checklist, dependsOn, assignees, owner, _count, ...rest } = c;
  return {
    ...rest,
    hasEvidence: !!c.completionEvidence?.trim(),
    completionEvidence: undefined,
    owner: memberView(owner),
    assignees: assignees.map((a) => memberView(a.membership)!),
    checklistTotal: checklist.length,
    checklistDone: checklist.filter((i) => i.done).length,
    blockedBy: dependsOn.filter((d) => !d.dependsOn.completedAt).length,
    comments: _count.comments,
    links: _count.links,
  };
}

@ApiTags('tasks')
@Controller()
export class TasksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly stream: TaskStreamService,
    private readonly audit: AuditService,
  ) {}

  // ───────────── board & kolom ─────────────

  @Get('boards')
  @RequirePermissions('tasks.read')
  async boards(@Org() org: OrgContext, @Query('archived') archived?: string) {
    const boards = await this.prisma.board.findMany({
      where: { organizationId: org.organizationId, archivedAt: archived === '1' ? { not: null } : null },
      include: { team: { select: { id: true, name: true } }, columns: { orderBy: { position: 'asc' }, select: { id: true, name: true, kind: true } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    const counts = await this.prisma.taskCard.groupBy({
      by: ['boardId', 'columnId'],
      where: { AND: [cardScope(org), { archivedAt: null, boardId: { in: boards.map((b) => b.id) } }] },
      _count: true,
    });
    return boards.map((b) => {
      const done = new Set(b.columns.filter((c) => c.kind === 'DONE').map((c) => c.id));
      const rows = counts.filter((r) => r.boardId === b.id);
      return {
        id: b.id,
        name: b.name,
        description: b.description,
        isDefault: b.isDefault,
        team: b.team,
        archivedAt: b.archivedAt,
        openCards: rows.filter((r) => !done.has(r.columnId)).reduce((s, r) => s + r._count, 0),
        doneCards: rows.filter((r) => done.has(r.columnId)).reduce((s, r) => s + r._count, 0),
      };
    });
  }

  @Post('boards')
  @RequirePermissions('boards.manage')
  async createBoard(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: BoardDto) {
    assertFullScope(org);
    if (dto.teamId) await this.assertTeam(org, dto.teamId);
    const board = await this.prisma.$transaction((tx) =>
      this.tasks.createBoard(tx, org.organizationId, dto.name.trim(), { description: dto.description, teamId: dto.teamId, createdById: user.id }),
    );
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'board.create', entityType: 'board', entityId: board.id, after: { name: board.name } });
    return board;
  }

  @Get('boards/:id')
  @RequirePermissions('tasks.read')
  async board(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Query('archived') archived?: string) {
    const board = await this.prisma.board.findFirst({
      where: { id, organizationId: org.organizationId },
      include: { team: { select: { id: true, name: true } }, columns: { orderBy: { position: 'asc' } } },
    });
    if (!board) notFound('Board');
    const cards = await this.prisma.taskCard.findMany({
      where: { AND: [cardScope(org), { boardId: id, archivedAt: archived === '1' ? { not: null } : null }] },
      select: CARD_SUMMARY,
      orderBy: { rank: 'asc' },
      take: 2000,
    });
    return { ...board, cards: cards.map(summarize) };
  }

  @Patch('boards/:id')
  @RequirePermissions('boards.manage')
  async updateBoard(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBoardDto) {
    assertFullScope(org);
    const b = await this.prisma.board.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!b) notFound('Board');
    if (dto.teamId) await this.assertTeam(org, dto.teamId);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.board.updateMany({ where: { organizationId: org.organizationId, id: { not: id } }, data: { isDefault: false } });
      return tx.board.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          description: dto.description,
          teamId: dto.teamId,
          isDefault: dto.isDefault,
          archivedAt: dto.archived === undefined ? undefined : dto.archived ? new Date() : null,
        },
      });
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'board.update', entityType: 'board', entityId: id, before: { name: b.name, archivedAt: b.archivedAt }, after: dto });
    await this.tasks.publish(org.organizationId, { type: 'board.updated', boardId: id, actorUserId: user.id });
    return updated;
  }

  @Post('boards/:id/columns')
  @RequirePermissions('boards.manage')
  async addColumn(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ColumnDto) {
    assertFullScope(org);
    const b = await this.prisma.board.findFirst({ where: { id, organizationId: org.organizationId }, include: { columns: { orderBy: { position: 'asc' } } } });
    if (!b) notFound('Board');
    if (b.columns.length >= 20) throw new UnprocessableEntityException({ code: 'TOO_MANY_COLUMNS', message: 'Maksimal 20 kolom per board' });
    // Kolom custom disisipkan sebelum Done agar Done tetap kolom terakhir.
    const doneIdx = b.columns.findIndex((c) => c.kind === 'DONE');
    const position = doneIdx >= 0 ? doneIdx : b.columns.length;
    const col = await this.prisma.$transaction(async (tx) => {
      await tx.boardColumn.updateMany({ where: { boardId: id, position: { gte: position } }, data: { position: { increment: 1 } } });
      return tx.boardColumn.create({ data: { boardId: id, name: dto.name.trim(), kind: 'CUSTOM', position, wipLimit: dto.wipLimit ?? null } });
    });
    await this.tasks.publish(org.organizationId, { type: 'board.updated', boardId: id, actorUserId: user.id });
    return col;
  }

  @Patch('columns/:id')
  @RequirePermissions('boards.manage')
  async updateColumn(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateColumnDto) {
    assertFullScope(org);
    const col = await this.prisma.boardColumn.findFirst({ where: { id, board: { organizationId: org.organizationId } } });
    if (!col) notFound('Kolom');
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.position !== undefined && dto.position !== col.position) {
        const cols = await tx.boardColumn.findMany({ where: { boardId: col.boardId }, orderBy: { position: 'asc' } });
        const rest = cols.filter((c) => c.id !== id);
        rest.splice(Math.min(dto.position, rest.length), 0, col);
        for (let i = 0; i < rest.length; i++) await tx.boardColumn.update({ where: { id: rest[i].id }, data: { position: i } });
      }
      return tx.boardColumn.update({ where: { id }, data: { name: dto.name?.trim(), wipLimit: dto.wipLimit } });
    });
    await this.tasks.publish(org.organizationId, { type: 'board.updated', boardId: col.boardId, actorUserId: user.id });
    return updated;
  }

  @Delete('columns/:id')
  @RequirePermissions('boards.manage')
  async deleteColumn(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    assertFullScope(org);
    const col = await this.prisma.boardColumn.findFirst({ where: { id, board: { organizationId: org.organizationId } }, include: { _count: { select: { cards: true } } } });
    if (!col) notFound('Kolom');
    if (col.kind !== 'CUSTOM') throw new UnprocessableEntityException({ code: 'COLUMN_PROTECTED', message: 'Kolom bawaan tidak dapat dihapus (boleh diganti nama)' });
    if (col._count.cards > 0) throw new UnprocessableEntityException({ code: 'COLUMN_NOT_EMPTY', message: 'Pindahkan semua kartu sebelum menghapus kolom' });
    await this.prisma.boardColumn.delete({ where: { id } });
    await this.tasks.publish(org.organizationId, { type: 'board.updated', boardId: col.boardId, actorUserId: user.id });
    return { ok: true };
  }

  // ───────────── kartu ─────────────

  @Post('cards')
  @RequirePermissions('tasks.write')
  async createCard(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: CreateCardDto) {
    await this.validateRefs(org, dto);
    // Tanpa owner eksplisit, pembuat kartu menjadi owner — anggota ASSIGNED tetap bisa melihat kartunya.
    const ownerMembershipId = dto.ownerMembershipId === undefined ? org.membershipId : dto.ownerMembershipId;
    if (org.campaignIds && !dto.campaignId && ownerMembershipId !== org.membershipId && !dto.assigneeIds?.includes(org.membershipId ?? '')) {
      throw new ForbiddenException({ code: 'SCOPE_FORBIDDEN', message: 'Kartu tanpa campaign harus Anda pegang sendiri' });
    }
    const card = await this.prisma.$transaction((tx) =>
      this.tasks.createCard(
        tx,
        org.organizationId,
        {
          boardId: dto.boardId,
          columnId: dto.columnId,
          title: dto.title.trim(),
          description: dto.description,
          priority: dto.priority,
          ownerMembershipId,
          assigneeIds: dto.assigneeIds,
          teamId: dto.teamId,
          campaignId: dto.campaignId,
          networkAccountId: dto.networkAccountId,
          startDate: toDate(dto.startDate),
          dueDate: toDate(dto.dueDate),
          approvalRequired: dto.approvalRequired,
        },
        user.id,
      ),
    );
    await this.tasks.publish(org.organizationId, { type: 'card.created', boardId: card.boardId, cardId: card.id, actorUserId: user.id });
    return card;
  }

  @Get('cards/:id')
  @RequirePermissions('tasks.read')
  async card(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    const card = await this.prisma.taskCard.findFirst({
      where: { AND: [cardScope(org), { id }] },
      include: {
        board: { select: { id: true, name: true } },
        column: { select: { id: true, name: true, kind: true } },
        owner: { select: MEMBER_SELECT },
        team: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        networkAccount: { select: { id: true, name: true, network: true } },
        alert: { select: { id: true, severity: true, status: true, type: true } },
        assignees: { select: { membership: { select: MEMBER_SELECT } } },
        checklist: { orderBy: { position: 'asc' } },
        comments: { orderBy: { createdAt: 'asc' }, take: 500 },
        activities: { orderBy: { createdAt: 'desc' }, take: 200 },
        links: { orderBy: { createdAt: 'asc' } },
        timeEntries: { orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], include: { membership: { select: MEMBER_SELECT } } },
        dependsOn: { select: { dependsOn: { select: { id: true, number: true, title: true, completedAt: true } } } },
        blocks: { select: { card: { select: { id: true, number: true, title: true, completedAt: true } } } },
      },
    });
    if (!card) notFound('Kartu');
    // Nama penulis komentar & pelaku aktivitas (user ID → nama)
    const userIds = [...new Set([...card.comments.map((c) => c.authorId), ...card.activities.map((a) => a.actorUserId).filter((x): x is string => !!x)])];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    return {
      ...card,
      owner: memberView(card.owner),
      assignees: card.assignees.map((a) => memberView(a.membership)!),
      comments: card.comments.map((c) => ({ ...c, authorName: nameOf.get(c.authorId) ?? 'Pengguna dihapus' })),
      activities: card.activities.map((a) => ({ ...a, actorName: a.actorUserId ? (nameOf.get(a.actorUserId) ?? 'Pengguna dihapus') : 'Sistem' })),
      timeEntries: card.timeEntries.map(({ membership, ...t }) => ({ ...t, member: memberView(membership) })),
      totalMinutes: card.timeEntries.reduce((s, t) => s + t.minutes, 0),
      dependsOn: card.dependsOn.map((d) => d.dependsOn),
      blocks: card.blocks.map((d) => d.card),
    };
  }

  @Patch('cards/:id')
  @RequirePermissions('tasks.write')
  async updateCard(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCardDto) {
    const card = await this.loadCard(org, id, { column: true, assignees: true });
    if (card.version !== dto.version) throw this.tasks.conflict();
    await this.validateRefs(org, { ...dto, boardId: card.boardId });
    if (card.column.kind === 'DONE' && dto.completionEvidence !== undefined && !dto.completionEvidence?.trim()) {
      throw new UnprocessableEntityException({ code: 'EVIDENCE_REQUIRED', message: 'Kartu di Done wajib memiliki bukti penyelesaian' });
    }
    if (dto.approvalRequired === false && card.approvalRequired && !this.canApprove(org)) {
      throw new ForbiddenException({ code: 'APPROVAL_REQUIRED', message: 'Hanya Owner/Team Leader yang dapat mencabut kewajiban approval' });
    }

    const changed: Record<string, unknown> = {};
    const data: Prisma.TaskCardUncheckedUpdateManyInput = { version: { increment: 1 } };
    const set = <K extends keyof Prisma.TaskCardUncheckedUpdateManyInput>(k: K, v: Prisma.TaskCardUncheckedUpdateManyInput[K], before: unknown) => {
      if (v === undefined) return;
      const norm = (x: unknown) => (x instanceof Date ? x.toISOString().slice(0, 10) : x);
      if (norm(v) === norm(before)) return;
      data[k] = v;
      changed[k as string] = norm(v);
    };
    set('title', dto.title?.trim(), card.title);
    set('description', dto.description, card.description);
    set('priority', dto.priority, card.priority);
    set('ownerMembershipId', dto.ownerMembershipId, card.ownerMembershipId);
    set('teamId', dto.teamId, card.teamId);
    set('campaignId', dto.campaignId, card.campaignId);
    set('networkAccountId', dto.networkAccountId, card.networkAccountId);
    set('startDate', toDate(dto.startDate), card.startDate);
    set('dueDate', toDate(dto.dueDate), card.dueDate);
    set('approvalRequired', dto.approvalRequired, card.approvalRequired);
    set('completionEvidence', dto.completionEvidence === undefined ? undefined : dto.completionEvidence?.trim() || null, card.completionEvidence);
    if (dto.archived !== undefined && dto.archived !== !!card.archivedAt) {
      data.archivedAt = dto.archived ? new Date() : null;
      changed.archived = dto.archived;
    }

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.taskCard.updateMany({ where: { id, version: dto.version }, data });
      if (res.count === 0) throw this.tasks.conflict();
      if (dto.assigneeIds) {
        const next = [...new Set(dto.assigneeIds)];
        const prev = card.assignees.map((a) => a.membershipId);
        if (next.sort().join() !== [...prev].sort().join()) {
          await tx.taskAssignee.deleteMany({ where: { cardId: id, membershipId: { notIn: next } } });
          await tx.taskAssignee.createMany({ data: next.map((membershipId) => ({ cardId: id, membershipId })), skipDuplicates: true });
          changed.assignees = next.length;
        }
      }
      if (Object.keys(changed).length) {
        const type = changed.archived === true ? 'archived' : changed.archived === false ? 'restored' : 'updated';
        await this.tasks.activity(tx, id, user.id, type, { fields: Object.keys(changed) });
      }
    });
    await this.tasks.publish(org.organizationId, { type: 'card.updated', boardId: card.boardId, cardId: id, actorUserId: user.id });
    return this.prisma.taskCard.findUniqueOrThrow({ where: { id } });
  }

  @Post('cards/:id/move')
  @RequirePermissions('tasks.write')
  @HttpCode(200)
  move(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveDto) {
    return this.tasks.moveCard(org, user.id, id, dto);
  }

  @Delete('cards/:id')
  @RequirePermissions('boards.manage')
  async deleteCard(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const card = await this.loadCard(org, id);
    await this.prisma.taskCard.delete({ where: { id } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'card.delete', entityType: 'task_card', entityId: id, before: { number: card.number, title: card.title } });
    await this.tasks.publish(org.organizationId, { type: 'card.deleted', boardId: card.boardId, cardId: id, actorUserId: user.id });
    return { ok: true };
  }

  // ───────────── checklist ─────────────

  @Post('cards/:id/checklist')
  @RequirePermissions('tasks.write')
  async addChecklist(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ChecklistDto) {
    const card = await this.loadCard(org, id);
    const count = await this.prisma.taskChecklistItem.count({ where: { cardId: id } });
    if (count >= 100) throw new UnprocessableEntityException({ code: 'TOO_MANY_ITEMS', message: 'Maksimal 100 item checklist' });
    const item = await this.prisma.taskChecklistItem.create({ data: { cardId: id, text: dto.text.trim(), position: count } });
    await this.touch(org, card, user.id);
    return item;
  }

  @Patch('checklist/:itemId')
  @RequirePermissions('tasks.write')
  async updateChecklist(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: UpdateChecklistDto) {
    const item = await this.prisma.taskChecklistItem.findUnique({ where: { id: itemId } });
    if (!item) notFound('Item checklist');
    const card = await this.loadCard(org, item.cardId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.taskChecklistItem.update({
        where: { id: itemId },
        data: {
          text: dto.text?.trim(),
          ...(dto.done !== undefined && dto.done !== item.done ? { done: dto.done, doneAt: dto.done ? new Date() : null, doneById: dto.done ? user.id : null } : {}),
        },
      });
      if (dto.done !== undefined && dto.done !== item.done) await this.tasks.activity(tx, card.id, user.id, dto.done ? 'checklist_done' : 'checklist_undone', { text: item.text });
      return u;
    });
    await this.touch(org, card, user.id);
    return updated;
  }

  @Delete('checklist/:itemId')
  @RequirePermissions('tasks.write')
  async deleteChecklist(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('itemId', ParseUUIDPipe) itemId: string) {
    const item = await this.prisma.taskChecklistItem.findUnique({ where: { id: itemId } });
    if (!item) notFound('Item checklist');
    const card = await this.loadCard(org, item.cardId);
    await this.prisma.taskChecklistItem.delete({ where: { id: itemId } });
    await this.touch(org, card, user.id);
    return { ok: true };
  }

  // ───────────── komentar ─────────────

  @Post('cards/:id/comments')
  @RequirePermissions('tasks.write')
  async comment(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommentDto) {
    const card = await this.loadCard(org, id);
    const ids = parseMentions(dto.body);
    // Hanya anggota organisasi yang sah yang disimpan sebagai mention.
    const mentions = ids.length
      ? (await this.prisma.membership.findMany({ where: { id: { in: ids }, organizationId: org.organizationId }, select: { id: true } })).map((m) => m.id)
      : [];
    const comment = await this.prisma.$transaction(async (tx) => {
      const c = await tx.taskComment.create({ data: { cardId: id, authorId: user.id, body: dto.body, mentions } });
      await this.tasks.activity(tx, id, user.id, 'commented', mentions.length ? { mentions: mentions.length } : undefined);
      return c;
    });
    await this.touch(org, card, user.id);
    return { ...comment, authorName: user.name };
  }

  @Delete('comments/:commentId')
  @RequirePermissions('tasks.write')
  async deleteComment(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('commentId', ParseUUIDPipe) commentId: string) {
    const c = await this.prisma.taskComment.findUnique({ where: { id: commentId } });
    if (!c) notFound('Komentar');
    const card = await this.loadCard(org, c.cardId);
    if (c.authorId !== user.id && !org.permissions.has('boards.manage') && !org.isSuperAdmin) {
      throw new ForbiddenException({ code: 'NOT_AUTHOR', message: 'Hanya penulis yang dapat menghapus komentar ini' });
    }
    await this.prisma.taskComment.delete({ where: { id: commentId } });
    await this.touch(org, card, user.id);
    return { ok: true };
  }

  // ───────────── tautan, dependensi, waktu ─────────────

  @Post('cards/:id/links')
  @RequirePermissions('tasks.write')
  async addLink(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LinkDto) {
    const card = await this.loadCard(org, id);
    if (!isHttpUrl(dto.url)) throw new BadRequestException({ code: 'BAD_URL', message: 'URL harus diawali http:// atau https://' });
    const link = await this.prisma.$transaction(async (tx) => {
      const l = await tx.taskLink.create({ data: { cardId: id, title: dto.title.trim(), url: dto.url, createdById: user.id } });
      await this.tasks.activity(tx, id, user.id, 'link_added', { title: l.title });
      return l;
    });
    await this.touch(org, card, user.id);
    return link;
  }

  @Delete('links/:linkId')
  @RequirePermissions('tasks.write')
  async deleteLink(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('linkId', ParseUUIDPipe) linkId: string) {
    const l = await this.prisma.taskLink.findUnique({ where: { id: linkId } });
    if (!l) notFound('Tautan');
    const card = await this.loadCard(org, l.cardId);
    await this.prisma.taskLink.delete({ where: { id: linkId } });
    await this.touch(org, card, user.id);
    return { ok: true };
  }

  @Post('cards/:id/dependencies')
  @RequirePermissions('tasks.write')
  async addDependency(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DependencyDto) {
    const card = await this.loadCard(org, id);
    const other = await this.loadCard(org, dto.dependsOnCardId);
    const edges = await this.prisma.taskDependency.findMany({ where: { card: { organizationId: org.organizationId } }, select: { cardId: true, dependsOnCardId: true } });
    if (createsCycle(edges.map((e) => [e.cardId, e.dependsOnCardId]), id, other.id)) {
      throw new UnprocessableEntityException({ code: 'DEPENDENCY_CYCLE', message: 'Dependensi ini membentuk siklus' });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.taskDependency.upsert({ where: { cardId_dependsOnCardId: { cardId: id, dependsOnCardId: other.id } }, create: { cardId: id, dependsOnCardId: other.id }, update: {} });
      await this.tasks.activity(tx, id, user.id, 'dependency_added', { number: other.number });
    });
    await this.touch(org, card, user.id);
    return { ok: true };
  }

  @Delete('cards/:id/dependencies/:depId')
  @RequirePermissions('tasks.write')
  async removeDependency(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('depId', ParseUUIDPipe) depId: string) {
    const card = await this.loadCard(org, id);
    await this.prisma.taskDependency.deleteMany({ where: { cardId: id, dependsOnCardId: depId } });
    await this.touch(org, card, user.id);
    return { ok: true };
  }

  @Post('cards/:id/time')
  @RequirePermissions('tasks.write')
  async logTime(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TimeDto) {
    if (!org.membershipId) throw new ForbiddenException({ code: 'NOT_MEMBER', message: 'Hanya anggota organisasi yang dapat mencatat waktu' });
    if (!isDateString(dto.date)) throw new BadRequestException({ code: 'BAD_DATE', message: 'Tanggal tidak valid' });
    const card = await this.loadCard(org, id);
    const entry = await this.prisma.$transaction(async (tx) => {
      const e = await tx.taskTimeEntry.create({ data: { cardId: id, membershipId: org.membershipId!, minutes: dto.minutes, date: toDate(dto.date)!, note: dto.note } });
      await this.tasks.activity(tx, id, user.id, 'time_logged', { minutes: dto.minutes });
      return e;
    });
    await this.touch(org, card, user.id);
    return entry;
  }

  @Delete('time/:entryId')
  @RequirePermissions('tasks.write')
  async deleteTime(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('entryId', ParseUUIDPipe) entryId: string) {
    const e = await this.prisma.taskTimeEntry.findUnique({ where: { id: entryId } });
    if (!e) notFound('Catatan waktu');
    const card = await this.loadCard(org, e.cardId);
    if (e.membershipId !== org.membershipId && !org.permissions.has('boards.manage') && !org.isSuperAdmin) {
      throw new ForbiddenException({ code: 'NOT_OWNER', message: 'Hanya pencatat yang dapat menghapus catatan waktu ini' });
    }
    await this.prisma.taskTimeEntry.delete({ where: { id: entryId } });
    await this.touch(org, card, user.id);
    return { ok: true };
  }

  // ───────────── workspace pribadi ─────────────

  /** "Tugas saya": kartu yang saya pegang/ikuti + mention terbaru (read.md 19.4). */
  @Get('tasks/mine')
  @RequirePermissions('tasks.read')
  async mine(@Org() org: OrgContext) {
    if (!org.membershipId) return { cards: [], mentions: [] };
    const me = org.membershipId;
    const cards = await this.prisma.taskCard.findMany({
      where: {
        AND: [
          cardScope(org),
          { archivedAt: null, OR: [{ ownerMembershipId: me }, { assignees: { some: { membershipId: me } } }] },
          { OR: [{ completedAt: null }, { completedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }] },
        ],
      },
      select: { ...CARD_SUMMARY, board: { select: { id: true, name: true } }, column: { select: { name: true, kind: true } } },
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
      take: 300,
    });
    const mentions = await this.prisma.taskComment.findMany({
      where: { mentions: { has: me }, createdAt: { gte: new Date(Date.now() - 14 * 86_400_000) }, card: { AND: [cardScope(org), { archivedAt: null }] } },
      select: { id: true, body: true, createdAt: true, authorId: true, card: { select: { id: true, number: true, title: true, boardId: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const authors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(mentions.map((m) => m.authorId))] } }, select: { id: true, name: true } });
    const nameOf = new Map(authors.map((a) => [a.id, a.name]));
    return {
      cards: cards.map(({ board, column, ...c }) => ({ ...summarize(c), board, column })),
      mentions: mentions.map((m) => ({ ...m, authorName: nameOf.get(m.authorId) ?? 'Pengguna dihapus' })),
    };
  }

  @Sse('tasks/stream')
  @RequirePermissions('tasks.read')
  events(@Org() org: OrgContext): Observable<{ type: string; data: unknown }> {
    return this.stream.stream(org.organizationId);
  }

  // ───────────── saved view ─────────────

  @Get('views')
  @RequirePermissions('tasks.read')
  views(@Org() org: OrgContext, @Query('boardId') boardId?: string) {
    if (!org.membershipId) return [];
    return this.prisma.savedView.findMany({ where: { membershipId: org.membershipId, ...(boardId ? { OR: [{ boardId }, { boardId: null }] } : {}) }, orderBy: { createdAt: 'asc' } });
  }

  @Post('views')
  @RequirePermissions('tasks.read')
  async createView(@Org() org: OrgContext, @Body() dto: ViewDto) {
    if (!org.membershipId) throw new ForbiddenException({ code: 'NOT_MEMBER', message: 'Hanya anggota organisasi yang dapat menyimpan view' });
    if (JSON.stringify(dto.filters).length > 4000) throw new BadRequestException({ code: 'FILTER_TOO_LARGE', message: 'Filter terlalu besar' });
    if (dto.boardId && !(await this.prisma.board.count({ where: { id: dto.boardId, organizationId: org.organizationId } }))) notFound('Board');
    if ((await this.prisma.savedView.count({ where: { membershipId: org.membershipId } })) >= 30) {
      throw new UnprocessableEntityException({ code: 'TOO_MANY_VIEWS', message: 'Maksimal 30 view tersimpan' });
    }
    return this.prisma.savedView.create({ data: { membershipId: org.membershipId, boardId: dto.boardId, name: dto.name.trim(), filters: dto.filters as Prisma.InputJsonValue } });
  }

  @Delete('views/:id')
  @RequirePermissions('tasks.read')
  async deleteView(@Org() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.prisma.savedView.deleteMany({ where: { id, membershipId: org.membershipId ?? '' } });
    if (!res.count) notFound('View');
    return { ok: true };
  }

  // ───────────── helper ─────────────

  private canApprove(org: OrgContext) {
    return org.isSuperAdmin || org.permissions.has('tasks.approve');
  }

  private async loadCard<I extends Prisma.TaskCardInclude>(org: OrgContext, id: string, include?: I) {
    const card = await this.prisma.taskCard.findFirst({ where: { AND: [cardScope(org), { id }] }, include });
    if (!card) notFound('Kartu');
    return card as Prisma.TaskCardGetPayload<{ include: I }>;
  }

  /** Perubahan sub-item (checklist, komentar, dst.) menaikkan versi kartu & memberi tahu klien lain. */
  private async touch(org: OrgContext, card: { id: string; boardId: string }, actorUserId: string) {
    await this.prisma.taskCard.update({ where: { id: card.id }, data: { version: { increment: 1 } } });
    await this.tasks.publish(org.organizationId, { type: 'card.updated', boardId: card.boardId, cardId: card.id, actorUserId });
  }

  private async assertTeam(org: OrgContext, teamId: string) {
    if (!(await this.prisma.team.count({ where: { id: teamId, organizationId: org.organizationId } }))) {
      throw new BadRequestException({ code: 'BAD_TEAM', message: 'Tim bukan milik organisasi ini' });
    }
  }

  /** Semua referensi (anggota, tim, campaign, akun) wajib milik organisasi & dalam cakupan pengguna. */
  private async validateRefs(org: OrgContext, dto: Partial<CreateCardDto>) {
    const members = [...new Set([...(dto.assigneeIds ?? []), ...(dto.ownerMembershipId ? [dto.ownerMembershipId] : [])])];
    if (members.length) {
      const n = await this.prisma.membership.count({ where: { id: { in: members }, organizationId: org.organizationId, status: 'ACTIVE' } });
      if (n !== members.length) throw new BadRequestException({ code: 'BAD_MEMBER', message: 'Ada anggota yang tidak valid / tidak aktif' });
    }
    if (dto.teamId) await this.assertTeam(org, dto.teamId);
    if (dto.campaignId) {
      assertCampaignAccess(org, dto.campaignId);
      if (!(await this.prisma.campaign.count({ where: { id: dto.campaignId, organizationId: org.organizationId } }))) {
        throw new BadRequestException({ code: 'BAD_CAMPAIGN', message: 'Campaign bukan milik organisasi ini' });
      }
    }
    if (dto.networkAccountId && !(await this.prisma.networkAccount.count({ where: { id: dto.networkAccountId, organizationId: org.organizationId } }))) {
      throw new BadRequestException({ code: 'BAD_ACCOUNT', message: 'Akun jaringan bukan milik organisasi ini' });
    }
  }
}
