'use client';

import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Button, Card, cn, Drawer, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { RISK_LABEL, SkillDetail, SkillRow, TOOL_LABEL } from '@/lib/ai';
import { dateTime } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Person, Position, POSITION_LABEL } from '@/lib/tasks';

const POSITIONS = Object.keys(POSITION_LABEL) as Position[];
const ALL_TOOLS = Object.keys(TOOL_LABEL);
const TEXTAREA = 'w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 font-mono text-[12px] leading-relaxed focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft';
const TEMPLATE = `---
name: nama-skill
description: Jelaskan kapan skill ini dipakai (min. 10 karakter)
---

## Langkah
1. …

## Batasan
- …
`;

const REVIEW_BADGE = { PENDING_REVIEW: { tone: 'yellow', label: 'menunggu review' }, APPROVED: { tone: 'green', label: 'disetujui' }, REJECTED: { tone: 'red', label: 'ditolak' } } as const;
const SOURCE_LABEL = { BUILTIN: 'Bawaan', CUSTOM: 'Buatan tim', IMPORTED: 'Impor' } as const;

function Chips<T extends string>({ all, value, onChange, label }: { all: T[]; value: T[]; onChange: (v: T[]) => void; label: (v: T) => string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((k) => {
        const on = value.includes(k);
        return (
          <button key={k} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])} className={cn('rounded-full border px-2.5 py-1 text-xs', on ? 'border-primary bg-primary-soft text-primary' : 'border-border-strong text-muted hover:text-text')}>
            {label(k)}
          </button>
        );
      })}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const action = useOrgAction();
  const [f, setF] = useState({ skillMd: TEMPLATE, category: '', positions: [] as Position[], tools: [] as string[], riskClass: 'READ_ONLY', source: 'CUSTOM' });
  async function submit(e: FormEvent) {
    e.preventDefault();
    await action.mutateAsync({ method: 'POST', path: '/ai/skills', body: f }).then(onDone, () => undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <Alert tone="blue">Skill baru selalu menunggu review sebelum dipakai AI. Skill dari luar (repository/rujukan) pilih sumber &quot;Impor&quot;: wajib disetujui admin lain dengan catatan review. Script instalasi tidak pernah dijalankan.</Alert>
      <Field label="Sumber">
        <Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          <option value="CUSTOM">Ditulis tim sendiri</option>
          <option value="IMPORTED">Impor dari luar (untrusted)</option>
        </Select>
      </Field>
      <Field label="SKILL.md" hint="Frontmatter name (huruf kecil-tanda-hubung) & description, lalu instruksi.">
        <textarea required rows={14} className={TEXTAREA} value={f.skillMd} onChange={(e) => setF({ ...f, skillMd: e.target.value })} spellCheck={false} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kategori">
          <Input required minLength={2} maxLength={40} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="mis. media buying" />
        </Field>
        <Field label="Risiko">
          <Select value={f.riskClass} onChange={(e) => setF({ ...f, riskClass: e.target.value })}>
            <option value="READ_ONLY">Baca saja</option>
            <option value="DRAFT">Membuat draft</option>
          </Select>
        </Field>
      </div>
      <Field label="Jabatan">
        <Chips all={POSITIONS} value={f.positions} onChange={(v) => setF({ ...f, positions: v })} label={(p) => POSITION_LABEL[p]} />
      </Field>
      <Field label="Tool yang boleh dipakai">
        <Chips all={ALL_TOOLS} value={f.tools} onChange={(v) => setF({ ...f, tools: v })} label={(t) => TOOL_LABEL[t]} />
      </Field>
      <Button type="submit" disabled={action.isPending}>
        Simpan untuk direview
      </Button>
    </form>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const { can, org } = useSession();
  const manage = can('ai.manage');
  const q = useOrgQuery<SkillDetail>(`/ai/skills/${id}`);
  const people = useOrgQuery<Person[]>(manage ? '/people' : null);
  const action = useOrgAction();
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [changelog, setChangelog] = useState('');
  const [assignee, setAssignee] = useState('');
  if (q.isLoading || !q.data) return <Loading rows={8} />;
  const s = q.data;
  const active = s.versions.find((v) => v.id === s.activeVersionId);
  const run = (method: 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown) => action.mutateAsync({ method, path, body }).then(() => q.refetch(), () => undefined);

  return (
    <div className="space-y-5">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={RISK_LABEL[s.riskClass].tone}>{RISK_LABEL[s.riskClass].label}</Badge>
          <Badge>{SOURCE_LABEL[s.source]}</Badge>
          {!s.enabled && <Badge tone="red">nonaktif</Badge>}
          <span className="font-mono text-xs text-muted">{s.key}</span>
        </div>
        <p className="mt-2 text-[13px]">{s.description}</p>
        <p className="mt-2 text-xs text-muted">
          Jabatan: {s.positions.map((p) => POSITION_LABEL[p]).join(', ') || '—'}. Tool: {s.tools.map((t) => TOOL_LABEL[t] ?? t).join(', ') || 'tidak ada'}.
        </p>
        {manage && (
          <Button className="mt-2" size="sm" variant="secondary" onClick={() => run('PATCH', `/ai/skills/${s.id}`, { enabled: !s.enabled })}>
            {s.enabled ? 'Nonaktifkan skill' : 'Aktifkan skill'}
          </Button>
        )}
      </div>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold">Versi</h3>
        <ul className="space-y-3">
          {s.versions.map((v) => (
            <li key={v.id} className="rounded-md border border-border">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[13px]">
                <span className="font-semibold">v{v.version}</span>
                <Badge tone={REVIEW_BADGE[v.review].tone}>{REVIEW_BADGE[v.review].label}</Badge>
                {v.id === s.activeVersionId && <Badge tone="blue">dipakai AI</Badge>}
                <span className="ml-auto text-xs text-muted">{dateTime(v.createdAt, org.timezone)}</span>
              </div>
              <details open={v.review === 'PENDING_REVIEW'}>
                <summary className="cursor-pointer px-3 py-1.5 text-xs text-muted">{v.changelog ?? 'Lihat isi'}</summary>
                <pre className="max-h-80 overflow-auto border-t border-border bg-surface-2/60 px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">{v.skillMd}</pre>
              </details>
              {v.reviewNote && <p className="border-t border-border px-3 py-1.5 text-xs text-muted">Catatan review: {v.reviewNote}</p>}
              {manage && v.review === 'PENDING_REVIEW' && (
                <div className="space-y-2 border-t border-border p-3">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={s.source === 'IMPORTED' ? 'Catatan review (wajib untuk skill impor)' : 'Catatan review (opsional)'} />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={action.isPending} onClick={() => run('POST', `/ai/skill-versions/${v.id}/review`, { decision: 'APPROVE', ...(note ? { note } : {}) }).then(() => setNote(''))}>
                      Setujui & pakai
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger hover:text-danger" disabled={action.isPending} onClick={() => run('POST', `/ai/skill-versions/${v.id}/review`, { decision: 'REJECT', ...(note ? { note } : {}) }).then(() => setNote(''))}>
                      Tolak
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {manage && (
        <section>
          <h3 className="mb-2 text-[13px] font-semibold">Versi baru</h3>
          {draft === null ? (
            <Button size="sm" variant="secondary" onClick={() => setDraft(active?.skillMd ?? s.versions[0]?.skillMd ?? '')}>
              Buat versi baru dari versi aktif
            </Button>
          ) : (
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                await run('POST', `/ai/skills/${s.id}/versions`, { skillMd: draft, ...(changelog ? { changelog } : {}) });
                setDraft(null);
                setChangelog('');
              }}
            >
              <textarea rows={12} className={TEXTAREA} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
              <Input value={changelog} onChange={(e) => setChangelog(e.target.value)} placeholder="Apa yang berubah?" maxLength={1000} />
              <div className="flex gap-2">
                <Button size="sm" type="submit" disabled={action.isPending}>
                  Simpan untuk direview
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  Batal
                </Button>
              </div>
            </form>
          )}
        </section>
      )}

      {manage && (
        <section>
          <h3 className="mb-1 text-[13px] font-semibold">Override per karyawan</h3>
          <p className="mb-2 text-xs text-muted">Aktifkan untuk karyawan di luar jabatannya, atau nonaktifkan untuk karyawan tertentu.</p>
          <ul className="mb-2 space-y-1 text-[13px]">
            {s.assignments.map((a) => (
              <li key={a.membershipId} className="flex items-center gap-2">
                <span className="flex-1">{a.name}</span>
                <Badge tone={a.enabled ? 'green' : 'red'}>{a.enabled ? 'diaktifkan' : 'dinonaktifkan'}</Badge>
                <Button size="sm" variant="ghost" onClick={() => run('PUT', `/ai/skills/${s.id}/assignments/${a.membershipId}`, { enabled: null })}>
                  Ikut jabatan
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Select aria-label="Karyawan" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Pilih karyawan…</option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <Button variant="secondary" disabled={!assignee} onClick={() => run('PUT', `/ai/skills/${s.id}/assignments/${assignee}`, { enabled: true })}>
              Aktifkan
            </Button>
            <Button variant="ghost" disabled={!assignee} onClick={() => run('PUT', `/ai/skills/${s.id}/assignments/${assignee}`, { enabled: false })}>
              Nonaktifkan
            </Button>
          </div>
        </section>
      )}
      <Button variant="ghost" size="sm" onClick={onClose}>
        Tutup
      </Button>
    </div>
  );
}

export default function SkillsPage() {
  const { can } = useSession();
  const skills = useOrgQuery<SkillRow[]>('/ai/skills');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const pending = skills.data?.filter((s) => s.latestVersion?.review === 'PENDING_REVIEW').length ?? 0;
  return (
    <RequirePermission permission="ai.use">
      <PageHeader
        title="Skill Library"
        description="Instruksi kerja AI Assistant per jabatan (SKILL.md berversi). Versi baru dipakai setelah direview."
        actions={can('ai.manage') && <Button onClick={() => setCreating(true)}>+ Skill</Button>}
      />
      {pending > 0 && can('ai.manage') && (
        <div className="mb-4">
          <Alert tone="yellow">{pending} skill punya versi yang menunggu review.</Alert>
        </div>
      )}
      <Card flush>
        {skills.isLoading ? (
          <div className="p-4">
            <Loading />
          </div>
        ) : (
          <Table head={['Skill', 'Jabatan', 'Risiko', 'Sumber', 'Versi aktif', 'Status', '']}>
            {skills.data?.map((s) => (
              <tr key={s.id} className="cursor-pointer hover:bg-surface-2" onClick={() => setOpen(s.id)}>
                <Td>
                  <button type="button" className="text-left font-medium hover:text-primary" onClick={() => setOpen(s.id)}>
                    {s.name}
                  </button>
                  <div className="max-w-md truncate text-xs text-muted">{s.description}</div>
                </Td>
                <Td className="text-muted">{s.positions.map((p) => POSITION_LABEL[p]).join(', ') || '—'}</Td>
                <Td>
                  <Badge tone={RISK_LABEL[s.riskClass].tone}>{RISK_LABEL[s.riskClass].label}</Badge>
                </Td>
                <Td className="text-muted">{SOURCE_LABEL[s.source]}</Td>
                <Td className="tabular">{s.activeVersion ? `v${s.activeVersion.version}` : <span className="text-muted">—</span>}</Td>
                <Td>
                  {!s.enabled ? (
                    <Badge tone="red">nonaktif</Badge>
                  ) : s.latestVersion?.review === 'PENDING_REVIEW' ? (
                    <Badge tone="yellow">v{s.latestVersion.version} menunggu review</Badge>
                  ) : s.activeVersion ? (
                    <Badge tone="green">aktif</Badge>
                  ) : (
                    <Badge>belum ada versi disetujui</Badge>
                  )}
                </Td>
                <Td className="text-xs text-muted">{s.overrides ? `${s.overrides} override` : ''}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Drawer open={!!open} wide title="Detail skill" onClose={() => setOpen(null)}>
        {open && <Detail key={open} id={open} onClose={() => setOpen(null)} />}
      </Drawer>
      <Drawer open={creating} wide title="Skill baru" onClose={() => setCreating(false)}>
        {creating && <CreateForm onDone={() => setCreating(false)} />}
      </Drawer>
    </RequirePermission>
  );
}
