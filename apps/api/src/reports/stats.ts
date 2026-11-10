/**
 * Statistik split test (fungsi murni).
 * - Interval kepercayaan Wilson 95% untuk conversion rate.
 * - Uji dua proporsi (z-test) varian vs kontrol.
 * - Verdict konservatif: tidak menyatakan pemenang sebelum data cukup.
 */

const Z95 = 1.959963984540054;

export function wilson(conversions: number, n: number, z = Z95): { low: number; high: number } | null {
  if (n <= 0) return null;
  const p = conversions / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

/** CDF normal standar (aproksimasi Abramowitz–Stegun 7.1.26, galat < 1.5e-7). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** p-value dua sisi untuk selisih dua proporsi. null bila tidak bisa dihitung. */
export function twoProportionPValue(c1: number, n1: number, c2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const pooled = (c1 + c2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  const z = (c1 / n1 - c2 / n2) / se;
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/** Ambang minimal agar perbandingan dianggap layak dibaca. */
export const MIN_CLICKS_PER_VARIANT = 100;
export const MIN_CONVERSIONS_PER_VARIANT = 10;

export type Verdict = 'insufficient_data' | 'no_difference' | 'better' | 'worse' | 'control';

export function verdict(isControl: boolean, clicks: number, conversions: number, controlClicks: number, controlConversions: number, pValue: number | null): Verdict {
  if (isControl) return 'control';
  const enough = (c: number, n: number) => n >= MIN_CLICKS_PER_VARIANT && c >= MIN_CONVERSIONS_PER_VARIANT;
  if (!enough(conversions, clicks) || !enough(controlConversions, controlClicks) || pValue === null) return 'insufficient_data';
  if (pValue >= 0.05) return 'no_difference';
  return conversions / clicks > controlConversions / controlClicks ? 'better' : 'worse';
}
