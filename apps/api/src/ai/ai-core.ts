/** Logika murni AI Workspace (tanpa I/O) — mudah diuji. */

export interface Limits {
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
  orgMonthlyBudgetUsd: number | null;
  maxRequestsPerDay: number | null;
}
export interface Spent {
  today: number;
  month: number;
  orgMonth: number;
  requestsToday: number;
}

/** Perkiraan biaya terburuk satu request: token prompt (perkiraan) + batas token output. */
export function estimateCost(promptTokens: number, maxCompletionTokens: number, promptPrice: number, completionPrice: number): number {
  return promptTokens * promptPrice + maxCompletionTokens * completionPrice;
}

/** Perkiraan kasar token dari panjang teks (≈ 4 karakter per token) — dipakai sebelum request untuk cek budget. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Tolak request bila batas request/budget akan terlampaui. Mengembalikan pesan alasan atau null. */
export function budgetViolation(l: Limits, s: Spent, estimate: number): string | null {
  if (l.maxRequestsPerDay != null && s.requestsToday >= l.maxRequestsPerDay) return `Batas ${l.maxRequestsPerDay} request AI per hari sudah tercapai`;
  if (l.dailyBudgetUsd != null && s.today + estimate > l.dailyBudgetUsd) return `Budget AI harian ($${l.dailyBudgetUsd.toFixed(2)}) akan terlampaui`;
  if (l.monthlyBudgetUsd != null && s.month + estimate > l.monthlyBudgetUsd) return `Budget AI bulanan ($${l.monthlyBudgetUsd.toFixed(2)}) akan terlampaui`;
  if (l.orgMonthlyBudgetUsd != null && s.orgMonth + estimate > l.orgMonthlyBudgetUsd) return 'Budget AI bulanan organisasi akan terlampaui';
  return null;
}

/** Nilai pertama yang bukan null/undefined (override karyawan → default jabatan). */
export function pick<T>(...vals: (T | null | undefined)[]): T | null {
  for (const v of vals) if (v !== null && v !== undefined) return v;
  return null;
}

export interface SkillMeta {
  name: string;
  description: string;
  body: string;
}

export const SKILL_MD_MAX = 20_000;

/**
 * Parse SKILL.md (format Agent Skills: frontmatter YAML sederhana `name` & `description`, lalu instruksi Markdown).
 * Hanya key sederhana yang dibaca; tidak ada eksekusi apa pun.
 */
export function parseSkillMd(md: string): SkillMeta | { error: string } {
  if (md.length > SKILL_MD_MAX) return { error: `SKILL.md maksimal ${SKILL_MD_MAX} karakter` };
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md.trimStart());
  if (!m) return { error: 'SKILL.md harus diawali frontmatter (--- name/description ---)' };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  if (!fm.name || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(fm.name)) return { error: 'Frontmatter "name" wajib: huruf kecil, angka, tanda hubung (2–64 karakter)' };
  if (!fm.description || fm.description.length < 10) return { error: 'Frontmatter "description" wajib (min. 10 karakter)' };
  const body = m[2].trim();
  if (body.length < 20) return { error: 'Isi instruksi skill terlalu pendek' };
  return { name: fm.name, description: fm.description.slice(0, 500), body };
}

/**
 * Data dari luar (nama campaign, komentar, judul kartu) dikirim ke model sebagai JSON di dalam pesan tool,
 * bukan disisipkan ke instruksi. Karakter kontrol dibuang dan panjang dibatasi.
 */
export function sanitizeText(v: unknown, max = 300): string {
  // eslint-disable-next-line no-control-regex
  return String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '').slice(0, max);
}

export function toolPayload(data: unknown, maxChars = 12_000): string {
  const s = JSON.stringify(data);
  return s.length > maxChars ? JSON.stringify({ truncated: true, note: 'Data dipotong karena terlalu besar; persempit pertanyaan.', preview: s.slice(0, maxChars) }) : s;
}

/** Judul percakapan dari pesan pertama. */
export function titleFrom(text: string): string {
  const t = sanitizeText(text, 200).replace(/\s+/g, ' ').trim();
  return t.length > 60 ? `${t.slice(0, 57)}…` : t || 'Percakapan baru';
}

/** Awal hari & bulan (UTC) untuk akumulasi budget. */
export function periodStarts(now = new Date()): { day: Date; month: Date } {
  return {
    day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}
