'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, KeyboardEvent, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { STATE_LABEL } from '@/components/office-3d';
import { AgentAvatar, EvidenceDrawer, MessageText } from '@/components/team';
import { Alert, Badge, Button, cn, Loading } from '@/components/ui';
import { TOOL_LABEL, usd } from '@/lib/ai';
import { api, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { AgentDetail, FeedMessage, LiveAgent, LiveTeam, MEMORY_KIND, Memory } from '@/lib/team';

const STATE_DOT: Record<LiveAgent['state'], string> = {
  idle: 'bg-border-strong',
  meeting: 'bg-primary',
  working: 'bg-success animate-pulse',
  talking: 'bg-warning animate-pulse',
  off: 'bg-surface-2 ring-1 ring-border-strong',
  paused: 'bg-danger',
};

const KIND_LABEL: Partial<Record<FeedMessage['kind'], string>> = {
  PLAN: 'Rencana',
  ASSIGNMENT: 'Penugasan',
  REPORT: 'Laporan',
  DISCUSSION: 'Diskusi',
  SUMMARY: 'Rangkuman untuk owner',
};

function FeedRow({ m, agentName, onEvidence }: { m: FeedMessage; agentName: (id: string | null) => { name: string; supervisor: boolean } | null; onEvidence: (runId: string, id: string) => void }) {
  const who = agentName(m.agentId);
  if (m.kind === 'TOOL')
    return (
      <div className="flex items-center gap-2 py-0.5 pl-11 text-xs text-muted">
        <span className={cn('size-1.5 rounded-full', m.evidenceId ? 'bg-success' : 'bg-warning')} aria-hidden />
        {who?.name} mengambil data <span className="text-text">{TOOL_LABEL[m.toolName ?? ''] ?? m.toolName}</span>
        {m.evidenceId && (
          <button type="button" onClick={() => onEvidence(m.runId, m.evidenceId!)} className="rounded-sm border border-border-strong px-1.5 font-mono text-[11px] text-primary hover:bg-primary-soft">
            {m.evidenceId}
          </button>
        )}
      </div>
    );
  if (m.kind === 'NOTE' || m.kind === 'ERROR')
    return (
      <div className={cn('ml-11 rounded-md px-3 py-1.5 text-xs', m.kind === 'ERROR' ? 'bg-danger/10 text-danger' : 'bg-warning/10')}>
        <span className="font-medium">Sistem:</span> {m.content}
      </div>
    );
  if (m.kind === 'DIRECTIVE')
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-[13.5px] text-primary-fg">
          <p className="mb-0.5 text-[11px] opacity-80">
            {m.authorName ?? 'Owner'} → Kepala Tim AI{m.via ? ` · lewat ${m.via === 'TELEGRAM' ? 'Telegram' : 'Discord'}` : ''}
          </p>
          <p className="whitespace-pre-wrap">{m.content}</p>
        </div>
      </div>
    );
  return (
    <div className="flex gap-2.5">
      <AgentAvatar name={who?.name ?? 'Agent'} supervisor={who?.supervisor} />
      <div className={cn('min-w-0 max-w-[85%] rounded-lg rounded-tl-sm border px-3 py-2', m.kind === 'SUMMARY' ? 'border-primary/40 bg-primary-soft/30' : 'border-border bg-surface')}>
        <p className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold text-text">{who?.name ?? 'Agent'}</span>
          <span className="text-muted">{KIND_LABEL[m.kind] ?? m.kind}</span>
          <span className="text-muted">{dateTime(m.createdAt)}</span>
        </p>
        <MessageText text={m.content} />
      </div>
    </div>
  );
}

function Memories({ agent }: { agent: AgentDetail }) {
  const act = useOrgAction();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const own = agent.memories.filter((m) => m.agentId === agent.id);
  const team = agent.memories.filter((m) => m.agentId === null);
  async function add(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await act.mutateAsync({ method: 'POST', path: '/ai/team/memories', body: { agentId: agent.id, content: text } });
      setText('');
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  }
  const Row = ({ m }: { m: Memory }) => (
    <li className="group py-2">
      <div className="flex items-center gap-1.5">
        <Badge tone={MEMORY_KIND[m.kind].tone}>{MEMORY_KIND[m.kind].label}</Badge>
        {m.pinned && <Badge tone="blue">disematkan</Badge>}
        <span className="ml-auto text-[11px] text-muted">{m.createdAt.slice(0, 10)}</span>
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed">{m.content}</p>
      <div className="mt-1 flex gap-2 text-[11px] text-muted opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button type="button" className="hover:text-text" onClick={() => act.mutate({ method: 'PATCH', path: `/ai/team/memories/${m.id}`, body: { pinned: !m.pinned } })}>
          {m.pinned ? 'Lepas sematan' : 'Sematkan'}
        </button>
        <button type="button" className="hover:text-danger" onClick={() => confirm('Hapus ingatan ini?') && act.mutate({ method: 'DELETE', path: `/ai/team/memories/${m.id}` })}>
          Hapus
        </button>
      </div>
    </li>
  );
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Catatan yang harus selalu diingat ${agent.name}…`}
          className="min-h-16 w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] focus-visible:border-primary focus-visible:outline-none"
          aria-label="Catatan ingatan baru"
        />
        <Button size="sm" type="submit" disabled={act.isPending || text.trim().length < 5}>
          Tambah ke ingatan
        </Button>
        {err && <Alert>{err}</Alert>}
      </form>
      {own.length === 0 ? <p className="text-xs text-muted">Belum ada ingatan. Ingatan terbentuk otomatis dari keputusan Anda, hasil eksekusi, dan pelajaran ber-bukti.</p> : <ul className="divide-y divide-border">{own.map((m) => <Row key={m.id} m={m} />)}</ul>}
      {team.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-medium text-muted">Ingatan seluruh tim ({team.length})</summary>
          <ul className="divide-y divide-border">{team.map((m) => <Row key={m.id} m={m} />)}</ul>
        </details>
      )}
    </div>
  );
}

function ChatRoom() {
  const router = useRouter();
  const params = useSearchParams();
  const agentId = params.get('agent');
  const qc = useQueryClient();
  const live = useOrgQuery<LiveTeam>('/ai/team/live', { refetchInterval: 3000 });
  const feed = useOrgQuery<FeedMessage[]>(`/ai/team/feed${agentId ? `?agentId=${agentId}` : ''}`, { refetchInterval: 3000 });
  const detail = useOrgQuery<AgentDetail>(agentId ? `/ai/team/agents/${agentId}` : null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{ runId: string; id: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = feed.data?.at(-1)?.id;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [lastId, agentId]);

  const agents = live.data?.agents ?? [];
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const agentName = (id: string | null) => {
    const a = id ? byId.get(id) : null;
    return a ? { name: a.name, supervisor: a.role === 'SUPERVISOR' } : null;
  };
  const current = agentId ? byId.get(agentId) : null;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (text.trim().length < 5) return;
    setErr(null);
    setSending(true);
    try {
      const body = current && current.role === 'WORKER' ? `(Tugaskan ke ${current.name}) ${text.trim()}` : text.trim();
      await api('/ai/team/directives', { method: 'POST', body: { text: body } });
      setText('');
      await qc.invalidateQueries();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setSending(false);
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  let lastRun: string | null = null;
  return (
    <div className="-mx-4 -my-5 grid h-[calc(100dvh-3rem)] grid-cols-1 lg:-mx-8 lg:-my-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_20rem]">
      <aside className="hidden min-h-0 flex-col border-r border-border bg-surface lg:flex" aria-label="Karyawan AI">
        <div className="flex h-12 items-center justify-between border-b border-border px-3">
          <p className="text-[13px] font-semibold">Ruang Tim AI</p>
          <Link href="/ai/team" className="text-xs text-muted hover:text-text">
            Kantor 3D
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          <button type="button" onClick={() => router.push('/ai/team/chat')} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]', !agentId ? 'bg-primary-soft font-medium text-primary' : 'hover:bg-surface-2')}>
            <span aria-hidden className="grid size-6 place-items-center rounded-md bg-surface-2 text-[11px]">#</span>
            Semua percakapan
          </button>
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => router.push(`/ai/team/chat?agent=${a.id}`)}
              className={cn('mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', agentId === a.id ? 'bg-primary-soft' : 'hover:bg-surface-2')}
            >
              <span className="relative">
                <AgentAvatar name={a.name} supervisor={a.role === 'SUPERVISOR'} size="sm" muted={a.state === 'off'} />
                <span className={cn('absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-surface', STATE_DOT[a.state])} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block truncate text-[13px]', agentId === a.id && 'font-medium text-primary')}>{a.name}</span>
                <span className="block truncate text-[11px] text-muted">{a.state === 'idle' || a.state === 'off' ? STATE_LABEL[a.state] : (a.activity ?? STATE_LABEL[a.state])}</span>
              </span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="flex min-h-0 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
          {current ? <AgentAvatar name={current.name} supervisor={current.role === 'SUPERVISOR'} size="sm" /> : null}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{current?.name ?? 'Semua percakapan tim'}</p>
            <p className="truncate text-xs text-muted">{current ? `${STATE_LABEL[current.state]}${current.activity && current.state !== 'idle' && current.state !== 'off' ? ` · ${current.activity}` : ''}` : (live.data?.running.length ? `${live.data.running.length} sesi berjalan` : 'Tidak ada sesi berjalan')}</p>
          </div>
          <select className="h-8 rounded-md border border-border-strong bg-surface px-2 text-[13px] lg:hidden" value={agentId ?? ''} onChange={(e) => router.push(e.target.value ? `/ai/team/chat?agent=${e.target.value}` : '/ai/team/chat')} aria-label="Pilih karyawan AI">
            <option value="">Semua</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {feed.isLoading ? (
            <Loading />
          ) : !feed.data?.length ? (
            <p className="py-16 text-center text-[13px] text-muted">Belum ada percakapan. Kirim perintah ke Kepala Tim AI di bawah.</p>
          ) : (
            <ol className="mx-auto max-w-3xl space-y-3">
              {feed.data.map((m) => {
                const divider = m.runId !== lastRun;
                lastRun = m.runId;
                return (
                  <li key={m.id}>
                    {divider && (
                      <p className="my-3 flex items-center gap-2 text-xs text-muted">
                        <span className="h-px flex-1 bg-border" />
                        <Link href={`/ai/team/runs/${m.runId}`} className="hover:text-text hover:underline">
                          {m.run.kind === 'MEETING' ? 'Rapat' : 'Perintah'}: {m.run.title}
                        </Link>
                        <span className="h-px flex-1 bg-border" />
                      </p>
                    )}
                    <FeedRow m={m} agentName={agentName} onEvidence={(runId, id) => setEvidence({ runId, id })} />
                  </li>
                );
              })}
              <div ref={endRef} />
            </ol>
          )}
        </div>
        <form onSubmit={send} className="shrink-0 border-t border-border bg-surface px-4 py-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              rows={2}
              placeholder={current && current.role === 'WORKER' ? `Perintah ke Kepala Tim AI untuk ditugaskan ke ${current.name}…` : 'Perintah ke Kepala Tim AI… (Enter kirim, Shift+Enter baris baru)'}
              className="min-h-11 flex-1 resize-none rounded-md border border-border-strong bg-surface px-3 py-2 text-[13.5px] focus-visible:border-primary focus-visible:outline-none"
              aria-label="Perintah untuk Kepala Tim AI"
            />
            <Button type="submit" disabled={sending || text.trim().length < 5}>
              {sending ? 'Mengirim…' : 'Kirim'}
            </Button>
          </div>
          <p className="mx-auto mt-1 max-w-3xl text-[11px] text-muted">Semua perintah melewati Kepala Tim AI. Perubahan apa pun tetap menunggu persetujuan Anda di Approval Center.</p>
          {err && (
            <div className="mx-auto mt-2 max-w-3xl">
              <Alert>{err}</Alert>
            </div>
          )}
        </form>
      </section>

      <aside className="hidden min-h-0 overflow-y-auto border-l border-border bg-surface p-4 xl:block" aria-label="Profil & ingatan">
        {detail.data ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <AgentAvatar name={detail.data.name} supervisor={detail.data.role === 'SUPERVISOR'} size="lg" />
              <div>
                <p className="text-[14px] font-semibold">{detail.data.name}</p>
                <p className="text-xs text-muted">{detail.data.positionLabel}</p>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-[12.5px]">
              <div className="rounded-md bg-surface-2/70 p-2">
                <dt className="text-[11px] text-muted">Usulan dieksekusi</dt>
                <dd className="tabular font-semibold">{detail.data.proposals.EXECUTED ?? 0}</dd>
              </div>
              <div className="rounded-md bg-surface-2/70 p-2">
                <dt className="text-[11px] text-muted">Ditolak</dt>
                <dd className="tabular font-semibold">{(detail.data.proposals.REJECTED ?? 0) + (detail.data.proposals.SUPERVISOR_REJECTED ?? 0)}</dd>
              </div>
              <div className="col-span-2 rounded-md bg-surface-2/70 p-2">
                <dt className="text-[11px] text-muted">Bulan ini</dt>
                <dd className="tabular font-semibold">
                  {detail.data.month.requests} request · {usd(detail.data.month.costUsd)}
                </dd>
              </div>
            </dl>
            {detail.data.allowedActions.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted">Wewenang usulan</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {detail.data.allowedActions.map((x) => (
                    <Badge key={x.key} tone="blue">
                      {x.label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-2 text-[13px] font-semibold">Ingatan kerja</p>
              <Memories agent={detail.data} />
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-[13px] text-muted">
            <p className="font-semibold text-text">Ruang tim</p>
            <p>Semua laporan, diskusi, dan rangkuman karyawan AI tampil di sini secara langsung. Pilih seorang karyawan untuk melihat pekerjaannya dan ingatan kerjanya.</p>
            <p>Angka yang ditulis AI dicocokkan otomatis dengan data bukti; teks yang tidak cocok ditandai sistem.</p>
          </div>
        )}
      </aside>
      {evidence && <EvidenceDrawer runId={evidence.runId} evidenceId={evidence.id} onClose={() => setEvidence(null)} />}
    </div>
  );
}

export default function Page() {
  return (
    <RequirePermission permission="ai.supervise">
      <Suspense fallback={<Loading />}>
        <ChatRoom />
      </Suspense>
    </RequirePermission>
  );
}
