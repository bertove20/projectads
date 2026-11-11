'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { RichText } from '@/lib/ai';
import { dateTime } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { agentInitials, PROPOSAL_STATUS, Proposal, RISK, RunMessage, STANCE } from '@/lib/team';
import { TOOL_LABEL } from '@/lib/ai';
import { Alert, Badge, Button, cn, Drawer } from './ui';

export function AgentAvatar({ name, supervisor, size = 'md', muted }: { name: string; supervisor?: boolean; size?: 'sm' | 'md' | 'lg'; muted?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-md font-semibold',
        size === 'sm' ? 'size-6 text-[10px]' : size === 'lg' ? 'size-10 text-[13px]' : 'size-8 text-[11px]',
        supervisor ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-text ring-1 ring-border-strong',
        muted && 'opacity-50',
      )}
    >
      {agentInitials(name)}
    </span>
  );
}

/** Data mentah satu bukti (hasil tool) — dibuka dari chip E1, E2, … */
export function EvidenceDrawer({ runId, evidenceId, onClose }: { runId: string; evidenceId: string | null; onClose: () => void }) {
  const q = useOrgQuery<RunMessage>(evidenceId ? `/ai/team/runs/${runId}/evidence/${evidenceId}` : null);
  const data = q.data?.data as { args?: Record<string, unknown>; result?: unknown } | undefined;
  return (
    <Drawer open={!!evidenceId} title={`Bukti ${evidenceId ?? ''}`} onClose={onClose} wide>
      {q.isLoading && <p className="text-[13px] text-muted">Memuat bukti…</p>}
      {q.error && <Alert>{errorMessage(q.error)}</Alert>}
      {q.data && (
        <div className="space-y-3 text-[13px]">
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted">Diambil oleh</dt>
            <dd>{q.data.agent?.name ?? '—'}</dd>
            <dt className="text-muted">Tool</dt>
            <dd>{TOOL_LABEL[q.data.toolName ?? ''] ?? q.data.toolName}</dd>
            <dt className="text-muted">Parameter</dt>
            <dd className="font-mono text-[12px]">{data?.args && Object.keys(data.args).length ? JSON.stringify(data.args) : '—'}</dd>
            <dt className="text-muted">Waktu</dt>
            <dd>{dateTime(q.data.createdAt)}</dd>
          </dl>
          <p className="text-xs text-muted">Data di bawah adalah hasil asli dari server, bukan teks buatan AI.</p>
          <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-surface-2/60 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">{JSON.stringify(data?.result, null, 2)}</pre>
        </div>
      )}
    </Drawer>
  );
}

export function EvidenceChips({ ids, onOpen }: { ids: string[]; onOpen: (id: string) => void }) {
  if (!ids.length) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onOpen(id)}
          className="rounded-sm border border-border-strong bg-surface px-1.5 py-px font-mono text-[11px] text-primary hover:bg-primary-soft"
          title="Lihat data bukti"
        >
          {id}
        </button>
      ))}
    </span>
  );
}

function PreviewLine({ p }: { p: Proposal }) {
  const v = p.preview;
  if (!v) return null;
  if (p.action === 'CREATE_TASK') return <span>Kartu baru di board Operasional</span>;
  const fmt = (s: unknown) => (s == null ? 'tidak ada' : String(s) === 'ACTIVE' ? 'Aktif' : String(s) === 'PAUSED' ? 'Dijeda' : String(s) === 'BLACKLIST' ? 'Diblokir' : String(s) === 'WHITELIST' ? 'Diizinkan' : String(s));
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {p.action === 'ZONE_LIST' && <span className="text-muted">Zone {v.zoneId}:</span>}
      <span className="rounded-sm bg-surface-2 px-1.5 py-px">{fmt(v.before)}</span>
      <span aria-hidden className="text-muted">→</span>
      <span className="rounded-sm bg-primary-soft px-1.5 py-px font-medium text-primary">{fmt(v.after)}</span>
      {v.noop && <Badge tone="gray">sudah sesuai, tidak ada perubahan</Badge>}
    </span>
  );
}

function ResultLine({ p }: { p: Proposal }) {
  const r = p.result;
  if (!r) return null;
  if (r.error) return <Alert>{String(r.error)}</Alert>;
  if (r.cardId)
    return (
      <p className="text-[12.5px] text-success">
        Kartu T-{String(r.number)} dibuat ·{' '}
        <Link className="underline" href={`/boards/${String(r.boardId)}?card=${String(r.cardId)}`}>
          buka di board
        </Link>
      </p>
    );
  return <p className="text-[12.5px] text-success">{r.noop ? 'Tidak ada perubahan (sudah sesuai)' : `Dieksekusi: ${String(r.before ?? 'tidak ada')} → ${String(r.after)}`}</p>;
}

/** Satu usulan karyawan AI: alasan, bukti, tanggapan rekan, catatan Kepala Tim, dan tombol keputusan owner. */
export function ProposalCard({ p, runId, showRun, onDecided }: { p: Proposal; runId: string; showRun?: boolean; onDecided?: () => void }) {
  const { can } = useSession();
  const act = useOrgAction<{ status: string; error?: string; revisionRunId?: string | null }>();
  const [evidence, setEvidence] = useState<string | null>(null);
  const [mode, setMode] = useState<null | 'REJECT' | 'REVISION'>(null);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const st = PROPOSAL_STATUS[p.status];
  const pending = p.status === 'PENDING_OWNER';

  async function decide(decision: 'APPROVE' | 'REJECT' | 'REVISION') {
    setMsg(null);
    try {
      const r = await act.mutateAsync({ method: 'POST', path: `/ai/approvals/${p.id}/decide`, body: { decision, note: note.trim() || undefined } });
      if (r.status === 'FAILED') setMsg(`Eksekusi gagal: ${r.error}`);
      setMode(null);
      setNote('');
      onDecided?.();
    } catch (err) {
      setMsg(errorMessage(err));
    }
  }

  return (
    <article className={cn('rounded-lg border bg-surface', pending ? 'border-primary/40' : 'border-border')}>
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <AgentAvatar name={p.agent.name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={st.tone}>{st.label}</Badge>
            <Badge tone={RISK[p.risk].tone}>{RISK[p.risk].label}</Badge>
            <span className="text-xs text-muted">
              <span className="font-mono">{p.ref}</span> · {p.agent.name} · {p.actionLabel}
            </span>
          </div>
          <h3 className="mt-1 text-[14px] font-semibold leading-snug">{p.title}</h3>
          {p.campaignName !== undefined && p.campaignId && <p className="text-xs text-muted">Campaign: {p.campaignName ?? p.campaignId}</p>}
          {showRun && p.run && (
            <Link href={`/ai/team/runs/${p.run.id}`} className="text-xs text-muted hover:text-text hover:underline">
              Dari: {p.run.title}
            </Link>
          )}
        </div>
      </header>

      <div className="space-y-3 px-4 py-3 text-[13px]">
        <div>
          <p className="text-xs font-medium text-muted">Alasan berbasis data</p>
          <p className="mt-0.5 leading-relaxed">{p.reason}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            Bukti: <EvidenceChips ids={p.evidence} onOpen={setEvidence} />
          </div>
          {p.expectedImpact && <p className="mt-1 text-xs text-muted">Dampak yang diharapkan: {p.expectedImpact}</p>}
        </div>

        {p.discussion?.length ? (
          <div>
            <p className="text-xs font-medium text-muted">Tanggapan rekan</p>
            <ul className="mt-1 space-y-1">
              {p.discussion.map((d, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-1.5">
                  <Badge tone={STANCE[d.stance].tone}>{STANCE[d.stance].label}</Badge>
                  <span className="font-medium">{d.agent}:</span>
                  <span>{d.text}</span>
                  <EvidenceChips ids={d.evidence ?? []} onOpen={setEvidence} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {p.supervisorNote && (
          <div className="flex gap-2 rounded-md bg-surface-2/70 px-3 py-2">
            <AgentAvatar name="Kepala Tim AI" supervisor size="sm" />
            <div>
              <p className="text-xs font-medium text-muted">Catatan Kepala Tim AI</p>
              <p className="leading-relaxed">{p.supervisorNote}</p>
            </div>
          </div>
        )}

        {pending && p.preview && (
          <div>
            <p className="text-xs font-medium text-muted">Yang akan dijalankan server bila disetujui</p>
            <div className="mt-1 text-[13px]">
              <PreviewLine p={p} />
            </div>
          </div>
        )}
        {p.ownerNote && <p className="text-xs text-muted">Catatan Anda: {p.ownerNote}</p>}
        <ResultLine p={p} />
        {msg && <Alert>{msg}</Alert>}
      </div>

      {pending && can('ai.approve') && (
        <footer className="border-t border-border px-4 py-3">
          {mode ? (
            <div className="space-y-2">
              <textarea
                className="min-h-16 w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] focus-visible:border-primary focus-visible:outline-none"
                placeholder={mode === 'REVISION' ? 'Apa yang perlu diperbaiki? Kepala Tim AI akan menugaskan ulang tim.' : 'Alasan penolakan (opsional)'}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Catatan keputusan"
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={mode === 'REJECT' ? 'danger' : 'primary'} disabled={act.isPending || (mode === 'REVISION' && note.trim().length < 3)} onClick={() => decide(mode)}>
                  {mode === 'REJECT' ? 'Tolak usulan' : 'Kirim permintaan revisi'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
                  Batal
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={act.isPending} onClick={() => decide('APPROVE')}>
                Setujui &amp; jalankan
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setMode('REVISION')}>
                Minta revisi
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode('REJECT')}>
                Tolak
              </Button>
              <span className="ml-auto text-xs text-muted">Diusulkan {dateTime(p.createdAt)}</span>
            </div>
          )}
        </footer>
      )}
      <EvidenceDrawer runId={runId} evidenceId={evidence} onClose={() => setEvidence(null)} />
    </article>
  );
}

export async function emergency(paused: boolean) {
  return api('/ai/team/emergency-stop', { method: 'POST', body: { paused } });
}

export function MessageText({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-[13px]">
      <RichText text={text} />
    </div>
  );
}
