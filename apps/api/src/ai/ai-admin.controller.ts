import { BadGatewayException, BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Position, Prisma } from '@prisma/client';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { AuthUser, CurrentUser, Org, OrgContext, RequirePermissions } from '../common/decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertFullScope, notFound } from '../common/scope';
import { periodStarts } from './ai-core';
import { AiService, POSITION_LABEL } from './ai.service';
import { OpenRouterClient, OpenRouterError, OrModel } from './openrouter.client';
import { ENV, Env } from '../config/env';

class SettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber() @Min(0) @Max(1_000_000) monthlyBudgetUsd?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(3650) retentionDays?: number;
}
class ApiKeyDto {
  @IsString() @Length(20, 300) apiKey: string;
}
class ModelToggleDto {
  @IsBoolean() enabled: boolean;
}
class PositionConfigDto {
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() modelId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() fallbackModelId?: string | null;
  @IsOptional() @IsNumber() @Min(0) @Max(2) temperature?: number;
  @IsOptional() @IsInt() @Min(64) @Max(32_000) maxTokens?: number;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber() @Min(0) @Max(100_000) dailyBudgetUsd?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber() @Min(0) @Max(1_000_000) monthlyBudgetUsd?: number | null;
}
class MemberConfigDto {
  @IsOptional() @IsBoolean() aiEnabled?: boolean;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() modelId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() fallbackModelId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber() @Min(0) @Max(2) temperature?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(64) @Max(32_000) maxTokens?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber() @Min(0) @Max(100_000) dailyBudgetUsd?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber() @Min(0) @Max(1_000_000) monthlyBudgetUsd?: number | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(1) @Max(10_000) maxRequestsPerDay?: number | null;
}

const MODEL_SELECT = { id: true, modelId: true, name: true } as const;
const POSITIONS = Object.keys(POSITION_LABEL) as Position[];

/** Konversi model OpenRouter → baris registry. Harga OpenRouter berupa string USD per token. */
export function modelRow(m: OrModel) {
  const price = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return {
    name: String(m.name ?? m.id).slice(0, 200),
    contextLength: typeof m.context_length === 'number' ? m.context_length : null,
    maxCompletionTokens: typeof m.top_provider?.max_completion_tokens === 'number' ? m.top_provider.max_completion_tokens : null,
    promptPrice: price(m.pricing?.prompt),
    completionPrice: price(m.pricing?.completion),
    supportsTools: Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'),
  };
}

@ApiTags('ai-admin')
@Controller('ai')
export class AiAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('settings')
  @RequirePermissions('ai.manage')
  async settings(@Org() org: OrgContext) {
    const s = await this.ai.settings(org.organizationId);
    const { month } = periodStarts();
    const spent = await this.prisma.aiUsageLog.aggregate({ where: { organizationId: org.organizationId, createdAt: { gte: month } }, _sum: { costUsd: true } });
    return {
      enabled: s.enabled,
      hasKey: !!s.apiKeyCiphertext,
      apiKeyHint: s.apiKeyHint,
      apiKeyValidatedAt: s.apiKeyValidatedAt,
      monthlyBudgetUsd: s.monthlyBudgetUsd == null ? null : Number(s.monthlyBudgetUsd),
      retentionDays: s.retentionDays,
      modelsSyncedAt: s.modelsSyncedAt,
      monthSpentUsd: Number(spent._sum.costUsd ?? 0),
    };
  }

  @Patch('settings')
  @RequirePermissions('ai.manage')
  async updateSettings(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: SettingsDto) {
    assertFullScope(org);
    const before = await this.ai.settings(org.organizationId);
    if (dto.enabled && !before.apiKeyCiphertext) throw new BadRequestException({ code: 'AI_NOT_CONFIGURED', message: 'Atur API key OpenRouter sebelum mengaktifkan AI' });
    await this.prisma.aiSettings.update({ where: { organizationId: org.organizationId }, data: { enabled: dto.enabled, monthlyBudgetUsd: dto.monthlyBudgetUsd, retentionDays: dto.retentionDays } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.settings', entityType: 'ai_settings', entityId: org.organizationId, before: { enabled: before.enabled, monthlyBudgetUsd: before.monthlyBudgetUsd, retentionDays: before.retentionDays }, after: dto });
    return this.settings(org);
  }

  /** Key diuji ke OpenRouter dulu; hanya key yang valid yang disimpan (terenkripsi). */
  @Put('settings/api-key')
  @RequirePermissions('ai.credentials')
  async setKey(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Body() dto: ApiKeyDto) {
    assertFullScope(org);
    const key = dto.apiKey.trim();
    if (/\s/.test(key)) throw new BadRequestException({ code: 'BAD_KEY', message: 'Format API key tidak valid' });
    let models: OrModel[];
    try {
      models = await new OpenRouterClient(this.env.OPENROUTER_API_BASE, key, 20_000).listModels();
    } catch (err) {
      if (err instanceof OpenRouterError && err.isAuthError) throw new BadRequestException({ code: 'KEY_REJECTED', message: 'API key ditolak OpenRouter' });
      throw new BadGatewayException({ code: 'AI_UPSTREAM', message: `Tidak dapat memvalidasi key: ${(err as Error).message}` });
    }
    await this.ai.settings(org.organizationId);
    await this.prisma.aiSettings.update({
      where: { organizationId: org.organizationId },
      data: { apiKeyCiphertext: this.crypto.encrypt(key), apiKeyHint: `…${key.slice(-4)}`, apiKeyValidatedAt: new Date() },
    });
    const synced = await this.storeModels(org.organizationId, models);
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.api_key.set', entityType: 'ai_settings', entityId: org.organizationId, after: { hint: `…${key.slice(-4)}` } });
    return { ok: true, models: synced };
  }

  @Delete('settings/api-key')
  @RequirePermissions('ai.credentials')
  async deleteKey(@Org() org: OrgContext, @CurrentUser() user: AuthUser) {
    assertFullScope(org);
    await this.ai.settings(org.organizationId);
    await this.prisma.aiSettings.update({ where: { organizationId: org.organizationId }, data: { apiKeyCiphertext: null, apiKeyHint: null, apiKeyValidatedAt: null, enabled: false } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.api_key.delete', entityType: 'ai_settings', entityId: org.organizationId });
    return { ok: true };
  }

  @Post('models/sync')
  @RequirePermissions('ai.manage')
  @HttpCode(200)
  async sync(@Org() org: OrgContext) {
    let models: OrModel[];
    try {
      models = await (await this.ai.client(org.organizationId)).listModels();
    } catch (err) {
      if (err instanceof OpenRouterError) throw new BadGatewayException({ code: 'AI_UPSTREAM', message: `Sinkronisasi model gagal: ${err.message}` });
      throw err;
    }
    return { ok: true, models: await this.storeModels(org.organizationId, models) };
  }

  private async storeModels(organizationId: string, models: OrModel[]) {
    const valid = models.filter((m) => typeof m?.id === 'string' && /^[\w.:@~/-]{3,200}$/.test(m.id));
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const m of valid) {
        const row = modelRow(m);
        await tx.aiModel.upsert({
          where: { organizationId_modelId: { organizationId, modelId: m.id } },
          create: { organizationId, modelId: m.id, ...row, available: true, lastValidatedAt: now },
          update: { ...row, available: true, lastValidatedAt: now },
        });
      }
      // Model yang hilang dari OpenRouter ditandai tidak tersedia (tidak dihapus agar riwayat tetap utuh).
      await tx.aiModel.updateMany({ where: { organizationId, modelId: { notIn: valid.map((m) => m.id) } }, data: { available: false } });
      await tx.aiSettings.update({ where: { organizationId }, data: { modelsSyncedAt: now } });
    }, { timeout: 60_000 });
    return valid.length;
  }

  @Get('models')
  @RequirePermissions('ai.manage')
  async models(@Org() org: OrgContext, @Query('q') q?: string, @Query('enabled') enabled?: string) {
    return this.prisma.aiModel.findMany({
      where: {
        organizationId: org.organizationId,
        ...(enabled === '1' ? { enabled: true } : {}),
        ...(q ? { OR: [{ modelId: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ enabled: 'desc' }, { modelId: 'asc' }],
      take: enabled === '1' ? 500 : 300,
    });
  }

  @Patch('models/:id')
  @RequirePermissions('ai.manage')
  async toggleModel(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModelToggleDto) {
    const m = await this.prisma.aiModel.findFirst({ where: { id, organizationId: org.organizationId } });
    if (!m) notFound('Model');
    const updated = await this.prisma.aiModel.update({ where: { id }, data: { enabled: dto.enabled } });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: dto.enabled ? 'ai.model.enable' : 'ai.model.disable', entityType: 'ai_model', entityId: id, after: { modelId: m.modelId } });
    return updated;
  }

  @Get('positions')
  @RequirePermissions('ai.manage')
  async positions(@Org() org: OrgContext) {
    const rows = await this.prisma.aiPositionConfig.findMany({ where: { organizationId: org.organizationId }, include: { model: { select: MODEL_SELECT }, fallback: { select: MODEL_SELECT } } });
    const counts = await this.prisma.membershipPosition.groupBy({ by: ['position'], where: { membership: { organizationId: org.organizationId, status: 'ACTIVE' } }, _count: true });
    return POSITIONS.map((p) => {
      const r = rows.find((x) => x.position === p);
      return {
        position: p,
        label: POSITION_LABEL[p],
        members: counts.find((c) => c.position === p)?._count ?? 0,
        model: r?.model ?? null,
        fallback: r?.fallback ?? null,
        temperature: r?.temperature ?? 0.3,
        maxTokens: r?.maxTokens ?? 1200,
        dailyBudgetUsd: r?.dailyBudgetUsd == null ? null : Number(r.dailyBudgetUsd),
        monthlyBudgetUsd: r?.monthlyBudgetUsd == null ? null : Number(r.monthlyBudgetUsd),
      };
    });
  }

  @Put('positions/:position')
  @RequirePermissions('ai.manage')
  async setPosition(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('position') position: string, @Body() dto: PositionConfigDto) {
    assertFullScope(org);
    if (!POSITIONS.includes(position as Position)) throw new BadRequestException({ code: 'BAD_POSITION', message: 'Jabatan tidak dikenal' });
    await this.assertModels(org, [dto.modelId, dto.fallbackModelId]);
    const data = { modelId: dto.modelId, fallbackModelId: dto.fallbackModelId, temperature: dto.temperature, maxTokens: dto.maxTokens, dailyBudgetUsd: dto.dailyBudgetUsd, monthlyBudgetUsd: dto.monthlyBudgetUsd };
    await this.prisma.aiPositionConfig.upsert({
      where: { organizationId_position: { organizationId: org.organizationId, position: position as Position } },
      create: { organizationId: org.organizationId, position: position as Position, ...data },
      update: data,
    });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.position_config', entityType: 'ai_position_config', entityId: null, after: { position, ...dto } });
    return (await this.positions(org)).find((p) => p.position === position);
  }

  @Get('members')
  @RequirePermissions('ai.manage')
  async members(@Org() org: OrgContext) {
    const { month } = periodStarts();
    const rows = await this.prisma.membership.findMany({
      where: { organizationId: org.organizationId, status: 'ACTIVE' },
      select: {
        id: true,
        user: { select: { name: true } },
        positions: { select: { position: true, isPrimary: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        aiConfig: { include: { model: { select: MODEL_SELECT }, fallback: { select: MODEL_SELECT } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const usage = await this.prisma.aiUsageLog.groupBy({ by: ['membershipId'], where: { organizationId: org.organizationId, createdAt: { gte: month } }, _sum: { costUsd: true }, _count: true });
    return rows.map((m) => {
      const u = usage.find((x) => x.membershipId === m.id);
      const c = m.aiConfig;
      return {
        id: m.id,
        name: m.user.name,
        positions: m.positions.map((p) => p.position),
        config: c
          ? {
              aiEnabled: c.aiEnabled,
              model: c.model,
              fallback: c.fallback,
              temperature: c.temperature,
              maxTokens: c.maxTokens,
              dailyBudgetUsd: c.dailyBudgetUsd == null ? null : Number(c.dailyBudgetUsd),
              monthlyBudgetUsd: c.monthlyBudgetUsd == null ? null : Number(c.monthlyBudgetUsd),
              maxRequestsPerDay: c.maxRequestsPerDay,
            }
          : null,
        monthSpentUsd: Number(u?._sum.costUsd ?? 0),
        monthRequests: u?._count ?? 0,
      };
    });
  }

  @Put('members/:id')
  @RequirePermissions('ai.manage')
  async setMember(@Org() org: OrgContext, @CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MemberConfigDto) {
    assertFullScope(org);
    if (!(await this.prisma.membership.count({ where: { id, organizationId: org.organizationId } }))) notFound('Anggota');
    await this.assertModels(org, [dto.modelId, dto.fallbackModelId]);
    const data = {
      aiEnabled: dto.aiEnabled,
      modelId: dto.modelId,
      fallbackModelId: dto.fallbackModelId,
      temperature: dto.temperature,
      maxTokens: dto.maxTokens,
      dailyBudgetUsd: dto.dailyBudgetUsd,
      monthlyBudgetUsd: dto.monthlyBudgetUsd,
      maxRequestsPerDay: dto.maxRequestsPerDay,
    };
    await this.prisma.aiMemberConfig.upsert({ where: { membershipId: id }, create: { membershipId: id, ...data }, update: data });
    await this.audit.log({ organizationId: org.organizationId, actorUserId: user.id, action: 'ai.member_config', entityType: 'membership', entityId: id, after: dto });
    return (await this.members(org)).find((m) => m.id === id);
  }

  @Get('usage')
  @RequirePermissions('ai.manage')
  async usage(@Org() org: OrgContext, @Query('days') daysQ?: string) {
    const days = Math.min(90, Math.max(1, Number(daysQ) || 30));
    const since = new Date(Date.now() - days * 86_400_000);
    const where: Prisma.AiUsageLogWhereInput = { organizationId: org.organizationId, createdAt: { gte: since } };
    const [byModel, byStatus, byDay, recentErrors] = await Promise.all([
      this.prisma.aiUsageLog.groupBy({ by: ['modelId'], where, _sum: { costUsd: true, promptTokens: true, completionTokens: true }, _count: true, orderBy: { _sum: { costUsd: 'desc' } } }),
      this.prisma.aiUsageLog.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.$queryRaw<{ day: string; cost: number; requests: number }[]>`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COALESCE(SUM(cost_usd), 0)::float AS cost, COUNT(*)::int AS requests
        FROM ai_usage_logs WHERE organization_id = ${org.organizationId}::uuid AND created_at >= ${since}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.aiUsageLog.findMany({ where: { ...where, status: { in: ['ERROR', 'BLOCKED'] } }, orderBy: { createdAt: 'desc' }, take: 20, select: { createdAt: true, modelId: true, status: true, error: true, usedFallback: true } }),
    ]);
    return {
      days,
      byModel: byModel.map((m) => ({ modelId: m.modelId, requests: m._count, costUsd: Number(m._sum.costUsd ?? 0), promptTokens: m._sum.promptTokens ?? 0, completionTokens: m._sum.completionTokens ?? 0 })),
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      byDay,
      recentErrors,
    };
  }

  private async assertModels(org: OrgContext, ids: (string | null | undefined)[]) {
    if (ids[0] && ids[0] === ids[1]) throw new BadRequestException({ code: 'SAME_MODEL', message: 'Model fallback harus berbeda dari model utama' });
    const want = ids.filter((x): x is string => !!x);
    if (!want.length) return;
    const n = await this.prisma.aiModel.count({ where: { id: { in: want }, organizationId: org.organizationId, enabled: true } });
    if (n !== new Set(want).size) throw new BadRequestException({ code: 'BAD_MODEL', message: 'Model harus dari registry organisasi dan sudah diaktifkan' });
  }
}
