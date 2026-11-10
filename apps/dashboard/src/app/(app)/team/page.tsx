'use client';

import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Button, Card, Drawer, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { compact, useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Campaign, Member, RoleDef } from '@/lib/types';

function AddMember({ roles, onDone }: { roles: RoleDef[]; onDone: () => void }) {
  const action = useOrgAction();
  const [f, setF] = useState({ email: '', name: '', password: '', roleKey: 'MEDIA_BUYER', dataScope: 'ASSIGNED' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    await action.mutateAsync({ method: 'POST', path: '/organizations/current/members', body: compact(f) }).then(onDone, () => undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <Field label="Email">
        <Input type="email" required value={f.email} onChange={set('email')} />
      </Field>
      <Field label="Nama">
        <Input required minLength={2} value={f.name} onChange={set('name')} />
      </Field>
      <Field label="Password awal" hint="Wajib untuk user baru: min. 12 karakter, 3 dari huruf kecil/besar/angka/simbol. Sampaikan lewat kanal aman; minta karyawan menggantinya.">
        <Input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} />
      </Field>
      <Field label="Role">
        <Select value={f.roleKey} onChange={set('roleKey')}>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Cakupan data" hint="Assigned = hanya campaign yang ditugaskan.">
        <Select value={f.dataScope} onChange={set('dataScope')}>
          <option value="ASSIGNED">Hanya yang di-assign</option>
          <option value="ALL">Semua data organisasi</option>
        </Select>
      </Field>
      <Button type="submit" disabled={action.isPending}>
        Tambah anggota
      </Button>
    </form>
  );
}

function EditMember({ member, roles, campaigns, onDone }: { member: Member; roles: RoleDef[]; campaigns: Campaign[]; onDone: () => void }) {
  const action = useOrgAction();
  const [roleKey, setRoleKey] = useState(member.role.key);
  const [dataScope, setDataScope] = useState(member.dataScope);
  const [status, setStatus] = useState(member.status);
  const [assigned, setAssigned] = useState<Set<string>>(new Set(member.campaignIds));
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    setMsg(null);
    try {
      await action.mutateAsync({ method: 'PATCH', path: `/organizations/current/members/${member.id}`, body: { roleKey, dataScope, status } });
      if (dataScope === 'ASSIGNED') {
        await action.mutateAsync({ method: 'PUT', path: `/organizations/current/members/${member.id}/campaigns`, body: { campaignIds: [...assigned] } });
      }
      setMsg('Tersimpan.');
    } catch {
      /* error ditampilkan dari action.error */
    }
  }

  return (
    <div className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      {msg && <Alert tone="green">{msg}</Alert>}
      <p className="text-sm">
        <b>{member.user.name}</b>
        <span className="block text-muted">{member.user.email}</span>
      </p>
      <Field label="Role">
        <Select value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Cakupan data">
        <Select value={dataScope} onChange={(e) => setDataScope(e.target.value as Member['dataScope'])}>
          <option value="ASSIGNED">Hanya yang di-assign</option>
          <option value="ALL">Semua data organisasi</option>
        </Select>
      </Field>
      <Field label="Status">
        <Select value={status} onChange={(e) => setStatus(e.target.value as Member['status'])}>
          <option value="ACTIVE">Aktif</option>
          <option value="DISABLED">Nonaktif</option>
        </Select>
      </Field>
      {dataScope === 'ASSIGNED' && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Campaign yang di-assign ({assigned.size})</legend>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {campaigns.length === 0 && <p className="text-sm text-muted">Belum ada campaign.</p>}
            {campaigns.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={assigned.has(c.id)}
                  onChange={(e) => {
                    const next = new Set(assigned);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    setAssigned(next);
                  }}
                />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="flex gap-2">
        <Button onClick={save} disabled={action.isPending}>
          Simpan
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Tutup
        </Button>
      </div>
    </div>
  );
}

export default function TeamPage() {
  const { can, me } = useSession();
  const members = useOrgQuery<Member[]>('/organizations/current/members');
  const roles = useOrgQuery<RoleDef[]>('/organizations/current/roles');
  const campaigns = useOrgQuery<Campaign[]>(can('campaigns.read') ? '/campaigns' : null);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const editing = members.data?.find((m) => m.id === editId);
  const manage = can('members.manage');

  return (
    <RequirePermission permission="members.read">
      <PageHeader
        title="Tim & Akses"
        description="Role menentukan apa yang boleh dilakukan; cakupan data menentukan campaign mana yang terlihat."
        actions={manage && <Button onClick={() => setAdding(true)}>+ Anggota</Button>}
      />
      <Card>
        {members.error && <Alert>{errorMessage(members.error)}</Alert>}
        {members.isLoading ? (
          <Loading />
        ) : (
          <Table head={['Nama', 'Role', 'Cakupan', 'MFA', 'Login terakhir', 'Status', '']} empty={!members.data?.length}>
            {members.data?.map((m) => (
              <tr key={m.id}>
                <Td>
                  <div className="font-medium">{m.user.name}</div>
                  <div className="text-xs text-muted">{m.user.email}</div>
                </Td>
                <Td>{m.role.name}</Td>
                <Td>{m.dataScope === 'ALL' ? 'Semua' : `${m.campaignIds.length} campaign`}</Td>
                <Td>{m.user.mfaEnabled ? <Badge tone="green">aktif</Badge> : <Badge>off</Badge>}</Td>
                <Td>{dateTime(m.user.lastLoginAt)}</Td>
                <Td>
                  <StatusBadge status={m.status} />
                </Td>
                <Td>
                  {manage && m.user.id !== me.id && (
                    <Button size="sm" variant="secondary" onClick={() => setEditId(m.id)}>
                      Atur
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {roles.data && (
        <Card title="Role & izin" className="mt-5">
          <div className="grid gap-3 md:grid-cols-2">
            {roles.data.map((r) => (
              <div key={r.key} className="rounded-md border border-border p-3">
                <p className="font-medium">{r.name}</p>
                <p className="text-xs text-muted">{r.description}</p>
                <p className="mt-2 flex flex-wrap gap-1">
                  {r.permissions.map((p) => (
                    <Badge key={p}>{p}</Badge>
                  ))}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Drawer open={adding} title="Anggota baru" onClose={() => setAdding(false)}>
        {roles.data && <AddMember roles={roles.data} onDone={() => setAdding(false)} />}
      </Drawer>
      <Drawer open={!!editing} title="Atur anggota" onClose={() => setEditId(null)}>
        {editing && roles.data && <EditMember key={editing.id} member={editing} roles={roles.data} campaigns={campaigns.data ?? []} onDone={() => setEditId(null)} />}
      </Drawer>
    </RequirePermission>
  );
}
