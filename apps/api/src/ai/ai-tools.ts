import { Injectable } from '@nestjs/common';
import { AlertStatus, Prisma, TaskPriority } from '@prisma/client';
import type { OrgContext } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { campaignIdScope, campaignScope } from '../common/scope';
import { isDateString } from '../common/tz';
import type { PermissionKey } from '../rbac/permissions';
import { AnalyticsService, GroupBy } from '../reports/analytics.service';
import { cardScope } from '../tasks/tasks.service';
import { sanitizeText } from './ai-core';
import type { OrTool } from './openrouter.client';

export interface ToolContext {
  org: OrgContext;
  conversationId: string;
  membershipId: string;
  timezone: string;
}

interface ToolDef {
  description: string;
  permission: PermissionKey;
  parameters: Record<string, unknown>;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<unknown>;
}

const AI_GROUP_BY: GroupBy[] = ['campaign', 'day', 'zone', 'country', 'offer', 'landing', 'device', 'os', 'network'];
const MAX_RANGE_DAYS = 92;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ToolInputError extends Error {}

const round = (n: number | null, d = 4) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

/**
 * Tool yang bisa dipanggil AI Assistant. Semua membaca data lewat Prisma/AnalyticsService dengan cakupan
 * pengguna (OrgContext) — AI tidak pernah melihat campaign yang tidak di-assign, dan tidak ada SQL dari model.
 * Satu-satunya "aksi" adalah membuat DRAFT task yang harus disetujui manusia.
 */
@Injectable()
export class AiToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  readonly defs: Record<string, ToolDef> = {
    list_campaigns: {
      description: 'Daftar campaign yang boleh diakses pengguna (id, nama, status, jaringan, format iklan, model bid).',
      permission: 'campaigns.read',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async ({ org }) => {
        const rows = await this.prisma.campaign.findMany({
          where: campaignScope(org),
          select: { id: true, name: true, status: true, adFormat: true, bidModel: true, networkAccount: { select: { network: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 200,
        });
        return rows.map((c) => ({ id: c.id, name: sanitizeText(c.name, 120), status: c.status, network: c.networkAccount?.network ?? null, account: sanitizeText(c.networkAccount?.name, 80), adFormat: c.adFormat, bidModel: c.bidModel }));
      },
    },
    campaign_performance: {
      description:
        'Laporan performa internal (klik, konversi VERIFIED, revenue, spend, profit, CR, CPA, ROI) per dimensi dalam rentang tanggal. Revenue hanya dari konversi VERIFIED.',
      permission: 'analytics.read',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Tanggal awal YYYY-MM-DD (zona waktu organisasi)' },
          to: { type: 'string', description: 'Tanggal akhir YYYY-MM-DD, inklusif' },
          groupBy: { type: 'string', enum: AI_GROUP_BY },
          campaignId: { type: 'string', description: 'Opsional: batasi ke satu campaign (UUID dari list_campaigns)' },
        },
        required: ['from', 'to', 'groupBy'],
        additionalProperties: false,
      },
      run: async ({ org }, a) => {
        const from = String(a.from ?? '');
        const to = String(a.to ?? '');
        if (!isDateString(from) || !isDateString(to)) throw new ToolInputError('from/to harus YYYY-MM-DD');
        const groupBy = String(a.groupBy) as GroupBy;
        if (!AI_GROUP_BY.includes(groupBy)) throw new ToolInputError(`groupBy harus salah satu: ${AI_GROUP_BY.join(', ')}`);
        const fromD = new Date(`${from}T00:00:00Z`);
        const toD = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000);
        if (toD <= fromD) throw new ToolInputError('to harus ≥ from');
        if ((toD.getTime() - fromD.getTime()) / 86_400_000 > MAX_RANGE_DAYS) throw new ToolInputError(`Rentang maksimal ${MAX_RANGE_DAYS} hari`);
        const campaignId = a.campaignId ? String(a.campaignId) : undefined;
        if (campaignId && !UUID_RE.test(campaignId)) throw new ToolInputError('campaignId harus UUID');
        if (campaignId && org.campaignIds && !org.campaignIds.includes(campaignId)) throw new ToolInputError('Campaign tidak dapat diakses pengguna ini');
        const r = await this.analytics.report(org, { from: fromD, to: toD, groupBy, campaignId });
        const slim = (x: (typeof r.rows)[number]) => ({
          key: x.key,
          label: sanitizeText(x.label, 120),
          clicks: x.clicks,
          conversions: x.conversions,
          revenue: round(x.revenue, 2),
          spend: round(x.spend, 2),
          spendSource: x.spendSource,
          profit: round(x.profit, 2),
          cr: round(x.cr),
          cpa: round(x.cpa, 2),
          roi: round(x.roi),
        });
        return { currency: r.currency, timezone: r.timezone, range: { from, to }, groupBy, rows: r.rows.slice(0, 60).map(slim), totals: slim(r.totals), notes: r.notes, rowsTruncated: r.rows.length > 60 };
      },
    },
    list_alerts: {
      description: 'Alert operasional (sinkronisasi gagal, selisih rekonsiliasi, postback gagal, DNS domain).',
      permission: 'alerts.read',
      parameters: { type: 'object', properties: { status: { type: 'string', enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] } }, additionalProperties: false },
      run: async ({ org }, a) => {
        const status = a.status && String(a.status) in AlertStatus ? (String(a.status) as AlertStatus) : 'OPEN';
        const scope: Prisma.AlertWhereInput = org.campaignIds
          ? { OR: [{ entityType: { not: 'campaign' } }, { entityType: null }, { entityType: 'campaign', entityId: { in: org.campaignIds } }] }
          : {};
        const rows = await this.prisma.alert.findMany({ where: { AND: [{ organizationId: org.organizationId, status }, scope] }, orderBy: { lastSeenAt: 'desc' }, take: 30 });
        return rows.map((x) => ({ type: x.type, severity: x.severity, status: x.status, title: sanitizeText(x.title, 200), detail: sanitizeText(x.body, 500), occurrences: x.occurrences, lastSeenAt: x.lastSeenAt }));
      },
    },
    postback_health: {
      description: 'Kesehatan tracking: status konversi (OBSERVED/VERIFIED/…), postback keluar per status, dan hasil postback masuk dalam N hari terakhir.',
      permission: 'postbacks.read',
      parameters: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 30 } }, additionalProperties: false },
      run: async ({ org }, a) => {
        const days = Math.min(30, Math.max(1, Number(a.days) || 7));
        const since = new Date(Date.now() - days * 86_400_000);
        const conv = await this.prisma.conversion.groupBy({ by: ['status'], where: { ...campaignIdScope(org), createdAt: { gte: since } }, _count: true });
        const deliv = await this.prisma.postbackDelivery.groupBy({
          by: ['status'],
          where: { organizationId: org.organizationId, createdAt: { gte: since }, ...(org.campaignIds ? { conversion: { campaignId: { in: org.campaignIds } } } : {}) },
          _count: true,
        });
        // Postback masuk tanpa campaign (klik tak dikenal) hanya untuk cakupan penuh.
        const inbound = org.campaignIds
          ? []
          : await this.prisma.inboundPostback.groupBy({ by: ['result'], where: { organizationId: org.organizationId, receivedAt: { gte: since } }, _count: true });
        return {
          days,
          conversionsByStatus: Object.fromEntries(conv.map((c) => [c.status, c._count])),
          outboundPostbacksByStatus: Object.fromEntries(deliv.map((d) => [d.status, d._count])),
          inboundPostbacksByResult: Object.fromEntries(inbound.map((i) => [i.result, i._count])),
        };
      },
    },
    my_tasks: {
      description: 'Kartu Kanban yang dipegang/diikuti pengguna dan belum selesai (judul, kolom, prioritas, tenggat, blocked).',
      permission: 'tasks.read',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async ({ org, membershipId }) => {
        const rows = await this.prisma.taskCard.findMany({
          where: { AND: [cardScope(org), { archivedAt: null, completedAt: null, OR: [{ ownerMembershipId: membershipId }, { assignees: { some: { membershipId } } }] }] },
          select: { number: true, title: true, priority: true, dueDate: true, column: { select: { name: true } }, dependsOn: { select: { dependsOn: { select: { completedAt: true } } } } },
          orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }],
          take: 50,
        });
        return rows.map((c) => ({ ref: `T-${c.number}`, title: sanitizeText(c.title, 200), column: c.column.name, priority: c.priority, dueDate: c.dueDate?.toISOString().slice(0, 10) ?? null, blocked: c.dependsOn.some((d) => !d.dependsOn.completedAt) }));
      },
    },
    propose_task: {
      description:
        'Usulkan DRAFT task card untuk ditinjau pengguna. Tidak membuat kartu langsung dan tidak mengubah campaign. Pakai untuk rekomendasi yang perlu ditindaklanjuti.',
      permission: 'tasks.write',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Judul ringkas berupa tindakan, maks 200 karakter' },
          description: { type: 'string', description: 'Alasan berbasis data + langkah konkret' },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] },
          campaignId: { type: 'string', description: 'UUID campaign terkait (opsional)' },
          dueDate: { type: 'string', description: 'YYYY-MM-DD (opsional)' },
        },
        required: ['title'],
        additionalProperties: false,
      },
      run: async ({ org, conversationId, membershipId }, a) => {
        const title = sanitizeText(a.title, 200).trim();
        if (title.length < 3) throw new ToolInputError('title minimal 3 karakter');
        const priority = a.priority && String(a.priority) in TaskPriority ? (String(a.priority) as TaskPriority) : 'MEDIUM';
        let campaignId: string | null = a.campaignId ? String(a.campaignId) : null;
        if (campaignId) {
          const ok = UUID_RE.test(campaignId) && (await this.prisma.campaign.count({ where: { AND: [campaignScope(org), { id: campaignId }] } }));
          if (!ok) campaignId = null;
        }
        const dueDate = a.dueDate && isDateString(String(a.dueDate)) ? new Date(`${String(a.dueDate)}T00:00:00Z`) : null;
        const pending = await this.prisma.aiTaskDraft.count({ where: { conversationId, status: 'PENDING' } });
        if (pending >= 10) throw new ToolInputError('Sudah ada 10 draft menunggu di percakapan ini');
        const d = await this.prisma.aiTaskDraft.create({
          data: { organizationId: org.organizationId, conversationId, membershipId, title, description: a.description ? sanitizeText(a.description, 4000) : null, priority, campaignId, dueDate },
        });
        return { draftId: d.id, status: 'PENDING', note: 'Draft tampil di layar pengguna untuk disetujui atau ditolak.' };
      },
    },
  };

  /** Definisi tool untuk model: hanya tool dari skill aktif DAN yang diizinkan permission pengguna. */
  toolsFor(org: OrgContext, names: Iterable<string>): OrTool[] {
    const out: OrTool[] = [];
    for (const name of new Set(names)) {
      const d = this.defs[name];
      if (!d || !(org.isSuperAdmin || org.permissions.has(d.permission))) continue;
      out.push({ type: 'function', function: { name, description: d.description, parameters: d.parameters } });
    }
    return out;
  }

  async execute(ctx: ToolContext, name: string, allowed: Set<string>, rawArgs: string): Promise<{ ok: boolean; result: unknown }> {
    const d = this.defs[name];
    if (!d || !allowed.has(name)) return { ok: false, result: { error: `Tool "${sanitizeText(name, 60)}" tidak tersedia` } };
    let args: Record<string, unknown>;
    try {
      const parsed = rawArgs ? JSON.parse(rawArgs) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      args = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, result: { error: 'Argumen tool bukan objek JSON yang valid' } };
    }
    try {
      return { ok: true, result: await d.run(ctx, args) };
    } catch (err) {
      if (err instanceof ToolInputError) return { ok: false, result: { error: err.message } };
      throw err;
    }
  }
}
