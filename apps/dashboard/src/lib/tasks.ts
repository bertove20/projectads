'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { getActiveOrg } from './api';
import { useSession } from './session';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type ColumnKind = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'WAITING_APPROVAL' | 'BLOCKED' | 'DONE' | 'CUSTOM';
export type Position =
  | 'ADS_MANAGER'
  | 'MEDIA_BUYER'
  | 'ADS_ANALYST'
  | 'TRACKING_SPECIALIST'
  | 'FRAUD_ANALYST'
  | 'CREATIVE_SPECIALIST'
  | 'LANDING_PAGE_SPECIALIST'
  | 'AUTOMATION_SPECIALIST';

export interface MemberRef {
  id: string;
  name: string;
}

export interface Person extends MemberRef {
  role: { key: string; name: string };
  positions: Position[];
  primaryPosition: Position | null;
  teams: { id: string; name: string }[];
  isMe: boolean;
}

export interface TeamItem {
  id: string;
  name: string;
  description: string | null;
  lead: MemberRef | null;
  members: MemberRef[];
  boards: number;
}

export interface BoardColumn {
  id: string;
  name: string;
  kind: ColumnKind;
  position: number;
  wipLimit: number | null;
}

export interface BoardSummary {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  team: { id: string; name: string } | null;
  archivedAt: string | null;
  openCards: number;
  doneCards: number;
}

export interface CardSummary {
  id: string;
  number: number;
  boardId: string;
  columnId: string;
  rank: number;
  title: string;
  priority: TaskPriority;
  dueDate: string | null;
  startDate: string | null;
  approvalRequired: boolean;
  hasEvidence: boolean;
  source: 'MANUAL' | 'ALERT' | 'AI';
  alertId: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  version: number;
  updatedAt: string;
  ownerMembershipId: string | null;
  teamId: string | null;
  owner: MemberRef | null;
  campaign: { id: string; name: string } | null;
  networkAccount: { id: string; name: string } | null;
  assignees: MemberRef[];
  checklistTotal: number;
  checklistDone: number;
  blockedBy: number;
  comments: number;
  links: number;
}

export interface BoardDetail {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  team: { id: string; name: string } | null;
  columns: BoardColumn[];
  cards: CardSummary[];
}

export interface CardRef {
  id: string;
  number: number;
  title: string;
  completedAt: string | null;
}

export interface CardDetail {
  id: string;
  number: number;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  ownerMembershipId: string | null;
  teamId: string | null;
  campaignId: string | null;
  networkAccountId: string | null;
  startDate: string | null;
  dueDate: string | null;
  approvalRequired: boolean;
  completionEvidence: string | null;
  source: 'MANUAL' | 'ALERT' | 'AI';
  completedAt: string | null;
  archivedAt: string | null;
  version: number;
  createdAt: string;
  board: { id: string; name: string };
  column: { id: string; name: string; kind: ColumnKind };
  owner: MemberRef | null;
  team: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
  networkAccount: { id: string; name: string; network: string } | null;
  alert: { id: string; severity: string; status: string; type: string } | null;
  assignees: MemberRef[];
  checklist: { id: string; text: string; done: boolean; position: number }[];
  comments: { id: string; authorId: string; authorName: string; body: string; mentions: string[]; createdAt: string }[];
  activities: { id: string; type: string; data: Record<string, unknown> | null; actorName: string; createdAt: string }[];
  links: { id: string; title: string; url: string; createdAt: string }[];
  timeEntries: { id: string; minutes: number; date: string; note: string | null; member: MemberRef | null; membershipId: string }[];
  totalMinutes: number;
  dependsOn: CardRef[];
  blocks: CardRef[];
}

export interface MyTasks {
  cards: (CardSummary & { board: { id: string; name: string }; column: { name: string; kind: ColumnKind } })[];
  mentions: { id: string; body: string; createdAt: string; authorName: string; card: { id: string; number: number; title: string; boardId: string } }[];
}

export const PRIORITY: Record<TaskPriority, { label: string; tone: 'gray' | 'blue' | 'yellow' | 'red' }> = {
  LOW: { label: 'Rendah', tone: 'gray' },
  MEDIUM: { label: 'Sedang', tone: 'blue' },
  HIGH: { label: 'Tinggi', tone: 'yellow' },
  URGENT: { label: 'Mendesak', tone: 'red' },
};
export const PRIORITIES: TaskPriority[] = ['URGENT', 'HIGH', 'MEDIUM', 'LOW'];

export const POSITION_LABEL: Record<Position, string> = {
  ADS_MANAGER: 'Ads Manager',
  MEDIA_BUYER: 'Media Buyer',
  ADS_ANALYST: 'Ads Analyst',
  TRACKING_SPECIALIST: 'Tracking Specialist',
  FRAUD_ANALYST: 'Fraud Analyst',
  CREATIVE_SPECIALIST: 'Creative Specialist',
  LANDING_PAGE_SPECIALIST: 'Landing Page Specialist',
  AUTOMATION_SPECIALIST: 'Automation Specialist',
};

export const ACTIVITY_LABEL: Record<string, string> = {
  created: 'membuat kartu',
  moved: 'memindahkan kartu',
  updated: 'mengubah kartu',
  archived: 'mengarsipkan kartu',
  restored: 'memulihkan kartu',
  approved: 'menyetujui & menyelesaikan',
  commented: 'berkomentar',
  checklist_done: 'mencentang',
  checklist_undone: 'membatalkan centang',
  link_added: 'menambah tautan',
  dependency_added: 'menambah dependensi',
  time_logged: 'mencatat waktu',
  alert_reopened: 'alert muncul lagi',
  alert_repeated: 'alert serupa muncul lagi',
};

const FIELD_LABEL: Record<string, string> = {
  title: 'judul',
  description: 'deskripsi',
  priority: 'prioritas',
  ownerMembershipId: 'owner',
  teamId: 'tim',
  campaignId: 'campaign',
  networkAccountId: 'akun jaringan',
  startDate: 'tanggal mulai',
  dueDate: 'tenggat',
  approvalRequired: 'kewajiban approval',
  completionEvidence: 'bukti penyelesaian',
  assignees: 'kolaborator',
};

export function activityText(a: CardDetail['activities'][number]): string {
  const base = ACTIVITY_LABEL[a.type] ?? a.type;
  const d = a.data ?? {};
  if (a.type === 'moved') return `${base} dari ${String(d.from)} ke ${String(d.to)}`;
  if (a.type === 'updated' && Array.isArray(d.fields)) return `mengubah ${d.fields.map((f) => FIELD_LABEL[String(f)] ?? f).join(', ')}`;
  if ((a.type === 'checklist_done' || a.type === 'checklist_undone') && d.text) return `${base} "${String(d.text)}"`;
  if (a.type === 'time_logged' && d.minutes) return `${base} ${minutes(Number(d.minutes))}`;
  if (a.type === 'dependency_added' && d.number) return `${base} T-${String(d.number)}`;
  if (a.type === 'created' && d.source === 'ALERT') return 'dibuat otomatis dari alert';
  if (a.type === 'alert_repeated' && d.title) return `${base}: ${String(d.title)}`;
  return base;
}

export function minutes(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h} j ${r} m` : `${h} jam`) : `${r} menit`;
}

/** Tanggal (YYYY-MM-DD) hari ini di zona waktu organisasi. */
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later' | null;
export function dueState(due: string | null, done: boolean, tz: string): DueState {
  if (!due || done) return null;
  const d = due.slice(0, 10);
  const today = todayIn(tz);
  if (d < today) return 'overdue';
  if (d === today) return 'today';
  const diff = (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return diff <= 3 ? 'soon' : 'later';
}

export function shortDate(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Tampilkan @[Nama](id) sebagai @Nama. */
export function renderMentions(body: string): string {
  return body.replace(/@\[([^\]]{1,100})\]\([0-9a-f-]{36}\)/gi, '@$1');
}

export type LiveState = 'connecting' | 'live' | 'offline';

/**
 * Langganan event real-time tugas (SSE lewat fetch agar header organisasi ikut terkirim).
 * Setiap event meng-invalidate query terkait; koneksi tersambung ulang otomatis dengan backoff.
 */
export function useTaskStream(): LiveState {
  const { org } = useSession();
  const qc = useQueryClient();
  const [state, setState] = useState<LiveState>('connecting');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stopped = false;
    let ctrl: AbortController | null = null;
    let attempt = 0;

    const invalidate = () => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === org.id && typeof q.queryKey[1] === 'string' && /^\/(boards|cards|tasks)/.test(q.queryKey[1] as string) });
    };

    async function connect() {
      ctrl = new AbortController();
      setState('connecting');
      try {
        const res = await fetch('/api/v1/tasks/stream', {
          headers: { Accept: 'text/event-stream', 'X-Organization-Id': getActiveOrg() ?? org.id },
          credentials: 'same-origin',
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const raw = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const type = /^event: (.*)$/m.exec(raw)?.[1];
            if (type === 'ready') {
              attempt = 0;
              setState('live');
              // Data yang terlewat selama terputus diambil ulang.
              invalidate();
            } else if (type === 'task') {
              // Termasuk perubahan sendiri dari tab lain; refetch murah dan board tidak di-reset saat sedang drag.
              invalidate();
            }
          }
        }
      } catch {
        /* koneksi gagal/terputus — dicoba lagi di bawah */
      }
      if (stopped) return;
      setState('offline');
      attempt++;
      timer.current = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
    }

    void connect();
    return () => {
      stopped = true;
      ctrl?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [org.id, qc]);

  return state;
}
