'use client';

import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Avatar } from '@/components/kanban';
import { Alert, Badge, Button, Card, Drawer, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Person, Position, POSITION_LABEL, TeamItem } from '@/lib/tasks';

const ALL_POSITIONS = Object.keys(POSITION_LABEL) as Position[];

function PositionsForm({ person, onDone }: { person: Person; onDone: () => void }) {
  const action = useOrgAction();
  const [sel, setSel] = useState<Position[]>(person.positions);
  const [primary, setPrimary] = useState<Position | ''>(person.primaryPosition ?? '');
  const positions = useOrgQuery<{ key: Position; label: string; focus: string }[]>('/positions');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = primary && sel.includes(primary) ? primary : (sel[0] ?? null);
    await action.mutateAsync({ method: 'PUT', path: `/people/${person.id}/positions`, body: { positions: sel, primary: p } }).then(onDone, () => undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <p className="text-[13px] text-muted">Jabatan menentukan fokus kerja dan (nanti) AI Assistant yang tersedia. Hak akses tetap diatur lewat role di halaman Tim & akses.</p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {(positions.data ?? ALL_POSITIONS.map((k) => ({ key: k, label: POSITION_LABEL[k], focus: '' }))).map((p) => (
          <li key={p.key} className="flex items-start gap-3 px-3 py-2.5">
            <input
              id={`pos-${p.key}`}
              type="checkbox"
              className="mt-0.5 accent-[var(--primary)]"
              checked={sel.includes(p.key)}
              onChange={(e) => setSel(e.target.checked ? [...sel, p.key] : sel.filter((x) => x !== p.key))}
            />
            <label htmlFor={`pos-${p.key}`} className="flex-1 cursor-pointer">
              <span className="block text-[13px] font-medium">{p.label}</span>
              {p.focus && <span className="block text-xs text-muted">{p.focus}</span>}
            </label>
            {sel.includes(p.key) && (
              <label className="flex items-center gap-1 text-xs text-muted">
                <input type="radio" name="primary" checked={primary === p.key || (!primary && sel[0] === p.key)} onChange={() => setPrimary(p.key)} className="accent-[var(--primary)]" />
                utama
              </label>
            )}
          </li>
        ))}
      </ul>
      <Button type="submit" disabled={action.isPending}>
        Simpan jabatan
      </Button>
    </form>
  );
}

function TeamForm({ team, people, onDone }: { team: TeamItem | null; people: Person[]; onDone: () => void }) {
  const action = useOrgAction<{ id: string }>();
  const [f, setF] = useState({ name: team?.name ?? '', description: team?.description ?? '', leadMembershipId: team?.lead?.id ?? '' });
  const [members, setMembers] = useState<string[]>(team?.members.map((m) => m.id) ?? []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const body = { name: f.name.trim(), description: f.description.trim() || (team ? null : undefined), leadMembershipId: f.leadMembershipId || (team ? null : undefined) };
      const saved = team ? (await action.mutateAsync({ method: 'PATCH', path: `/teams/${team.id}`, body }), team) : await action.mutateAsync({ method: 'POST', path: '/teams', body });
      await action.mutateAsync({ method: 'PUT', path: `/teams/${saved.id}/members`, body: { membershipIds: members } });
      onDone();
    } catch {
      /* ditampilkan lewat action.error */
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <Field label="Nama tim">
        <Input required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="mis. Tim Push ID" />
      </Field>
      <Field label="Deskripsi" hint="Opsional">
        <Input maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
      <Field label="Ketua tim" hint="Otomatis menjadi anggota.">
        <Select value={f.leadMembershipId} onChange={(e) => setF({ ...f, leadMembershipId: e.target.value })}>
          <option value="">Belum ada</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-1 text-[13px] font-medium">Anggota</legend>
        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          {people.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-2">
              <input type="checkbox" className="accent-[var(--primary)]" checked={members.includes(p.id) || p.id === f.leadMembershipId} disabled={p.id === f.leadMembershipId} onChange={(e) => setMembers(e.target.checked ? [...members, p.id] : members.filter((x) => x !== p.id))} />
              {p.name}
              <span className="ml-auto text-xs text-muted">{p.primaryPosition ? POSITION_LABEL[p.primaryPosition] : p.role.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" disabled={action.isPending}>
        {team ? 'Simpan' : 'Buat tim'}
      </Button>
    </form>
  );
}

export default function TeamsPage() {
  const { can } = useSession();
  const people = useOrgQuery<Person[]>('/people');
  const teams = useOrgQuery<TeamItem[]>('/teams');
  const action = useOrgAction();
  const manage = can('teams.manage');
  const [editPerson, setEditPerson] = useState<Person | null>(null);
  const [editTeam, setEditTeam] = useState<TeamItem | 'new' | null>(null);

  const byPosition = ALL_POSITIONS.map((p) => ({ p, n: people.data?.filter((x) => x.positions.includes(p)).length ?? 0 }));

  return (
    <RequirePermission permission="tasks.read">
      <PageHeader title="Tim kerja" description="Jabatan dan pembagian tim. Incident card otomatis diberikan ke anggota berjabatan Tracking Specialist." actions={manage && <Button onClick={() => setEditTeam('new')}>+ Tim</Button>} />
      <div className="space-y-5">
        {people.data && !people.data.some((p) => p.positions.includes('TRACKING_SPECIALIST')) && (
          <Alert tone="yellow">Belum ada anggota berjabatan Tracking Specialist, sehingga incident card dari alert dibuat tanpa owner.</Alert>
        )}
        <Card title="Tim" flush>
          {teams.isLoading ? (
            <div className="p-4">
              <Loading />
            </div>
          ) : (
            <Table head={['Tim', 'Ketua', 'Anggota', 'Board', '']} numericCols={[3]} empty={!teams.data?.length} emptyText="Belum ada tim.">
              {teams.data?.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <div className="font-medium">{t.name}</div>
                    {t.description && <div className="text-xs text-muted">{t.description}</div>}
                  </Td>
                  <Td className="whitespace-nowrap">{t.lead?.name ?? <span className="text-muted">—</span>}</Td>
                  <Td>
                    <span className="flex items-center gap-2">
                      <span className="flex -space-x-1.5">
                        {t.members.slice(0, 6).map((m) => (
                          <Avatar key={m.id} name={m.name} />
                        ))}
                      </span>
                      <span className="tabular text-xs text-muted">{t.members.length}</span>
                    </span>
                  </Td>
                  <Td numeric>{t.boards}</Td>
                  <Td>
                    {manage && (
                      <span className="flex justify-end gap-1">
                        <Button size="sm" variant="secondary" onClick={() => setEditTeam(t)}>
                          Ubah
                        </Button>
                        <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => window.confirm(`Hapus tim ${t.name}? Board & kartu tetap ada.`) && action.mutate({ method: 'DELETE', path: `/teams/${t.id}` })}>
                          Hapus
                        </Button>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Jabatan anggota" flush actions={<span className="hidden text-xs text-muted md:inline">{byPosition.filter((x) => x.n).map((x) => `${POSITION_LABEL[x.p]} ${x.n}`).join(', ') || 'Belum ada jabatan'}</span>}>
          {people.isLoading ? (
            <div className="p-4">
              <Loading />
            </div>
          ) : (
            <Table head={['Anggota', 'Role (hak akses)', 'Jabatan', 'Tim', '']}>
              {people.data?.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <span className="inline-flex items-center gap-2 font-medium">
                      <Avatar name={p.name} />
                      {p.name}
                      {p.isMe && <span className="text-xs font-normal text-muted">(saya)</span>}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{p.role.name}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {p.positions.length ? (
                        p.positions.map((pos) => (
                          <Badge key={pos} tone={pos === p.primaryPosition ? 'blue' : 'gray'}>
                            {POSITION_LABEL[pos]}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </span>
                  </Td>
                  <Td className="text-muted">{p.teams.map((t) => t.name).join(', ') || '—'}</Td>
                  <Td>
                    {manage && (
                      <span className="flex justify-end">
                        <Button size="sm" variant="secondary" onClick={() => setEditPerson(p)}>
                          Atur jabatan
                        </Button>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Drawer open={!!editPerson} title={`Jabatan ${editPerson?.name ?? ''}`} onClose={() => setEditPerson(null)}>
        {editPerson && <PositionsForm key={editPerson.id} person={editPerson} onDone={() => setEditPerson(null)} />}
      </Drawer>
      <Drawer open={!!editTeam} title={editTeam === 'new' ? 'Tim baru' : `Ubah ${editTeam?.name ?? ''}`} onClose={() => setEditTeam(null)}>
        {editTeam && <TeamForm key={editTeam === 'new' ? 'new' : editTeam.id} team={editTeam === 'new' ? null : editTeam} people={people.data ?? []} onDone={() => setEditTeam(null)} />}
      </Drawer>
    </RequirePermission>
  );
}
