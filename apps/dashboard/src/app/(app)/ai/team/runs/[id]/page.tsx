'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { AgentAvatar, EvidenceDrawer, MessageText, ProposalCard } from '@/components/team';
import { Alert, Badge, Card, cn, Loading, PageHeader } from '@/components/ui';
import { TOOL_LABEL, usd } from '@/lib/ai';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useOrgQuery } from '@/lib/hooks';
import { RUN_STATUS, RunDetail, RunMessage, STAGE_LABEL, VERDICT } from '@/lib/team';
import type { Campaign } from '@/lib/types';

const KIND_LABEL: Record<RunMessage['kind'], string> = {
  DIRECTIVE: 'Perintah owner',
  PLAN: 'Rencana',
  ASSIGNMENT: 'Penugasan',
  REPORT: 'Laporan',
  DISCUSSION: 'Diskusi',
  SUMMARY: 'Rangkuman untuk Anda',
  TOOL: 'Ambil data',
  NOTE: 'Catatan sistem',
  ERROR: 'Kesalahan',
};

const STAGES = ['plan', 'report', 'discussion', 'summary'] as const;

function Progress({ run }: { run: RunDetail }) {
  const live = run.status === 'RUNNING' || run.status === 'QUEUED';
  const stages: readonly string[] = run.kind === 'MEETING' ? STAGES.filter((s) => s !== 'plan') : STAGES;
  const current = run.status === 'COMPLETED' ? stages.length : Math.max(0, stages.indexOf(run.stage ?? ''));
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Tahap sesi">
      {stages.map((s, i) => {
        const done = i < current;
        const active = live && i === current;
        return (
          <li key={s} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className={cn('h-px w-5', done || active ? 'bg-primary' : 'bg-border-strong')} />}
            <span className={cn('inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5', done ? 'bg-primary-soft text-primary' : active ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-muted')}>
              {active && <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-primary-fg" />}
              {STAGE_LABEL[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ToolRow({ m, onOpen }: { m: RunMessage; onOpen: (id: string) => void }) {
  const d = m.data as { args?: Record<string, unknown> } | null;
  const args = d?.args ? Object.entries(d.args).map(([k, v]) => `${k}: ${String(v)}`).join(', ') : '';
  return (
    <div className="flex items-center gap-2 py-0.5 pl-10 text-xs text-muted">
      <span className={cn('size-1.5 rounded-full', m.evidenceId ? 'bg-success' : 'bg-warning')} aria-hidden />
      <span>
        {m.agent?.name} mengambil <span className="text-text">{TOOL_LABEL[m.toolName ?? ''] ?? m.toolName}</span>
        {args && <span> ({args})</span>}
      </span>
      {m.evidenceId ? (
        <button type="button" onClick={() => onOpen(m.evidenceId!)} className="rounded-sm border border-border-strong px-1.5 font-mono text-[11px] text-primary hover:bg-primary-soft">
          {m.evidenceId}
        </button>
      ) : (
        <span>gagal</span>
      )}
    </div>
  );
}

function MessageRow({ m, author, onOpen }: { m: RunMessage; author?: string; onOpen: (id: string) => void }) {
  if (m.kind === 'TOOL') return <ToolRow m={m} onOpen={onOpen} />;
  const sup = m.agent?.role === 'SUPERVISOR';
  const name = m.agent?.name ?? author ?? 'Owner';
  const sys = m.kind === 'NOTE' || m.kind === 'ERROR';
  if (sys)
    return (
      <div className={cn('ml-10 rounded-md px-3 py-1.5 text-xs', m.kind === 'ERROR' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-text')}>
        <span className="font-medium">{m.kind === 'ERROR' ? 'Kesalahan' : 'Sistem'}:</span> {m.content}
      </div>
    );
  return (
    <div className="flex gap-2.5">
      {m.agent ? (
        <AgentAvatar name={name} supervisor={sup} />
      ) : (
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-text text-[11px] font-semibold text-surface">
          OW
        </span>
      )}
      <div className={cn('min-w-0 flex-1 rounded-lg border px-3 py-2', m.kind === 'SUMMARY' ? 'border-primary/40 bg-primary-soft/30' : m.agent ? 'border-border bg-surface' : 'border-border-strong bg-surface-2/60')}>
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs">
          <span className="font-semibold text-text">{name}</span>
          <span className="text-muted">{KIND_LABEL[m.kind]}</span>
          <span className="ml-auto text-muted">{dateTime(m.createdAt)}</span>
        </div>
        <MessageText text={m.content} />
      </div>
    </div>
  );
}

function RunPage() {
  const { id } = useParams<{ id: string }>();
  const [live, setLive] = useState(true);
  const q = useOrgQuery<RunDetail>(`/ai/team/runs/${id}`, { refetchInterval: live ? 2500 : undefined });
  const campaigns = useOrgQuery<Campaign[]>('/campaigns');
  const [evidence, setEvidence] = useState<string | null>(null);
  const run = q.data;
  const running = run?.status === 'RUNNING' || run?.status === 'QUEUED';
  if (run && !running && live) setLive(false);
  const cname = useMemo(() => new Map((campaigns.data ?? []).map((c) => [c.id, c.name])), [campaigns.data]);
  const authors = useMemo(() => new Map((run?.authors ?? []).map((a) => [a.id, a.name])), [run?.authors]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <Alert>{errorMessage(q.error)}</Alert>;
  if (!run) return null;
  const pending = run.proposals.filter((p) => p.status === 'PENDING_OWNER');
  const others = run.proposals.filter((p) => p.status !== 'PENDING_OWNER');
  const st = RUN_STATUS[run.status];

  return (
    <>
      <div className="mb-2 text-xs text-muted">
        <Link href="/ai/team" className="hover:text-text">
          Tim AI
        </Link>{' '}
        / {run.kind === 'MEETING' ? 'Rapat' : 'Perintah'}
      </div>
      <PageHeader
        title={run.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={st.tone}>{st.label}</Badge>
            <span>{dateTime(run.createdAt)}</span>
            <span>· biaya {usd(run.costUsd)}</span>
            {running && <span className="text-primary">· memperbarui otomatis</span>}
          </span>
        }
        actions={<Progress run={run} />}
      />
      {run.error && run.status !== 'COMPLETED' && (
        <div className="mb-4">
          <Alert tone={run.status === 'CANCELLED' ? 'yellow' : 'red'}>{run.error}</Alert>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-4">
          {run.summary && (
            <Card title="Rangkuman Kepala Tim AI">
              <MessageText text={run.summary} />
              {run.brief?.campaignEvaluations?.length ? (
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-medium text-muted">Evaluasi campaign</p>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {run.brief.campaignEvaluations.map((e) => (
                      <li key={e.campaignId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                        <Badge tone={VERDICT[e.verdict].tone}>{VERDICT[e.verdict].label}</Badge>
                        <span className="font-medium">{cname.get(e.campaignId) ?? e.campaignId.slice(0, 8)}</span>
                        <span className="min-w-0 flex-1 text-muted">{e.note}</span>
                        {e.evidence.map((x) => (
                          <button key={x} type="button" onClick={() => setEvidence(x)} className="rounded-sm border border-border-strong px-1.5 font-mono text-[11px] text-primary">
                            {x}
                          </button>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {run.brief?.counts && (
                <p className="mt-3 text-xs text-muted">
                  {run.brief.counts.proposals} usulan dinilai · {run.brief.counts.forwarded} diteruskan ke Anda · {run.brief.counts.rejected} ditolak Kepala Tim · {run.brief.counts.violations} ditolak sistem (melanggar rule/tanpa bukti)
                </p>
              )}
            </Card>
          )}

          <Card title="Transkrip lengkap" actions={<span className="text-xs text-muted">Semua langkah, data, dan catatan sistem — tanpa disaring</span>}>
            {run.messages.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted">{running ? 'Tim sedang bersiap…' : 'Tidak ada pesan.'}</p>
            ) : (
              <ol className="space-y-3">
                {run.messages.map((m, i) => {
                  const prev = run.messages[i - 1];
                  const stageChanged = m.stage && m.stage !== prev?.stage && m.kind !== 'TOOL';
                  return (
                    <li key={m.id}>
                      {stageChanged && (
                        <p className="mt-2 mb-2 flex items-center gap-2 text-xs font-medium text-muted">
                          <span className="h-px flex-1 bg-border" />
                          {STAGE_LABEL[m.stage!] ?? m.stage}
                          <span className="h-px flex-1 bg-border" />
                        </p>
                      )}
                      <MessageRow m={m} author={m.authorId ? authors.get(m.authorId) : undefined} onOpen={setEvidence} />
                    </li>
                  );
                })}
                {running && (
                  <li className="flex items-center gap-2 pl-10 text-xs text-muted" role="status">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden /> Tim sedang bekerja…
                  </li>
                )}
              </ol>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-3">
          <h2 className="text-[13px] font-semibold">Usulan untuk diputuskan {pending.length > 0 && <span className="tabular text-primary">({pending.length})</span>}</h2>
          {pending.length === 0 && <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted">{running ? 'Menunggu rangkuman Kepala Tim AI…' : 'Tidak ada usulan yang menunggu Anda.'}</p>}
          {pending.map((p) => (
            <ProposalCard key={p.id} p={{ ...p, campaignName: p.campaignId ? (cname.get(p.campaignId) ?? null) : undefined }} runId={run.id} />
          ))}
          {others.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-[13px] font-medium text-muted hover:text-text">Usulan lain di sesi ini ({others.length})</summary>
              <div className="mt-2 space-y-3">
                {others.map((p) => (
                  <ProposalCard key={p.id} p={{ ...p, campaignName: p.campaignId ? (cname.get(p.campaignId) ?? null) : undefined }} runId={run.id} />
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
      <EvidenceDrawer runId={run.id} evidenceId={evidence} onClose={() => setEvidence(null)} />
    </>
  );
}

export default function Page() {
  return (
    <RequirePermission permission="ai.supervise">
      <RunPage />
    </RequirePermission>
  );
}
