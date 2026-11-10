'use client';

import { FormEvent, useEffect, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Button, Card, Field, Input, Loading, PageHeader } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
}

function OrgSettings() {
  const { can, refresh } = useSession();
  const org = useOrgQuery<OrgDetail>('/organizations/current');
  const action = useOrgAction();
  const [f, setF] = useState({ name: '', timezone: '', currency: '' });
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (org.data) setF({ name: org.data.name, timezone: org.data.timezone, currency: org.data.currency });
  }, [org.data]);
  if (!org.data) return <Loading />;
  const manage = can('org.manage');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setOk(false);
    await action.mutateAsync({ method: 'PATCH', path: '/organizations/current', body: f }).then(async () => {
      setOk(true);
      await refresh();
    }, () => undefined);
  }
  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      {ok && <Alert tone="green">Tersimpan.</Alert>}
      <Field label="Nama organisasi">
        <Input disabled={!manage} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="Zona waktu laporan" hint="Nama IANA, mis. Asia/Jakarta">
        <Input disabled={!manage} required value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />
      </Field>
      <Field label="Mata uang dasar" hint="Revenue & spend dihitung dalam mata uang ini">
        <Input disabled={!manage} required pattern="[A-Z]{3}" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
      </Field>
      {manage && (
        <Button type="submit" disabled={action.isPending}>
          Simpan
        </Button>
      )}
    </form>
  );
}

function ChangePassword() {
  const [f, setF] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    try {
      await api('/auth/password', { method: 'POST', body: f, org: false });
      setOk(true);
      setF({ currentPassword: '', newPassword: '' });
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      {error && <Alert>{error}</Alert>}
      {ok && <Alert tone="green">Password diganti. Sesi di perangkat lain telah dikeluarkan.</Alert>}
      <Field label="Password saat ini">
        <Input type="password" autoComplete="current-password" required value={f.currentPassword} onChange={(e) => setF({ ...f, currentPassword: e.target.value })} />
      </Field>
      <Field label="Password baru" hint="Min. 12 karakter, 3 dari: huruf kecil, huruf besar, angka, simbol">
        <Input type="password" autoComplete="new-password" required minLength={12} value={f.newPassword} onChange={(e) => setF({ ...f, newPassword: e.target.value })} />
      </Field>
      <Button type="submit">Ganti password</Button>
    </form>
  );
}

export default function SettingsPage() {
  const { me } = useSession();
  return (
    <RequirePermission permission="org.read">
      <PageHeader title="Pengaturan" />
      <div className="space-y-5">
        <Card title="Organisasi">
          <OrgSettings />
        </Card>
        <Card title="Akun saya">
          <p className="mb-4 text-sm text-muted">
            {me.email}. Verifikasi 2 langkah {me.mfaEnabled ? 'aktif' : 'tidak aktif'}.
          </p>
          <ChangePassword />
        </Card>
      </div>
    </RequirePermission>
  );
}
