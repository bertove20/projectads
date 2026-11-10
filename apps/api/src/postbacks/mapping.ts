import { BadRequestException } from '@nestjs/common';

/** Field internal pada postback MASUK -> nama parameter default. */
export const INBOUND_FIELDS = {
  clickId: 'click_id',
  payout: 'payout',
  currency: 'currency',
  status: 'status',
  transactionId: 'txid',
  goal: 'goal',
} as const;

/** Field internal pada tracking link (/c/:token) -> nama parameter default. */
export const CLICK_FIELDS = {
  externalClickId: 'click_id',
  zoneId: 'zone_id',
  subId: 'sub_id',
  creativeId: 'creative_id',
  feedId: 'feed_id',
  cost: 'cost',
  country: 'country',
} as const;

const PARAM_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;

/** Gabungkan mapping kustom dengan default dan validasi nama parameter. */
export function normalizeMapping<T extends Record<string, string>>(
  input: Record<string, unknown> | undefined | null,
  defaults: T,
): Record<keyof T, string> {
  const out = { ...defaults } as Record<keyof T, string>;
  if (!input) return out;
  for (const [field, param] of Object.entries(input)) {
    if (!(field in defaults)) {
      throw new BadRequestException({ code: 'BAD_MAPPING', message: `Field mapping tidak dikenal: ${field}` });
    }
    if (typeof param !== 'string' || !PARAM_NAME_RE.test(param)) {
      throw new BadRequestException({ code: 'BAD_MAPPING', message: `Nama parameter tidak valid untuk ${field}` });
    }
    out[field as keyof T] = param;
  }
  return out;
}

/** Baca mapping tersimpan (JSON) dengan aman; field yang tidak valid diganti default. */
export function readMapping<T extends Record<string, string>>(stored: unknown, defaults: T): Record<keyof T, string> {
  const out = { ...defaults } as Record<keyof T, string>;
  if (stored && typeof stored === 'object') {
    for (const [field, param] of Object.entries(stored as Record<string, unknown>)) {
      if (field in defaults && typeof param === 'string' && PARAM_NAME_RE.test(param)) out[field as keyof T] = param;
    }
  }
  return out;
}

export type InboundStatus = 'VERIFIED' | 'PENDING_VERIFICATION' | 'REJECTED' | 'REVOKED';

/** Normalisasi nilai status dari affiliate network. Kosong = approved (umum pada postback CPA). */
export function mapInboundStatus(raw: string | undefined | null): InboundStatus | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (['', '1', 'approved', 'approve', 'confirmed', 'sale', 'lead', 'ok', 'success'].includes(v)) return 'VERIFIED';
  if (['pending', 'hold', 'on_hold', '2', 'processing'].includes(v)) return 'PENDING_VERIFICATION';
  if (['rejected', 'declined', 'decline', 'reject', '0', 'invalid', 'fraud'].includes(v)) return 'REJECTED';
  if (['reversed', 'reversal', 'chargeback', 'refund', 'refunded', 'cancelled', 'canceled', '-1'].includes(v)) return 'REVOKED';
  return null;
}
