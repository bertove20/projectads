/** Utilitas zona waktu (IANA) tanpa dependensi tambahan. */

export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Tanggal kalender (YYYY-MM-DD) dari sebuah instant pada zona waktu tertentu. */
export function dateInTz(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Daftar tanggal YYYY-MM-DD dari (hari ini - lookback) s.d. hari ini, pada zona waktu tz. */
export function recentDates(tz: string, lookbackDays: number, now = new Date()): string[] {
  const today = dateInTz(now, tz);
  const base = new Date(`${today}T00:00:00Z`);
  const out: string[] = [];
  for (let i = lookbackDays; i >= 0; i--) out.push(new Date(base.getTime() - i * 86400_000).toISOString().slice(0, 10));
  return out;
}

export function isDateString(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
}
