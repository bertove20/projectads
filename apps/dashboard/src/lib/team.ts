import type { Position } from './tasks';

export type ProposalAction = 'CREATE_TASK' | 'CAMPAIGN_STATUS' | 'ZONE_LIST';
export type ProposalStatus = 'DRAFT' | 'SUPERVISOR_REJECTED' | 'PENDING_OWNER' | 'APPROVED' | 'REJECTED' | 'REVISION' | 'EXECUTED' | 'FAILED';
export type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type RunKind = 'MEETING' | 'DIRECTIVE';
export type GoalMetric = 'PROFIT' | 'ROI' | 'REVENUE' | 'CONVERSIONS' | 'CPA' | 'SPEND';
export type GoalPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface TeamAgent {
  id: string;
  key: string;
  role: 'SUPERVISOR' | 'WORKER';
  position: Position | null;
  positionLabel: string;
  name: string;
  enabled: boolean;
  instructions: string | null;
  modelOverride: { id: string; modelId: string; name: string } | null;
  model: { modelId: string; name: string; inherited: boolean } | null;
  allowedActions: { key: ProposalAction; label: string }[];
  today: { requests: number; costUsd: number };
}

export interface TeamOverview {
  settings: { enabled: boolean; paused: boolean; pausedAt: string | null; meetingEnabled: boolean; meetingTime: string; dailyBudgetUsd: number | null; runBudgetUsd: number };
  pendingApprovals: number;
  lastRun: { id: string; kind: RunKind; status: RunStatus; title: string; stage: string | null; createdAt: string } | null;
  spentToday: number;
  agents: TeamAgent[];
}

export interface Goal {
  id: string;
  title: string;
  metric: GoalMetric;
  target: number;
  period: GoalPeriod;
  campaignId: string | null;
  campaign: { id: string; name: string } | null;
  active: boolean;
}

export interface RunSummary {
  id: string;
  kind: RunKind;
  status: RunStatus;
  title: string;
  stage: string | null;
  meetingDate: string | null;
  costUsd: number;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  proposals: number;
  pendingOwner: number;
}

export interface AgentRef {
  id: string;
  name: string;
  key?: string;
  position: Position | null;
  role?: 'SUPERVISOR' | 'WORKER';
}

export interface RunMessage {
  id: string;
  kind: 'DIRECTIVE' | 'PLAN' | 'ASSIGNMENT' | 'REPORT' | 'DISCUSSION' | 'SUMMARY' | 'TOOL' | 'NOTE' | 'ERROR';
  stage: string | null;
  content: string;
  data: unknown;
  toolName: string | null;
  evidenceId: string | null;
  modelId: string | null;
  authorId: string | null;
  createdAt: string;
  agent: AgentRef | null;
}

export interface Proposal {
  id: string;
  runId: string;
  ref: string;
  action: ProposalAction;
  actionLabel: string;
  title: string;
  reason: string;
  evidence: string[];
  payload: Record<string, unknown>;
  campaignId: string | null;
  campaignName?: string | null;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  expectedImpact: string | null;
  status: ProposalStatus;
  discussion: { agent: string; stance: 'SUPPORT' | 'OBJECT' | 'INFO'; text: string; evidence: string[] }[] | null;
  supervisorNote: string | null;
  ownerNote: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  result: Record<string, unknown> | null;
  preview: { campaign?: string | null; before?: string | null; after?: unknown; zoneId?: string; listType?: string; noop?: boolean } | null;
  createdAt: string;
  agent: AgentRef;
  run?: { id: string; title: string; kind: RunKind; createdAt: string };
}

export interface CampaignEvaluation {
  campaignId: string;
  verdict: 'SCALE' | 'KEEP' | 'OPTIMIZE' | 'PAUSE' | 'WATCH';
  note: string;
  evidence: string[];
}

export interface RunDetail extends Omit<RunSummary, 'proposals' | 'pendingOwner'> {
  directive: string | null;
  summary: string | null;
  brief: { campaignEvaluations: CampaignEvaluation[]; goals: { goalId: string; status: string; note: string }[]; counts: { forwarded: number; rejected: number; proposals: number; violations: number } } | null;
  messages: RunMessage[];
  proposals: Proposal[];
  authors: { id: string; name: string }[];
}

export const RUN_STATUS: Record<RunStatus, { label: string; tone: 'gray' | 'blue' | 'green' | 'yellow' | 'red' }> = {
  QUEUED: { label: 'Antre', tone: 'gray' },
  RUNNING: { label: 'Berjalan', tone: 'blue' },
  COMPLETED: { label: 'Selesai', tone: 'green' },
  FAILED: { label: 'Gagal', tone: 'red' },
  CANCELLED: { label: 'Dihentikan', tone: 'yellow' },
};

export const STAGE_LABEL: Record<string, string> = {
  plan: 'Rencana',
  report: 'Laporan',
  discussion: 'Diskusi',
  summary: 'Rangkuman',
  done: 'Selesai',
};

export const PROPOSAL_STATUS: Record<ProposalStatus, { label: string; tone: 'gray' | 'blue' | 'green' | 'yellow' | 'red' }> = {
  DRAFT: { label: 'Ditahan Kepala Tim', tone: 'gray' },
  SUPERVISOR_REJECTED: { label: 'Ditolak Kepala Tim', tone: 'gray' },
  PENDING_OWNER: { label: 'Menunggu Anda', tone: 'blue' },
  APPROVED: { label: 'Disetujui', tone: 'green' },
  REJECTED: { label: 'Ditolak', tone: 'red' },
  REVISION: { label: 'Diminta revisi', tone: 'yellow' },
  EXECUTED: { label: 'Dieksekusi', tone: 'green' },
  FAILED: { label: 'Eksekusi gagal', tone: 'red' },
};

export const RISK: Record<Proposal['risk'], { label: string; tone: 'gray' | 'yellow' | 'red' }> = {
  LOW: { label: 'Risiko rendah', tone: 'gray' },
  MEDIUM: { label: 'Risiko sedang', tone: 'yellow' },
  HIGH: { label: 'Risiko tinggi', tone: 'red' },
};

export const VERDICT: Record<CampaignEvaluation['verdict'], { label: string; tone: 'gray' | 'blue' | 'green' | 'yellow' | 'red' }> = {
  SCALE: { label: 'Naikkan', tone: 'green' },
  KEEP: { label: 'Pertahankan', tone: 'blue' },
  OPTIMIZE: { label: 'Optimasi', tone: 'yellow' },
  PAUSE: { label: 'Hentikan', tone: 'red' },
  WATCH: { label: 'Pantau', tone: 'gray' },
};

export const STANCE: Record<'SUPPORT' | 'OBJECT' | 'INFO', { label: string; tone: 'green' | 'red' | 'gray' }> = {
  SUPPORT: { label: 'Mendukung', tone: 'green' },
  OBJECT: { label: 'Keberatan', tone: 'red' },
  INFO: { label: 'Info', tone: 'gray' },
};

export const METRIC_LABEL: Record<GoalMetric, string> = {
  PROFIT: 'Profit',
  ROI: 'ROI',
  REVENUE: 'Revenue',
  CONVERSIONS: 'Konversi',
  CPA: 'CPA',
  SPEND: 'Spend',
};
export const PERIOD_LABEL: Record<GoalPeriod, string> = { DAILY: 'Harian (kemarin)', WEEKLY: 'Mingguan (7 hari)', MONTHLY: 'Bulanan (berjalan)' };
export const LOWER_IS_BETTER = new Set<GoalMetric>(['CPA', 'SPEND']);

export function goalTarget(g: Pick<Goal, 'metric' | 'target'>): string {
  const op = LOWER_IS_BETTER.has(g.metric) ? '≤' : '≥';
  if (g.metric === 'ROI') return `${op} ${(g.target * 100).toFixed(0)}%`;
  if (g.metric === 'CONVERSIONS') return `${op} ${g.target}`;
  return `${op} $${g.target}`;
}

/** Warna avatar stabil per agent (dari token tema). */
export function agentInitials(name: string): string {
  if (name === 'Kepala Tim AI') return 'KT';
  return name
    .replace(/ Agent$/, '')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export type LiveState = 'idle' | 'working' | 'talking' | 'meeting' | 'off' | 'paused';

export interface LiveAgent {
  id: string;
  key: string;
  name: string;
  role: 'SUPERVISOR' | 'WORKER';
  position: Position | null;
  state: LiveState;
  activity: string | null;
  snippet: string | null;
  lastActiveAt: string | null;
  runId: string | null;
}

export interface LiveTeam {
  paused: boolean;
  running: { id: string; title: string; stage: string | null; kind: RunKind; status: RunStatus }[];
  agents: LiveAgent[];
}

export interface FeedMessage {
  id: string;
  runId: string;
  agentId: string | null;
  authorId: string | null;
  authorName: string | null;
  kind: RunMessage['kind'];
  stage: string | null;
  content: string;
  toolName: string | null;
  evidenceId: string | null;
  createdAt: string;
  data: unknown;
  via: string | null;
  run: { title: string; kind: RunKind };
}

export type MemoryKind = 'OUTCOME' | 'LESSON' | 'FEEDBACK' | 'NOTE';

export interface Memory {
  id: string;
  agentId: string | null;
  kind: MemoryKind;
  content: string;
  runId: string | null;
  proposalId: string | null;
  evidence: unknown;
  pinned: boolean;
  createdAt: string;
}

export interface AgentDetail {
  id: string;
  key: string;
  name: string;
  role: 'SUPERVISOR' | 'WORKER';
  position: Position | null;
  positionLabel: string;
  enabled: boolean;
  allowedActions: { key: ProposalAction; label: string }[];
  proposals: Partial<Record<ProposalStatus, number>>;
  month: { requests: number; costUsd: number };
  memories: Memory[];
}

export const MEMORY_KIND: Record<MemoryKind, { label: string; tone: 'green' | 'blue' | 'yellow' | 'gray' }> = {
  OUTCOME: { label: 'Hasil nyata', tone: 'green' },
  LESSON: { label: 'Pelajaran', tone: 'blue' },
  FEEDBACK: { label: 'Keputusan', tone: 'yellow' },
  NOTE: { label: 'Catatan owner', tone: 'gray' },
};
