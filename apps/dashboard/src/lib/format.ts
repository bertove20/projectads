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

/** Selisih (ms) antara waktu lokal di zona `tz` dan UTC pada instant tertentu. */
function tzOffsetMs(instant: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instant UTC untuk pukul 00:00 tanggal `ymd` (YYYY-MM-DD) di zona `tz`. */
export function zonedMidnight(ymd: string, tz: string): Date {
  const guess = new Date(`${ymd}T00:00:00Z`);
  const first = new Date(guess.getTime() - tzOffsetMs(guess, tz));
  // Koreksi kedua untuk tanggal yang melewati pergantian DST
  return new Date(guess.getTime() - tzOffsetMs(first, tz));
}

function todayIn(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function addDays(ymd: string, n: number): string {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400_000).toISOString().slice(0, 10);
}

/**
 * Rentang preset (ISO/UTC) dengan batas hari mengikuti zona waktu organisasi,
 * sama dengan zona waktu yang dipakai server untuk mengelompokkan laporan.
 */
export function presetRange(preset: string, tz = 'UTC', now = new Date()): { from: string; to: string } {
  let zone = tz;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  const today = todayIn(zone, now);
  const tomorrow = addDays(today, 1);
  if (preset === 'yesterday') return { from: zonedMidnight(addDays(today, -1), zone).toISOString(), to: zonedMidnight(today, zone).toISOString() };
  const days = preset === 'today' ? 1 : preset === '30d' ? 30 : preset === '90d' ? 90 : 7;
  return { from: zonedMidnight(addDays(tomorrow, -days), zone).toISOString(), to: zonedMidnight(tomorrow, zone).toISOString() };
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
