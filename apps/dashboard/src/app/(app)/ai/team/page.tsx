'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { AgentAvatar, emergency } from '@/components/team';
import { Alert, Badge, Button, Card, cn, Drawer, Field, Input, Loading, PageHeader, Select } from '@/components/ui';
import { AiModelRow, usd } from '@/lib/ai';
import { api, errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Goal, GoalMetric, GoalPeriod, goalTarget, METRIC_LABEL, PERIOD_LABEL, RUN_STATUS, RunSummary, STAGE_LABEL, TeamAgent, TeamOverview } from '@/lib/team';
import type { Campaign } from '@/lib/types';
import { useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { STATE_LABEL } from '@/components/office-3d';
import type { LiveTeam } from '@/lib/team';

// WebGL hanya di browser; dimuat terpisah agar halaman lain tidak menanggung ukuran three.js.
const Office3D = dynamic(() => import('@/components/office-3d'), { ssr: false, loading: () => <div className="grid h-[420px] place-items-center text-[13px] text-muted">Memuat kantor 3D…</div> });

function AgentTile({ a, onEdit }: { a: TeamAgent; onEdit: () => void }) {
  const sup = a.role === 'SUPERVISOR';
  return (
    <button
      type="button"
      onClick={onEdit}
      className={cn(
        'flex w-full min-w-0 flex-col gap-2 rounded-lg border bg-surface p-3 text-left transition-colors hover:border-border-strong',
        sup ? 'border-primary/40' : 'border-border',
        !a.enabled && 'bg-surface-2/50',
      )}
    >
      <div className="flex items-center gap-2.5">
        <AgentAvatar name={a.name} supervisor={sup} muted={!a.enabled} />
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-[13px] font-semibold', !a.enabled && 'text-muted')}>{a.name}</p>
          <p className="truncate text-xs text-muted">{a.positionLabel}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        {!a.enabled ? (
          <Badge>Nonaktif</Badge>
        ) : a.model ? (
          <span className="truncate font-mono text-[11px]" title={a.model.modelId}>
            {a.model.modelId}
          </span>
        ) : (
          <Badge tone="yellow">Tanpa model</Badge>
        )}
        <span className="tabular shrink-0">
          {a.today.requests} req · {usd(a.today.costUsd)}
        </span>
      </div>
      {!sup && (
        <div className="flex flex-wrap gap-1">
          {a.allowedActions.map((x) => (
            <span key={x.key} className="rounded-sm bg-surface-2 px-1.5 py-px text-[11px] text-muted">
              {x.label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function AgentDrawer({ agent, models, onClose }: { agent: TeamAgent | null; models: AiModelRow[]; onClose: () => void }) {
  const act = useOrgAction();
  const [enabled, setEnabled] = useState(agent?.enabled ?? true);
  const [modelId, setModelId] = useState(agent?.modelOverride?.id ?? '');
  const [instructions, setInstructions] = useState(agent?.instructions ?? '');
  const [err, setErr] = useState<string | null>(null);
  if (!agent) return null;
  const usable = models.filter((m) => m.enabled && m.available && m.supportsTools);
  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await act.mutateAsync({ method: 'PATCH', path: `/ai/team/agents/${agent!.id}`, body: { enabled, modelId: modelId || null, instructions: instructions.trim() || null } });
      onClose();
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  }
  return (
    <Drawer open title={agent.name} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <p className="text-[13px] text-muted">
          {agent.role === 'SUPERVISOR'
            ? 'Atasan seluruh karyawan AI. Membagi tugas, memeriksa laporan dengan data, dan meneruskan usulan yang layak kepada Anda.'
            : `Karyawan AI jabatan ${agent.positionLabel}. Melapor ke Kepala Tim AI, tidak langsung ke Anda.`}
        </p>
        {agent.role === 'WORKER' && (
          <div>
            <p className="text-[13px] font-medium">Wewenang usulan (ditegakkan server)</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {agent.allowedActions.map((x) => (
                <Badge key={x.key} tone="blue">
                  {x.label}
                </Badge>
              ))}
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-[var(--color-primary)]" />
          Agent aktif (ikut rapat & menerima tugas)
        </label>
        <Field label="Model" hint="Kosong = ikut model jabatan di Pengaturan AI. Hanya model yang mendukung tool calling.">
          <Select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="">Ikut jabatan{agent.model?.inherited ? ` (${agent.model.modelId})` : ''}</option>
            {usable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.modelId}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Instruksi tambahan dari Anda" hint="Dianggap instruksi tepercaya, mis. fokus GEO tertentu atau batas toleransi rugi.">
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={2000}
            className="min-h-28 w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] focus-visible:border-primary focus-visible:outline-none"
          />
        </Field>
        {err && <Alert>{err}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" disabled={act.isPending}>
            Simpan
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function Directive({ disabled }: { disabled: string | null }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function send(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ runId: string }>('/ai/team/directives', { method: 'POST', body: { text } });
      router.push(`/ai/team/runs/${r.runId}`);
    } catch (e2) {
      setErr(errorMessage(e2));
      setBusy(false);
    }
  }
  return (
    <Card title="Perintah ke Kepala Tim AI">
      <form onSubmit={send} className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Mis. Evaluasi campaign Thailand minggu ini, mana yang harus di-pause dan mana yang layak dinaikkan budgetnya?"
          className="min-h-24 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-[13.5px] focus-visible:border-primary focus-visible:outline-none"
          disabled={!!disabled}
          aria-label="Perintah untuk Kepala Tim AI"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!!disabled || busy || text.trim().length < 5}>
            {busy ? 'Mengirim…' : 'Kirim perintah'}
          </Button>
          <span className="text-xs text-muted">{disabled ?? 'Kepala Tim AI membagi tugas ke karyawan AI, lalu merangkum hasil & usulan untuk Anda.'}</span>
        </div>
        {err && <Alert>{err}</Alert>}
      </form>
    </Card>
  );
}

function Goals({ goals, campaigns }: { goals: Goal[]; campaigns: Campaign[] }) {
  const act = useOrgAction();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: '', metric: 'PROFIT' as GoalMetric, target: '', period: 'DAILY' as GoalPeriod, campaignId: '' });
  const [err, setErr] = useState<string | null>(null);
  async function add(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const raw = Number(f.target);
    try {
      await act.mutateAsync({ method: 'POST', path: '/ai/goals', body: { title: f.title, metric: f.metric, target: f.metric === 'ROI' ? raw / 100 : raw, period: f.period, campaignId: f.campaignId || null } });
      setAdding(false);
      setF({ title: '', metric: 'PROFIT', target: '', period: 'DAILY', campaignId: '' });
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  }
  return (
    <Card
      title="Goal tim"
      actions={
        <Button size="sm" variant="secondary" onClick={() => setAdding(!adding)}>
          {adding ? 'Tutup' : 'Tambah goal'}
        </Button>
      }
      flush
    >
      {adding && (
        <form onSubmit={add} className="grid gap-3 border-b border-border p-4 sm:grid-cols-2">
          <Field label="Nama goal" className="sm:col-span-2">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Profit harian minimal" required minLength={2} />
          </Field>
          <Field label="Metrik">
            <Select value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value as GoalMetric })}>
              {Object.entries(METRIC_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={f.metric === 'ROI' ? 'Target (%)' : f.metric === 'CONVERSIONS' ? 'Target (jumlah)' : 'Target (USD)'} hint={['CPA', 'SPEND'].includes(f.metric) ? 'Maksimal' : 'Minimal'}>
            <Input type="number" step="any" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} required />
          </Field>
          <Field label="Periode">
            <Select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value as GoalPeriod })}>
              {Object.entries(PERIOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Campaign">
            <Select value={f.campaignId} onChange={(e) => setF({ ...f, campaignId: e.target.value })}>
              <option value="">Semua campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={act.isPending}>
              Simpan goal
            </Button>
          </div>
        </form>
      )}
      {goals.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">Belum ada goal. Tanpa goal, tim AI fokus pada profit dan kesehatan tracking.</p>
      ) : (
        <ul className="divide-y divide-border">
          {goals.map((g) => (
            <li key={g.id} className={cn('flex items-center gap-3 px-4 py-2.5 text-[13px]', !g.active && 'opacity-55')}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{g.title}</p>
                <p className="truncate text-xs text-muted">
                  {METRIC_LABEL[g.metric]} {goalTarget(g)} · {PERIOD_LABEL[g.period]} · {g.campaign?.name ?? 'Semua campaign'}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => act.mutate({ method: 'PATCH', path: `/ai/goals/${g.id}`, body: { active: !g.active } })}>
                {g.active ? 'Nonaktifkan' : 'Aktifkan'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => confirm(`Hapus goal "${g.title}"?`) && act.mutate({ method: 'DELETE', path: `/ai/goals/${g.id}` })}>
                Hapus
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SettingsCard({ t }: { t: TeamOverview }) {
  const act = useOrgAction();
  const [f, setF] = useState({ meetingTime: t.settings.meetingTime, dailyBudgetUsd: t.settings.dailyBudgetUsd?.toString() ?? '', runBudgetUsd: t.settings.runBudgetUsd.toString() });
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const patch = async (body: Record<string, unknown>) => {
    setErr(null);
    setSaved(false);
    try {
      await act.mutateAsync({ method: 'PATCH', path: '/ai/team/settings', body });
      setSaved(true);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <Card title="Pengaturan tim">
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={t.settings.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="size-4 accent-[var(--color-primary)]" />
          Tim AI aktif
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={t.settings.meetingEnabled} onChange={(e) => patch({ meetingEnabled: e.target.checked })} className="size-4 accent-[var(--color-primary)]" />
          Rapat harian otomatis
        </label>
        <form
          className="grid grid-cols-2 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ meetingTime: f.meetingTime, dailyBudgetUsd: f.dailyBudgetUsd === '' ? null : Number(f.dailyBudgetUsd), runBudgetUsd: Number(f.runBudgetUsd) });
          }}
        >
          <Field label="Jam rapat harian" className="col-span-2">
            <Input type="time" value={f.meetingTime} onChange={(e) => setF({ ...f, meetingTime: e.target.value })} />
          </Field>
          <Field label="Budget tim / hari (USD)">
            <Input type="number" step="0.01" min="0" placeholder="∞" value={f.dailyBudgetUsd} onChange={(e) => setF({ ...f, dailyBudgetUsd: e.target.value })} />
          </Field>
          <Field label="Batas per sesi (USD)">
            <Input type="number" step="0.01" min="0.01" value={f.runBudgetUsd} onChange={(e) => setF({ ...f, runBudgetUsd: e.target.value })} />
          </Field>
          <div className="col-span-2 flex items-center gap-2">
            <Button type="submit" size="sm" variant="secondary" disabled={act.isPending}>
              Simpan
            </Button>
            {saved && <span className="text-xs text-success">Tersimpan</span>}
          </div>
        </form>
        <p className="text-xs text-muted">Jam rapat mengikuti zona waktu organisasi. Biaya dalam USD (OpenRouter).</p>
        {err && <Alert>{err}</Alert>}
      </div>
    </Card>
  );
}

function RunList({ runs }: { runs: RunSummary[] }) {
  return (
    <Card title="Sesi kerja terakhir" flush>
      {runs.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">Belum ada rapat atau perintah.</p>
      ) : (
        <ul className="divide-y divide-border">
          {runs.slice(0, 12).map((r) => (
            <li key={r.id}>
              <Link href={`/ai/team/runs/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-surface-2/60">
                <span className={cn('size-2 shrink-0 rounded-full', r.status === 'RUNNING' || r.status === 'QUEUED' ? 'animate-pulse bg-primary' : r.status === 'COMPLETED' ? 'bg-success' : 'bg-warning')} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.title}</p>
                  <p className="text-xs text-muted">
                    {r.kind === 'MEETING' ? 'Rapat' : 'Perintah'} · {dateTime(r.createdAt)}
                    {r.status === 'RUNNING' && r.stage ? ` · ${STAGE_LABEL[r.stage] ?? r.stage}` : ''}
                  </p>
                </div>
                {r.pendingOwner > 0 && <Badge tone="blue">{r.pendingOwner} menunggu Anda</Badge>}
                <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TeamPage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const team = useOrgQuery<TeamOverview>('/ai/team', { refetchInterval: 15_000 });
  const runs = useOrgQuery<RunSummary[]>('/ai/team/runs', { refetchInterval: 5_000 });
  const live = useOrgQuery<LiveTeam>('/ai/team/live', { refetchInterval: 3_000 });
  const [view, setView] = useState<'3d' | 'tree'>('3d');
  const [picked, setPicked] = useState<string | null>(null);
  const goals = useOrgQuery<Goal[]>('/ai/goals');
  const models = useOrgQuery<AiModelRow[]>(can('ai.manage') ? '/ai/models' : null);
  const campaigns = useOrgQuery<Campaign[]>('/campaigns');
  const router = useRouter();
  const [edit, setEdit] = useState<TeamAgent | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (team.isLoading) return <Loading />;
  if (team.error) return <Alert>{errorMessage(team.error)}</Alert>;
  const t = team.data!;
  const sup = t.agents.find((a) => a.role === 'SUPERVISOR');
  const workers = t.agents.filter((a) => a.role === 'WORKER');
  const blocked = t.settings.paused ? 'Tim AI dihentikan dengan tombol darurat.' : !t.settings.enabled ? 'Aktifkan tim AI di pengaturan tim.' : !sup?.model ? 'Kepala Tim AI belum punya model.' : null;

  async function toggleStop() {
    const pausing = !t.settings.paused;
    if (pausing && !confirm('Hentikan seluruh aktivitas tim AI sekarang? Sesi yang berjalan dihentikan dan eksekusi diblokir.')) return;
    setBusy(true);
    try {
      await emergency(pausing);
      await qc.invalidateQueries();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function meetingNow() {
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ runId: string }>('/ai/team/meetings', { method: 'POST' });
      router.push(`/ai/team/runs/${r.runId}`);
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Tim AI"
        description="Karyawan AI bekerja per jabatan dan melapor ke Kepala Tim AI. Kepala Tim merangkum dan meneruskan usulan ke Anda. Tidak ada yang dieksekusi tanpa persetujuan Anda."
        actions={
          <>
            <Link href="/approvals" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-strong px-3 text-[13px] font-medium hover:bg-surface-2">
              Approval Center
              {t.pendingApprovals > 0 && <span className="tabular rounded-sm bg-primary px-1.5 text-xs text-primary-fg">{t.pendingApprovals}</span>}
            </Link>
            <Button variant="secondary" onClick={meetingNow} disabled={busy || !!blocked}>
              Mulai rapat sekarang
            </Button>
            <Button variant={t.settings.paused ? 'primary' : 'danger'} onClick={toggleStop} disabled={busy}>
              {t.settings.paused ? 'Lanjutkan tim AI' : 'Tombol darurat'}
            </Button>
          </>
        }
      />
      {t.settings.paused && (
        <div className="mb-4">
          <Alert>Tim AI dihentikan{t.settings.pausedAt ? ` sejak ${dateTime(t.settings.pausedAt)}` : ''}. Tidak ada sesi baru dan tidak ada eksekusi sampai Anda melanjutkan.</Alert>
        </div>
      )}
      {err && (
        <div className="mb-4">
          <Alert>{err}</Alert>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <section aria-label="Tim AI" className="overflow-hidden rounded-lg border border-border bg-surface">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
              <div role="tablist" aria-label="Tampilan tim" className="flex gap-1">
                {(['3d', 'tree'] as const).map((v) => (
                  <button key={v} role="tab" type="button" aria-selected={view === v} onClick={() => setView(v)} className={cn('rounded-md px-2.5 py-1 text-[13px]', view === v ? 'bg-primary-soft font-medium text-primary' : 'text-muted hover:text-text')}>
                    {v === '3d' ? 'Kantor 3D' : 'Struktur'}
                  </button>
                ))}
              </div>
              <Link href="/ai/team/chat" className="text-[13px] font-medium text-primary hover:underline">
                Buka Ruang Tim (chat) →
              </Link>
            </div>
            {view === '3d' ? (
              <div className="relative">
                {live.data ? (
                  <Office3D agents={live.data.agents} selectedId={picked} onSelect={setPicked} />
                ) : (
                  <div className="grid h-[420px] place-items-center text-[13px] text-muted">Memuat status tim…</div>
                )}
                {(() => {
                  const a = live.data?.agents.find((x) => x.id === picked);
                  if (!a) return <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-muted">Klik karyawan AI untuk melihat pekerjaannya · seret untuk memutar</p>;
                  return (
                    <div className="absolute right-3 bottom-3 left-3 rounded-lg border border-border bg-surface/95 p-3 shadow-sm sm:left-auto sm:w-80">
                      <div className="flex items-center gap-2.5">
                        <AgentAvatar name={a.name} supervisor={a.role === 'SUPERVISOR'} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold">{a.name}</p>
                          <p className="text-xs text-muted">
                            {STATE_LABEL[a.state]}
                            {a.activity && a.state !== 'idle' ? ` · ${a.activity}` : ''}
                          </p>
                        </div>
                        <button type="button" onClick={() => setPicked(null)} className="text-xs text-muted hover:text-text" aria-label="Tutup">
                          ✕
                        </button>
                      </div>
                      {a.snippet && <p className="mt-2 line-clamp-3 text-[12.5px] text-muted">“{a.snippet}”</p>}
                      {a.lastActiveAt && <p className="mt-1 text-[11px] text-muted">Aktivitas terakhir {dateTime(a.lastActiveAt)}</p>}
                      <div className="mt-2 flex gap-2">
                        <Link href={`/ai/team/chat?agent=${a.id}`} className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-[12.5px] font-medium text-primary-fg">
                          Chat kerja & ingatan
                        </Link>
                        <Button size="sm" variant="secondary" onClick={() => setEdit(t.agents.find((x) => x.id === a.id) ?? null)}>
                          Pengaturan
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
          <div className="p-4">
            <div className="flex flex-col items-center">
              <div className="flex items-center gap-2.5 rounded-lg border border-border-strong bg-surface-2/60 px-3 py-2">
                <span aria-hidden className="grid size-8 place-items-center rounded-md bg-text text-[11px] font-semibold text-surface">
                  OW
                </span>
                <div>
                  <p className="text-[13px] font-semibold">Anda (Owner)</p>
                  <p className="text-xs text-muted">Persetujuan akhir & perintah</p>
                </div>
              </div>
              <span aria-hidden className="h-4 w-px bg-border-strong" />
              {sup && (
                <div className="w-full max-w-xs">
                  <AgentTile a={sup} onEdit={() => setEdit(sup)} />
                </div>
              )}
              <span aria-hidden className="h-4 w-px bg-border-strong" />
            </div>
            <div className="grid gap-2 border-t border-border-strong pt-4 sm:grid-cols-2 lg:grid-cols-4">
              {workers.map((a) => (
                <AgentTile key={a.id} a={a} onEdit={() => setEdit(a)} />
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              Model mengikuti jabatan di{' '}
              <Link href="/ai/settings" className="underline">
                Pengaturan AI
              </Link>{' '}
              (Kepala Tim memakai model Ads Manager). Klik agent untuk menonaktifkan, mengganti model, atau memberi instruksi khusus.
            </p>
          </div>
            )}
          </section>
          <Directive disabled={blocked} />
          <RunList runs={runs.data ?? []} />
        </div>
        <div className="min-w-0 space-y-4">
          <Card title="Hari ini">
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <div>
                <dt className="text-xs text-muted">Biaya tim AI</dt>
                <dd className="tabular text-lg font-semibold">{usd(t.spentToday)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Menunggu keputusan</dt>
                <dd className="tabular text-lg font-semibold">{t.pendingApprovals}</dd>
              </div>
            </dl>
          </Card>
          <SettingsCard key={JSON.stringify(t.settings)} t={t} />
          <Goals goals={goals.data ?? []} campaigns={campaigns.data ?? []} />
        </div>
      </div>
      {edit && <AgentDrawer key={edit.id} agent={edit} models={models.data ?? []} onClose={() => setEdit(null)} />}
    </>
  );
}

export default function Page() {
  return (
    <RequirePermission permission="ai.supervise">
      <TeamPage />
    </RequirePermission>
  );
}
