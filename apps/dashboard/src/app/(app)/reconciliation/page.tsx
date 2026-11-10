'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RequirePermission } from '@/components/app-shell';
import { Alert, Badge, Card, Loading, Notes, PageHeader, Select, Table, Td } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { dateTime, int, money, pct } from '@/lib/format';
import { useOrgQuery } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { NetworkAccount, Reconciliation } from '@/lib/types';

function Gap({ value, flagged }: { value: number | null; flagged: boolean }) {
  if (value === null) return <span className="text-muted">—</span>;
  const text = `${value > 0 ? '+' : ''}${pct(value, 1)}`;
  return flagged ? <Badge tone="red">{text}</Badge> : <span className="tabular text-muted">{text}</span>;
}

export default function ReconciliationPage() {
  const { org } = useSession();
  const accounts = useOrgQuery<NetworkAccount[]>('/network-accounts');
  const connected = (accounts.data ?? []).filter((a) => a.apiConfigured);
  const [accountId, setAccountId] = useState('');
  const [days, setDays] = useState('7');
  useEffect(() => {
    if (!accountId && connected[0]) setAccountId(connected[0].id);
  }, [accountId, connected]);
  const recon = useOrgQuery<Reconciliation>(accountId ? `/analytics/reconciliation?networkAccountId=${accountId}&days=${days}` : null);
  const r = recon.data;

  return (
    <RequirePermission permission="analytics.read">
      <PageHeader
        title="Rekonsiliasi"
        description="Data menurut jaringan iklan dibandingkan dengan tracking internal, per campaign per hari, dalam zona waktu akun jaringan."
        actions={
          connected.length > 0 && (
            <>
              <Select aria-label="Akun jaringan" className="h-8 w-52" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {connected.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <Select aria-label="Rentang" className="h-8 w-32" value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="3">3 hari</option>
                <option value="7">7 hari</option>
                <option value="14">14 hari</option>
                <option value="30">30 hari</option>
              </Select>
            </>
          )
        }
      />
      {accounts.isLoading ? (
        <Loading />
      ) : connected.length === 0 ? (
        <Alert tone="blue">
          Belum ada akun jaringan dengan integrasi API. Hubungkan token API di <Link href="/networks" className="underline">Jaringan Iklan</Link>.
        </Alert>
      ) : (
        <div className="space-y-5">
          {recon.error && <Alert>{errorMessage(recon.error)}</Alert>}
          {r && (
            <p className="text-[13px] text-muted">
              Tanggal dalam zona waktu {r.timezone}
              {r.timezoneSource === 'fallback-utc' && <span className="text-warning"> (zona waktu akun tidak dikenali)</span>}. Baris ditandai bila selisih klik {r.thresholdPct}% atau lebih dengan minimal {r.minClicks} klik jaringan. Sinkronisasi terakhir{' '}
              {dateTime(r.lastSyncAt, org.timezone)}.
            </p>
          )}
          {r && r.unmappedCampaigns.length > 0 && (
            <Alert tone="yellow">
              {r.unmappedCampaigns.length} campaign di jaringan belum dipetakan ke campaign internal (spend{' '}
              {money(r.unmappedCampaigns.reduce((s, u) => s + u.spend, 0), r.currency)}): {r.unmappedCampaigns.map((u) => u.externalCampaignId).join(', ')}. Isi “ID di jaringan” pada
              halaman campaign.
            </Alert>
          )}
          <Card>
            {recon.isLoading || !r ? (
              <Loading />
            ) : (
              <Table
                head={['Tanggal', 'Campaign', 'Klik jaringan', 'Klik internal', 'Selisih klik', 'Bot internal', 'Konversi jaringan', 'Postback terkirim', 'VERIFIED internal', 'Spend jaringan']}
                empty={r.rows.length === 0}
              >
                {r.rows.map((row) => (
                  <tr key={`${row.campaignId}-${row.date}`} className={row.flagged ? 'bg-danger/5' : undefined}>
                    <Td className="whitespace-nowrap">
                      {row.date}
                      {row.isToday && <span className="ml-1 text-xs text-muted">(berjalan)</span>}
                    </Td>
                    <Td>
                      <Link href={`/campaigns/${row.campaignId}`} className="text-primary hover:underline">
                        {row.campaign}
                      </Link>
                    </Td>
                    <Td numeric>{int(row.networkClicks)}</Td>
                    <Td numeric>{int(row.internalClicks)}</Td>
                    <Td numeric>
                      <Gap value={row.clickGap} flagged={row.flagged} />
                    </Td>
                    <Td numeric className="text-muted">{int(row.internalBotClicks)}</Td>
                    <Td numeric>{int(row.networkConversions)}</Td>
                    <Td numeric>{int(row.postbacksDelivered)}</Td>
                    <Td numeric>{int(row.internalVerified)}</Td>
                    <Td numeric>{money(row.networkSpend, r.currency)}</Td>
                  </tr>
                ))}
              </Table>
            )}
            <Notes
              title="Cara membaca"
              items={[
                'Selisih klik = (internal − jaringan) ÷ jaringan. Selisih 5–20% umum terjadi karena pengunjung menutup halaman sebelum redirect atau filter jaringan.',
                'Konversi jaringan dibandingkan dengan postback yang berhasil dikirim. Selisih besar menandakan masalah postback atau goal.',
                'Hari berjalan tidak ditandai karena datanya belum lengkap.',
              ]}
            />
          </Card>
        </div>
      )}
    </RequirePermission>
  );
}
