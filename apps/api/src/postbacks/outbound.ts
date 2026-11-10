import { renderTemplate } from '../common/url';

/** Placeholder yang boleh dipakai pada template postback KELUAR. */
export const OUTBOUND_PLACEHOLDERS = [
  'external_click_id',
  'payout',
  'currency',
  'goal',
  'transaction_id',
  'conversion_id',
  'click_id',
] as const;

export interface OutboundValues {
  externalClickId: string;
  payout: string;
  currency: string;
  goal: string;
  transactionId: string | null;
  conversionId: string;
  clickId: string;
}

export function buildPostbackUrl(template: string, v: OutboundValues): string {
  return renderTemplate(template, {
    external_click_id: v.externalClickId,
    payout: v.payout,
    currency: v.currency,
    goal: v.goal,
    transaction_id: v.transactionId,
    conversion_id: v.conversionId,
    click_id: v.clickId,
  });
}

/** Tentukan apakah provider menerima konversi: null bila tidak ada pola, true/false bila ada. */
export function evaluateAcceptance(statusCode: number, body: string, successPattern: string | null): boolean | null {
  if (statusCode < 200 || statusCode >= 300) return false;
  if (!successPattern) return null;
  try {
    return new RegExp(successPattern).test(body);
  } catch {
    return null;
  }
}
