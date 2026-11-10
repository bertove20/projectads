'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useMemo, useState } from 'react';
import { RangePicker } from '@/components/range-picker';
import { ReportNotes, ReportTable } from '@/components/report-table';
import { ZonePanel } from '@/components/zone-panel';
import { Alert, Badge, Button, Card, CopyText, Field, Input, Loading, PageHeader, Select, StatusBadge } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { presetRange } from '@/lib/format';
import { useOrgAction, useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Campaign, label, Report } from '@/lib/types';

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1.5 text-sm last:border-0">
      <span className="text-muted">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

function SpendForm({ campaign }: { campaign: Campaign }) {
  const action = useOrgAction();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [done, setDone] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    await action.mutateAsync({ method: 'POST', path: '/spend', body: { campaignId: campaign.id, date, amount } }).then(() => {
      setDone(true);
      setAmount('');
    }, () => undefined);
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      {done && <Alert tone="green">Spend tersimpan.</Alert>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tanggal">
          <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={`Jumlah (${campaign.currency})`}>
          <Input inputMode="decimal" required pattern="\d+(\.\d+)?" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      <p className="text-xs text-muted">Menimpa spend manual pada tanggal yang sama. Bila akun jaringan terhubung lewat API, spend dari jaringan dipakai lebih dulu.</p>
      <Button type="submit" size="sm" disabled={action.isPending}>
        Simpan spend
      </Button>
    </form>
  );
}

/** ID campaign di jaringan iklan: kunci pemetaan spend & statistik hasil sinkronisasi API. */
function ExternalIdForm({ campaign, editable }: { campaign: Campaign; editable: boolean }) {
  const action = useOrgAction();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(campaign.externalCampaignId ?? '');
  if (!editing) {
    return (
      <Info
        k="ID di jaringan"
        v={
          <span className="flex items-center gap-2">
            {campaign.externalCampaignId ?? <Badge tone="yellow">belum dipetakan</Badge>}
            {editable && (
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => setEditing(true)}>
                ubah
              </button>
            )}
          </span>
        }
      />
    );
  }
  return (
    <form
      className="flex items-center gap-2 py-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        action.mutate({ method: 'PATCH', path: `/campaigns/${campaign.id}`, body: { externalCampaignId: value.trim() } }, { onSuccess: () => setEditing(false) });
      }}
    >
      <Input className="h-8" aria-label="ID campaign di jaringan" value={value} onChange={(e) => setValue(e.target.value)} placeholder="mis. 9001" />
      <Button size="sm" type="submit" disabled={action.isPending}>
        Simpan
      </Button>
      {action.error && <span className="text-xs text-danger">{errorMessage(action.error)}</span>}
    </form>
  );
}

const GROUP_LABEL: Record<string, string> = { zone: 'Zone', country: 'Negara', day: 'Tanggal', device: 'Device', os: 'OS' };

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, org } = useSession();
  const campaign = useOrgQuery<Campaign>(`/campaigns/${id}`);
  const action = useOrgAction();
  const [preset, setPreset] = useState('7d');
  const [groupBy, setGroupBy] = useState('zone');
  const range = useMemo(() => presetRange(preset, org.timezone), [preset, org.timezone]);
  const report = useOrgQuery<Report>(
    `/analytics/report?groupBy=${groupBy}&campaignId=${id}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
  );

  if (campaign.error) return <Alert>{errorMessage(campaign.error)}</Alert>;
  const c = campaign.data;
  if (!c) return <Loading />;
  const canManage = can('campaigns.manage');
  const setStatus = (status: string) => action.mutate({ method: 'PATCH', path: `/campaigns/${c.id}`, body: { status } });

  return (
    <div className="space-y-5">
      <PageHeader
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} />
            <span>{c.networkAccount.name}</span>
            <Badge>{label(c.adFormat)}</Badge>
            <Badge>{label(c.bidModel)}</Badge>
          </span>
        }
        actions={
          canManage && (
            <>
              {c.status !== 'ACTIVE' && (
                <Button onClick={() => setStatus('ACTIVE')} disabled={action.isPending}>
                  Aktifkan
                </Button>
              )}
              {c.status === 'ACTIVE' && (
                <Button variant="secondary" onClick={() => setStatus('PAUSED')} disabled={action.isPending}>
                  Pause
                </Button>
              )}
            </>
          )
        }
      />
      {action.error && <Alert>{errorMessage(action.error)}</Alert>}
      {c.networkAccount.testMode && c.postbackEnabled && (
        <Alert tone="yellow">
          Akun jaringan <b>{c.networkAccount.name}</b> masih dalam <b>test mode</b>: postback dicatat tapi tidak dikirim ke jaringan.{' '}
          <Link href="/networks" className="underline">Atur di Jaringan Iklan</Link>.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Tracking link" className="lg:col-span-2">
          {c.trackingLink && (
            <div className="space-y-3 text-sm">
              <p>Pasang URL ini sebagai target URL campaign di jaringan iklan. Ganti setiap <code>[MACRO_…]</code> dengan macro resmi jaringan (lihat dokumentasi jaringan).</p>
              <CopyText value={c.trackingLink.example} />
              {c.flowType === 'LANDING' && (
                <>
                  <p>Tombol CTA di landing page diarahkan ke URL ini (<code>{'{cid}'}</code> = parameter <code>cid</code> yang diterima landing page):</p>
                  <CopyText value={c.trackingLink.clickOut} />
                </>
              )}
            </div>
          )}
        </Card>
        <Card title="Detail">
          <Info k="Alur" v={label(c.flowType)} />
          <Info k="Offer" v={c.offer?.name ?? '—'} />
          {c.flowType === 'LANDING' && <Info k="Landing page" v={c.landingPage?.name ?? '—'} />}
          <Info k="Bid" v={c.bidAmount ?? '—'} />
          <Info k="Target CPA" v={c.targetCpa ?? '—'} />
          <Info k="Goal postback" v={c.conversionGoal} />
          <Info k="Postback ke jaringan" v={c.postbackEnabled ? <Badge tone="blue">aktif</Badge> : <Badge>off</Badge>} />
          <Info k="Template postback" v={c.networkAccount.postbackConfigured ? <Badge tone="green">terpasang</Badge> : <Badge tone="yellow">belum</Badge>} />
          <ExternalIdForm campaign={c} editable={canManage} />
        </Card>
      </div>

      <Card
        title="Performa"
        actions={
          <>
            <Select aria-label="Kelompokkan" className="h-8 w-36" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="zone">per Zone</option>
              <option value="country">per Negara</option>
              <option value="day">per Hari</option>
              <option value="device">per Device</option>
              <option value="os">per OS</option>
            </Select>
            <RangePicker value={preset} onChange={setPreset} />
          </>
        }
      >
        {report.data ? (
          <>
            <ReportTable report={report.data} dimension={GROUP_LABEL[groupBy] ?? groupBy} />
            <ReportNotes notes={report.data.notes} />
          </>
        ) : (
          <Loading />
        )}
      </Card>

      <Card title="Zone & blacklist">
        <ZonePanel campaign={c} />
      </Card>

      {can('spend.manage') && (
        <Card title="Input spend manual">
          <SpendForm campaign={c} />
        </Card>
      )}
    </div>
  );
}
