import type { ColumnKind } from '@prisma/client';

/** Kolom default board baru (read.md 19.3). */
export const DEFAULT_COLUMNS: { name: string; kind: ColumnKind }[] = [
  { name: 'Backlog', kind: 'BACKLOG' },
  { name: 'To Do', kind: 'TODO' },
  { name: 'In Progress', kind: 'IN_PROGRESS' },
  { name: 'Review', kind: 'REVIEW' },
  { name: 'Waiting Approval', kind: 'WAITING_APPROVAL' },
  { name: 'Blocked', kind: 'BLOCKED' },
  { name: 'Done', kind: 'DONE' },
];

export const RANK_STEP = 1024;
/** Celah minimum antar rank sebelum kolom dipadatkan ulang. */
export const RANK_EPSILON = 1e-6;

/**
 * Hitung rank untuk menyisipkan kartu di posisi `index` di antara kartu lain (sudah terurut, tanpa kartu yang dipindah).
 * Mengembalikan null bila celah terlalu sempit → pemanggil harus memadatkan ulang kolom.
 */
export function rankAt(sortedRanks: number[], index: number): number | null {
  const i = Math.max(0, Math.min(index, sortedRanks.length));
  const prev = i > 0 ? sortedRanks[i - 1] : undefined;
  const next = i < sortedRanks.length ? sortedRanks[i] : undefined;
  if (prev === undefined && next === undefined) return RANK_STEP;
  if (prev === undefined) return next! - RANK_STEP;
  if (next === undefined) return prev + RANK_STEP;
  if (next - prev < RANK_EPSILON * 2) return null;
  return (prev + next) / 2;
}

/** Rank baru yang rapi untuk n kartu (dipakai saat pemadatan ulang). */
export function evenRanks(n: number): number[] {
  return Array.from({ length: n }, (_, i) => (i + 1) * RANK_STEP);
}

/**
 * Apakah menambah dependensi `from → to` (from bergantung pada to) membentuk siklus?
 * `edges` = daftar dependensi yang sudah ada [card, dependsOn].
 */
export function createsCycle(edges: [string, string][], from: string, to: string): boolean {
  if (from === to) return true;
  const graph = new Map<string, string[]>();
  for (const [a, b] of edges) graph.set(a, [...(graph.get(a) ?? []), b]);
  // Siklus terjadi bila `to` (langsung/tidak langsung) sudah bergantung pada `from`.
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(graph.get(cur) ?? []));
  }
  return false;
}

export interface EnterColumnCheck {
  targetKind: ColumnKind;
  sameColumn: boolean;
  completionEvidence: string | null;
  approvalRequired: boolean;
  canApprove: boolean;
  /** Jumlah dependensi yang belum selesai */
  openDependencies: number;
  /** Jumlah kartu aktif di kolom tujuan (tanpa kartu ini) */
  targetCount: number;
  wipLimit: number | null;
}

export type RuleViolation = { code: string; message: string };

/** Aturan kerja saat kartu memasuki kolom (read.md 19.3). */
export function checkEnterColumn(c: EnterColumnCheck): RuleViolation | null {
  if (!c.sameColumn && c.wipLimit != null && c.targetCount >= c.wipLimit) {
    return { code: 'WIP_LIMIT', message: `Kolom tujuan sudah mencapai batas WIP (${c.wipLimit})` };
  }
  if (c.targetKind === 'DONE') {
    if (!c.completionEvidence?.trim()) {
      return { code: 'EVIDENCE_REQUIRED', message: 'Isi bukti penyelesaian sebelum memindahkan kartu ke Done' };
    }
    if (c.openDependencies > 0) {
      return { code: 'DEPENDENCY_OPEN', message: `Masih ada ${c.openDependencies} kartu dependensi yang belum selesai` };
    }
    if (c.approvalRequired && !c.canApprove) {
      return { code: 'APPROVAL_REQUIRED', message: 'Kartu ini harus disetujui Owner/Team Leader — pindahkan ke Waiting Approval' };
    }
  }
  return null;
}

/** Ambil token @mention berbentuk @[Nama](uuid) dari isi komentar. */
export function parseMentions(body: string): string[] {
  const out = new Set<string>();
  const re = /@\[[^\]]{1,100}\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
  for (const m of body.matchAll(re)) out.add(m[1].toLowerCase());
  return [...out];
}

export function priorityForSeverity(sev: string): 'URGENT' | 'HIGH' | 'MEDIUM' {
  return sev === 'CRITICAL' ? 'URGENT' : sev === 'HIGH' ? 'HIGH' : 'MEDIUM';
}
