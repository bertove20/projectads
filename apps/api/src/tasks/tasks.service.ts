import { ConflictException, Inject, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, TaskPriority, TaskSource } from '@prisma/client';
import type Redis from 'ioredis';
import { REDIS } from '../common/core.module';
import type { OrgContext } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { notFound } from '../common/scope';
import { checkEnterColumn, DEFAULT_COLUMNS, evenRanks, priorityForSeverity, rankAt } from './kanban';

export const TASK_CHANNEL_PREFIX = 'tasks:org:';

export interface TaskEvent {
  type: 'card.created' | 'card.updated' | 'card.moved' | 'card.deleted' | 'board.updated';
  boardId: string;
  cardId?: string;
  /** userId pelaku — klien bisa mengabaikan event dari dirinya sendiri */
  actorUserId?: string | null;
}

export interface NewCard {
  boardId: string;
  columnId?: string;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  ownerMembershipId?: string | null;
  assigneeIds?: string[];
  teamId?: string | null;
  campaignId?: string | null;
  networkAccountId?: string | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  approvalRequired?: boolean;
  source?: TaskSource;
  alertId?: string | null;
}

type Tx = Prisma.TransactionClient;

/**
 * Cakupan kartu: anggota ASSIGNED hanya melihat kartu campaign miliknya, atau kartu yang ia pegang/ikuti.
 */
export function cardScope(org: OrgContext): Prisma.TaskCardWhereInput {
  const base: Prisma.TaskCardWhereInput = { organizationId: org.organizationId };
  if (!org.campaignIds) return base;
  const or: Prisma.TaskCardWhereInput[] = [{ campaignId: { in: org.campaignIds } }];
  if (org.membershipId) {
    or.push({ ownerMembershipId: org.membershipId }, { assignees: { some: { membershipId: org.membershipId } } });
  }
  return { AND: [base, { OR: or }] };
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Event real-time hanya berisi ID; klien mengambil ulang data sesuai cakupannya sendiri. */
  async publish(organizationId: string, evt: TaskEvent) {
    try {
      await this.redis.publish(TASK_CHANNEL_PREFIX + organizationId, JSON.stringify(evt));
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Gagal publish event tugas');
    }
  }

  async activity(tx: Tx, cardId: string, actorUserId: string | null, type: string, data?: Prisma.InputJsonValue) {
    await tx.taskActivity.create({ data: { cardId, actorUserId, type, data } });
  }

  async createBoard(tx: Tx, organizationId: string, name: string, opts: { description?: string | null; teamId?: string | null; createdById?: string | null; isDefault?: boolean } = {}) {
    const existing = await tx.board.count({ where: { organizationId, archivedAt: null } });
    return tx.board.create({
      data: {
        organizationId,
        name,
        description: opts.description,
        teamId: opts.teamId,
        createdById: opts.createdById,
        isDefault: opts.isDefault ?? existing === 0,
        columns: { create: DEFAULT_COLUMNS.map((c, i) => ({ ...c, position: i })) },
      },
      include: { columns: { orderBy: { position: 'asc' } } },
    });
  }

  /** Board default organisasi; dibuat otomatis ("Operasional") bila belum ada. */
  async defaultBoard(tx: Tx, organizationId: string) {
    const b =
      (await tx.board.findFirst({ where: { organizationId, archivedAt: null, isDefault: true } })) ??
      (await tx.board.findFirst({ where: { organizationId, archivedAt: null }, orderBy: { createdAt: 'asc' } }));
    return b ?? this.createBoard(tx, organizationId, 'Operasional', { isDefault: true });
  }

  async createCard(tx: Tx, organizationId: string, input: NewCard, actorUserId: string | null) {
    const board = await tx.board.findFirst({ where: { id: input.boardId, organizationId, archivedAt: null }, include: { columns: { orderBy: { position: 'asc' } } } });
    if (!board) notFound('Board');
    const column = input.columnId
      ? board.columns.find((c) => c.id === input.columnId)
      : (board.columns.find((c) => c.kind === 'TODO') ?? board.columns[0]);
    if (!column) throw new UnprocessableEntityException({ code: 'BAD_COLUMN', message: 'Kolom tidak ada di board ini' });
    if (column.kind === 'DONE') throw new UnprocessableEntityException({ code: 'EVIDENCE_REQUIRED', message: 'Kartu baru tidak bisa langsung masuk Done' });
    if (column.wipLimit != null) {
      const n = await tx.taskCard.count({ where: { columnId: column.id, archivedAt: null } });
      if (n >= column.wipLimit) throw new UnprocessableEntityException({ code: 'WIP_LIMIT', message: `Kolom sudah mencapai batas WIP (${column.wipLimit})` });
    }

    // Nomor kartu per organisasi diserialkan dengan advisory lock transaksi.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'task-number:' + organizationId}))`;
    const [{ next }] = await tx.$queryRaw<{ next: number }[]>`SELECT COALESCE(MAX(number), 0)::int + 1 AS next FROM task_cards WHERE organization_id = ${organizationId}::uuid`;
    const last = await tx.taskCard.findFirst({ where: { columnId: column.id }, orderBy: { rank: 'desc' }, select: { rank: true } });

    const assigneeIds = [...new Set(input.assigneeIds ?? [])];
    const card = await tx.taskCard.create({
      data: {
        organizationId,
        number: next,
        boardId: board.id,
        columnId: column.id,
        rank: rankAt(last ? [last.rank] : [], 1)!,
        title: input.title,
        description: input.description,
        priority: input.priority ?? 'MEDIUM',
        ownerMembershipId: input.ownerMembershipId,
        teamId: input.teamId ?? board.teamId,
        campaignId: input.campaignId,
        networkAccountId: input.networkAccountId,
        startDate: input.startDate,
        dueDate: input.dueDate,
        approvalRequired: input.approvalRequired ?? false,
        source: input.source ?? 'MANUAL',
        alertId: input.alertId,
        createdById: actorUserId,
        assignees: assigneeIds.length ? { create: assigneeIds.map((membershipId) => ({ membershipId })) } : undefined,
      },
    });
    await this.activity(tx, card.id, actorUserId, 'created', { column: column.name, source: card.source });
    return card;
  }

  /**
   * Pindahkan kartu ke kolom/posisi. Atomik: kolom tujuan dikunci (FOR UPDATE) agar dua pemindahan
   * bersamaan tidak menghasilkan rank yang sama; versi kartu dicek (optimistic concurrency).
   */
  async moveCard(org: OrgContext, actorUserId: string, cardId: string, target: { columnId: string; index: number; version: number }) {
    const result = await this.prisma.$transaction(async (tx) => {
      const card = await tx.taskCard.findFirst({ where: { AND: [cardScope(org), { id: cardId, archivedAt: null }] }, include: { column: true } });
      if (!card) notFound('Kartu');
      if (card.version !== target.version) throw this.conflict();
      const column = await tx.boardColumn.findFirst({ where: { id: target.columnId, boardId: card.boardId } });
      if (!column) throw new UnprocessableEntityException({ code: 'BAD_COLUMN', message: 'Kolom tidak ada di board ini' });

      await tx.$queryRaw`SELECT id FROM board_columns WHERE id = ${column.id}::uuid FOR UPDATE`;
      const siblings = await tx.taskCard.findMany({
        where: { columnId: column.id, archivedAt: null, id: { not: card.id } },
        orderBy: { rank: 'asc' },
        select: { id: true, rank: true },
      });
      const sameColumn = column.id === card.columnId;
      const openDependencies = await tx.taskDependency.count({ where: { cardId: card.id, dependsOn: { completedAt: null } } });
      const violation = checkEnterColumn({
        targetKind: column.kind,
        sameColumn,
        completionEvidence: card.completionEvidence,
        approvalRequired: card.approvalRequired,
        canApprove: org.isSuperAdmin || org.permissions.has('tasks.approve'),
        openDependencies,
        targetCount: siblings.length,
        wipLimit: column.wipLimit,
      });
      if (violation) throw new UnprocessableEntityException(violation);

      let rank = rankAt(siblings.map((s) => s.rank), target.index);
      if (rank === null) {
        // Pemadatan ulang kolom, lalu hitung lagi.
        const ranks = evenRanks(siblings.length);
        for (let i = 0; i < siblings.length; i++) {
          await tx.taskCard.update({ where: { id: siblings[i].id }, data: { rank: ranks[i] } });
        }
        rank = rankAt(ranks, target.index)!;
      }

      const enteringDone = column.kind === 'DONE' && card.column.kind !== 'DONE';
      const leavingDone = column.kind !== 'DONE' && card.column.kind === 'DONE';
      const updated = await tx.taskCard.updateMany({
        where: { id: card.id, version: target.version },
        data: {
          columnId: column.id,
          rank,
          version: { increment: 1 },
          ...(enteringDone ? { completedAt: new Date() } : {}),
          ...(leavingDone ? { completedAt: null } : {}),
        },
      });
      if (updated.count === 0) throw this.conflict();
      if (!sameColumn) {
        await this.activity(tx, card.id, actorUserId, 'moved', { from: card.column.name, to: column.name });
        if (enteringDone && card.approvalRequired) await this.activity(tx, card.id, actorUserId, 'approved');
      }
      return { card: await tx.taskCard.findUniqueOrThrow({ where: { id: card.id } }), sameColumn };
    });
    await this.publish(org.organizationId, { type: 'card.moved', boardId: result.card.boardId, cardId, actorUserId });
    return result.card;
  }

  conflict() {
    return new ConflictException({ code: 'VERSION_CONFLICT', message: 'Kartu sudah diubah orang lain — muat ulang lalu coba lagi' });
  }

  /**
   * Alert HIGH/CRITICAL → incident card di board default, di-assign ke anggota berjabatan Tracking Specialist.
   * Idempoten per alert (alertId unik); alert yang dibuka ulang memindahkan kartu selesai kembali ke To Do.
   */
  async incidentFromAlert(alertId: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id: alertId }, include: { taskCard: { include: { column: true } } } });
    if (!alert || !['HIGH', 'CRITICAL'].includes(alert.severity)) return null;

    const res = await this.prisma.$transaction(async (tx) => {
      if (alert.taskCard) {
        const card = alert.taskCard;
        await this.activity(tx, card.id, null, 'alert_reopened', { severity: alert.severity });
        if (card.column.kind === 'DONE' || card.archivedAt) {
          const todo = (await tx.boardColumn.findFirst({ where: { boardId: card.boardId, kind: 'TODO' } })) ?? (await tx.boardColumn.findFirst({ where: { boardId: card.boardId }, orderBy: { position: 'asc' } }));
          if (todo) {
            await tx.taskCard.update({ where: { id: card.id }, data: { columnId: todo.id, completedAt: null, archivedAt: null, version: { increment: 1 } } });
          }
        }
        return { card, created: false };
      }
      // Alert berkunci per tanggal/jam (mis. selisih rekonsiliasi harian) untuk jenis & entitas yang sama
      // digabung ke incident card yang masih terbuka, agar board tidak dibanjiri kartu kembar.
      if (alert.entityId) {
        const open = await tx.taskCard.findFirst({
          where: { organizationId: alert.organizationId, source: 'ALERT', completedAt: null, archivedAt: null, alert: { type: alert.type, entityType: alert.entityType, entityId: alert.entityId } },
          orderBy: { createdAt: 'desc' },
        });
        if (open) {
          await this.activity(tx, open.id, null, 'alert_repeated', { title: alert.title, severity: alert.severity });
          if (priorityForSeverity(alert.severity) === 'URGENT' && open.priority !== 'URGENT') {
            await tx.taskCard.update({ where: { id: open.id }, data: { priority: 'URGENT', version: { increment: 1 } } });
          }
          return { card: open, created: false };
        }
      }
      const board = await this.defaultBoard(tx, alert.organizationId);
      // Entitas alert bisa saja sudah dihapus — tautkan hanya bila masih ada.
      const campaignId = alert.entityType === 'campaign' && alert.entityId && (await tx.campaign.count({ where: { id: alert.entityId, organizationId: alert.organizationId } })) ? alert.entityId : null;
      const networkAccountId = alert.entityType === 'network_account' && alert.entityId && (await tx.networkAccount.count({ where: { id: alert.entityId, organizationId: alert.organizationId } })) ? alert.entityId : null;
      const tracking = await tx.membershipPosition.findFirst({
        where: { position: 'TRACKING_SPECIALIST', membership: { organizationId: alert.organizationId, status: 'ACTIVE' } },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });
      const card = await this.createCard(
        tx,
        alert.organizationId,
        {
          boardId: board.id,
          title: `[Insiden] ${alert.title}`.slice(0, 200),
          description: alert.body,
          priority: priorityForSeverity(alert.severity),
          ownerMembershipId: tracking?.membershipId ?? null,
          campaignId,
          networkAccountId,
          source: 'ALERT',
          alertId: alert.id,
        },
        null,
      );
      return { card, created: true };
    });
    await this.publish(alert.organizationId, { type: res.created ? 'card.created' : 'card.updated', boardId: res.card.boardId, cardId: res.card.id });
    return res.card;
  }
}
