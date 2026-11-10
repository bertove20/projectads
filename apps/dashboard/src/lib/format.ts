export function money(v: number | string | null | undefined, currency = 'USD'): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: n !== 0 && Math.abs(n) < 0.1 ? 4 : 2,
  }).format(n);
}

/** Uang dengan tanda eksplisit (+/−) untuk profit. */
export function signedMoney(v: number, currency = 'USD'): string {
  const s = money(Math.abs(v), currency);
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export function int(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : new Intl.NumberFormat('id-ID').format(v);
}

export function pct(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`;
}

export function dateTime(v: string | Date | null | undefined, timeZone?: string): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(v));
}

/** Rentang preset dalam ISO (UTC) untuk query laporan. */
export function presetRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const day = 86400_000;
  const to = new Date(startOfToday.getTime() + day);
  const days = preset === 'today' ? 1 : preset === '7d' ? 7 : preset === '30d' ? 30 : preset === '90d' ? 90 : 7;
  if (preset === 'yesterday') return { from: new Date(startOfToday.getTime() - day).toISOString(), to: startOfToday.toISOString() };
  return { from: new Date(to.getTime() - days * day).toISOString(), to: to.toISOString() };
}

export const RANGE_PRESETS = [
  { value: 'today', label: 'Hari ini' },
  { value: 'yesterday', label: 'Kemarin' },
  { value: '7d', label: '7 hari' },
  { value: '30d', label: '30 hari' },
  { value: '90d', label: '90 hari' },
];

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    // Cegah CSV/formula injection saat dibuka di Excel
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
