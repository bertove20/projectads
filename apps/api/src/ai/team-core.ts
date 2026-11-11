/** Logika murni Tim AI otonom (read.md Bagian 23), tanpa I/O, agar mudah diuji. */
import type { GoalMetric, Position, ProposalAction } from '@prisma/client';
import { sanitizeText } from './ai-core';
import type { OrTool } from './openrouter.client';

export const SUPERVISOR_KEY = 'SUPERVISOR';
export const SUPERVISOR_NAME = 'Kepala Tim AI';

/** Rule per jabatan (23.2): jenis usulan yang boleh dibuat. Ditegakkan server. */
export const ACTION_RULES: Record<Position, ProposalAction[]> = {
  ADS_MANAGER: ['CREATE_TASK', 'CAMPAIGN_STATUS'],
  MEDIA_BUYER: ['CREATE_TASK', 'CAMPAIGN_STATUS', 'ZONE_LIST'],
  ADS_ANALYST: ['CREATE_TASK'],
  TRACKING_SPECIALIST: ['CREATE_TASK'],
  FRAUD_ANALYST: ['CREATE_TASK', 'ZONE_LIST'],
  CREATIVE_SPECIALIST: ['CREATE_TASK'],
  LANDING_PAGE_SPECIALIST: ['CREATE_TASK'],
  AUTOMATION_SPECIALIST: ['CREATE_TASK'],
};

export const ACTION_LABEL: Record<ProposalAction, string> = {
  CREATE_TASK: 'Buat tugas',
  CAMPAIGN_STATUS: 'Ubah status campaign',
  ZONE_LIST: 'Blokir/izinkan zone',
};

/** Tool baca yang selalu dimiliki karyawan AI (selain tool dari skill jabatannya). */
export const AGENT_BASE_TOOLS = ['goal_progress', 'team_tasks', 'recent_decisions'];
/** Tool AI Assistant manusia yang tidak berlaku untuk karyawan AI. */
export const HUMAN_ONLY_TOOLS = new Set(['propose_task', 'my_tasks']);
/** Tool Kepala Tim AI untuk memverifikasi laporan bawahan. */
export const SUPERVISOR_TOOLS = ['list_campaigns', 'campaign_performance', 'list_alerts', 'postback_health', ...AGENT_BASE_TOOLS];

/** Izin baca yang dipakai karyawan AI: cakupan seluruh organisasi, hanya baca. */
export const AGENT_PERMISSIONS = ['org.read', 'campaigns.read', 'analytics.read', 'alerts.read', 'postbacks.read', 'tasks.read', 'networks.read'];

export const LIMITS = { findings: 8, proposals: 3, questions: 2, answers: 4, reviews: 6, assignments: 4, evaluations: 15 };

// ───────────── tool penutup (output terstruktur) ─────────────

const evidenceProp = { type: 'array', items: { type: 'string' }, description: 'ID bukti dari hasil tool di sesi ini, mis. ["E1","E3"]' };

export function submitReportTool(positions: Position[], allowed: ProposalAction[]): OrTool {
  return {
    type: 'function',
    function: {
      name: 'submit_report',
      description: 'Serahkan laporan akhir Anda ke Kepala Tim AI. Wajib dipanggil sekali di akhir. Setiap temuan dan usulan wajib merujuk ID bukti.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Ringkasan 2-5 kalimat dengan angka' },
          findings: {
            type: 'array',
            maxItems: LIMITS.findings,
            items: { type: 'object', properties: { text: { type: 'string' }, campaignId: { type: 'string' }, evidence: evidenceProp }, required: ['text', 'evidence'] },
          },
          proposals: {
            type: 'array',
            maxItems: LIMITS.proposals,
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: allowed },
                title: { type: 'string', description: 'Tindakan konkret, maks 200 karakter' },
                reason: { type: 'string', description: 'Alasan berbasis data (angka + periode)' },
                evidence: evidenceProp,
                risk: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
                expectedImpact: { type: 'string' },
                campaignId: { type: 'string', description: 'UUID campaign (wajib untuk CAMPAIGN_STATUS dan ZONE_LIST)' },
                status: { type: 'string', enum: ['ACTIVE', 'PAUSED'], description: 'Untuk CAMPAIGN_STATUS' },
                zoneId: { type: 'string', description: 'Untuk ZONE_LIST' },
                listType: { type: 'string', enum: ['BLACKLIST', 'WHITELIST'], description: 'Untuk ZONE_LIST' },
                priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], description: 'Untuk CREATE_TASK' },
                description: { type: 'string', description: 'Untuk CREATE_TASK: langkah kerja' },
              },
              required: ['action', 'title', 'reason', 'evidence'],
            },
          },
          questions: {
            type: 'array',
            maxItems: LIMITS.questions,
            items: { type: 'object', properties: { to: { type: 'string', enum: positions }, question: { type: 'string' } }, required: ['to', 'question'] },
          },
        },
        required: ['summary', 'findings'],
      },
    },
  };
}

export const SUBMIT_DISCUSSION_TOOL: OrTool = {
  type: 'function',
  function: {
    name: 'submit_discussion',
    description: 'Serahkan jawaban untuk pertanyaan rekan dan tanggapan atas usulan rekan. Wajib dipanggil sekali.',
    parameters: {
      type: 'object',
      properties: {
        answers: {
          type: 'array',
          maxItems: LIMITS.answers,
          items: { type: 'object', properties: { questionRef: { type: 'string' }, text: { type: 'string' }, evidence: evidenceProp }, required: ['questionRef', 'text'] },
        },
        reviews: {
          type: 'array',
          maxItems: LIMITS.reviews,
          items: {
            type: 'object',
            properties: { proposalRef: { type: 'string' }, stance: { type: 'string', enum: ['SUPPORT', 'OBJECT', 'INFO'] }, text: { type: 'string' }, evidence: evidenceProp },
            required: ['proposalRef', 'stance', 'text'],
          },
        },
      },
    },
  },
};

export function submitPlanTool(positions: Position[]): OrTool {
  return {
    type: 'function',
    function: {
      name: 'submit_plan',
      description: 'Serahkan rencana kerja: pahami permintaan owner lalu bagikan tugas ke 1-4 karyawan AI yang paling relevan.',
      parameters: {
        type: 'object',
        properties: {
          understanding: { type: 'string', description: 'Pemahaman Anda atas permintaan owner' },
          assignments: {
            type: 'array',
            minItems: 1,
            maxItems: LIMITS.assignments,
            items: { type: 'object', properties: { position: { type: 'string', enum: positions }, instruction: { type: 'string' } }, required: ['position', 'instruction'] },
          },
        },
        required: ['understanding', 'assignments'],
      },
    },
  };
}

export const SUBMIT_SUMMARY_TOOL: OrTool = {
  type: 'function',
  function: {
    name: 'submit_summary',
    description: 'Serahkan rangkuman akhir untuk owner dan keputusan atas setiap usulan (FORWARD ke owner, REJECT, atau HOLD).',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Rangkuman untuk owner dalam Markdown: kondisi, progres goal, risiko, rekomendasi' },
        campaignEvaluations: {
          type: 'array',
          maxItems: LIMITS.evaluations,
          items: {
            type: 'object',
            properties: { campaignId: { type: 'string' }, verdict: { type: 'string', enum: ['SCALE', 'KEEP', 'OPTIMIZE', 'PAUSE', 'WATCH'] }, note: { type: 'string' }, evidence: evidenceProp },
            required: ['campaignId', 'verdict', 'note'],
          },
        },
        goals: {
          type: 'array',
          items: { type: 'object', properties: { goalId: { type: 'string' }, status: { type: 'string', enum: ['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'NO_DATA'] }, note: { type: 'string' } }, required: ['goalId', 'status'] },
        },
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: { proposalRef: { type: 'string' }, decision: { type: 'string', enum: ['FORWARD', 'REJECT', 'HOLD'] }, note: { type: 'string' } },
            required: ['proposalRef', 'decision', 'note'],
          },
        },
      },
      required: ['summary', 'decisions'],
    },
  },
};

// ───────────── validasi output ─────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown, max: number) => sanitizeText(typeof v === 'string' ? v : '', max).trim();

/** Hanya ID bukti yang benar-benar ada di sesi ini yang dipertahankan. */
export function validEvidence(v: unknown, known: Set<string>): string[] {
  return [...new Set(arr(v).map((x) => String(x).trim().toUpperCase()))].filter((x) => known.has(x)).slice(0, 10);
}

export interface ProposalInput {
  action: ProposalAction;
  title: string;
  reason: string;
  evidence: string[];
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  expectedImpact: string | null;
  campaignId: string | null;
  payload: Record<string, unknown>;
}

export interface Violation {
  title: string;
  reason: string;
}

export interface ParsedReport {
  summary: string;
  findings: { text: string; campaignId: string | null; evidence: string[] }[];
  proposals: ProposalInput[];
  questions: { to: Position; question: string }[];
  /** Usulan yang ditolak server (melanggar rule jabatan / tanpa bukti / data tidak lengkap) */
  violations: Violation[];
}

/** Validasi laporan agent: rule jabatan, bukti wajib, parameter aksi lengkap. */
export function parseReport(raw: unknown, ctx: { allowed: ProposalAction[]; known: Set<string>; positions: Position[]; self: Position }): ParsedReport {
  const r = obj(raw);
  const violations: Violation[] = [];
  const findings = arr(r.findings)
    .slice(0, LIMITS.findings)
    .map((f) => {
      const o = obj(f);
      const cid = str(o.campaignId, 40);
      return { text: str(o.text, 1000), campaignId: UUID_RE.test(cid) ? cid : null, evidence: validEvidence(o.evidence, ctx.known) };
    })
    // Temuan tanpa bukti tidak diteruskan sebagai fakta.
    .filter((f) => f.text && f.evidence.length);

  const proposals: ProposalInput[] = [];
  for (const p of arr(r.proposals).slice(0, LIMITS.proposals)) {
    const o = obj(p);
    const title = str(o.title, 200) || '(tanpa judul)';
    const action = String(o.action ?? '') as ProposalAction;
    const reason = str(o.reason, 2000);
    const evidence = validEvidence(o.evidence, ctx.known);
    const cid = str(o.campaignId, 40);
    const campaignId = UUID_RE.test(cid) ? cid : null;
    if (!ctx.allowed.includes(action)) {
      violations.push({ title, reason: `Jenis usulan "${sanitizeText(action, 30) || '-'}" di luar wewenang jabatan` });
      continue;
    }
    if (!evidence.length) {
      violations.push({ title, reason: 'Tidak menyertakan bukti data yang valid' });
      continue;
    }
    if (reason.length < 10) {
      violations.push({ title, reason: 'Alasan tidak dijelaskan' });
      continue;
    }
    let payload: Record<string, unknown> = {};
    if (action === 'CAMPAIGN_STATUS') {
      const status = String(o.status ?? '');
      if (!campaignId || !['ACTIVE', 'PAUSED'].includes(status)) {
        violations.push({ title, reason: 'Ubah status campaign butuh campaignId dan status ACTIVE/PAUSED' });
        continue;
      }
      payload = { status };
    } else if (action === 'ZONE_LIST') {
      const zoneId = str(o.zoneId, 64);
      const listType = String(o.listType ?? 'BLACKLIST');
      if (!campaignId || !zoneId || !/^[A-Za-z0-9_.:-]+$/.test(zoneId) || !['BLACKLIST', 'WHITELIST'].includes(listType)) {
        violations.push({ title, reason: 'Usulan zone butuh campaignId, zoneId, dan listType' });
        continue;
      }
      if (ctx.self === 'FRAUD_ANALYST' && listType !== 'BLACKLIST') {
        violations.push({ title, reason: 'Fraud Agent hanya boleh mengusulkan blokir zone' });
        continue;
      }
      payload = { zoneId, listType };
    } else {
      const priority = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(String(o.priority)) ? String(o.priority) : 'MEDIUM';
      payload = { priority, description: str(o.description, 3000) || null };
    }
    const risk = (['LOW', 'MEDIUM', 'HIGH'].includes(String(o.risk)) ? String(o.risk) : action === 'CREATE_TASK' ? 'LOW' : 'MEDIUM') as ProposalInput['risk'];
    proposals.push({ action, title, reason, evidence, risk, expectedImpact: str(o.expectedImpact, 500) || null, campaignId, payload });
  }

  const questions = arr(r.questions)
    .slice(0, 10)
    .map((q) => obj(q))
    .map((q) => ({ to: String(q.to) as Position, question: str(q.question, 500) }))
    .filter((q) => q.question && ctx.positions.includes(q.to) && q.to !== ctx.self)
    .slice(0, LIMITS.questions);

  return { summary: str(r.summary, 2000) || '(tanpa ringkasan)', findings, proposals, questions, violations };
}

export function parseDiscussion(raw: unknown, known: Set<string>, questionRefs: Set<string>, proposalRefs: Set<string>) {
  const r = obj(raw);
  return {
    answers: arr(r.answers)
      .slice(0, LIMITS.answers)
      .map((a) => obj(a))
      .map((a) => ({ questionRef: str(a.questionRef, 10).toUpperCase(), text: str(a.text, 1000), evidence: validEvidence(a.evidence, known) }))
      .filter((a) => a.text && questionRefs.has(a.questionRef)),
    reviews: arr(r.reviews)
      .slice(0, LIMITS.reviews)
      .map((a) => obj(a))
      .map((a) => ({
        proposalRef: str(a.proposalRef, 10).toUpperCase(),
        stance: (['SUPPORT', 'OBJECT', 'INFO'].includes(String(a.stance)) ? String(a.stance) : 'INFO') as 'SUPPORT' | 'OBJECT' | 'INFO',
        text: str(a.text, 1000),
        evidence: validEvidence(a.evidence, known),
      }))
      .filter((a) => a.text && proposalRefs.has(a.proposalRef)),
  };
}

export function parsePlan(raw: unknown, available: Position[]) {
  const r = obj(raw);
  const seen = new Set<Position>();
  const assignments = arr(r.assignments)
    .map((a) => obj(a))
    .map((a) => ({ position: String(a.position) as Position, instruction: str(a.instruction, 1500) }))
    .filter((a) => available.includes(a.position) && a.instruction && !seen.has(a.position) && seen.add(a.position))
    .slice(0, LIMITS.assignments);
  return { understanding: str(r.understanding, 1500), assignments };
}

export type Decision = 'FORWARD' | 'REJECT' | 'HOLD';

export function parseSummary(raw: unknown, ctx: { proposalRefs: Set<string>; campaignIds: Set<string>; goalIds: Set<string>; known: Set<string> }) {
  const r = obj(raw);
  const decisions = new Map<string, { decision: Decision; note: string }>();
  for (const d of arr(r.decisions).map((x) => obj(x))) {
    const ref = str(d.proposalRef, 10).toUpperCase();
    const decision = String(d.decision) as Decision;
    if (ctx.proposalRefs.has(ref) && ['FORWARD', 'REJECT', 'HOLD'].includes(decision) && !decisions.has(ref)) decisions.set(ref, { decision, note: str(d.note, 1000) });
  }
  return {
    summary: str(r.summary, 8000) || '(Kepala Tim AI tidak memberikan rangkuman)',
    campaignEvaluations: arr(r.campaignEvaluations)
      .slice(0, LIMITS.evaluations)
      .map((x) => obj(x))
      .map((x) => ({ campaignId: str(x.campaignId, 40), verdict: String(x.verdict), note: str(x.note, 600), evidence: validEvidence(x.evidence, ctx.known) }))
      .filter((x) => ctx.campaignIds.has(x.campaignId) && ['SCALE', 'KEEP', 'OPTIMIZE', 'PAUSE', 'WATCH'].includes(x.verdict)),
    goals: arr(r.goals)
      .map((x) => obj(x))
      .map((x) => ({ goalId: str(x.goalId, 40), status: String(x.status), note: str(x.note, 400) }))
      .filter((x) => ctx.goalIds.has(x.goalId) && ['ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'NO_DATA'].includes(x.status)),
    decisions,
  };
}

// ───────────── goal & jadwal ─────────────

/** true bila metrik ini "lebih besar lebih baik". */
export const HIGHER_IS_BETTER: Record<GoalMetric, boolean> = { PROFIT: true, ROI: true, REVENUE: true, CONVERSIONS: true, CPA: false, SPEND: false };

export function goalMet(metric: GoalMetric, actual: number | null, target: number): boolean | null {
  if (actual === null || Number.isNaN(actual)) return null;
  return HIGHER_IS_BETTER[metric] ? actual >= target : actual <= target;
}

/** Offset zona waktu (ms) pada instant tertentu. */
function tzOffset(instant: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Instant awal hari lokal (YYYY-MM-DD) pada zona waktu tz. */
export function localDayStart(date: string, tz: string): Date {
  const guess = new Date(`${date}T00:00:00Z`);
  const first = new Date(guess.getTime() - tzOffset(guess, tz));
  return new Date(guess.getTime() - tzOffset(first, tz));
}

export function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** Rentang evaluasi goal (tanggal lokal, `to` inklusif): harian = kemarin, mingguan = 7 hari penuh terakhir, bulanan = bulan berjalan. */
export function goalRange(period: 'DAILY' | 'WEEKLY' | 'MONTHLY', today: string): { from: string; to: string } {
  const yesterday = addDays(today, -1);
  if (period === 'DAILY') return { from: yesterday, to: yesterday };
  if (period === 'WEEKLY') return { from: addDays(today, -7), to: yesterday };
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** Jam lokal "HH:MM" pada zona waktu tz. */
export function localTime(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(instant);
}

/** Rapat harian jatuh tempo bila jam lokal sudah melewati jam rapat dan rapat hari ini belum dibuat. */
export function meetingDue(meetingTime: string, nowLocalTime: string, alreadyHeld: boolean): boolean {
  return !alreadyHeld && /^\d{2}:\d{2}$/.test(meetingTime) && nowLocalTime >= meetingTime;
}
