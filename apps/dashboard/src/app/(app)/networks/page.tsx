'use client';

import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { NetworkIntegration, SyncBadge } from '@/components/network-integration';
import { Alert, Badge, Button, Card, Drawer, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { label, NETWORKS, NetworkAccount } from '@/lib/types';

const PLACEHOLDERS = ['{external_click_id}', '{payout}', '{currency}', '{goal}', '{transaction_id}', '{conversion_id}', '{click_id}'];
const MAPPING_FIELDS: Array<[string, string]> = [
  ['externalClickId', 'Click ID jaringan'],
  ['zoneId', 'Zone ID'],
  ['subId', 'Sub ID'],
  ['creativeId', 'Creative ID'],
  ['feedId', 'Feed ID'],
  ['cost', 'Biaya per klik'],
  ['country', 'Negara (ISO-2)'],
];

function CreateNetwork({ onDone }: { onDone: () => void }) {
  const action = useOrgAction();
  const [network, setNetwork] = useState('ROLLERADS');
  const [name, setName] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    await action.mutateAsync({ method: 'POST', path: '/network-accounts', body: { network, name } }).then(onDone, () => undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <Field label="Jaringan">
        <Select value={network} onChange={(e) => setNetwork(e.target.value)}>
          {NETWORKS.map((n) => (
            <option key={n} value={n}>
              {label(n)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Nama akun" hint="mis. 'RollerAds — akun utama'">
        <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Alert tone="blue">Akun baru selalu dalam test mode: postback dicatat tetapi tidak dikirim sampai Anda mematikan test mode.</Alert>
      <Button type="submit" disabled={action.isPending}>
        Simpan
      </Button>
    </form>
  );
}

function ConfigureNetwork({ account, onDone }: { account: NetworkAccount; onDone: () => void }) {
  const { can } = useSession();
  const action = useOrgAction();
  const [template, setTemplate] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>(account.paramMapping ?? {});
  const [pattern, setPattern] = useState(account.postbackSuccessPattern ?? '');
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (path: string, method: 'PUT' | 'PATCH', body: unknown, ok: string) => {
    setMsg(null);
    await action.mutateAsync({ method, path, body }).then(() => setMsg(ok), () => undefined);
  };

  return (
    <div className="space-y-6">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      {msg && <Alert tone="green">{msg}</Alert>}

      <section className="space-y-3">
        <h3 className="font-semibold">Integrasi API (spend & statistik)</h3>
        <NetworkIntegration account={account} />
      </section>

      {can('networks.credentials') && (
        <section className="space-y-3">
          <h3 className="font-semibold">Template postback keluar</h3>
          <p className="text-sm text-muted">
            Salin URL postback dari dashboard jaringan iklan, lalu ganti macro click ID jaringan dengan <code>{'{external_click_id}'}</code>. Disimpan terenkripsi dan tidak akan ditampilkan lagi.
          </p>
          <p className="text-xs text-muted">Placeholder: {PLACEHOLDERS.join(' ')}</p>
          <p className="text-sm">
            Status: {account.postbackConfigured ? <Badge tone="green">terpasang ({account.credentials?.find((c) => c.kind === 'POSTBACK_TEMPLATE')?.hint})</Badge> : <Badge tone="yellow">belum</Badge>}
          </p>
          <Input placeholder="https://…/conversion?click_id={external_click_id}" value={template} onChange={(e) => setTemplate(e.target.value)} />
          <Button
            size="sm"
            disabled={!template || action.isPending}
            onClick={() => run(`/network-accounts/${account.id}/postback-template`, 'PUT', { template }, 'Template postback disimpan.').then(() => setTemplate(''))}
          >
            Simpan template
          </Button>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="font-semibold">Mode pengiriman</h3>
        {account.testMode ? (
          <>
            <Alert tone="yellow">Test mode aktif: postback TIDAK dikirim ke jaringan.</Alert>
            <Button
              size="sm"
              variant="danger"
              disabled={!account.postbackConfigured || action.isPending}
              onClick={() => {
                if (confirm('Matikan test mode? Konversi VERIFIED akan benar-benar dikirim ke jaringan iklan.')) {
                  void run(`/network-accounts/${account.id}`, 'PATCH', { testMode: false }, 'Test mode dimatikan. Postback kini dikirim ke jaringan.');
                }
              }}
            >
              Matikan test mode (go live)
            </Button>
            {!account.postbackConfigured && <p className="text-xs text-muted">Isi template postback terlebih dahulu.</p>}
          </>
        ) : (
          <>
            <Alert tone="green">Live: postback dikirim ke jaringan.</Alert>
            <Button size="sm" variant="secondary" onClick={() => run(`/network-accounts/${account.id}`, 'PATCH', { testMode: true }, 'Test mode diaktifkan.')}>
              Aktifkan test mode
            </Button>
          </>
        )}
        <Field label="Pola respons sukses (regex, opsional)" hint="HTTP 200 belum tentu berarti konversi diterima. Isi pola yang menandakan diterima, mis. ok|success.">
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} />
        </Field>
        <Button size="sm" variant="secondary" onClick={() => run(`/network-accounts/${account.id}`, 'PATCH', { postbackSuccessPattern: pattern || null }, 'Pola disimpan.')}>
          Simpan pola
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Nama parameter tracking link</h3>
        <p className="text-sm text-muted">Nama parameter di tracking link untuk tiap data. Nilainya diisi macro jaringan (lihat dokumentasi resmi jaringan).</p>
        <div className="grid grid-cols-2 gap-3">
          {MAPPING_FIELDS.map(([k, l]) => (
            <Field key={k} label={l}>
              <Input value={mapping[k] ?? ''} onChange={(e) => setMapping({ ...mapping, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => run(`/network-accounts/${account.id}`, 'PATCH', { paramMapping: mapping }, 'Nama parameter disimpan.')}>
          Simpan parameter
        </Button>
      </section>
      <Button variant="ghost" onClick={onDone}>
        Selesai
      </Button>
    </div>
  );
}

export default function NetworksPage() {
  const { can } = useSession();
  const accounts = useOrgQuery<NetworkAccount[]>('/network-accounts');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = accounts.data?.find((a) => a.id === editingId) ?? null;

  return (
    <RequirePermission permission="networks.read">
      <PageHeader
        title="Jaringan Iklan"
        description="Akun traffic source (RollerAds, Clickadu, dll.) dan pengaturan postback keluar."
        actions={can('networks.manage') && <Button onClick={() => setCreating(true)}>+ Akun jaringan</Button>}
      />
      <Card>
        {accounts.error && <Alert>{errorMessage(accounts.error)}</Alert>}
        {accounts.isLoading ? (
          <Loading />
        ) : (
          <Table head={['Nama', 'Jaringan', 'API & sinkronisasi', 'Template postback', 'Mode', 'Status', '']} empty={!accounts.data?.length}>
            {accounts.data?.map((a) => (
              <tr key={a.id}>
                <Td className="font-medium">{a.name}</Td>
                <Td>{label(a.network)}</Td>
                <Td>{a.apiConfigured ? <SyncBadge status={a.lastSyncStatus} /> : <Badge>manual</Badge>}</Td>
                <Td>{a.postbackConfigured ? <Badge tone="green">terpasang</Badge> : <Badge tone="yellow">belum</Badge>}</Td>
                <Td>{a.testMode ? <Badge tone="yellow">test</Badge> : <Badge tone="green">live</Badge>}</Td>
                <Td>
                  <StatusBadge status={a.status} />
                </Td>
                <Td>
                  {can('networks.manage') && (
                    <Button size="sm" variant="secondary" onClick={() => setEditingId(a.id)}>
                      Atur
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Drawer open={creating} title="Akun jaringan baru" onClose={() => setCreating(false)}>
        <CreateNetwork onDone={() => setCreating(false)} />
      </Drawer>
      <Drawer open={!!editing} title={editing ? `Atur ${editing.name}` : ''} onClose={() => setEditingId(null)}>
        {editing && <ConfigureNetwork key={editing.id} account={editing} onDone={() => setEditingId(null)} />}
      </Drawer>
    </RequirePermission>
  );
}
