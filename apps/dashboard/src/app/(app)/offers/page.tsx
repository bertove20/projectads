'use client';

import { FormEvent, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Button, Card, Drawer, Field, Input, Loading, PageHeader, Select, StatusBadge, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { money } from '@/lib/format';
import { compact, useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { AffiliateNetwork, Offer } from '@/lib/types';

function OfferForm({ offer, onDone }: { offer?: Offer; onDone: () => void }) {
  const affiliates = useOrgQuery<AffiliateNetwork[]>('/affiliate-networks');
  const action = useOrgAction();
  const [f, setF] = useState({
    name: offer?.name ?? '',
    url: offer?.url ?? '',
    affiliateNetworkId: offer?.affiliateNetwork?.id ?? '',
    payoutType: offer?.payoutType ?? 'CPA',
    payoutAmount: offer?.payoutAmount ? String(Number(offer.payoutAmount)) : '',
    currency: offer?.currency ?? 'USD',
    geos: offer?.geos.join(',') ?? '',
    status: offer?.status ?? 'ACTIVE',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const missingClickId = f.url !== '' && !f.url.includes('{click_id}');

  async function submit(e: FormEvent) {
    e.preventDefault();
    const geos = f.geos.split(/[\s,]+/).map((g) => g.trim().toUpperCase()).filter(Boolean);
    const base = compact({ name: f.name, url: f.url, payoutType: f.payoutType, payoutAmount: f.payoutAmount, currency: f.currency });
    const body = offer ? { ...base, geos, status: f.status } : { ...base, geos, ...compact({ affiliateNetworkId: f.affiliateNetworkId }) };
    await action.mutateAsync({ method: offer ? 'PATCH' : 'POST', path: offer ? `/offers/${offer.id}` : '/offers', body }).then(onDone, () => undefined);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      <Field label="Nama offer">
        <Input required minLength={2} value={f.name} onChange={set('name')} />
      </Field>
      <Field label="URL offer" hint={<>Wajib memuat <code>{'{click_id}'}</code> di parameter sub-ID affiliate network, mis. <code>?sub1={'{click_id}'}</code></>}>
        <Input required type="text" value={f.url} onChange={set('url')} placeholder="https://offer.example.com/?sub1={click_id}" />
      </Field>
      {missingClickId && <Alert tone="yellow">URL belum memuat {'{click_id}'} — konversi tidak akan bisa dilacak.</Alert>}
      {!offer && (
        <Field label="Affiliate network">
          <Select value={f.affiliateNetworkId} onChange={set('affiliateNetworkId')}>
            <option value="">— tidak ada —</option>
            {affiliates.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Tipe payout">
          <Select value={f.payoutType} onChange={set('payoutType')}>
            {['CPA', 'CPL', 'CPI', 'REVSHARE', 'DYNAMIC'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Payout default" hint="dipakai bila postback tidak mengirim payout">
          <Input inputMode="decimal" pattern="\d+(\.\d+)?" value={f.payoutAmount} onChange={set('payoutAmount')} />
        </Field>
        <Field label="Mata uang">
          <Input pattern="[A-Z]{3}" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
        </Field>
      </div>
      <Field label="GEO" hint="kode negara dipisah koma, mis. ID, MY, TH">
        <Input value={f.geos} onChange={set('geos')} />
      </Field>
      {offer && (
        <Field label="Status">
          <Select value={f.status} onChange={set('status')}>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="ARCHIVED">Archived</option>
          </Select>
        </Field>
      )}
      <Button type="submit" disabled={action.isPending}>
        Simpan
      </Button>
    </form>
  );
}

export default function OffersPage() {
  const { can } = useSession();
  const offers = useOrgQuery<Offer[]>('/offers');
  const [editing, setEditing] = useState<Offer | 'new' | null>(null);
  return (
    <RequirePermission permission="offers.read">
      <PageHeader
        title="Offers"
        description="Tujuan akhir traffic. Konversi offer dilaporkan oleh affiliate network melalui postback masuk."
        actions={can('offers.manage') && <Button onClick={() => setEditing('new')}>+ Offer</Button>}
      />
      <Card>
        {offers.error && <Alert>{errorMessage(offers.error)}</Alert>}
        {offers.isLoading ? (
          <Loading />
        ) : (
          <Table head={['Nama', 'Affiliate', 'Payout', 'GEO', 'Status', '']} empty={!offers.data?.length}>
            {offers.data?.map((o) => (
              <tr key={o.id}>
                <Td>
                  <div className="font-medium">{o.name}</div>
                  <div className="max-w-md truncate text-xs text-muted">{o.url}</div>
                </Td>
                <Td>{o.affiliateNetwork?.name ?? '—'}</Td>
                <Td numeric>
                  {money(o.payoutAmount, o.currency)} <span className="text-xs text-muted">{o.payoutType}</span>
                </Td>
                <Td>{o.geos.length ? o.geos.join(', ') : 'semua'}</Td>
                <Td>
                  <StatusBadge status={o.status} />
                </Td>
                <Td>
                  {can('offers.manage') && (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(o)}>
                      Ubah
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Drawer open={editing !== null} title={editing === 'new' ? 'Offer baru' : 'Ubah offer'} onClose={() => setEditing(null)}>
        {editing !== null && <OfferForm offer={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Drawer>
    </RequirePermission>
  );
}
