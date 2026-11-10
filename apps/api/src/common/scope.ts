import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { OrgContext } from './decorators';

/** Filter campaign sesuai cakupan data anggota (ALL atau ASSIGNED). */
export function campaignScope(org: OrgContext): Prisma.CampaignWhereInput {
  return {
    organizationId: org.organizationId,
    ...(org.campaignIds ? { id: { in: org.campaignIds } } : {}),
  };
}

/** Filter untuk tabel yang memiliki campaignId (clicks, conversions, spend). */
export function campaignIdScope(org: OrgContext): { organizationId: string; campaignId?: { in: string[] } } {
  return {
    organizationId: org.organizationId,
    ...(org.campaignIds ? { campaignId: { in: org.campaignIds } } : {}),
  };
}

export function assertCampaignAccess(org: OrgContext, campaignId: string) {
  if (org.campaignIds && !org.campaignIds.includes(campaignId)) {
    throw new ForbiddenException({ code: 'CAMPAIGN_FORBIDDEN', message: 'Campaign tidak di-assign ke Anda' });
  }
}

/** Anggota dengan cakupan ASSIGNED tidak boleh membuat/mengubah resource tingkat organisasi. */
export function assertFullScope(org: OrgContext) {
  if (org.campaignIds) {
    throw new ForbiddenException({ code: 'SCOPE_FORBIDDEN', message: 'Aksi ini memerlukan akses ke seluruh organisasi' });
  }
}

export function notFound(entity: string): never {
  throw new NotFoundException({ code: 'NOT_FOUND', message: `${entity} tidak ditemukan` });
}
