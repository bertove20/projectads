'use client';

import { FormEvent, useMemo, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Button, Card, cn, Drawer, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { AiModelRow, AiSettingsView, MemberAiView, ModelRef, perMillion, PositionConfigView, usd, UsageView } from '@/lib/ai';
import { dateTime } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { POSITION_LABEL } from '@/lib/tasks';

const TABS = [
  { key: 'general', label: 'Koneksi & budget' },
  { key: 'models', label: 'Model' },
  { key: 'positions', label: 'Per jabatan' },
  { key: 'members', label: 'Per karyawan' },
  { key: 'usage', label: 'Pemakaian' },
] as const;
type Tab = (typeof TABS)[number]['key'];

const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

function General() {
  const { can, org } = useSession();
  const s = useOrgQuery<AiSettingsView>('/ai/settings');
  const action = useOrgAction<{ models?: number }>();
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [retention, setRetention] = useState<string | null>(null);
  if (s.isLoading || !s.data) return <Loading />;
  const d = s.data;

  async function saveKey(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    await action.mutateAsync({ method: 'PUT', path: '/ai/settings/api-key', body: { apiKey: key.trim() } }).then(
      (r) => {
        setKey('');
        setMsg(`Key valid dan tersimpan terenkripsi. ${r.models ?? 0} model tersinkron dari OpenRouter — aktifkan model yang boleh dipakai di tab Model.`);
      },
      () => undefined,
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Koneksi OpenRouter">
        {action.error && <Alert>{errorMessage(action.error)}</Alert>}
        {msg && <Alert tone="green">{msg}</Alert>}
        <dl className="mb-4 grid grid-cols-[140px_1fr] gap-y-2 text-[13px]">
          <dt className="text-muted">Status key</dt>
          <dd>{d.hasKey ? <Badge tone="green">tersimpan {d.apiKeyHint}</Badge> : <Badge tone="yellow">belum ada</Badge>}</dd>
          <dt className="text-muted">Divalidasi</dt>
          <dd>{dateTime(d.apiKeyValidatedAt, org.timezone)}</dd>
          <dt className="text-muted">Sinkron model</dt>
          <dd>{dateTime(d.modelsSyncedAt, org.timezone)}</dd>
        </dl>
        {can('ai.credentials') ? (
          <form onSubmit={saveKey} className="space-y-3">
            <Field label={d.hasKey ? 'Ganti API key' : 'API key OpenRouter'} hint="Diuji ke OpenRouter dulu. Disimpan terenkripsi di server dan tidak pernah dikirim ke browser.">
              <Input type="password" autoComplete="off" required minLength={20} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-or-…" />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={action.isPending || key.trim().length < 20}>
                Uji & simpan
              </Button>
              {d.hasKey && (
                <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => window.confirm('Hapus API key? AI langsung nonaktif untuk semua karyawan.') && action.mutate({ method: 'DELETE', path: '/ai/settings/api-key' })}>
                  Hapus key
                </Button>
              )}
            </div>
          </form>
        ) : (
          <p className="text-[13px] text-muted">Hanya Owner yang dapat mengatur API key.</p>
        )}
      </Card>

      <Card title="Status & budget organisasi">
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <span>
              <span className="block text-[13px] font-medium">AI Workspace aktif</span>
              <span className="block text-xs text-muted">Bila nonaktif, AI Assistant tidak bisa dipakai siapa pun.</span>
            </span>
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={d.enabled} disabled={!d.hasKey || action.isPending} onChange={(e) => action.mutate({ method: 'PATCH', path: '/ai/settings', body: { enabled: e.target.checked } })} />
          </label>
          <div className="text-[13px]">
            <span className="text-muted">Terpakai bulan ini: </span>
            <span className="tabular font-semibold">{usd(d.monthSpentUsd)}</span>
            {d.monthlyBudgetUsd != null && <span className="text-muted"> dari {usd(d.monthlyBudgetUsd)}</span>}
          </div>
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              action.mutate({
                method: 'PATCH',
                path: '/ai/settings',
                body: { ...(budget !== null ? { monthlyBudgetUsd: numOrNull(budget) } : {}), ...(retention !== null ? { retentionDays: Number(retention) } : {}) },
              });
            }}
          >
            <Field label="Budget bulanan (USD)" hint="Kosong = tanpa batas">
              <Input type="number" min={0} step="0.01" value={budget ?? (d.monthlyBudgetUsd ?? '').toString()} onChange={(e) => setBudget(e.target.value)} />
            </Field>
            <Field label="Simpan riwayat (hari)">
              <Input type="number" min={1} max={3650} value={retention ?? String(d.retentionDays)} onChange={(e) => setRetention(e.target.value)} />
            </Field>
            <Button type="submit" variant="secondary" disabled={action.isPending || (budget === null && retention === null)}>
              Simpan
            </Button>
          </form>
          <p className="text-xs text-muted">Yang dikirim ke OpenRouter: pertanyaan karyawan dan hasil tool berupa metrik agregat campaign (tanpa IP, user agent, atau data pengunjung).</p>
        </div>
      </Card>
    </div>
  );
}

function Models() {
  const [q, setQ] = useState('');
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const models = useOrgQuery<AiModelRow[]>(`/ai/models?${new URLSearchParams({ ...(q ? { q } : {}), ...(onlyEnabled ? { enabled: '1' } : {}) })}`);
  const action = useOrgAction<{ models: number }>();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card
      flush
      title="Model registry"
      actions={
        <>
          <Input aria-label="Cari model" className="w-56" placeholder="Cari id atau nama" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="inline-flex items-center gap-1.5 text-[13px]">
            <input type="checkbox" className="accent-[var(--primary)]" checked={onlyEnabled} onChange={(e) => setOnlyEnabled(e.target.checked)} />
            Hanya aktif
          </label>
          <Button size="sm" variant="secondary" disabled={action.isPending} onClick={() => action.mutate({ method: 'POST', path: '/ai/models/sync' }, { onSuccess: (r) => setMsg(`${r.models} model tersinkron.`) })}>
            Sinkron dari OpenRouter
          </Button>
        </>
      }
    >
      <div className="space-y-2 p-4 pb-0">
        {action.error && <Alert>{errorMessage(action.error)}</Alert>}
        {msg && <Alert tone="green">{msg}</Alert>}
        <p className="text-xs text-muted">Harga diambil dari OpenRouter dan dapat berubah. Hanya model yang diaktifkan yang bisa dipilih untuk jabatan/karyawan.</p>
      </div>
      {models.isLoading ? (
        <div className="p-4">
          <Loading />
        </div>
      ) : (
        <Table head={['Model', 'Konteks', 'Input / 1 jt token', 'Output / 1 jt token', 'Tool calling', 'Status', '']} numericCols={[1, 2, 3]} empty={!models.data?.length} emptyText="Belum ada model. Simpan API key atau sinkron ulang.">
          {models.data?.map((m) => (
            <tr key={m.id} className={cn(!m.available && 'opacity-60')}>
              <Td>
                <div className="font-medium">{m.name}</div>
                <div className="font-mono text-xs text-muted">{m.modelId}</div>
              </Td>
              <Td numeric>{m.contextLength ? `${Math.round(m.contextLength / 1000)}k` : '—'}</Td>
              <Td numeric>{perMillion(m.promptPrice)}</Td>
              <Td numeric>{perMillion(m.completionPrice)}</Td>
              <Td>{m.supportsTools ? <Badge tone="green">ya</Badge> : <Badge>tidak</Badge>}</Td>
              <Td>{!m.available ? <Badge tone="red">hilang dari OpenRouter</Badge> : m.enabled ? <Badge tone="blue">aktif</Badge> : <span className="text-muted">—</span>}</Td>
              <Td>
                <span className="flex justify-end">
                  <Button size="sm" variant={m.enabled ? 'ghost' : 'secondary'} disabled={action.isPending || (!m.available && !m.enabled)} onClick={() => action.mutate({ method: 'PATCH', path: `/ai/models/${m.id}`, body: { enabled: !m.enabled } })}>
                    {m.enabled ? 'Nonaktifkan' : 'Aktifkan'}
                  </Button>
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function ModelSelect({ value, onChange, models, label, allowInherit }: { value: string; onChange: (v: string) => void; models: AiModelRow[]; label: string; allowInherit?: string }) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allowInherit ?? 'Tidak ada'}</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.supportsTools ? '' : ' (tanpa tool)'}
          </option>
        ))}
      </Select>
    </Field>
  );
}

const modelName = (m: ModelRef) => m?.name ?? null;

function PositionForm({ row, models, onDone }: { row: PositionConfigView; models: AiModelRow[]; onDone: () => void }) {
  const action = useOrgAction();
  const [f, setF] = useState({
    modelId: row.model?.id ?? '',
    fallbackModelId: row.fallback?.id ?? '',
    temperature: String(row.temperature),
    maxTokens: String(row.maxTokens),
    dailyBudgetUsd: row.dailyBudgetUsd?.toString() ?? '',
    monthlyBudgetUsd: row.monthlyBudgetUsd?.toString() ?? '',
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    await action
      .mutateAsync({
        method: 'PUT',
        path: `/ai/positions/${row.position}`,
        body: {
          modelId: f.modelId || null,
          fallbackModelId: f.fallbackModelId || null,
          temperature: Number(f.temperature),
          maxTokens: Number(f.maxTokens),
          dailyBudgetUsd: numOrNull(f.dailyBudgetUsd),
          monthlyBudgetUsd: numOrNull(f.monthlyBudgetUsd),
        },
      })
      .then(onDone, () => undefined);
  }
  const noTools = models.find((m) => m.id === f.modelId)?.supportsTools === false;
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <ModelSelect label="Model utama" value={f.modelId} onChange={(v) => setF({ ...f, modelId: v })} models={models} />
      {noTools && <Alert tone="yellow">Model ini tidak mendukung tool calling — AI tidak bisa mengambil data campaign dan hanya menjawab umum.</Alert>}
      <ModelSelect label="Model fallback" value={f.fallbackModelId} onChange={(v) => setF({ ...f, fallbackModelId: v })} models={models.filter((m) => m.id !== f.modelId)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Temperature" hint="0 = konsisten, 2 = kreatif">
          <Input type="number" min={0} max={2} step="0.1" value={f.temperature} onChange={(e) => setF({ ...f, temperature: e.target.value })} />
        </Field>
        <Field label="Maks token jawaban">
          <Input type="number" min={64} max={32000} value={f.maxTokens} onChange={(e) => setF({ ...f, maxTokens: e.target.value })} />
        </Field>
        <Field label="Budget harian per orang (USD)" hint="Kosong = tanpa batas">
          <Input type="number" min={0} step="0.01" value={f.dailyBudgetUsd} onChange={(e) => setF({ ...f, dailyBudgetUsd: e.target.value })} />
        </Field>
        <Field label="Budget bulanan per orang (USD)">
          <Input type="number" min={0} step="0.01" value={f.monthlyBudgetUsd} onChange={(e) => setF({ ...f, monthlyBudgetUsd: e.target.value })} />
        </Field>
      </div>
      <Button type="submit" disabled={action.isPending}>
        Simpan
      </Button>
    </form>
  );
}

function Positions() {
  const rows = useOrgQuery<PositionConfigView[]>('/ai/positions');
  const models = useOrgQuery<AiModelRow[]>('/ai/models?enabled=1');
  const [edit, setEdit] = useState<PositionConfigView | null>(null);
  return (
    <Card flush title="Default AI Assistant per jabatan">
      {rows.isLoading ? (
        <div className="p-4">
          <Loading />
        </div>
      ) : (
        <Table head={['Jabatan', 'Anggota', 'Model', 'Fallback', 'Temp.', 'Maks token', 'Budget harian', 'Budget bulanan', '']} numericCols={[1, 4, 5, 6, 7]}>
          {rows.data?.map((r) => (
            <tr key={r.position}>
              <Td className="font-medium whitespace-nowrap">{r.label}</Td>
              <Td numeric>{r.members}</Td>
              <Td>{modelName(r.model) ?? <span className="text-warning">belum dipilih</span>}</Td>
              <Td className="text-muted">{modelName(r.fallback) ?? '—'}</Td>
              <Td numeric>{r.temperature}</Td>
              <Td numeric>{r.maxTokens}</Td>
              <Td numeric>{usd(r.dailyBudgetUsd)}</Td>
              <Td numeric>{usd(r.monthlyBudgetUsd)}</Td>
              <Td>
                <span className="flex justify-end">
                  <Button size="sm" variant="secondary" onClick={() => setEdit(r)}>
                    Atur
                  </Button>
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Drawer open={!!edit} title={`AI untuk ${edit?.label ?? ''}`} onClose={() => setEdit(null)}>
        {edit && <PositionForm key={edit.position} row={edit} models={models.data ?? []} onDone={() => setEdit(null)} />}
      </Drawer>
    </Card>
  );
}

function MemberForm({ row, models, onDone }: { row: MemberAiView; models: AiModelRow[]; onDone: () => void }) {
  const action = useOrgAction();
  const c = row.config;
  const [f, setF] = useState({
    aiEnabled: c?.aiEnabled ?? true,
    modelId: c?.model?.id ?? '',
    fallbackModelId: c?.fallback?.id ?? '',
    dailyBudgetUsd: c?.dailyBudgetUsd?.toString() ?? '',
    monthlyBudgetUsd: c?.monthlyBudgetUsd?.toString() ?? '',
    maxRequestsPerDay: c?.maxRequestsPerDay?.toString() ?? '',
  });
  async function submit(e: FormEvent) {
    e.preventDefault();
    await action
      .mutateAsync({
        method: 'PUT',
        path: `/ai/members/${row.id}`,
        body: {
          aiEnabled: f.aiEnabled,
          modelId: f.modelId || null,
          fallbackModelId: f.fallbackModelId || null,
          dailyBudgetUsd: numOrNull(f.dailyBudgetUsd),
          monthlyBudgetUsd: numOrNull(f.monthlyBudgetUsd),
          maxRequestsPerDay: numOrNull(f.maxRequestsPerDay),
        },
      })
      .then(onDone, () => undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <p className="text-[13px] text-muted">Kosongkan untuk mengikuti pengaturan jabatan ({row.positions.map((p) => POSITION_LABEL[p]).join(', ') || 'belum ada jabatan'}).</p>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" className="accent-[var(--primary)]" checked={f.aiEnabled} onChange={(e) => setF({ ...f, aiEnabled: e.target.checked })} />
        Boleh memakai AI Assistant
      </label>
      <ModelSelect label="Model utama" allowInherit="Ikut jabatan" value={f.modelId} onChange={(v) => setF({ ...f, modelId: v })} models={models} />
      <ModelSelect label="Model fallback" allowInherit="Ikut jabatan" value={f.fallbackModelId} onChange={(v) => setF({ ...f, fallbackModelId: v })} models={models.filter((m) => m.id !== f.modelId)} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Budget harian (USD)">
          <Input type="number" min={0} step="0.01" value={f.dailyBudgetUsd} onChange={(e) => setF({ ...f, dailyBudgetUsd: e.target.value })} placeholder="ikut jabatan" />
        </Field>
        <Field label="Budget bulanan (USD)">
          <Input type="number" min={0} step="0.01" value={f.monthlyBudgetUsd} onChange={(e) => setF({ ...f, monthlyBudgetUsd: e.target.value })} placeholder="ikut jabatan" />
        </Field>
        <Field label="Maks request/hari">
          <Input type="number" min={1} value={f.maxRequestsPerDay} onChange={(e) => setF({ ...f, maxRequestsPerDay: e.target.value })} placeholder="tanpa batas" />
        </Field>
      </div>
      <Button type="submit" disabled={action.isPending}>
        Simpan
      </Button>
    </form>
  );
}

function Members() {
  const rows = useOrgQuery<MemberAiView[]>('/ai/members');
  const models = useOrgQuery<AiModelRow[]>('/ai/models?enabled=1');
  const [edit, setEdit] = useState<MemberAiView | null>(null);
  return (
    <Card flush title="Override per karyawan">
      {rows.isLoading ? (
        <div className="p-4">
          <Loading />
        </div>
      ) : (
        <Table head={['Karyawan', 'Jabatan', 'Akses', 'Model', 'Budget harian', 'Request bulan ini', 'Biaya bulan ini', '']} numericCols={[4, 5, 6]}>
          {rows.data?.map((m) => (
            <tr key={m.id}>
              <Td className="font-medium whitespace-nowrap">{m.name}</Td>
              <Td className="text-muted">{m.positions.map((p) => POSITION_LABEL[p]).join(', ') || '—'}</Td>
              <Td>{m.config?.aiEnabled === false ? <Badge tone="red">nonaktif</Badge> : <Badge tone="green">aktif</Badge>}</Td>
              <Td>{modelName(m.config?.model ?? null) ?? <span className="text-muted">ikut jabatan</span>}</Td>
              <Td numeric>{m.config?.dailyBudgetUsd != null ? usd(m.config.dailyBudgetUsd) : <span className="text-muted">ikut jabatan</span>}</Td>
              <Td numeric>{m.monthRequests}</Td>
              <Td numeric>{usd(m.monthSpentUsd)}</Td>
              <Td>
                <span className="flex justify-end">
                  <Button size="sm" variant="secondary" onClick={() => setEdit(m)}>
                    Atur
                  </Button>
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Drawer open={!!edit} title={`AI untuk ${edit?.name ?? ''}`} onClose={() => setEdit(null)}>
        {edit && <MemberForm key={edit.id} row={edit} models={models.data ?? []} onDone={() => setEdit(null)} />}
      </Drawer>
    </Card>
  );
}

function Usage() {
  const { org } = useSession();
  const [days, setDays] = useState('30');
  const u = useOrgQuery<UsageView>(`/ai/usage?days=${days}`);
  const total = useMemo(() => (u.data?.byModel ?? []).reduce((s, m) => ({ cost: s.cost + m.costUsd, req: s.req + m.requests }), { cost: 0, req: 0 }), [u.data]);
  const maxDay = Math.max(0.000001, ...(u.data?.byDay ?? []).map((d) => d.cost));
  if (u.isLoading || !u.data) return <Loading />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Periode" className="w-36" value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="7">7 hari</option>
          <option value="30">30 hari</option>
          <option value="90">90 hari</option>
        </Select>
        <div className="grid flex-1 grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
          {[
            ['Biaya', usd(total.cost)],
            ['Request', String(total.req)],
            ['Gagal', String(u.data.byStatus.ERROR ?? 0)],
            ['Diblokir budget', String(u.data.byStatus.BLOCKED ?? 0)],
          ].map(([l, v]) => (
            <div key={l} className="bg-surface px-4 py-2.5">
              <div className="text-xs text-muted">{l}</div>
              <div className="tabular text-lg font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </div>
      <Card title="Biaya per hari">
        {u.data.byDay.length ? (
          <div className="flex h-32 items-end gap-1" role="img" aria-label="Grafik biaya AI per hari">
            {u.data.byDay.map((d) => (
              <div key={d.day} className="group relative flex-1">
                <div className="rounded-t-sm bg-primary/80 group-hover:bg-primary" style={{ height: `${Math.max(2, (d.cost / maxDay) * 120)}px` }} />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded bg-text px-1.5 py-0.5 text-[11px] whitespace-nowrap text-bg group-hover:block">
                  {d.day}: {usd(d.cost)}, {d.requests} req
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted">Belum ada pemakaian.</p>
        )}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card flush title="Per model">
          <Table head={['Model', 'Request', 'Token input', 'Token output', 'Biaya']} numericFrom={1} empty={!u.data.byModel.length}>
            {u.data.byModel.map((m) => (
              <tr key={m.modelId}>
                <Td className="font-mono text-xs">{m.modelId}</Td>
                <Td numeric>{m.requests}</Td>
                <Td numeric>{m.promptTokens.toLocaleString('id-ID')}</Td>
                <Td numeric>{m.completionTokens.toLocaleString('id-ID')}</Td>
                <Td numeric>{usd(m.costUsd)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card flush title="Gagal & diblokir terbaru">
          <Table head={['Waktu', 'Model', 'Status', 'Keterangan']} empty={!u.data.recentErrors.length} emptyText="Tidak ada kegagalan.">
            {u.data.recentErrors.map((e, i) => (
              <tr key={i}>
                <Td className="whitespace-nowrap">{dateTime(e.createdAt, org.timezone)}</Td>
                <Td className="font-mono text-xs">{e.modelId}</Td>
                <Td>{e.status === 'BLOCKED' ? <Badge tone="yellow">budget</Badge> : <Badge tone="red">gagal</Badge>}</Td>
                <Td className="max-w-xs truncate text-xs text-muted">{e.error}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}

export default function AiSettingsPage() {
  const [tab, setTab] = useState<Tab>('general');
  return (
    <RequirePermission permission="ai.manage">
      <PageHeader title="Pengaturan AI" description="Koneksi OpenRouter, model yang diizinkan, AI Assistant per jabatan, override per karyawan, dan biaya pemakaian." />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium whitespace-nowrap', tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-text')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'general' && <General />}
      {tab === 'models' && <Models />}
      {tab === 'positions' && <Positions />}
      {tab === 'members' && <Members />}
      {tab === 'usage' && <Usage />}
    </RequirePermission>
  );
}
