'use client';

import { Fragment, ReactNode } from 'react';
import type { Position } from './tasks';

export type AiReason = 'NO_POSITION' | 'AI_DISABLED' | 'AI_NOT_CONFIGURED' | 'AI_MEMBER_DISABLED' | 'AI_NO_MODEL' | null;

export interface Workspace {
  positions: { key: Position; label: string; agent: string }[];
  position: Position | null;
  agent?: string;
  ready: boolean;
  reason: AiReason;
  model?: { modelId: string; name: string; supportsTools: boolean } | null;
  fallback?: { modelId: string; name: string } | null;
  limits?: { dailyBudgetUsd: number | null; monthlyBudgetUsd: number | null; orgMonthlyBudgetUsd: number | null; maxRequestsPerDay: number | null };
  spent: { today: number; month: number; orgMonth: number; requestsToday: number };
  skills?: { key: string; name: string; version: number }[];
  tools?: string[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  position: Position;
  updatedAt: string;
  _count: { drafts: number };
}

export interface AiMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'TOOL';
  content: string;
  toolCalls: { id: string; function: { name: string; arguments: string } }[] | null;
  toolName: string | null;
  toolCallId: string | null;
  skillKeys: string[];
  modelId: string | null;
  createdAt: string;
}

export interface AiDraft {
  id: string;
  title: string;
  description: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  campaignId: string | null;
  dueDate: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'DISMISSED';
  cardId: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  position: Position;
  messages: AiMessage[];
  drafts: AiDraft[];
}

export interface AiModelRow {
  id: string;
  modelId: string;
  name: string;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  promptPrice: string;
  completionPrice: string;
  supportsTools: boolean;
  enabled: boolean;
  available: boolean;
  lastValidatedAt: string;
}

export interface AiSettingsView {
  enabled: boolean;
  hasKey: boolean;
  apiKeyHint: string | null;
  apiKeyValidatedAt: string | null;
  monthlyBudgetUsd: number | null;
  retentionDays: number;
  modelsSyncedAt: string | null;
  monthSpentUsd: number;
}

export type ModelRef = { id: string; modelId: string; name: string } | null;

export interface PositionConfigView {
  position: Position;
  label: string;
  members: number;
  model: ModelRef;
  fallback: ModelRef;
  temperature: number;
  maxTokens: number;
  dailyBudgetUsd: number | null;
  monthlyBudgetUsd: number | null;
}

export interface MemberAiView {
  id: string;
  name: string;
  positions: Position[];
  config: {
    aiEnabled: boolean;
    model: ModelRef;
    fallback: ModelRef;
    temperature: number | null;
    maxTokens: number | null;
    dailyBudgetUsd: number | null;
    monthlyBudgetUsd: number | null;
    maxRequestsPerDay: number | null;
  } | null;
  monthSpentUsd: number;
  monthRequests: number;
}

export interface UsageView {
  days: number;
  byModel: { modelId: string; requests: number; costUsd: number; promptTokens: number; completionTokens: number }[];
  byStatus: Record<string, number>;
  byDay: { day: string; cost: number; requests: number }[];
  recentErrors: { createdAt: string; modelId: string; status: string; error: string | null; usedFallback: boolean }[];
}

export interface SkillRow {
  id: string;
  key: string;
  name: string;
  description: string;
  category: string;
  positions: Position[];
  riskClass: 'READ_ONLY' | 'DRAFT' | 'WRITE';
  tools: string[];
  enabled: boolean;
  source: 'BUILTIN' | 'CUSTOM' | 'IMPORTED';
  activeVersion: { version: number; reviewedAt: string | null } | null;
  latestVersion: { id: string; version: number; review: Review; createdAt: string } | null;
  overrides: number;
}
export type Review = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface SkillDetail extends Omit<SkillRow, 'latestVersion' | 'overrides' | 'activeVersion'> {
  activeVersionId: string | null;
  versions: { id: string; version: number; skillMd: string; changelog: string | null; review: Review; reviewNote: string | null; reviewedAt: string | null; createdAt: string; createdById: string | null }[];
  assignments: { membershipId: string; name: string; enabled: boolean }[];
  availableTools: string[];
}

export const REASON_TEXT: Record<Exclude<AiReason, null>, { title: string; body: string }> = {
  NO_POSITION: { title: 'Jabatan belum diatur', body: 'AI Assistant mengikuti jabatan Anda. Minta admin mengatur jabatan di halaman Tim kerja.' },
  AI_DISABLED: { title: 'AI Workspace belum aktif', body: 'Admin perlu mengaktifkan AI di Pengaturan AI.' },
  AI_NOT_CONFIGURED: { title: 'OpenRouter belum terhubung', body: 'Owner perlu memasukkan API key OpenRouter di Pengaturan AI.' },
  AI_MEMBER_DISABLED: { title: 'Akses AI dinonaktifkan', body: 'Admin menonaktifkan AI untuk akun Anda.' },
  AI_NO_MODEL: { title: 'Model belum dipilih', body: 'Admin perlu memilih model untuk jabatan Anda di Pengaturan AI.' },
};

export const TOOL_LABEL: Record<string, string> = {
  list_campaigns: 'Daftar campaign',
  campaign_performance: 'Performa campaign',
  list_alerts: 'Alert operasional',
  postback_health: 'Kesehatan postback',
  my_tasks: 'Tugas saya',
  propose_task: 'Usulan draft task',
};

export const RISK_LABEL: Record<SkillRow['riskClass'], { label: string; tone: 'gray' | 'blue' | 'red' }> = {
  READ_ONLY: { label: 'Baca saja', tone: 'gray' },
  DRAFT: { label: 'Membuat draft', tone: 'blue' },
  WRITE: { label: 'Aksi tulis', tone: 'red' },
};

export const SUGGESTIONS: Partial<Record<Position, string[]>> = {
  ADS_MANAGER: ['Ringkas profit semua campaign 7 hari terakhir', 'Campaign mana yang perlu perhatian minggu ini?', 'Alert apa yang masih terbuka dan berdampak ke data?'],
  MEDIA_BUYER: ['Bagaimana performa campaign saya minggu ini?', 'Zone mana yang layak di-blacklist?', 'Negara mana dengan CPA terbaik 7 hari terakhir?'],
  ADS_ANALYST: ['Tren CR harian 14 hari terakhir', 'Bandingkan performa per device minggu ini', 'Segmen mana yang paling menguntungkan?'],
  TRACKING_SPECIALIST: ['Bagaimana kesehatan postback 7 hari terakhir?', 'Ada alert tracking yang terbuka?', 'Berapa konversi yang masih OBSERVED?'],
  FRAUD_ANALYST: ['Zone dengan klik tinggi tapi tanpa konversi', 'Ada pola traffic mencurigakan minggu ini?'],
  CREATIVE_SPECIALIST: ['Apakah ada tanda creative fatigue?', 'Ide variasi judul push untuk campaign terbaik'],
  LANDING_PAGE_SPECIALIST: ['Bandingkan performa landing page 7 hari terakhir', 'Rencana A/B test untuk landing dengan CR terendah'],
  AUTOMATION_SPECIALIST: ['Ringkas alert terbuka per jenis', 'Ada pola postback gagal yang perlu aturan retry?'],
};

export const usd = (n: number | null | undefined, digits = 2) => (n == null ? '—' : `$${n.toFixed(n !== 0 && Math.abs(n) < 0.01 ? 4 : digits)}`);
/** Harga registry: USD per token → per 1 juta token agar mudah dibaca. */
export const perMillion = (perToken: string | number) => `$${(Number(perToken) * 1_000_000).toFixed(2)}`;

// ───────────── renderer Markdown minimal & aman (tanpa HTML mentah) ─────────────

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(
      tok.startsWith('**') ? (
        <strong key={`${key}-${i++}`} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>
      ) : (
        <code key={`${key}-${i++}`} className="rounded bg-surface-2 px-1 font-mono text-[12px]">
          {tok.slice(1, -1)}
        </code>
      ),
    );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Judul, daftar, tebal, kode inline, paragraf. Teks model selalu dirender sebagai teks, bukan HTML. */
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, '').split('\n');
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(
        <p key={k} className="leading-relaxed">
          {para.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {inline(l, `${k}-${i}`)}
            </Fragment>
          ))}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`;
      const Tag = list.ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={k} className={list.ordered ? 'list-decimal space-y-0.5 pl-5' : 'list-disc space-y-0.5 pl-5'}>
          {list.items.map((it, i) => (
            <li key={i}>{inline(it, `${k}-${i}`)}</li>
          ))}
        </Tag>,
      );
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      blocks.push(
        <p key={`h${blocks.length}`} className="pt-1 font-semibold">
          {inline(h[2], `h${blocks.length}`)}
        </p>,
      );
    } else if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return <div className="space-y-2 text-[13.5px] break-words">{blocks}</div>;
}
