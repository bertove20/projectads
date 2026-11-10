'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Button, Card, Drawer, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { compact, useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { AD_FORMATS, BID_MODELS, Campaign, label, LandingPage, NetworkAccount, Offer } from '@/lib/types';

const EMPTY = {
  name: '',
  networkAccountId: '',
  adFormat: 'PUSH',
  adFormatNetwork: '',
  bidModel: 'CPC',
  bidAmount: '',
  targetCpa: '',
  flowType: 'DIRECT',
  offerId: '',
  landingPageId: '',
  fallbackUrl: '',
  externalCampaignId: '',
};

function CreateCampaign({ onDone }: { onDone: (id: string) => void }) {
  const networks = useOrgQuery<NetworkAccount[]>('/network-accounts');
  const offers = useOrgQuery<Offer[]>('/offers');
  const landers = useOrgQuery<LandingPage[]>('/landing-pages');
  const action = useOrgAction<Campaign>();
  const [f, setF] = useState(EMPTY);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const isCpaGoal = f.bidModel.startsWith('CPA_GOAL');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = compact({ ...f, landingPageId: f.flowType === 'LANDING' ? f.landingPageId : '' });
    const created = await action.mutateAsync({ method: 'POST', path: '/campaigns', body }).catch(() => null);
    if (created) onDone(created.id);
  }

  if (!networks.data || !offers.data || !landers.data) return <Loading />;
  if (!networks.data.length || !offers.data.length) {
    return (
      <Alert tone="yellow">
        Buat dulu minimal satu <Link className="underline" href="/networks">akun jaringan iklan</Link> dan satu{' '}
        <Link className="underline" href="/offers">offer</Link>.
      </Alert>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <Field label="Nama campaign">
        <Input required minLength={2} value={f.name} onChange={set('name')} />
      </Field>
      <Field label="Akun jaringan iklan">
        <Select required value={f.networkAccountId} onChange={set('networkAccountId')}>
          <option value="">— pilih —</option>
          {networks.data.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name} ({label(n.network)})
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ad format">
          <Select value={f.adFormat} onChange={set('adFormat')}>
            {AD_FORMATS.map((v) => (
              <option key={v} value={v}>
                {label(v)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bid model">
          <Select value={f.bidModel} onChange={set('bidModel')}>
            {BID_MODELS.map((v) => (
              <option key={v} value={v}>
                {label(v)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bid" hint="opsional">
          <Input inputMode="decimal" pattern="\d+(\.\d+)?" value={f.bidAmount} onChange={set('bidAmount')} />
        </Field>
        <Field label="Target CPA" hint="opsional">
          <Input inputMode="decimal" pattern="\d+(\.\d+)?" value={f.targetCpa} onChange={set('targetCpa')} />
        </Field>
      </div>
      {isCpaGoal && (
        <Alert tone="blue">
          CPA Goal: konversi VERIFIED akan dikirim balik ke jaringan iklan. Campaign baru bisa diaktifkan setelah template postback pada akun jaringan diisi.
        </Alert>
      )}
      <Field label="Alur">
        <Select value={f.flowType} onChange={set('flowType')}>
          <option value="DIRECT">{label('DIRECT')}</option>
          <option value="LANDING">{label('LANDING')}</option>
        </Select>
      </Field>
      <Field label="Offer">
        <Select required value={f.offerId} onChange={set('offerId')}>
          <option value="">— pilih —</option>
          {offers.data.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      </Field>
      {f.flowType === 'LANDING' && (
        <Field label="Landing page">
          <Select required value={f.landingPageId} onChange={set('landingPageId')}>
            <option value="">— pilih —</option>
            {landers.data.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Nama format di jaringan" hint="opsional, mis. 'Push notifications'">
        <Input value={f.adFormatNetwork} onChange={set('adFormatNetwork')} />
      </Field>
      <Field label="ID campaign di jaringan" hint="opsional, untuk sinkronisasi Phase 2">
        <Input value={f.externalCampaignId} onChange={set('externalCampaignId')} />
      </Field>
      <Field label="Fallback URL" hint="tujuan bila offer nonaktif; opsional">
        <Input type="url" value={f.fallbackUrl} onChange={set('fallbackUrl')} />
      </Field>
      <Button type="submit" disabled={action.isPending}>
        {action.isPending ? 'Menyimpan…' : 'Buat campaign (status Paused)'}
      </Button>
    </form>
  );
}

export default function CampaignsPage() {
  const { can } = useSession();
  const router = useRouter();
  const campaigns = useOrgQuery<Campaign[]>('/campaigns');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rows = (campaigns.data ?? []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <RequirePermission permission="campaigns.read">
      <PageHeader
        title="Campaigns"
        description="Setiap campaign punya tracking link sendiri untuk dipasang di jaringan iklan."
        actions={can('campaigns.manage') && <Button onClick={() => setOpen(true)}>+ Campaign</Button>}
      />
      <Card actions={<Input placeholder="Cari…" className="h-8 w-48" value={q} onChange={(e) => setQ(e.target.value)} />} title={`${rows.length} campaign`}>
        {campaigns.error && <Alert>{errorMessage(campaigns.error)}</Alert>}
        {campaigns.isLoading ? (
          <Loading />
        ) : (
          <Table head={['Nama', 'Jaringan', 'Format', 'Bid model', 'Offer', 'Postback', 'Status']} empty={rows.length === 0}>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-surface-2">
                <Td>
                  <Link className="font-medium text-primary hover:underline" href={`/campaigns/${c.id}`}>
                    {c.name}
                  </Link>
                </Td>
                <Td>{c.networkAccount.name}</Td>
                <Td>{label(c.adFormat)}</Td>
                <Td>{label(c.bidModel)}</Td>
                <Td>{c.offer?.name ?? '—'}</Td>
                <Td>{c.postbackEnabled ? <Badge tone="blue">aktif</Badge> : <Badge>off</Badge>}</Td>
                <Td>
                  <StatusBadge status={c.status} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Drawer open={open} title="Campaign baru" onClose={() => setOpen(false)}>
        <CreateCampaign onDone={(id) => router.push(`/campaigns/${id}`)} />
      </Drawer>
    </RequirePermission>
  );
}
